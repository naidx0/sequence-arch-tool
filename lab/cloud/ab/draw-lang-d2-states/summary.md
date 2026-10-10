# Draw-language A/B: answers on disk on shopfront.scan.json

7 question(s) × 2 language(s), runs 2; max_tokens 400, slice 36 parts, temperature 0. Scored from 28 answer file(s) in /tmp/claude-0/-home-claude/98503647-e9b2-5d6a-a38e-1754b6fe8e3e/scratchpad/drawab/hard-d2/prompts.

| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |
|---|---|---|---|---|---|---|---|---|
| d2 | 14 | 100% | 71% | 97% | 0.85 | 221 | — | — |
| states | 14 | 100% | 71% | 97% | 0.95 | 213 | — | — |

Across runs (each run scored over all questions, then mean ± sample sd over runs):

| lang | runs | n | parse | grounded | hop cov | out tok |
|---|---|---|---|---|---|---|
| d2 | 2 | 14 | 100% ± 0% | 71% ± 40% | 0.85 ± 0.02 | 206 ± 26 |
| states | 2 | 14 | 100% ± 0% | 71% ± 40% | 0.95 ± 0.04 | 226 ± 58 |

Grounded answers per question (of runs):

| question | d2 | states |
|---|---|---|
| card-charge-every-way | 1/2 | 1/2 |
| gateway-fanout | 2/2 | 2/2 |
| order-notify | 2/2 | 2/2 |
| invoice-and-charge | 1/2 | 1/2 |
| postgres-sharers | 2/2 | 1/2 |
| shipping-two-triggers | 1/2 | 1/2 |
| orders-main-fanout | 1/2 | 2/2 |

Prompt sizes (word-and-punctuation count; view = mean over questions):

| lang | instruction | view |
|---|---|---|
| d2 | 105 | 491 |
| states | 170 | 491 |

Out tok: a word-and-punctuation count (no usage field). Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.
