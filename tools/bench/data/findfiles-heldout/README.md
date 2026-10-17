# Held-out question set for bench:findfiles and bench:closure

## Prerequisites

`git` and ripgrep (`rg`, tested with 14.1.0) on PATH, plus a built analyzer (`pnpm -r build`). The benches throw if `rg` or
`git grep` fails to run or exits 2 or higher (exit 1 means "no match" and is fine); a missing `rg` is an error, never a
silent zero.

## The sealed set

`questions.json` is **version 2** (sealed 2026-10-15): per repo, the sampled commits (sha, parent sha, subject, answer
paths) and nothing else, no repo content. `questions.sha256` is its digest; `pnpm bench:findfiles` refuses to run if the
file no longer matches. Version 1 (`questions.v1.json`, `questions.v1.sha256`, digest 374a2878...) is kept for history: it
sampled every non-merge commit, so on merge-commit repos it included side-branch commits the doc said it excluded. Version 2
samples `git log --first-parent --no-merges`, i.e. the first-parent chain. Its seed is 20261014.

`node tools/bench/findfiles-bench.mjs --build-questions` refuses to overwrite an existing seal unless you pass `--force`
(and then you should keep the old files and bump the version). Its eligibility filter counts non-stopword words in a subject
using the BUILT analyzer's `ASK_STOPWORDS`, so rebuilding the set against a different analyzer build can change which commits
qualify; the sealed file, not the code, is the record.

Subset runs (`--repos`, `--limit`) write `...-partial` result files and never overwrite the dated full run. A run's
checkpoint rows are stamped with the questions sha and a hash of the analyzer files S depends on, and are discarded on mismatch.

Reproduce from a bare checkout:

    pnpm install --frozen-lockfile && pnpm -r build
    node tools/bench/data/findfiles-heldout/download.mjs      # clones the six repos at the pinned shas (full history)
    pnpm bench:findfiles && pnpm bench:closure                # results -> report/raw/bench-*.json, tools/bench/out/*.md
    pnpm bench:test                                           # the pure-helper tests

Set `SEQUENCE_BENCH_CACHE` (or `--cache`) to choose where the clones live; the default is the OS temp dir.

## Can the ranker have seen these repos?

Not provable from this tree. The shipped LightGBM ranker is a port of the frozen `harness-study search3/ltr` model, and
the list of repos it was trained on lives in that external study, not in this repository (`askLtr.ts` says only "8 sealed
repos"). What is excluded: codeforge, ml-harness and premai (the owner's own repos, named training/tuning data in the
bench program), and every repo the in-tree evals and prior find-the-fix runs used (`report/raw/find-the-fix-*`:
codeforge, ml-harness). The six chosen here come from the qa-loop pinned OSS set. If any of them was among the study's
unnamed 8, the S arm is advantaged on it; treat the result as "held out as far as the tree can show".
