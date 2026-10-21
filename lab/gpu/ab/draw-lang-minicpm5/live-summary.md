# Draw-language A/B: minicpm5-hermes on shopfront.scan.json

7 question(s) × 5 language(s), runs 6; max_tokens 400, slice 40 parts, temperature server default, reasoning_effort none. Live against http://127.0.0.1:11434/v1, streamed, card lock per language.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 42 | 81% | 12% | 21% | 0.07 | 173 | 1696 | 28 |
| flow | 42 | 14% | 0% | 11% | 0.01 | 193 | 1854 | 27 |
| mermaid | 42 | 0% | 0% | — | 0.00 | 160 | 1544 | 26 |
| dot | 42 | 88% | 21% | 78% | 0.50 | 181 | 1715 | 26 |
| path | 42 | 79% | 0% | 58% | 0.24 | 132 | 1312 | 24 |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 6 | 42 | 81% ± 15% | 12% ± 6% | 0.07 ± 0.05 | 217 ± 22 |
| flow | 6 | 42 | 14% ± 9% | 0% ± 0% | 0.01 ± 0.01 | 207 ± 42 |
| mermaid | 6 | 42 | 0% ± 0% | 0% ± 0% | 0.00 ± 0.00 | 217 ± 41 |
| dot | 6 | 42 | 88% ± 11% | 21% ± 20% | 0.50 ± 0.13 | 208 ± 20 |
| path | 6 | 42 | 79% ± 12% | 0% ± 0% | 0.24 ± 0.12 | 186 ± 37 |

Grounded answers per question (of runs):

| question | json | flow | mermaid | dot | path |
|---|---|---|---|---|---|
| card-charge-every-way | 1/6 | 0/6 | 0/6 | 2/6 | 0/6 |
| gateway-fanout | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 |
| order-notify | 0/6 | 0/6 | 0/6 | 1/6 | 0/6 |
| invoice-and-charge | 0/6 | 0/6 | 0/6 | 2/6 | 0/6 |
| postgres-sharers | 1/6 | 0/6 | 0/6 | 1/6 | 0/6 |
| shipping-two-triggers | 0/6 | 0/6 | 0/6 | 0/6 | 0/6 |
| orders-main-fanout | 3/6 | 0/6 | 0/6 | 3/6 | 0/6 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| flow | 133 | 491 |
| mermaid | 110 | 491 |
| dot | 119 | 491 |
| path | 96 | 326 |

Out tok: the server's usage.completion_tokens. Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
