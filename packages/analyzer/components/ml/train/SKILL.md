---
name: train
description: ML training loop: name the data, split, metric, and compute you have; measure a baseline before training; never invent metrics. Use for Unsloth or Halo workflows and for dataset and metric checks before a run.
---

# Train

A Sequence-native ML loop: measure the data and the eval before you change training.

## Before any training change

Name, from files you opened or commands you ran:

- **Data** — which dataset, on disk where, how many rows you counted (not a README figure you did not recompute).
- **Split** — train / val / test as the project actually defines them. If there is no split, say so and stop until the user chooses one.
- **Metric** — the metric the project already uses. Do not pick a new one to make a run look better.
- **Compute** — the GPU, CPU, or host you actually have. This machine is not a cluster. If the job needs more than you have, say so.

Then measure a **baseline** with the current code and data. A training change without a baseline is not an improvement; it is a new number with no comparison.

## Catalog skills in this stack

- If Halo skills are in the bundled catalog (group `ml`: data, launch, checkpoints, optimize, and the rest) **and** the user is in a Halo checkout, follow those skills. They expect a clone of [Halo](https://github.com/whitecircle/halo); ask before cloning.
- If RSI-Anything is in the catalog (`ml/rsi-anything`) **and** the user is in that stack, follow that skill. Upstream: [RSI-Anything](https://github.com/Gen-Verse/RSI-Anything).
- [Unsloth](https://github.com/unslothai/unsloth) is link-only in the catalog. Do not copy Unsloth into the workspace. If the user wants it, they install from that repo. Do not add it as a surprise dependency.

## Grounding

- Never invent loss, accuracy, perplexity, tokens/sec, or GPU memory. Quote the trainer log or the eval command output.
- If a metric is missing from the log, it is unknown.
- Do not start a long train without the user confirming the hardware and the job. If the GPU or host is missing, say so.

## When to stop

Baseline measured, or the missing piece (data, split, metric, compute) is named. Do not "just start training" to fill the gap.
