"""fastgate: the fast-verification kit applied to a unittest or pytest gate.

Stdlib only. Drop it in a repo root (or pass --root) and run:

  python fastgate.py run                  # parallel, cached gate; prints a JSON summary
  python fastgate.py run --fresh          # ignore the cache
  python fastgate.py equal                # serial reference vs fastgate, per-test diff
  python fastgate.py ab BASE.json CAND.json --group-by KEY
      paired grouped bootstrap on two per-item score files (the kit's gate)

What it does, in the kit's terms:
  tier 0  py_compile every changed .py file (milliseconds; can only reject)
  tier 2  run each test file as its own process, --jobs at a time
  cache   each test file's outcomes are stored under a key that hashes every
          non-test file in the tree, the shared test helpers, that one test
          file, the Python version and the env vars named by --env. Edit a
          source file and every test file reruns; edit one test file and only
          that file reruns; change nothing and the gate costs one tree hash.
  exact   `equal` runs the old serial command and fastgate on the same tree and
          diffs every test id's outcome. Adopt only on zero differences.

Assumption the key relies on: a test file does not read another test_*.py file.
Shared helpers (conftest.py, fake_server.py, fixtures, data) are in every key.
"""
import argparse
import hashlib
import json
import os
import random
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SKIP_DIRS = {".git", "__pycache__", ".fastgate", ".fastcheck", "node_modules", ".venv",
             "venv", ".pytest_cache", ".mypy_cache", ".ruff_cache"}
TEST_RE = re.compile(r"^test_.*\.py$|^.*_test\.py$")
# Runs unittest in a child and writes {test id: outcome} as JSON: no output parsing.
UNIT_SHIM = r"""
import json, sys, unittest
class R(unittest.TestResult):
    def __init__(s, *a, **k):
        super().__init__(*a, **k); s.out = {}
    def _set(s, t, v):
        t = getattr(t, "test_case", t)
        if s.out.get(t.id()) not in ("failed", "error"): s.out[t.id()] = v
    def addSuccess(s, t): s._set(t, "passed")
    def addFailure(s, t, e): s._set(t, "failed")
    def addError(s, t, e): s._set(t, "error")
    def addSkip(s, t, r): s._set(t, "skipped")
    def addExpectedFailure(s, t, e): s._set(t, "expected failure")
    def addUnexpectedSuccess(s, t): s._set(t, "failed")
    def addSubTest(s, t, st, e):
        if e is not None: s._set(t, "failed" if issubclass(e[0], t.failureException) else "error")
L = unittest.TestLoader()
suite = L.discover(".") if sys.argv[1] == "--discover" else L.loadTestsFromName(sys.argv[1])
r = R(); suite.run(r)
open(sys.argv[2], "w").write(json.dumps(r.out))
"""


def tree_files(root, excludes):
    try:
        out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard", "-z"], cwd=root,
                             capture_output=True, check=True).stdout.decode()
        files = [root / p for p in out.split("\0") if p]
    except Exception:
        files = [p for p in root.rglob("*") if p.is_file()]
    keep = []
    for p in files:
        rel = p.relative_to(root)
        if any(part in SKIP_DIRS for part in rel.parts) or not p.is_file():
            continue
        if any(rel.match(e) or str(rel).replace("\\", "/").startswith(e.rstrip("/") + "/") for e in excludes):
            continue
        keep.append(p)
    return sorted(keep)


def file_hash(p, memo):
    k = str(p)
    if k not in memo:
        memo[k] = hashlib.sha256(p.read_bytes()).hexdigest()
    return memo[k]


def keys(root, tests_dir, excludes, env_names):
    memo = {}
    files = tree_files(root, excludes)
    tests = [p for p in files if TEST_RE.match(p.name) and tests_dir in p.parents]
    shared = hashlib.sha256()
    for p in files:
        if p in tests:
            continue
        shared.update(str(p.relative_to(root)).replace("\\", "/").encode())
        shared.update(file_hash(p, memo).encode())
    shared.update(Path(__file__).read_bytes())
    shared.update(sys.version.encode())
    for n in sorted(env_names):
        shared.update(f"{n}={os.environ.get(n, '')}".encode())
    base = shared.hexdigest()
    out = {}
    for t in tests:
        h = hashlib.sha256((base + str(t.relative_to(root)) + file_hash(t, memo)).encode())
        out[t] = h.hexdigest()[:24]
    return out, files, memo


def run_file(root, tests_dir, t, runner):
    rel = t.relative_to(root)
    env = dict(os.environ, OMP_NUM_THREADS="1", MKL_NUM_THREADS="1", PYTHONDONTWRITEBYTECODE="1")
    # a file run alone loses the sys.path edits other test files make in a serial run
    env["PYTHONPATH"] = os.pathsep.join(filter(None, [str(root), str(tests_dir), env.get("PYTHONPATH")]))
    t0 = time.time()
    out = tmpfile()
    if runner == "pytest":
        cmd = [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", f"--junitxml={out}", str(rel)]
        p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, env=env)
        res = read_junit(out)
    else:
        mod = ".".join(t.relative_to(tests_dir).with_suffix("").parts)
        p = subprocess.run([sys.executable, "-c", UNIT_SHIM, mod, out], cwd=tests_dir,
                           capture_output=True, text=True, env=env)
        res = json.loads(Path(out).read_text() or "{}") if p.returncode == 0 else {}
        if p.returncode:
            res = {f"{mod}.<run>": "error"}
    os.unlink(out)
    return {"file": str(rel), "outcomes": res, "rc": p.returncode, "sec": round(time.time() - t0, 3)}


def tmpfile():
    fd, name = tempfile.mkstemp(suffix=".json")
    os.close(fd)  # closed so a child can write it on Windows
    return name


def read_junit(path):
    import xml.etree.ElementTree as ET
    out = {}
    try:
        cases = ET.parse(path).getroot().iter("testcase")
    except Exception:
        return {"<collect>": "error"}
    for c in cases:
        tags = {ch.tag for ch in c}
        v = "failed" if "failure" in tags else "error" if "error" in tags else "skipped" if "skipped" in tags else "passed"
        out[f"{c.get('classname')}.{c.get('name')}"] = v
    return out


def gate(root, tests_dir, runner, jobs, fresh, excludes, env_names):
    t0 = time.time()
    k, files, memo = keys(root, tests_dir, excludes, env_names)
    t_hash = time.time() - t0
    cache = root / ".fastgate"
    cache.mkdir(exist_ok=True)
    # tier 0: compile what changed since the last run (can only reject)
    stamp = cache / "compiled.json"
    seen = json.loads(stamp.read_text()) if stamp.exists() else {}
    bad = []
    for p in files:
        if p.suffix == ".py":
            rel, h = str(p.relative_to(root)), memo.get(str(p)) or file_hash(p, memo)
            if seen.get(rel) != h:
                try:
                    compile(p.read_bytes(), str(p), "exec", dont_inherit=True)
                    seen[rel] = h
                except (SyntaxError, ValueError) as e:
                    bad.append(f"{rel}: {e}")
    stamp.write_text(json.dumps(seen))
    if bad:
        return {"verdict": "FAIL", "tier": "static", "errors": bad, "wall_s": round(time.time() - t0, 3)}
    todo, results = [], []
    for t, key in k.items():
        c = cache / f"{t.stem}-{key}.json"
        if c.exists() and not fresh:
            results.append(dict(json.loads(c.read_text()), cached=True))
        else:
            todo.append((t, c))
    # longest files first so the pool drains evenly
    hist = json.loads((cache / "durations.json").read_text()) if (cache / "durations.json").exists() else {}
    todo.sort(key=lambda x: -hist.get(str(x[0].relative_to(root)), 1e9))
    with ThreadPoolExecutor(max(1, jobs)) as ex:
        for (t, c), r in zip(todo, ex.map(lambda x: run_file(root, tests_dir, x[0], runner), todo)):
            c.write_text(json.dumps(r))  # failures cached too: same input, same failure
            hist[r["file"]] = r["sec"]
            results.append(dict(r, cached=False))
    (cache / "durations.json").write_text(json.dumps(hist))
    outcomes = {}
    for r in results:
        outcomes.update(r["outcomes"])
    counts = {}
    for v in outcomes.values():
        counts[v] = counts.get(v, 0) + 1
    ok = all(v in ("passed", "skipped", "expected failure", "xfail") for v in outcomes.values())
    ok = ok and all(r["rc"] == 0 for r in results)
    return {"verdict": "PASS" if ok else "FAIL", "tests": len(outcomes), "counts": counts,
            "files": len(results), "files_rerun": len(todo), "hash_s": round(t_hash, 3),
            "wall_s": round(time.time() - t0, 3), "outcomes": outcomes}


def serial_reference(root, tests_dir, runner):
    t0 = time.time()
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    tmp = tmpfile()
    if runner == "pytest":
        subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", f"--junitxml={tmp}",
                        str(tests_dir.relative_to(root))], cwd=root, capture_output=True, text=True, env=env)
        out = read_junit(tmp)
    else:
        subprocess.run([sys.executable, "-c", UNIT_SHIM, "--discover", tmp], cwd=tests_dir,
                       capture_output=True, text=True, env=env)
        out = json.loads(Path(tmp).read_text() or "{}")
    os.unlink(tmp)
    return out, round(time.time() - t0, 3)


def paired_gate(base, cand, group_by, n_boot=4000, seed=0):
    """The kit's gate. base/cand: {item_id: {"score": float, <group_by>: ...}}."""
    common = sorted(set(base) & set(cand))
    if len(common) != len(base) or len(common) != len(cand):
        raise SystemExit("baseline and candidate were scored on different items")
    by = {}
    for i in common:
        g = cand[i].get(group_by, i) if group_by else i
        by.setdefault(g, []).append(cand[i]["score"] - base[i]["score"])
    dg = [sum(v) / len(v) for v in by.values()]
    rng = random.Random(seed)
    boot = sorted(sum(rng.choice(dg) for _ in dg) / len(dg) for _ in range(n_boot))
    lo, hi = boot[int(0.05 * n_boot)], boot[int(0.95 * n_boot) - 1]
    return {"delta": round(sum(dg) / len(dg), 5), "ci90": [round(lo, 5), round(hi, 5)],
            "wins": sum(d > 0 for d in dg), "losses": sum(d < 0 for d in dg), "groups": len(dg),
            "verdict": "ACCEPT" if lo > 0 else "REJECT" if hi < 0 else "UNSURE"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run", "equal", "ab"])
    ap.add_argument("files", nargs="*")
    ap.add_argument("--root", default=".")
    ap.add_argument("--tests", default="tests")
    ap.add_argument("--runner", choices=["unittest", "pytest"], default="unittest")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--exclude", action="append", default=[], help="path prefix or glob not read by tests (runs/, *.bundle)")
    ap.add_argument("--env", action="append", default=[], help="env var that changes results (repeatable)")
    ap.add_argument("--group-by", default=None)
    ap.add_argument("--full", action="store_true", help="print every test outcome")
    a = ap.parse_args()
    if a.cmd == "ab":
        base, cand = (json.loads(Path(f).read_text()) for f in a.files)
        print(json.dumps(paired_gate(base, cand, a.group_by)))
        return
    root = Path(a.root).resolve()
    tests_dir = (root / a.tests).resolve()
    if a.cmd == "run":
        r = gate(root, tests_dir, a.runner, a.jobs, a.fresh, a.exclude, a.env)
        if not a.full:
            r.pop("outcomes", None)
        print(json.dumps(r))
        sys.exit(0 if r["verdict"] == "PASS" else 1)
    ref, ref_s = serial_reference(root, tests_dir, a.runner)
    fast = gate(root, tests_dir, a.runner, a.jobs, True, a.exclude, a.env)
    diff = sorted(k for k in set(ref) | set(fast["outcomes"]) if ref.get(k) != fast["outcomes"].get(k))
    print(json.dumps({"reference_s": ref_s, "fastgate_cold_s": fast["wall_s"], "tests": len(ref),
                      "differences": len(diff), "examples": [(k, ref.get(k), fast["outcomes"].get(k)) for k in diff[:10]],
                      "verdict": "EXACT" if not diff else "MISMATCH"}))


if __name__ == "__main__":
    main()
