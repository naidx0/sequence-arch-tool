# Stage four — the carry redesign, registered before it is built

**Written 2026-09-06, before anything is built and before any card is taken. On the ask path.**

## The planned experiment cannot run, and this is why

Stage four was ordered as: *the planted fact inside the excerpt cap against the same build with it
beyond, differing in where the fact sits and nothing else.* That experiment is void as designed, and
the reason was found by reading the carry's three write gates together rather than by spending
ninety minutes to discover it.

**There is no excerpt to plant a fact in — on either arm.**

| slot | written only when | on a teach bench turn | on an engineer's ask |
|---|---|---|---|
| `filesRead` | `askIntent === 'edit'` **and** auto-write permission **and** a path containing a **slash** | never | never |
| `chart` | `lastChartThisTurn` — one assignment, inside `input.teach === true` | yes (67–71%) | never |
| `concept` | `input.teachContext` — constructed nowhere but `teachTurn.ts` | yes | never |

The excerpt cap (`MAX_EXCERPT = 600`, `FULL_EXCERPTS = 3`) governs a slot that **neither instrument
can fill**. A run comparing a fact inside the cap against a fact beyond it would compare two empty
carries and report no difference, and the no-difference would look like a result.

**That is the belt's clause-2 mistake a second time** — a threshold on a quantity the instrument
cannot produce — caught this time before the card, and by the cheaper instrument.

## Two findings that stand on their own

**1. The carry is structurally empty on every first-tier ask.** All three slots are gated to teach or
to edit intent. An engineer asking a question about a system gets an empty carry on turn 1, turn 2
and turn 20. Stage one measured the carry on the teach bench, where two of three slots do fill; it
was never measuring the tier the identity says matters.

**2. A picture the model draws on an engineer's turn is not recorded.** `propose_chart` survives on a
non-teach ask (it is in `ASK_TOOL_ALLOWLIST`, it is not mutating, and `askToolsForJobMode` filters
only `ASK_MUTATING_TOOLS`), and the belt run proved the model calls it. But the carry's `chart` slot
reads `lastChartThisTurn`, which the tool path does not set. So the one drawing the engineer path can
produce is the one thing the next turn is not told about.

Both are gates now, not readings: `packages/analyzer/src/server/turnCarry.reach.test.ts`. Six cases;
each of the three conditions was removed in turn and a case failed each time.

## What the next turn actually needs — the question stage four was told to ask first

Not *how much to carry*. The seat read answers it concretely.

Turn 1 answered from a `who_calls` tool result — `cli.ts`, `diagramCli.ts`, `doctor.ts`, `index.ts`,
`collectEnvReads.ts`, and a count of 84. Turn 2 asked **"of those, which one would I have to change
first?"** The word *those* refers to that list. **The carry has no slot for a tool result at all** —
not capped, not truncated, absent. So turn 2 was asked to rank a list it had not been handed, and it
did what a model does with a missing antecedent: it answered about the subject it still had, and told
the engineer to edit `scan.ts`.

**The redesign is a fourth slot: the referents of the previous turn's own answer** — the items a tool
returned and the answer was built from, with the count, as names. Not file bytes. A list of five
names and a number is under 40 tokens and is the exact object the next question is about.

## The planted case, moved inside

The planted case was ordered as a separate experiment across the excerpt cap, and the cap governs a
slot nothing fills. **It is not deferred and not dropped — it is the shape of the treatment arm
itself**, transplanted onto the slot this redesign actually creates.

The referents slot carries a bounded list of names. So the cap under test is **how many referents are
carried**, and the planted case is the same design the excerpt version had:

- **the planted item is the one the follow-up question must name** — the dependent an engineer would
  actually have to change first;
- **arm A places it INSIDE the carried list**; **arm B places it BEYOND the cap**, in the tail that is
  dropped;
- **the two arms differ in where the item sits and nothing else** — same build, same flag on, same
  three turns, same repository, the same list in the same order but for the planted position.

That makes clause 1 a two-sided measurement rather than a one-sided one. If turn 2 names the planted
item when it is carried and does not when it is dropped, the carry is doing the work. **If it names
it in both arms, the model had it from somewhere else and the carry is not what supplied it** — which
is the null result this design exists to be able to see, and the one the excerpt version could never
have produced.

**The cap value is registered before the run at the current `MAX_FILES` of 8**, so it is not chosen
after seeing which value flatters the result.

## THE ARMS DID NOT RUN. The carry is not connected to the product at all.

**Checked as the last precondition, before the card was taken. It fails, and it fails wider than the
finding this page opens with.**

`input.carry` is read in exactly two places — `askPipeline.ts:2310` (rendered into the prompt) and
`:4071` (folded into `carryOut`). **Nothing in the product ever sets it.** Both `/api/ask` routes
build their pipeline input without it; the only occurrence of the word in either region is a comment
about teach narrowing. `carryOut` is computed, then listed in `INTERNAL_FIELDS` and stripped from the
payload, under a comment saying *"it is the CALLER's job to persist it and pass it back"* — and no
caller in the product does. **`tools/bench/teach-eval.mjs` threads it** (line 357, 383). The product
never has.

So every turn a person takes runs with `input.carry === undefined`. The fourth slot fills `carryOut`
and it is thrown away.

**This is the second void caught before a card in the same stage, and the wider one.** The first said
the carry is empty on an engineer's ask. This says the carry is empty on *every* turn of the product,
including the teach turns where all three original slots do fill. Stage one's arms moved on the bench
because the bench is the only thing that has ever threaded it.

### What it means for stage one's numbers

Nothing measured on the bench transfers to the product, and this is a stronger statement than the
tier objection already on this page. It is not that the bench measured the wrong tier — **it is that
the bench measured a mechanism the product does not run.**

### The fix is tractable, and it is a product gap rather than an experiment's problem

Conversation identity already exists on the ask route: `resolveAskThreadId` takes an explicit
`threadId` when the request carries one and falls back to the workspace's active session, which is
how teach turns already find their thread with no client change. A bounded per-thread store, written
after each turn and read before the next, is what is missing.

**One design question belongs to whoever schedules it rather than to this page.** Wiring the carry
changes teach turns in the product for the first time — chart and concept would begin to carry there,
which nothing outside the bench has ever done. On a first-tier ask it can only deliver referents,
because the other three slots are structurally unreachable there and there is a gate that says so.
So the seat arms stay clean either way; the teach blast radius is the part that needs a decision.

**No card was spent. The arms remain registered and unrun.**

## Two corrections made before the arms ran, not after

**1. The planted case is on the REFERENTS cap, not the excerpt cap.** The excerpt slot is still
unreachable on an ask turn — that is the finding this page opens with, and it did not change when the
fourth slot was built. A plant inside an excerpt would still be a plant in an empty slot.

**2. The positional plant cannot be run faithfully on the real repository, and here is why.**

Two arms must differ in where the fact sits and in nothing else. On a fixed repository with a fixed
turn-1 question, the caller list and its order are fixed, so the position of any given item is fixed
too. Every route to varying it breaks the rule it exists to serve:

| route | what it actually varies |
|---|---|
| change the cap (8 vs 12) | the whole carried set — four extra items, not one item's position |
| add a file that sorts into or out of the first 8 | the repository, hence the build |
| reorder the list behind a test-only variable | product machinery built to serve a measurement, which is the instrument writing its own result |

**So it is not run as a positional plant.** Stating that here rather than substituting quietly, and
rather than running an arm that would report a difference nobody could attribute.

### What replaces it, and why it discriminates better

The positional plant existed to separate *the carry supplied the item* from *the model had it
anyway*. **Attribution inside each transcript does that directly, and needs no second arm:**

> For each item turn 2 names, ask where it could have come from — the carry block, turn 2's own tool
> results, or turn 2's own prose. **An item that appears in the carry and in NO tool result of that
> turn was supplied by the carry.**

That is a per-turn judgement against recorded evidence, not a between-arm inference, so it survives
the arms being fewer than anyone would like. The arms remain flag-off against flag-on, which is the
control this page registered from the start and the one the control law requires.

**The positional version stays available on a FIXTURE**, where the graph and its order are ours to
set. It is not run here because a fixture cannot show that an engineer gets a better answer — only
that the mechanism moves — and it should be labelled that way when it runs.

### The plant exists already, and the repository placed it

Computed before the card with `tools/bench/referent-list.mjs`, which calls the product's own
`who_calls` rather than reimplementing it. `scan.ts` has **84 distinct callers**; the cap carries the
first **8**:

```
cli.ts · diagramCli.ts · doctor.ts · eval/grade.ts
functions/repoFunctionGraph.ts · harness/designDrawBaseline.ts · index.ts · moat/collectEnvReads.ts
```

**Five of those eight are what turn 1's answer already said out loud** — `cli.ts`, `diagramCli.ts`,
`doctor.ts`, `index.ts`, `collectEnvReads.ts`. Prior prose is already carried by the product, so a
turn 2 naming one of those proves nothing: it could have read it in the previous message.

**Three are not: `eval/grade.ts`, `functions/repoFunctionGraph.ts`,
`harness/designDrawBaseline.ts`.** They are in the carried list and in nothing else the next turn can
see. **They are the plant** — a fact inside the cap that is reachable only through the new slot — and
no machinery placed them there, so nothing about the arm is built to serve its own result.

**Clause 1 is therefore sharpened, before the run:** *turn 2 names at least one of those three.*
Naming only the five is recorded as **inconclusive, not a pass**, because the prose explains it.

### What naming one of the five means, stated before the run

It means **the model used prose it already had**, and nothing more. Turn 1 said those five aloud;
prior chat prose is carried by the product independently of any carry slot, so turn 2 naming one of
them is the behaviour that already existed before the fourth slot was built.

It will look like partial success. It is not:

- it is **not** weak evidence for the carry — the carry is not the only path to those names, so it is
  no evidence for the carry at all;
- it is **not** evidence against the carry either, because the second law holds here as everywhere:
  a turn that had two sources and used the older one tells you nothing about whether the newer one
  worked;
- reported as "turn 2 named an item from turn 1's list", it would be **true and worthless**, which is
  the most dangerous shape a result can take in this programme.

**Only `eval/grade.ts`, `functions/repoFunctionGraph.ts` or `harness/designDrawBaseline.ts` count.**
If the run produces only the five, the result page says *inconclusive* in its first line and the
arms are not banked in either direction.

### One thing the list shows that is not good news

The carried eight are the first eight **in scan-edge order**, not the eight that matter. Of the 84
callers, **76 are test files**; the cap landed on source files here because edge order happened to put
`src/` before `src/test/`. **That is luck, not a property.** A target whose edge order ran the other
way would hand the next turn eight test files and ask which to change first.

**Registered as a known weakness now rather than discovered as a surprise later:** the slot carries a
prefix, and a prefix is not a ranking. If the arms show the carry works, the next question is which
eight, and that question is not answered by this run.

## Telling a FRAGMENT-DRIVEN answer from an ABSENT one — named before the transcripts exist

The worst outcome of this change is not a null. It is **a confident answer assembled out of eight
names whose contents were never read** — the fabrication risk clause 5 registers. That failure and a
plain absence look similar in a summary and are opposite in what they mean, so the record separates
them by these rules, fixed now:

| what the transcript shows | reading |
|---|---|
| turn 2 names no carried item and says it cannot rank them | **absence** — the carry did not help, and the turn was honest about it |
| turn 2 names carried items and ranks them **citing a read or a tool result** | **the intended outcome** |
| turn 2 names carried items and ranks them **citing nothing**, with no read and no tool call that turn | **FRAGMENT-DRIVEN — the failure**, and it is worse than the null |
| turn 2 asserts what is *inside* a carried file — its contents, its role, what it would break | **FABRICATION**, recorded as such regardless of clause 1 |

**A clause-1 pass obtained by the third or fourth row is reported as a failure, not a pass.** The
carried block says in words that the contents were not read; an answer that describes them anyway is
the model speaking past its own evidence, and banking that as "the follow-up named an item from the
list" would be the exact shape of a green gate over a broken product.

## The control, written before the change is built

Per the law ruled in on 2026-09-06: an arm's control must differ from the treatment in the change
under test and nothing else.

- **The change ships behind `SEQUENCE_ASK_CARRY_REFERENTS=1`**, default off, so the control and the
  treatment are **the same build** and the flag is the only difference.
- **The control runs first, on the build that already carries the flag, with the flag off.** Its
  commit is recorded in the result page. If any source moves between the arms, both are re-run.
- **Two runs a side**, and a difference counts only when both runs on one side fall outside the
  other side's range with direction agreement.

## The kill numbers — each on a quantity this change can move

The change puts the previous answer's referents in the next turn's prompt. So every threshold below
is on **whether the next turn's answer uses them**. Everything else is a watch-line.

1. **The follow-up names an item from the prior turn's list.** Today it structurally cannot come from
   the carry, because the list is not there. **Registered: on a three-turn dependency conversation,
   turn 2 names at least one item from turn 1's tool result. Refuted if it names none in both runs.**
2. **The pronoun in turn 3 resolves to turn 2's answer** — the failure the seat read found and no
   token check saw. Judged by reading the three turns, and the judgement is written down with the
   quotes so it can be disputed. **Watch-line, not a kill**: one conversation cannot carry a
   threshold, and the fifth law forbids pretending it can.
3. **Turn 2 must not stop reading files.** A carry that hands over a list may make the model answer
   from the list alone. Today turn 2 read **zero** files, so this cannot fall further — **it is a
   watch-line by the sixth law, not a kill**, and the honest form is: *if turn 2 still reads zero
   files, the carry changed what it was told and not what it did.*
4. **Refusals must not rise.** Stub rate within the control's range, on matched turns.
5. **Fabrication must not rise.** `claims.unsupportedTechnologies` per turn, now that the bench
   records it, against the control's range. **Kill: refuted if it rises in both runs.** A carry of
   names is exactly the material a model can invent *around* — it is handed five file names with no
   contents and may describe what is in them.

Number 5 is the one to watch hardest. It is the first change here that adds *unbacked* material to
the prompt: a name without the bytes.

## What could go wrong, and how this registration would detect it

- **The referents are carried but the model ignores them.** Detected by clause 1 naming none — a null
  result, correctly attributed, because the flag is the only difference.
- **The referents crowd out something load-bearing.** The belt run showed removing a section changes
  behaviour in the opposite direction to the expected one. Detected by clauses 4 and 5, and by the
  chart rate, which is reported beside them.
- **The list is stale by the time it is used.** A turn's referents describe the repository at that
  turn. Nothing here re-checks them, so a file deleted between turns is carried as a name that no
  longer resolves. **This is a known hole, registered as one**, and the mitigation is that names are
  carried as names — never as a claim about contents.
- **The measurement is done on the teach bench again.** The whole finding above is that the teach
  bench cannot see the first tier. **The control and the treatment run on the seat instrument**, and
  a bench run is reported only as a supplement and labelled as the wrong tier.

## What this does not claim

- **Not that the cap question is dropped.** It is folded in above rather than deferred — see *The
  planted case, moved inside*.
- **Not that carrying referents fixes turn 2.** Turn 2 failed for at least two reasons — it lacked
  the list, and it also read nothing. This addresses the first.
- **Not a claim about the product's drawing.** The Architecture board draws the scanned graph from a
  scan with no turn at all. This is about the conversational path only.

## Two instrument corrections, registered before the arms run

**1. The arms drive the HTTP route, not the browser.** The registration said "seat instrument". Two
things forced the change and both are recorded rather than slipped in:

- **Attribution needs this turn's tool activity separated from its answer, and the DOM does not
  separate them.** There is no tool-receipt `data-testid` in the chat, so the only page-level text
  available contains the answer *and* the receipts together — every carried name would match both and
  attribution would refuse everything. **Adding a testid to make the measurement easier would be the
  instrument writing its own result**, which this page already refused once over the positional plant.
- The HTTP route is the same server, the same `carryStore`, the same prompt. What it gives up is the
  rendered page, and **clause 1 does not use pixels** — it asks what turn 2 *names*.

**The picture question is a different measurement and still needs a browser.** Nothing here touches
it.

**2. Attribution takes which tools RAN, not what they returned.** The rule was written as *an item in
the carry and in no tool result of that turn*. Building the runner showed the tool's output is not
observable from outside the server: `tool:done` carries a short evidence label and the result body
goes into the prompt. So the rule is now:

> **turn 2 ran no tool and named one of the three → the carry is the only possible source.** Prior
> prose never spoke those three and nothing was fetched. **Any tool at all → attribution refused**,
> whatever it named.

Refusing on *any* tool is deliberately blunt. A `read_file` on an unrelated path almost certainly did
not produce these names — but "almost certainly" is how a flattering attribution gets made, and a
flattering error is the one nobody re-examines. **The blunt rule can only understate the carry's
contribution, never overstate it.**

Both rules are implemented once in `tools/bench/lib/seat-grade.mjs`, applied identically to every
arm, and each was made to fail before any card was spent.

## What mechanism B still needs before a card is taken — checked, not remembered

**Established 2026-09-07T07:1xZ by reading the instrument, not by recalling it.** Mechanism B has
never been run and is not merely waiting for a free card:

| blocker | evidence |
|---|---|
| the seat script cannot read this measurement | `tools/ci/seat-turn-three.mjs` has **zero** references to referents, attribution or naming — it has the four token checks and nothing else |
| the flags cannot reach the running app | the seat drives the product over HTTP, so `SEQUENCE_ASK_CARRY_WIRE` and `SEQUENCE_ASK_CARRY_REFERENTS` must be set on the **server** process; neither `.claude/launch.json` nor `start.sh` carries them |
| the arms need a restart each | a flag read at process start means one app per arm, each re-validated against `/api/build` for both halves |
| the new checks are unproven | every check added tonight that was not made to fail had a hole in it |

**The control is the same build with `WIRE` ON and `REFERENTS` off** — not the pre-wiring build.
Mechanism A shipped since this page was written, and a control taken before it would differ in two
changes, which is the confound law 42 exists for.

**The arms interleave** — control, treatment, control, treatment. Blocking them is what nearly sold
mechanism A a three-point chart rise that its own control variance covered.

**Deliberately not started at 04:00 on 2026-09-07**, with the card free and uncontended. The
instrument work above is about an hour, and four instruments built in haste tonight each reported
green while being wrong — the overwrite that deleted three arms, the absent-is-not-zero, the guard
that killed the arms it was protecting, and a pre-push gate that certified a tree nobody pushed.
Building this one tired is the same bet those lost.

## Card cost

**Zero until the control runs.** The finding above, the gate and this page cost no card. The control
and treatment arms are seat reads — three turns each, four arms, roughly 25 minutes of card in total,
which is a quarter of what the void experiment would have spent to learn nothing.
