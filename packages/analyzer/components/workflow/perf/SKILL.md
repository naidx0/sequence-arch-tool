---
name: perf
description: Measure before you repair: a fix destroys the evidence. Name the subject, keep the whole log, read the bare exit. Isolated fixtures only; never real user chats. Optional Lighthouse or web-vitals if already installed.
---

# Perf

Sequence rule: **measure before you repair**. A fix destroys the evidence it needed. A transform that removes nothing still reports success if you do not keep the before-number.

## Loop

1. **Name the subject.** Fresh chat vs restored board vs packaged app are different clocks. Startup and delete latency are different clocks. Say which one you are measuring.
2. **Measure first.** Run the existing bench, test, or fixture. Keep the **whole log** in a file. Read the **bare exit** of the command; never pipe the gate through `tail` or `head` (the pipe's exit is not the command's).
3. Repair only after the before-number is on disk.
4. Measure again with the same subject, same command, same fixture. Report before, after, and the command.

## Fixtures

- Isolated fixtures only. Never real user chats, never the person's board, never production paths another lane is using.
- If the repo already has a perf bench, use that. Do not invent a new harness when one exists.

## Optional web tools

- Lighthouse or web-vitals only if they are **already installed** in the project. Do not add them as a surprise dependency. If they are missing, say so and use the repo's own bench.
- Web vitals from a tool you did not run are unknown.

## Grounding

- Quote the number the command printed, with the log path and the exit code.
- Do not average in your head. Do not drop slow runs.
- If the log was truncated, the measurement is void; re-run and keep the whole file.

## When to stop

Before and after exist for the named subject, or you have said what you could not measure (no fixture, tool missing, subject mixed). Do not ship a "should be faster" patch without the before-number.
