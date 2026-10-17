# A symbol index for lesson retrieval — the criterion, written before anything is built

**Registered 2026-09-10 by the Sequence teach lane. Nothing here is built, and this page does not
authorise building it.** It exists so that whoever owns the analyzer core can tell a real fix from a
change that moves one number and quietly costs another — which is what every candidate tried so far
has done.

## The gap, in one sentence

Teach mode retrieves a lesson's concept by matching the ask against **file names**. Four registered
bank lessons are about subjects that live **inside** files rather than in their names, so the lookup
returns nothing and the turn falls through to the general-knowledge draw — a remembered picture where
a grounded one exists.

## The acceptance set: four lessons, by id

| id | ask | subject lives in | file tokens | ask supplies |
|---|---|---|---|---|
| `harness-03` | *"Teach me the verify contract: what it demands and when."* | `harness/verifyGate.ts` | verify, **gate** | verify |
| `harness-06` | *"Teach me how tool calls are parsed from fenced blocks here."* | `server/askTools.ts` (`parseFenced…`) | **ask**, tool | tool |
| `harness-05` | *"Teach me what the round budget is and how the loop spends it."* | `server/askTools.ts` (`MAX_ASK_TOOL_ROUNDS`) | ask, tool | **nothing** |
| `harness-08` | *"Teach me what the architecture digest is and how it is budgeted."* | `explain/explain.ts` (`buildDigest`) | explain | **nothing** |

**These are two faults, not four.** `harness-03` and `harness-06` share a word with their file and
are blocked only by `askNames` requiring **every** token of a name to appear in the ask.
`harness-05` and `harness-08` **share no word at all** — their subjects are symbols, and the graph
indexes files by name, so **no filename rule can ever reach them**. A candidate that only loosens
matching is answering the first fault and cannot touch the second.

## The three numbers, which must hold together

A candidate is accepted only if **all three** hold in one measurement. Each alone is satisfiable by a
change that ruins another, which is the whole reason this is written down.

| | required |
|---|---|
| in-repo lessons wrongly drawn from general knowledge | **0 of 13** (today: 4) |
| absent subjects the draw missed | **0 of 3** (today: 0) |
| general questions drawn | **12 of 12** (today: 12) |

The second and third are what stop a fix from being bought by breaking the honest-refusal path. The
banks are the 13 registered bank asks (`subjectless-lesson.test.ts` case 6) and the three general
questions of §13 — *machine learning*, *a transformer*, *backpropagation*, four runs each.

## The measured evidence that no filename rule satisfies all three

Applying **"at least one token"** in place of **"every token"** across the whole scanned graph
(1,112 nodes), card-free:

| | result |
|---|---|
| reaches the four | **4 of 4 — with the wrong concept at the head of the queue.** `learningLoop.ts` for `harness-05`, `teachTurn.ts` for `harness-08`; the right files are not in the first four |
| absent subjects | **breaks 1 of 3** — *"machine learning"* matches `learningLoop.ts` on `learning`, the queue stops being empty, the draw stops firing |
| general questions drawn | **12 of 12 → 8 of 12** |
| incidental | every ask opening *"Teach me"* matches `teachTurn.ts` on `teach` |

**A wrong concept is worse than no concept**: the turn then teaches, confidently, a file nobody asked
about. So the relaxation lowers two of the three and is not a fix.

## The shape any candidate must handle

This is the crux, and it is why the problem is structural rather than a matter of tuning:

```
harness-03   verifyGate.ts    [verify, gate]      ask supplies "verify"    → SHOULD be found
ml (absent)  learningLoop.ts  [learning, loop]    ask supplies "learning"  → MUST NOT be found
```

**One token of two, in both.** Any rule that reaches the first reaches the second. A candidate must
say what separates them — and *"the subject is a real thing in the repository"* is exactly the
knowledge a filename does not carry and a symbol index would.

Pinned by `packages/analyzer/src/test/teach-lookup-token-rule.test.ts`, which fails if either side of
that pair moves.

## What the criterion returns under the null

**A lookup that changes nothing must leave the first number at 4 of 13, not silently pass.** The
in-repo count is measured by running the 13 bank asks through `buildQueue` and counting empty queues;
it cannot be satisfied by a build where retrieval is unchanged. If a candidate reports 0 of 13 while
`teach-lookup-token-rule.test.ts` still passes unmodified, the measurement is wrong, not the code —
that test asserts `harness-03` is still missed, so the two cannot both be true.

**And a candidate that fixes only `harness-03`/`06` scores 2 of 13, not 0.** That is progress and it
is not acceptance; the criterion is the set, because the second fault is the one that needs the
index.

## What this does NOT ask for

- **Not a teach-path change.** The teach side is already honest about what it has: since `5730273e`
  the caption says *"drawn from general knowledge — not from this repository's scan"* and no longer
  claims the subject is absent. For these four that is true, if incomplete.
- **Not a ranking heuristic.** Every one tried has been a filename rule wearing a different hat.
- **Not a licence to grow teach mode.** `docs/CANON.md` orders the audience engineers first, builders
  second, learners third. A symbol index serves the engineer's ask first — *"which file implements
  the staleness detection"* is the same retrieval problem — and the lesson case is a beneficiary, not
  the justification.

## MEASURED 2026-09-10, before building: the mechanism reaches ONE of the four

**The criterion above names symbol indexing as the fix for `harness-05` and
`harness-08`. Simulated against the real tree, it reaches `harness-08` and not
`harness-05`, and the reason is not tuning.**

3,602 exported names across 489 files, extracted the way `scan.ts` would have
them at line 664, matched with the **existing** `askNames` rule applied to
symbols instead of filenames:

| | result |
|---|---|
| `harness-08` | **reached** — `Digest` in `explain.ts`, which is the right file |
| `harness-03`, `harness-05`, `harness-06` | **0 hits** |
| the three general questions | **0 of 3 break** — 12 of 12 survives |
| the other nine in-repo lessons | 0 spurious hits |

**Score: 3 of 13, not 0 of 13. By this page's own standard that is progress, not
acceptance.**

### Why the other three are unreachable by symbols too

Their subjects are **phrases in prose, not identifiers**:

| lesson | the learner says | the identifier is |
|---|---|---|
| `harness-03` | "the verify contract" | no `verifyContract` exists |
| `harness-05` | "the round budget" | `MAX_ASK_TOOL_ROUNDS` |
| `harness-06` | "tool calls parsed from fenced blocks" | `parseFencedSeqdProposals` |

A symbol index carries the names the *code* uses. These three lessons are named
the way a *person* describes the behaviour, and no index of identifiers closes
that gap — the same wall the filename rule hit, one level down. **`harness-08`
resolves only because someone happened to name a type `Digest` and the learner
happened to say "digest".**

### One correction the simulation forced on the match rule

The filename rule matches a bare substring at three characters, which is safe
for `jail.ts` and lethal for symbols: the first pass matched **`sel` inside
"itself"** and **`box` inside "sandbox"**, handing three lessons a candidate
from a coincidence of English. Symbol matching needs **word boundaries and four
characters**. With that, the spurious hits go to zero — and it is a rule the
criterion did not anticipate, so it is recorded here for whoever builds this.

### Not built, and the reason

This is a **scanner-wide change** — an index computed for every repository
Sequence scans — and on the evidence it moves one registered lesson from a
remembered picture to a grounded one while failing the bar this page registered
hours earlier. **`docs/CANON.md` orders the audience engineers first**, and the
case for a symbol index is the engineer's retrieval ask, not this lesson;
measuring that is a separate piece of work and nothing here speaks to it.

So the criterion stands and this candidate is recorded against it rather than
shipped. **The correction to the criterion is that symbol indexing alone cannot
satisfy it**, which is a thing this page claimed and the measurement disproved.

## Where the index would live — one line, for the lane that owns the analyzer core

**`packages/analyzer/src/scan.ts` already reads every file's source at line 664 to resolve its
imports, so the exported names are in hand at the moment the file node is built; `ArchNode.meta` is
documented as open (`packages/schema/src/index.ts:51`), and the consumer that would use it is
`askNames` in `packages/analyzer/src/server/lessonState.ts`.**

That is the whole handoff: no new pass over the tree, one field, one consumer. **Whether to spend it
is a product decision and this lane is not taking it.**
