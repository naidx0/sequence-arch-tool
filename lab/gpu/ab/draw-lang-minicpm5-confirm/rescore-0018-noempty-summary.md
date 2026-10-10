# Draw-language A/B: answers on disk on shopfront.scan.json

7 question(s) × 3 language(s), runs 6; max_tokens 400, slice 40 parts, temperature 0. Scored from 126 answer file(s) in C:\Users\<user>\Projects\seq-ab\out\draw-lang-gpu-confirm\answers.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 42 | 81% | 43% | 98% | 0.16 | 316 | — | — |
| dot | 42 | 81% | 76% | 100% | 0.48 | 254 | — | — |
| path | 42 | 86% | 83% | 100% | 0.30 | 79 | — | — |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 6 | 42 | 81% ± 7% | 43% ± 9% | 0.16 ± 0.07 | 344 ± 50 |
| dot | 6 | 42 | 81% ± 7% | 76% ± 7% | 0.48 ± 0.11 | 254 ± 27 |
| path | 6 | 42 | 86% ± 16% | 83% ± 17% | 0.30 ± 0.10 | 129 ± 16 |

Grounded answers per question (of runs):

| question | json | dot | path |
|---|---|---|---|
| card-charge-every-way | 5/6 | 6/6 | 6/6 |
| gateway-fanout | 3/6 | 4/6 | 4/6 |
| order-notify | 3/6 | 6/6 | 6/6 |
| invoice-and-charge | 0/6 | 5/6 | 6/6 |
| postgres-sharers | 0/6 | 4/6 | 4/6 |
| shipping-two-triggers | 4/6 | 6/6 | 5/6 |
| orders-main-fanout | 3/6 | 1/6 | 4/6 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| dot | 119 | 491 |
| path | 96 | 326 |

Out tok: a word-and-punctuation count (no usage field). Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
