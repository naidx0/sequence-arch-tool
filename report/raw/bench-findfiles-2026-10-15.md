# bench:findfiles 2026-10-15

Question set v2, sha256 `25c98b4152e5b5e7`, seed 20261014, k=5, analyzer build `b10f51445ab9fa99`. hit@k: Wilson 95 % intervals; recall@5: 95 % bootstrap over questions (2000 resamples). Tokens are chars/4 estimates. Load average: start 0.0, max 0.0, end 0.0 on 16 cpus.

## Headline: S against the strongest FAIR baseline

The strongest fair baseline is the best source-restricted grep arm, **R_src** (pooled hit@5 71.3 [66.0, 76.2]), not the Claude-Code-style G arm (hit@5 48.0 [42.4, 53.6]), which also returns docs and changelogs the source-only answers can never contain.

| comparison (S minus arm, pp) | paired SE | repo-clustered SE (CR1, 6 clusters) | z (clustered) | significant (>= 2 SE) |
|---|---|---|---|---|
| hit@1 vs R_src: 60.3 vs 40.0 | 20.3 | 3.2 | 3.0 | 6.8 | yes |
| hit@5 vs R_src: 89.7 vs 71.3 | 18.3 | 2.5 | 4.1 | 4.4 | yes |
| recall@5 vs R_src: 72.2 vs 55.6 | 16.6 | 2.5 | 3.4 | 4.9 | yes |

Per repo, S minus R_src on hit@5 (pp, paired SE; "n.s." = under 2 SE, not significant):

| repo | S hit@5 | R_src hit@5 | diff | paired SE | |
|---|---|---|---|---|---|
| flask | 94.0 | 80.0 | 14.0 | 5.0 | significant |
| sqlfluff | 94.0 | 82.0 | 12.0 | 5.5 | significant |
| express | 94.0 | 60.0 | 34.0 | 6.8 | significant |
| gin | 88.0 | 70.0 | 18.0 | 6.8 | significant |
| vite | 84.0 | 58.0 | 26.0 | 6.3 | significant |
| excalidraw | 84.0 | 78.0 | 6.0 | 5.3 | n.s. |

### Pooled (n=300)

| arm | hit@1 | hit@5 | recall@5 | tool-output tok | + read top5 tok | ms/query ‡ | calls |
|---|---|---|---|---|---|---|---|
| S | 60.3 [54.7, 65.7] | 89.7 [85.7, 92.6] | 72.2 [68.3, 76.4] | 770 | 6842 | 101 | 1.0 |
| G | 14.3 [10.8, 18.8] | 48.0 [42.4, 53.6] | 35.6 [30.8, 40.5] | 641 | 9434 | 222 | 4.9 |
| R | 17.0 [13.2, 21.7] | 59.3 [53.7, 64.7] | 44.3 [39.7, 49.2] | 32 | 9680 | 453 | 5.8 |
| GG | 15.7 [12.0, 20.2] | 57.0 [51.3, 62.5] | 43.0 [38.1, 48.0] | 31 | 9653 | 643 | 5.8 |
| G_src | 33.0 [27.9, 38.5] | 59.0 [53.4, 64.4] | 46.0 [41.4, 50.9] | 570 | 6300 | 216 | 4.8 |
| R_src | 40.0 [34.6, 45.6] | 71.3 [66.0, 76.2] | 55.6 [50.8, 60.4] | 35 | 6895 | 453 | 5.8 |
| GG_src | 37.0 [31.7, 42.6] | 68.7 [63.2, 73.7] | 53.2 [48.4, 58.1] | 35 | 6853 | 643 | 5.8 |

Paired S minus arm, percentage points. Clustered SE = repo-clustered (CR1); z uses it. "n.s." = under 2 SE.

| comparison | diff pp | paired SE | clustered SE | z | significant |
|---|---|---|---|---|---|
| hit@1 S−G | 46.0 | 3.1 | 2.3 | 19.9 | yes |
| hit@5 S−G | 41.7 | 3.0 | 5.4 | 7.7 | yes |
| recall@5 S−G | 36.6 | 2.8 | 4.4 | 8.3 | yes |
| hit@1 S−R | 43.3 | 3.2 | 7.0 | 6.2 | yes |
| hit@5 S−R | 30.3 | 2.8 | 4.2 | 7.3 | yes |
| recall@5 S−R | 27.9 | 2.6 | 3.3 | 8.5 | yes |
| hit@1 S−GG | 44.7 | 3.2 | 5.5 | 8.1 | yes |
| hit@5 S−GG | 32.7 | 2.8 | 3.7 | 8.7 | yes |
| recall@5 S−GG | 29.2 | 2.6 | 2.8 | 10.5 | yes |
| hit@1 S−G_src | 27.3 | 3.4 | 4.8 | 5.8 | yes |
| hit@5 S−G_src | 30.7 | 2.9 | 4.3 | 7.1 | yes |
| recall@5 S−G_src | 26.2 | 2.8 | 3.5 | 7.4 | yes |
| hit@1 S−R_src | 20.3 | 3.2 | 3.0 | 6.8 | yes |
| hit@5 S−R_src | 18.3 | 2.5 | 4.1 | 4.4 | yes |
| recall@5 S−R_src | 16.6 | 2.5 | 3.4 | 4.9 | yes |
| hit@1 S−GG_src | 23.3 | 3.3 | 3.0 | 7.8 | yes |
| hit@5 S−GG_src | 21.0 | 2.6 | 2.7 | 7.7 | yes |
| recall@5 S−GG_src | 19.0 | 2.5 | 2.6 | 7.2 | yes |

### flask (python, d086db85) (n=50)

| arm | hit@1 | hit@5 | recall@5 | tool-output tok | + read top5 tok | ms/query ‡ | calls |
|---|---|---|---|---|---|---|---|
| S | 56.0 [42.3, 68.8] | 94.0 [83.8, 97.9] | 82.0 [73.3, 90.3] | 766 | 8041 | 81 | 1.0 |
| G | 16.0 [8.3, 28.5] | 38.0 [25.9, 51.8] | 30.3 [19.0, 42.7] | 306 | 9612 | 125 | 4.9 |
| R | 38.0 [25.9, 51.8] | 58.0 [44.2, 70.6] | 49.0 [35.7, 62.0] | 22 | 9630 | 225 | 5.2 |
| GG | 26.0 [15.9, 39.6] | 56.0 [42.3, 68.8] | 49.0 [36.3, 61.7] | 21 | 9099 | 315 | 5.2 |
| G_src | 28.0 [17.5, 41.7] | 64.0 [50.1, 75.9] | 54.0 [42.0, 66.7] | 184 | 6845 | 122 | 4.8 |
| R_src | 46.0 [33.0, 59.6] | 80.0 [67.0, 88.8] | 73.0 [61.3, 83.7] | 23 | 7903 | 225 | 5.2 |
| GG_src | 44.0 [31.2, 57.7] | 80.0 [67.0, 88.8] | 72.0 [60.3, 82.7] | 23 | 7867 | 315 | 5.2 |

Paired S minus arm, percentage points. Per-repo: z uses the paired SE; "n.s." = under 2 SE.

| comparison | diff pp | paired SE | clustered SE | z | significant |
|---|---|---|---|---|---|
| hit@1 S−G | 40.0 | 8.6 | n/a | 4.7 | yes |
| hit@5 S−G | 56.0 | 7.1 | n/a | 7.9 | yes |
| recall@5 S−G | 51.7 | 6.6 | n/a | 7.8 | yes |
| hit@1 S−R | 18.0 | 8.4 | n/a | 2.1 | yes |
| hit@5 S−R | 36.0 | 6.9 | n/a | 5.3 | yes |
| recall@5 S−R | 33.0 | 6.7 | n/a | 4.9 | yes |
| hit@1 S−GG | 30.0 | 9.1 | n/a | 3.3 | yes |
| hit@5 S−GG | 38.0 | 6.9 | n/a | 5.5 | yes |
| recall@5 S−GG | 33.0 | 6.8 | n/a | 4.8 | yes |
| hit@1 S−G_src | 28.0 | 8.6 | n/a | 3.3 | yes |
| hit@5 S−G_src | 30.0 | 6.5 | n/a | 4.6 | yes |
| recall@5 S−G_src | 28.0 | 6.7 | n/a | 4.2 | yes |
| hit@1 S−R_src | 10.0 | 8.2 | n/a | 1.2 | n.s. |
| hit@5 S−R_src | 14.0 | 5.0 | n/a | 2.8 | yes |
| recall@5 S−R_src | 9.0 | 5.6 | n/a | 1.6 | n.s. |
| hit@1 S−GG_src | 12.0 | 8.4 | n/a | 1.4 | n.s. |
| hit@5 S−GG_src | 14.0 | 5.0 | n/a | 2.8 | yes |
| recall@5 S−GG_src | 10.0 | 5.4 | n/a | 1.8 | n.s. |

### sqlfluff (python, 467d5927) (n=50)

| arm | hit@1 | hit@5 | recall@5 | tool-output tok | + read top5 tok | ms/query ‡ | calls |
|---|---|---|---|---|---|---|---|
| S | 78.0 [64.8, 87.2] | 94.0 [83.8, 97.9] | 71.1 [61.7, 80.0] | 770 | 7751 | 131 | 1.0 |
| G | 30.0 [19.1, 43.8] | 58.0 [44.2, 70.6] | 41.5 [29.7, 54.2] | 1004 | 11992 | 464 | 5.0 |
| R | 10.0 [4.3, 21.4] | 80.0 [67.0, 88.8] | 53.4 [42.6, 63.4] | 43 | 11523 | 997 | 6.4 |
| GG | 12.0 [5.6, 23.8] | 72.0 [58.3, 82.5] | 46.0 [35.7, 56.0] | 43 | 11620 | 1095 | 6.4 |
| G_src | 46.0 [33.0, 59.6] | 58.0 [44.2, 70.6] | 40.8 [29.7, 52.8] | 892 | 7162 | 461 | 5.0 |
| R_src | 62.0 [48.2, 74.1] | 82.0 [69.2, 90.2] | 55.1 [44.7, 65.0] | 51 | 7743 | 997 | 6.4 |
| GG_src | 48.0 [34.8, 61.5] | 76.0 [62.6, 85.7] | 48.5 [38.2, 58.2] | 51 | 7689 | 1095 | 6.4 |

Paired S minus arm, percentage points. Per-repo: z uses the paired SE; "n.s." = under 2 SE.

| comparison | diff pp | paired SE | clustered SE | z | significant |
|---|---|---|---|---|---|
| hit@1 S−G | 48.0 | 8.2 | n/a | 5.9 | yes |
| hit@5 S−G | 36.0 | 7.4 | n/a | 4.8 | yes |
| recall@5 S−G | 29.6 | 6.9 | n/a | 4.3 | yes |
| hit@1 S−R | 68.0 | 7.8 | n/a | 8.7 | yes |
| hit@5 S−R | 14.0 | 5.7 | n/a | 2.4 | yes |
| recall@5 S−R | 17.7 | 4.1 | n/a | 4.3 | yes |
| hit@1 S−GG | 66.0 | 7.9 | n/a | 8.4 | yes |
| hit@5 S−GG | 22.0 | 6.6 | n/a | 3.3 | yes |
| recall@5 S−GG | 25.1 | 5.5 | n/a | 4.6 | yes |
| hit@1 S−G_src | 32.0 | 8.3 | n/a | 3.9 | yes |
| hit@5 S−G_src | 36.0 | 8.0 | n/a | 4.5 | yes |
| recall@5 S−G_src | 30.2 | 7.3 | n/a | 4.2 | yes |
| hit@1 S−R_src | 16.0 | 8.3 | n/a | 1.9 | n.s. |
| hit@5 S−R_src | 12.0 | 5.5 | n/a | 2.2 | yes |
| recall@5 S−R_src | 16.0 | 4.1 | n/a | 3.9 | yes |
| hit@1 S−GG_src | 30.0 | 8.2 | n/a | 3.7 | yes |
| hit@5 S−GG_src | 18.0 | 6.8 | n/a | 2.6 | yes |
| recall@5 S−GG_src | 22.6 | 5.4 | n/a | 4.2 | yes |

### express (javascript, a419aa73) (n=50)

| arm | hit@1 | hit@5 | recall@5 | tool-output tok | + read top5 tok | ms/query ‡ | calls |
|---|---|---|---|---|---|---|---|
| S | 56.0 [42.3, 68.8] | 94.0 [83.8, 97.9] | 78.3 [69.7, 86.5] | 773 | 5377 | 80 | 1.0 |
| G | 6.0 [2.1, 16.2] | 42.0 [29.4, 55.8] | 34.2 [22.5, 46.5] | 288 | 5486 | 116 | 4.8 |
| R | 2.0 [0.4, 10.5] | 54.0 [40.4, 67.0] | 39.8 [27.8, 51.0] | 20 | 6015 | 186 | 4.5 |
| GG | 2.0 [0.4, 10.5] | 50.0 [36.6, 63.4] | 38.5 [26.7, 50.3] | 20 | 6018 | 245 | 4.5 |
| G_src | 32.0 [20.8, 45.8] | 46.0 [33.0, 59.6] | 39.8 [27.0, 53.0] | 239 | 4161 | 101 | 4.3 |
| R_src | 30.0 [19.1, 43.8] | 60.0 [46.2, 72.4] | 48.3 [36.3, 60.3] | 23 | 5136 | 186 | 4.5 |
| GG_src | 28.0 [17.5, 41.7] | 62.0 [48.2, 74.1] | 49.9 [37.9, 61.8] | 24 | 4871 | 245 | 4.5 |

Paired S minus arm, percentage points. Per-repo: z uses the paired SE; "n.s." = under 2 SE.

| comparison | diff pp | paired SE | clustered SE | z | significant |
|---|---|---|---|---|---|
| hit@1 S−G | 50.0 | 7.1 | n/a | 7.0 | yes |
| hit@5 S−G | 52.0 | 7.1 | n/a | 7.3 | yes |
| recall@5 S−G | 44.2 | 7.2 | n/a | 6.2 | yes |
| hit@1 S−R | 54.0 | 7.1 | n/a | 7.6 | yes |
| hit@5 S−R | 40.0 | 7.0 | n/a | 5.7 | yes |
| recall@5 S−R | 38.5 | 7.2 | n/a | 5.3 | yes |
| hit@1 S−GG | 54.0 | 7.1 | n/a | 7.6 | yes |
| hit@5 S−GG | 44.0 | 7.1 | n/a | 6.2 | yes |
| recall@5 S−GG | 39.8 | 7.0 | n/a | 5.7 | yes |
| hit@1 S−G_src | 24.0 | 8.4 | n/a | 2.9 | yes |
| hit@5 S−G_src | 48.0 | 7.1 | n/a | 6.7 | yes |
| recall@5 S−G_src | 38.5 | 7.2 | n/a | 5.4 | yes |
| hit@1 S−R_src | 26.0 | 8.9 | n/a | 2.9 | yes |
| hit@5 S−R_src | 34.0 | 6.8 | n/a | 5.0 | yes |
| recall@5 S−R_src | 30.0 | 7.4 | n/a | 4.1 | yes |
| hit@1 S−GG_src | 28.0 | 8.6 | n/a | 3.3 | yes |
| hit@5 S−GG_src | 32.0 | 7.3 | n/a | 4.4 | yes |
| recall@5 S−GG_src | 28.4 | 7.2 | n/a | 3.9 | yes |

### gin (go, 0f09c3a9) (n=50)

| arm | hit@1 | hit@5 | recall@5 | tool-output tok | + read top5 tok | ms/query ‡ | calls |
|---|---|---|---|---|---|---|---|
| S | 60.0 [46.2, 72.4] | 88.0 [76.2, 94.4] | 72.2 [61.6, 82.5] | 771 | 5975 | 81 | 1.0 |
| G | 22.0 [12.8, 35.2] | 68.0 [54.2, 79.2] | 51.4 [39.9, 63.9] | 222 | 8051 | 115 | 4.8 |
| R | 22.0 [12.8, 35.2] | 66.0 [52.2, 77.6] | 52.7 [41.1, 64.3] | 19 | 9246 | 225 | 5.7 |
| GG | 24.0 [14.3, 37.4] | 64.0 [50.1, 75.9] | 51.6 [40.1, 63.6] | 18 | 8585 | 315 | 5.7 |
| G_src | 54.0 [40.4, 67.0] | 68.0 [54.2, 79.2] | 54.2 [42.6, 66.1] | 184 | 5272 | 107 | 4.6 |
| R_src | 44.0 [31.2, 57.7] | 70.0 [56.2, 80.9] | 56.2 [44.2, 67.8] | 19 | 6357 | 225 | 5.7 |
| GG_src | 42.0 [29.4, 55.8] | 70.0 [56.2, 80.9] | 57.6 [45.6, 69.1] | 20 | 6260 | 315 | 5.7 |

Paired S minus arm, percentage points. Per-repo: z uses the paired SE; "n.s." = under 2 SE.

| comparison | diff pp | paired SE | clustered SE | z | significant |
|---|---|---|---|---|---|
| hit@1 S−G | 38.0 | 8.0 | n/a | 4.7 | yes |
| hit@5 S−G | 20.0 | 6.4 | n/a | 3.1 | yes |
| recall@5 S−G | 20.8 | 6.6 | n/a | 3.1 | yes |
| hit@1 S−R | 38.0 | 7.5 | n/a | 5.1 | yes |
| hit@5 S−R | 22.0 | 7.2 | n/a | 3.1 | yes |
| recall@5 S−R | 19.5 | 7.6 | n/a | 2.6 | yes |
| hit@1 S−GG | 36.0 | 8.5 | n/a | 4.3 | yes |
| hit@5 S−GG | 24.0 | 6.7 | n/a | 3.6 | yes |
| recall@5 S−GG | 20.5 | 7.1 | n/a | 2.9 | yes |
| hit@1 S−G_src | 6.0 | 7.8 | n/a | 0.8 | n.s. |
| hit@5 S−G_src | 20.0 | 6.4 | n/a | 3.1 | yes |
| recall@5 S−G_src | 18.0 | 6.9 | n/a | 2.6 | yes |
| hit@1 S−R_src | 16.0 | 7.2 | n/a | 2.2 | yes |
| hit@5 S−R_src | 18.0 | 6.8 | n/a | 2.6 | yes |
| recall@5 S−R_src | 15.9 | 7.5 | n/a | 2.1 | yes |
| hit@1 S−GG_src | 18.0 | 8.4 | n/a | 2.1 | yes |
| hit@5 S−GG_src | 18.0 | 6.2 | n/a | 2.9 | yes |
| recall@5 S−GG_src | 14.5 | 7.0 | n/a | 2.1 | yes |

### vite (typescript, c2c9ef4d) (n=50)

| arm | hit@1 | hit@5 | recall@5 | tool-output tok | + read top5 tok | ms/query ‡ | calls |
|---|---|---|---|---|---|---|---|
| S | 58.0 [44.2, 70.6] | 84.0 [71.5, 91.7] | 66.3 [55.2, 76.9] | 772 | 6691 | 127 | 1.0 |
| G | 6.0 [2.1, 16.2] | 36.0 [24.1, 49.9] | 28.7 [17.7, 40.0] | 1334 | 12752 | 339 | 5.0 |
| R | 12.0 [5.6, 23.8] | 46.0 [33.0, 59.6] | 35.3 [23.5, 48.0] | 40 | 12865 | 733 | 6.7 |
| GG | 12.0 [5.6, 23.8] | 44.0 [31.2, 57.7] | 35.5 [23.0, 48.0] | 40 | 12594 | 1401 | 6.7 |
| G_src | 22.0 [12.8, 35.2] | 64.0 [50.1, 75.9] | 51.7 [39.2, 64.0] | 1228 | 7672 | 339 | 5.0 |
| R_src | 32.0 [20.8, 45.8] | 58.0 [44.2, 70.6] | 45.2 [33.0, 57.5] | 49 | 7437 | 733 | 6.7 |
| GG_src | 28.0 [17.5, 41.7] | 58.0 [44.2, 70.6] | 45.5 [32.5, 58.0] | 50 | 7642 | 1401 | 6.7 |

Paired S minus arm, percentage points. Per-repo: z uses the paired SE; "n.s." = under 2 SE.

| comparison | diff pp | paired SE | clustered SE | z | significant |
|---|---|---|---|---|---|
| hit@1 S−G | 52.0 | 7.1 | n/a | 7.3 | yes |
| hit@5 S−G | 48.0 | 7.1 | n/a | 6.7 | yes |
| recall@5 S−G | 37.6 | 5.9 | n/a | 6.3 | yes |
| hit@1 S−R | 46.0 | 7.1 | n/a | 6.5 | yes |
| hit@5 S−R | 38.0 | 6.9 | n/a | 5.5 | yes |
| recall@5 S−R | 31.0 | 5.4 | n/a | 5.8 | yes |
| hit@1 S−GG | 46.0 | 7.1 | n/a | 6.5 | yes |
| hit@5 S−GG | 40.0 | 7.0 | n/a | 5.7 | yes |
| recall@5 S−GG | 30.8 | 5.6 | n/a | 5.5 | yes |
| hit@1 S−G_src | 36.0 | 8.0 | n/a | 4.5 | yes |
| hit@5 S−G_src | 20.0 | 6.4 | n/a | 3.1 | yes |
| recall@5 S−G_src | 14.6 | 5.5 | n/a | 2.7 | yes |
| hit@1 S−R_src | 26.0 | 6.9 | n/a | 3.8 | yes |
| hit@5 S−R_src | 26.0 | 6.3 | n/a | 4.1 | yes |
| recall@5 S−R_src | 21.1 | 5.4 | n/a | 3.9 | yes |
| hit@1 S−GG_src | 30.0 | 7.1 | n/a | 4.2 | yes |
| hit@5 S−GG_src | 26.0 | 6.3 | n/a | 4.1 | yes |
| recall@5 S−GG_src | 20.8 | 5.4 | n/a | 3.8 | yes |

### excalidraw (typescript, 4c37956b) (n=50)

| arm | hit@1 | hit@5 | recall@5 | tool-output tok | + read top5 tok | ms/query ‡ | calls |
|---|---|---|---|---|---|---|---|
| S | 54.0 [40.4, 67.0] | 84.0 [71.5, 91.7] | 63.3 [52.7, 73.2] | 771 | 7220 | 106 | 1.0 |
| G | 6.0 [2.1, 16.2] | 46.0 [33.0, 59.6] | 27.2 [17.4, 37.9] | 691 | 8710 | 171 | 5.0 |
| R | 18.0 [9.8, 30.8] | 52.0 [38.5, 65.2] | 35.8 [24.8, 48.1] | 47 | 8802 | 355 | 6.2 |
| GG | 18.0 [9.8, 30.8] | 56.0 [42.3, 68.8] | 37.3 [26.2, 49.7] | 42 | 10000 | 486 | 6.2 |
| G_src | 16.0 [8.3, 28.5] | 54.0 [40.4, 67.0] | 35.6 [24.7, 46.8] | 690 | 6690 | 167 | 4.9 |
| R_src | 26.0 [15.9, 39.6] | 78.0 [64.8, 87.2] | 55.9 [44.7, 67.9] | 45 | 6796 | 355 | 6.2 |
| GG_src | 32.0 [20.8, 45.8] | 66.0 [52.2, 77.6] | 45.4 [34.3, 57.3] | 43 | 6787 | 486 | 6.2 |

Paired S minus arm, percentage points. Per-repo: z uses the paired SE; "n.s." = under 2 SE.

| comparison | diff pp | paired SE | clustered SE | z | significant |
|---|---|---|---|---|---|
| hit@1 S−G | 48.0 | 7.1 | n/a | 6.7 | yes |
| hit@5 S−G | 38.0 | 8.0 | n/a | 4.7 | yes |
| recall@5 S−G | 36.1 | 6.7 | n/a | 5.4 | yes |
| hit@1 S−R | 36.0 | 6.9 | n/a | 5.3 | yes |
| hit@5 S−R | 32.0 | 7.3 | n/a | 4.4 | yes |
| recall@5 S−R | 27.5 | 6.8 | n/a | 4.0 | yes |
| hit@1 S−GG | 36.0 | 6.9 | n/a | 5.3 | yes |
| hit@5 S−GG | 28.0 | 7.0 | n/a | 4.0 | yes |
| recall@5 S−GG | 26.0 | 6.5 | n/a | 4.0 | yes |
| hit@1 S−G_src | 38.0 | 8.0 | n/a | 4.7 | yes |
| hit@5 S−G_src | 30.0 | 7.7 | n/a | 3.9 | yes |
| recall@5 S−G_src | 27.7 | 6.6 | n/a | 4.2 | yes |
| hit@1 S−R_src | 28.0 | 7.0 | n/a | 4.0 | yes |
| hit@5 S−R_src | 6.0 | 5.3 | n/a | 1.1 | n.s. |
| recall@5 S−R_src | 7.4 | 5.6 | n/a | 1.3 | n.s. |
| hit@1 S−GG_src | 22.0 | 7.2 | n/a | 3.1 | yes |
| hit@5 S−GG_src | 18.0 | 6.2 | n/a | 2.9 | yes |
| recall@5 S−GG_src | 17.9 | 5.7 | n/a | 3.1 | yes |

‡ ms/query is load-dependent (this run stayed under load 2, so the figures are usable as a rough guide). S times a warm in-process call; the grep arms time their subprocess calls. The index build is not in ms/query.

S ranker kinds per repo (frozen = LTR ready, hybrid = LTR stage not ready): flask {"frozen":50}; sqlfluff {"frozen":50}; express {"frozen":50}; gin {"frozen":50}; vite {"frozen":50}; excalidraw {"frozen":50}

Median index build ms at the parent (S setup, not in ms/query): flask 287, sqlfluff 4998, express 467, gin 345, vite 5821, excalidraw 1851
