# The length control — registered before the first call

**Written 2026-09-05 after `f26f1431`, before any run.**

## The one thing the arm result leaves open

Three belts, three chart-call results:

| belt | chars | chart calls |
|---|---|---|
| full | 7,219 | 4, 12, 5, 7, 9, 9 |
| mid (BOTH chart bullets, verbatim) | 1,181 | 0, 0 |
| short (one bullet) | 654 | 0, 0 |

Content cannot explain this. The mid belt contains both chart bullets byte-identical to the full
belt — a test asserts it — and still produced zero. So either the cause is in the ~6,000 characters
the mid belt drops, or **it is length itself**, and nothing so far separates those two.

## The control

The mid belt padded to the full belt's length with text the model **cannot act on**: plain prose
about nothing in the domain, no rules, no tool names, no imperatives. Same rules, same bullets,
same order — only the character count moves.

## The prediction

**Chart calls stay at 0 on both runs.** I expect length is not the variable either, because a model
padded with inert prose has been given nothing new to obey, and because "more characters" is not a
mechanism anyone has proposed a reason for — it is the residual left when content was ruled out.

**Refuted if chart calls rise above 0 on both runs.** Then belt length itself is the variable, the
content of those 6,000 characters never mattered, and the finding is far stranger and more useful
than another wording result: it would mean this model's tool use responds to prompt bulk.

Direction agreement required, two runs. Anything inside [0, 0] is no evidence.

## What each outcome makes the next step

- **Stays at 0** → the cause is inside the ~6,000 characters the mid belt drops, and the next arm is
  a **bisection of that text**, not a rewrite. Halve it, run two, keep the half that carries the
  calls.
- **Rises** → stop editing the belt entirely. The next work is the deterministic visual, because a
  contract whose bulk matters more than its content is not a contract worth tuning.

Either way this is twenty minutes on the card and it decides whether the deterministic-visual work
is necessary or merely better.
