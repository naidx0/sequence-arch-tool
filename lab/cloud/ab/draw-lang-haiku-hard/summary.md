# Draw-language A/B: claude-haiku-4.5 (stand-in) on shopfront.scan.json

7 question(s) × 5 language(s), runs 2; max_tokens 400, slice 36 parts, temperature 0. Scored from 70 answer file(s) in /tmp/claude-0/-home-claude/98503647-e9b2-5d6a-a38e-1754b6fe8e3e/scratchpad/drawab/hard/prompts.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 14 | 100% | 36% | 91% | 0.89 | 596 | — | — |
| flow | 14 | 93% | 50% | 95% | 0.92 | 257 | — | — |
| mermaid | 14 | 100% | 29% | 91% | 0.93 | 187 | — | — |
| dot | 14 | 100% | 57% | 95% | 0.95 | 250 | — | — |
| path | 14 | 100% | 43% | 93% | 0.97 | 79 | — | — |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 2 | 14 | 100% ± 0% | 36% ± 10% | 0.89 ± 0.07 | 585 ± 36 |
| flow | 2 | 14 | 93% ± 10% | 50% ± 30% | 0.92 ± 0.12 | 252 ± 54 |
| mermaid | 2 | 14 | 100% ± 0% | 29% ± 20% | 0.93 ± 0.03 | 194 ± 11 |
| dot | 2 | 14 | 100% ± 0% | 57% ± 61% | 0.95 ± 0.04 | 275 ± 5 |
| path | 2 | 14 | 100% ± 0% | 43% ± 20% | 0.97 ± 0.04 | 85 ± 2 |

Grounded answers per question (of runs):

| question | json | flow | mermaid | dot | path |
|---|---|---|---|---|---|
| card-charge-every-way | 0/2 | 1/2 | 0/2 | 1/2 | 0/2 |
| gateway-fanout | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| order-notify | 0/2 | 1/2 | 0/2 | 1/2 | 1/2 |
| invoice-and-charge | 0/2 | 1/2 | 0/2 | 1/2 | 0/2 |
| postgres-sharers | 1/2 | 0/2 | 1/2 | 1/2 | 1/2 |
| shipping-two-triggers | 0/2 | 0/2 | 0/2 | 1/2 | 0/2 |
| orders-main-fanout | 2/2 | 2/2 | 1/2 | 1/2 | 2/2 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 491 |
| flow | 133 | 491 |
| mermaid | 110 | 491 |
| dot | 119 | 491 |
| path | 96 | 326 |

Out tok: a word-and-punctuation count (no usage field). Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
