# A lean teach belt for small models

Built 2026-09-23 in the cloud lab, on the 0.1.2 mirror. It is a draft to measure, not a change to ship.

## Why

Your standing thesis is "too many guardrails… dumb models run into walls". OpenBMB tells people running MiniCPM5 to "simplify system prompts to match training distribution". On 0.1.2, the belt the teach turn gets is 4,958 tokens, which is 30% of the 16k window, and it has 165 words in capitals.

Much of the belt now repeats what the code already does. The floor draws the chart. The derived check-in closes the turn. The reveal is appended in code. The grader bounces a missing check-in, a choice-offer, an unanswered mid-question, a missing visual, invented files and unread files. The mutating tools are refused.

## Size (belt only; the base prompt, digest and question come on top)

| | chars | ~tokens | share of 16k | hard-rule words | capitalised words | sections |
|---|---|---|---|---|---|---|
| current teach belt (0.1.2) | 19,832 | 4,958 | 30.3% | 13 | 165 | 9 |
| lean teach belt | 7,664 | 1,916 | 11.7% | 4 | 34 | 5 |
| of which the new TEACH MODE section | 1,272 | 318 | 1.9% | 0 | 2 | 1 |

The files are `teach-belt-current-0.1.2.txt` and `teach-belt-lean.txt` in this folder. The numbers come from `belt-audit.mjs`'s `measure()`.

## What changed

- **Dropped for teach turns (4 sections, ~1,505 tokens).**
  - CANVAS BLOCK CRAFT: the teach visual is propose_chart, and the contract itself says it is not canvas.write_*.
  - THE WHITEBOARD and SYSTEM BOARD: a teach turn draws on the AI canvas.
  - PLAN MODE: its rule that nothing gets edited is kept as one line in TEACH MODE, and the code refuses the tools anyway.
- **Kept unchanged:** TOOLS, CHARTS, WALK AN EXAMPLE THROUGH THE PICTURE, AI CANVAS.
- **TEACH MODE rewritten** from 1,805 tokens to 318: every rule kept, each as one plain sentence, no capitals, and no research citations in the prompt.

## Where each TEACH MODE rule lives now

| Rule in the current contract | Lean belt | Also enforced in code (0.1.2) |
|---|---|---|
| One concept, about 150 words | kept | grader bounce on word count |
| Ground in real node/file, cite file:line | kept | grader bounces invented files and files cited without being read |
| Ask comprehension questions as you go | kept, merged with the next rule | — |
| Answer the mid-lesson question in the same turn | kept | grader bounce on an unanswered mid-question |
| Close on a check-in | kept | grader bounce; derived check-in appended when the model has none |
| Name the real component in the check-in | kept, with a real-looking example | grader bounces a parroted example or a placeholder |
| Never ask a clarifying question | kept as "do not ask the learner to choose…" | grader bounces a choice-offer close; head's `deriveFlowCheckIn` replaces it |
| Never a second concept or an outline | covered by "one idea this turn" | word-count bounce |
| Grade a prediction honestly | kept | — |
| Re-explain when not understood | kept | — |
| Never ask about chart kind or format; never say tool vocabulary | kept (choose, draw, let them redirect) | grader bounce on output-option questions |
| The visual is propose_chart, not canvas.write_markdown | kept ("call propose_chart once") | floor draws a grounded chart when the model draws none |
| Every concept ships one visual, kinds, focusItemId, nodeId | kept, kinds list left to the CHARTS section | validator refuses invented nodeIds |
| Name what you are not covering | kept | — |
| Quantitative: work the numbers | kept | — |
| Make them commit, reveal unconditionally | kept, as "restate their guess when you reveal" | the reveal line is appended in code when an open prediction has an arrow |
| The reveal restates the prediction | kept | — |
| A wrong option only inside a question | kept | — |
| Sometimes close with the question they have not asked | dropped (optional style; the check-in rule covers the close) | — |
| Reading allowed; never edit or run | kept | mutating tools refused in teach mode |

## The one piece of counter-evidence, and how to test past it

Your own belt ablation (TEACH_BELT short/mid/pad in teach-eval) found that shorter belts lost charts, 9 to 0. The lean belt keeps the chart rule as an early, direct instruction ("Draw it: call propose_chart once…"), not buried at bullet 13. The floor also draws a chart when the model doesn't. Still, the thing to measure is whether the model's own charts survive.

**Suggested arm.** Add `lean` to the TEACH_BELT arms, using the text in `teach-belt-lean.txt` for its TEACH MODE section and dropping the four sections above on teach turns. Run it against the current belt at head:
- 10 or more runs a side, and log the gpu.lock holder.
- Score both with teach-eval's contract problems plus `tools/bench/lesson-quality.mjs --ab`.
- Watch four numbers:
  - model-drawn charts (not floor charts)
  - bounces per turn
  - turn seconds
  - lesson quality

If model charts hold and bounces don't rise, the 3,000 tokens are free room for the file contents the model reads.
