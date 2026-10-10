# What is open in this tree — 2026-09-07

**Every entry names the file or commit that shows it exists. A reader who is not the author can check
each one against the tree; if an entry cannot be checked, it does not belong here.**

Ordered by what would be lost if it stayed undone, not by effort.

---

## 1. ~~`belt-second-question`~~ — RUN 2026-09-08, refuted

**Closed.** `docs/research/belt-second-question-result.md`. Twelve turns across four arms, no picture
in any, and `proposed 0` throughout: the model never called `propose_chart` on a dependency question.
Control and treatment identical, so the belt is not what suppresses it.

**What it opened instead**, and it is a product item rather than an instrument one: **on a first-tier
ask the chart tool is reachable, documented, and never reached for.** The derived-chart fallback is
gated on `input.teach === true`, so an engineer's turn has neither the fallback nor a model that asks.
That is not on this list yet because it needs a decision about what the product should do, not a
measurement.

<details><summary>the original entry</summary>

## 1. `belt-second-question` — registered, never run

**Evidence:** `docs/research/belt-second-question-registration.md` exists with clauses, a control and
a kill; no result page cites it, and `grep -rl belt-second-question docs/research/*.md` returns only
the registration and the index.

**Why it matters:** it is the only registered, unrun question that touches the **first tier** — *does
the product draw a picture for an engineer?* The seat read of 2026-09-06 found no picture in three
turns of a dependency question, and the Architecture board draws the scanned graph while the chat
does not. Everything else open here is instrument work.

**What it needs:** a browser seat instrument. The referents arms drive HTTP because clause 1 asked
what turn 2 *names*; this one asks whether a **picture** appears, which the DOM is the only witness
to. The registration says so already.

**First in the order because it is the only item whose answer changes what the product is.**

</details>

---

## 2. The arm runner: an aborted arm leaves no trace

**Evidence:** `tools/ci/carry-referents-arm.mjs` writes its record at **line 280**; **six exits occur
before that line** (60, 80, 85, 113, 120, 176 — bad flag ×3, port busy, existing file, stale build).

**Why it matters:** an arm that aborts on any of those writes nothing, so it is **indistinguishable
by construction from an arm nobody started**. Exit 6 (void) writes its file and is therefore
auditable; exits 2, 3 and 4 are not. Five of twenty-one arms in the carry line were void and that was
discoverable only because void arms leave files.

**What it needs:** an append-only exit log beside the arm files — one line per invocation with the
flags, the exit code and the reason. Small, and it makes a missing arm a *record* rather than an
absence.

---

## 3. Exit 5 is unproved; exit 3 cannot fire

**Evidence:** `docs/research/exit-code-isolation-audit.md`, and the runner itself — the arm filename
embeds `RUN_STARTED_AT` to the millisecond, so the overwrite refusal at line 120 needs two runs
beginning in the same millisecond.

**Why it matters:** exit 5 is the assert-the-write rule that came out of the mutation harness's
failed restore, and **it has never executed**. Exit 3 reads as a defence and is redundancy. Neither
is known to be broken; both are unaudited in different ways.

**What it needs:** for 3, a decision — delete it, or make the filename collidable so it can fire. For
5, an honest way to reach it, or a standing record that there is none. **The audit already records
both**; this item is the decision, not the discovery.

---

## 4. Exit 2 carries four causes, and the batch scripts cannot tell them apart

**Evidence:** four `process.exit(2)` sites in the arm runner (lines 60, 80, 85, 113); the batch
pattern used tonight is `if [ $code -ne 6 ]; then break; fi`.

**Why it matters:** a **busy port is transient and retryable; a bad flag never is.** Under one code
the batch abandons a slot that would have succeeded on the next port. It did not bite tonight because
the ports were free.

**What it needs:** split the transient cause from the permanent ones. Deferred deliberately —
changing an exit contract while result pages depend on the scripts that read it is the wrong order.

---

## 5. Phase A scorecard: seven rows, no measurements

**Evidence:** `docs/research/phase-a-dogfood-scorecard.md` has **eight empty result cells**;
`docs/HANDOFF-AGENT-RESTART.md` lists it under *OWNER queue (blocks public beta claim)*.

**Why it matters:** it is the lane's own declared blocker, and its harness **had never run on this
machine** — `tools/bench/phase-a-metrics-report.mjs` died on its first import with
`ERR_UNSUPPORTED_ESM_URL_SCHEME` until `6e7ab094`.

**What it needs:** a live local run fills **M2, M3 and M4**, labelled `providerKind=live,
granite42-hermes (local)` per the harness's own honesty note. **M1 should not be filled** — it is
latency against p50 < 45 s on a 4B local model where seat turns ran 79–176 s, so the number would be
a fact about the model, not about the product a beta user runs with a cloud key. Wrong in the
pessimistic direction is still wrong. M5–M7 need 20 rebuilds and an owner probe.

**This is the item I would take next after (1).**

---

## 6. `prefix-once` and `advance-rule` — registered, in different unfinished states

**Evidence:** both registrations exist; neither is cited by any result page.

- **`prefix-once`** touches the repeated prefix — 5,330 of 5,373 tokens rebuilt byte-identical every
  turn. **Registered, never built, never run.**
- **`advance-rule`** shipped and its kill number *was* answered — by accident, in a run whose control
  predated it. That reading was refused as unattributable (`proposed-law-the-control.md`), so the rule
  is **live in the product with its registered kill never cleanly measured.**

**Why they matter:** the second is the more uncomfortable — a shipped change whose own registration
is unsatisfied. It is not a defect; it is an unclosed loop.

---

## 7. `--push` on the mirror has never been exercised

**Evidence:** `tools/release/mirror.mjs:298` refuses when no `public` remote is configured; `git
remote -v` shows only `origin`.

**Why it matters:** the push path is the only part of the release tool that has never run, and the
clone-URL fault fixed at `35ce76be` was found by *reading* the staged tree rather than by publishing
it. **Owner-blocked** — configuring a public destination is not this lane's decision.

---

## 8. 22.6% of teach turns honour neither naming clause nor the question clause

**Evidence:** 296 concept-bearing turns, nine arm files, `granite42-hermes` Q4_K_M. Scored on
disjoint text, the abstract naming clause is obeyed **49.3%** and the specific one **36.8%**
(`teach-naming-specificity-registration.md`). Cross-tabulating naming against asking any question:
**67 turns (22.6%) do neither** — mean **158 words**, **64 of 67 carried a visual**, 30 stopped
`complete` against 37 `no-progress`.

**Why it matters:** these are not truncated turns and not refusals. A turn that runs to full length,
draws a picture, and honours neither clause is not failing one sentence of the belt, so **no
rewording reaches it** — which is why the naming-specificity arm was withdrawn rather than run. It is
the largest single pocket of teach-contract disobedience measured so far, and it is unexplained.

**What it needs:** the 67 turns read, not counted — what they *did* do with the turn, and whether
`no-progress` and `complete` split into two different faults. **Card-free**; the arm files are
already on disk.

**OPENED AND PARTLY ANSWERED 2026-09-09** — §8 of `teach-mode-driven-end-to-end.md`. Two of the
three claims above were wrong and are corrected there:

- **"64 of 67 carried a visual" credits the model with the product's work.** The model called
  `propose_chart` on **5 of 296** turns and **0 of the 102** that missed the naming clause; ~97% of
  those visuals are the derived chart `buildConceptChart` draws from the scanned graph.
- **"honour neither… the question clause" was a detector artifact.** These turns interrogate hard —
  *"Please provide the specific question you would like me to address"* — but carry no question
  mark, so a `?`-shaped check scored them as asking nothing.

**What was found instead:** **86 of 424 turns (20.3%) hand the lesson back to the learner**, rising
to **39.1% when the queue gave the turn no concept at all**. A grader rule now names it, with a
locking test from the reported shape; the belt was NOT rewritten, because the clause was already
present and the existing bounce was misdiagnosing the fault as missing punctuation.

**Still open, and now the sharper question:** what a teach turn should do when `conceptGiven` is
null. 39.1% is the largest single pocket, it is a queue-exhaustion condition rather than a wording
one, and it is **a product call this lane should not make alone**.

---

## What is NOT open, stated so nobody re-opens it

**The carry line is closed.** Fifteen informative arms across presence, three positions, a pointed
question and an instruction: zero uptake. `carried-context-uptake.md`. **It licenses nothing
further**, and that meant the same thing when it was written as it does now.

**The belt condition is closed** with a full verdict: refuted on clause 1, no detectable rise in
fabrication. `belt-rerun-result.md`. The *second question* (item 1) is a different question with its
own registration, not more arms on this one.

**The two lock recommendations are done** (`e8b62879`), the mirror clone-URL rule is done
(`35ce76be`), and the table-total check is done (`cc463ab5`).

---

## The honest caveat about this page

It is written from the tree by the lane that made most of these entries. **The three items I am least
able to see are the ones I would have to be someone else to notice** — anything in `packages/web2`,
anything an owner would call a product gap, and anything in the parts of the OWNER queue that are
blocked on people rather than on code. This page is not a survey of the repository; it is a survey of
what this lane touched and what it left.
