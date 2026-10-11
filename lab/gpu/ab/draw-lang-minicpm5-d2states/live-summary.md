# Draw-language A/B: minicpm5-hermes on shopfront.scan.json

7 question(s) × 4 language(s), runs 6; max_tokens 400, slice 40 parts, temperature server default, reasoning_effort none. Live against http://127.0.0.1:11434/v1, streamed, card lock per language.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 42 | 81% | 10% | 25% | 0.09 | 227 | 2181 | 26 |
| dot | 42 | 74% | 33% | 79% | 0.43 | 194 | 1840 | 26 |
| d2 | 42 | 81% | 26% | 75% | 0.41 | 191 | 1811 | 26 |
| states | 42 | 71% | 12% | 48% | 0.23 | 239 | 2285 | 26 |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 6 | 42 | 81% ± 17% | 10% ± 12% | 0.09 ± 0.05 | 232 ± 40 |
| dot | 6 | 42 | 74% ± 11% | 33% ± 15% | 0.43 ± 0.15 | 244 ± 16 |
| d2 | 6 | 42 | 81% ± 12% | 26% ± 11% | 0.41 ± 0.09 | 218 ± 40 |
| states | 6 | 42 | 71% ± 22% | 12% ± 19% | 0.23 ± 0.10 | 270 ± 20 |

Grounded answers per question (of runs):

| question | json | dot | d2 | states |
|---|---|---|---|---|
| card-charge-every-way | 2/6 | 4/6 | 2/6 | 1/6 |
| gateway-fanout | 1/6 | 1/6 | 2/6 | 1/6 |
| order-notify | 0/6 | 2/6 | 3/6 | 0/6 |
| invoice-and-charge | 0/6 | 1/6 | 0/6 | 1/6 |
| postgres-sharers | 0/6 | 3/6 | 1/6 | 0/6 |
| shipping-two-triggers | 1/6 | 3/6 | 1/6 | 0/6 |
| orders-main-fanout | 0/6 | 0/6 | 2/6 | 2/6 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| dot | 119 | 491 |
| d2 | 105 | 491 |
| states | 170 | 491 |

Out tok: the server's usage.completion_tokens. Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
