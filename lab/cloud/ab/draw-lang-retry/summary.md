# Draw-language A/B: claude-haiku-4.5 (stand-in), after one retry on shopfront.scan.json

7 question(s) × 5 language(s), runs 2; max_tokens 400, slice 36 parts, temperature 0. Scored from 70 answer file(s) in /tmp/claude-0/-home-claude/98503647-e9b2-5d6a-a38e-1754b6fe8e3e/scratchpad/drawab/retry/prompts.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 14 | 100% | 71% | 94% | 0.87 | 582 | — | — |
| flow | 14 | 100% | 100% | 100% | 0.99 | 245 | — | — |
| mermaid | 14 | 100% | 93% | 99% | 0.93 | 157 | — | — |
| dot | 14 | 100% | 100% | 100% | 0.94 | 233 | — | — |
| path | 14 | 100% | 100% | 100% | 0.90 | 66 | — | — |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 2 | 14 | 100% ± 0% | 71% ± 0% | 0.87 ± 0.07 | 568 ± 34 |
| flow | 2 | 14 | 100% ± 0% | 100% ± 0% | 0.99 ± 0.02 | 240 ± 43 |
| mermaid | 2 | 14 | 100% ± 0% | 93% ± 10% | 0.93 ± 0.03 | 172 ± 8 |
| dot | 2 | 14 | 100% ± 0% | 100% ± 0% | 0.94 ± 0.05 | 248 ± 33 |
| path | 2 | 14 | 100% ± 0% | 100% ± 0% | 0.90 ± 0.04 | 73 ± 7 |

Grounded answers per question (of runs):

| question | json | flow | mermaid | dot | path |
|---|---|---|---|---|---|
| card-charge-every-way | 0/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| gateway-fanout | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| order-notify | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| invoice-and-charge | 0/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| postgres-sharers | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| shipping-two-triggers | 2/2 | 2/2 | 1/2 | 2/2 | 2/2 |
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
