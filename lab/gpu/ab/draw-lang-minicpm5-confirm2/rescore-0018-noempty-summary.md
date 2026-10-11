# Draw-language A/B: answers on disk on shopfront.scan.json

7 question(s) × 3 language(s), runs 6; max_tokens 400, slice 40 parts, temperature 0. Scored from 126 answer file(s) in C:\Users\<user>\Projects\seq-ab\out\draw-lang-gpu-confirm2\answers.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 42 | 71% | 38% | 100% | 0.15 | 355 | — | — |
| dot | 42 | 86% | 83% | 100% | 0.51 | 189 | — | — |
| path | 42 | 88% | 88% | 100% | 0.28 | 106 | — | — |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 6 | 42 | 71% ± 9% | 38% ± 22% | 0.15 ± 0.11 | 374 ± 52 |
| dot | 6 | 42 | 86% ± 9% | 83% ± 11% | 0.51 ± 0.09 | 224 ± 34 |
| path | 6 | 42 | 88% ± 11% | 88% ± 11% | 0.28 ± 0.07 | 128 ± 36 |

Grounded answers per question (of runs):

| question | json | dot | path |
|---|---|---|---|
| card-charge-every-way | 2/6 | 4/6 | 6/6 |
| gateway-fanout | 2/6 | 6/6 | 4/6 |
| order-notify | 3/6 | 6/6 | 6/6 |
| invoice-and-charge | 2/6 | 3/6 | 5/6 |
| postgres-sharers | 2/6 | 6/6 | 5/6 |
| shipping-two-triggers | 4/6 | 6/6 | 6/6 |
| orders-main-fanout | 1/6 | 4/6 | 5/6 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| dot | 119 | 491 |
| path | 96 | 326 |

Out tok: a word-and-punctuation count (no usage field). Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
