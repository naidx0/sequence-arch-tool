# Draw-language A/B: answers on disk on shopfront.scan.json

7 question(s) × 5 language(s), runs 1; max_tokens 400, slice 36 parts, temperature 0. Scored from 35 answer file(s) in /tmp/claude-0/-home-claude/98503647-e9b2-5d6a-a38e-1754b6fe8e3e/scratchpad/drawab/hard3/prompts.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 7 | 100% | 43% | 94% | 0.95 | 668 | — | — |
| flow | 7 | 100% | 57% | 95% | 0.99 | 220 | — | — |
| mermaid | 7 | 100% | 86% | 98% | 0.90 | 127 | — | — |
| dot | 7 | 100% | 100% | 100% | 1.00 | 240 | — | — |
| path | 7 | 100% | 29% | 92% | 1.00 | 88 | — | — |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 1 | 7 | 100% ± 0% | 43% ± 0% | 0.95 ± 0.00 | 604 ± 0 |
| flow | 1 | 7 | 100% ± 0% | 57% ± 0% | 0.99 ± 0.00 | 247 ± 0 |
| mermaid | 1 | 7 | 100% ± 0% | 86% ± 0% | 0.90 ± 0.00 | 152 ± 0 |
| dot | 1 | 7 | 100% ± 0% | 100% ± 0% | 1.00 ± 0.00 | 246 ± 0 |
| path | 1 | 7 | 100% ± 0% | 29% ± 0% | 1.00 ± 0.00 | 103 ± 0 |

Grounded answers per question (of runs):

| question | json | flow | mermaid | dot | path |
|---|---|---|---|---|---|
| card-charge-every-way | 0/1 | 1/1 | 1/1 | 1/1 | 0/1 |
| gateway-fanout | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| order-notify | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 |
| invoice-and-charge | 0/1 | 1/1 | 1/1 | 1/1 | 0/1 |
| postgres-sharers | 0/1 | 0/1 | 0/1 | 1/1 | 0/1 |
| shipping-two-triggers | 0/1 | 0/1 | 1/1 | 1/1 | 0/1 |
| orders-main-fanout | 1/1 | 0/1 | 1/1 | 1/1 | 0/1 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| flow | 133 | 491 |
| mermaid | 110 | 491 |
| dot | 119 | 491 |
| path | 96 | 326 |

Out tok: a word-and-punctuation count (no usage field). Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
