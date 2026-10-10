# Teach mode, driven end to end — what it actually does

**2026-09-09, `minicpm5-hermes` (Q8_0) on a local endpoint, against this repository. Task 9 of
`docs/TEACH-MODE-GOAL.md` is marked BLOCKED-ish on "needs a model"; it is not blocked, and what it
found is not what the goal doc describes.**

## 1. The owner's own sentence produced a repo grep

Asked *"I want to learn about machine learning. What is it?"* with `--teach`, teach mode answered
with **where that phrase occurs in the Sequence codebase** — two test files, `askIntent.ts:38`,
`docs/PIVOT-V2.md:67`.

| | |
|---|---|
| input tokens | **145,904** |
| coverage | **0 of 2,902 edges**, 10 components contributed nothing |
| lesson | none |
| refusal | none |

**The refusal clause was present and correct.** `subjectlessRefusal` says exactly the right thing.
It self-gated on `TEACH_ASK`, which listed five imperative forms — `teach me`, `teach us`, `give me
a lesson`, `take me through`, `walk me through` — and **not one way a person says they want to learn
something**. Measured: the queue for that ask is empty, so the second gate would have passed. The
first never let it through.

**Fixed at `69588b9c`**, by widening the recogniser to first-person intent rather than by writing a
louder instruction. Anchored on intent, not on the verb: *"the model learns from labelled data"* is a
claim about code, and a recogniser firing on the bare word would refuse ordinary questions about ML
source. Locking tests built from the reported shape, both RED first; the registered kill number is
unchanged at 4 of 13 bank asks. Verified on the product path — the app now answers instantly with
`source: lesson`, before any provider call.

## 2. There is no path to a lesson without a scannable repository

| path | result |
|---|---|
| CLI, empty repo | **exit 5** — *"nothing to scan yet"* |
| app, empty repo | **refuses to boot**, same message |
| pipeline / route | both accept `graph: null` — unreachable, because the scan gate is upstream |

**So the direction relayed on 2026-09-08 — learn about machine learning, drop a 2-hour lecture link,
show an LLM's architecture — is outside teach mode's input domain**, not a quality gap within it.

**And that is a conflict between two owner statements, not a defect.** `TEACH-MODE-GOAL.md`
(2026-09-04) is explicit: a lesson about *"his own codebase"*, with `file:line` evidence, *"the only
feature where Sequence has an advantage no generic tutor can manufacture."* None of the newer
examples is the user's repo. **Task 9 is blocked by the subject, not by the model.** Someone has to
choose; this page does not.

## 3. `--teach` on the CLI is not a teach turn

Only `repoServer.ts` calls `beginTeachTurn` (two sites). The CLI passes `teach: true` into the
pipeline and nothing else — no thread resolution, no lesson, no refusal. **So the fix in §1 helps the
app and does nothing for the CLI**, and a headless demo still gets the repo answer.

> **PARTLY CLOSED 2026-09-09 — the refusal now reaches the CLI; the lesson still does not.**
>
> `askCli.ts` calls `beginTeachTurn` and consults `refusal()` before the digest and before the
> provider, matching the server, which returns it as `{ text, source: 'lesson' }` ahead of any model
> call. Verified from the seat on **the real repository, 1,094 nodes / 2,907 edges**:
> `sequence ask --teach "I want to learn about machine learning"` — the owner's own sentence from
> §1 — now answers *"I could not find a subject for this lesson in the scanned repository"* and exits
> 0, where it used to paraphrase the digest. `--teach "teach me jail.ts"` is not refused and goes on
> to a real turn.
>
> **Only the refusal, and that is a stopping point rather than half a job.** The rest of a teach turn
> — lesson file, queue, concept, derived chart — is keyed on a thread, and `beginTeachTurn` refuses
> to file a lesson under a thread the caller did not name, because a guessed thread is a false record
> of what somebody was taught. A one-shot CLI ask has no conversation to name, so **inventing one
> would be precisely that guess.** `refusal()` needs no thread by deliberate design; the lesson does.
> Wiring the rest needs a decision about what a CLI conversation IS, which is item (c)'s neighbour
> and not this lane's to make alone.
>
> Locked by `packages/analyzer/src/test/teach-cli-refusal.test.ts` — a real child process against a
> real scan, with a stub provider that **records prompts**, so the refusal is proven to arrive
> *instead of* a model call (`prompts.length === 0`) rather than merely to appear. Two controls make
> it non-vacuous: the same ask **without** `--teach` still reaches the provider, and a teach ask that
> names a real file is not refused. A fourth case asserts the CLI **calls** the shared assembly and
> does not import `subjectlessRefusal` — this exact rule has already been two copies once, when the
> server had it and the browser bundle did not.

## 4. The no-interrogation contract SURVIVES composition — a hypothesis ruled out

The composed teach belt is **12,244 characters in four sections**, `TEACH MODE` last, closest to
generation. The three clauses are present, unconditional, and **uncontradicted**: no line anywhere in
the belt invites asking the learner to choose scope, format or level.

This mattered because the same interrogation pattern broke design mode, and because two of the three
prompt-level failures in this tree were a clause that *was* present — one self-gating, one
contradicted by another line. **Here it is neither.** Cheap negative, and it means a future
interrogation failure in teach mode is not explained by the belt.

## 5. CORRECTED — the lift was an instruction, not an example

**This section first said the contract's missing worked example was an evidence-backed gap, citing
49% → 80% on this model from one worked example. That figure was relayed to me in error and the
source lane has since separated what it had bundled. Corrected here rather than silently edited,
because the original is on origin and was wrong in the direction that would have driven a build.**

The ladder, n=20 throughout, which resolves about eight points:

| arm | examples | naming sentence | node-label F1 |
|---|---|---|---|
| bare | 0 | no | **53%** |
| naming rule only | **0** | **yes** | **79%** |
| one example | 1 | yes | 80% |
| two examples | 2 | yes | 81% |
| three examples | 3 | yes | 80% |
| one OFF-DOMAIN example (a cheese omelette) | 1 | yes | **79%** |

**53 → 79 is the result. 79/80/81/80 is one number four times.** The single sentence — *"Name EVERY
component the description mentions, including the client or caller at one end and the store at the
other"* — carries about 26 of the 27 available points. **An example about making an omelette scores
the same as a relevant one**, which is what you see when examples teach nothing.

### What that changes here

**The evidence does not say *show a worked example*. It says *tell precisely what to attend to*.**

My caution in the original section was that showing a model an example and telling it to produce one
are different interventions. That distinction was right and the conclusion drawn from it was
backwards: the supported intervention is **the instruction**, and it is the cheap one.

**And teach mode already carries instructions of exactly that shape** — from the composed belt:
*"Ground the concept in THIS repository: name the real node/file (exact label)"* and *"NAME THE REAL
COMPONENT IN THAT QUESTION"*. So the question is not whether to add a naming rule; it is **whether
the ones present are specific enough, and whether they are obeyed** — which is measurable against a
lesson's output rather than by reading the belt.

### And a second result from the same ladder that redirects effort

**Schema validity was 20/20 in EVERY arm, including the bare 53% one.** Format was never the problem
at any point; every arm after the first was recovering *content*.

That is directly relevant to this lane. The belt's second question found `propose_chart` never called
on twelve engineer turns — **that is an attention failure, not a shape failure**, and any effort
aimed at the shape of teach output should be checked against this before it is spent.

## 6. A teach turn does not finish a lesson on this repository, so the contract is UNTESTED

**2026-09-09, `minicpm5-hermes` (Q8_0), app route, this repo (1,089 nodes).** Three turns driven to
check the three things a lesson is supposed to do — is the request recognised, does a visual land,
does it ask a comprehension question.

| | ask | result |
|---|---|---|
| A | *"I want to learn about machine learning. What is it?"* | **`source: lesson`** — the refusal, correct, instant, no provider call |
| B | *"I want to learn about the scanner in this repo."* | **deadline** — no lesson |
| C | *"I want to learn about jail.ts in this repo."*, `maxRounds: 2` | **deadline** — no lesson. 43,210 in / 83 out, *"I ran 2 tool calls (locate_symbol, search_files) before stopping"* |

**A proves the `69588b9c` fix end to end**: the first-person request is now recognised, and because
machine learning is not in this repository the honest refusal fires before any model call.

**B and C are VOID for the other two checks, not failures of them.** No lesson was written, so the
turn cannot be graded on whether it drew a visual or asked a comprehension question. An arm that did
not produce the thing cannot be scored on it.

> **AMENDED 2026-09-09 — the attribution stands, but not on the evidence quoted above.**
>
> Row C is recorded as **deadline** while running `maxRounds: 2` and stopping after exactly two tool
> calls, which is also what the ROUND CEILING looks like. The sentence I quoted — *"I ran 2 tool
> calls (locate_symbol, search_files) before stopping"* — is `summarizeExecutedTools`, a **suffix
> appended to both endings**, so it distinguishes nothing. The two endings differ in their opening
> clause (*"hit its time budget"* against *"I used all 2 of my tool rounds"*) and in
> `metrics.stopReason` (`'deadline'` against `'ceiling'`), and `ask-turn-deadline.test.ts` already
> locks both directions, including that neither sentence may blame the other budget.
> **I recorded the prose and not the field that answers the question.**
>
> The attribution survives on separate evidence: an independent run today, same repository, same ask
> (`--teach "teach me jail.ts"`), returned the FULL sentence — *"I stopped because this turn hit its
> time budget while I was still looking things up"*. So row C was a deadline stop. Note also that
> `stopReason = outOfTime ? 'deadline' : atCeiling ? 'ceiling' : 'no-progress'` gives time
> precedence, so a turn that is both out of time and at the ceiling reports `'deadline'` — one more
> reason the field, not the sentence, is the thing to keep.

### The budget, and that no caller can raise it

`ASK_TURN_DEADLINE_MS = 180_000` — three minutes, soft (it stops new tool rounds, never aborts a call
in flight). `resolveTurnDeadlineMs` accepts a `turnDeadlineMs` override, and **the HTTP route never
reads one.** The CLI's `--timeout` is a client-side give-up, not this deadline. So a learner in the
app has a hard three-minute ceiling per turn with no way to lift it.

> **PARTLY ADDRESSED 2026-09-09 — the override now has a caller on the headless path.**
>
> Re-verified before changing anything: `turnDeadlineMs` was declared on the pipeline input, read by
> `resolveTurnDeadlineMs`, and passed by **exactly one thing in the repository — a test**. Neither
> shipped caller set it. It was a parameter only `ask-turn-deadline.test.ts` could reach.
>
> `sequence ask --turn-deadline <ms>` now sets it (`0` = no deadline, the value the resolver already
> defines a meaning for and the existing test drives its ceiling case with). **No default changed, no
> app behaviour changed, and no answer changed** — the point is that the experiment §6 says is
> missing can now be run: does a lesson finish with more time, on this repository, on this model.
>
> **The learner's budget in the app is still fixed, and deliberately so.** Raising *that* is the
> product call this section poses, and this lane is not taking it. What is fixed here is that the
> question was previously unaskable.
>
> The help text distinguishes the two millisecond flags, because shipping both without saying how
> they differ is a trap: `--timeout` aborts the process and exits CANCELLED, killing a turn in
> flight; `--turn-deadline` is soft and lets the turn write the answer it already has.

**The contrast is the interesting part.** A *non-teach* ask on the same repo completed — slowly, at
145,904 input tokens. The teach turns did not. The difference is what a teach turn carries: a
12,244-character belt in four sections that drives tool use, on top of the same digest.

### What this does and does not say

- **It does not say the contract is broken.** Ask-then-tell and the one-visual rule are marked DONE
  in `docs/TEACH-MODE-GOAL.md` task 3, and this run could not verify them either way. **They remain
  unverified against a live turn on this repository.**

  > **TESTED 2026-09-09, card-free —** `teach-contract-end-to-end.test.ts`. One teach turn through
  > `runAskPipeline` against a real scan, assembled by `beginTeachTurn` itself, asserting all three
  > things a finished lesson owes on the SAME turn: the ask is recognised and gets a concept, a
  > visual reaches the canvas, and the turn closes on a comprehension question. **All three hold.**
  > It failed first — on the two product assertions — which is how I know it reads the contract and
  > not the happy path.
  >
  > **And all three are the PRODUCT's work, which is the finding.** The scripted provider writes no
  > check-in and calls no chart tool — the measured majority shape — and the turn still satisfies the
  > contract: the concept comes from `buildQueue` over the graph, the chart from `buildConceptChart`,
  > and the close is 120 characters the product appends after the bounce — *"Looking at the picture:
  > gateway.js reads from router.js — what do you think would break in gateway.js if that changed?"*,
  > grounded in a real edge of the scan. That is deliberate design, stated at the append site: *"a
  > reveal that depends on the model doing it is a reveal that does not happen."*
  >
  > **So this closes the contract question and NOT the live-turn question.** It proves the product
  > delivers a lesson's three obligations without the model's help. It says nothing about whether the
  > model contributes any of them, and §8 already measured that it mostly does not. A green suite
  > here must never be read as evidence about a model.
  >
  > Three wrong-reason passes were named and excluded rather than assumed unlikely: the concept
  > cannot be echoed from the question (the ask names no file, and it is asserted); the chart must
  > name *this* turn's concept and a `teach: false` control emits none; and a closing CLARIFYING
  > offer — which satisfies "ends with a question mark", and which 24 of 94 measured turns closed on
  > — is put to the grader directly and must still be rejected.
- **It does not say 180 seconds is wrong.** It says no caller can choose, and that a repo of this
  size with this model does not fit inside it.
- **One model, one repository, three turns.** `minicpm5-hermes` Q8_0. Nothing here transfers to
  another model or quantisation, and a comparison arm must name both.

**The decision it raises**, which is not this lane's to take alone: either a teach turn gets a longer
budget than a chat turn because a lesson is worth waiting for, or the lesson has to be reachable in
fewer lookups. Both are product calls, and the second is the one the naming-instruction evidence
would favour — tell the model precisely what to attend to rather than let it search.

## 7. The naming instruction is present, unconditional, and disobeyed on a third of lessons

**Card-free.** Measured over the nine `teach-eval-sequence-*` arm files already on disk —
**424 clean turns, 296 of them given a concept** — `granite42-hermes` **Q4_K_M**. The contract
demands *"Ground the concept in THIS repository: name the real node/file (exact label)"*.

| does the lesson name the concept it was given? | turns | |
|---|---|---|
| names the **exact label** | 161 | **54.4%** |
| names only the stem (`harness` for `harness.ts`) | 33 | 11.1% |
| **names neither** | 102 | **34.5%** |
| total given a concept | **296** | |

### The misses are mostly real disobedience, not turns that ran out of road

The first eight misses read like lookup preambles — *"I'll continue by retrieving the full
topology…"*, *"I am reading the file."* — which suggested the turn simply never reached the teaching.
Splitting them says otherwise:

| | named (194) | missed (102) |
|---|---|---|
| `stopReason: complete` | 167 | **65** |
| `stopReason: no-progress` | 21 | 37 |
| stub | 13 | 26 |
| drew a visual | 193 | 99 |
| mean words | 165 | 151 |

**65 of the 102 misses completed normally, at full length, with a picture — and never named the
file.** About 37 are `no-progress` turns that genuinely did not get there. So both faults are real and
the larger one is compliance.

### Why this is NOT an argument for a louder clause

The clause is **present and unconditional** — verified by dumping the composed belt (§4), where the
three teach clauses appear in the last of four sections with nothing contradicting them. This is the
fifth time in this tree that an instruction has failed with the clause demonstrably there, and the
first where neither self-gating nor contradiction explains it.

**What the evidence points at instead is specificity.** The sentence that carried 53 → 79 elsewhere
was concrete about what to enumerate — *"Name EVERY component the description mentions, including the
client or caller at one end and the store at the other."* The teach contract's version is abstract:
*"name the real node/file (exact label)"*. One tells the model what to look for; the other names a
property the answer should have.

**That is a hypothesis, and it is not being shipped on a hunch.** It needs a registration with its
kill number written first — a wording arm against the current contract, on the same bench, with the
naming rate above as the control. **54.4% exact is the number to beat, and 34.5% naming neither is
the number that has to fall.** Anything less than a registered pair is the louder-clause reflex
wearing a measurement's clothes.

> **AMENDED 2026-09-09 — the registration was written, and then withdrawn before it ran.**
> The paragraph above stands as it was published; this is what happened next.
>
> The hypothesis assumed the contract had never been given a *specific* naming instruction. **It
> has.** Nine lines below the abstract clause, the same belt carries
> *"NAME THE REAL COMPONENT IN THAT QUESTION… a bare placeholder where the component name belongs
> … does not count as a check-in"* — concrete, with the failure mode named and the example it must
> not copy quoted. Scored on the same 296 turns, on text that does not overlap: **the abstract
> clause is obeyed 49.3%, the specific one 36.8%.** The specific instruction is obeyed *less*, and
> neither is near the 79 that motivated the arm.
>
> That pair differs in three things (specificity, scope size, syntactic position), so it **does not
> refute specificity** — but it removes the premise that a specific wording is untried here, and
> with it the case for spending four arms writing a second one. **No card was spent.**
> `docs/research/teach-naming-specificity-registration.md` carries the withdrawal, the disjoint-text
> numbers, and the extractor bug that made the first pass of this comparison wrong by 36 points.
>
> The thread now points at a different pocket: **22.6% of concept-bearing turns (67) honour neither
> naming clause nor the question clause** — mean 158 words, 64 of 67 with a visual, 30 stopping
> `complete`. Not truncation, and not something a fifth wording reaches.

### What this does not say

- **Not that the lessons were bad.** 99 of the 102 misses drew a visual; this measures one clause.
- **Not a minicpm5 result.** `granite42-hermes` Q4_K_M throughout. The current default is
  `minicpm5-hermes` Q8_0, on which §6 could not get a lesson to complete at all.

## 8. One turn in five hands the lesson back to the learner — and the grader called it a punctuation slip

**Card-free**, same nine arm files, **424 clean turns**, `granite42-hermes` **Q4_K_M**. Found by
opening BACKLOG item 8 — the turns that honour neither the naming clause nor the question clause —
and reading them instead of counting them.

**86 of 424 turns (20.3%) ask the learner to supply the question or the task.** Verbatim, and this
exact sentence appears 24 times:

> *"I am ready to proceed with the task. Please provide the specific question or point you would like
> me to address regarding the repository structure."*

They are not openings. They arrive at turns 1, 2 and 3 of a lesson already underway, most at 25 words
with `stopReason: complete`. Split by what the lesson queue handed the turn:

| the turn was given… | rate that hands the lesson back |
|---|---|
| **no concept** (the queue was dry) | **50/128 — 39.1%** |
| a concept, and it named it | 18/194 — 9.3% |
| a concept, and it did not | 18/102 — 17.6% |

**The fault concentrates where the queue has nothing left to give**, which makes this partly a queue
question and not only model disobedience. What a teach turn should do when `conceptGiven` is null is a
product call and is **not** being decided here.

### The clause was present. The check named the wrong fault.

This is the fifth instruction failure in this tree and the trap held again: **the contract bans this
outright** — *"NEVER ask a CLARIFYING question… or supply something you could look up yourself"* —
and §4 already verified the clause is present and unconditional in the composed belt. So the belt was
not rewritten.

Reading the recorded `contractProblems` shows why it never landed. Every one of these turns **was**
bounced, 4 to 6 rounds, with:

> *"your reply does not END with the closing check-in question the contract requires"*

**That is a verdict about punctuation.** Neither existing check names the real fault: the TOOL_VOCAB
clarifying rule needs a `?` and one of our own format words, and this shape is a request with
neither. So the model spent four to six rounds being told its question mark was missing, when its
reply contained no lesson at all. **None of the 86 recovered.**

**Shipped:** a grader rule that names it (`askPipeline.ts`, `gradeTeachTurn`), with a locking test
built from three verbatim arm-file turns, **proven RED before the fix**
(`packages/analyzer/src/test/teach-asks-for-the-task.test.ts`). Swept across all 424 recorded turns it
matches **27 distinct spans and every one is the banned shape — no false positives**; a fourth
alternative in the first draft matched nothing on real data and was removed rather than shipped
untested. Two control cases lock the shapes that must keep passing: a comprehension close, and the
mid-lesson offer the contract explicitly permits.

**What this does NOT claim: that naming the fault changes the behaviour.** That is a bench question
needing a registered arm and card. What it fixes today is that the violation was **invisible** —
recorded as a punctuation slip, so nobody counting bounces could see it.

### CORRECTION to §7: the picture is the product's, not the model's

§7 says the misses "completed normally, at full length, **with a picture**", and BACKLOG item 8
repeated it as "64 of 67 had a visual". **That reading credits the model with something it did not
do.** `visual` is true when the grader raised no `NO VISUAL` problem, and a **product-derived** chart
satisfies it: `buildConceptChart` draws the concept from the scanned graph whether or not the model
asks for anything.

| | named its concept | missed it |
|---|---|---|
| bench scored `visual: true` | 99.5% | 97.1% |
| **the MODEL called `propose_chart`** | **2.6%** | **0.0%** |
| product-derived chart only | 96.9% | 97.1% |

**The model drew 5 times in 296 turns, and zero times on the 102 turns that missed the naming
clause.** So "with a picture" is not evidence about model compliance — it is evidence the derived
chart works.

It also softens the naming finding in the learner's favour, and that belongs on the record: **the
chart the learner actually sees names the concept on 97.1% of the turns whose prose did not**, as its
title and caption. The prose clause is disobeyed; the label still reaches the screen.

### Two things I got wrong on the way here, recorded because they were nearly published

- **A sample read that the corpus refuted.** The first turns I opened said *"The model provider failed
  after 3 completed round(s)… exceeded 90000 ms"*, and the obvious story was that the misses are
  infrastructure. Counted across the corpus, that marker appears on **4 of 102** misses. It explains
  nothing, and reading eight turns would have shipped it as though it explained everything.
- **A `?`-shaped detector cannot see an imperative.** Item 8 called these turns "asks nothing". They
  interrogate hard — *"Please provide the specific question"* — but carry no question mark, so the
  closing-question check scored them as silent. **The banned behaviour was hiding in the bucket named
  for its absence.**

## 9. The learner's answer is never read — the loop advances on what the MODEL did, not on what the learner understood

**Card-free**, `teach-two-turn-loop.test.ts`. One turn is not a lesson, so this drives **two**: a
teach ask, then the learner's reply to the closing question, wired exactly as `repoServer.ts` wires
it — `runAskPipeline`, `askTurn.finish(...)` with the turn's `openPrediction`, then a fresh
`beginTeachTurn` on the same thread reading the lesson back off disk.

**What works.** The lesson advances: turn two teaches the next concept, not the first one again, and
the two turns mark different concepts taught.

### The learner's answer changes nothing

Verified in the source before it was tested, not inferred from output:

- `advanceLesson(lesson, { passed, turn })` moves the queue on `passed`, which is
  `taughtThisTurn({ visual, endsWithCheck })` — **both properties of the model's output.** The
  learner's reply is not an argument to it.
- the reveal fires on `openArrow?.arrow !== undefined && chart && !atCap` and states the answer
  outright. **Nothing compares the reply to `expect`.**
- the only handling of *"I don't understand"* anywhere in the server is **`askPipeline.ts:1293` — a
  sentence in the belt, addressed to the model.** There is no code.

Measured, holding the model's text constant so the learner's reply is the only thing that differs:
**turn two is byte-identical whether the learner is right or wrong**, and *"I do not understand"*
advances the queue exactly as a correct answer does.

**That is this repository's signature failure for the fifth time** — the clause is present and
unconditional, and nothing checks it. It is the same shape as §8, one turn later.

### And the two-turn contract is OFF in the shipped default

`attemptNextPictureCheckIn` is the only thing that ever sets `openPrediction`, and it is reached
only when `SEQUENCE_TEACH_CHECKIN_FORM === 'next-picture'`. **Unset — the default — turn one stores
no prediction and turn two has nothing to reveal.** The turn still closes on a derived comprehension
question, so the loop *looks* intact; what is missing is the link between the question and the turn
that resolves it. With the flag on, the reveal fires and names a real arrow, which is the control
that separates "off by default" from "broken".

### What this does NOT say

- **Not that turn two never differs.** A live model reads the learner's reply in the prompt and may
  respond to it. The scripted provider holds the model constant on purpose: what is measured is the
  **product's** contribution, the same question §8 asked one turn earlier.
- **Not that answer-grading should be built.** `docs/CANON.md`'s audience order is engineers first,
  builders second, learners third, and a loop that only serves someone being taught from zero aims
  at the third. **That is a product call and this lane is not taking it.**
- **Not a claim about a real repository's queue.** One fixture. Worth recording from building it: an
  early version used isolated files, the queue came out alphabetical with an unconnected file at its
  head, and the turn produced no chart and no question —
  `checkInSkipped: 'no-chart-derived-this-turn'`. Real repositories contain unconnected files too.

**Every case was seen to fail before it was trusted**, by mutating a private copy of the compiled
output: disabling `advanceLesson`, forcing the reveal off, making turn two depend on the answer, and
implementing the belt's own "a lost learner does not advance" rule. Each killed exactly one case and
left the rest green — and the last two had to be separate, because one case reads the text and the
other reads the queue.

## 10. "Drawn, not described" — the drawing works; the owner's example has nothing to draw

**Card-free**, measured against the brief's own sentence: *"A learner asks 'what is machine
learning' and gets a VISUALISED EXPLANATION ON THE AI CANVAS — the architecture drawn, not
described."*

What reaches the canvas is `chart:proposal`, and §8 measured who emits it: over 296 teach turns the
**model** called `propose_chart` **5 times**; the **product** supplied ~97% by deriving a chart from
the scanned graph. So what gets drawn is decided by `buildConceptChart`, which is deterministic and
needs no model. Run against **the real repository, 1,101 nodes / 2,922 edges**:

| ask | queue | refused? | what reaches the canvas |
|---|---|---|---|
| `what is machine learning` | 0 | **no** | **nothing** |
| `teach me what machine learning is` | 0 | yes | nothing |
| `I want to learn about machine learning` | 0 | yes | nothing |
| `teach me the ask pipeline in this repo` | 6 | no | **`data-flow`, 5 items, 4 links** |

### The answer to the question, stated plainly

**For the owner's literal example: prose, and not even prose with a picture beside it — the canvas
receives zero chart proposals.** For a subject the scan can find, the canvas receives a real drawing:
named nodes and the edges between them, every node a real file from the scan.

**So the drawing is not the gap.** The architecture is drawn, from the graph, with edges — when the
concept is *in* the graph. "What is machine learning" has nothing to draw because there is no machine
learning in the repository being scanned. **The gap is the input domain, not the renderer**, and that
is item (c) restated with numbers rather than a fifth attempt at the prompt.

### The sharper half: the bare question is not recognised as a lesson at all

`teach me what machine learning is` is refused honestly. **`what is machine learning` is not** — it
falls through to an ordinary repo ask and answers in confident prose about a repository that contains
no such subject. That is §1's original defect, still live for the interrogative phrasing.

**It has NOT been fixed here, deliberately.** `subjectlessRefusal` is gated on `TEACH_ASK` precisely
so a pointed question with an empty queue — *"Why does the retry flag exist?"* — keeps today's
behaviour instead of being handed a refusal written for lessons. Widening the recogniser to bare
questions re-opens that in the same stroke. **Two asks of identical grammar, one a lesson request and
one a repo question, and nothing in the sentence separates them** — which is why this is a decision
about teach mode's input domain and not a regex to widen. Pinned by
`teach-drawn-not-described.test.ts` so any future widening has to be deliberate: mutation F, which
adds `what is ` to the recogniser, turns that case red.

### What this does not say

- **Not that the model never draws.** It draws rarely — 5 of 296 — which is why the product's
  derivation decides the outcome. A live turn was not run: with the derived chart absent by
  construction, a model call could change the prose and not the verdict, and §6 measured that the
  current default cannot finish a teach turn anyway.
- **Not that teaching should become the product.** `docs/CANON.md` orders the audience engineers
  first, builders second, learners third.

## 11. The literal question, driven end to end: 0 drawn, 6 of 6

**The acceptance sentence is "a learner asks *what is machine learning* and gets the architecture
DRAWN, not described." Driven end to end through the product's own teach path, with the local model
attached and the GPU lock held for exactly the work.**

| | shipped default | comparison arm |
|---|---|---|
| model | `minicpm5-hermes` **Q8_0** | `granite42-hermes` **Q4_K_M** |
| runs | 3 | 3 |
| **drawn** | **0** | **0** |
| described | 0 | **3** |
| no answer at all | **3** (turn deadline) | 0 |

**Draw rate for the owner's literal question: 0 of 6.**

### The two rates as a pair, because either alone flatters

- **Teach refuses to answer: 0 of 6 at the product level.** The bare interrogative is not recognised
  as a lesson request, so `subjectlessRefusal` never fires — §10's pinned boundary, reached from the
  other side.
- **Teach answers without drawing: 3 of 3 on the arm that answered at all.** Every completed run was
  prose, `chart:proposal = 0` on all six.

**The zero is structural, not a small sample.** `buildQueue` returns 0 concepts for this ask, so
`buildConceptChart` cannot fire — the product-derived chart is impossible **by construction**, and
that half is deterministic and already locked by `teach-drawn-not-described.test.ts`. The only
variable left is whether the MODEL calls `propose_chart`, and across these 6 runs it called it zero
times, consistent with the 5-of-296 base rate in §8.

### What the three completed answers actually were, and they differ in kind

1. **Fabrication.** *"Machine learning in this system refers to the analyzer service's ability to
   automatically score and analyze code artifacts…"* — a confident claim about a repository that
   contains no machine learning. **Grounded-not-guessed, broken in the answer itself.**
2. **Interrogation.** *"I need you to specify which part of the architecture you'd like me to
   address…"* — the clarifying question the contract bans outright. The §8 rule catches this shape,
   and the turn shipped it anyway after its bounces, exactly as §8 measured: none of the 86 recovered.
3. **An honest refusal, from the model rather than the product.** *"I don't have enough context to
   answer 'what is machine learning' from this repository. The digest shows only service definitions,
   datastores, and modules — no files, code, or detailed architecture."*

**Three runs, three different kinds of failure, one of them a fabrication.** That spread is the
finding: without a product-level refusal the outcome is left to the model, and one run in three
invented a repository fact.

### What this does and does not settle

- **Not a verdict on the drawing.** §10 measured that a subject IN the graph is drawn with real nodes
  and real edges. This says nothing about that path and does not touch it.
- **Not an argument to grow teach mode.** `docs/CANON.md` orders the audience engineers first,
  builders second, learners third, and the ruling recorded at `d98556b` puts this example out of
  scope. The number is here because the sentence was named as an acceptance test, not because the
  lane is bidding for it.
- **The `minicpm5` column is the shipped default failing for a different reason** — §6's deadline,
  reproduced 3 of 3. A learner on today's default gets neither a drawing nor a description.

## 12. The artefact: a paragraph where the diagram should be

**Driven through the running app — the surface a learner actually uses — on the shipped default
(`minicpm5-hermes` Q8_0), teach mode on, the literal question typed into the composer.** Screenshot
captured headlessly from the same app so the verdict is readable off the DOM rather than off the
picture: `AiCanvas.tsx` emits `ai-canvas-chart` per drawn chart and `ai-canvas-empty-after` when a
turn completed and drew nothing.

```
ai-canvas-chart        : 0
  of which a real chart: 0
ai-canvas-empty-after  : 1   "the last answer drew nothing here"
VERDICT                : DESCRIBED, NOT DRAWN
```

**Two UI runs, both with an empty canvas, and they failed differently — which is the point.**

The first answered honestly: *"The question 'what is machine learning' cannot be answered from the
repository index alone. The scan only provides services, datastores, modules, edges and risks."*

**The second fabricated, and it is the one worth putting in front of someone:**

> *"ML is defined in `mod:analyzer/3` within `svc:analyzer`, a module of 11 `.ts` files under
> `packages/analyzer/src/llm/`. It has no data store dependency of its own but imports
> `ds:analyzer-db`. `svc:acp` and `svc:ink` both route through this module."*

That is the **LLM client**, not machine learning. The turn is stamped **"Taught this as a lesson"**,
its footer reads **"answered from 0 of 2,939 edges — 10 components contributed nothing"**, and the
canvas beside it reads **"The last answer drew nothing here."** A confident, repository-shaped,
file-cited paragraph about a subject the repository does not contain, presented as a completed
lesson, with nothing drawn.

### The rate, all runs to date

| surface | model | runs | drawn |
|---|---|---|---|
| pipeline (CLI) | `minicpm5-hermes` Q8_0 | 3 | 0 — deadline, no answer |
| pipeline (harness) | `granite42-hermes` Q4_K_M | 3 | 0 — described |
| **running app** | `minicpm5-hermes` Q8_0 | **2** | **0 — described** |

**Draw rate for the owner's literal question: 0 of 8.** The pair, unchanged and reported together:
**refuses-to-answer 0 of 8** at the product level; **answers-without-drawing 5 of 5** among runs that
answered at all.

### What the artefact settles that the numbers did not

The numbers said "not drawn". The screenshot says **what is there instead**, and it is worse than a
paragraph: on 2 of the 5 completed runs across all surfaces the model manufactured a repository fact.
**The gap is not that teach mode draws badly. It is that with no subject in the graph and no
product-level refusal, the turn is handed to the model, and the model fills the space.**

## 13. Three general questions, drawn — and the gate's false-positive side, measured

**`granite42-hermes` Q4_K_M, 4 runs each, through `beginTeachTurn` + `runAskPipeline`, GPU lock
held for exactly the work.**

| question | drawn | refuses-to-answer | answers-without-drawing | fabricated repo facts |
|---|---|---|---|---|
| what is machine learning | **4 / 4** | 0 / 4 | 0 / 4 | **0 / 4** |
| what is a transformer | **4 / 4** | 0 / 4 | 0 / 4 | **0 / 4** |
| what is backpropagation | **4 / 4** | 0 / 4 | 0 / 4 | **0 / 4** |

**12 of 12.** So the earlier 4-of-4 was not one question's luck. Fabricated repository facts are 0 by
construction, not by hope: the chart carries no nodeIds, and a returned one voids the whole chart.

Two of the backpropagation runs show the belt slot working in the model's own words — *"Teaching
concept: backpropagation (general knowledge, not from this repository)"* and *"I will teach the
concept using general knowledge, since the repository does not contain files or code related to
it."*

**One transient error, reported because it was nearly lost.** The first backpropagation batch
returned 3 of 4 with one run absent from the output entirely: the harness pushed an error row and
printed nothing, so a run vanished and the totals quietly lost a denominator. Fixed to log and count
errors; the re-run was 4 of 4 with none. **A measurement harness that can drop a run without saying
so is the same fault as a check that cannot fail.**

### The false-positive side: 4 of 13, and the caption was making a claim it could not support

The gate is `subjectNotInRepo` — a graph attached and the lesson queue empty. Run over the 13
registered bank asks:

| | |
|---|---|
| **in-repo lessons wrongly drawn from general knowledge** | **4 of 13** — `harness-03/05/06/08` |
| absent subjects the draw missed | 0 of 3 |

Their subjects are in this tree: the verify contract is `harness/verifyGate.ts`, the round budget and
fenced tool-call parsing are both `askTools.ts`, the architecture digest is `explain/explain.ts`.
**`buildQueue` matches filenames and those four are named by concept**, so the queue is empty and the
gate takes them.

**This lane measured that exact conflation two commits earlier — an empty queue means "no filename
matched", not "absent from this repository" — and then built the new feature on it.** The signal was
wrong in the same way one layer up.

**What was fixed is the CLAIM, because that is the part that was false.** The caption said *"this
subject is not in the scanned repository"* (false on 4 of 13) and now says *"not from this
repository's scan"* — a statement about where the chart came from, true in every case. The belt slot
said *"THIS SUBJECT IS NOT IN THIS REPOSITORY"* and now says *"THE SCAN MATCHED NO FILE TO THIS
ASK"*, which is what actually happened, and it still overrides the grounding demand.

**What is NOT fixed, named rather than papered over:** those four still get a remembered picture
where a graph one would be better. That is a `buildQueue` limit — the concept-named subject it cannot
see — and it is the same limit behind the refusal's 4-of-13 false positives in §11's neighbourhood.
A caption cannot repair it and should not pretend to.

## 14. The shipped default, measured — the two models side by side

§13's 12 of 12 was `granite42-hermes` Q4_K_M. **The product ships
`minicpm5-hermes` Q8_0**, and the number a person sees when they type the
question is that one's. Same three questions, 4 runs each, same pipeline, GPU
lock held for exactly the work.

| | `granite42-hermes` Q4_K_M | `minicpm5-hermes` Q8_0 **(shipped)** |
|---|---|---|
| what is machine learning — drawn | 4 / 4 | **4 / 4** |
| what is a transformer — drawn | 4 / 4 | **4 / 4** |
| what is backpropagation — drawn | 4 / 4 | **4 / 4** |
| refuses-to-answer | 0 / 12 | **0 / 12** |
| answers-without-drawing | 0 / 12 | **0 / 12** |
| deadlines | 0 / 12 | **0 / 12** |

**The claim on the page holds for the model the product ships**, not only for the
one the earlier work was measured on.

### The midnight deadline did not reproduce

The first measurement of this question, before any of these changes, had
`minicpm5` at **0 of 3 through the pipeline — deadline, no answer** (§11). Across
these 12 runs it deadlined **zero** times, at 3–23 seconds a turn. Temperature
was never set, so the defaults were in use throughout and the one-call-in-seven
hang at temperature 0 is not the explanation either.

**So the midnight result was a state of that moment, not a property of the
model** — most likely a cold load — and §11's `minicpm5` column should be read as
"what happened that night", not "what this model does". A number measured once on
a cold machine is a number about the machine.

### The fabrication number is NOT zero on the shipped default

**0 of 12 recorded — and that is not the whole truth.** In the first
`minicpm5` batch of this question, before the harness was recording full text,
one run answered:

> *"Machine learning lives in the `svc:analyzer` service, whose modules include
> 'moat', 'llm', and 'harness' files under `packages/analyzer`."*

That is a repository claim, of exactly the §12 shape, and it is the phrase a
claim detector catches (`lives in`). It did not recur in the twelve recorded
runs. **So the honest figure is one observed in roughly twelve, not zero**, and
the clean 0 of 12 is reported here with the sighting beside it rather than
instead of it.

The belt slot makes the claim rarer; it does not make it impossible, because
nothing in the product can check a sentence about the world. **What is 0 by
construction is the CHART** — it carries no nodeIds and a returned one voids it —
which is why the picture is the part that can be promised and the prose is not.

### A harness lesson, recorded because it nearly cost the number

The console line truncates each answer at 200 characters. The claim above sat
inside the first 200; the hedge that followed sat outside them. **Scoring that
turn from the visible half would have been a guess in either direction**, and the
harness now writes full texts to disk so the judgement is made on the whole
answer. A measurement that can only see part of its subject is the same fault as
a check that cannot fail.

## What is not claimed

- **Not that teach mode is broken.** §1 was a recogniser gap and is fixed; §4 rules out the belt.
- **Not that the goal doc is wrong.** It is a faithful record of a 2026-09-04 ask. It is in tension
  with a newer one, and that is a decision.
- **Not that a worked example would help a lesson.** The measurement that suggested it has been
  corrected: an off-domain example scored the same as a relevant one, so on this model examples were
  carrying almost nothing. See §5.
- **Not that the naming rule transfers to teaching.** It was measured on node-label F1 for a
  structured extraction task, not on whether a person learned something. Teach mode already carries
  naming instructions; whether they are specific enough, and obeyed, is unmeasured.
  **Amended 2026-09-09:** obedience is now measured — 49.3% for the abstract clause, 36.8% for the
  specific one, on disjoint text over the same 296 turns. Whether *specificity* is the lever remains
  unmeasured, and the arm that would have measured it was withdrawn as not worth the card (§7).
