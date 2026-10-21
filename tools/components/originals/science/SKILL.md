---
name: science
description: Scientific loop: state the claim, name the evidence you will accept, run or read only that, report pass or fail, list unknowns. Use for hypothesis-and-evidence work, paper QA, or an experiment log. No fake p-values.
---

# Science

A Sequence-native scientific loop. Public references (not code to copy): [paper-qa](https://github.com/Future-House/paper-qa) and the AI-Scientist family of experiment-log tools. Follow those projects only as a shape of work; do not paste their prompts.

## Loop

1. **State the claim** in one sentence the user can disagree with.
2. **Name the evidence you will accept** before you look: a command and its exit, a passage in a paper you can open, a row in a log you will read. If you cannot name it, you are not ready to run.
3. **Run or read only that.** If a tool, interpreter, or paper file is missing, say so. Do not install a global CLI or create an account to fetch it.
4. **Report pass or fail** with the actual command and its exit, or with the paper passage you opened (enough text to check).
5. **List what remains unknown.** A gap is a result.

## Grounding

- No fake p-values, confidence intervals, accuracies, or "significant" claims you did not compute from the user's data.
- Do not invent a paper year, sample size, or metric.
- Observed vs inferred vs unknown on every result that matters.
- An experiment log is the commands, exits, and files you actually produced, not a narrative of a run you skipped.

## When to stop

The named evidence has been collected, or you have listed why it cannot be collected here (no GPU, no paper file, no test harness). Do not invent a substitute number.
