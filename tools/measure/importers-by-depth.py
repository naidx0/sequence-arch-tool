"""Importers of one file by depth, and what a grep would cost to find them.

The number behind the site's "blast radius in one call" charts and
docs/CANON.md section 3. Re-run it before quoting it:

    python tools/measure/importers-by-depth.py [packages/analyzer/src/scan.ts]

It walks every package's source (node_modules, dist, release, e2e excluded;
tests included, because a change to the target breaks them too), resolves
relative and @sequence/* workspace imports, then BFS-es the reverse edges
from the target. Per depth it prints the new files, the cumulative unique
files, and the lookups a grep needs before it can start that depth: one for
the target plus one per file found so far. Sequence returns any depth from
the graph in one call.

Measured 2026-09-18 on packages/analyzer/src/scan.ts:
  depth 1   97 new   97 total     1 grep lookup
  depth 2   70 new  167 total    98
  depth 3   27 new  194 total   168
  depth 4   30 new  224 total   195
"""
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
ROOT = os.path.join(REPO, 'packages')
EXTS = ('.ts', '.tsx', '.mts', '.js', '.mjs')
SKIP = {'node_modules', 'dist', 'release', 'e2e', 'coverage', 'test-results'}

target_arg = sys.argv[1] if len(sys.argv) > 1 else 'packages/analyzer/src/scan.ts'
TARGET = os.path.normpath(os.path.join(REPO, target_arg))

files = []
for dp, dn, fn in os.walk(ROOT):
    dn[:] = [d for d in dn if d not in SKIP]
    for f in fn:
        if f.endswith(EXTS) and not f.endswith('.d.ts'):
            files.append(os.path.join(dp, f))

pkg_dir = {}
for name in os.listdir(ROOT):
    pj = os.path.join(ROOT, name, 'package.json')
    if os.path.exists(pj):
        with open(pj, encoding='utf-8') as fh:
            pkg_dir[json.load(fh).get('name', '')] = name

IMPORT = re.compile(
    r"""(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]"""
    r"""|import\s*\(\s*['"]([^'"]+)['"]\s*\)"""
    r"""|require\(\s*['"]([^'"]+)['"]\s*\)"""
)


def resolve(frm, spec):
    cands = []
    if spec.startswith('.'):
        stem = re.sub(r'\.js$', '', os.path.normpath(os.path.join(os.path.dirname(frm), spec)))
        cands += [stem + e for e in ('', '.ts', '.tsx', '.mts', '.js', '.mjs')]
        cands += [os.path.join(stem, 'index' + e) for e in ('.ts', '.tsx', '.js')]
    elif spec.startswith('@sequence/'):
        short = spec.split('/')[1]
        for pkg, d in pkg_dir.items():
            if pkg == '@sequence/' + short or pkg.endswith('/' + short):
                cands += [os.path.join(ROOT, d, e) for e in ('src/index.ts', 'src/index.tsx', 'index.ts')]
    for c in cands:
        if os.path.isfile(c):
            return os.path.normpath(c)
    return None


importers = collections.defaultdict(set)
for p in files:
    try:
        with open(p, encoding='utf-8', errors='ignore') as fh:
            src = fh.read()
    except OSError:
        continue
    for m in IMPORT.finditer(src):
        t = resolve(p, m.group(1) or m.group(2) or m.group(3))
        if t:
            importers[t].add(os.path.normpath(p))

seen = {TARGET}
frontier = [TARGET]
total = 0
greps = 1
read_bytes = os.path.getsize(TARGET)
answer_bytes = 0
print(f'target {os.path.relpath(TARGET, REPO)}')
print('depth  new  cumulative  grep_lookups_to_start  bytes_read_by_grep  bytes_in_one_answer')
for depth in range(1, 5):
    nxt = []
    for f in frontier:
        for i in importers.get(f, ()):
            if i not in seen:
                seen.add(i)
                nxt.append(i)
    total += len(nxt)
    # A grep-driven agent has to READ each file it found to see what that file
    # imports before it can take the next hop, so the bytes it pulls into
    # context are the sum of every file found so far. Sequence's answer for the
    # same depth is the list of repo-relative paths, one per line.
    read_bytes += sum(os.path.getsize(f) for f in nxt)
    answer_bytes = sum(len(os.path.relpath(f, REPO)) + 1 for f in seen if f != TARGET)
    print(f'{depth:5d} {len(nxt):4d} {total:11d} {greps:22d} {read_bytes:19d} {answer_bytes:20d}')
    greps += len(nxt)
    frontier = nxt
print()
print('tokens are bytes / 4 (the usual estimate for source text):')
print(f'  grep agent reads  {read_bytes // 4:8d} tokens to finish depth 4')
print(f'  Sequence answers  {answer_bytes // 4:8d} tokens for depth 4 (the file list)')
