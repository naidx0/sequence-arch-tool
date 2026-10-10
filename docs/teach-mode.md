# Teach Mode — the graph as the lesson

**Owner directive (2026-08-31):** *"teach me how harness engineering works, in depth, show me
visually and explain side by side … it would provide point one, ask if the user gets it and show
the visual, then move on … asking the user to graph the next node … and then test that against
the following real component … like an IDE you can open files inside and let the user work."*

Teach Mode is the visual-first moat pointed at learning: Sequence already holds a **real,
grounded graph** of the system being taught, so every lesson step can be *shown* on the board,
every learner prediction can be *graded against reality*, and every hands-on exercise can be
*verified by the same machinery that verifies the agent*.

**RETIRED 2026-09-04: "no other harness can do this, because no other harness has the board."**
A board is not the differentiator. Sourcetrail shipped a linked graph-and-code view over an indexed
repo (archived 2021-12-14); Understand-Anything ships a tree-sitter code graph with auto-generated
walkthroughs *ordered by dependency* today; DeepWiki generates per-repo docs with diagrams. A
dependency-ordered syllabus is prior art too. Reported with sources by the research lane's teaching
formats survey.

**Two things survive, and they are the same property twice.** A board that **grades a learner's
prediction against the graph** — no surveyed tool does this — and a tutor that **knows what its scan
did not read**, so a correct answer over an incomplete walk is never marked wrong and blamed on the
learner. That second one is `graph-gap`, and it is why the verdict is built before the grader rather
than after it.

## The five mechanics (and their real seams)

Seam references from the 2026-08-31 exploration; follow the `permission` toggle as the pattern.

### 1. The `teach` toggle
A third mode axis beside `mode` (implementation/research) and `jobMode` (work/code). Clone the
`permission` thread end-to-end: spec table (`PermissionControl.tsx:57`), composer strip
(`Composer.tsx:895`), state (`types.ts:968`), reducer (`store.ts:510`), wire
(`connect.tsx:442` → `api-types/ask.ts`), server parse (`repoServer.ts:3891`), belt
(`askToolsForJobMode`). Teach turns get their OWN round budget and a teach-specific
identity/prompt: the deliverable is a verified understanding, not an edit.

### 1b. The toggle is not the only way in — teach INTENT (2026-09-02)

The owner typed *"teach me this: AI Overview — Learn Supervised Learning …"* with the composer's
Teach row **unselected**, and the product could not hear the word "teach": `classifyAskIntent`
had draw/edit/explore patterns and no teach pattern, so the turn ran as `chat`, the contract
below never entered the belt, and the model interrogated him in our own vocabulary — *"please
provide your preferred chart type, such as system-architecture or data-flow … Should I use
SeqDiagram v1 with labels within ```json blocks?"* — then dropped one generic
`canvas.write_markdown` block and burned three refused canvas calls. His verdict: *"this does
NOT help people learn, we need to SEE the breakdown on our app, not create exportable htmls all
the time."*

So a lesson now engages on the **question** as well as the toggle (`isTeachAskQuestion` in
`askIntent.ts`, `isTeachTurn` in `askPipeline.ts`), `teach` is its own `AskClassifiedIntent`
bucket ordered before draw/edit, and the turn **says so on screen** — the pipeline streams
`step:start`/`step:done` for `TEACH_MODE_STEP_ID`, which the client renders as the work row
"Taught this as a lesson". A mode the user did not choose may not engage invisibly.

**The toggle's own state does not move.** It is the user's standing preference for the whole
thread; flipping a control the user did not touch would make the next, unrelated question a
lesson too, and would leave them unable to tell what they had chosen from what we inferred. The
turn is taught; the switch stays where they left it.

**EXPLORE still wins the bare lookup.** A plain "how does X work" is deliberately in no teach
pattern: in a tool whose subject is your own repository that is the commonest grounded question
there is, and answering it in 150-word slices with a check-in question would make ordinary
questions unanswerable. The learner has to be in the sentence — "teach me how X works",
"explain how X works to me", "help me understand how X works" all reach teach.

### 2. One point at a time — client-driven steps, atomic turns
The pipeline has no pause/resume and should not grow one (invasive; a turn is atomic by
design). A lesson is a **client-driven turn sequence**: each teach turn delivers exactly ONE
concept + ONE board action + as many comprehension questions as the explanation earns + ONE
closing check-in question, then ends. The client keeps the lesson
plan in chat history (`AskHistoryEvidence` carries prior steps); "got it" / "explain again" /
the user's answer is the next turn's input. `session.queued` (`store.ts:290`) stages the next
step while the user reads. The edit contract's pacing machinery becomes teaching discipline: a
teach turn that dumps more than ~150 words of prose or advances two concepts is the failure
the contract names.

### 3. Show, don't dump — per-step board actions
The canvas verbs already exist client-side and are unreachable from the server:
`canvas/flow` + `flow-cursor` (animated playback), `canvas/dim` (spotlight `litNodeIds`),
`canvas/fit`, `canvas/annotate` (`canvasReduce.ts:55-132`). Add ONE new SSE event,
`teach:step { caption, litNodeIds?, flow?, fit? }`, translated in `canvasChannel.tsx` (the
file whose own header documents wiring exactly this class of seam) into dim/flow-focus
actions. `canvas:story` (`ask.ts:371`) is the fallback spine for multi-block canvas lessons.
The one-write-per-turn throttles (`askTools.ts:472-495`) get a teach-mode exemption — a
lesson is inherently many small board moves.

### 4. Predict-then-reveal — grading the user's drawing
The pieces are built: Draw mode → ink recognition (`packages/ink`) → `DocEdit`
(`inkToEdit.ts`), and a user-drawn node is distinguishable from a scanned one **by the absence
of `evidenceRef`** — the provenance marker is free. Missing: the upward wire. Add
`drawnPrediction?: { nodes, edges }` to the ask request (deliberate exception to the
"gestures never fire a metered run" rule: in teach mode the user EXPLICITLY submits a
prediction). The server grades it against the real graph the way `propose_topology` already
validates endpoints (`askTools.ts:1804`): exact hit / right-neighbor-wrong-name / miss, each
with `file:line` evidence in the explanation. Wrong is a teachable moment with receipts.

### 5. Hands-on files — the editor pane
Net-new UI, ready backend: `GET/PUT /api/file` (jailed, `repoServer.ts:2595/2785`),
checkpoints/rewind, syntax rendering (`review/syntax.ts`). Add `'editor'` to `ChromeTabId`
(it already exists in `AskSurfaceId` — the wire anticipated this pane). v1: read-only open +
a guided "type here" region; grading reuses the verify machinery (syntax gate, run_command)
the agent already faces. The learner is graded by the same honest gates as the model.

## Curriculum comes from the graph
The syllabus for "teach me this repo" is computed, not written: topological order over the
service graph (entries → services → datastores), flows as chapters, risks/impact as the
"why it matters" beats. For abstract topics ("harness engineering"), the model teaches over
a scanned exemplar repo — Sequence's own monorepo ships as the default classroom.

## Build order (waves, each independently shippable)
1. **W1 — toggle + paced turns:** `teach` end-to-end, teach identity + per-turn contract
   (one concept, one question, ≤150 words), history-driven step sequencing. Ship: text-only
   teaching that never dumps.
2. **W2 — board spine:** `teach:step` SSE → dim/flow/fit wiring; lessons light the graph.
3. **W3 — predict-then-reveal:** `drawnPrediction` wire + server grader + reveal flow.
4. **W4 — editor pane:** ChromeTab, open/type/save, verify-gated exercises.
5. **W5 — launcher polish:** one-command launch à la ml-harness (see below when explored).

Gates as always: locking tests per wave, legibility e2e on the new surfaces, usability pass
from the learner's seat.

## W5 appendix — the ml-harness launch pattern (explored 2026-08-31)

ml-harness lives in a sibling checkout alongside this repository. What makes it
one-command, in porting order for Sequence:

1. **Two ~12-line wrappers** (`start.ps1`/`start.sh`) that only find-and-prove a runtime
   (candidates in order, each EXECUTED to prove it runs — Windows Store python stubs are why)
   and hand over to ONE brain script. Sequence's equivalent: find node, hand to
   `scripts/launch.mjs`.
2. **The brain** (`scripts/launch.py`, 962 lines, tested): dependency check whose failure IS
   the fix command; probe-then-decide on the port (free→start, ours-current→reuse,
   ours-stale→replace, foreign→REFUSE); token continuity across restarts; kill only a pid
   that self-identified via /health; readiness = identity assertions (build fingerprint +
   launch nonce), never sleep; portfile reconciled from the LIVE /health; one summary block,
   one `<- OPEN THIS` URL, logs given an address. Exit codes are meaningful.
3. **Data-root rule** (`app/paths.py`): a checkout keeps its files; an install gets
   %LOCALAPPDATA%; never move an existing database.
4. **Desktop shell later** (Tauri 2): window does not auto-start; a visible "Start the
   engine" button; kill-only-what-you-started (`OURS: Mutex<Option<Child>>`); engine
   outlives the window (tray).
5. Their turn contract (`app/instructions/15_turn_contract.md` — "at most one question OR
   one verdict OR one status per turn; heavy output enters as a badge that opens a pane")
   independently validates the teach contract's shape.

## W1 hardening record — the makemore live-lesson arc (2026-08-31)

Same question three times ("teach me how makemore works, bit by bit"), free minimax-m3,
temp 0, over `examples/makemore` (a real, runnable Karpathy part-1 exemplar):

| round | harness | words | read first? | truth |
|---|---|---|---|---|
| 1 | instructions only | 964 | no (one failed search) | fabricated files, APIs, tables |
| 2 | + graded bounce (words/question/ghost-files) | 189 | no (existence-checked names) | real names, fictional contents |
| 3 | + must-read rule (cite only files read this turn) | 329 | **yes — both files** | mostly true; real structures, real punchline |

The lesson of the lesson: **grounded teaching is enforced the same way grounded editing
is** — grade the turn, name the violations, bounce with receipts. The must-read rule is the
teaching twin of "an edit_file oldString you have not seen is a guess." Residual round-3
flaws (a ghost `makemore.py`, 329>250 words) stood because the two-bounce budget spent out:
a model-capability ceiling on the free tier, not a missing rule.

## The testing bench — 54 graded conversations (2026-09-01)

`tools/bench/teach-eval.mjs` runs 54 scripted multi-turn lessons through the real pipeline:
ml, math, law, systems, harness engineering, CS, link-fetch articles, and uploads (video =
transcript attachment, document = article attachment), each learner reply scripted (got-it /
confusion / a prediction), every assistant turn graded by the live `gradeTeachTurn` plus
visual/check-in checks.

First full run — **fully local** (DeepSeek-9B distill over Ollama at 16k ctx, no key, $0):

> ⚠ **THIS TABLE WAS MEASURED BY A GRADER RUNNING TWO OF ITS FOUR RULES (2026-09-03).** The bench
> called `gradeTeachTurn(text, basenames)` against a four-argument signature, so `readBasenames` and
> `visualThisTurn` were `undefined` — and both rules that use them are guarded (`if (readBasenames)`,
> `if (visualThisTurn === false)`; undefined is not false). **The visual bounce and the
> cite-without-reading bounce never fired in this run.** JS arity is silent, and the bench is `.mjs`.
> The bench is fixed; the numbers below are corrected only as far as the stored report allows, and
> the run itself wants repeating.

| metric | result | trustworthy? |
|---|---|---|
| conversations clean | **27 / 54** (recomputed) | **upper bound** — two rules were off |
| paced (≤250 words) | **100%** — the graded contract has eliminated dumps entirely | yes |
| ends with a check-in | 76.9% (weakest: mixed 50%) | yes |
| visual present | 13.7% | **no** — measured against a laxer definition |

**What each correction rests on**, recomputed from `tools/bench/out/teach-eval-report.json` (54
conversations, 117 turns, 32 contract problems):

- **`52 / 54` was never the clean count.** Exactly 2 conversations contain a harness *error* turn,
  and 54 − 2 = 52 — a count of runs that did not crash, printed under a label everyone read as
  "obeyed the contract". The contract-clean figure is **27 / 54**, and it is an *upper* bound: with
  the visual and cite-without-reading rules switched off, turns that would have bounced were scored
  clean.
- **`visual present` did not measure the contract's visual.** The bench carried its own `hasVisual`
  which accepted a ```mermaid fence (the grader refuses it — only ```seqd reaches the board) and
  accepted *any* fence containing `-->` or `=>`, so a lesson showing one arrow function scored a
  visual. It never looked for `chart:proposal`, the event the contract actually asks for. The real
  figure is at most 13.7% and probably lower.
- **`paced` and `ends with a check-in` survive**, because the bench computes both itself — word
  count and a trailing `?` — without going through the grader, so the missing arguments could not
  reach them.

The fix removes `hasVisual` rather than repairing it: a bench that re-implements the rule it is
benchmarking measures itself, and these two copies had already drifted. The turn now passes
`visualThisTurn` in and reads the grader's verdict back, so there is one definition in the repo.

### Ask, then TELL — and the wording this corrected in our own contract (2026-09-03)

Rowland 2014 (k = 159) crossed feedback against how well the first retrieval went:

| condition | g | 95% CI |
|---|---|---|
| **no feedback, initial success < 50%** | **0.03** | **[−0.21, 0.27]** |
| no feedback, 51–75% | 0.29 | [0.09, 0.49] |
| no feedback, > 75% | 0.56 | [0.42, 0.70] |
| **with feedback** | **0.73** | [0.61, 0.86] |

**A learner who fails a check and is not told the answer has gained nothing** — the interval spans
zero. The testing effect is a property of *retrieving successfully*, or of *being corrected*; it is
not a property of being asked. Composed with the companion review (bare "wrong" is d = 0.05, and
discouraging feedback is *negative* at −0.14), it is one rule: **ask, then always tell, and tell
why.**

**This refuted wording shipped earlier the same day.** The comprehension bullet said *"withhold the
answer until the learner commits"* — which is correct for the closing beat and wrong for every
question before it, because **a learner cannot commit in the middle of a turn**. That instruction
made every mid-lesson question rhetorical, which is precisely the cell where g = 0.03. The contract
now says ANSWER IT, IN THE SAME TURN, and `gradeTeachTurn` bounces a turn that asks mid-lesson and
moves on.

**Exactly one question may be outstanding, and it is always the last one.** The closing check-in is
exempt because the learner's next message *is* its answer and the contract already requires the next
turn to grade it honestly. A closing prediction is revealed next turn **unconditionally** — whether
or not they answered, guessed wrong, or changed the subject. A prediction nobody resolves is the
g = 0.03 case wearing a friendlier face.

The grader's threshold is eight words of prose between one question and the next. That is a floor on
*something was said*, not a measure of quality: a grader cannot verify that prose answers a
question, but it can catch a lesson that asked and walked away, which is the failure the evidence
names.

**Two things NOT to build from this literature**, recorded so they are not rediscovered as good
ideas:

- **Interleaving.** Zero controlled studies in programming education across four indexes, and it
  *reverses* for vocabulary learning (g = −0.39) — which is what much early programming learning
  resembles. There is no basis for shuffling concepts inside a lesson.
- **Transfer claims.** Retrieval practice transfers at d = 0.40 raw, but under bias correction the
  estimate drops to roughly zero without response congruency, elaborated retrieval and high initial
  accuracy. The famous classroom result is largely item reuse — the exam questions were the quiz
  questions, reordered. So a lesson that quizzes a thing teaches *that thing*; we should not claim
  it generalises.

---

#### What makes a DELAYED reveal safe — two separate conditions

The rule above leaves exactly one question open across a turn boundary, which is the shape
predict-then-reveal needs. Delay itself is not the risk: Kandemir et al. 2026 (51 studies, 160
effect sizes, preregistered) puts immediate against delayed feedback at **g = 0.03, CI [−0.08,
0.13], p = .61**. Delaying feedback by one turn is not the harmful condition; *not delivering it*
is.

Two things have to hold, and they are different findings:

1. **Unconditional in both directions.** The obvious gap is a wrong guess nobody resolves. The
   easy-to-miss one is a **correct** guess, where the reveal reads as redundant and a model skips
   it — but confirming a successful retrieval is the g = 0.73 cell, not a formality. "Unconditional"
   has to mean regardless of whether they answered, guessed wrong, changed the subject, *or got it
   right*.
2. **Same context.** Grimaldi & Karpicke 2012, Hays et al. 2013 and Vaughn & Rawson 2012 each found
   the benefit of guessing **disappears** for related pairs when feedback is delayed. A 2023 study
   recovered it on one condition: the feedback appeared in the same context as the guess. In a
   transcript that context is reconstructible, but only if the reveal carries it — so the reveal
   must **restate the prediction it resolves**: *"you guessed the scan walks imports first — it does
   not, and here is why"*, never a bare *"the scan resolves exports first"*.

**Both are in the contract and pinned by `ask-tool-loop`; neither is enforced by the grader yet, and
that is deliberate.** `gradeTeachTurn` sees one turn and cannot know a prediction was outstanding.
The pipeline's `historyLines` are *rendered prompt text*, and parsing a grader rule out of rendered
prompt formatting is the fragile coupling this repo has been bitten by more than once — the
structured turns exist one level up, in `repoServer.ts`.

**So this is a W3 acceptance criterion, not a gap.** Predict-then-reveal is not built: the
`drawnPrediction` wire and the server-side grader are the wave's whole content. When W3 lands, the
reveal turn becomes a structural thing rather than a prose convention, and these two conditions are
checkable then — the reveal must reference the prior prediction, and must fire on a correct guess as
well as a wrong one. Building that check before the mechanic it grades would police a shape the
product does not yet have.

**And the criterion does not live only in this paragraph, because that is the exact artefact this
round spent its time cataloguing** — four rules written down, in the right place, believed, and
unenforced. `ask-tool-loop` carries a **W3 tripwire**: a running assertion that no source file
declares `drawnPrediction`, which passes today and **fails the moment the wire lands**, carrying the
two deferred checks in its failure message. It is a normal test rather than a skipped one on
purpose — a skip is a note, and notes are what we are trying to stop relying on. It self-falsifies
by construction: it can only fail when the thing it is waiting for arrives, and it was verified in
both directions before it shipped. The person who builds W3 will meet it in the suite rather than in
this file.

---

### The prompt is a surface, and it has been extended (2026-09-02)

Owner: *"the prompt that I send to tell a model to teach me is very important. Make sure we stress
that when it comes to our actual teaching feature."* So `TEACH_MODE_INSTRUCTIONS` is treated as a
product surface with a bench behind it, not a hidden constant, and it is assembled by the harness
rather than typed by him.

**The visual bounce the finding below asks for already exists** — `gradeTeachTurn` bounces a concept
turn with no `propose_chart` and no ```` ```seqd ```` fence, and deliberately does NOT accept
```` ```mermaid ````, because only `seqd` is lifted onto the board (a mermaid wall would satisfy the
letter of "every concept ships one visual" while the canvas stayed empty). **The 13.8% below predates
that bounce** and is not a measurement of the current contract.

Four moves were added on top: name what you are NOT covering; work real numbers from this repository
when the concept is quantitative; make the learner commit before the reveal; and let the closing
check-in be the question they have not thought to ask.

**One move was refused, and the refusal is the interesting part.** The source material asks for *a
deliberately wrong option, planted unlabelled*. As a multiple-choice distractor that is ordinary
teaching, and the contract permits it. As an unlabelled **assertion** it is the product telling a
learner something false about their own repository — and a learner cannot tell a deliberate error
from a real one, so one of those destroys the value of every other sentence in the turn.
Grounded-not-guessed is not suspended for a lesson. The contract says both halves and
`ask-tool-loop` asserts both, because a version that kept only the permission would read as a
licence to lie and still pass a one-sided test.

**A second move was refused, then re-ruled the same day.** *Ask a real question mid-explanation*
contradicted the contract's "EXACTLY ONE short check-in question" at the end. A belt that both
demands and forbids the same thing is exactly what produced the owner's original failure — the
topology hint ordered "ask ONE short clarifying question" thirty lines before the teach contract
banned it, and he was interrogated about chart formats.

The refusal caught a real ambiguity rather than a bad idea: *"interleave a question"* reads as
either kind. Max then ruled **for** the move — *"i like so far for teaching mode the question pop
ups when learning not just one final question"* — and the resolution is a **narrower permission,
not a reversal**, because the count was never the thing worth protecting. The kind is:

- **Comprehension** — asks about material already delivered *in that turn*, and changes nothing the
  harness does next. Wanted, mid-lesson, as often as the lesson needs. It must be answerable from
  the explanation just given: a question the learner cannot answer from what they were told is an
  interrogation wherever it sits.
- **Clarifying** — makes the learner choose scope, pick a direction, name a format, or supply
  something the harness could look up. Still **zero**, at any point in the turn. The test: if their
  answer would change what the harness does next, it is clarifying.

Both halves shipped in one commit, which is the point. `gradeTeachTurn` no longer counts questions;
instead a question sentence carrying our own tool vocabulary (chart kinds, diagram dialects, "level
of detail") bounces wherever it appears, so lifting the count could not quietly re-legalise the
interrogation it was standing in for. `ask-tool-loop` pins the permission, the ban, and the case
that separates them — a turn that interrogates about output options *and* still closes with a
perfectly good check-in, which a test asserting only "mid-lesson questions are allowed" would pass.

Findings for the next loop: the 9B rarely reaches for canvas tools unprompted — the visual
rule needs the same harness-graded treatment pacing got (bounce a visual-less concept turn);
check-in compliance drops on open-ended "mixed" prompts. Also measured on the way here:
Ollama 400s oversized prompts (fixed by a derived model with `num_ctx 16384` —
`deepseek-teach`), and OpenRouter's key cap now 402s even `:free` models.
