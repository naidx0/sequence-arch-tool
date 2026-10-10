# W3 — predict-then-reveal, specced against the fields that actually exist

**Status:** spec, ready for a builder. **Source:** the research agent's teaching-design spec, read
against what shipped 2026-09-02/03 (ask-then-tell, the unconditional reveal, the same-context
restatement). **Prerequisite reading:** `docs/teach-mode.md` — the evidence and the shipped contract.

W3 is the wave that makes a learner's prediction a graded thing instead of a prose convention. Its
whole content is the `drawnPrediction` wire plus a server-side grader. Everything below is written
so the wave can be built without reading the vault spec, and **three of its claims are corrected
here**, because they name fields that do not exist under those names.

---

## 0. What this corrects in the source spec

These were checked in `packages/schema/src/index.ts` rather than taken on trust. The *substance*
survived every check; the field names did not, and one omission is load-bearing.

| the spec says | what exists | consequence |
|---|---|---|
| `ArchEdge.evidenceClass` distinguishes `test` from `source` | **`ArchEdge.instrument?: EdgeInstrument`** | rename; `test-only` is buildable exactly as described |
| `EdgeInstrument` implied to be `source \| config \| manifest \| test` | it also has **`mixed`** | `test-only` is `instrument === 'test'` **only** — `mixed` must not qualify |
| the scanner reports `unreadableSources` by language | **`unfollowed?: UnfollowedSource[]`** *and* **`unscanned?: UnscannedRegion[]`** | two different signals; using one alone produces a false verdict — see §2 |

---

## 1. Five verdicts, not two

`who_calls` returns scanned edges in and out of a node plus transitive reach, and
`propose_topology`'s endpoint validation already performs this class of check, so a prediction is
gradeable exactly.

| verdict | test | what the turn says |
|---|---|---|
| **hit** | the predicted edge exists | confirm, cite the `file:line`, move on |
| **near** | the right neighbour under the wrong name | name the thing they meant — the model of the system was right, the label was not |
| **reversed** | the edge exists with `srcId`/`dstId` swapped | the commonest real mistake, and the graph can prove the direction |
| **test-only** | the edge exists and `instrument === 'test'` | the learner believes something true of the test suite and false of production |
| **graph-gap** | no such edge **and** coverage cannot rule it out | see §2 — the scan doubts itself, not the learner |

**`test-only` is the verdict no generic tutor can manufacture**, and it is why `instrument` exists at
all: `CANON` records `svc:gateway` whose only two inbound edges were nginx confs inside test
fixtures, both carrying `origin: 'deterministic'` — honestly produced and wrong about the world. A
fixture and a production config are the same word to a detector. The learner who predicted that edge
is not wrong about the repository; they are wrong about which half of it they were looking at, and
that is a real defect in a mental model, found by the graph, with receipts.

**`mixed` is not `test-only`.** An edge with citations in both a fixture and a source file is a real
production edge that also happens to be tested. Grading it `test-only` would tell a learner their
correct answer describes only the test suite — the exact false accusation §2 exists to prevent.

---

## 2. `graph-gap` — three coverage signals, and why one is not enough

A learner's answer the graph does not contain **is not automatically wrong.** Before any prediction
is graded a miss, the grader must establish that the scan was in a position to know.

> **Do not re-derive this. Call `scanCoverage(graph)` from `@sequence/schema`.** It already answers
> exactly this question over all three signals below and returns `complete` / `partial` / `unknown`,
> with `canRefuteExtension(coverage, ext)` for the per-extension form. It exists because the
> question-premise check and this verdict derived it separately within one night, and the third
> derivation is the one that gets it subtly wrong — the premise check's own first version gated on
> one signal and shipped a false positive. `docs/how-to-verify.md` carries the law.

Three signals bound it, and they mean different things:

1. **`unfollowed`** — "we opened this and could not parse the language." The C# payment service that
   produced a graph with no payment service in it and nothing saying why.
2. **`unscanned`** — "we never went there at all." Directories holding source no scanned service
   covers.
3. **The file-walk cap** — `scan.ts` stops at `maxFiles` (20,000) and pushes
   `file limit N reached — remaining files skipped` into `graph.warnings`.

**Consulting `unfollowed` alone produces a confidently false verdict, and this repository is the
proof.** Measured 2026-08-22: 59 tracked source files were absent from the graph, *none* of them a
parse failure — all outside every discovered service, because the scan walks service directories and
nothing else. Throughout, `unfollowed` reported `[]`, which its own contract defines as *"the scan
looked and everything was readable."* The graph asserted full coverage over files it had never
opened. A `graph-gap` check built on that one field would have told a learner "no such edge exists"
about code the scanner never read.

So: **a miss is only a miss when all three say the scan was complete for the region in question.**
Otherwise the verdict is `graph-gap`, and the turn says what the scan does show *and* what it could
not reach — "the scan shows no such edge; here is what it does show, and here is what it never
opened (59 files under `tools/`)."

Note the asymmetry that makes this worth building: `unfollowed: []` and `unscanned: []` are
*informative* answers ("looked, and it was all readable"), while **absent** means "not recorded" for
both. An older persisted graph has neither field. Absent must be treated as unknown coverage, never
as full coverage — the same distinction the datastore claim-check already makes between "found
nothing" and "could not check".

This is the honesty invariant applied to teaching. A tutor that can tell "you are wrong" from "my
model does not cover that" is telling the truth about its own limits, which is what the product
claims to do about architecture. **A grader without `graph-gap` marks a correct answer wrong and
blames the learner, which is worse than not grading at all.**

---

## 3. The two reveal checks the wave must unskip

`packages/analyzer/src/test/ask-tool-loop.test.ts` carries a **W3 tripwire**: a running assertion
that no source file declares `drawnPrediction`. It passes today and **fails the moment this wave's
wire lands**, carrying both checks in its failure message. Implementing them is part of W3, not a
follow-up — the wave is not done while that test is red.

Both come from the evidence in `docs/teach-mode.md`:

1. **The reveal fires even when the guess was RIGHT.** Confirming a successful retrieval is the
   g = 0.73 cell, not a courtesy. A model skipping the reveal as redundant after a correct answer is
   optimising away the highest-value case in the table.
2. **The reveal restates the prediction it resolves.** *"You guessed the scan walks imports first —
   it does not, and here is why"*, never a bare *"the scan resolves exports first."* Three studies
   found the benefit of guessing vanishes under delayed feedback; the one condition that recovered
   it was the feedback appearing in the same context as the guess.

**Grade from the prediction the request carries, never by parsing `historyLines`.** Those are
*rendered prompt text*; recovering "was a prediction outstanding" out of prompt formatting is the
declared-is-not-rendered defect, which this repo has hit repeatedly (see the laws in
`docs/how-to-verify.md`). The structured turns exist one level up in `repoServer.ts`; the prediction
should ride the request the way `teach` already does.

---

## 4. The wire

`drawnPrediction?: { nodes, edges }` on the ask request — a deliberate exception to "gestures never
fire a metered run", because in teach mode the learner *explicitly submits* a prediction. A
user-drawn node is already distinguishable from a scanned one **by the absence of `evidenceRef`**,
so provenance is free. The missing piece is only the upward wire; follow the six sites `teach`
already uses.

---

## 5. Acceptance

- Five verdicts, each with a locking test, including `mixed` **not** grading as `test-only`.
- `graph-gap` consults `scanCoverage` (never its own copy of the three signals), with a test proving a
  miss over an unscanned region returns `graph-gap` and not a wrong-answer verdict.
- Absent coverage fields are treated as unknown, not as full coverage.
- The W3 tripwire is green — meaning both reveal checks are implemented, not that the test was
  deleted.
- Gates per `docs/release-gate.md`.
