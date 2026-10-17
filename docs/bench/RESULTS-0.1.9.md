# Bench results, 0.1.9 (branch wip/019-benchc, base f5b32e707)

Internal. Program: `docs/plans/0.1.9/BENCH-PROGRAM.md`. Nothing here changes `docs/claims.json` or the site.
Every number below is copied from a raw file in `report/raw/` (sha256 at the bottom).

Machine: AMD Ryzen 7 5700X, 8 cores / 16 threads, 16 GB, Windows 11, node v24.13.0, ripgrep 15.2.0 (the sealed
set was tested with rg 14.1.0; the bench only requires that rg runs). **Load average: the benches report 0.0
because `os.loadavg()` is always 0 on Windows. That is not a measurement. No CPU-load sample could be taken
(`Get-Counter` fails on this box).** Other builders were active on the machine, so every ms/query and wall time
below is NOT a benchmark result under program rule 5; the quality metrics (hit@k, recall, precision, call
counts) are load-independent.

## Status

| Tier | Status |
|---|---|
| C, Codex plain vs sequence on frontier model | **BLOCKED, no scored runs.** See "Tier C" below. |
| A1 find_files, v2 sealed set, 6 held-out repos | Done, n = 300 questions (50 per repo). |
| A2 closure, 6 repos (5 with a file-level closure; gin has none) | Done, n = 150 targets (30 per repo). |

## A1: which files does this change touch (bench:findfiles)

Raw: `report/raw/bench-findfiles-2026-10-15.json`, rendered `report/raw/bench-findfiles-2026-10-15.md`.
Question set v2, sha256 `25c98b4152e5b5e7` (matches `questions.sha256`), seed 20261014, k = 5, analyzer build
`b10f51445ab9fa99`. Repos cloned at the pinned shas by `download.mjs`. Tokens are chars/4 estimates.
Arms: S = shipped find_files ranker (frozen LightGBM, ranker kind `frozen` on every query); G = Glob + Grep-style
sequence; R = `rg -c` TF-IDF; GG = `git grep -c`; `_src` = same arm with results narrowed to source files (the
sealed answers are source files only, so `_src` is the fair baseline).

Pooled (n = 300, 6 repos):

| arm | hit@1 | hit@5 | recall@5 | tool-output tok | + read top5 tok | ms/query (not load-clean) | calls |
|---|---|---|---|---|---|---|---|
| S | 60.3 [54.7, 65.7] | 89.7 [85.7, 92.6] | 72.2 [68.3, 76.4] | 770 | 6842 | 101 | 1.0 |
| G | 14.3 | 48.0 | 35.6 | 641 | 9434 | 222 | 4.9 |
| R | 17.0 | 59.3 | 44.3 | 32 | 9680 | 453 | 5.8 |
| GG | 15.7 | 57.0 | 43.0 | 31 | 9653 | 643 | 5.8 |
| G_src | 33.0 | 59.0 | 46.0 | 570 | 6300 | 216 | 4.8 |
| **R_src (strongest fair baseline)** | 40.0 [34.6, 45.6] | 71.3 [66.0, 76.2] | 55.6 [50.8, 60.4] | 35 | 6895 | 453 | 5.8 |
| GG_src | 37.0 | 68.7 | 53.2 | 35 | 6853 | 643 | 5.8 |

Paired S minus strongest fair baseline (R_src), percentage points:

| metric | S | R_src | diff | paired SE | repo-clustered SE (6 clusters) |
|---|---|---|---|---|---|
| hit@1 | 60.3 | 40.0 | +20.3 | 3.2 | 3.0 |
| hit@5 | 89.7 | 71.3 | +18.3 | 2.5 | 4.1 |
| recall@5 | 72.2 | 55.6 | +16.6 | 2.5 | 3.4 |

Per repo, hit@5, S vs R_src (n = 50 each): flask 94.0 vs 80.0 (+14.0, SE 5.0); sqlfluff 94.0 vs 82.0 (+12.0, SE 5.5);
express 94.0 vs 60.0 (+34.0, SE 6.8); gin 88.0 vs 70.0 (+18.0, SE 6.8); vite 84.0 vs 58.0 (+26.0, SE 6.3);
**excalidraw 84.0 vs 78.0 (+6.0, SE 5.3, not significant, under 2 SE).**

Losses and limits, in the table not hidden: S is slower in tool-output tokens than every grep arm
(770 vs 35 for R_src; the "+ read top5" column, which includes reading the five files, is lower for S: 6842 vs 6895,
a difference this run does not establish). Its ms/query is a warm in-process call and excludes the index build
(median build 650 ms on flask at the parent tree, 35 s to 203 s on sqlfluff per question). That the ranker was not
trained on these repos is an assumption this tree cannot prove (README in `tools/bench/data/findfiles-heldout/`).

## A2: what breaks if I change X (bench:closure)

Raw: `report/raw/bench-closure-2026-10-15.json`, rendered `report/raw/bench-closure-2026-10-15.md`.
30 seeded targets per repo, truth = the independent regex resolver T_ind at depth <= d. SEQ = one `impact` call over
Sequence's own graph, truncated to depth d. GREP = rg-based BFS over import statements (the number of calls is the
round trips). **The analyzer in this run includes the scanner fixes (Python `__init__` edges, library-repo scanning,
vite)**, so these numbers are not comparable with the v1 closure run. Caveat: GREP's recall is measured against a regex
resolver of the same family as the grep it runs, so its recall is near-circular; SEQ's precision of 100 % is
likewise measured against an edge set it is a subset of. Treat recall as the honest cross-check and call counts as the
real difference.

Pooled, all five repos, n = 150 targets:

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ minus GREP, pp (paired SE, clustered SE) | SEQ precision % | GREP precision % |
|---|---|---|---|---|---|---|
| <= 1 | 3.3 | 93.8 [90.0, 97.1] | 98.0 [95.7, 99.7] | **-4.2** (2.2, 2.9) n.s. | 100.0 | 80.6 [75.2, 85.6] |
| <= 2 | 28.2 | 89.2 [85.0, 93.1] | 94.0 [90.4, 97.0] | **-4.8** (2.9, 7.7) n.s. | 100.0 | 70.8 [65.3, 76.2] |
| <= 3 | 69.2 | 88.8 [84.6, 92.9] | 92.1 [88.4, 95.5] | **-3.3** (3.1, 9.1) n.s. | 100.0 | 72.2 [66.7, 77.5] |
| <= 4 | 99.9 | 88.6 [84.2, 92.9] | 91.9 [87.9, 95.6] | **-3.3** (3.2, 9.6) n.s. | 100.0 | 73.0 [67.3, 78.2] |

As shipped (unbounded closure) vs depth <= 4 truth: recall 90.2 [86.1, 94.1], precision 89.9 [85.9, 93.5], mean 148.7
files returned.

Cost per target (mean): SEQ 0.99 call, 3,298 tokens returned, 0.73 ms with the graph already scanned. GREP 108.1 calls
(median 10), 12,925 tokens of file lists, 403,474 further tokens if it reads every file it found, 7,752 ms
(not load-clean). No target hit the 1,500-call cap.

Depth <= 4 per repo (n = 30 each):

| repo | SEQ recall | GREP recall | diff pp (paired SE) | SEQ prec | GREP prec | GREP calls (mean) | scan coverage | edge Jaccard |
|---|---|---|---|---|---|---|---|---|
| flask | 87.6 | 96.7 | **-9.1** (5.5) n.s. | 100.0 | 86.3 | 42.8 | 1.000 | 0.909 |
| sqlfluff | 62.4 | 100.0 | **-37.6** (7.0) | 100.0 | 90.1 | 96.3 | 0.966 | 0.567 (flagged LOW AGREEMENT) |
| express | 99.8 | 84.5 | +15.4 (6.4) | 100.0 | 85.2 | 4.8 | 1.000 | 0.994 |
| vite | 96.6 | 95.1 | +1.5 (4.8) n.s. | 100.0 | 24.5 | 195.8 | 0.863 | 0.990 |
| excalidraw | 96.6 | 83.2 | +13.3 (7.3) n.s. | 100.0 | 77.8 | 200.6 | 0.994 | 0.996 |

Reading: Sequence does not beat grep BFS on recall in this run. It loses at every depth pooled (not significant under
the clustered SE) and **loses clearly on sqlfluff (-37.6 pp)**, where the scan graph and the independent resolver agree
on only 57 % of edges. Its wins are precision (100 % vs 71 to 81 % pooled; 24.5 % for grep on vite) and round trips
(about 1 call vs about 108). gin has no file-level closure and is A1 only.

Independence spot check (ten edges both graphs report, with the import line in the source file): all ten show a real
matching import line (flask 3, sqlfluff 3, express 2, vite 2). The earlier concern of a flask docstring false match
does not occur in this draw; `flask/sansio/scaffold.py -> typing.py` matches `from .. import typing as ft` (the
`import typing as t` line beside it is stdlib and is not the edge). See the table at the end of the rendered md.
Stale text: the three "Findings for the product" paragraphs at the end of the rendered md are static templates from
before the scanner fixes (finding 2 still says `src/sqlfluff` is never scanned while its own numbers show 460 of 476
files scanned); ignore them.

## A2 re-run after the Python package-load fix (2026-10-16, branch wip/019-sqlf)

The 2026-10-15 A2 section above is kept unchanged as the "before". This run is the same bench (seed 20261014, 30
targets per repo, same pinned shas, same independent resolver, nothing in `tools/bench` changed) against an analyzer
that now emits Python package-load edges and resolves Python imports across service roots. Raw:
`report/raw/bench-closure-2026-10-16.json` (sha256 `4ab9f959307dd8e9c4a8b600b5dd77a3a19b003b280a4775929638daaed74caf`),
rendered `report/raw/bench-closure-2026-10-16.md`. The wall times in it are not load-clean (Windows reports load 0.0).

What the missing edges were (scan graph vs `importgraph.mjs`, over files both parsed; Sequence's edges were a strict
subset of the independent graph on both repos, 0 extra edges):

| category (before) | flask | sqlfluff | example (import line) |
|---|---|---|---|
| package load: `import a.b.c` / `from a.b import x` also runs `a/__init__.py`, `a/b/__init__.py` | 10 | 1051 | `docsv/scripts/generate-cli-docs.py -> src/sqlfluff/__init__.py` from `from sqlfluff.cli.commands import cli`; `examples/tutorial/tests/test_auth.py -> flaskr/__init__.py` from `from flaskr.db import get_db` |
| mixed name: `from pkg import submodule` dropped the package itself; `from .. import typing` dropped `pkg/__init__.py` | 9 | 0 | `src/flask/sansio/blueprints.py -> src/flask/__init__.py` from `from .. import typing as ft`; `src/flask/helpers.py -> src/flask/__init__.py` from `from flask import stream_with_context, request, Response` |
| cross service root: `docsv/scripts` has its own manifest, so its file set holds no `src/sqlfluff` | 0 | 56 (41 package markers, 10 modules, 5 submodules via `from sqlfluff.api import info, simple`) | `docsv/scripts/generate-api-docs.py -> src/sqlfluff/core/__init__.py` from `from sqlfluff.core import Lexer, Linter, Parser` |
| total missing | 19 | 1107 | |
| **missing after** | **0** | **1** | `test/core/rules/rules_test.py -> test/__init__.py`: `from test.fixtures.rules.custom.L000 import ...` names a leaf that is not a scanned file, so the prefix packages are not loaded (see "not done") |
| Sequence-only edges after (not in the independent graph) | 13 | 9 | `src/flask/blueprints.py -> src/flask/__init__.py` from `from .sansio.blueprints import ...`: the independent resolver counts a relative import's own package marker only for `from . import x` |

Edge agreement (Jaccard over files both parsed): flask 0.909 -> 0.941, sqlfluff 0.567 -> 0.996 (the LOW AGREEMENT
flag is gone); express 0.994, vite 0.990, excalidraw 0.996 unchanged. Edges: sqlfluff 1449 -> 2564 (independent 2558),
flask 190 -> 222 (independent 209).

Depth <= 4 importer-closure recall, 30 targets per repo (before = 2026-10-15 run above; after = this run):

| repo | SEQ recall before | SEQ recall after | GREP recall | SEQ minus GREP before -> after, pp (paired SE) |
|---|---|---|---|---|
| flask | 87.6 [76.0, 96.2] | **100.0** [100.0, 100.0] | 96.7 | -9.1 (5.5) -> **+3.3** (2.3) |
| sqlfluff | 62.4 [48.7, 75.2] | **96.7** [90.0, 100.0] | 100.0 | -37.6 (7.0) -> **-3.3** (3.3), n.s. |
| express | 99.8 | 99.8 | 84.5 | +15.4 (6.4), unchanged |
| vite | 96.6 | 96.6 | 95.1 | +1.5 (4.8), unchanged |
| excalidraw | 96.6 | 96.6 | 83.2 | +13.3 (7.3), unchanged |
| pooled, 150 targets | 88.6 [84.2, 92.9] | **97.9** [95.3, 99.9] | 91.9 | -3.3 (clustered SE 9.6) -> **+6.0** (clustered SE 3.6) |

Pooled by depth, SEQ recall after: <=1 98.0, <=2 97.9, <=3 97.9, <=4 97.9 (GREP 98.0, 94.0, 92.1, 91.9). SEQ
precision against the independent truth is 99.7 % pooled (was 100.0): flask 98.6 and sqlfluff 100.0 at depth <= 4; the
drop is the 13 flask Sequence-only edges above, which are real imports the independent resolver does not count.

The one sqlfluff target still missed (1 of 30, so the 3.3 pp) is `test/fixtures/rules/custom/S000.py`, a test fixture
the scanner does not read by policy; it is not an import-resolution gap.

Decision on implicit parent loads: the independent resolver DOES count them (`import a.b.c` "binds a.b.c and loads
a, a.b"; `from x.y import n` loads x and x.y), so 1051 of sqlfluff's 1107 missing edges and 10 of flask's 19 were a
definition mismatch, not a resolver bug. Sequence now follows them: changing `pkg/__init__.py` does change every
importer, Python executes it, and "what breaks if I change X" is a closure over exactly that. They are `kind:
'import'` edges with `actor: 'import-package-load'`, confidence 1, and the real import line as evidence (note:
"executes <marker> (package load)"), so a consumer can tell them from a named import. They are kept OUT of PageRank
and clustering, so the package-marker hub artefact recorded in `py-import-resolution.test.ts` (550 of 969 ml-harness
edges on a marker, a two-line `__init__.py` ranking 8.5x above the real entry) does not return. A package-load edge is
never emitted where the file also names that marker, and never for a namespace directory without `__init__.py`.

Not done: a leaf that does not resolve to a scanned file does not load its prefix packages (`from test.fixtures...
import X` with the leaf unscanned; 1 edge on sqlfluff), because that would turn every import of an unscanned
third-party name that happens to share a top-level package name into an edge. Relative imports with several dots, parenthesised
multi-line `from . import (a, b)`, `import a.b as c`, try/except and in-function imports, and `TYPE_CHECKING` blocks
produced no miss on either repo: after the fix the only remaining miss is the one above.

## Tier C: Codex plain vs sequence (BLOCKED)

No scored head-to-head exists. What was done and what stopped it:

1. Clones for the sealed `arch-questions-v1.json` (36 questions, 3 repos x 12) were made at the commit current when the
   set was written: premai `47bbda49`, ml-harness `7020730e`, shopfront fixture from codeforge `a9477d8b5`
   (`ground-truth.json` removed from the clone because it sits in the agent's reach). All 36 labelled answer files exist in the clones.
2. Codex CLI `codex-cli 0.153.4`, entry `@openai/codex/bin/codex.js`, logged in via ChatGPT. The configured
   `gpt-6.1-sol` is rejected for ChatGPT accounts; the no-`-m` default behaves identically to `-m gpt-6-astra`
   (same token counts on a probe), so the smoke pinned `gpt-6-astra` (default reasoning, low).
3. Smoke, 3 questions per arm (`report/raw/agent-ab-codex-smoke-{plain,sequence}-2026-10-15.jsonl`): all six runs scored
   F1 0.00 with an empty file list. The model reported that every shell command was "blocked by policy":
   `CreateProcess ... Rejected ... blocked by policy`. Cause (likely, not proven): `run.mjs` passes
   `--ignore-user-config`, which drops the user's `[windows] sandbox = "elevated"`, and under `-s read-only` without
   it Codex on Windows refuses every command. Setting that one key per invocation
   (`-c windows.sandbox="elevated"`) was denied by the session's permission classifier as a safety-bypass flag, so
   I stopped. These six rows are an instrument failure, not a Sequence or Codex score. Smoke cost/time
   (useless as an estimate since no tools ran): 21 to 28 s and 66k to 396k input tokens per question.
4. Fairness flag for whoever resumes: the sealed arch set is NOT held-out under program rule 3 (shopfront is the
   Sequence analyzer fixture, ml-harness and premai are named tuning repos). It can be run as an indicative
   contaminated-in-Sequence's-favour set, n = 36 (below the n >= 30 per-claim bar once split by arm and repo), or
   replaced by a new sealed set on the qa-loop OSS repos (flask, express, ...), which does not exist yet.

To unblock: approve adding `-c windows.sandbox="elevated"` to `runCodex` in `tools/bench/agent-ab/run.mjs` (read-only
mode stays), or approve dropping `--ignore-user-config` (then the user's hooks, `node_repl` MCP server and
`~/.codex/AGENTS.md` load into both arms). Estimated cost once unblocked: 36 q x 2 arms x 2 runs = 144 Codex calls at
roughly 25 to 60 s each, about 1.5 to 2.5 hours sequential.

## Harness bugs found and fixed in this run (all Windows-only; all made the Tier A numbers wrong before the fix)

| bug | effect before | fix |
|---|---|---|
| `findfiles-bench.mjs` and `closure-bench.mjs` imported `C:\...` dist paths with bare `import()` | crash, ERR_UNSUPPORTED_ESM_URL_SCHEME | `pathToFileURL` |
| `closure-bench.mjs` main guard compared `import.meta.url` with `file://${argv[1]}` | `pnpm bench:closure` exited 0 having done nothing | `pathToFileURL(argv[1]).href` |
| rg prints `.\src\a.py` on Windows; the benches compare forward-slash paths | every rg arm scored 0 (G and R in A1; GREP recall 0.0 in A2 in a first run) | `posixRgPath` in `lib/findfiles-score.mjs`, locked by a test in `test/findfiles-score.test.mjs` |
| `git clone` of sqlfluff fails on Windows long paths | download aborts | run with `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.longpaths GIT_CONFIG_VALUE_0=true` (env only, no config written) |

The first A1 and A2 runs that showed those zeros were discarded and re-run after each fix; the numbers above are from the
fixed harness only. `pnpm bench:test`: 36 tests, 36 pass, exit 0 (restricted PATH plus the WinGet Links dir for `rg`).

## Commands

```
export PATH="/c/Program Files/nodejs:/mingw64/bin:/usr/bin:/c/Program Files/Git/cmd:/c/Windows/System32:/c/Windows:/c/Windows/System32/WindowsPowerShell/v1.0:/c/Users/dev/AppData/Local/Programs/Python/Python313:/c/Users/dev/AppData/Local/Microsoft/WinGet/Links"
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.longpaths GIT_CONFIG_VALUE_0=true
export SEQUENCE_BENCH_CACHE=<scratchpad>/benchcache
pnpm install --frozen-lockfile && pnpm -r build
node tools/bench/data/findfiles-heldout/download.mjs
pnpm bench:findfiles      # 2026-10-15 08:54 to 09:30 EDT
pnpm bench:closure        # 09:34 to 09:54 EDT
pnpm bench:test           # exit 0, 36/36
# Tier C smoke (instrument failure, see above); claude was not resolvable in that shell (which claude fails):
CODEX_JS=C:/Users/dev/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js \
node tools/bench/agent-ab/run.mjs --questions tools/bench/agent-ab/sets/arch-questions-v1.json \
  --repos <scratchpad>/repos.json --agent codex --arm plain|sequence --model gpt-6-astra --limit 3 --out <file>
```

## Raw files (sha256)

```
5ca0447abeff6f43d76e16d59c776f5bb776683f696d28936e4607b17c4d1f2f  report/raw/bench-findfiles-2026-10-15.json
dfba192cbd0b0c00ea4d7db8db0aecb2b69ffc8d9149c04f7c27c7e27492cc7f  report/raw/bench-closure-2026-10-15.json
ed1d11d52e9f9edcf56ff753d044c4046e686195a2626180f61521dfe94bfd79  report/raw/bench-findfiles-2026-10-15.md
70269b581ca167809672d90031c39308e97e5563d57566aa50bc316912fefa78  report/raw/bench-closure-2026-10-15.md
4ab9f959307dd8e9c4a8b600b5dd77a3a19b003b280a4775929638daaed74caf  report/raw/bench-closure-2026-10-16.json
ddf437b906302e29f61dccf4c28bf04202ceb28b7c80c73bee15290c5f61682b  report/raw/bench-closure-2026-10-16.md
3a826cad8ce7126ab04f21aab6c0509592ec3e62e08a62ae18dc3aea56bb2a2c  report/raw/agent-ab-codex-smoke-plain-2026-10-15.jsonl
ff1c8026162ec185f1fa4b65ba991cc6818ed9142cfb8bf6477d7acf9372e2a2  report/raw/agent-ab-codex-smoke-sequence-2026-10-15.jsonl
```

The harness files were edited after these runs only to move the (tested, behaviour-identical) path normalisation into
`posixRgPath` (covered by the test). A 6-question flask smoke after that edit ran without error and scored S and
R_src hit@5 100.0 each; it was not compared row by row with the full run, and its partial output was deleted.
