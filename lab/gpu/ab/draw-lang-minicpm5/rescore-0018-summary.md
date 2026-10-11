# Draw-language A/B: answers on disk on shopfront.scan.json

7 question(s) × 5 language(s), runs 6; max_tokens 400, slice 40 parts, temperature 0. Scored from 210 answer file(s) in C:\Users\<user>\Projects\seq-ab\out\draw-lang-gpu\answers.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 42 | 81% | 74% | 100% | 0.13 | 274 | — | — |
| flow | 42 | 14% | 14% | 100% | 0.02 | 189 | — | — |
| mermaid | 42 | 0% | 0% | — | 0.00 | 177 | — | — |
| dot | 42 | 88% | 88% | 100% | 0.53 | 191 | — | — |
| path | 42 | 79% | 79% | 100% | 0.25 | 108 | — | — |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 6 | 42 | 81% ± 15% | 74% ± 14% | 0.13 ± 0.04 | 329 ± 45 |
| flow | 6 | 42 | 14% ± 9% | 14% ± 9% | 0.02 ± 0.02 | 206 ± 38 |
| mermaid | 6 | 42 | 0% ± 0% | 0% ± 0% | 0.00 ± 0.00 | 237 ± 49 |
| dot | 6 | 42 | 88% ± 11% | 88% ± 11% | 0.53 ± 0.14 | 227 ± 22 |
| path | 6 | 42 | 79% ± 12% | 79% ± 12% | 0.25 ± 0.13 | 155 ± 30 |

Grounded answers per question (of runs):

| question | json | flow | mermaid | dot | path |
|---|---|---|---|---|---|
| card-charge-every-way | 5/6 | 2/6 | 0/6 | 4/6 | 6/6 |
| gateway-fanout | 3/6 | 0/6 | 0/6 | 5/6 | 5/6 |
| order-notify | 4/6 | 2/6 | 0/6 | 6/6 | 6/6 |
| invoice-and-charge | 6/6 | 1/6 | 0/6 | 6/6 | 5/6 |
| postgres-sharers | 3/6 | 1/6 | 0/6 | 6/6 | 4/6 |
| shipping-two-triggers | 6/6 | 0/6 | 0/6 | 6/6 | 6/6 |
| orders-main-fanout | 4/6 | 0/6 | 0/6 | 4/6 | 1/6 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| flow | 133 | 491 |
| mermaid | 110 | 491 |
| dot | 119 | 491 |
| path | 96 | 326 |

Out tok: a word-and-punctuation count (no usage field). Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
