# The tool budget per turn kind — and why a teach turn asking for the board gets two rounds

**A design note, from the code, prompted by Practical ML's four-turn walk of Teach mode.** I do not
have that walk's raw table — only its summary as relayed — so every claim here is checked against
the source and the walk is cited as the thing that asked the question.

## What the budgets are

| turn kind | rounds | where |
|---|---|---|
| everyday ask | **8** | `MAX_ASK_TOOL_ROUNDS` |
| a question that reads as a DRAW request | **2** | `DESIGN_DRAW_ASK_TOOL_ROUNDS`, via `isDesignShortPathAsk` |
| Full-permission edit turn | **16** | `FULL_EDIT_ASK_TOOL_ROUNDS` |
| caller-supplied `maxRounds` | 1–32 | `clampAskRounds`, `ASK_ROUNDS_CEILING` |

Two further stops end a turn before its cap:

| rule | value | meaning |
|---|---|---|
| `UNPRODUCTIVE_ROUND_LIMIT` | 2 | consecutive rounds returning nothing new |
| `EXPLORE_UNPRODUCTIVE_ROUND_LIMIT` | 3 | the same, for explore-intent asks |

The walk's turn 2 — *"stopped after seven because the last three rounds returned only things already
read"* — is that second rule firing exactly as designed.

## THE DEFECT: teach mode is not consulted when the budget is chosen

`resolveAskRoundCap` clamps to **2** whenever `isDrawishAskQuestion(input.question)` is true. It does
not look at `teach`. So the walk's turn 4 — *"asked for the board by name"* — was given the budget
designed for a **design-mode, no-repo** draw: one round to ask, one to land the diagram.

A teach turn cannot do its job in two rounds. Its own contract requires it to
**ground the concept in this repository — name the real node/file and cite file:line** — *and* ship a
visual. Reading the code takes at least one round, drawing takes another, and the grounding the
contract demands has nowhere to go.

Worse, the split is decided by **how the learner phrased the question**. The teach contract says
*every* concept ships a visual, so every teach turn draws — but only the turns whose wording reads
as drawish get clamped to 2. The same lesson gets 8 rounds or 2 depending on whether the learner
said "teach me how this works" or "show me the board". That is the budget being chosen by grammar
rather than by what the turn owes.

**This is the one place in the note where I think the budget is simply wrong**, and the fix is
small: `isDesignShortPathAsk` should not fire for a teach turn, because the two-round path exists
for design mode with no repository to read.

## Were the refusals correct under the second law?

**Turn 1, yes.** It spent eight rounds reading and then declined rather than guess. Absence of a
signal is not evidence of absence, and a turn that cannot ground a claim must not assert one — the
refusal is the contract working. What it exposes is different: the learner got nothing, and the cost
landed on them rather than on the model's confidence.

**Turn 2, yes and cheaply.** Three unproductive rounds is the explore limit doing its job; stopping
was right and stopping earlier would have been righter.

Neither refusal is a bug. Both are the budget spending a learner's turn on reading, which is a
product question rather than a correctness one.

## Should a turn that spends its budget reading still owe the check-in?

**Yes, and this is not a close call.** The closing check-in costs no tool rounds. A turn that read
for eight rounds and then declined can still end with a question the learner can answer — and a
turn that ends without one has taught nothing *and* left them nothing to do.

The visual is a different matter. `gradeTeachTurn` bounces a turn with no visual, and a turn that
spent its budget failing to find grounding has nothing honest to draw. Requiring a chart there would
force the model to invent structure, which `validateChart` correctly refuses — so the two rules can
conflict, and the visual rule should yield to the grounding rule rather than the other way round.

Measured against this: of 47 turns in the last bench run, **2 to 6 ended with a real check-in** and
**0 to 1 carried a visual**. The contract's closing beat is mostly not happening at any budget, so
the budget is not what is stopping it.

## What this note does not settle

Whether 8 is the right everyday number for a teach turn. The walk has one lesson of four turns and
the bench has twenty conversations at the default; neither varied the budget, so nobody has measured
what a teach turn does with 4 rounds or with 16. That is a two-run experiment under the existing
bar, and it should be registered before it is run.
