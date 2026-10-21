---
name: rsi-anything
description: Set up and run RSI-Anything, a research framework whose loop is propose, predict, select, evaluate, learn and retain, driven by world-model predictions and interaction feedback. Use when the user wants to reproduce or extend one of its workflows (code repair, GUI interaction, or another domain adapter), or wants to understand how its self-improvement loop is wired.
---

# RSI-Anything

RSI-Anything is a Python research codebase (Apache-2.0 project code) for recursive self-improvement with world models. It is built on JEPA-Anything. A domain supplies its own state, actions, prediction targets and external feedback. The loop itself stays the same across domains.

Domains in the repo: code repair (CodeContests, APPS Introductory, LiveCodeBench), GUI interaction (MiniWoB++, OSWorld), laboratory planning, reaction optimization, and immune science.

## When to use

- The user asks to run, reproduce or extend an RSI-Anything workflow.
- The user wants a new domain adapter, which means a `plan(config)` function and a `results(run_root)` function.
- The user asks how the loop works in this codebase.
- Not for general agent work. Training stages need GPUs and large downloaded assets, so confirm the hardware and the download size with the user before starting one.

## Set up from source

1. `git clone https://github.com/Gen-Verse/RSI-Anything.git` and `cd RSI-Anything`.
2. `python3.10 -m venv .venv`, activate it, then `python -m pip install -e .`. This installs the shared `rsi` command, which uses only the standard library.
3. `rsi tasks` lists the available tasks.
4. Each task runs in its own interpreter. For code repair, follow `docs/reproduction.en.md`. For GUI, create `.venv-gui`, run `pip install -e 'tasks/gui[browser]'` and `python -m playwright install chromium`, then follow `tasks/gui/README.md`.

## Commands

- `rsi plan --config <recipe>` prints the stages and resolved paths without creating a run. Run this first.
- `rsi run --config <recipe>` executes the stages in order. Add `--resume` to continue a run.
- `rsi status --run <run_dir>` reads progress. `rsi report --run <run_dir>` combines the state with the task's result files.
- Recipes live under `configs/`. `configs/gui/smoke.json` runs real browser episodes with a rule controller and is the cheapest first check.

## The loop

1. Propose: a policy suggests candidate actions or program revisions.
2. Predict: the world model estimates each candidate's outcome.
3. Select: the predictions rank the candidates, and the top ones are carried forward.
4. Evaluate: the selected actions receive external feedback, such as tests, a browser result, or a measured yield.
5. Learn: the observed transitions update the models.
6. Retain: a checkpoint that beats the incumbent becomes the starting point for the next round.

## Design the loop as a workflow

When the user wants the loop as a runnable workflow, or asks to see it, build it with `edit_workflow` instead of describing it: an Agent block to propose, a Checker block for the external feedback, a Test runner block for the measured check, and a Loop block around them with `span` set to the blocks it repeats and `maxIterations` as the cap. The Loop repeats its blocks until the Checker passes. The chat shows the workflow inline, loops and their way back included, and the user can open it on the workflow surface. Do not draw the loop by hand on a Space when `edit_workflow` can hold it.

## Run records

A run directory holds `config.json` (the resolved recipe), `state.json` (stage status and output hashes), `summary.json` (metrics and status), and `logs/workflow/` (one log per stage attempt). Resume needs the same recipe and the same source. Changed scientific inputs need a new run root.

## Working rules

- Read `state.json` and `summary.json` before reporting a result, and quote metrics as the report command prints them, with the run directory.
- Keep run roots and checkpoints out of version control.
- A filesystem lock stops two runners from owning one run. If a run looks stuck, check for the lock before deleting anything.
- Do not claim a benchmark number that the user's own run did not produce. The README figures are the authors' results.

## Licence and notices

Project code is Apache-2.0 (see `LICENSE` in this folder). Third-party code, models and datasets keep their own terms, listed upstream in `THIRD_PARTY_NOTICES.md`. Model weights and datasets carry the terms of their own release.

## Source

The upstream repo has no skill file. This SKILL.md is original text written from the upstream README and `docs/workflow.md`. The pinned commit is in `NOTICE`.
