# Draw-language A/B: minicpm5-hermes on shopfront.scan.json

7 question(s) × 3 language(s), runs 6; max_tokens 400, slice 40 parts, temperature server default, reasoning_effort none. Live against http://127.0.0.1:11434/v1, streamed, card lock per language.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 42 | 71% | 5% | 24% | 0.08 | 237 | 2570 | 57 |
| dot | 42 | 86% | 36% | 83% | 0.50 | 175 | 1780 | 57 |
| path | 42 | 88% | 2% | 58% | 0.27 | 131 | 1313 | 48 |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 6 | 42 | 71% ± 9% | 5% ± 7% | 0.08 ± 0.06 | 251 ± 36 |
| dot | 6 | 42 | 86% ± 9% | 36% ± 23% | 0.50 ± 0.10 | 205 ± 30 |
| path | 6 | 42 | 88% ± 11% | 2% ± 6% | 0.27 ± 0.08 | 153 ± 36 |

Grounded answers per question (of runs):

| question | json | dot | path |
|---|---|---|---|
| card-charge-every-way | 0/6 | 4/6 | 0/6 |
| gateway-fanout | 1/6 | 3/6 | 0/6 |
| order-notify | 0/6 | 1/6 | 0/6 |
| invoice-and-charge | 0/6 | 0/6 | 0/6 |
| postgres-sharers | 1/6 | 3/6 | 0/6 |
| shipping-two-triggers | 0/6 | 2/6 | 0/6 |
| orders-main-fanout | 0/6 | 2/6 | 1/6 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| dot | 119 | 491 |
| path | 96 | 326 |

Out tok: the server's usage.completion_tokens. Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
