# Draw-language A/B: minicpm5-hermes on shopfront.scan.json

7 question(s) × 3 language(s), runs 6; max_tokens 400, slice 40 parts, temperature server default, reasoning_effort none. Live against http://127.0.0.1:11434/v1, streamed, card lock per language.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 42 | 81% | 12% | 34% | 0.11 | 195 | 2101 | 62 |
| dot | 42 | 81% | 21% | 75% | 0.46 | 243 | 2477 | 98 |
| path | 42 | 86% | 10% | 59% | 0.28 | 95 | 1089 | 37 |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 6 | 42 | 81% ± 7% | 12% ± 6% | 0.11 ± 0.04 | 223 ± 21 |
| dot | 6 | 42 | 81% ± 7% | 21% ± 17% | 0.46 ± 0.10 | 236 ± 27 |
| path | 6 | 42 | 86% ± 16% | 10% ± 7% | 0.28 ± 0.09 | 156 ± 18 |

Grounded answers per question (of runs):

| question | json | dot | path |
|---|---|---|---|
| card-charge-every-way | 1/6 | 2/6 | 0/6 |
| gateway-fanout | 1/6 | 0/6 | 0/6 |
| order-notify | 1/6 | 3/6 | 0/6 |
| invoice-and-charge | 0/6 | 1/6 | 1/6 |
| postgres-sharers | 0/6 | 1/6 | 2/6 |
| shipping-two-triggers | 0/6 | 1/6 | 1/6 |
| orders-main-fanout | 2/6 | 1/6 | 0/6 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| dot | 119 | 491 |
| path | 96 | 326 |

Out tok: the server's usage.completion_tokens. Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
