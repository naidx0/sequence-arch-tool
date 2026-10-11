# Draw-language A/B: claude-haiku-4.5 (stand-in) on shopfront.scan.json

7 question(s) × 6 language(s), runs 2; max_tokens 400, slice 24 parts, temperature 0. Scored from 84 answer file(s) in /tmp/claude-0/-home-claude/98503647-e9b2-5d6a-a38e-1754b6fe8e3e/scratchpad/drawab/prompts.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| json | 14 | 100% | 100% | 100% | 1.00 | 249 | — | — |
| flow | 14 | 100% | 100% | 100% | 1.00 | 122 | — | — |
| mermaid | 14 | 100% | 100% | 100% | 1.00 | 67 | — | — |
| dot | 14 | 100% | 100% | 100% | 1.00 | 102 | — | — |
| path | 14 | 100% | 100% | 100% | 1.00 | 33 | — | — |
| ascii | 14 | 100% | 57% | 88% | 0.87 | 30 | — | — |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| json | 2 | 14 | 100% ± 0% | 100% ± 0% | 1.00 ± 0.00 | 246 ± 6 |
| flow | 2 | 14 | 100% ± 0% | 100% ± 0% | 1.00 ± 0.00 | 114 ± 4 |
| mermaid | 2 | 14 | 100% ± 0% | 100% ± 0% | 1.00 ± 0.00 | 65 ± 1 |
| dot | 2 | 14 | 100% ± 0% | 100% ± 0% | 1.00 ± 0.00 | 97 ± 6 |
| path | 2 | 14 | 100% ± 0% | 100% ± 0% | 1.00 ± 0.00 | 33 ± 8 |
| ascii | 2 | 14 | 100% ± 0% | 57% ± 0% | 0.87 ± 0.00 | 35 ± 11 |

Grounded answers per question (of runs):

| question | json | flow | mermaid | dot | path | ascii |
|---|---|---|---|---|---|---|
| get-order | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 0/2 |
| charge-payment | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| invoice-read | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 0/2 |
| order-event | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| who-calls-payments | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| stock-check | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 |
| shipment-lookup | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 0/2 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| json | 221 | 437 |
| flow | 133 | 437 |
| mermaid | 110 | 437 |
| dot | 119 | 437 |
| path | 96 | 271 |
| ascii | 104 | 353 |

Out tok: a word-and-punctuation count (no usage field). Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
