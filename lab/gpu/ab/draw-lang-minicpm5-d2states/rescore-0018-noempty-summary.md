# Draw-language A/B: answers on disk on shopfront.scan.json

7 question(s) × 4 language(s), runs 6; max_tokens 400, slice 40 parts, temperature 0. Scored from 168 answer file(s) in C:\Users\<user>\Projects\seq-ab\out\draw-lang-gpu-d2states\answers.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 42 | 81% | 40% | 100% | 0.16 | 369 | — | — |
| dot | 42 | 74% | 69% | 100% | 0.43 | 203 | — | — |
| d2 | 42 | 81% | 74% | 100% | 0.43 | 211 | — | — |
| states | 42 | 71% | 64% | 100% | 0.31 | 220 | — | — |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 6 | 42 | 81% ± 17% | 40% ± 17% | 0.16 ± 0.08 | 351 ± 48 |
| dot | 6 | 42 | 74% ± 11% | 69% ± 14% | 0.43 ± 0.15 | 265 ± 18 |
| d2 | 6 | 42 | 81% ± 12% | 74% ± 17% | 0.43 ± 0.09 | 240 ± 46 |
| states | 6 | 42 | 71% ± 22% | 64% ± 22% | 0.31 ± 0.15 | 249 ± 18 |

Grounded answers per question (of runs):

| question | json | dot | d2 | states |
|---|---|---|---|---|
| card-charge-every-way | 5/6 | 6/6 | 5/6 | 4/6 |
| gateway-fanout | 2/6 | 2/6 | 3/6 | 4/6 |
| order-notify | 2/6 | 6/6 | 6/6 | 6/6 |
| invoice-and-charge | 2/6 | 5/6 | 4/6 | 2/6 |
| postgres-sharers | 0/6 | 4/6 | 3/6 | 2/6 |
| shipping-two-triggers | 4/6 | 6/6 | 6/6 | 5/6 |
| orders-main-fanout | 2/6 | 0/6 | 4/6 | 4/6 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| dot | 119 | 491 |
| d2 | 105 | 491 |
| states | 170 | 491 |

Out tok: a word-and-punctuation count (no usage field). Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
