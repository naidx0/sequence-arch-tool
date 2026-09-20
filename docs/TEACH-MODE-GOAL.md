# GOAL — Teach mode Max can demo, on his own repository, without writing a prompt

**Owner ask, relayed 2026-09-04.** The outcome, stated as something you can stand in front of:
Max opens Sequence, clicks **one** obvious control to say what he already knows about a concept, and
gets a lesson about **his own codebase** that asks a real comprehension question mid-way, withholds
the answer until he commits, reveals it unconditionally next turn whether he answered or not, draws
exactly one visual, and never once asks him which chart kind he wants.

**Why this and not something else:** it is the only feature he has called "very important" unprompted,
twice, and the only one where Sequence has an advantage no generic tutor can manufacture — it can
teach you *your own code*, and prove what it says with `file:line` evidence.

**This file is the plan of record.** A task list that goes stale is worse than none, because it reads
as a plan while describing a past — so it is updated in the same commit as the work it describes.

---

## Status at a glance

| # | Task | State | Gate |
|---|---|---|---|
| 1 | Belt rendered from a lesson context | **DONE** `f2669440` | byte-identity + hash-collision locks |
| 2 | Comprehension in, clarifying at zero | **DONE** `156e6c9e` | grader bounce + negative case |
| 3 | Ask-then-tell; unconditional reveal | **DONE** `ab8a6ef2` `ba19f31c` | 4 locks; falsified before ship |
| 4 | Bench measures the contract it claims | **DONE** `2a5b08f6` `2387f431` | source-scan lock, falsified |
| 5 | `scanCoverage` — absence is not evidence | **DONE** `4ef5dc5e` | 5 unit + 4 premise locks |
| 6 | `teachKnown` rides the six wire sites | **DONE** | typed end to end; belt + hash locks |
| 7 | "What I already know" — three cards, one click | **IN FLIGHT** | built + 6 locks; rendered WCAG measurement still owed |
| 8 | `graph-gap` verdict, before any grader | **NEXT** | correct answer + incomplete scan ⇒ never "wrong" |
| 9 | Re-run the teach bench; replace the void table | **BLOCKED-ish** | needs a model; local Ollama is present |
| 10 | Predict-then-reveal (W3) proper | **PARKED** | tripwire arms when `drawnPrediction` lands |

**Blocked on Max, not on us:** the node-kind silhouettes, and prose-vs-flag for a refuted premise.
Both are untouched deliberately. Neither blocks anything above.

---

## The tasks, in order, with what "done" means

### 1. The prompt is assembled, not typed — DONE

`renderTeachModeInstructions(ctx)` replaces the static constant. Contract clauses stay constant
because they are laws, not parameters. **Byte-identical with no context**, which is what makes it a
refactor: a turn with no lesson state produces the prompt that shipped before, so every measurement
taken against the old belt still describes this one. The instruction hash follows for free —
`computeAskInstructionHash` hashes the *rendered* belt, so two lessons cannot collide.

### 2. Comprehension questions in, clarifying questions at zero — DONE

The count was never the thing worth protecting; the *kind* is. A question sentence carrying our own
tool vocabulary bounces anywhere in the turn. Pinned with the case that separates them: a turn that
interrogates about output options **and** closes with a valid check-in.

### 3. Ask, then always tell — DONE

Rowland 2014: a learner who fails a check and is not told scores **g = 0.03, CI spanning zero**,
against 0.73 when corrected. A mid-lesson question the turn never answers is rhetorical, and the
contract's own earlier wording ("withhold until the learner commits") licensed exactly that. The
reveal is unconditional **including when they were right** — confirming a correct retrieval is the
0.73 cell, not a formality — and it restates the prediction it resolves, because the guessing
benefit vanishes under delay unless the answer carries the guess with it.

### 4. The bench measures the contract — DONE

It did not, twice. It called a four-argument grader with two, so the visual and cite-without-reading
bounces never fired; and it carried a second definition of "visual" that counted a ```mermaid fence
the product refuses. Both fixed, the duplicate definition deleted rather than repaired, and locked
by a source scan that fails if either returns.

### 5. Absence of a signal is not evidence of absence — DONE

`scanCoverage` answers "did the scanner actually look here?" once, over the file-walk cap,
`unfollowed` and `unscanned`. It exists because two features derived it separately in one night, and
building it exposed a live false positive: this repository *has* Python, under `tools/` and
`examples/`, which the walk never enters.

### 6. `teachKnown` rides the six wire sites — DONE

The click reaches the belt through the same path `teach` already uses: composer state →
`connect.tsx` → `PostAskRequest.teachKnown` → both `repoServer` parse sites → `teachContext` on
`AskPipelineInput` → the rendered belt. No new plumbing pattern, and the union is closed at every
hop so a fourth value cannot arrive from a client either.

`null` is "not stated" and is **not** `new`: it adds no skip rather than asserting the learner is a
beginner on their own behalf.

**Still owed:** an HTTP-level test that a request body carrying `teachKnown` changes the belt the
server assembles. Types cover every hop and the belt/hash behaviour is locked, so what is unproven
is only the two `repoServer` parse sites — narrow, and named rather than assumed.

### 7. "What I already know" is ONE click — IN FLIGHT

**Deliverable:** three cards — `new` / `used-it` / `ship-it`. Not a form, not a slider, not a
question.
**The fourth card is banned.** "Not sure, ask me some questions" is the interrogation bug
re-entering through the UI, and it must be impossible to add by accident — so the ban is a test, not
a comment.
**Gate:** renders; every control clears WCAG 2.2 AA 24×24 **at more than one zoom** (board units are
not CSS px — the trap already fixed for the trigger, rows, drag handle and board buttons); no fourth
option exists in the model or the markup.

**Built, with six locks:** exactly three options and none of them asks a question; labels say what
the learner has DONE rather than how expert they are ("I've used it" is checkable, "intermediate" is
a judgement they have to invent); one radio each with the chosen one marked; the click is reported;
clicking the chosen card CLEARS it, because a one-click control you cannot un-click is a trap; and
the default is "not stated" rather than `new`.

**NOT YET DONE, and named rather than assumed: the rendered WCAG measurement.** The CSS declares a
floor of `calc(var(--target-min) * 2)` and every token resolves (the token gate caught two dead
names on the way in), but nothing has *measured* the painted control. These are chat-pane pixels
rather than board units, so they do not scale with camera zoom — the trap that bit the board
controls — but "declared 48px" and "paints 48px" are exactly the two things this repo has learned not
to confuse. The rendered tier (`*Rendered.test.ts`, real Chromium) is where that belongs.

### 8. `graph-gap`, before any grader exists — NEXT

**Deliverable:** the verdict that says "the learner is right and the SCAN is incomplete", built on
`scanCoverage` rather than its own copy of the three signals.
**Why before the grader:** a grader without it marks a correct answer wrong and blames the learner,
which is worse than not grading at all. Building the honest verdict first means the grader cannot
ship without it.
**Gate:** a prediction the graph lacks, over a region the walk never entered, returns `graph-gap` and
never a miss.

### 9. Re-run the bench and replace the voided table — BLOCKED-ish

**Deliverable:** the numbers in `docs/teach-mode.md`, re-measured by the fixed grader.
**Why it is void now:** the current table was produced with two of four rules switched off, and
`52/54` was never the clean count — it was `54 − 2`, runs that did not crash, under a label everyone
read as "obeyed the contract". The real figure is 27/54 and even that is an upper bound.
**Not blocked on a person:** a local Ollama is present. Blocked only on doing it, and it is long.

### 10. Predict-then-reveal (W3) — PARKED, with a tripwire

`docs/research/w3-predict-then-reveal.md` specs it against the fields that actually exist. A running
assertion fails the moment `drawnPrediction` lands, carrying both deferred reveal checks in its
failure message, so the wave cannot ship without implementing them.

---

## Innovations taken, and why

Recorded here rather than buried in commits, because the ask was explicitly to innovate and say why.

- **A quarantine that unquarantines itself.** A skipped check rots; this one *fails when it starts
  passing*, so a fixed defect forces the check back on. Written for the ConPTY flake, then withdrawn
  when measurement showed the failure was intermittent rather than deterministic — the pattern is
  right, that was the wrong home for it. Kept for the next deterministic known-defect.
- **A tripwire for work that cannot be written yet.** The W3 checks cannot exist before
  `drawnPrediction` does, so instead of a doc promise there is an assertion that goes red the moment
  the wire lands and tells the next builder what to implement.
- **Verdicts that admit ignorance as a first-class answer.** `unverifiable` on the premise check and
  `unknown` on the context planner are not weaker findings — they are different ones. "There is no
  Python here" and "I never read the directories where Python would be" are opposite claims.
