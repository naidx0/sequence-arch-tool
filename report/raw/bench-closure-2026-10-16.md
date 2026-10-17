# bench:closure 2026-10-16

Seed 20261014, 30 targets per repo. Load average: start 0.0, max 0.0, end 0.0 on 16 cpus (wall times are load-dependent and not a benchmark result unless the load stayed under 2). Truth for recall is the INDEPENDENT regex resolver (T_ind). SEQ answers are truncated to depth d over Sequence's own graph; the unbounded as-shipped closure is shown separately. Every repo is pooled; agreement is a per-repo diagnostic. Tokens are bytes/4 estimates. 95 % bootstrap CIs over targets; the SE of the pooled SEQ−GREP difference is repo-clustered (CR1).

## Agreement and coverage: Sequence scan graph vs independent resolver (diagnostic, not a filter)

| repo | lang | scan coverage (scanned / source files) | indep edges | seq edges | both | edge Jaccard (files both parsed) | edge Jaccard (full indep universe) | seq covers indep (both parsed / full) | per-target Seq recall of indep, depth<=4 | targets absent from scan graph | flag |
|---|---|---|---|---|---|---|---|---|---|---|---|
| flask | python | 1.000 (83 / 83) | 209 (209 among scanned files) | 222 | 209 | 0.941 | 0.941 | 1.000 / 1.000 | 1.000 | 0/30 |  |
| sqlfluff | python | 0.966 (460 / 476) | 2558 (2556 among scanned files) | 2564 | 2555 | 0.996 | 0.995 | 1.000 / 0.999 | 0.967 | 1/30 |  |
| express | js | 1.000 (141 / 141) | 154 (154 among scanned files) | 153 | 153 | 0.994 | 0.994 | 0.994 / 0.994 | 0.998 | 0/30 |  |
| vite | js | 0.863 (1349 / 1564) | 1951 (1732 among scanned files) | 1717 | 1716 | 0.990 | 0.879 | 0.991 / 0.880 | 0.966 | 1/30 |  |
| excalidraw | js | 0.994 (693 / 697) | 3666 (3655 among scanned files) | 3642 | 3642 | 0.996 | 0.993 | 0.996 / 0.993 | 0.966 | 0/30 |  |

## Pooled, ALL repos (headline) (n=150 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE, clustered SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 3.3 | 98.0 [95.3, 100.0] | 98.0 [95.7, 99.7] | -0.0 (1.6, 1.5) n.s. | 99.6 [99.1, 100.0] | 80.6 [75.2, 85.6] | 97.8 [95.4, 99.7] |
| <=2 | 28.2 | 97.9 [95.2, 99.9] | 94.0 [90.4, 97.0] | 3.9 (2.1, 2.0) n.s. | 99.5 [98.9, 99.8] | 70.8 [65.3, 76.2] | 93.5 [89.9, 96.7] |
| <=3 | 69.2 | 97.9 [95.3, 99.9] | 92.1 [88.4, 95.5] | 5.8 (2.3, 3.4) n.s. | 99.7 [99.2, 100.0] | 72.2 [66.7, 77.5] | 91.7 [87.7, 95.4] |
| <=4 | 99.9 | 97.9 [95.3, 99.9] | 91.9 [87.9, 95.6] | 6.0 (2.4, 3.6) n.s. | 99.7 [99.2, 100.0] | 73.0 [67.3, 78.2] | 91.4 [87.2, 95.2] |

As shipped, the impact call returns the unbounded closure: recall 97.9 [95.3, 100.0] / precision 90.0 [86.5, 93.5] against the depth<=4 truth (mean returned 149.6 files).

Cost per target (mean): SEQ 0.99 call, 3329 tokens back, 0.89 ms (graph already scanned; load-dependent). GREP 108.1 calls (median 10), 12925 tokens of file lists back, plus 403474 tokens if it reads every file it found, 9870 ms (load-dependent); 0 target(s) hit the 1500-call cap.

Scan time for flask: 766 ms (cold, one-off; the SEQ arm assumes the graph is held).

## flask (n=30 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 3.5 | 100.0 [100.0, 100.0] | 96.7 [91.7, 100.0] | 3.3 (2.3) n.s. | 98.2 [95.5, 100.0] | 77.9 [66.2, 88.6] | 95.7 [90.7, 100.0] |
| <=2 | 20.8 | 100.0 [100.0, 100.0] | 96.1 [91.2, 99.6] | 3.9 (2.3) n.s. | 97.3 [95.0, 99.2] | 71.5 [59.4, 82.8] | 94.3 [89.4, 98.4] |
| <=3 | 35.3 | 100.0 [100.0, 100.0] | 96.7 [91.7, 100.0] | 3.3 (2.3) n.s. | 98.4 [96.1, 99.9] | 83.3 [72.6, 92.9] | 95.2 [90.2, 99.5] |
| <=4 | 38.4 | 100.0 [100.0, 100.0] | 96.7 [91.7, 100.0] | 3.3 (2.3) n.s. | 98.6 [96.2, 100.0] | 86.3 [76.2, 94.9] | 95.2 [90.2, 99.5] |

As shipped, the impact call returns the unbounded closure: recall 100.0 [100.0, 100.0] / precision 98.3 [95.9, 100.0] against the depth<=4 truth (mean returned 38.7 files).

Cost per target (mean): SEQ 1.00 call, 588 tokens back, 0.17 ms (graph already scanned; load-dependent). GREP 42.8 calls (median 72), 1375 tokens of file lists back, plus 80690 tokens if it reads every file it found, 2717 ms (load-dependent); 0 target(s) hit the 1500-call cap.

Scan time for sqlfluff: 5378 ms (cold, one-off; the SEQ arm assumes the graph is held).

## sqlfluff (n=30 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 2.0 | 96.7 [90.0, 100.0] | 100.0 [100.0, 100.0] | -3.3 (3.3) n.s. | 100.0 [100.0, 100.0] | 92.8 [84.2, 100.0] | 100.0 [100.0, 100.0] |
| <=2 | 13.4 | 96.7 [90.0, 100.0] | 100.0 [100.0, 100.0] | -3.3 (3.3) n.s. | 100.0 [100.0, 100.0] | 82.3 [70.9, 92.6] | 100.0 [100.0, 100.0] |
| <=3 | 47.2 | 96.7 [90.0, 100.0] | 100.0 [100.0, 100.0] | -3.3 (3.3) n.s. | 100.0 [100.0, 100.0] | 83.4 [72.5, 93.3] | 100.0 [100.0, 100.0] |
| <=4 | 82.8 | 96.7 [90.0, 100.0] | 100.0 [100.0, 100.0] | -3.3 (3.3) n.s. | 100.0 [100.0, 100.0] | 90.1 [80.8, 97.6] | 100.0 [100.0, 100.0] |

As shipped, the impact call returns the unbounded closure: recall 96.7 [90.0, 100.0] / precision 97.1 [93.3, 99.2] against the depth<=4 truth (mean returned 92.8 files).

Cost per target (mean): SEQ 0.97 call, 1972 tokens back, 0.98 ms (graph already scanned; load-dependent). GREP 96.3 calls (median 3), 9466 tokens of file lists back, plus 449123 tokens if it reads every file it found, 6636 ms (load-dependent); 0 target(s) hit the 1500-call cap.

Scan time for express: 685 ms (cold, one-off; the SEQ arm assumes the graph is held).

## express (n=30 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 4.9 | 100.0 [99.9, 100.0] | 96.7 [90.0, 100.0] | 3.3 (3.3) n.s. | 100.0 [100.0, 100.0] | 85.3 [76.9, 93.0] | 96.7 [90.0, 100.0] |
| <=2 | 9.1 | 99.9 [99.8, 100.0] | 93.5 [83.7, 100.0] | 6.4 (4.5) n.s. | 100.0 [100.0, 100.0] | 84.3 [75.0, 92.6] | 93.5 [83.6, 100.0] |
| <=3 | 13.2 | 99.9 [99.6, 100.0] | 90.3 [77.6, 100.0] | 9.6 (5.3) n.s. | 100.0 [100.0, 100.0] | 83.6 [73.4, 92.3] | 90.3 [77.6, 100.0] |
| <=4 | 20.1 | 99.8 [99.5, 100.0] | 84.5 [71.5, 96.7] | 15.4 (6.4)  | 100.0 [100.0, 100.0] | 85.2 [75.5, 93.8] | 84.4 [71.4, 96.7] |

As shipped, the impact call returns the unbounded closure: recall 99.8 [99.5, 100.0] / precision 99.1 [97.6, 100.0] against the depth<=4 truth (mean returned 21.1 files).

Cost per target (mean): SEQ 1.00 call, 262 tokens back, 0.06 ms (graph already scanned; load-dependent). GREP 4.8 calls (median 3), 47 tokens of file lists back, plus 5757 tokens if it reads every file it found, 167 ms (load-dependent); 0 target(s) hit the 1500-call cap.

Scan time for vite: 3283 ms (cold, one-off; the SEQ arm assumes the graph is held).

## vite (n=30 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 3.3 | 96.7 [90.0, 100.0] | 96.7 [90.0, 100.0] | 0.0 (4.8) n.s. | 100.0 [100.0, 100.0] | 65.7 [50.1, 80.8] | 96.6 [89.7, 100.0] |
| <=2 | 21.2 | 96.3 [89.4, 100.0] | 92.5 [83.8, 98.2] | 3.9 (5.2) n.s. | 100.0 [100.0, 100.0] | 37.7 [25.9, 50.1] | 92.2 [83.5, 98.2] |
| <=3 | 51.6 | 96.6 [89.9, 100.0] | 94.0 [86.3, 98.3] | 2.6 (4.9) n.s. | 100.0 [100.0, 100.0] | 29.0 [18.5, 39.6] | 93.8 [85.9, 98.3] |
| <=4 | 62.6 | 96.6 [89.9, 100.0] | 95.1 [88.0, 98.9] | 1.5 (4.8) n.s. | 100.0 [100.0, 100.0] | 24.5 [14.6, 34.8] | 94.9 [87.7, 98.9] |

As shipped, the impact call returns the unbounded closure: recall 96.6 [89.9, 100.0] / precision 99.3 [98.6, 99.9] against the depth<=4 truth (mean returned 63.5 files).

Cost per target (mean): SEQ 0.97 call, 1559 tokens back, 0.78 ms (graph already scanned; load-dependent). GREP 195.8 calls (median 109), 25078 tokens of file lists back, plus 453218 tokens if it reads every file it found, 19737 ms (load-dependent); 0 target(s) hit the 1500-call cap.

Scan time for excalidraw: 5051 ms (cold, one-off; the SEQ arm assumes the graph is held).

## excalidraw (n=30 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 2.9 | 96.7 [90.0, 100.0] | 100.0 [100.0, 100.0] | -3.3 (3.3) n.s. | 100.0 [100.0, 100.0] | 80.8 [67.9, 93.6] | 100.0 [100.0, 100.0] |
| <=2 | 76.4 | 96.6 [89.9, 100.0] | 87.8 [75.9, 97.3] | 8.8 (6.8) n.s. | 100.0 [100.0, 100.0] | 77.7 [68.3, 86.7] | 87.3 [74.3, 97.6] |
| <=3 | 198.8 | 96.6 [89.9, 99.9] | 79.7 [66.9, 90.8] | 16.9 (7.4)  | 100.0 [100.0, 100.0] | 80.7 [72.5, 87.9] | 79.0 [65.8, 90.7] |
| <=4 | 295.6 | 96.6 [89.9, 99.9] | 83.2 [70.8, 94.1] | 13.3 (7.3) n.s. | 100.0 [100.0, 100.0] | 77.8 [70.5, 84.5] | 82.7 [69.8, 93.9] |

As shipped, the impact call returns the unbounded closure: recall 96.6 [89.9, 100.0] / precision 55.5 [44.5, 66.4] against the depth<=4 truth (mean returned 531.8 files).

Cost per target (mean): SEQ 1.00 call, 12263 tokens back, 2.44 ms (graph already scanned; load-dependent). GREP 200.6 calls (median 107), 28658 tokens of file lists back, plus 1028580 tokens if it reads every file it found, 20095 ms (load-dependent); 0 target(s) hit the 1500-call cap.

## Independence spot check (F14): ten edges BOTH graphs report, with the import line in the source file

| repo | importer | imported | matching import line(s) |
|---|---|---|---|
| flask | src/flask/__init__.py | src/flask/templating.py | `34: from .templating import render_template as render_template`<br>`35: from .templating import render_template_string as render_template_string`<br>`36: from .templating import stream_template as stream_template` |
| flask | src/flask/sansio/scaffold.py | src/flask/templating.py | `19: from ..templating import _default_template_ctx_processor` |
| flask | tests/test_blueprints.py | src/flask/__init__.py | `4: import flask` |
| sqlfluff | src/sqlfluff/core/linter/linter.py | src/sqlfluff/core/errors.py | `14: from sqlfluff.core.errors import (`<br>`344: """Filter a list of lint errors, removing those from the templated slices."""` |
| sqlfluff | src/sqlfluff/dialects/dialect_bigquery.py | src/sqlfluff/dialects/dialect_ansi.py | `42: from sqlfluff.dialects import dialect_ansi as ansi` |
| sqlfluff | src/sqlfluff/rules/postgres/__init__.py | src/sqlfluff/rules/postgres/PG01.py | `20: from sqlfluff.rules.postgres.PG01 import Rule_PG01` |
| express | test/Route.js | index.js | `5: var express = require('../')`<br>`7: , methods = require('../lib/utils').methods` |
| express | test/middleware.basic.js | index.js | `4: var express = require('../');` |
| vite | packages/vite/src/node/plugins/wasm.ts | packages/vite/src/shared/utils.ts | `3: import { cleanUrl } from '../../shared/utils'` |
| vite | playground/css-no-codesplit/index.js | playground/css-no-codesplit/async-js.js | `1: import('./async-js')` |

## Findings for the product (what this run exposed)

1. **Python `from pkg import name` and `from . import module` edges are missing.** flask: Sequence reports 222 import edges, the independent resolver 209; Sequence is a strict subset (nothing it reports is absent from the independent graph). Missing: edges into `src/flask/__init__.py` (`from flask import x`) and `from . import typing as ft`-style sibling-module imports. Per-target Seq recall of the independent depth<=4 closure is 1.00.
2. **The scanner is service-shaped and skips library packages.** sqlfluff: 460 of 476 Python source files scanned (only docs scripts; `src/sqlfluff` is never scanned), so every one of 30 targets is absent from the graph and the impact call has nothing to answer from.
3. **vite (TypeScript monorepo): 0.97 per-target recall of the independent closure** (edge Jaccard 0.990 over scanned files, scan coverage 0.863). The missing edges are not diagnosed here; see the vite table.
