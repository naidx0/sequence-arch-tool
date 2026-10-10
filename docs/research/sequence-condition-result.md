# The sequence condition: the prediction is refuted on both clauses

**Four runs, 2026-09-06T03:41–05:35Z, `granite42-hermes`, reasoning off, GPU lock held through the
wrapper and released in the same turn.** Registered in `sequence-condition-prediction.md`.

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The four arms

| | old-1 | old-2 | new-1 | new-2 |
|---|---|---|---|---|
| edges in the scan | 2,609 | 2,621 | **2,872** | **2,872** |
| turns | 28 | 28 | 28 | 28 |
| **visual (substantive)** | **17** | **17** | **13** | **15** |
| concept given | 18 | 17 | 14 | 15 |
| **no-node refusals** | **1** | **0** | **1** | **0** |
| check-in | 6 | 9 | 7 | 9 |
| turns seeing 0 digest edges | 27 | 27 | 27 | 27 |
| errored conversations | 0 | 0 | 0 | 0 |

## Both refutation clauses fired

> *Refuted if no-node refusals do not fall on both runs, or if visual-substantive does not rise on
> both.*

- **No-node refusals did not fall.** [1, 0] on the old scan, [1, 0] on the new — identical.
- **Visual-substantive did not rise. It fell**, [17, 17] → [13, 15].

**The prediction is refuted.** The registration named the honest conclusion in advance: *"251 edges
are not where the lessons look… the change is real but irrelevant to teaching."* That is the reading,
with one correction — the fall is not the scan's doing either.

## The fall tracks `conceptGiven`, not the chart

| | old-1 | old-2 | new-1 | new-2 |
|---|---|---|---|---|
| visual ÷ concept given | 17/18 = **94%** | 17/17 = **100%** | 13/14 = **93%** | 15/15 = **100%** |

**The chart draws whenever a concept is given, at the same rate in every arm.** What moved is how
many turns were *given a concept* (18, 17 → 14, 15), which is upstream of `buildConceptChart` and is
decided by the queue and the model, not by the edge count. So the visual figure fell without the
chart's behaviour changing at all — and reporting "the scan change lowered the visual rate" would
have been a real conclusion drawn from the wrong quantity.

**And there is a mechanism reason it could not have risen.** All four arms show **27 of 28 turns
seeing zero digest edges** — measured on the first arm and unchanged since. The scan reaches a teach
turn through the chart (graph-derived), not through the digest, and the chart already drew at
93–100%. There was no headroom for 251 edges to move.

## Wall clock, and a caveat on it

`seq-new-1` took 3,474 s against `seq-old-2`'s 1,248 s, but that is variance, not the scan: each arm
carries occasional multi-minute outliers on the same conversations (`harness-04` 409 s in old-2;
`harness-01` 1,287 s and `cs-05` 1,249 s in new-1) while the other eleven match within a few seconds
across arms. Any wall-clock claim from four runs of this shape would be noise.

## The checkpoint prediction is unmeasured, and the harness is why

> *Registered: opening each of the thirteen sequence-condition lessons on the current build gives
> `migrated 0 of 13`.*

Measured: **9 of 9 migrated** (four of the thirteen carry no chart). But the reason line reads
*"written by 2026-09-06T04:12:46Z, opened on 2026-09-06T05:31:01Z"* — the sessions were stamped by
the build in force during the runs, and the window's `finally` **rebuilt the analyzer afterwards**,
so they were opened on a genuinely different build. The migration was right; the comparison the
prediction asked for never happened.

Fixed so it cannot recur: the restore step now rebuilds only when the restore actually changed a
file. The same-build half of the prediction is separately confirmed at n = 1, card-free, from the
bench writer itself — `migrated false — same build … and schema 1`.

**Not re-run.** Getting the registered comparison needs another bench run on a build that is not
touched afterwards, which is card time this window has already spent.

## Two defects the run found in my own instruments

1. **The window's guard fired on a stale measurement.** It re-imported `scan.js` with a cache-busting
   query after rebuilding; ESM caches the transitive `facts.js`, so the second reading returned the
   first arm's number and the new arm was refused with *"expected ~2,860, measured 2,621"* while the
   build on disk was correct. The edge count is now measured in a child process, as the bench does.
2. **The bench wrote thirteen session directories and registered none of them.** `GET
   /api/sessions/:id` refuses an id that is not in `index.json`, so all thirteen answered 404 — and
   the prediction reported **"MIGRATED 0 of 0"** as though that were a clean pass. A session
   directory is not a session; the index is what makes it one. The writer now registers them, and
   the prediction **refuses** an empty or unreadable denominator instead of printing a zero over it.

The second is the sharper one: I had written that refusal deliberately, and it did not fire because
it guarded the count of directories while the line reported a different denominator. **The
denominator that is reported is the one that has to be guarded.**

## The question the numbers raise: does the concept picker ever name a barrel?

The research lane asked it, and asked for it from the lesson files rather than from reasoning. The
answer is from the four arm reports' per-turn `conceptGiven`, resolved to a node id through each
lesson's `taught` list, against the barrel set read out of the tree — the **19** files that contain
an `export … from`, which are exactly the files the new scan gained edges for.

**No. Zero of 64 concepts across the four arms names a barrel.**

| | old-1 | old-2 | new-1 | new-2 |
|---|---|---|---|---|
| concepts given | 18 | 17 | 14 | 15 |
| **of those, a barrel** | **0** | **0** | **0** | **0** |
| barrel nodes as chart *neighbours* | 4 | 3 | **6** | **7** |
| chart items in total | 70 | 73 | 59 | 69 |

So the 251 edges did reach the pictures — as neighbours, roughly doubling barrel presence, 4 and 3
to 6 and 7. They never reached the subject.

**But the mechanism the question proposes does not hold.** If the picture rate fell because each
ask's edge share shrank, charts would have got smaller. Items per chart went the other way: 3.9 and
4.3 on the old scan, **4.2 and 4.6** on the new. The charts got slightly *bigger*; total items fell
only because fewer turns were given a concept at all. The fall is upstream of the picture, and this
is the second reading it survives.

## The coverage chip is not undercounting. It is counting something else.

Named at 21:47 as an undercount; the per-turn numbers say it is worse than that.

| | old-1 | old-2 | new-1 | new-2 |
|---|---|---|---|---|
| turns with `edgesSeen: 0` | 27 of 28 | 27 of 28 | 27 of 28 | 27 of 28 |
| …of those, turns that **drew a chart** | 16 | 16 | 12 | 14 |
| graph edges those charts used | **49** | **52** | **42** | **50** |
| the one turn with `edgesSeen > 0` | 185 | 184 | 191 | 191 |
| graph edges **that** turn's chart used | **4** | **4** | **4** | **4** |

One turn in every arm — `link-04` turn 0, the same one each time — reports 184–191 edges seen and
draws a picture grounded in **four**. The other 27 report zero, and between them draw pictures
grounded in forty-two to fifty-two.

The chip is a **digest-coverage** number wearing a grounding label: it counts what retrieval put in
front of the model, which is empty on a turn the model answers from the chart tool. It is not a
statement about whether the answer was grounded, and it is off by a factor of forty-eight in the one
place it is loud. **The grounded count is the chart's own edge count**, and it is the number that
belongs beside it — printed above for every arm, and the reason the "27 of 28 see nothing" line must
never be read as "27 of 28 turns were ungrounded".

Deliberately not fixed here: the chip is an instrument the running experiment is measured with, and
changing it mid-experiment would make the four arms incomparable.

## Why four fewer turns were given a concept — the metric rewards failure

The research lane asked for this from the lesson files. It does not end where either of us
expected: **the scan changed no queue at all**, and the statistic that fell is one that rises when
the model does worse.

### The picker never declined with candidates in hand

Every turn given no concept, in all four arms — 10, 11, 14 and 13 of them — has `queueLen: 0`. Not
one turn had a candidate and passed on it. The question "what did the picker see" has one answer
everywhere: **nothing left**.

### The queue is identical across arms

`buildQueue` walks `graph.edges` in edge order, so 251 new edges could have reordered it. They did
not change what any lesson was taught:

- **The turn-0 concept is byte-identical in all four arms for all thirteen conversations.**
- The four conversations that differ between arms — `link-04`, `mix-03`, `mix-06`, `harness-07` —
  each have `queueLen: 1` at turn 0 on **both** scans, with the same concept (`http.ts`, `diff.ts`,
  `client.ts`, `grade.ts`). None of their asks matches `SEQUENCE_ASK`, so `buildQueue` returns
  `out.slice(0, 1)` and never reaches the neighbour walk the new edges live in. The 251 edges are
  not merely in the wrong place for these lessons — they are behind a branch the lessons never take.

So whatever moved is downstream of the queue.

### What moved is stubs, and stubs inflate the count

| | old-1 | old-2 | new-1 | new-2 |
|---|---|---|---|---|
| stub turns (produced nothing) | **9** | **5** | **3** | **4** |
| concepts given | 18 | 17 | 14 | 15 |

Pooled over all four arms, 60 turn-pairs:

| | after a **stub** turn | after a **real** turn |
|---|---|---|
| a one-entry queue survives | **4 of 4 — 100%** | 7 of 20 — 35% |
| the next turn has a concept | 6 of 7 — 86% | 22 of 53 — 42% |

**A stub does not consume its concept.** The turn produces nothing, the queue keeps its single
entry, and the following turn is counted as having been given a concept — so one failed turn adds
one to `conceptGiven`, and to `visual` with it, since the chart draws whenever a concept is present.

The old arms stubbed 9 and 5 times; the new arms 3 and 4. The drop in stubs (about 3.5) is the size
of the drop in concepts given (about 3). **The new arm scored lower because it failed less.**

### What this means for the registered prediction

The prediction was refuted, and it stays refuted — but the reason is now sharper than "the edges are
not where the lessons look". `visual-substantive` **is not a measure of the product's behaviour on a
one-entry queue**: it counts turns holding a concept, and a turn holds a concept partly because the
previous turn failed. A run that improves by stubbing less will score lower on it. No amount of
re-running fixes that; it is the statistic, not the sample.

Two further readings that follow, and both matter more than the original question:

- **Same-scan runs disagree on 2 of 13 conversations; cross-scan runs on 4 and 6.** The ranges do
  not overlap, so by the replication rule there is a real difference between the arms — but it is
  carried by the stub rate, not by anything the chart did.
- **`conceptGiven` and `visual` must not be reported as teaching quality until this is fixed.** The
  honest denominator is turns that produced real prose; the current one is closer to
  "turns holding a concept, including because the last one broke".

Deliberately not fixed here, for the same reason as the coverage chip: it is the instrument the
four arms were measured with, and changing it now would make them incomparable. It is the first
thing to change before the next condition runs.

## The four arms re-reported under the corrected statistic

A stub is now excluded from both halves and reported in its own column. Both readings, side by side,
because the prediction was judged under the uncorrected one and the record has to show why the
judgement changed.

| | old-1 | old-2 | new-1 | new-2 |
|---|---|---|---|---|
| **stubs** | **9** | **5** | **3** | **4** |
| lesson turns (produced prose) | 19 | 23 | 25 | 24 |
| **concepts given** — corrected | **12** | **14** | **12** | **14** |
| — as registered | 18 | 17 | 14 | 15 |
| **visual-substantive** — corrected | **11** | **14** | **11** | **14** |
| — as registered | 17 | 17 | 13 | 15 |
| **check-in** — corrected | **6** | **9** | **7** | **9** |

**Under the corrected statistic the two scans are indistinguishable.** Concepts given: 12 and 14 on
both sides. Visual-substantive: 11 and 14 on both sides. Identical, not merely overlapping — the
replication rule does not even have to be applied.

The whole of the apparent difference was the stub rate, 9 and 5 against 3 and 4, and the direction
is the reverse of how it read: **the new arm produced six more lesson turns than the old one**, 25
and 24 against 19 and 23.

So the finding is now stronger and simpler than the one registered, and than the one in the section
above. The prediction is still refuted — the 251 edges changed nothing a lesson could see — but
there is no longer a fall to explain. There never was one; there was a statistic that counted
failure as coverage.

**The locking case is `tools/ci/seq-condition-metrics.test.mjs`,** and its first assertion is the
defect stated as a fact: two runs of one lesson, one of which fails its first turn, and the
uncorrected statistic scores the failing run **higher** — 3 concepts against 2. That assertion
exists so the shape cannot be reintroduced quietly.
