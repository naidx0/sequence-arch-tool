# Drawing-language token cost (proxy tokenizers)

**These are tokenizer counts from proxy encodings, not MiniCPM5 counts and not measured generation times.** 
Primary: `o200k_base`; reference: `cl100k_base` (both via npm `gpt-tokenizer` 4.0.0, bundled vocab). 
Third column `sp32k`: SentencePiece 32k BPE (Mistral 7B v1 `tokenizer.model.v1`, bundled in the PyPI `mistral-common` wheel by Mistral AI) as a Llama-family proxy; MiniCPM's own vocab is not available offline. 
`rough` = the scorer's word-and-punctuation estimate (`outTokens` in rescore-*/results.jsonl, `systemTok`/`userTok` in the prompt manifests). 
Answers are from the claude-haiku-4.5 stand-in run (max_tokens 400), 2 runs per question. Ratios are mean(lang)/mean(json) in the same encoding.

## easy set (14 answers per language)

### Output tokens per answer

| lang | o200k median | o200k mean ± sd | ×json | cl100k median | cl100k mean ± sd | ×json | sp32k mean ± sd | ×json | rough median | rough mean | ×json | rough/o200k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| json | 133.5 | 129.9 ± 29.2 | 1.0 | 130.5 | 127.3 ± 28.9 | 1.0 | 164.8 ± 37.5 | 1.0 | 248.5 | 245.6 | 1.0 | 1.89 |
| flow | 110 | 101.4 ± 28.5 | 0.78 | 109 | 100 ± 28.1 | 0.79 | 133.9 ± 39.3 | 0.81 | 122 | 114.3 | 0.47 | 1.13 |
| mermaid | 56 | 53.3 ± 10.3 | 0.41 | 55 | 53.7 ± 10.8 | 0.42 | 73.2 ± 15.3 | 0.44 | 67 | 64.9 | 0.26 | 1.22 |
| dot | 77 | 71.3 ± 20.1 | 0.55 | 76 | 70.9 ± 19.8 | 0.56 | 101.6 ± 30.9 | 0.62 | 101.5 | 96.9 | 0.39 | 1.36 |
| path | 39 | 39.4 ± 12.9 | 0.3 | 39 | 39.4 ± 12.9 | 0.31 | 46.8 ± 14.0 | 0.28 | 33 | 33.1 | 0.13 | 0.84 |
| ascii | 38 | 41.6 ± 14.3 | 0.32 | 38 | 41.6 ± 14.3 | 0.33 | 49.3 ± 15.8 | 0.3 | 30 | 34.9 | 0.14 | 0.84 |

### Input tokens per prompt (system + user), mean over questions

| lang | o200k system | o200k user | o200k total | ×json | cl100k total | ×json | sp32k total | ×json | rough total | ×json |
|---|---|---|---|---|---|---|---|---|---|---|
| json | 143 | 337.3 | 480.3 | 1.0 | 474.3 | 1.0 | 704.6 | 1.0 | 688.7 | 1.0 |
| flow | 119 | 337.3 | 456.3 | 0.95 | 453.3 | 0.96 | 675.6 | 0.96 | 600.7 | 0.87 |
| mermaid | 94 | 337.3 | 431.3 | 0.9 | 429.3 | 0.91 | 652.6 | 0.93 | 577.7 | 0.84 |
| dot | 102 | 337.3 | 439.3 | 0.91 | 436.3 | 0.92 | 657.6 | 0.93 | 586.7 | 0.85 |
| path | 100 | 285 | 385 | 0.8 | 385 | 0.81 | 528.4 | 0.75 | 398.3 | 0.58 |
| ascii | 100 | 306.3 | 406.3 | 0.85 | 406.3 | 0.86 | 577.4 | 0.82 | 488.7 | 0.71 |

## hard set (14 answers per language)

### Output tokens per answer

| lang | o200k median | o200k mean ± sd | ×json | cl100k median | cl100k mean ± sd | ×json | sp32k mean ± sd | ×json | rough median | rough mean | ×json | rough/o200k |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| json | 316.5 | 317.1 ± 80.5 | 1.0 | 314.5 | 313.1 ± 80.5 | 1.0 | 400.6 ± 103.4 | 1.0 | 595.5 | 584.6 | 1.0 | 1.84 |
| flow | 236 | 241.5 ± 55.6 | 0.76 | 234 | 238.9 ± 54.9 | 0.76 | 326.7 ± 80.3 | 0.82 | 257 | 251.9 | 0.43 | 1.04 |
| mermaid | 152 | 159.1 ± 48.4 | 0.5 | 151.5 | 159.4 ± 47.3 | 0.51 | 225.1 ± 68.7 | 0.56 | 187 | 194 | 0.33 | 1.22 |
| dot | 184.5 | 200.4 ± 60.1 | 0.63 | 183 | 199 ± 59.8 | 0.64 | 284.6 ± 90.2 | 0.71 | 249.5 | 275.4 | 0.47 | 1.37 |
| path | 94.5 | 102.6 ± 28.4 | 0.32 | 94.5 | 102.6 ± 28.4 | 0.33 | 127.6 ± 33.4 | 0.32 | 78.5 | 85.1 | 0.15 | 0.83 |

### Input tokens per prompt (system + user), mean over questions

| lang | o200k system | o200k user | o200k total | ×json | cl100k total | ×json | sp32k total | ×json | rough total | ×json |
|---|---|---|---|---|---|---|---|---|---|---|
| json | 143 | 411.3 | 554.3 | 1.0 | 547.3 | 1.0 | 805.1 | 1.0 | 757.6 | 1.0 |
| flow | 119 | 411.3 | 530.3 | 0.96 | 526.3 | 0.96 | 776.1 | 0.96 | 669.6 | 0.88 |
| mermaid | 94 | 411.3 | 505.3 | 0.91 | 502.3 | 0.92 | 753.1 | 0.94 | 646.6 | 0.85 |
| dot | 102 | 411.3 | 513.3 | 0.93 | 509.3 | 0.93 | 758.1 | 0.94 | 655.6 | 0.87 |
| path | 100 | 366.3 | 466.3 | 0.84 | 465.3 | 0.85 | 646.1 | 0.8 | 467.6 | 0.62 |

Files: `raw_counts.json` (per-file counts incl. text), `tokens.json` (aggregates + per-answer rows), `count.mjs`, `stats.py`.
