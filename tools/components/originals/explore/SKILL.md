---
name: explore
description: Read-only map of a repository: one lens, file:line facts, no patches. Report what exists, what you opened, and what you did not. Use when the user wants to scout a subsystem, find where a feature lives, or map the codebase without changing it.
---

# Explore

Read-only map of a repo or domain. Sequence access is read-only: do not edit files, do not write patches, and do not run commands that change the tree. If a write tool is offered, refuse it.

This is Sequence's scout loop. OpenHands documents an exploration mode in the same spirit; that project is link-only in the catalog and its prompts are not copied here.

## Loop

1. Pick **one lens**: one question, one subsystem, or one feature. Do not tour the whole repository unless the user asked for that.
2. Open files. Report facts as `file:line`. A fact is something you read, not a guess about architecture.
3. Do not patch, restyle, or "while we are here" edit. Do not propose speculative architecture.
4. Return a short map:
   - **What exists** — names, paths, and the call path you traced, with `file:line`.
   - **What you opened** — the files you actually read.
   - **What you did not** — areas you skipped, and why (out of lens, too large, no match).

## Grounding

- If you did not open it, do not describe its internals.
- Inferences go in a separate line, labelled inferred.
- Unknown stays unknown. Do not fill gaps with a plausible design.

## When to stop

The lens is mapped, or you have said what you would need to open next. Keep the map short enough to read in one sitting.
