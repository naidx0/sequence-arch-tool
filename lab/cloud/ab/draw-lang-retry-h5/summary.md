# Draw-language A/B: answers on disk on shopfront.scan.json

7 question(s) × 5 language(s), runs 2; max_tokens 400, slice 36 parts, temperature 0. Scored from 70 answer file(s) in /tmp/claude-0/-home-claude/98503647-e9b2-5d6a-a38e-1754b6fe8e3e/scratchpad/drawab/retry2/prompts.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 14 | 93% | 93% | 100% | 0.82 | 579 | — | — |
| flow | 14 | 100% | 100% | 100% | 0.98 | 224 | — | — |
| mermaid | 14 | 100% | 100% | 100% | 0.93 | 164 | — | — |
| dot | 14 | 100% | 100% | 100% | 0.92 | 233 | — | — |
| path | 14 | 100% | 100% | 100% | 0.90 | 66 | — | — |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 2 | 14 | 93% ± 10% | 93% ± 10% | 0.82 ± 0.17 | 558 ± 26 |
| flow | 2 | 14 | 100% ± 0% | 100% ± 0% | 0.98 ± 0.03 | 236 ± 36 |
| mermaid | 2 | 14 | 100% ± 0% | 100% ± 0% | 0.93 ± 0.03 | 172 ± 1 |
| dot | 2 | 14 | 100% ± 0% | 100% ± 0% | 0.92 ± 0.09 | 244 ± 39 |
| path | 2 | 14 | 100% ± 0% | 100% ± 0% | 0.90 ± 0.04 | 71 ± 4 |

Grounded answers per question (of runs):

| question | json | flow | mermaid | dot | path |
|---|---|---|---|---|---|
| card-charge-every-way | 1/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| gateway-fanout | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| order-notify | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| invoice-and-charge | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| postgres-sharers | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| shipping-two-triggers | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| orders-main-fanout | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| flow | 133 | 491 |
| mermaid | 110 | 491 |
| dot | 119 | 491 |
| path | 96 | 326 |

Out tok: a word-and-punctuation count (no usage field). Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
