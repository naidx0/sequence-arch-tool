# bench:closure 2026-10-15

Seed 20261014, 30 targets per repo. Load average: start 0.0, max 0.0, end 0.0 on 16 cpus (wall times are load-dependent and not a benchmark result unless the load stayed under 2). Truth for recall is the INDEPENDENT regex resolver (T_ind). SEQ answers are truncated to depth d over Sequence's own graph; the unbounded as-shipped closure is shown separately. Every repo is pooled; agreement is a per-repo diagnostic. Tokens are bytes/4 estimates. 95 % bootstrap CIs over targets; the SE of the pooled SEQ−GREP difference is repo-clustered (CR1).

## Agreement and coverage: Sequence scan graph vs independent resolver (diagnostic, not a filter)

| repo | lang | scan coverage (scanned / source files) | indep edges | seq edges | both | edge Jaccard (files both parsed) | edge Jaccard (full indep universe) | seq covers indep (both parsed / full) | per-target Seq recall of indep, depth<=4 | targets absent from scan graph | flag |
|---|---|---|---|---|---|---|---|---|---|---|---|
| flask | python | 1.000 (83 / 83) | 209 (209 among scanned files) | 190 | 190 | 0.909 | 0.909 | 0.909 / 0.909 | 0.876 | 0/30 |  |
| sqlfluff | python | 0.966 (460 / 476) | 2558 (2556 among scanned files) | 1449 | 1449 | 0.567 | 0.566 | 0.567 / 0.566 | 0.624 | 1/30 | LOW AGREEMENT (graphs differ; still pooled) |
| express | js | 1.000 (141 / 141) | 154 (154 among scanned files) | 153 | 153 | 0.994 | 0.994 | 0.994 / 0.994 | 0.998 | 0/30 |  |
| vite | js | 0.863 (1349 / 1564) | 1951 (1732 among scanned files) | 1717 | 1716 | 0.990 | 0.879 | 0.991 / 0.880 | 0.966 | 1/30 |  |
| excalidraw | js | 0.994 (693 / 697) | 3666 (3655 among scanned files) | 3642 | 3642 | 0.996 | 0.993 | 0.996 / 0.993 | 0.966 | 0/30 |  |

## Pooled, ALL repos (headline) (n=150 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE, clustered SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 3.3 | 93.8 [90.0, 97.1] | 98.0 [95.7, 99.7] | -4.2 (2.2, 2.9) n.s. | 100.0 [100.0, 100.0] | 80.6 [75.2, 85.6] | 98.2 [96.1, 100.0] |
| <=2 | 28.2 | 89.2 [85.0, 93.1] | 94.0 [90.4, 97.0] | -4.8 (2.9, 7.7) n.s. | 100.0 [100.0, 100.0] | 70.8 [65.3, 76.2] | 94.1 [90.3, 97.4] |
| <=3 | 69.2 | 88.8 [84.6, 92.9] | 92.1 [88.4, 95.5] | -3.3 (3.1, 9.1) n.s. | 100.0 [100.0, 100.0] | 72.2 [66.7, 77.5] | 92.0 [88.0, 95.6] |
| <=4 | 99.9 | 88.6 [84.2, 92.9] | 91.9 [87.9, 95.6] | -3.3 (3.2, 9.6) n.s. | 100.0 [100.0, 100.0] | 73.0 [67.3, 78.2] | 91.8 [87.6, 95.7] |

As shipped, the impact call returns the unbounded closure: recall 90.2 [86.1, 94.1] / precision 89.9 [85.9, 93.5] against the depth<=4 truth (mean returned 148.7 files).

Cost per target (mean): SEQ 0.99 call, 3298 tokens back, 0.73 ms (graph already scanned; load-dependent). GREP 108.1 calls (median 10), 12925 tokens of file lists back, plus 403474 tokens if it reads every file it found, 7752 ms (load-dependent); 0 target(s) hit the 1500-call cap.

Scan time for flask: 740 ms (cold, one-off; the SEQ arm assumes the graph is held).

## flask (n=30 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 3.5 | 89.1 [78.0, 97.8] | 96.7 [91.7, 100.0] | -7.6 (5.3) n.s. | 100.0 [100.0, 100.0] | 77.9 [66.2, 88.6] | 98.2 [94.6, 100.0] |
| <=2 | 20.8 | 85.3 [74.5, 94.0] | 96.1 [91.2, 99.6] | -10.8 (5.4) n.s. | 100.0 [100.0, 100.0] | 71.5 [59.4, 82.8] | 98.2 [94.6, 100.0] |
| <=3 | 35.3 | 86.0 [74.8, 94.6] | 96.7 [91.7, 100.0] | -10.7 (5.4) n.s. | 100.0 [100.0, 100.0] | 83.3 [72.6, 92.9] | 98.2 [94.6, 100.0] |
| <=4 | 38.4 | 87.6 [76.0, 96.2] | 96.7 [91.7, 100.0] | -9.1 (5.5) n.s. | 100.0 [100.0, 100.0] | 86.3 [76.2, 94.9] | 98.2 [94.6, 100.0] |

As shipped, the impact call returns the unbounded closure: recall 88.0 [76.3, 96.7] / precision 99.7 [99.1, 100.0] against the depth<=4 truth (mean returned 38.2 files).

Cost per target (mean): SEQ 1.00 call, 574 tokens back, 0.20 ms (graph already scanned; load-dependent). GREP 42.8 calls (median 72), 1375 tokens of file lists back, plus 80690 tokens if it reads every file it found, 2377 ms (load-dependent); 0 target(s) hit the 1500-call cap.

Scan time for sqlfluff: 4445 ms (cold, one-off; the SEQ arm assumes the graph is held).

## sqlfluff (n=30 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 2.0 | 86.7 [73.3, 96.7] | 100.0 [100.0, 100.0] | -13.3 (6.3)  | 100.0 [100.0, 100.0] | 92.8 [84.2, 100.0] | 100.0 [100.0, 100.0] |
| <=2 | 13.4 | 67.7 [54.3, 80.4] | 100.0 [100.0, 100.0] | -32.3 (6.8)  | 100.0 [100.0, 100.0] | 82.3 [70.9, 92.6] | 100.0 [100.0, 100.0] |
| <=3 | 47.2 | 65.1 [51.6, 77.5] | 100.0 [100.0, 100.0] | -34.9 (6.8)  | 100.0 [100.0, 100.0] | 83.4 [72.5, 93.3] | 100.0 [100.0, 100.0] |
| <=4 | 82.8 | 62.4 [48.7, 75.2] | 100.0 [100.0, 100.0] | -37.6 (7.0)  | 100.0 [100.0, 100.0] | 90.1 [80.8, 97.6] | 100.0 [100.0, 100.0] |

As shipped, the impact call returns the unbounded closure: recall 70.0 [56.5, 83.3] / precision 96.8 [93.1, 99.2] against the depth<=4 truth (mean returned 88.9 files).

Cost per target (mean): SEQ 0.97 call, 1831 tokens back, 0.62 ms (graph already scanned; load-dependent). GREP 96.3 calls (median 3), 9466 tokens of file lists back, plus 449123 tokens if it reads every file it found, 7445 ms (load-dependent); 0 target(s) hit the 1500-call cap.

Scan time for express: 765 ms (cold, one-off; the SEQ arm assumes the graph is held).

## express (n=30 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 4.9 | 100.0 [99.9, 100.0] | 96.7 [90.0, 100.0] | 3.3 (3.3) n.s. | 100.0 [100.0, 100.0] | 85.3 [76.9, 93.0] | 96.7 [90.0, 100.0] |
| <=2 | 9.1 | 99.9 [99.8, 100.0] | 93.5 [83.7, 100.0] | 6.4 (4.5) n.s. | 100.0 [100.0, 100.0] | 84.3 [75.0, 92.6] | 93.5 [83.6, 100.0] |
| <=3 | 13.2 | 99.9 [99.6, 100.0] | 90.3 [77.6, 100.0] | 9.6 (5.3) n.s. | 100.0 [100.0, 100.0] | 83.6 [73.4, 92.3] | 90.3 [77.6, 100.0] |
| <=4 | 20.1 | 99.8 [99.5, 100.0] | 84.5 [71.5, 96.7] | 15.4 (6.4)  | 100.0 [100.0, 100.0] | 85.2 [75.5, 93.8] | 84.4 [71.4, 96.7] |

As shipped, the impact call returns the unbounded closure: recall 99.8 [99.5, 100.0] / precision 99.1 [97.6, 100.0] against the depth<=4 truth (mean returned 21.1 files).

Cost per target (mean): SEQ 1.00 call, 262 tokens back, 0.09 ms (graph already scanned; load-dependent). GREP 4.8 calls (median 3), 47 tokens of file lists back, plus 5757 tokens if it reads every file it found, 280 ms (load-dependent); 0 target(s) hit the 1500-call cap.

Scan time for vite: 3635 ms (cold, one-off; the SEQ arm assumes the graph is held).

## vite (n=30 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 3.3 | 96.7 [90.0, 100.0] | 96.7 [90.0, 100.0] | 0.0 (4.8) n.s. | 100.0 [100.0, 100.0] | 65.7 [50.1, 80.8] | 96.6 [89.7, 100.0] |
| <=2 | 21.2 | 96.3 [89.4, 100.0] | 92.5 [83.8, 98.2] | 3.9 (5.2) n.s. | 100.0 [100.0, 100.0] | 37.7 [25.9, 50.1] | 92.2 [83.5, 98.2] |
| <=3 | 51.6 | 96.6 [89.9, 100.0] | 94.0 [86.3, 98.3] | 2.6 (4.9) n.s. | 100.0 [100.0, 100.0] | 29.0 [18.5, 39.6] | 93.8 [85.9, 98.3] |
| <=4 | 62.6 | 96.6 [89.9, 100.0] | 95.1 [88.0, 98.9] | 1.5 (4.8) n.s. | 100.0 [100.0, 100.0] | 24.5 [14.6, 34.8] | 94.9 [87.7, 98.9] |

As shipped, the impact call returns the unbounded closure: recall 96.6 [89.9, 100.0] / precision 99.3 [98.6, 99.9] against the depth<=4 truth (mean returned 63.5 files).

Cost per target (mean): SEQ 0.97 call, 1559 tokens back, 0.70 ms (graph already scanned; load-dependent). GREP 195.8 calls (median 109), 25078 tokens of file lists back, plus 453218 tokens if it reads every file it found, 15852 ms (load-dependent); 0 target(s) hit the 1500-call cap.

Scan time for excalidraw: 4447 ms (cold, one-off; the SEQ arm assumes the graph is held).

## excalidraw (n=30 targets)

| depth | mean truth size | SEQ recall % | GREP recall % | SEQ − GREP recall, pp (paired SE) | SEQ precision % | GREP precision % | GREP recall vs Seq-graph truth % |
|---|---|---|---|---|---|---|---|
| <=1 | 2.9 | 96.7 [90.0, 100.0] | 100.0 [100.0, 100.0] | -3.3 (3.3) n.s. | 100.0 [100.0, 100.0] | 80.8 [67.9, 93.6] | 100.0 [100.0, 100.0] |
| <=2 | 76.4 | 96.6 [89.9, 100.0] | 87.8 [75.9, 97.3] | 8.8 (6.8) n.s. | 100.0 [100.0, 100.0] | 77.7 [68.3, 86.7] | 87.3 [74.3, 97.6] |
| <=3 | 198.8 | 96.6 [89.9, 99.9] | 79.7 [66.9, 90.8] | 16.9 (7.4)  | 100.0 [100.0, 100.0] | 80.7 [72.5, 87.9] | 79.0 [65.8, 90.7] |
| <=4 | 295.6 | 96.6 [89.9, 99.9] | 83.2 [70.8, 94.1] | 13.3 (7.3) n.s. | 100.0 [100.0, 100.0] | 77.8 [70.5, 84.5] | 82.7 [69.8, 93.9] |

As shipped, the impact call returns the unbounded closure: recall 96.6 [89.9, 100.0] / precision 55.5 [44.5, 66.4] against the depth<=4 truth (mean returned 531.8 files).

Cost per target (mean): SEQ 1.00 call, 12263 tokens back, 2.04 ms (graph already scanned; load-dependent). GREP 200.6 calls (median 107), 28658 tokens of file lists back, plus 1028580 tokens if it reads every file it found, 12808 ms (load-dependent); 0 target(s) hit the 1500-call cap.

## Independence spot check (F14): ten edges BOTH graphs report, with the import line in the source file

| repo | importer | imported | matching import line(s) |
|---|---|---|---|
| flask | src/flask/__init__.py | src/flask/templating.py | `34: from .templating import render_template as render_template`<br>`35: from .templating import render_template_string as render_template_string`<br>`36: from .templating import stream_template as stream_template` |
| flask | src/flask/sansio/scaffold.py | src/flask/typing.py | `7: import typing as t`<br>`17: from .. import typing as ft` |
| flask | tests/test_basic.py | src/flask/testing.py | `25: from flask.testing import FlaskClient` |
| sqlfluff | src/sqlfluff/core/linter/linter.py | src/sqlfluff/core/parser/segments/base.py | `41: from sqlfluff.core.parser.segments.base import BaseSegment, SourceFix`<br>`42: from sqlfluff.core.rules import BaseRule, RulePack, get_ruleset` |
| sqlfluff | src/sqlfluff/dialects/dialect_db2.py | src/sqlfluff/core/dialects/__init__.py | `6: from sqlfluff.core.dialects import load_raw_dialect`<br>`32: from sqlfluff.dialects import dialect_ansi as ansi`<br>`33: from sqlfluff.dialects.dialect_db2_keywords import UNRESERVED_KEYWORDS` |
| sqlfluff | src/sqlfluff/rules/references/RF01.py | src/sqlfluff/core/parser/__init__.py | `15: from sqlfluff.core.parser import BaseSegment` |
| express | test/Route.js | index.js | `5: var express = require('../')`<br>`7: , methods = require('../lib/utils').methods` |
| express | test/middleware.basic.js | index.js | `4: var express = require('../');` |
| vite | packages/vite/src/node/plugins/wasm.ts | packages/vite/src/shared/utils.ts | `3: import { cleanUrl } from '../../shared/utils'` |
| vite | playground/css-no-codesplit/index.js | playground/css-no-codesplit/async-js.js | `1: import('./async-js')` |

## Findings for the product (what this run exposed)

1. **Python `from pkg import name` and `from . import module` edges are missing.** flask: Sequence reports 190 import edges, the independent resolver 209; Sequence is a strict subset (nothing it reports is absent from the independent graph). Missing: edges into `src/flask/__init__.py` (`from flask import x`) and `from . import typing as ft`-style sibling-module imports. Per-target Seq recall of the independent depth<=4 closure is 0.88.
2. **The scanner is service-shaped and skips library packages.** sqlfluff: 460 of 476 Python source files scanned (only docs scripts; `src/sqlfluff` is never scanned), so every one of 30 targets is absent from the graph and the impact call has nothing to answer from.
3. **vite (TypeScript monorepo): 0.97 per-target recall of the independent closure** (edge Jaccard 0.990 over scanned files, scan coverage 0.863). The missing edges are not diagnosed here; see the vite table.
