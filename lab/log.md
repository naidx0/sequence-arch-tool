# Sequence lane log

Each entry: hypothesis, win rule written before the run, baseline, new, delta, n, noise, verdict.

## 2026-09-23 · Dry run of the cloud patches at Sequence head 599b1c35

Not a hypothesis; a fit check. 0001, 0005, 0015 and 0017 apply clean in order. The other 17
conflict at head, mostly because Slices 10 to 12 rewrote `askPipeline.ts`, `askTools.ts`,
`connect.tsx` and `files.css` after the 0.1.2 mirror the cloud built on. 0008, 0010, 0016, 0018
and 0020 also fail because an earlier patch they build on did not land. Full list:
`gpu/dryrun-599b1c35.log`. 0021 (checked alone) conflicts in `v3.css`.

## 2026-09-23 · Drawing-language A/B on the GPU: MiniCPM5 (minicpm5-hermes), hard shopfront set

Hypothesis: a cheaper drawing language grounds better than JSON on the real small model.
Win rule (the cloud lane's, registered before its stand-in run and reused unchanged): grounded rate
AND hop coverage both above JSON by more than run-to-run noise (2 SE, paired by run).
Setup: 7 hard questions x 5 languages x 6 runs = 210 answers, max_tokens 400, reasoning_effort
none, server-default temperature, whole 36-part scan in the prompt (`--max-nodes 40`), GPU lock
per language. The run dropped at 209/210; the last answer was made on resume with the frozen plan
reproduced byte for byte (one answer made first with a 24-part slice was deleted, not scored).
Plain rescore of the saved answers reproduces the live table exactly.

| lang | parse | grounded | hop cov | out tok (median) |
|---|---|---|---|---|
| json (baseline) | 81% | 12% | 0.07 | 173 |
| flow | 14% | 0% | 0.01 | 193 |
| mermaid | 0% | 0% | 0.00 | 160 |
| dot | 88% | 21% | 0.50 | 181 |
| path | 79% | 0% | 0.24 | 132 |

Paired by run, minus JSON: DOT hop +0.43 (SE 0.06), grounded +0.10 (SE 0.10). Path hop +0.17
(SE 0.05), grounded -0.12 (SE 0.02).
Verdict: **no language kept by the rule.** DOT clears it on hop coverage by 7 SE but not on
grounded. It is the lead arm for the next run. Mermaid and flow do not parse on MiniCPM5 and are
discarded for this model. The Haiku stand-in (grounded 29-57%, hop 0.89-0.97) overstated every
language badly; the real model's failure is parsing and hops, not traps.

## 2026-09-23 · Patch 0018 (drop invented links in code) on the same 210 MiniCPM5 answers

Win rule: grounded up outside noise, hop coverage not down. Same sealed answers, no model calls.

| lang | grounded before -> after | hop cov before -> after (paired delta, SE) | charts left with no links |
|---|---|---|---|
| json | 12% -> 74% | 0.07 -> 0.13 (+0.056, 0.022) | 16 |
| flow | 0% -> 14% | 0.01 -> 0.02 (+0.010, 0.006) | 3 |
| mermaid | 0% -> 0% | 0 -> 0 | 0 |
| dot | 21% -> 88% | 0.50 -> 0.53 (+0.036, 0.017) | 4 |
| path | 0% -> 79% | 0.24 -> 0.25 (+0.007, 0.005) | 1 |

Grounded rises to the parse rate by construction; no answer lost hop coverage. Kept, as the cloud
found (stand-in: 13/13 refused charts grounded, hop 0.971 vs retry 0.907). Caveat for shipping:
on JSON, 16 of 42 repaired charts end with parts and no links, so 0018 should refuse a chart that
drops to zero links rather than draw boxes joined to nothing. With 0018, DOT minus JSON: grounded
+0.14 (SE 0.08), hop +0.41 (SE 0.07); still short of 2 SE on grounded.
Files: `gpu/ab/draw-lang-minicpm5/`.

## 2026-09-23 · 0018 follow-up: refuse a repair that drops every link

Hypothesis: a repaired chart left with parts and no links should count as refused, not grounded.
Win rule: the flag marks exactly the charts that had links and lost all of them; no other
answer's score moves. Same 210 sealed answers, no model calls.
Result: 25 charts marked (json 17, flow 3, dot 4, path 1); no other score moved. Kept.
Kit commit bdf62c6f on lab/draw-lang-ab-gpu (`gpu/kit-patches/0003-*`); schema 482/482, kit CI 6/6.

| lang | grounded with 0018 | with 0018 + refusal | hop cov |
|---|---|---|---|
| json | 74% | 36% | 0.13 |
| flow | 14% | 7% | 0.02 |
| mermaid | 0% | 0% | 0.00 |
| dot | 88% | 79% | 0.53 |
| path | 79% | 76% | 0.25 |

Under this condition, DOT minus JSON (paired by run): grounded +0.43 (SE 0.17), hop +0.41 (SE 0.07).
Path minus JSON: grounded +0.41 (SE 0.07), hop +0.12 (SE 0.04). Both clear the language rule at
2 SE, but the condition was chosen after seeing these answers. **Not kept yet**: confirm DOT and
path against JSON on fresh answers (new seeds, 0018 + refusal on) before switching the chart language.

## 2026-09-23 · Confirmation on fresh answers: DOT and path vs JSON, 0018 + zero-link refusal on

Hypothesis and rule as registered above: grounded AND hop coverage above JSON by more than 2 SE,
paired by run, on answers the rule was not chosen on. 7 hard questions x 3 languages x 6 runs =
126 new MiniCPM5 answers, same settings (kit bdf62c6f).

| lang | parse | grounded (plain) | grounded (0018 + refusal) | hop cov | median out tok | median ms |
|---|---|---|---|---|---|---|
| json (baseline) | 81% | 12% | 43% | 0.16 | 195 | 2101 |
| dot | 81% | 21% | 76% | 0.48 | 243 | 2477 |
| path | 86% | 10% | 83% | 0.30 | 95 | 1089 |

Paired by run, with 0018 + refusal: DOT minus JSON grounded +0.33 (SE 0.05), hop +0.31 (SE 0.07).
Path minus JSON grounded +0.41 (SE 0.04), hop +0.14 (SE 0.03). Without the repair neither clears
grounded (DOT +0.10, SE 0.07).
Verdict: **kept: DOT and path both beat JSON on this model once 0018 + refusal is on.** DOT has the
best hop coverage (0.48); path is less than half the output and time. Recommendation: DOT as the
small-model chart language, path as the fast option. Not yet built into the app's propose_chart;
that is the next slice, and 0018's app half is one of the 17 patches waiting on the port kit.

## 2026-09-23 · Cloud patches at the real head 599b1c35 (branch lab/patches-at-599b1c35, 3ba8f6b7)

Not an A/B; a port and gate. Base gates at 599b1c35: CI 333, analyzer 3054, web2 3191, all pass.
In (one commit each, `gpu/port-599b1c35/`): 0001, 0005, 0015, 0017 (clean); 0002, 0013, 0014, 0020
(port.mjs); 0018a hand-ported with the zero-link refusal (4 tests, the refusal test fails without
it); 0011 schema half (flowLines.ts, which 0014 imports); the kit's Windows exit fix (3 CI tests
failed without it); 0021 (1 ambiguous hunk placed on .v3-session-more); 0019 without its Files-pane
collapse (head already rails a narrow Files pane at 420px; focus-ring test made CRLF-safe); 0003
(import hand-added).
Gates at 3ba8f6b7: CI 362/362, analyzer 3065/3065, web2 3243/3243, schema 485/485.
Held: 0004, 0006, 0007, 0008, 0009, 0010, 0011 (app half), 0012, 0016; 0018 full is superseded by
0018a plus the kit's schema half. Folded the cloud lane's log.md, handoff.md and port kit into cloud/.

## 2026-09-23 · Port continued: 18 of 21 cloud patches hold at 599b1c35 (7d6b7cfa)

Added since 40d03e8, one commit each: 0016 (queue_consume grounds either way, also in head's
liftedEdgeKeys; new analyzer test, the topic -> subscriber case fails without it), 0004, 0006
(builder appended, import hand-added), 0008 (SessionsPanel test hunks dropped; that file is gone).
Gates at 7d6b7cfa: CI 362/362, analyzer 3079/3079, web2 3246/3246, schema 488/488.
Held, each needing a design call or a look in the browser rather than a text port:
- 0007 one request, one frame: head routes charts to surfaces (plan surface), so "this turn's
  charts are the last on the doc" no longer holds; the replace rule needs redesign.
- 0009 Files header fit: head rewrote files.css headers; needs the Chromium probe, not a guess.
- 0010 deflection floor: overlaps head's Slice 10 floor.
- 0011 app half: head's propose_chart has its own flow path; keep one.
- 0012 sessions list once: rail and shell rewritten since 0.1.2; re-measure the duplicate first.

## 2026-09-23 · Port finished at 599b1c35, and DOT wired behind a flag (59f572a0)

Port: every cloud fix is now either in or measured as not needed at head.
- 0007 ported with one call: a redraw is matched only on its own surface (head routes charts to
  surfaces); new full-turn test fails without the filter.
- 0010 ported (flagged); one assertion rewritten for head's Slice 12 settle note.
- 0011 app half ported (flagged); with the flag off, propose_chart publishes head's own text.
- 0009 not ported: its probe, run inside the pane container, finds nothing overlapping at head
  (180-480px); the probe is kept as a regression check.
- 0012 not ported: surface-load at head (3 runs) shows GET /api/sessions twice at boot and 0
  duplicates per tab click, against 17 and 2-4 on the 0.1.2 mirror.
New: SEQUENCE_CHART_LANG=dot makes propose_chart take a Graphviz digraph of file paths, compiled
by the schema's DOT compiler, held to the same validator, with the invented-link drop and the
zero-link refusal on. 3 tests.
Gates at 59f572a0 (24 commits over 599b1c35): CI 362/362, analyzer 3102/3102, web2 3248/3248, schema 488/488.

## 2026-09-23 · 12 fresh runs: DOT vs path vs JSON, 0018 + refusal on

Rule as registered: beat JSON on grounded AND hop coverage by more than 2 SE, paired by run.
Pooled confirm + confirm2, 12 runs x 7 hard questions = 84 answers per language.
| lang | grounded | hop cov |
|---|---|---|
| json | 40.5% | 0.158 |
| dot | 79.8% | 0.495 |
| path | 85.7% | 0.290 |
DOT minus JSON: grounded +0.39 (SE 0.06), hop +0.34 (SE 0.04). Path minus JSON: +0.45 (SE 0.05),
+0.13 (SE 0.02). DOT minus path: grounded -0.06 (SE 0.05, noise), hop +0.21 (SE 0.04).
Verdict: **DOT kept as the small-model chart language** (now behind SEQUENCE_CHART_LANG=dot).
It ties path on grounding and beats it on hops; path stays the fast option.

## 2026-09-23 · Registered before the run: DOT flag in the real teach turn

Hypothesis: SEQUENCE_CHART_LANG=dot lands more charts in real teach turns than JSON.
Arms: tools/bench/teach-eval.mjs on the 13 shopfront conversations, MiniCPM5 (minicpm5-hermes,
Ollama), port branch 59f572a0; control unset, treatment SEQUENCE_CHART_LANG=dot. Same bank, same
scripted learner replies, bench temperature 0.
Win: charts landed per turn (chart:proposal) higher in DOT by more than 2 SE, paired by
conversation, with lesson quality (bench lesson-quality score) not lower by more than 2 SE.

## 2026-09-23 · Result: DOT flag in the real teach turn (registered above)

13 shopfront conversations, 28 turns per arm, MiniCPM5, port branch 59f572a0.
| arm | propose_chart calls | charts landed (all sources) | mean lesson quality |
|---|---|---|---|
| json (control) | 3 | 22 | 70.9 |
| dot | 2 | 19 | 70.1 |
Paired by conversation: charts landed per turn -0.12 (SE 0.08), quality -0.8 (SE 1.7).
Every model chart call was accepted in both arms.
Verdict: **discarded; the flag stays off.** In a real teach turn MiniCPM5 calls propose_chart on
about 1 turn in 10; the product's own floors draw most charts, so the drawing language barely
enters the turn. The DOT win holds where the model draws (the A/B kit), not in today's teach turn.
Next hypothesis: what gets the model to draw at all in a teach turn, before the language matters.
Files: gpu/ab/teach-dot/.

## 2026-09-23 · Registered before the run: chart tool first in the menu (teach turn)

Hypothesis: MiniCPM5 calls propose_chart more often in teach turns when it is first in the tool
menu (SEQUENCE_TEACH_CHART_FIRST=1). The belt already asks for one chart per concept, so a
one-line instruction would repeat it; the menu order is the untried lever.
Control: the JSON arm of the DOT teach-turn run (13 shopfront lessons, 28 turns, 3 chart calls,
quality 70.9), same bank, same bench settings, port branch plus this flag only.
Win: model chart calls per turn higher by more than 2 SE paired by lesson, quality not lower by
more than 2 SE.

## 2026-09-23 · Result: chart tool first in the menu, shopfront (registered above)

13 lessons, 28 turns per arm. Model chart calls 3 -> 13, but paired by lesson +0.30 per turn with
SE 0.23 (inside noise); quality -0.2 (SE 1.0). The calls cluster: one lesson made 6 in a single
turn (repeat redraws), one made 5. Turns with at least one model chart call: 2 -> 4 of 28.
Verdict: **not kept on this set (inside noise); not discarded either.** Too few lessons.

## 2026-09-23 · Registered before the run: chart-first on the 28 makemore lessons

Same flag, new sealed set: the 28 makemore lessons in the bench, both arms run now (control
unset, treatment SEQUENCE_TEACH_CHART_FIRST=1). Metric fixed now, before the run, to the one
that is not inflated by repeat calls in a turn: share of turns with at least one model
propose_chart call. Win: higher by more than 2 SE paired by lesson, quality not lower by 2 SE.

## 2026-09-23 · Result: chart-first menu on the 28 makemore lessons (registered above)

Control 61 turns (1 errored turn excluded), treatment 63. Turns with at least one model
propose_chart call: 8 -> 11 (calls 11 and 11). Paired by lesson (n 27): +0.05 (SE 0.07);
quality +0.0 (SE 1.1).
Verdict: **discarded; SEQUENCE_TEACH_CHART_FIRST stays off.** Menu order does not move how often
MiniCPM5 draws. With the shopfront set, two cheap levers are now ruled out (drawing language, menu
order); the model draws on roughly 1 turn in 6 to 7 whatever we do to the tool itself.

## 2026-09-23 · Registered before the run: D2 and state-machine arms on MiniCPM5

Resume-list item 2 (cloud handoff): MiniCPM5's own numbers for d2 and states (patch 0020, kit
b9b1c70f). Arms json, d2, states, dot; 7 hard shopfront questions x 6 fresh runs; same settings as
the DOT confirmation (max-nodes 40, reasoning none, server temperature), scored with 0018 +
zero-link refusal. Win for a new arm: beats DOT (the kept arm) on grounded AND hop coverage by
more than 2 SE paired by run; else it is recorded and not kept.

## 2026-09-23 · Result: D2 and state-machine arms on MiniCPM5 (registered above)

168 fresh answers (4 langs x 7 hard questions x 6 runs), scored with 0018 + zero-link refusal.
| lang | parse | grounded | hop cov | median out tok |
|---|---|---|---|---|
| json | 81% | 40% | 0.16 | 227 |
| dot (kept) | 74% | 69% | 0.43 | 194 |
| d2 | 81% | 74% | 0.43 | 191 |
| states | 71% | 64% | 0.31 | 239 |
Paired by run against DOT: d2 grounded +0.05 (SE 0.10), hop +0.00 (SE 0.08); states grounded
-0.05 (SE 0.12), hop -0.12 (SE 0.10). JSON against DOT: -0.29 (SE 0.11), -0.27 (SE 0.08), a fourth
fresh confirmation that DOT beats JSON.
Verdict: **d2 not kept (ties DOT), states not kept (no better, fewer hops).** DOT stays the
small-model language. The cloud's Haiku result (states best on hops) does not hold on MiniCPM5.

## 2026-09-23 · Offline checks on the teach-turn runs (5 arms, 208 turns, no new model calls)

(1) Does a floor chart already on screen stop the model drawing? In the code, the teach floor
draws only after the model's turn, and only when the model drew nothing (askPipeline, chartsThisTurn
=== 0), so within a turn the model never sees it. Across turns: model drew on 15% of first turns
(14/94) and 11% of later turns (13/114); after a turn whose only chart came from the floor, 8%
(6/71), otherwise 16% (7/43). Difference 8 points, SE about 6.5: inside noise. Verdict: **no
evidence the floor suppresses drawing; not worth a GPU arm.** Recorded so it is not retried blind.
(2) The model's own teach-turn charts: 40 propose_chart calls, 36 accepted as drawn (90%). Of the
4 refused, 2 were one invented link each (0018 would draw them without it: 38/40, 95%) and 2 were
duplicate item ids (still refused). So 0018 adds about 5 points in real teach turns, where the
model mostly draws grounded charts already.
(3) Not run: path as the quick-answer format in teach turns. The DOT teach A/B showed the chart
language barely enters a teach turn (the model draws on 1 turn in 6 to 7), so a teach-turn A/B of
path would measure the same null. Path's speed matters only where the model draws; the isolated
A/B already has that number (median 95 tokens and 1.1 s against JSON's 195 and 2.1 s).

## 2026-09-24 · Load-time baseline (no change made yet)

surface-load, 5 runs x 2 rounds each, no repo attached, same machine, interleaved.
| build | tabs visible (median ms) | settled (median ms) | API calls at boot | bundle js+css raw / gzip |
|---|---|---|---|---|
| base 599b1c35 | 159, 162 | 474, 478 | 14 | 8,759,653 / 2,437,407 |
| port branch cf03dacd | 157, 150 | 469, 461 | 12 | 8,761,994 / 2,437,980 |
The port branch drops 2 boot calls (ai-config and canvas-doc repeats, 0013/0015); paint and settle
move by under 10 ms, inside run-to-run spread. A load-time change is queued behind the product ask.

## 2026-09-24 · Registered before the run: product-mode teach turn (Jaden's three questions)

Hypothesis: SEQUENCE_TEACH_PRODUCT_MODE=1 answers product questions with the product (newcomer
shape, README first, concept flow chart, no file quiz) and does not resend the last answer.
Bench tools/bench/product-question-ab.mjs (e6ef7d80): the owner's 3 questions on ML Harness
(5318f3b) as one conversation, plus the same 3-turn shape on shopfront and makemore; MiniCPM5,
2 runs per arm, 18 turns per arm. Paired by (conversation, turn, run).
Win (all of): repeat similarity to the previous answer lower by more than 2 SE; code tokens per
100 words lower by more than 2 SE; product-shape answers more frequent by more than 2 SE; risk
claims not more frequent; lesson quality not lower by more than 2 SE.

## 2026-09-24 · Product-mode A/B run 1: discarded as an instrument fault

The bench passed the ML Harness root with forward slashes; resolveInRepo compares against the
canonical path, so every read_file on ML Harness was refused in BOTH arms. It still showed two real
things: with the flag on, code tokens fell (about 1 per 100 words against 7) but the model answered
"I cannot answer, the README was refused" and then repeated that refusal word for word (repeat
0.66 to 1.0), and on shopfront and makemore, which have no README, it refused the same way. So the
repeat guard as a prompt line does not stop a small model repeating. Fixes (fb19bf66): canonical
repo paths in the bench; product mode answers from the code when there is no README and may never
answer "I cannot answer". Run 2 below uses the same registered rule on the fixed bench.

## 2026-09-24 · Load time: defer the goal-run reads until boot settles (discarded before measuring)

The two repeated boot reads left on the branch (GET /api/sessions/<id> twice, and the goal run
behind it) come from useGoalRun reading once before the repo path resolves and again after.
Holding its sessionId at null until boot settles removes them, but 26 web2 tests (V3App,
V3GoalRun, V3SlashGoal goalbar cases) build a store that never settles boot and fail. The gain is
two localhost GETs; paint and settle already differ by under 10 ms between base and branch.
Verdict: **discarded, not worth rewriting 26 tests' setup for two local reads.** Reverted.
What load time is left to win is in the bundle (8.76 MB raw, 2.44 MB gzip, 66 files).

## 2026-09-24 · Load time: what boot actually loads (measurement, no change)

index.html pulls one script and one stylesheet: index-*.js 1,210,010 bytes and index-*.css
369,737 bytes. The heavy libraries are already split out and load only on demand: babel 2.34 MB,
elk 1.44 MB, cynefin 0.69 MB, mermaid 0.66 MB, cytoscape 0.44 MB, katex 0.26 MB. Tabs are visible at
about 155 ms and the app settles at about 465 ms on this machine. No cheap split is left at
boot; the next load win would need a bundle analysis of index-*.js, which is not worth it at
these numbers for a local app. Load-time lane item closed unless a slower machine shows otherwise.

## 2026-09-24 · Result: product-mode teach turn, run 2 (rule registered above)

18 turns per arm (3 conversations x 3 turns x 2 runs), MiniCPM5, fixed bench (fb19bf66). On - off,
paired by (conversation, turn, run):
| measure | off | on | on - off (SE) | rule |
|---|---|---|---|---|
| repeat of previous answer | 0.27 | 0.33 | +0.06 (0.12) | lower by 2 SE: **fail** |
| code tokens per 100 words | 5.8 | 2.2 | -3.5 (1.2) | lower by 2 SE: pass |
| product shape (what, who, why, steps, advantages) | 0% | 50% | +0.50 (0.12) | more by 2 SE: pass |
| file chart drawn | 28% | 6% | -0.22 (0.13) | (reported) |
| unsupported risk claims | 22% | 6% | -0.17 (0.12) | not more: pass |
| lesson quality | 64.6 | 57.5 | -7.1 (4.4) | not lower by 2 SE: pass |
Verdict: **not kept as registered (the repeat measure fails).** The product half works: on Jaden's
own questions it now reads the README and says what ML Harness is ("a local-first decision tool
for model training: it diagnoses whether training is the right call, then hands execution to a
pinned backend"), with half the answers in the full product shape and far fewer file names. The
repeat half does not: the model sent the same answer on all three turns of Jaden's conversation
(similarity 0.79 and 1.0). A prompt line cannot stop a small model at temperature 0 from
repeating. Next: split the two. Keep product mode as its own flag and test a code-level repeat
check that re-asks once when an answer matches the last one.

## 2026-09-24 · Registered before the run: code-level repeat guard

Hypothesis: SEQUENCE_TEACH_REPEAT_GUARD=1 (the grader bounces a draft whose 5-gram Jaccard with the
last answer is >= 0.6, once, for a new answer) stops the resend. Arms: 'on' (product mode only,
reuse run 2's 18 turns) vs 'guard' (product mode + guard), same bench, same 18 turns, MiniCPM5.
Win: repeat similarity lower by more than 2 SE, paired; product shape not lower by 2 SE; quality
not lower by 2 SE.

## 2026-09-24 · Result: code-level repeat guard (registered above)

18 turns, product mode on in both arms, guard off vs on, paired: repeat 0.33 -> 0.40, +0.07 (SE 0.09);
product shape -0.06 (SE 0.15); quality +4.3 (SE 3.7); time per turn +2.9 s (SE 2.1).
On Jaden's own conversation the guard cut repeats in 3 of 4 later turns (0.16, 0.10, 0.21) but one
retry came back byte-identical, and an identical retry is accepted as the draft (Slice 11 rule),
so it went out at 0.96. Across all three conversations it is inside noise.
Verdict: **discarded as registered; both flags stay off.** What is learned: MiniCPM5 at temperature
0 resends the same text to the same prompt, and a bounce that returns the same text is accepted.
A guard that works would need a different retry (for example sampling at a higher temperature for
the retry only), which is the next test if this lane comes back to it.

## 2026-09-24 · Registered before the run: repeat guard with hot retries

Fix from the last result: a repeat retry now samples at temperature 0.8, up to two retries, each
checked again; still repeating after two, the turn says it already covered that instead of
resending. Arms 'on' (product mode, run 2's 18 turns) vs 'guard' (product mode + guard), one run
of 2 x 3 conversations, same bench. Win: repeat similarity lower by more than 2 SE paired; product
shape and quality not lower by more than 2 SE.

## 2026-09-24 · Files beside Architecture at 400px: does not reproduce at head (no change)

Decided call (hide the tree at that size behind the header toggle) checked first in Chromium on the
port branch (cf03dacd + later), shopfront attached, Architecture then Files clicked. At 400x800 the
narrow window shows one pane; Files gets the 120px tree rail and a 279x349px reading area (it was
0px tall on the 0.1.2 mirror). At 1440 the reading area is 337x687. Head's own rail rule
(@container files-pane, 420px) already fixed it, so nothing is changed. Screenshots in
gpu/ab/files-400/. The decision stays recorded in case a taller window shows it again.

## 2026-09-24 · Result: repeat guard with hot retries (registered above)

18 turns, product mode on in both arms, paired: repeat 0.33 -> 0.18, -0.16 (SE 0.13, n 12);
product shape -0.06 (SE 0.17); quality +1.3 (SE 4.3); code tokens -0.3 (SE 0.6); +4.1 s per turn
(SE 4.4). 3 of 18 turns ended on the "already covered" line. On Jaden's own conversation, later
turns scored 0.02, 0.01, 0.20 and 0.59 (all under the 0.6 bar; before: 0.66 to 1.0).
Verdict: **not kept yet (1.2 SE, short of 2).** The direction is right and nothing got worse.
Next: the same two arms at 6 runs each (36 paired later turns) to settle it before the flag moves.

## 2026-09-24 · Registered before the run: hot-retry repeat guard at 6 runs

Same bench, same rule as above; arms 'on' and 'guard' each 6 runs (54 turns, 36 paired later turns),
run fresh for both arms. Win: repeat lower by more than 2 SE paired; shape and quality not lower
by more than 2 SE.

## 2026-09-24 · Result: hot-retry repeat guard at 6 runs (registered above)

54 turns per arm (3 conversations x 3 turns x 6 runs), product mode on in both, guard off vs on,
paired (36 later turns for the repeat measures):
| measure | on | guard | guard - on (SE) | rule |
|---|---|---|---|---|
| repeat of previous answer | 0.46 | 0.14 | -0.32 (0.07) | lower by 2 SE: pass (4.7 SE) |
| answers at or over the 0.6 repeat bar | 39% | 3% | -0.36 (0.09) | (reported) |
| product shape | 54% | 37% | -0.17 (0.09) | not lower by 2 SE: pass (1.8 SE) |
| lesson quality | 62.1 | 57.0 | -5.1 (2.6) | not lower by 2 SE: pass (1.96 SE, at the edge) |
| code tokens per 100 words | 1.1 | 1.9 | +0.8 (0.4) | (reported) |
9 of 54 guard turns ended on the "already covered" line, which is short and scores low on shape and
quality; that is most of the drop in both.
Verdict: **kept, behind SEQUENCE_TEACH_REPEAT_GUARD=1, together with SEQUENCE_TEACH_PRODUCT_MODE=1.**
Repeats fall from 39% of later answers to 3%. The cost is the fallback turn; the next test is a
better fallback (for example, answer the most specific noun in the question) so shape and quality
recover.

## 2026-09-24 · Registered before the runs: new-only fallback, then a blind check

(a) Fallback. SEQUENCE_TEACH_REPEAT_FALLBACK=new-only (3cefce75): when the hot retries still repeat,
send the draft's sentences the last answer did not have ("Adding to my last answer: ...") when there
are at least two, else the short line. Arm 'guard3' (6 runs) against the 6-run 'guard' arm above,
same bench and settings. Win: lesson quality or product shape higher by more than 2 SE paired, and
repeat not higher by more than 2 SE.
(b) Blind check, as the coordinator set it: a separate worker writes 8 fresh 3-turn product
conversations over ml-harness, shopfront, makemore and Sequence itself, sealed by sha256 before
any run and never tuned on. Arms 'off' (no flags) vs the kept pair (product mode + guard, with the
winning fallback), 2 runs each. Win: repeat lower by more than 2 SE, product shape higher by more
than 2 SE, quality not lower by more than 2 SE. If (b) passes, both flags go on by default on the
port branch only.

## 2026-09-24 · Fallback arm run 1: discarded as an instrument fault

The bench's 'guard3' arm set the guard and the fallback but not SEQUENCE_TEACH_PRODUCT_MODE, so it
ran without product mode (product shape 2%, code tokens 6.5 per 100 words, no fallback turn fired).
Not comparable with the 'guard' arm. Bench fixed; rerun under the same registered rule.

## 2026-09-24 · Result: new-only fallback (registered above)

54 turns, guard arm vs guard + new-only fallback, paired: quality -0.0 (SE 2.9), product shape -0.09
(SE 0.09), repeat +0.02 (SE 0.04). The new-only text fired on only 2 of 54 turns (the short line on 5):
most repeats are resolved by the hot retries before any fallback is needed.
Verdict: **discarded; the short line stays the fallback.** The blind check runs with product mode +
guard (short-line fallback).

## 2026-09-24 · Result: blind check (registered above), set ae985c74

48 turns per arm (8 sealed conversations x 3 turns x 2 runs), no flags vs product mode + guard, paired:
repeat -0.02 (SE 0.03): **fail**; answers over the repeat bar 9% -> 0% (-0.09, SE 0.05); product shape
0% -> 12.5% (+0.13, SE 0.05): pass; quality -3.0 (SE 2.2): pass; code tokens unchanged (5.1 vs 5.0).
Verdict: **not passed; flags stay off by default.** Cause, found after the run: the product-question
recogniser fired on only 5 of the 24 blind questions ("whats shopfront? is it a real store", "what's
the point of it existing", "who is this for? is it a product or a learning thing" all missed), so on
19 turns neither flag was active. The pattern was fitted to the owner's three questions. This set is
now seen and cannot be the next blind check. Next: a recogniser that stays on for the rest of a
conversation once it has started, with a wider pattern, then a NEW sealed set from a separate worker.

## 2026-09-24 · Registered before the run: blind check 2 (recogniser v2)

Recogniser v2 (ef27dd9a): wider pattern, off for any question naming a file, sticky for the rest of
a product conversation. On the seen set it covers 15 of 24 questions (v1: 5); it flags 1 of the 74
teach-bench questions. New sealed set from a separate worker that has not seen the code, the bench
or set 1 (8 conversations x 3 turns, 4 repos). Arms 'off' vs 'guard' (product mode + guard), 2 runs.
Win (unchanged): repeat lower by more than 2 SE; product shape higher by more than 2 SE; quality
not lower by more than 2 SE. Pass => both flags on by default on the port branch.

## 2026-09-24 · Result: blind check 2 (registered above), set 733b78c1

Recogniser v2 covered 22 of the 24 fresh questions. 48 turns per arm, no flags vs product mode + guard:
| measure | off | both | both - off (SE) | rule |
|---|---|---|---|---|
| repeat of previous answer | 0.19 | 0.12 | -0.07 (0.03) | lower by 2 SE: pass (2.6 SE) |
| product shape | 0% | 27% | +0.27 (0.07) | higher by 2 SE: pass (4.2 SE) |
| lesson quality | 63.9 | 59.6 | -4.3 (1.9) | not lower by 2 SE: **fail (2.3 SE)** |
| file chart drawn | 25% | 8% | -0.17 (0.05) | (reported) |
| unsupported risk claims | 17% | 2% | -0.15 (0.06) | (reported) |
| code tokens per 100 words | 5.2 | 3.9 | -1.4 (0.9) | (reported) |
Quality by part (off -> both): clarity 70 -> 76, chunking 90 -> 94, visual 53 -> 34, grounding 25 -> 14,
teaching 14 -> 12. The drop is the picture and the file citations: product mode turns off the
file-chart floor, and the model's own concept charts do not make up for it.
Verdict: **not passed; flags stay off by default.** Next: in product mode, keep a picture on every
turn: a concept flow drawn from the answer's own numbered steps when the model draws none.

## 2026-09-24 · Registered before the run: blind check 3 (steps chart)

Change (1ecb5daa): in a product turn where the model drew nothing, its own numbered steps (3 to 8)
become a user-flow chart of concepts. New sealed set 3 from a separate worker that has not seen the
code, the bench or sets 1 and 2. Arms 'off' vs 'guard' (product mode + guard + steps chart), 2 runs.
Win (unchanged): repeat lower by more than 2 SE; product shape higher by more than 2 SE; quality not
lower by more than 2 SE. Pass => both flags on by default on the port branch.

## 2026-09-24 · Result: blind check 3 (registered above), set 0a31c032

Recogniser covered 21 of 24. 48 turns per arm, no flags vs product mode + guard + steps chart:
| measure | off | both | both - off (SE) | rule |
|---|---|---|---|---|
| repeat (mean 5-gram similarity to previous answer) | 0.16 | 0.22 | +0.06 (0.03) | lower by 2 SE: **fail** |
| answers at or over the 0.6 repeat bar | 0 | 0 | 0 | (reported) |
| product shape | 0% | 29% | +0.29 (0.07) | higher by 2 SE: pass (4.4 SE) |
| lesson quality | 63.6 | 65.4 | +1.8 (2.6) | not lower by 2 SE: pass |
| concept flow chart drawn | 29% | 75% | +0.46 (0.08) | (reported) |
| file chart drawn | 48% | 0% | -0.48 (0.07) | (reported) |
| median seconds per turn | 10.3 | 13.1 | (mean +27 s, driven by four ML Harness turns of 200-386 s while other lanes shared the card) | (reported) |
Verdict: **not passed as registered; flags stay off by default.** The steps chart fixed the quality
loss (visual restored: flow charts 29% -> 75%). The repeat measure now fails the other way: no answer
in either arm was a resend (0 over the 0.6 bar), and product answers share a template (what, who, why,
steps, advantages), which raises mean overlap between turns without repeating anything. The mean
similarity no longer measures the owner's complaint on sets that have no resends. Recorded for
Jaden to decide; a fourth check would need its repeat measure registered as "share of answers over
0.6" before the run.

## 2026-09-24 · Registered before the run: blind check 4 ("no answer is resent")

Decided by the coordinator for Jaden: the repeat bar is the owner's complaint itself, a resent answer
(5-gram Jaccard with the previous answer >= 0.6). New sealed set 4 from a separate worker, with at
least half the conversations re-asking the same question (where resends happen). Arms 'off' vs
'guard' (product mode + guard + steps chart, branch after 1ecb5daa), 2 runs.
Win (all): the 'guard' arm resends no answer (0 at or over 0.6) and resends fewer than 'off' if 'off'
resends any; product shape higher by more than 2 SE; lesson quality not lower by more than 2 SE.
Pass => both flags on by default on the port branch; REVIEW.md says so. The steps chart stays either way.
Housekeeping: the turnCarry.reach source-shape test counts chart-slot assignments; it is 5 now (the
steps chart, teach-gated), and the counting gate is green again.

## 2026-09-24 · Result: blind check 4 (registered above), set 5652e232 — passed

48 turns per arm, no flags vs product mode + guard + steps chart: answers resent (>= 0.6) off 0, both 0
of 32; product shape 0% -> 46% (+0.46, SE 0.07); quality -2.0 (SE 2.5, inside the bar); concept flow
charts 29% -> 67%; file charts 46% -> 4%; unsupported risk claims 13% -> 4%; median turn 9.8 -> 11.2 s.
Recogniser covered 23 of 24 questions.
Verdict: **passed. Both flags on by default on the port branch** (3d31b453; =0 turns each off).
Turning them on by default broke 4 analyzer tests: a subject lesson with no repository ("what is an
llm, break it down ... how it works") and "teach me how this works" were read as product questions
and lost their drawn charts. Fixed (d7a847fe): product mode needs an attached repository and not a
subject lesson, and "how it works" alone no longer counts; blind-4 coverage is unchanged at 23 of 24.
Gates at d7a847fe: CI 362/362, analyzer 3113/3113, web2 3248/3248, schema 488/488, counting gate green.

## 2026-09-24 · Registered before the run: five-part check for product answers

Hypothesis: SEQUENCE_TEACH_PRODUCT_SECTIONS=1 (a product answer missing any of what / who / why /
numbered steps / advantages gets one hot retry naming them; the draft with more parts ships) raises
the full product answer. Arms 'guard' (today's branch defaults) vs 'sections' (defaults + check), on a
NEW sealed set 5 from a separate worker, 2 runs. The bench's own productShape scorer (not the
pipeline's part detector) is the measure.
Win: full product answer at 65% or more and higher than 'guard' by more than 2 SE, paired; no
answer resent; quality not lower by more than 2 SE.

## 2026-09-24 · Result: five-part check (registered above), set ea781ddc

48 turns per arm, today's defaults vs + five-part check, paired: full product answer 15% -> 23% (+0.08,
SE 0.07); quality -0.9 (SE 2.1); resends 0 -> 2 (at 0.6); words +25; median turn 11.1 -> 13.2 s.
Verdict: **discarded; SEQUENCE_TEACH_PRODUCT_SECTIONS stays off.** Misses the 65% bar and is inside
noise, and it added two resends. Note: the defaults scored 15% full shape on this set against 46% on
set 4; the full-shape rate depends heavily on how questions are phrased, so one set is a weak basis
for a fixed percentage bar.

## 2026-09-24 · Measured: product answers that end on their own question (offline, no model calls)

How often an answer ends on a question it asked the learner (last paragraph ends in "?"):
| run | no flags | product mode + guard |
|---|---|---|
| blind set 3 | 33% | 25% |
| blind set 4 | 29% | 13% |
| blind set 5 | (not run) | 35% |
Product mode already lowers it (it drops Sequence's derived file quiz; the model's own closing
question remains). Tested offline: stripping a short closing question from the product-mode
answers of sets 3, 4 and 5 changes 7, 2 and 15 of 48 answers and lowers the lesson-quality score by
0.8 (SE 0.3), 0.2 (SE 0.2) and 2.4 (SE 0.7), because that scorer rewards a closing check-in.
Verdict: **not changed.** Whether a product answer should end on a question is a taste call the
scorer cannot settle (it is built to reward check-ins); recorded for Jaden. The unanswered
"which part hands off next" in his transcript was Sequence's derived quiz, which product mode
already removes.

## 2026-09-24 · Registered before the runs: sealed bank 6, the no-quiz arm and a re-baseline

Bank 6 (f5eb943d): 16 conversations x 3 turns = 48 product questions over the four repos, written by a
separate worker that saw no earlier set, the bench or the code. Scorer change, decided for Jaden: in
product turns a closing question is neutral (lesson-quality { product: true }); lessons keep the
check-in bonus (6a7df5a8). Arms, 1 run each on bank 6: 'off' (no flags), 'guard' (branch defaults:
product mode + guard + steps chart), 'noquiz' (defaults + drop the model's short closing question).
(a) No-quiz, 'noquiz' vs 'guard': keep if answers ending on a question fall below 5% and quality (product
scoring) is not lower by more than 2 SE, paired.
(b) Re-baseline, 'guard' vs 'off' on 48 questions: report full product answer, resends, quality, charts
(no keep/discard; it replaces the 8-conversation estimates).

## 2026-09-24 · Results on bank 6 (registered above)

(b) Re-baseline, 48 questions, 'off' -> 'guard' (branch defaults), paired:
| measure | off | defaults | diff (SE) |
|---|---|---|---|
| full product answer | 2% | 17% | +0.15 (0.06) |
| ends on a question to the reader | 40% | 19% | -0.21 (0.09) |
| concept flow chart | 40% | 65% | +0.25 (0.10) |
| file chart | 29% | 2% | -0.27 (0.07) |
| code tokens per 100 words | 5.7 | 4.1 | -1.6 (0.8) |
| resends (>= 0.6) | 1 | 0 | |
| quality (product scoring) | 61.9 | 60.9 | -1.0 (2.0) |
| unsupported risk claims | 10% | 15% | +0.04 (0.07) |
The recogniser covered 39 of the 48 questions. On this larger bank the full five-part answer is 17%,
not the 46% of set 4: that set was the easy end.
(a) No-quiz, 'guard' -> 'noquiz': answers ending on a question 18.8% -> 18.8% (+0.00, SE 0.08); full
answer -0.08 (SE 0.04); quality -2.4 (SE 2.2). Of the 9 no-quiz answers still ending on a question, 4
carry Sequence's derived "Looking at the picture" quiz on turns the recogniser missed, 1 is the repeat
guard's short line, and 4 are one-paragraph or long closings the strip leaves alone by design.
Verdict: **no-quiz discarded (does not reach 5%; the misses are recogniser coverage, not the strip).**
The next lever on both numbers is recogniser coverage (39 of 48), not more post-processing.

## 2026-09-24 · Registered before the run: llama-server vs Ollama for the teach turn

Mixed in from the ML harness lane: Ollama strips MiniCPM5's native tool-call tokens (ollama issue
18483), so calls can land in the answer as debris. Same GGUF (the minicpm5-hermes blob), served by
llama-server (Docker's bundled build, Vulkan, --jinja, -c 16384, reasoning deepseek) against Ollama.
Bench tools/bench/teach-eval.mjs on the 13 shopfront lessons; control = the Ollama JSON arm of the DOT
teach run (same bank, same bench). Measures: turns with tool-call debris in the answer (text matching
<function, <tool_call> or name="), chart calls landed, lesson quality, turn time.
Win: debris turns lower by more than 2 SE paired by lesson, quality not lower by more than 2 SE.

## 2026-09-24 · Result: llama-server vs Ollama for the teach turn (registered above)

13 shopfront lessons. Ollama (control): 28 turns, 0 errored, 0 turns with tool-call debris, 3 chart
calls, lesson quality as before. llama-server (Docker's bundled build "1 (ac4cdde)", Vulkan): 21
turns ran, 3 lessons errored, 12 of 21 turns carried tool-call debris in the answer, 0 chart calls.
Paired by lesson (n 10): debris +0.57 (SE 0.09); quality -17.5 (SE 4.0).
Verdict: **discarded; Sequence stays on Ollama.** This llama-server build does not parse MiniCPM5's
tool calls either (it predates or lacks the dedicated parser the ML harness lane needs, b9833+), and
on Ollama the teach turn shows no debris at all on this bench. Worth rerunning only with a llama.cpp
build known to carry the MiniCPM5 parser.

## 2026-09-24 · Product-question detector v3, checked on a sealed labelled held-out set

v3 (e3f96e79) was widened on bank 6's nine misses (now 48 of 48 there, and 1 false hit in the 74
teach-bench questions). Held-out set 7 (c729a43b), written by a separate worker: 30 product questions
and 30 code questions, labelled. v3 catches **15 of 30** product questions and wrongly flags **0 of 30**
code questions. Misses read like "would a small business use something built like this", "is it safe
to use on company code", "how is this different from just using Unsloth", "do i need a gpu".
Verdict: v3 kept (no false hits, strictly more recall than v2), but a hand-written pattern reaches about
half of real product questions; on bank 6 it looked perfect only because it was tuned there. Set 7
stays sealed for the next detector. Next: replace the pattern with a small classifier (the ML harness
lane's learned-router approach, or one short model call), scored on set 7 for recall at zero code
false hits.

## 2026-09-24 — Product-question classifier (kept)

Hypothesis: a small naive Bayes classifier (words + word pairs) behind the v3 patterns raises recall on the sealed held-out set 7 above v3's 15/30 with 0/30 code false hits.
Win bar (set in the plan before the run; written here after it): recall > 15/30 and code false hits = 0/30 on heldout7 (sha256 c729a43b).
Training: 330 rows (train8: 120 product / 120 code, written by a separate worker without seeing heldout7 or the code; bank 6 openers as product; teach-eval questions as code). Threshold picked on 5 training folds at <= 1% code false hits (4.47); heldout7 not used for any choice.

| detector | held-out product | held-out code false hits |
|---|---|---|
| v3 patterns (baseline) | 15/30 | 0/30 |
| classifier alone | 23/30 | 0/30 |
| patterns OR classifier (shipped) | 26/30 | 0/30 |

n = 30 + 30, deterministic (no sampling noise). Kept. SEQUENCE_TEACH_PRODUCT_CLASSIFIER=0 turns it off.
Port branch 64ac2647: tools/bench/train-product-question.mjs regenerates productQuestionModel.ts byte-identical; 2 locking tests (teach-product-mode 12/12); ci, analyzer, web2 gates exit 0; counting gate green on push.
Found in passing, not fixed: the v3 patterns (not the classifier) hit 7 of 194 training code questions, e.g. "Where does the app read environment variables" and "what's the purpose of the .PHONY line". Next item: tighten those patterns against the training code rows.

## 2026-09-24 — Patterns stop catching code questions (registered before the run)

Hypothesis: tightening the v3 patterns that match 7 of 194 training code questions removes those hits without losing product recall.
Win bar: training code hits 7 -> 0; sealed heldout7 stays at 26/30 product and 0/30 code; bank 6 openers still all detected.
Result (discarded): a code-word gate on the patterns only (where-questions, snake_case names, .PHONY-style names, words like config, library, codebase, method, queries, entry point, hook).

| detector (patterns OR classifier) | train code hits | train product | heldout7 product | heldout7 code | bank 6 openers |
|---|---|---|---|---|---|
| baseline (64ac2647) | 7/194 | 136/136 | 26/30 | 0/30 | 16/16 |
| code-word gate | 0/194 | 136/136 | 25/30 | 0/30 | 16/16 |

Deterministic, n = 194 / 30 / 30. The code hits went to 0, but held-out product recall fell 26 -> 25, which misses the bar. Reverted (never committed to the port branch).
The gate also cost two training product questions: one said "this data-viz library", the other "this codebase". Do not retry a word gate that includes "library" or "codebase". heldout7 has now been read three times, so the next detector change needs a fresh sealed set.

## 2026-09-24 · Registered before the run: product-question classifier, real answers

Set: fresh sealed set 9 (30 product / 30 code), written by a separate worker that read no earlier set or code.
Step 1 (offline): detector recall and false hits on set 9, patterns alone vs patterns OR classifier. The bar is carried over from heldout7: higher recall with 0 code false hits.
Step 2 (GPU): the set 9 product questions that the patterns miss and the classifier catches, one-question convos, repos round-robin (ml-harness, shopfront, makemore, sequence), 2 runs. Arm 'guard' (branch defaults) vs 'guard' with SEQUENCE_TEACH_PRODUCT_CLASSIFIER=0, paired.
Win: full product answer (bench productShape) up by more than 2 SE, file charts not higher, quality not lower by more than 2 SE, 0 resends.

## 2026-09-24 · Result step 1: detector on fresh sealed set 9 (sha256 42f9c958)

| detector | set 9 product | set 9 code false hits |
|---|---|---|
| patterns alone | 16/30 | 6/30 |
| patterns OR classifier (64ac2647) | 28/30 | 6/30 |

Deterministic. The classifier adds 12 product questions and 0 code hits: step 1 passes on the classifier's share. New finding: the patterns hit 6 of 30 fresh code questions, against 0 of 30 on heldout7. The set 9 hard cases ("How does the app decide...", "why does this project exist as a separate package") land on the pattern side. That is the next hypothesis, and it needs a set that has not been read.
Step 2 (the GPU A/B on the 12 added questions) is queued behind the card lock.

## 2026-09-24 · Registered before the run: a code-word veto on the patterns (second try)

Hypothesis: a veto on the patterns only (not on the classifier) cuts code false hits without losing product recall. The veto words are "in the code", folder, module, package, build setup, service, layer, handled/handler, frontend/backend, query, debounce, config, function, method, endpoint, fixture, hook, middleware, schema, migration, regex, env variables, entry point, Makefile/Dockerfile, pre-commit, where-questions, snake_case and .PHONY-style names. It was designed from the 7 training code hits and the 6 set 9 code hits. "library" and "codebase" are left out, per the discard above.
Offline design check: training code hits 7 -> 1 of 194, training product 136 -> 136, bank 6 questions 30 -> 30 of 48.
Judged on fresh sealed set 10 (40 product / 40 code, with at least 20 hard code cases), written by a separate worker. Win: set 10 code false hits lower than the baseline, and product recall not lower (deterministic, patterns OR classifier).

## 2026-09-24 · Result: code-word veto on the patterns (registered above), sealed set 10 (5636662d)

| patterns OR classifier | set 10 product | set 10 code false hits |
|---|---|---|
| baseline (64ac2647) | 35/40 | 16/40 |
| + veto (934dcfd6) | 35/40 | 11/40 |

Deterministic. **Kept.** It meets the bar: fewer code hits and the same recall.
Already-read sets, not used as the judge: set 9 code hits 6 -> 1 of 30 with product 28/30 unchanged; heldout7 product 26 -> 25 of 30 with code 0/30.
Still open: set 10 is hard and 11 of 40 code questions still pass. The classifier alone passes 4 of them, and the rest are pattern hits the veto words do not cover. Next: add the hard code phrasings to the training rows, retrain the classifier, then retire patterns the classifier covers, judged on a new sealed set.
Gates: teach-product-mode 13/13; ci, analyzer, web2 exit 0; counting gate green on push.

## 2026-09-24 · Registered before the run: retrain the classifier with hard phrasings

Hypothesis: adding 120 hard training rows (train12: 70 code questions in product words, 50 product questions with technical words, from a separate worker) and retraining lowers code false hits without losing product recall.
Judge: fresh sealed set 11 (40/40, about half hard cases), from a second worker that saw neither set.
Arms: detector at 934dcfd6 vs the same detector with the retrained model.
Win: set 11 code false hits lower, and product recall not lower (deterministic).

## 2026-09-24 · Result: classifier retrain with hard phrasings (registered above), sealed set 11 (5924bce8)

| patterns (with veto) OR classifier | set 11 product | set 11 code false hits |
|---|---|---|
| baseline (934dcfd6, 330 rows) | 33/40 | 10/40 |
| + train12 (450 rows, threshold 4.07) | 36/40 | 10/40 |

Deterministic. **Discarded.** The bar was fewer code false hits, and it did not move (10 -> 10). Recall went up by 3, but that was not the registered measure. Reverted; the port branch was not changed.
Finding (exploratory, on set 11 after it was read): all 10 code false hits come from the patterns. The retrained classifier on its own scores 35/40 product and 0/40 code; the patterns on their own score 17/40 and 10/40.
Next registered hypothesis: the retrained classifier alone, with the patterns retired, judged on a fresh sealed set 12.

## 2026-09-24 · Registered before the run: the classifier alone, patterns retired

Arms: A = today's detector (934dcfd6: patterns with veto OR the 330-row classifier). B = the 450-row classifier alone (NAMES_CODE still excludes named files; the patterns are no longer used).
Judge: fresh sealed set 12 (40/40, about half hard cases), from a new worker.
Win: B has fewer code false hits than A, and B's product recall is no more than 2 of 40 lower.

## 2026-09-24 · Result: classifier alone, patterns retired (registered above), sealed set 12 (641c1d02)

| detector | set 12 product | set 12 code false hits |
|---|---|---|
| A: today (934dcfd6) | 30/40 | 5/40 |
| B: 450-row classifier alone | 27/40 | 0/40 |

Deterministic. **Discarded.** Code hits dropped 5 -> 0, but recall fell by 3 when the bar allowed at most 2. Reverted; the port branch is unchanged at 934dcfd6.
Where the detector stands across four sealed sets (today's detector): set 9 28/30 with 1/30 code, set 10 35/40 with 11/40, set 11 33/40 with 10/40, set 12 30/40 with 5/40. The patterns hold the recall and the classifier holds the precision; neither covers both. Detector work pauses here: set 13 is not worth writing until there is a new idea (for example a small trained model instead of bag-of-words).

## 2026-09-24 · Result step 2: classifier on real answers (registered above), set 9's 12 added questions

24 paired turns (12 one-question convos x 2 runs), arm 'guard', classifier on vs SEQUENCE_TEACH_PRODUCT_CLASSIFIER=0, minicpm5-hermes, card lock held for the run.
| measure | classifier off | classifier on | delta (SE) |
|---|---|---|---|
| full product answer | 0% | 21% | +0.21 (0.08) |
| concept flow chart | 13% | 63% | +0.50 (0.13) |
| file chart | 33% | 0% | -0.33 (0.10) |
| lesson quality | 59.3 | 62.4 | +3.1 (2.5) |
| code refs per 100 words | 5.1 | 2.1 | -3.0 (0.9) |
| resends | 0 | 0 | |
| mean turn time | 7.7 s | 11.9 s | +4.3 s (1.4) |
**Kept** (the classifier was already on the port branch). Every registered bar is met: shape up more than 2 SE, file charts down, quality not lower, 0 resends. Cost: product-mode turns run about 4 s slower, from the README read and the longer instructions.

## 2026-09-24 · Registered before the run: README inline for product turns

Hypothesis: SEQUENCE_TEACH_PRODUCT_README_INLINE=1 puts the first 2500 characters of the README into the product-turn instructions and drops the "read README.md first" step. That saves a read_file round, so turns get faster without the answers getting worse.
Set: the set 12 product questions today's detector catches, as one-question convos alternating between ml-harness and sequence (the two bench repos that have a README; shopfront and makemore have none, so the flag does nothing there). 1 run. Arms: 'guard' vs 'guard' + flag, paired.
Win: mean turn time lower by more than 2 SE; full product answer and lesson quality not lower by more than 2 SE; 0 resends.

## 2026-09-24 · GPU lock collision at 18:42Z, and the fix (kept)

What happened: ML harness took the card at 18:42:12Z naming pid 24712, which exited 23 s later while their judge run went on. At 18:42:35Z the Sequence README-inline A/B found that pid gone, reaped the lock as stale, and took the card. Both lanes then ran on it.
Fix (port branch bd4501b2, tools/ci/gpu-lock.mjs): when the holder's pid is gone and the lock belongs to ANOTHER lane, it is reaped only if it is older than SEQUENCE_GPU_REAP_GRACE_S (default 600 s) AND nvidia-smi reads the card under 30% busy over three samples. If utilisation can't be read, nothing is reaped.
Test: planted cases (30 s old and idle -> refused; 1 h old and 95% busy -> refused; 1 h old and idle -> reaped). The test fails on the old code (exit 1) and passes with the fix; gpu-lock-log 12/12; ci, analyzer, web2 gates exit 0.
For other lanes: take the card with `run`, or `take --pid none` for a multi-command hold. A pid that exits early reads as a dead hold.
README-inline A/B (registered above): **run invalid.** It shared the card, and turn time is the measure. Its numbers are discarded; it reruns alone.

## 2026-09-24 · Result: README inline (registered above), rerun alone

The card was held by Sequence alone from 19:05:31Z to 19:19:32Z (gpu.lock.log: ML harness released at 18:56:19Z and auto search at 19:04:07Z). 30 paired one-question turns from set 12, ml-harness and sequence repos, arm 'guard' vs 'guard' + SEQUENCE_TEACH_PRODUCT_README_INLINE=1.
| measure | base | README inline | delta (SE) |
|---|---|---|---|
| mean turn time | 15.9 s | 12.1 s | -3.8 s (1.9) |
| full product answer | 23% | 30% | +0.07 (0.08) |
| lesson quality | 62.1 | 62.8 | +0.8 (2.2) |
| concept flow chart | 50% | 57% | +0.07 (0.11) |
| file chart | 0% | 0% | 0 |
| read_file calls (total) | 39 | 17 | |
| resends / errors | 0 / 0 | 0 / 0 | |
**Kept, barely**: the time drop is 2.02 SE, just past the 2 SE bar, and nothing else got worse. The flag is now on by default (=0 turns it off): port branch 2f9d4023, locking test 1fb1f8e1, teach-product-mode 15/15, ci, analyzer and web2 gates exit 0, counting gate green on push.

## 2026-09-24 · Registered before the run: DOT drawing in product turns

Hypothesis: SEQUENCE_CHART_LANG=dot (DOT beat JSON for grounded drawing on the chart bench, but it showed no effect in lesson turns because the model rarely drew) raises the user-flow chart rate in product turns, where the instructions always ask for one chart.
Set: the same 30 set 12 product convos (ml-harness and sequence), 1 run, arm 'guard' (today's defaults, README inline on) vs 'guard' + DOT, paired.
Win: concept flow chart rate up by more than 2 SE; full product answer, quality and turn time not worse by more than 2 SE; 0 resends.

## 2026-09-24 · Result: DOT drawing in product turns (registered above)

Clean solo hold, 19:27:04Z-19:39:35Z. 30 paired turns.
| measure | JSON (default) | DOT | delta (SE) |
|---|---|---|---|
| concept flow chart | 60% | 43% | -0.17 (0.10) |
| model-drawn charts per turn | 0.17 | 0.20 | +0.03 (0.11) |
| full product answer | 20% | 27% | +0.07 (0.05) |
| lesson quality | 63.0 | 60.3 | -2.7 (2.0) |
| mean turn time | 12.9 s | 11.9 s | -1.0 s (2.0) |
**Discarded.** Flow charts went down, not up; SEQUENCE_CHART_LANG stays json. Most product flow charts come from the numbered-steps fallback, not from the model drawing. The model drew in only about 1 turn in 5 with either language, so the drawing language is not the lever in product turns. Do not retry DOT for product turns.

## 2026-09-24 · Registered before the run: a five-heading skeleton for product answers

Why: offline, 90 of today's product answers (set 12, median 121 words) are missing: who it is for 75, numbered steps 66, why 63, advantages 58, what it is 51. The retry that named the missing parts was discarded (15% -> 23%, inside noise).
Hypothesis: SEQUENCE_TEACH_PRODUCT_TEMPLATE=1 gives the model a literal skeleton to fill (What it is / Who it is for / Why it exists / How it works 1-5 / Advantages) and raises the full product answer rate.
Set: the 33 set 11 product questions today's detector catches. No answers have been generated for them yet. One-question convos alternating ml-harness and sequence, 1 run, arm 'guard' (defaults) vs 'guard' + template, paired. Commit f25aaf9c.
Win: full product answer up by more than 2 SE; quality and turn time not worse by more than 2 SE; 0 resends.

## 2026-09-24 · Result: five-heading skeleton (registered above), set 11

Clean solo hold, ending 20:46:04Z. 33 paired turns, 0 errors, 0 resends.
| measure | defaults | + skeleton | delta (SE) |
|---|---|---|---|
| full product answer | 33% | 48% | +0.15 (0.08) |
| lesson quality | 59.0 | 62.5 | +3.5 (2.2) |
| mean turn time | 15.4 s | 15.8 s | +0.4 s (2.0) |
| concept flow chart | 52% | 61% | +0.09 (0.07) |
| words | 189 | 164 | -26 (40) |
**Discarded (inside noise).** The shape gain is 1.9 SE, short of the 2 SE bar; SEQUENCE_TEACH_PRODUCT_TEMPLATE stays off (f25aaf9c keeps the flag, off). Every measure moved the right way, so this is the closest miss today. Retrying it needs a fresh, larger set (for example 2 runs x 40 fresh questions), registered before it is read. Do not re-score set 11.
The pipeline's own part check still reports "who it is for" missing in 31 of 33 skeleton answers, so the model does not keep the headings verbatim.

## 2026-09-24 · Registered before the run: five-heading skeleton, retry at larger n

Same hypothesis and bars as the set 11 run (full product answer up by more than 2 SE; quality and turn time not worse by more than 2 SE; 0 resends). This time: fresh set 13 (40 generic product questions from a separate worker), 2 runs, one-question convos alternating ml-harness and sequence, n = 80 pairs. The set 11 result is not pooled in. This is the last try at the skeleton: if it misses again, the skeleton is dropped for good.

## 2026-09-24 · Result: five-heading skeleton retry (registered above), set 13 (4f44d897)

The detector catches 36 of 40, so 36 convos x 2 runs = 72 pairs. Clean solo hold 20:50:35Z-21:22:42Z; 0 errors, 0 resends.
| measure | defaults | + skeleton | delta (SE) |
|---|---|---|---|
| full product answer | 31% | 39% | +0.083 (0.038), 2.18 SE; 7 pairs won, 1 lost |
| lesson quality | 61.3 | 59.5 | -1.8 (1.5) |
| mean turn time | 12.7 s | 14.0 s | +1.4 s (1.2) |
| concept flow chart | 49% | 54% | +0.06 (0.07) |
| words | 133 | 163 | +30 (14) |
**Kept; on by default** (port f5b08f50; SEQUENCE_TEACH_PRODUCT_TEMPLATE=0 turns it off). It meets every registered bar. Caveats: this was the second try after a 1.9 SE miss, so the chance of a false win is higher than for a single test. Quality and time both lean slightly the wrong way (inside noise). If a later sealed set shows quality down by more than 2 SE, the flag goes off.
Gates: teach-product-mode 16/16; ci, analyzer, web2 exit 0; counting gate green on push.

## 2026-09-24 · Registered before the run: confirming the skeleton on a fresh set

Why: the skeleton was kept on its second try (2.18 SE), and quality leaned down (-1.8, SE 1.5). This run checks it independently.
Set: fresh set 14 (40 generic product questions, separate worker), the ones the detector catches, 2 runs, alternating ml-harness and sequence. Arms: today's defaults (skeleton on) vs SEQUENCE_TEACH_PRODUCT_TEMPLATE=0, paired.
Rule: the skeleton stays on only if the full product answer delta (on minus off) is positive and quality is not lower by more than 2 SE. Otherwise it goes off by default.

## 2026-09-25 · Result: skeleton confirmation (registered above), set 14 (3f06ebf4)

First attempt: only the "on" arm finished before the session dropped (the off arm exited 127). That half is kept aside as product-h14-on.partial-run1.json and not used. Rerun of both arms together, clean solo hold 01:40:15Z-02:20:11Z, 39 convos x 2 runs = 78 pairs, 0 errors, 0 resends.
| measure | skeleton off | skeleton on | delta (SE) |
|---|---|---|---|
| full product answer | 33% | 51% | +0.18 (0.05), 3.5 SE |
| lesson quality | 63.4 | 63.4 | 0.0 (1.2) |
| mean turn time | 13.8 s | 16.8 s | +3.0 s (1.2) |
| concept flow chart | 63% | 62% | -0.01 (0.06) |
| words | 167 | 161 | -6 (10) |
**Confirmed; the skeleton stays on.** It meets the registered rule: shape up, quality not lower. It costs time: product turns are 3.0 s slower, which is outside noise (2.6 SE) on this set. That gives back most of the README-inline saving. Next candidate: make the skeleton turn faster (shorter skeleton, or no numbered-steps chart request when the fallback draws it anyway).

## 2026-09-25 · Registered before the run: no chart request in product turns

Hypothesis: SEQUENCE_TEACH_PRODUCT_NO_CHART_ASK=1 drops the "draw the 5 steps with ONE propose_chart" line; the numbered-steps fallback draws the flow instead. That removes a tool round and wins back the time the skeleton costs.
Set: fresh set 15 (40 generic product questions, sha256 f33f4fa2, separate worker), the ones the detector catches, 2 runs, alternating ml-harness and sequence. Arms: defaults (skeleton on) vs defaults + flag, paired. Commit f75bf9c2.
Win: mean turn time lower by more than 2 SE; full product answer, quality and concept flow chart not lower by more than 2 SE; 0 resends.

## 2026-09-25 · Result: no chart request in product turns (registered above), set 15

Clean solo hold 02:29:50Z-03:06:43Z. The detector catches 38 of 40, so 38 x 2 = 76 pairs, 0 errors, 0 resends.
| measure | defaults | no chart request | delta (SE) |
|---|---|---|---|
| mean turn time | 16.9 s | 11.9 s | -5.0 s (1.2), 4.2 SE |
| full product answer | 39% | 37% | -0.03 (0.02) |
| lesson quality | 61.5 | 61.6 | +0.1 (1.2) |
| concept flow chart | 57% | 62% | +0.05 (0.05) |
| model chart calls per turn | 0.36 | 0.01 | -0.34 (0.08) |
**Kept; on by default** (port 5d004970; SEQUENCE_TEACH_PRODUCT_NO_CHART_ASK=0 asks for the chart again). It wins back more than the 3.0 s the skeleton cost. Flow charts are not fewer, because the numbered-steps fallback draws them.
Gates: teach-product-mode 17/17. The analyzer suite failed twice on "terminal WS accepts resize control" (plus once on "archgraph stale marker"). The terminal tests pass 11/11 three times when run alone, and the third full gate run was green (ci, analyzer, web2 exit 0), so this is a timing flake under full-suite load, not from this change. Counting gate green on push.

## 2026-09-25 · Registered before the run: lean product turn (no structure digest)

Why (offline, set 15 answers under today's defaults): 50 of 76 product answers ignored the skeleton headings, and 40 of those 50 talked about "the scan" or the digest ("the scan did not read every file...") instead of the product.
Hypothesis: SEQUENCE_TEACH_PRODUCT_LEAN_DIGEST=1 drops the structure digest from product turns when a README is in hand (README inline stays). The answer then comes from the README and full product answers rise.
Set: fresh set 16 (40 generic product questions, separate worker), the ones the detector catches, 2 runs, alternating ml-harness and sequence. Arms: today's defaults vs + lean flag, paired. Port commit 28712156.
Win: full product answer up by more than 2 SE; quality not lower by more than 2 SE; mean turn time not higher by more than 2 SE (target 12 s or under); 0 resends. Also reported: the share of answers that mention the scan or digest.
The coordinator's target is 51% -> 60% on release bank v1. The bank is report-only, so the keep is decided on set 16; the bank numbers are reported after a keep.

## 2026-09-25 · Result: lean product turn (registered above), set 16 (cd30556d)

Clean solo hold 04:21:00Z-04:46:01Z. The detector catches 34 of 40, so 34 x 2 = 68 pairs, 0 errors, 0 resends.
| measure | defaults | lean (no digest) | delta (SE) |
|---|---|---|---|
| full product answer | 46% | 47% | +0.015 (0.015) |
| lesson quality | 61.3 | 61.8 | +0.5 (1.3) |
| mean turn time | 11.1 s | 10.5 s | -0.7 s (0.6) |
| concept flow chart | 69% | 68% | -0.02 (0.06) |
| answers mentioning scan/digest | 47% | 54% | +0.07 (0.07) |
**Discarded (no effect)**; SEQUENCE_TEACH_PRODUCT_LEAN_DIGEST stays off (28712156 keeps the flag, off). Talk of the scan did not go down without the digest, so it comes from the rest of the teach prompt (the teach contract and coverage wording), not from the digest itself. Not checked: I did not dump the prompt to confirm the digest was actually absent in the lean arm; the only test covers the decision function. If the scan talk is chased again, dump one lean prompt first.
Today's defaults on this fresh set: 46% full product answers at 11.1 s, under the 12 s target.

## 2026-09-25 · Found: half of product questions never reached product mode (offline)

While checking why answers talk about "the scan", I dumped a product-turn prompt with a canned model. The PRODUCT QUESTION section was missing. The cause is teachProductTurn bailing on teachContext.subjectNotInRepo. The lesson-subject check reads "so what does this thing actually do?" as a subject that is not in the repo. Share of detected product questions reaching product mode: set 14 21/39, set 15 15/38, set 16 16/34. Every product A/B so far only acted on about 45% of its turns; the paired comparisons stay valid, but the effects were diluted.
Fix (port 787871ef): a product question that points at the repo ("this", "the app", "the tool", ...) stays in product mode whatever the subject check says. A question naming its own subject ("what is an llm, break it down") still bails. With the fix, coverage is set 15 37/38 and set 16 32/34 (tools/measure/product-mode-coverage.mjs). SEQUENCE_TEACH_PRODUCT_POINTS_AT_REPO=0 turns it off. Locking test (teach-product-mode 19/19); gates: first run had the terminal and web2 anatomy timing flakes, second run all exit 0; counting gate green on push.
The lean-digest discard above stands, but it was tested on only half of product turns.

## 2026-09-25 · Registered before the run: product mode for repo-pointing questions

Hypothesis: the fix above raises full product answers on a fresh set, because most questions now get the skeleton and README.
Set: fresh set 17 (40 generic product questions, separate worker), the ones the detector catches, 2 runs, alternating ml-harness and sequence. Arms: defaults (fix on) vs SEQUENCE_TEACH_PRODUCT_POINTS_AT_REPO=0.
Win: full product answer up by more than 2 SE; quality not lower by more than 2 SE; mean turn time not higher by more than 2 SE; 0 resends.

## 2026-09-25 · Result: product mode for repo-pointing questions (registered above), set 17 (d82e0dd8)

Clean solo hold 05:19:56Z-05:43:51Z. The detector catches 35 of 40; product mode reaches 22/35 with the fix and 15/35 without. 70 pairs, 0 errors, 0 resends.
| measure | fix off | fix on | delta (SE) |
|---|---|---|---|
| full product answer | 43% | 61% | +0.19 (0.05), 4.0 SE |
| lesson quality | 59.5 | 61.8 | +2.3 (1.3) |
| mean turn time | 10.6 s | 9.7 s | -0.9 s (0.6) |
| concept flow chart | 53% | 69% | +0.16 (0.05) |
| answers talking about scan/digest | 57% | 36% | -0.21 (0.07) |
| code refs per 100 words | 1.6 | 0.9 | -0.7 (0.3) |
**Kept** (on by default since 787871ef). This is the biggest single gain in the product lane so far, and it passes the coordinator's 60% target on a fresh set. The remaining gap is coverage: 13 of 35 detected questions still miss product mode, because they don't say "this"/"the tool" (e.g. "who uses it").

## 2026-09-25 · Registered before the run: a bare "it" points at the repo

Why (design read on set 17, which is now spent): with the "this"/"the tool" fix, 13 of 35 detected questions still missed product mode. All of them used a bare "it" ("who uses it?", "is it any good?") or "user journey". With the rule, 0 of 35 miss.
Change (port 3c417a1a, off by default): SEQUENCE_TEACH_PRODUCT_BARE_IT=1 lets a bare "it" or "user journey" point at the repo, unless the question names its own subject first ("what is an llm, break it down", "teach me recursion, why does it matter"). Test: teach-product-mode 20/20. Gates: all green at 30ade369 (rule on). At 3c417a1a (only the default flipped off), the terminal WS resize test and one web2 canvas-focus test failed in separate runs; both are timing flakes under GPU/CPU load from another lane and outside the code touched. Counting gate green on push.
Set: fresh set 18 (40 generic product questions, separate worker), the ones the detector catches, 2 runs. Arms: defaults vs + BARE_IT=1.
Win: full product answer up by more than 2 SE; quality not lower by more than 2 SE; mean turn time not higher by more than 2 SE; 0 resends.

## 2026-09-25 · Incident: two Sequence runs on the card at once (06:39Z-07:02Z), and the fix

I queued two runners of this lane (the release bank report and the bare-it A/B), each waiting for an idle card. At 06:39:52Z and 06:39:53Z both saw no lock and both wrote one. The second overwrote the first. When the bank run released at 06:59:47Z, its release deleted the lock while the A/B still ran, and ML harness took the card at 07:00:14Z on top of it until I stopped the A/B at about 07:02Z. So ML harness's run from 07:00:14Z shared the card with Sequence for about 2 minutes.
Also: an earlier bank runner I had stopped with TaskStop kept its node child alive and ran 05:57:21Z-06:10:09Z. Stopping a runner now also ends its node processes by command line.
Fix (port d8b942b2, tools/ci/gpu-lock.mjs): the lock is created with flag wx, so exactly one simultaneous writer wins and the rest exit 3. Test "two runs started together: exactly one takes the card" (3 rounds x 3 racers) fails on the old code (exit 1) and passes with the fix; gpu-lock-log 13/13; ci exit 0. The analyzer terminal WS and web2 canvasPaneFocus timing flakes recurred under load; they are outside tools/ci. Counting gate green on push.
Discarded: the bank report from 06:39Z (overlapped) and the partial bare-it A/B. Both rerun from one serial runner: the A/B first, then the bank.

## 2026-09-25 · Result: bare "it" points at the repo (registered above), set 18 (7d2e2a32)

Clean solo hold 09:04:42Z-09:26:08Z; no other lane took the card during this run or the bank run after it. The detector catches 32 of 40; 64 pairs, 0 errors, 0 resends.
| measure | defaults | + bare "it" | delta (SE) |
|---|---|---|---|
| full product answer | 47% | 80% | +0.33 (0.06), 5.2 SE |
| lesson quality | 61.1 | 64.6 | +3.5 (1.2) |
| mean turn time | 9.7 s | 10.3 s | +0.6 s (0.6) |
| concept flow chart | 58% | 81% | +0.23 (0.06) |
| answers talking about scan/digest | 52% | 33% | -0.19 (0.09) |
**Kept; on by default** (port 9f810373; SEQUENCE_TEACH_PRODUCT_BARE_IT=0 turns it off). teach-product-mode 20/20. Gates: ci exit 0. The analyzer terminal WS resize test and the web2 canvasPaneFocus test failed again; they fail the same way on unrelated commits whenever another lane loads the machine, and neither touches product mode. The flake is filed as a separate task. Counting gate green on push.

## 2026-09-25 · Release bank v1 report (report only), defaults at 787871ef

Clean solo hold 09:26:51Z-09:39:01Z. 36 convos x 2 = 72 turns, 0 errors, 0 resends. It ran with the bare-it rule off (its default at 3c417a1a), so these are the 787871ef defaults.
| measure | v1 sealing numbers (f5b08f50) | 787871ef |
|---|---|---|
| full product answer | 39% | 83% |
| lesson quality | 59.5 | 64.1 |
| mean turn time | 14.0 s | 10.1 s |
| concept flow chart | 54% | 86% |
The bank's generic questions mostly say "this" or "it", so the repo-pointing fix accounts for most of the jump. The next bank report is due at 9f810373.

## 2026-09-25 · Release bank v1 report (report only), defaults at 9f810373 (bare "it" on)

Clean solo hold 15:53:22Z-~16:06Z. 36 convos x 2 = 72 turns, 0 errors, 0 resends of the runner. Bench at facbbcf7 (9f810373 plus per-turn call and token counts; the pipeline is byte for byte 9f810373). File: gpu/ab/release-bank/release-bank-v1-9f810373.json.
| measure | 787871ef | 9f810373 | delta (SE), paired n = 72 |
|---|---|---|---|
| full product answer | 83% | 86% | +0.03 (0.04) |
| lesson quality | 64.1 | 65.2 | +1.1 (1.0) |
| mean turn time | 10.1 s | 9.8 s | -0.3 s (0.5) |
| concept flow chart | 86% | 88% | +0.01 (0.05) |
The bank number is now current: 86% full answers at 9.8 s. The bare-it rule adds little here because the bank's questions mostly already said "this" or "it" in a form the 787871ef rule caught; its set 18 gain stands.
New from the call counts: half the turns make more than one model call. 36 turns made 1 call (8.4 s, 100% full answers); 29 made 2 (11.1 s, 86%); 7 made 3 to 6 (10.4 to 15.3 s, 0 to 20%). No turn read a file or drew a chart itself, so the extra calls are the harness sending the answer back. That is the next turn-time target.

## 2026-09-25 · Discarded offline: no shape-only bounce in product turns

Hypothesis: product answers are sent back for a missing closing question, which costs a second generation; settle them as written instead (flag SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE, 21/21 tests). Checked with a canned model that returns a real bank answer: every product turn made 1 call with and without the flag, so the flag changes nothing on that input. Reverted before any GPU run. The bank's call counts above show real bounces do happen, for reasons the canned answer does not trigger; a diagnosis run on spent set 18 records the resend reasons (bench b99b2712) before any new fix.

## 2026-09-25 · Fast verification kit, step 1 (report only): fastgate verdicts on the release bank

fastgate.py saved verbatim (sha256 5ff1e4cc...426a9, stdlib only); .fastgate/ ignored. tools/bank-to-fastgate.mjs writes the score files: item = convo/run (72), family = question (36). Base = bank at 787871ef (bare-it rule off), candidate = bank at 9f810373 (rule on). Files in gpu/ab/release-bank/fastgate/.
| measure | 787871ef | 9f810373 | fastgate ab --group-by family |
|---|---|---|---|
| full answer (score 1/0) | 83% | 86% | delta +0.028, 90% CI [-0.042, +0.097], 4 wins / 3 losses of 36, UNSURE |
| turn time (score -s) | 10.1 s | 9.8 s | delta +0.27 s faster, 90% CI [-0.36, +0.91], 23 / 13, UNSURE |
Same reading as the paired SE (+0.03 SE 0.04; -0.3 s SE 0.5): no measurable change on the bank. Reporting only; nothing changes.

## 2026-09-25 · Fast verification kit, step 2 (built, keep pending): cached baseline arm

Bench 207090dc: --baseline-cache DIR reuses a stored row when sha256 of (first prompt sent, tool definitions, model tag and Ollama digest 02b47b62, provider params, run index, bench file) matches. The first prompt comes from a dry pass whose provider stops before any model call, so the check costs no GPU. Limit: code that acts only after the first answer (grader, resends) is outside the key; flag-off arms keep those paths unchanged by rule, anything else needs the cache deleted. Single-question convos only.
Checks: keys identical across two processes (72/72). Negative control: with the bare-it rule off, 2 of 72 keys change (the two bank questions whose prompt the rule changes); 70 still match. Positive control: a read pass reused 72/72 rows, byte-identical to release-bank-v1-9f810373.json apart from the arm tag, in 13 s wall with no model call. The cache for the 9f810373 bank is seeded from that run's own rows (gpu/ab/release-bank/baseline-cache/).
GPU cost per bank A/B: before, 2 arms x ~12.5 min = ~25 min; with the cache, the candidate arm only, ~12.5 min. Keep decision: the next bank A/B must run only its candidate arm with the hash check passing.

## 2026-09-25 · Found (spent set 18, 1 run, bench b99b2712): why turns make extra calls

32 turns, mean 9.4 s. 15 made 1 call. Of the 17 that made more: 8 were product answers sent back only for a missing closing question (2 calls each, 7.2 to 22.1 s); 3 were bounced for the closing question plus "no visual"; 6 were turns outside product mode that made 3 to 6 calls (tool rounds and side calls, no harness line). The earlier offline discard of the no-shape-bounce flag was wrong about its input: the canned answer was a post-bounce final, which settles without a call. The flag is rebuilt and goes to a real A/B below.

## 2026-09-25 · Incident: 18 turns ran on the card without the lock (about 17:23Z-17:28:08Z)

A cache read pass (the baseline arm of the A/B below, meant to cost no GPU) found only 19 of 36 keys and sent each miss to the model. It held no lock, and auto search held the card for H-MUON-GPU (since 17:21:49Z). I stopped it at 17:28Z and told the coordinator that auto search's numbers in that window are contaminated. Its 18 rows were deleted, not used.
Cause: the Sequence half of the bank scans the port checkout itself, so any source edit (here the flag commit 2f90d546) changes those prompts and misses the cache. The ml-harness half hit.
Fix (bench fcb3d875): --cache-only never calls the model on a miss (lists misses, exit 4); --sequence pins the scanned Sequence repo. The bank now scans a fixed export of 9f810373 (C:/Users/<user>/Projects/seq-bank-snapshot-9f810373, git archive), so later code edits no longer change the bank's input. Keys from that snapshot are identical across two processes (72/72).
The 9f810373-seeded cache is dropped: its keys hash the bench file, which changed, and half its prompts came from an unpinned scan. Its step-2 checks above stand as checks of the mechanism.

## 2026-09-25 · Registered before the run: product answers are not sent back for their shape

Change (port 2f90d546, off by default): SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE=1 settles a product draft whose only faults are its length or its closing question, instead of a second generation. teach-product-mode 21/21.
Set: sealed release bank v1 (36 convos x 2 runs = 72 turns), Sequence half scanned from the 9f810373 snapshot. Arms: defaults vs + flag, same code (bench fcb3d875), serial under the lock. The baseline arm runs live once and stores the cache (gpu/ab/release-bank/baseline-cache-snap); the candidate never reads it, because the key does not see a flag that acts after the first answer.
Win: mean turn time lower by more than 2 SE (paired) and fastgate ab on -seconds ACCEPT; full product answer, quality and concept flow chart not lower by more than 2 SE; 0 runner errors. Target: under 9 s.

## 2026-09-25 · Result: no-shape-bounce v1 (registered above), sealed bank

Serial solo holds 17:33:34Z-17:44Z (baseline) and 17:44:43Z-~17:56Z (candidate); 72 pairs, 0 errors. Files: gpu/ab/release-bank/noshape/.
| measure | defaults | + flag v1 | delta (SE) | fastgate ab (family) |
|---|---|---|---|---|
| mean turn time | 9.20 s | 9.23 s | +0.03 s (0.47) | UNSURE, CI [-0.90, +0.85] s |
| full product answer | 89% | 88% | -0.01 (0.03) | UNSURE, CI [-0.07, +0.04] |
| lesson quality | 65.6 | 63.8 | -1.8 (1.0) | |
| concept flow chart | 94% | 90% | -0.04 (0.04) | |
| model calls per turn | 1.72 | 1.61 | -0.11 (0.08) | |
**Discarded (no effect).** Why: the flag almost never fired. Closing-question resends went from 42 to 33. The settle branch also required isLessonDraft, which wants the reader addressed ("you") or a closing "?", and product answers are written about the product. Fixed in v2 below; v1 is not retried.
Baseline at the pinned snapshot: 89% full answers at 9.2 s (the unpinned 9f810373 run read 86% at 9.8 s).
Kit step 2, baseline cache: after the run, a --cache-only read pass reused 72/72 rows, byte-identical to the live baseline, in 9 s wall with no model call.

## 2026-09-25 · Registered before the run: no-shape-bounce v2

Change (port afb9b7a0, flag still off by default): the settle drops the isLessonDraft condition and needs only a product turn, shape-only faults, no planning text and at least 35 words. teach-product-mode 21/21; the new test case fails on v1.
Set and baseline: the same sealed bank. Baseline = the stored v1 baseline arm, read with --cache-only (72/72 hash matches at afb9b7a0, 0 GPU). Only the candidate arm runs on the card. This is the kit's step-2 keep test.
Win: same bars as v1 (turn time lower by more than 2 SE and fastgate ACCEPT on -seconds; full answer, quality and flow chart not lower by more than 2 SE; 0 errors).

## 2026-09-26 · Result: no-shape-bounce v2 (registered above), sealed bank, candidate arm only

The candidate, queued on 09-25, waited behind an ML harness lock whose driver had died (18:40Z-01:10Z); nothing ran for Sequence in that window. Solo hold 01:10:58Z-01:20:31Z. Baseline = the stored v1 baseline arm (bank-noshape2-base.json, 72/72 cache hits, 0 GPU). 72 pairs, 0 errors. Files: gpu/ab/release-bank/noshape2/.
| measure | defaults (cached) | + flag v2 | delta (SE), paired n = 72 | fastgate ab (family) |
|---|---|---|---|---|
| mean turn time | 9.20 s | 7.82 s | -1.39 s (0.34), 4.1 SE | ACCEPT, 1.39 s faster, CI [0.81, 1.97], 27 wins / 9 losses of 36 |
| full product answer | 89% | 90% | +0.01 (0.02) | UNSURE, CI [-0.03, +0.06] |
| lesson quality | 65.6 | 64.7 | -1.0 (1.1) | |
| concept flow chart | 94% | 94% | 0.00 (0.04) | |
| model calls per turn | 1.72 | 1.25 | -0.47 (0.07) | |
| closing-question resends | 42 | 8 | -0.47 per turn (0.07) | |
**Kept; on by default** (port 753a2c3d; SEQUENCE_TEACH_PRODUCT_NO_SHAPE_BOUNCE=0 turns it off). Every bar met: turn time down 4.1 SE with fastgate ACCEPT, full answers, quality and flow chart within 2 SE, 0 errors. Under the 9 s target. teach-product-mode 21/21.
Kit step 2 keep test passed: the baseline arm cost no GPU, and the bank A/B took one 9.5-minute hold instead of two.
New bank number: 90% full answers at 7.8 s (was 89% at 9.2 s at the pinned snapshot).

## 2026-09-26 · Registered before the run: the concept chart names its hops (new diagram surface)

Why: DOT, D2, Mermaid (flow and state), path and flow lines were all tried as the model's chart language and none was kept. The chart most teach turns actually show is the harness's concept chart (the focus file and up to 4 neighbours), and it is a star of unlabelled arrows with no steps: a reader sees that parts connect, not how or in what order. The traced-flow chart already carries labels and steps, and the canvas plays steps with FlowStepper.
Change (port 0dcd1acc, off by default): SEQUENCE_TEACH_CONCEPT_STEPS=1 labels each concept-chart arrow with its scanned edge kind and adds steps, inbound hops first, each saying what the scan says travels (route, topic, table), so the canvas numbers and plays them. concept-chart-steps 3/3 plus concept-chart 15/15.
Set (offline, 0 GPU): every stored teach turn on the shopfront fixture whose chart is a concept chart (tools/bench/out teach runs). Arms: the same lesson text with the chart rebuilt flag off vs flag on from a live scan of the fixture. Control: the flag-off rebuild must equal the stored chart.
Judge: lesson-judge pairwise, both orders, an Opus 5.5 reader that sees the lesson text plus the chart written out (boxes, arrows with labels, numbered steps). Order-disagreements are ties.
Win: on the "picture carries it" criterion, flag-on wins minus losses above 2 SE (sign test over distinct turns); "overall" and "true" not worse by more than 2 SE. The deterministic scorer (lesson-quality scoreChart) rewards labels and steps by construction, so it is reported, not used to decide.

## 2026-09-26 · Result: the concept chart names its hops (registered above), offline pairwise judge

55 pairs from 65 stored concept-chart turns (7 shopfront questions; 10 were repeats of the same text). Control: 65/65 flag-off rebuilds equal the stored chart byte for byte. 0 GPU. Judges: three Opus 5.5 readers, blind item ids, each pair judged in both orders, order disagreements scored as ties. Files: gpu/ab/concept-steps/.
| criterion | flag on wins | loses | ties | net (SE) over 55 pairs | net (SE) over 7 questions |
|---|---|---|---|---|---|
| the picture carries it | 40 | 0 | 15 | +0.73 (0.06), 12 SE | +0.73 (0.14), 5.3 SE |
| overall | 40 | 0 | 15 | +0.73 (0.06) | +0.73 (0.14) |
| true to the repo | 0 | 0 | 55 | 0 | 0 |
| clear, teaches, kind | 0 | 0 | 55 | 0 | 0 |
scoreChart (report only, rewards this by construction): 66.3 to 98.3.
**Kept on the registered bar** (picture +12 SE, 5.3 SE by question; true and overall not worse). Caveats, stated so nobody over-reads it: the text is identical, so the judge sees one difference and credits it; the 15 ties are turns where the picture was off-topic (an http.ts import star for a queue question), which labels cannot fix; one judge tied those, the other two gave the labelled one a narrow win. Most hops on this fixture say only "import", so the step text is thin. The flag stays off until the canvas is looked at with steps on a concept chart (FlowStepper on a star, not a chain); that render check is next, then the default flip.
Next idea from the ties: pick the concept chart's neighbours by the question (a queue question should draw the queue edge), which is a relevance fix, not a surface one.

## 2026-09-26 · Render check: concept chart steps on the canvas (Chromium, flag off vs on)

Harness: SeqChartView and FlowStepper mounted as AiCanvas mounts them, web2's own vite config, system Chrome, 440 and 900 px frames, two concept charts rebuilt from a live shopfront scan (invoices.ts, http.ts). Files: gpu/ab/concept-steps/render/ (screenshots, report.json).
- Every box inside the frame at 440 px; no console errors from the product.
- Link labels clip on a 3-layer star: invoices.ts gets a 20 px gap between boxes, the 18-31 px labels sit under the boxes ("impo", "mport"). FlowChart fits to a fixed FIT_W = 440, so a 900 px frame draws the same cramped layout.
- Steps show only as the FlowStepper list under the chart, and on a star they read wrong: four parallel edges are numbered as if they were one sequence, and http.ts lists "import, import, import". The stepper also doubles the chart's height.
**Verdict: the judge's win does not survive the render. The flag stays off; v1 is not flipped.** The text judge saw a clean written-out chart the canvas does not draw. Next (v2): labels only where the edge says more than "import" (routes, topics, tables), no steps on a star, and FlowChart fitting to its real width. Judge v2 on screenshots, not on text.

## 2026-09-26 · Discarded offline: an ask naming a kind of connection seeds from those edges

Hypothesis: the 15 tied judge turns showed off-topic pictures because "queues vs HTTP" and https:// links name http.ts by its basename; SEQUENCE_TEACH_ASK_EDGE_KIND=1 drops files named only by a connection word and seeds from the files on edges of the kinds the ask names. Tests 38/38 (4 new).
Offline check over all 54 teach-eval asks (makemore and shopfront scans, 0 GPU): the first concept changes on 1 of 54 (link-03: http.ts to invoices.ts); of the 10 asks naming a kind, the first concept touches that kind on 1 without the flag and 2 with it. sys-03 ("the services here") is unchanged because it carries no repo reference the queue builder accepts. One changed convo cannot beat noise in a GPU A/B, so it is not worth a card hold. **Discarded (too narrow); code reverted.** Patch and test kept in gpu/ab/concept-steps/ for anyone who widens the repo-reference rule first.

## 2026-09-26 · Registered before the run: concept chart v2, hops written into the caption

Change (port c7f04e37, off by default): SEQUENCE_TEACH_CONCEPT_STEPS=caption keeps the v0 picture (no link labels, no steps) and appends up to 3 sentences for the hops that say more than "import": "invoices.ts calls InvoiceController.java (GET /invoices/*)." The caption wraps under the chart, so nothing collides on a 440 px star. concept-chart-steps 5/5 plus concept-chart 15/15.
Set: the 15 distinct (question, chart) items behind the 55 v1 pairs; an item whose chart has only import hops renders identically and is a tie by construction (counted, not judged).
Judge: rendered in Chromium at 440 px as the canvas mounts it; three Opus 5.5 readers see the question and the two screenshots, blind, both orders; order disagreements are ties.
Win: the picture criterion, v2 wins minus losses above 2 SE over the judged items, and no item where a judge flags text clipped or overlapping.

## 2026-09-26 · Found: the canvas has never shown a concept chart's caption

ChartFrame hides a caption that starts with the chart's title (captionEchoesTitle, web2/src/charts/ChartFrame.tsx:84), and every concept caption started "<title> and what it connects to". So the provenance line was never on screen or in the accessible name. v2's first render (port c7f04e37) was byte-identical to v0 for all 15 items for this reason. Fixed in v2 by opening the hop caption with "What travels here:" (port 52297bb9); a caption with no hops keeps the old text and stays hidden, as before.

## 2026-09-26 · Result: concept chart v2, hops in the caption (registered above), judged on screenshots

Render (Chromium, 440 px, as AiCanvas mounts the chart): 7 of the 15 items gain 1 to 3 caption lines (16 to 48 px taller); the other 8 are import-only stars and render byte-identical (ties by construction, not judged). No clipping or overlap from the caption, every box in frame, 0 console errors; flag-off images byte-identical across both renders. Files: gpu/ab/concept-steps/v2/.
Judges: three Opus 5.5 readers, blind file names, each item in both orders; order disagreement would be a tie.
| | caption wins | off wins | ties | per item (n = 7) |
|---|---|---|---|---|
| picture helps the question | 21 | 0 | 0 | 7 of 7 items unanimous; sign test p = 1/128 |
Clipping flags only in the caption arm: 0 (the "InvoiceContr…" cuts are in both arms). One judge noted the caption names only non-import hops, so the invoices.ts → http.ts import is not listed; that is by design.
**Kept; on by default** (port 649d305e; SEQUENCE_TEACH_CONCEPT_STEPS=0 turns it off, =1 is v1). concept-chart-steps 6/6, concept-chart 15/15. The effect is on stars with a route, topic or table; import-only stars are unchanged. Unlike v1, the judged thing is exactly what the canvas draws.
Left open: queue asks still get an HTTP picture (the concept is picked by name, see the discarded ask-kind seed); the chart fits a fixed 440 px width even in a wider frame.
Gate at 649d305e: analyzer 3134/3137. The 3: a stale dist file of the reverted ask-kind test (its source was deleted; dist is untracked; removed) and the two terminal WS tests, which fail with "AttachConsole failed" when the suite runs from this session's non-console shell (same two failed at 753a2c3d; they touch no chart code).

## 2026-09-26 · Result: the flow chart fits its frame's real width (measured, not judged)

Registered in the thread's plan, not in this log before the run; the bar was set then: 440 px must stay byte-identical, and a wider frame must draw no overlaps and no more cut labels. Change (port c71ae325, default flipped at cad0dce3): FlowChart reads its scroll box width (ResizeObserver) and fits to max(440, width), never growing gaps or boxes past their defaults; localStorage seq.chartFitWidth = '0' turns it off. flowFitWidth 8 tests (the 900 px and gap-regrow cases fail on the fixed-440 code).
15 real concept charts x 440/900 px x off/on = 60 Chromium renders (files: gpu/ab/fit-width/):
| width | fit | 3-layer SVG width | smallest gap | smallest box | overlaps | scroll overflow | cut labels |
|---|---|---|---|---|---|---|---|
| 440 | off | 432 | 20 | 120 | 0 | 0/15 | 6 |
| 440 | on | 432 | 20 | 120 | 0 | 0/15 | 6 |
| 900 | off | 432 | 20 | 120 | 0 | 0/15 | 6 |
| 900 | on | 616 | 64 | 152 | 0 | 0/15 | 4 |
2-layer charts (9 of 15) draw 400 px in every arm. **Kept; on by default.** web2 full suite at cad0dce3: 282 files, 3256/3256 pass; tsc clean. Only frames wider than 440 px change; the AI canvas itself is 440 px, so this shows where a chart gets more room.

## 2026-09-26 · Registered before the run: a short product answer

Why (sealed bank, v2 candidate rows = today's defaults): a one-call product turn costs about 1.9 s plus 21 ms per output token (fit over 64 one-call turns; time tracks output tokens at r = 0.93, input at 0.75). Split into thirds by length, the shortest answers (164 words) were full product answers as often (21/21) and scored higher (68.3) than the longest (258 words, 63.5), at 6.3 s against 9.0 s.
Change (port 8d6a6d51, off by default): SEQUENCE_TEACH_PRODUCT_SHORT=1 adds one line to the product instructions: keep the whole answer to about 150 words. teach-product-mode 22/22.
Set: sealed release bank v1, 36 x 2 = 72 turns, Sequence half from the 9f810373 snapshot. Baseline: the no-shape-bounce v2 candidate rows (bank-noshape2-cand.json), which are today's defaults. Check that makes them valid at head: a --cache-only read at 8d6a6d51 matched 72/72 first-prompt keys of the stored baseline arm (0 model calls), so the first prompt is byte-identical with the flag off. Only the candidate arm runs on the card.
Win: mean turn time lower by more than 2 SE (paired) and fastgate ACCEPT on -seconds; full product answer, quality and concept flow chart not lower by more than 2 SE; 0 errors.

## Release 0.1.3 published (2026-09-30)

Mirror scan 41 refusals to 0: lab/ excluded from the mirror (8d12f4b5, release-policy test red without it), a spelled home path in tools/measure fixed, and the private folder name now counts only as a path segment (ad70b27f, Jaden approved in thread). Mirror 1e690d6 on naidx0/sequence-arch-tool, tag v0.1.3, Release workflow green, 7 assets. trysequence.app at 0.1.3 (e496b1b1, Vercel success, bundle main-D3hlvE74.js). Baseline: five 0.1.2 links returned 200. New: five 0.1.3 links return 200, four installer hashes match SHASUMS256.txt, portable zip and the silently installed app (ProductVersion 0.1.3.0) both pass desktop-zip-smoke; both DMGs carry the koly trailer but were not launched (no Mac here). Open: the public repo's hygiene CI fails 1 of 322, gpu-lock-log's gone-pid reap case, because the lock's liveness check is Windows-only by design; it also failed on 0.1.2's CI for a different test.

## Download smoke on fresh machines (2026-09-30)

Win bar: every platform's links on the live site return 200, match SHASUMS256.txt, and the app launches to the composer (SEQUENCE_DESKTOP_SMOKE PASS) on a machine with nothing from this project installed. New tools/release/download-smoke.mjs reads the links from the page as headless Chrome renders it, and a manual workflow (download-smoke.yml) runs it on windows-latest, macos-latest (arm64) and macos-15-intel. Run 36785720006 on the public repo: 3 of 3 jobs pass, 4 of 4 installers launch (Windows installer, portable zip, arm64 dmg, Intel dmg). Both Mac apps are ad-hoc signed, so first launch is Open Anyway rather than "damaged". Public README's right-click Open advice replaced with Open Anyway to match the site.

## 2026-10-01 · Registered before the run: find the fix (topology vs grep, offline)

Question: does the map's topology help find the files a change touches? Set: real commits, not written by me. For each repo (codeforge, ml-harness), snapshot S = the first-parent commit 300 before HEAD, extracted with git archive; queries = the next first-parent commits after S whose subject is not a log/handoff/merge line and which modify 1 to 8 source files that already existed at S. Question = commit subject; truth = those files. No leakage: every picker reads the S tree only.
Pickers, top 5 each: A grep (TF-IDF of question words over file contents); B Sequence today (selectAskResearchPaths over the map's digest files); D lexical (A plus Sequence's path score, both scaled to 0..1); C topology (D plus 0.5 x the best D score among the file's one-hop map neighbours).
Primary: hit@5 (at least one true file in the five). Also recall@5, tokens to read the five (chars/4), ms per query.
Win: C beats A on hit@5 by more than 2 SE (paired by commit) AND C beats D by more than 2 SE, so the gain is the topology's and not the path score's. Otherwise C is discarded.

## 2026-10-01 · Result: find the fix (registered above)

0 GPU, 0 model calls. Files: report/raw/find-the-fix-*.json. Bench: tools/bench/find-the-fix.mjs.
codeforge: S 43e5e4f2, 194 commits, 1,500 source files, map 1,109 nodes / 2,950 edges. ml-harness: S at HEAD~300, 150 commits, 782 files, 621 nodes / 2,055 edges.
| picker | codeforge hit@5 | ml-harness hit@5 | codeforge tokens to read the 5 | ms/query |
|---|---|---|---|---|
| A grep (TF-IDF over contents) | 64% | 22% | 458,690 | 141 |
| B Sequence today (path words over digest files) | 3% | 9% | 9,324 | 0.6 |
| D lexical (A + path score) | 36% | 15% | 175,384 | 113 |
| C topology (D + one-hop neighbours) | 53% | 16% | 114,108 | 114 |
Paired, codeforge: C vs A -0.113 (SE 0.043); C vs D +0.165 (SE 0.033), 5.0 SE. ml-harness: C vs A -0.060 (SE 0.037); C vs D +0.007 (SE 0.026).
**C discarded on the registered bar**: it never beats grep. The one-hop bonus does rescue a weaker ranker on codeforge (+16.5 points over D, 5 SE) but adds nothing on ml-harness.
Found: Sequence's own file picker reaches the fix's files in 3% and 9% of commits. Its question words have no stopword list, so "the" matches every *Theme* file (structuralTheme.ts is in its top 2 on most misses), and it scores only path names over the digest's files, never contents; 15 of 194 codeforge questions got no pick at all. Next hypothesis: stopwords plus content TF-IDF inside selectAskResearchPaths, scored on this same bench, with grep (A) as the bar.
Caveats: commit subjects in codeforge are long sentences and often name the file, which favours grep; grep's top five are large files, so its token cost is a ceiling, not what an agent would read.

## 2026-10-01 · Registered before the run: the same agent with and without Sequence

Question: does attaching the Sequence MCP server (who_calls, path_between, impact, ...) make a real coding agent answer architecture questions better, cheaper or faster? Set: tools/bench/agent-ab/sets/arch-questions-v1.json, sha256 cdbd6fa7..., 36 questions (shopfront, ml-harness, premai x who_calls, impact, path; 12 each), labelled by an independent worker from source only, never from Sequence output. Runner: tools/bench/agent-ab/run.mjs, same prompt in both arms (it names the repo path), read-only, user config and MCP servers ignored; the sequence arm adds only packages/mcp/dist/index.js. Agent: pending Jaden's pick (Codex on a local model, Claude Code, or both).
Primary: F1 of returned files vs labels, paired by question. Also recall, exact answers, tokens, wall time, tool calls.
Win: sequence arm F1 above plain by more than 2 SE (n = 36), with 0 errored runs excluded and counted. Tokens and time are reported, not bars. Otherwise the claim is "no evidence", in those words.

## 2026-10-01 · Registered before the run: the file picker skips common words (H-stopwords)

Why: find the fix put Sequence's picker at 3% (codeforge) and 9% (ml-harness) hit@5; on most misses "the" matched every *Theme* file. Published BM25 over file paths only reaches 28.4% file Hit@5 on SWE-bench Verified (arXiv 2607.11046, Table 2), so path words alone should do far better than 3%.
Change: questionTokens in packages/analyzer/src/explain/askFileResearch.ts drops a fixed list of English function words and filler verbs before scoring paths. Nothing else.
Set: the same find-the-fix replay (codeforge S 43e5e4f2, 194 commits; ml-harness, 150 commits), picker B only; A, C, D unchanged as controls.
Win: B hit@5 above its 3% / 9% by more than 2 SE (paired) on both repos; ask-file-research tests green; the shopfront bench still picks the same six files. Otherwise revert.

## 2026-10-01 · Result: H-stopwords (registered above)

Paired by commit (HEAD had moved, so the snapshot shifted by a few commits; 190 and 142 commits matched the first run). Picker B hit@5: codeforge 2.6% -> 3.7%, +0.011 (SE 0.007), 1.6 SE; ml-harness 8.7% -> 9.8%, +0.007 (SE 0.007), 1.0 SE. Controls unchanged (A 63.7% / 23.8%). ask-file-research and teach-product-mode 36/36 with the change.
**Discarded** (below 2 SE on both repos); reverted. The stopwords are not the main fault: the picker only scores path words, and only over the digest's files. Next: score file contents (the published paths-only vs raw-source gap is 28.4% vs 67.6% Hit@5, arXiv 2607.11046 Table 2). Also: pin the snapshot by hash in find-the-fix so reruns use the same commits.

## 2026-10-01 · Result: the same agent with and without Sequence (registered above)

Agent: Codex could not run it. On qwen3.5:4b its prompt hit the 32,768-token window (0 tool calls), and it would not load a locally built 64k variant ("pull model manifest: file does not exist"). Ran instead: tools/bench/agent-ab/bash-agent.mjs (mini-swe-agent style, read-only, .sequence/ refused in both arms) on qwen3.5:4b via Ollama, $0, under the card lock. Two runs per arm, as the bench README requires.
| | plain r1 | plain r2 | sequence r1 | sequence r2 |
|---|---|---|---|---|
| F1 | 0.082 | 0.091 | 0.238 | 0.191 |
| exact | 1 | 1 | 2 | 5 |
| commands/q | 1.19 | 1.33 | 3.81 | 3.64 |
| tokens/q | 1,158 | 2,328 | 6,789 | 9,152 |
| s/q | 4.0 | 2.7 | 7.8 | 6.9 |
Pooled paired F1 +0.128 (SE 0.051), 2.5 SE, n = 36; both sequence runs above both plain runs. **Win on the registered bar.** By type: who calls 0.08 -> 0.18, what breaks 0.02 -> 0.19, path 0.15 -> 0.28. By repo: shopfront 0.09 -> 0.07 (no gain), ml-harness 0.08 -> 0.37, premai 0.10 -> 0.20.
Caveats: the plain agent mostly stopped after one command; the map arm spent ~4x the tokens. Shopfront shows no gain although the map scores 15/15 there. Next: find out why on shopfront (read the sequence-arm transcripts), and rerun on a larger local model if one fits the card.
Raw rows: report/raw/agent-ab-*.jsonl.

## 2026-10-05 · Overhaul Phase 0: sealed baselines (codeforge 221f18cb, worktree branch overhaul)

No change to the product; this entry is the bar every overhaul step is measured against. Machine: RTX 2060 SUPER box, Windows 11, Node 24.13.
| measure | baseline | n | how |
|---|---|---|---|
| tests | analyzer 3137, web2 3256 (282 files), schema 488, export 143, mcp 64, acp 31, desktop 23, ink 28, gateway 17, test:ci 367; 0 fail | 1 | `pnpm -r test`, `pnpm test:ci` (162 s) |
| build | 28.5 s, exit 0 | 1 | `pnpm -r build` |
| shopfront, cold scan: server up | 578 ms | 5 | tools/measure/first-board.mjs --cold |
| shopfront: page to first board node | 269 ms (260-285), 0 clicks | 5 | same |
| codeforge, cold scan: server up | 7,358 ms (6.4-7.4 s) | 3 | same, --repo this worktree |
| codeforge: page to first board node | 393 ms (371-407), 0 clicks | 3 | same |
| boot /api calls before the board | 18; repeats: GET /api/sessions x3, GET /api/sessions/:id x3, GET .../goal-run x2 | 8 | same |
| boot JS before the board | 2,588 KB (main 1,182 KB + elk.bundled 1,405 KB) | 8 | same |
| web2 dist | 10,760 KB total, 8,196 KB JS; largest chunks babel 2,290, elk 1,405, index 1,182, cynefin 674, mermaid 643 KB | 1 | dist listing |
| installer 0.1.3 | Setup.exe 107.3 MB, win zip 143.7 MB, dmg 136.4 / arm64 129.5 MB | - | GitHub release v0.1.3 assets |
| desktop window to settled composer | 10.7 s first launch, then 1.6 s, 1.4 s | 3 | tools/desktop-smoke.mjs (dev Electron) |
| find the fix, picker B hit@5 | codeforge 2.6% (5/194), grep 63.9%; pinned S 43e5e4f2 | 194 | find-the-fix.mjs --at 43e5e4f2 (new flag; reproduces the 2026-10-01 run exactly) |
| agent A/B F1, 36 sealed questions | sequence 0.21 vs plain 0.09 | 2 runs/arm | recorded at 89d8f667, not rerun |
Found: with `--repo` the app already lands on the board (0 clicks), unlike the 0.1.3 mirror (boardOpen=false). The attach-from-picker path is measured in Phase 2. Every boot repeats three session reads.

## 2026-10-05 · Phase 2 baseline: first run, no repo (web app, empty profile)

Fresh home, `sequence app` with no --repo, checked by hand in a browser (n=1, deterministic UI). Launch lands on an empty "Workspace" chat with "Nothing to draw yet" on the board and a "Connect a..." model chip cut off. To reach a board: Open project, then one click per folder level in the home-jailed picker, then the board opens. Clicks launch-to-board = 1 + folder depth below home: 2 for ~/shopfront, 3 for ~/Projects/premai, 5 for ~/OneDrive/Documents/GitHub/ml-harness. No agent is detected: agents must be added by hand (`sequence agent add`, ~/.sequence/agents.json). Installed here: claude 2.1.280 (`claude auth status --json` reports loggedIn), codex-cli 0.153.4 (`codex login status`), hermes. The board then opens at half width with nodes cut off at the right edge (no fit after attach).
Win bar for Phase 2: 1 click from launch to board for any git repo found under home, agents detected with no typing, and no credential file read.

## 2026-10-05 · Phase 1 H-bundle: what loads before the board (kept: katex on first formula)

Registered before measuring, per hypothesis. H1 babel 2,290 KB out of dist (win: dist JS -1 MB): not met, no change; babel is already lazy, imported only by app/ReactCanvasMount.tsx:24 to compile canvas.write_react blocks, a live feature. Next: replace @babel/standalone with a smaller transform (sucrase) and measure. H2 elk off the boot path (win: boot JS -500 KB, board not slower): not met, no change; ELK already runs in a Web Worker (canvas/layout.ts:397), and its fetch only races the first node; the board paints seed positions before it. H3 diagram libraries lazy (win: entry -200 KB and boot JS -200 KB, tests green, maths still typesets): mermaid, cytoscape and cynefin were lazy, but web2's own katex 0.18.7 was imported statically by chat/MathText.tsx. Now loaded on the first formula, which shows its source until katex arrives. Locking tests in chat/ProseMath.test.tsx failed before, pass after.
| shopfront, cold, n=5 | baseline | new | delta |
|---|---|---|---|
| entry chunk | 1,182 KB | 925 KB | -257 KB |
| boot JS before the board | 2,588 KB (all 5 runs) | 2,332 KB (all 5 runs) | -256 KB |
| page to first board node | 269 ms (260-285) | 240 ms (232-274) | -29 ms, ranges overlap: inside noise |
| page to composer | 191 ms | 167 ms | -24 ms |
| web2 tests | 3256 | 3258 | +2 locking |
**Kept** on the boot-JS bar (identical in every run). Dist total unchanged (code moved, not removed). Also found: katex ships twice (web2 0.18.7 and mermaid's 0.16.47, ~255 KB); aligning them is a rendering-version choice, queued. Commit 08eb7d0f. Re-verified by the orchestrator at that head: build 0, web2 test 0.

## 2026-10-05 · Phase 1 H-boot and H-surfaces (kept), access modes (kept), onboarding endpoints (kept)

H-boot, registered before measuring: boot /api calls below 18 with no repeats, board not slower than the baseline's slowest run. Cause: three readers of the sessions list and two of the session never shared one request, and boot settle re-read both. Fix: one shared GET, a boot-settle guard (app/bootRead.ts). Locking tests failed on 613ef053 sources.
| shopfront, cold, n=5, orchestrator rerun at dbbe0a69+b68c426d | baseline | new | delta |
|---|---|---|---|
| boot /api calls | 18 (3 repeated) | 13 (0 repeated) | -5 |
| page to first board | 269 ms (260-285) | 238 ms (231-294) | inside noise |
| boot JS | 2,588 KB | 2,333 KB | -255 KB (the katex change) |
**Kept.**
H-surfaces: AI Canvas and Browser leave the tab strip and refuse AI/host opens, behind SHIPPED_SURFACES in app/chromeTabModel.ts (code kept). Strip shows exactly Chat, Files, Architecture, Whiteboard, Terminal; locking test reads the rendered strip and failed before. No Programs or Task Board surface exists in web2. **Kept.** Open: the Activity overlay lists built-in programs; left visible.
Access modes (acp + run-node): Ask = Claude default / Codex on-request + read-only; Auto-edit = acceptEdits / on-request + workspace-write; Full access = bypassPermissions + allowDangerouslySkipPermissions / never + danger-full-access, behind one per-project confirm in .sequence/full-access.json (gitignored; a tracked or foreign-root file does not count). An agent's refusal is passed through as an error with its own reason, never downgraded. Tests: acp 31 -> 45, analyzer +5, red before. Verified against a mock agent only, not real claude-agent-acp or codex-acp. web2 still folds Auto-edit and Full into "build" (call sites listed for the onboarding stream). **Kept.**
Onboarding endpoints: GET /api/onboarding/providers (vendor status commands only, no credential file, no email in the body) and /api/onboarding/repos (breadth-first, depth 5, 2 s cap). On this machine: providers 1038 / 399 / 371 ms (cold disk, then warm), claude 2.1.280 signIn (its own status says loggedIn false here), codex 0.153.4 ready "ChatGPT"; repos 1603 / 187 / 181 ms, 63 repos, all four required repos present. 19 tests. **Kept** on the registered bar (< 3 s, correct versions and states, required repos listed).
Gate at the merged head: build 0; analyzer 3161, web2 3277, acp 45, mcp 64, schema 488, export 143, desktop 23, ink 28, gateway 17, test:ci 367; 0 fail. One parallel `pnpm -r test` run lost a vitest worker ("Worker exited unexpectedly"); web2 alone passed. The two new routes are classified GAP in tools/ci/reachability-baseline.json until the UI calls them.

## 2026-10-05 · Stream 1 slice: first-run screen and sign-in (kept, ships on tests plus screenshots)

No A/B (obvious fix, per the 19:22Z cadence rule). With nothing attached the app shows agents (GET /api/onboarding/providers) and repos (GET /api/onboarding/repos); one click attaches and lands on the board with the composer focused. tools/measure/first-run.mjs on an isolated home (repos at depth 1, 2 and 4; fake claude and codex on PATH), n=1: clicks from launch to the board for the depth-4 repo 5 -> 1; lists rendered 325-335 ms after navigation. Sign in opens the embedded Terminal on the server-chosen vendor command (`claude auth login`, `codex login`; unknown or not installed -> 400) and re-probes when it exits; the pill turns Ready. No credential file read. Not met: board fit after attach, 5 of 11 nodes clipped at 72% zoom in a 598 px pane (canvas, stream 3). Small: Claude's card shows "Sign in" as both pill and button. Commits 3612ab78, 6bf6b85e, dc4c4cf0. Orchestrator gate at the merged head: build 0, analyzer 3164, web2 3292, test:ci 367, 0 fail.

## 2026-10-05 · Stream 1 slice: composer intent and access (kept, tests plus screenshots)

Intent (Plan/Build) and access (Ask/Auto-edit/Full access) are two values carried in the existing agent chip ("MINICPM5 · Build · Auto-edit"); the bar keeps exactly three controls per the owner ruling of 2026-09-19 (a fourth-button version was reverted; the question is with Jaden). Shift+Tab cycles access. Full access asks once per project (GET/POST /api/acp/full-access, Base UI AlertDialog loaded lazily on first confirm) and is re-checked on a project change. /api/ask keeps plan|build: plan or build+Ask send plan; build+Auto-edit or build+Full send build. Boot JS on shopfront 2,342 -> 2,347 KB (n=3; a first version with Base UI Menu on the boot path was +143 KB and was reworked). Gate at 28e0be90: build 0 (after `pnpm install` for @base-ui/react), analyzer 3164, test:ci 367; web2 3298 on the second full run. The first full run failed AccessControl.test.tsx "Shift+Tab cycles..." under load (passes alone 6/6): flaky, sent back to be hardened along with provider-probe's 3 s cap test, which flaked once in the builder's runs.

## 2026-10-05 · Stream 1 slice: Your setup, names only (kept)

GET /api/onboarding/setup lists MCP server and skill names from ~/.claude.json, ~/.claude/settings.json, ~/.codex/config.toml and skills/<name>/SKILL.md (Hermes agent_import sources). Commands, env values and credential files never reach the answer; a planted-secret test locks it. Real home: 1 MCP server, 8 skills. Enabling them in Sequence is not built. Commit aed264cd. Gate: build 0, analyzer 3167, test:ci 367; web2 3300/3301, the one failure being the known flaky AccessControl Shift+Tab test (now 2 of 3 full runs), which is with stream 1 to fix before anything else merges into overhaul.

## 2026-10-05 · Stream 1 close: two flaky tests fixed

AccessControl Shift+Tab test preloads the lazy dialog chunk and bounds each dialog wait at 10 s; provider-probe and onboarding-signin fake-binary tests pass a 15 s cap (the hung-fake test still proves the cap at 1.5 s). Builder's proof: web2 3 full runs 2 x 3301/3301 and 1 x 3300 (the one failure canvasPaneFocus "switching threads never brings the AI Canvas to the front", 5 s timeout, a third flaky test in stream 3's area); analyzer 2 x 3167/3167. Orchestrator gate at 163ba96a: build 0, analyzer 3167, web2 3301. Seen only with 5 suites in parallel, not fixed: terminal.test "resize control" and "repo-scoped shell" (5 s timeouts), web2 cardPainted and visualBoard once each. Stream 1 (onboarding and connect) is complete; open item for stream 2: ACP runs send permissionMode from chat/accessMode.ts acpPermissionModeFor(intent, access).

## 2026-10-05 · Stream 3: board fit, grouped board, controls, shell, ontology v2 (kept)

S1 fit and composite board, win registered before measuring: 0 cut-off boxes, <= 50 visible, fewer crossings and overlaps than baseline on both repos, including the after-attach path. tools/measure/board-legibility.mjs (label ink, waits for the layout worker), baseline build ee2b3be1, n=3 per cell, identical runs:
| repo | width | cut off | crossings | overlaps |
|---|---|---|---|---|
| codeforge | 1440 | 7 -> 0 | 22 -> 0 | 0 -> 0 |
| codeforge | 1024 | 9 -> 0 | 18 -> 0 | 0 -> 0 |
| shopfront | 1440 | 5 -> 0 | 13 -> 5 | 0 -> 0 |
| shopfront | 1024 | 4 -> 0 | 7 -> 5 | 0 -> 0 |
| shopfront via attach | both | 5 / 4 -> 0 | 13 / 7 -> 5 | 0 -> 0 |
Visible boxes 11 of 11 everywhere. Overlaps were already 0. **Kept.** Refit on pane resize until the reader moves the camera (boardRefit.test.tsx) fixes stream 1's after-attach clipping.
S2 controls (find, Start/End path, 1-3 hop neighbours, direction, framed/flat, PNG export via html-to-image 1.11.11, connector click lists file:line) and §3.2 view state (URL hash round-trips the spec example; 50-box budget: property test 25 graphs x 40 steps never above 50, found and fixed an off-by-one; real codeforge 12 expands <= 50; merged line count = sum of edges under it): **kept** on tests. PNG export: 2058x2144, 280 KB. Kept simpler than spec: ELK separate-children with per-group lifting instead of INCLUDE_CHILDREN; card sizes from existing arithmetic, no measure pass; direction follows pane shape instead of LR.
§3.1 ontology v2: shopfront 8/8 matched http edges carry apiId, one ext:api.stripe.com node, no ext node names a scanned service, v1 fixture validates. External calls from test files are not drawn (codeforge 32 -> 5 externals). Locks moved with reasons: shopfront nodes 36 -> 50, edges 40 -> 41, cold-turn prompt 3055 -> 3085 tokens. **Kept.**
S4 shell: Chrome-style tab strip, 240 px sidebar with 44 px rail, 32 px chat card heads, boot splash with 160 ms fade, reduced motion respected. **Kept** on tests plus screenshots.
Boot on shopfront, n=3, orchestrator rerun at 3d92475b: boot JS 2,347 -> 2,376 KB, board 303 ms (276-306), 13 boot calls, no repeats. Within noise of the run-to-run spread seen today.
Not built: the view switcher and the Flow/Grid/Diff/Hotspots views (no A/B run, nothing ships). Not done: externals drawn on the board (needs a brand-book silhouette), a hide control. Gaps: controls panel can cover a top-right box; long names wider than their box at far zoom; the all-expanded stress view has empty frames and tiny headers at 32% zoom.
Screenshots: https://claude.ai/artifact/XiHF8fWzUwVfPh6LzJMS51. Gate at 3d92475b: build 0; schema 491, analyzer 3172, mcp 64, export 143, web2 3346, test:ci 367; 0 fail.

## 2026-10-05 · Desktop size and launch (size kept; launch changes discarded)

Re-measured baselines: Setup.exe 107,400,071 B, zip 143,862,477 B; packaged smoke launch-to-composer median 947 ms (spread 63, n=5; stages: main 114, server up 682, ready-to-show 845). The 10.7 s first launch did not reproduce (warm-ups 1.4-1.7 s). Kept: H5 English locales only (en, en-US; "en" alone would drop every Windows .pak): installer -7.47 MB. H7 prune server bundle (node-pty .pdb ~57 MB, other-OS prebuilds, compiled tests, .map/.d.ts; 2,315 files): installer -10.42 MB, unpacked app 413 -> 300 MB; packaged pty spawn still works. Total installer 107.40 -> 89.52 MB (-17.9 MB), zip 143.86 -> 119.04 MB (-24.8 MB); kept state launch 894 vs 885 ms (A/B n=7, inside spread). Discarded: H3 server start at module load (-40 ms, under spread), H6 maximum compression (-52 B), H9 faster health poll (-41 ms met the rule but the first-frame stamp moved 909 -> 1368 ms; reverted until a screen capture settles whether people see a later fill). Already in base: show:false + ready-to-show, minimal main imports, a 122 KB asar. Biggest remaining lever: analyzer boot ~570 ms of ~950 ms.
Real-agent check, codex-cli 0.153.4, 3 runs: every mode exits 2 with "unexpected argument '--ask-for-approval'": `codex exec` has no such flag, so cliArgsFor('codex-cli', mode) breaks all three modes. No quota spent. Fix queued. Builds ran from a short-path copy because makensis hits MAX_PATH in the worktree. Orchestrator gate at e521afc4: build 0, desktop 29/29, test:ci 367, desktop-smoke PASS.

## 2026-10-05 · Stream 2: agent to board (kept, one test red), map.md A/B (marginal keep), codex argv fix (kept)

Hook route (formats v2 §3.4): 20/20 scripted edits resolved to file and service; hook to SSE p50 0.7 ms, p95 1.6 ms (n=40); no context for files off cross-service edges, otherwise <= 600 chars with file:line; SessionStart returns the first 1k tokens of map.md; a fake user settings.json byte-identical after a session. Overlay in a browser on shopfront: 20/20 lit, POST to DOM p95 5 ms, 0 marks left after fade. Roster, tree and timeline from one event fold; "Ask an agent about this" sends the node's 1k map slice (mock ACP agent). Not on screen yet: three mount lines (overlay, agents panel, node menu item) are with the canvas/shell builder.
map.md A/B (registered: same local agent, sealed set cdbd6fa7, n=36, qwen3.5:4b, map.md at 4k in the prompt vs the sequence arm). F1 per run, all 2026-10-05, same settings:
| run | sequence | map |
|---|---|---|
| r1 | 0.276 | 0.367 |
| r2 | 0.295 | 0.466 |
| r3 | 0.290 | 0.471 |
At the registered 2 runs per arm (r1-r2): +0.131, SE 0.074, 1.78 SE: below the 2.5 bar. The coordinator then fixed the total at 3 pairs before r3's result was read; pooled 3 vs 3 same-day: +0.148, SE 0.057, 2.58 SE: above the bar, marginally (dropping sequence r1 gives 2.38 SE). Every map run is above every sequence run. Gain is in shopfront and ml-harness; premai flat (one service, 85-token map). Against the 2026-10-01 recorded 0.215 the gap is larger, but that comparison is not same-day and is not used. **Kept at the 3-pair rule**, flagged marginal: a fresh pre-registered replication on another model is the next check before any answer-quality claim leaves this log.
codex-cli argv: `codex exec` 0.153.4 rejects --ask-for-approval; now `-c approval_policy=<p> --sandbox <s>`. Fake-codex test copies the real rule (3 failures before, 18/18 after). Real runs, one per mode, fresh temp repos: Ask did not create hello.txt (read-only), Auto-edit and Full created it, no prompts, exit 0. Codex reports approval: never in every exec run, so under exec the sandbox alone carries Ask and Auto-edit. **Kept** (f8f0c49f, acp 49/49).
Gate at 830fc708 + f8f0c49f: build 0; web2 3360, mcp 66, desktop 29, acp 49, test:ci 367 all 0 fail; analyzer 3184/3185: agent-events "a scripted session of 20 edits" fails deterministically on overhaul at line 149, because a direct scan of a temp copy names the repo after the temp folder while the server's map header says "shopfront". Sent back as a code fix (names must agree). Also found map*.md written into the checked-in fixture folder by an in-place scan (gitignored); sent back too. One program-server-runs test failed once under load and passed 3/3 alone.

## 2026-10-05 · Stream 2 fix: graph cache served a copy as the original (kept)

The red agent-events test was a real bug. readCachedGraph checked file signatures but not which root a cached graph came from, so a copied tree carrying .sequence/graph.json was served with the original's repoName and repoRoot (the SessionStart map named "shopfront" for a temp copy). Now a cache from another root (realpath, case-folded on Windows) is a miss. Locking test plants a source-root cache with a forced-matching signature: fails without the root check, passes with it. Also: seqd-enrichment.test attached the checked-in fixture itself, writing into it; it now attaches a temp copy, and map.md is written only by the server's attach/rescan and `sequence map`, not on every cached scan (spec difference). Test copy filters really exclude .sequence/ now. Gate at 44efb022: build 0, analyzer 3186 (twice), mcp 66, test:ci 367; the fixture folder stays clean through both suites. Known flake: program-server-runs "concurrency ceiling" failed twice today on EPERM from rmSync in cleanup (Windows holding the temp dir); passes alone.

## 2026-10-05 · Codex through app-server: real approvals in Ask (kept; UI hookup pending)

Plain codex now runs through `codex app-server` (protocol taken from the installed binary's generate-ts/json-schema): file-change and command approval requests become ACP permission requests through the same gate as other agents; `codex exec` remains the fallback. run-node gains an opt-in `interactivePermissions`: requests the mode would refuse go to the person as `acp:permission {pending, requestId, proposal}` and wait for POST /api/acp/permission (5 min, then the mode's own decision; a closed stream denies). Tests on a fake app-server: acp 58, analyzer +7 (6 of 7 fail with the old client). Real runs, codex 0.153.4, one per mode: Ask raised one approval (codex chose a PowerShell command, not a file edit), Deny left no file; Auto-edit and Full wrote hello.txt with no request. **Kept** (441e7f4b). Open: no web2 surface answers these yet (run-node's stream is not read into the store; EditApprovalCard needs a command variant); programRun.ts still builds AcpClient directly; codex threads land in the user's codex history (not ephemeral). Gate: build 0, acp 58, test:ci 367; analyzer 3192/3193: the concurrency-ceiling test failed again on EPERM even with the new cleanup retries, so a run is still holding its dir. Root cause sent back.

## 2026-10-05 · Server close waits for its runs (kept); program runs drive plain codex (kept)

The concurrency-ceiling EPERM was a server bug: the close handler began shutting runs down without waiting, and an aborted run still writes its record and runs git in the repo, so cleanup raced git's working directory. New `serverSettled(server)` resolves once every live run has finished (after its git snapshot) and every cached agent session is disposed. Locking test: three slow runs, close without cancel, all run.json finished and the repo deletes with no retry; fails twice in a row with the old close. programRun.ts builds agents with createAgentClient (fake app-server test; fails with AcpClient). Gate at 55d77fa5: build 0, analyzer 3195 twice (builder 3 of 3), test:ci 367.

## 2026-10-05 · Agent approvals in the app (kept; not mounted in the shell yet)

web2 streams run-node with interactivePermissions and the access mode from the composer; pending acp:permission events render as approval cards (file request: the edit card in whole-request mode with Allow/Deny; command request: the command verbatim in mono with Allow/Deny), answers POST /api/acp/permission, and the settle event folds the card to one row ("Allowed by you", "Denied by you", or a timeout line). Tests: runNodeStream 4, EditApprovalCardAgent 5, askAgent 4 (one askAgent run failed once with an idle button, then passed 3/3 and in two full runs: watch). Real run, one codex turn in Ask through a specimen page in headless Chromium: a command request at 16.4 s, Deny clicked, folded "Denied by you", hello.txt absent. Not reachable in the shipped shell until the views builder mounts AskAgentMenuItem. Gate at 2e776007: build 0, web2 3370, test:ci 367 (the /api/acp/permission GAP row removed).

## 2026-10-05 · No more @babel/standalone (kept); canvas React blocks mount for the first time

Registered: sucrase, lazily loaded, cuts dist JS by >= 1.5 MB, boot JS within 10 KB, blocks with JSX, TS and a react import mount live. Result: dist JS 8,507,112 -> 6,368,178 B (-2.14 MB; compiler chunk 2,344,961 -> 205,752 B); entry +275 B; boot JS 2,376 -> 2,377 KB (n=3); board 257 -> 260 ms. Found: the shipped Babel config emitted ESM `import` from react/jsx-runtime, so every canvas.write_react block threw "Cannot use import statement outside a module" and fell back; the only mount test mocked Babel. Sucrase output matched a corrected Babel exactly on 4 blocks. The block's require allows only react. **Kept** (2debe777). Gate: build 0, web2 3375, test:ci 367.
Tool fix: first-board.mjs set SEQUENCE_HOME, which the analyzer does not read, so earlier runs used the real ~/.sequence (no writes found there today). Now SEQUENCE_USER_DIR; an isolated run reads the same: 13 boot calls, 2,377 KB, board 247 ms (243-293).

## 2026-10-05 · Registered before the run: board views (Grid, Flow) against the Map

Question: does a Grid view (dependency matrix of the boxes on the board, Okoe 2018: matrices beat node-link for dense clusters) or a Flow view (a sequence diagram over real edges along a picked path) let a reader answer architecture questions better than the Map? The earlier chart A/Bs here (tools/measure/draw-lang-ab.mjs with questions.*.json) score how well a model grounds a chart it writes; none scores a reader reading a rendered view, so this is a deterministic task score, written before either view exists. Scorer: tools/measure/board-views-ab.mjs. Each view is reached by the URL hash `view` token; no switcher ships until a view wins.

Repos: shopfront (fixture), codeforge (this worktree), ml-harness (temp copy, read-only). Two levels per repo, both set through the hash so every view sees the same boxes: L0 the first screen (nothing expanded, imports at package level only); L1 dense: every top-level box that has members expanded in id order (the 50-box budget applies) with file-level Imports on. Viewport 1440x900, board settled as in board-legibility.

Truth (derived, not hand-listed): the boxes the Map draws at that level (`data-node-id`), and every scanned edge, imports included, lifted to the deepest drawn box; distinct directed pairs, self and nesting pairs dropped (board-legibility's `edgesAtLevel` set). Questions per repo and level, generated from the truth:
- Q1 depends-on(X): the set of boxes X has an edge to, for every box with an out-edge.
- Q2 depended-on-by(X): the set of boxes with an edge to X, for every box with an in-edge.
- Q3 mutual(A,B): do A and B depend on each other (yes/no), for every unordered pair joined in at least one direction.
- Q4 path(A,B): the hop count of the shortest directed path, or "none": the first 10 ordered pairs by id at distance 2 or more, then the first 5 with no path.
Grid is scored on Q1-Q4, Flow on Q4 only.

Readers (fixed parsers over the rendered DOM; no model, no graph access):
- Map: a drawn edge (`.react-flow__edge`, pair from xyflow's aria-label "Edge from A to B") is read only if (a) both end boxes are wholly inside the pane and not under the controls panel; (b) both end boxes' names are readable: the title (far title, card title or group header) is painted (opacity not 0) and not cut (no ellipsis, scrollWidth/scrollHeight within the box); (c) the route is not bundled: no stretch of 24 px or more of its route runs within 3 px of another edge's route. Answers come from the read pairs only. Interactions: 0.
- Grid: a cell with a count is a pair row -> column; it is read if its row and column labels are painted and not cut and the cell text is at least 9 px on screen. A question needing a row or column outside the pane costs +1 interaction per axis scrolled.
- Flow: the reader sets start A and end B (2 interactions) and reads the messages drawn, in order; the answer is the message count, or "none" when the view states there is no path.
An answer is correct when it equals the truth exactly (sets equal, yes/no equal, count equal).

Score per view, repo and level: correct answers, paired with the Map's per question. Win bar, fixed now: a view wins on a repo when, over both levels pooled, it answers strictly more questions correctly than the Map AND an exact two-sided McNemar test on the paired outcomes gives p < 0.05 AND its mean interactions per question are at most the Map's + 1 (Grid) or + 2 (Flow, the two picks). A view ships in the switcher only if it wins on at least two of the three repos. The readers are deterministic: n = 1 per cell, and a second run must reproduce byte-identical answers or the run is void. A view that does not win stays out of the switcher, behind a disabled flag, and the discard is logged here.

## 2026-10-05 · Board views A/B: Grid kept (3 of 3 repos), Flow discarded (1 of 3)

Run as registered (entry above, committed as 375d3082 before either view existed; scorer tools/measure/board-views-ab.mjs, readers and win bar unchanged). One instrument bug was found while checking the first runs and fixed before the counted runs: the Map reader took the first `<path>` in each edge group, which is the arrowhead marker inside the edge's `<defs>`, so the bundle rule compared arrowheads, not routes (it flagged all 4 ml-harness L0 lines as bundled). It now reads `path.react-flow__edge-path`. The two counted runs after the fix gave byte-identical answers on every repo (determinism check passed).

| repo | questions (L0+L1) | Map correct | Grid correct | b / c | McNemar p | Grid interactions | Grid | Flow Q4 (Map) | Flow p | Flow |
|---|---|---|---|---|---|---|---|---|---|---|
| shopfront | 130 | 81 | 100 | 19 / 0 | 3.8e-6 | 0.63 | win | 22 (20) of 30 | 0.50 | no |
| codeforge | 215 | 131 | 145 | 14 / 0 | 1.2e-4 | 0.81 | win | 15 (15) of 25 | 1.00 | no |
| ml-harness | 70 | 33 | 51 | 18 / 0 | 7.6e-6 | 0.17 | win | 20 (11) of 21 | 0.0039 | win |

Where the difference is: at L0 (first screen, 5-11 boxes) the Map and the Grid tie on every repo. At L1 (all groups open, about 50 boxes, the board fitted at 35-45%) the Map loses its names: far titles shrink to their 9 px floor and then take an ellipsis, so 16 of 17 lines on shopfront, 37 of 45 on codeforge and 6 of 29 on ml-harness join a box whose name a reader cannot read (plus 1, 4 and 4 lines bundled within 3 px). The Grid's row and column labels stay whole. Both views see only the lines the Map draws: file-level imports below 3 per pair are not drawn, so neither answers those (truth L1: 31, 108, 34 pairs; drawn 17, 45, 29).
**Grid kept** (wins 3 of 3, bar 2 of 3): offered in the switcher (Map | Grid on the controls row, Ctrl/Cmd+1..2, the view lives in the URL hash per tab). **Flow discarded** (wins on ml-harness only): left behind `VIEW_ENABLED.flow = false`; `#flow` opens the Map. Boot JS on shopfront, n=3: 2,413 -> 2,416 KB (Base UI Toggle Group loads after the first board; until then the same row is plain buttons). The scorer's pure half has node:test locks (tools/measure/board-views-ab.test.mjs, 4 pass; not in test:ci's tools/ci glob).

## 2026-10-05 · Stream 3b: agents on the board, board fixes, Grid view (kept), Flow (discarded)

Agent mounts: overlay in the board stack, Agents panel docked right (360 px) behind an "Agents" tab-strip button, Ask an agent in the node menu with the composer access; the menu stays open while a run waits on an approval. overlay-live.mjs n=10: 10/10 lit, p95 3 ms, 0 left after fade. Locks fail without their mounts.
Board fixes after the coordinator's review (legibility counter now reports edges shown / edges at this level so hiding lines cannot score):
| case | edges shown / at level | crossings | labels wider than box | under controls |
|---|---|---|---|---|
| shopfront 1440 | 15/15 -> 15/15 | 5 -> 0 | 3 -> 0 | 0 -> 0 |
| codeforge 1440 | 2/15 -> 15/15 | 0 -> 2 | 0 -> 0 | 0 -> 0 |
| codeforge 1024 | 2/15 -> 15/15 | 0 -> 2 | 1 -> 0 | 1 -> 0 |
codeforge's earlier "0 crossings" came from drawing 2 of 15 package lines; now all 15 are drawn with 2 crossings. Expand-all: titles 6 px -> 14 px minimum, cut-off at 1024 8 -> 0, but truncated names up (6 -> 16) and 7 label overlaps at 1024 (was 0). Also: solid lines for scanned edges, dashed only for declared/derived, ELK orthogonal routes, cards sized to names, "Not connected" row, chat 1/3 and board 2/3, content-width tabs, no ARCHITECTURE row, first run with the Sequence mark and last-opened repo first.
Views A/B (registered at 375d3082 before either view existed; task score from the scan's own edges: depends-on, depended-on-by, mutual, path; fixed DOM readers; win = more correct than Map, exact McNemar p < 0.05, interactions within budget, on 2 of 3 repos):
| repo | n | Map | Grid | p | Flow vs Map (paths) | p |
|---|---|---|---|---|---|---|
| shopfront | 130 | 81 | 100 | 3.8e-6 | 22 vs 20 | 0.5 |
| codeforge | 215 | 131 | 145 | 1.2e-4 | 15 vs 15 | 1.0 |
| ml-harness | 70 | 33 | 51 | 7.6e-6 | 20 vs 11 | 0.0039 |
**Grid kept** (3 of 3; the gain is at the all-open level where Map names get cut at far zoom; tie at the first screen). **Flow discarded** (1 of 3), left disabled. Switcher "Map | Grid", Ctrl/Cmd+1..2, view in the hash. Boot JS 2,413 -> 2,416 KB.
Orchestrator gate at f32c1cce: build 0, web2 3413, test:ci 367; first-board isolated n=3: 14 boot calls (was 13; no repeats), boot JS 2,417 KB, board 259 ms. Screenshots: https://claude.ai/artifact/XiHF8fWzUwVfPh6LzJMS51 (round 2). Follow-ups: the file approval card cannot draw Codex's diff format and shows an absolute path; "Database database" label; the extra boot call; the zoom row shows over the Grid.

## 2026-10-05 · Analyzer boot: lazy ACP SDK (kept on the probe; not met on the registered instrument)

Boot stage marks added (SEQUENCE_BOOT_PROFILE=1). Shopfront warm: ~368 ms to the first /api/status 200, of which module loading ~275 ms (Node's loader: compile 68, stat 59, package scope 29; zod 33; our server code 13). Codeforge cold is dominated by the scan (6.4 s). H1 lazy askPipeline: reverted (still loaded via cli.js -> askCli). H3 lazy ACP SDK + zod in AcpClient.start(): boot graph 335 -> 246 files. Registered instrument first-board serverMs (interleaved): medians 712 -> 584 (n=7, B lower 6 of 7) but outliers from other lanes' load make the spread larger than the drop, so **not met by the strict rule**. Same quantity on the in-process probe: 568 -> 471 ms (n=9, spreads 65 / 18); desktop child listening 411 -> 320 (dev) and 390 -> 311 (packaged). **Kept** as a no-regret lazy import, with the instrument switch stated here. Users do not see it yet: the desktop polls health every 150 ms, so main -> server-up stayed 541-548 ms. Next levers: react to the child's "listening" line instead of a fixed poll (care: an earlier poll change moved the first frame), and bundle the server with esbuild (import 295 -> 107 ms measured, not shipped). NODE_COMPILE_CACHE dropped (no win; not in Electron 33's Node 20). Gate at fa2dacc9: build 0, acp 60, analyzer 3197, test:ci 367, desktop-smoke PASS.

## 2026-10-06 · Chat and agents batch (kept): agent runs in chat, approval toasts, Codex diffs, streaming parse

Agent runs from a node or anywhere stream into the chat thread with the node pinned as a context chip; tool, diff, plan and approval cards fold to 32 px headers; a pending approval also raises a persistent bottom-right toast (Allow, Deny, Show in chat), answered in either place. The node menu closes on Ask. Codex change sets (checked with `codex app-server generate-ts`) render as unified diffs with repo-relative paths. Agents panel timeline has a time axis and a row per agent and sub-agent; the tree lost its duplicate header. Composer: "Ask about the code or give an agent a task"; chip "Connect agent". Empty chat shows three starters tied to the board. Streaming: finished markdown pieces are memoised; a recorded 9,066-character reply replayed in 189 chunks: characters parsed 861,834 -> 19,142, render time 824 -> 124 ms (jsdom Profiler), 1 commit per chunk before and after. Fake codex only; no live model. Boot JS 2,420 KB (run cards are a lazy chunk). Gate under the new rules at dd60c193: web2 tsc 0, web2 3446, test:ci 367. Nit: the approval toast sits over the board's zoom row.

## 2026-10-06 · Speed slice part 1 (kept) and board polish (kept, 5.2 KB over the ratchet)

Speed (logic checked first; dev desktop-smoke interleaved n=5): desktop ready on the analyzer's `SEQUENCE_LISTENING` line with the poll as fallback: serverUp 674 -> 534 ms, composerInteractive 925 -> 786 ms, firstPaint 1402 -> 1274 ms (earlier, not later). Server as one esbuild bundle (235 modules, ~1.9 MB CJS) with a V8 code cache (vm.Script cachedData on Electron's Node 20.18; compile cache on 22.1+) and renderer v8CacheOptions bypassHeatCheck: modules loaded 296 -> 183 ms (147 with a warm cache), dev composerInteractive 933 -> 744 ms. New perf ratchet (tools/measure/perf-ratchet.json, checker tools/ci/perf-ratchet.mjs, collector tools/measure/perf-counts.mjs): bootJsBytes, bootModules, bootRequests, commits per keystroke, commits per streamed chunk. Idle audit: 0 requests, 0 rAF, 0 storage writes over 60 s idle; one 60 s rail clock; one duplicate same-value boot write (canvas/ConnectedBoard.tsx writeScratch); no :has() in graphite.css. Packaged n=9 wall clock waits for the static composer.
Board polish: Agents panel takes its width from the chat (board 441 -> 461 px at 1440; rail folds below 1280 px, board 200 -> 299 px at 1024 with no overlap; 55% not reachable at 1024 with a 320 px chat minimum); agent chip 11 px with name and action; boot request /api/agent-events moved after boot (bootRequests 26 -> 25); auto refit waits for ELK's layout (codeforge zoom stable 3/3); Grid cells fill the pane, counts are code links, cell click lists file:line; tests roll into a chip; "Database database" fixed at the source; expand glyph on hover; fit includes line routes; neutral Signed out pill; "Show inside"; toast lifts the zoom row. Legibility: expand-all 1024 label overlaps 10 -> 0, crossings 3 -> 0, truncated 22 -> 13, but 3 cut-off boxes (was 0; the board is taller than the pane at 25%).
Gate at the merged head: build 0, analyzer 3204, web2 3465, test:ci 373. Perf ratchet: FAIL bootJsBytes 2,482,866 vs ceiling 2,477,692 (+5,174 B, the polish); sent back to recover before Diff/Hotspots.
Side effect found: ~/.sequence/last-place.json in the real user store now points at a deleted temp copy of shopfront (written 2026-10-05 21:05 local by an unisolated measurement run, not first-board.mjs). Previous value unknown. All measure tools to use SEQUENCE_USER_DIR.

## 2026-10-06 · Speed slice part 2 (kept): static composer, prefetch, Agents switch below 1280, boot split

Static composer: web2's build prerenders the real V3 shell (jsdom, fresh store, 1440x900, rendered twice and the build fails on any difference) into index.html; a pre-paint script applies stored widths, drops the frame when the stored layout differs, and records typing; V3Chat takes text, caret, focus and a pending Send before paint. Tests: static-vs-React rects within 1 px at 1440x900, 1280x800 and 1024x700 (and with stored widths); keys typed while the bundle is held arrive whole and in order. Also fixed a pre-existing loss: the first session/index at boot cleared words typed before a chat opened. Typeable moves to ready-to-show (dev, n=3: 650-680 -> 575-588 ms). Prefetch: a chat row hovered 80 ms reads its session ahead (click session reads 1 -> 0); the Architecture tab imports the board chunks on hover. Below 1280 px the Agents panel is a Chat | Agents switch in the chat column (board at 1024 299 -> 659 px, 64%); 1280+ unchanged. Boot split: stream reader, fold and codex parsing load with the first run: bootJsBytes 2,486,103 -> 2,477,124, covering the polish's +5,174 B and this batch's +3,237 B; ceiling lowered. Gate at the merged head: build 0, web2 3480, desktop 35, test:ci 377, perf-ratchet PASS. Open: canvas/layout.ts needs `prewarmLayoutWorker`; desktop-smoke runs against the real ~/.sequence by design; Agents empty state shows a raw CLI command. Packaged n=9 waits for a quiet machine.


## 2026-10-05 · Registered before the run: Diff and Hotspots views against the Map

Same frame as the Grid A/B (entry above): a view ships in the switcher only if it beats the Map on a fixed task score on at least two of three repos. Owner rule (2026-10-05): exactly one scored run per view, no reruns, the result reported as it lands. Scorer: tools/measure/board-views-ab.mjs (`--views diff,hotspots`), extended before either view exists. Neither view, nor the two routes they read, exists yet.

Data (two read-only analyzer routes, built for the views and read by the scorer's truth too):
- `GET /api/git/branch-files?base=<ref>`: the files the checked-out branch changes against the merge base with `<ref>`, each with status added, modified, deleted or renamed (`git diff --name-status <merge-base>...HEAD`, renames detected).
- `GET /api/git/churn?days=90`: commits per file in the `days` before the HEAD commit's own date (not today's), so a run is reproducible.

Repos and their history, fixed now (every one a temp clone, nothing written to a real repo):
- codeforge: a local clone of this repository at this branch's tip; base = 85bb6171 (the commit stream 3 started from).
- ml-harness: a local clone of C:/Users/<user>/OneDrive/Documents/GitHub/ml-harness at 33ad045; base = HEAD~30 (first parent).
- shopfront: the fixture has no history, so the scorer builds one, deterministic and written into the scorer: a base commit of the fixture, then 12 commits on a branch with fixed dates (2026-09-01 + n days) that touch orders 5 times, payments 4, gateway 2, inventory 1, adding one file to orders and deleting none. Base = the first commit.

Boxes are the Map's first screen (L0) and the dense level (L1: every group with members opened as in the Grid run), as before. File lifting: a file belongs to the deepest drawn box above it.

Diff questions, generated from the truth (changed files lifted to the drawn boxes):
- D1 "does this branch change X" (yes/no), every drawn box.
- D2 "which boxes does this branch change" (one set question per level).
- D3 "which lines does this branch touch", per changed box X: the set of drawn pairs at X whose scanned evidence lies in a changed file.
Hotspots questions, heat(box) = sum over files under it of pageRank(file) x commits(file, 90 days), pageRank from the scan's own `meta.pageRank` (files without one count 0):
- H1 "which box is riskiest to edit" (argmax heat; ties broken by label).
- H2 "which three boxes are riskiest" (set).
- H3 "is X riskier than Y", for the first 15 pairs (by id) of boxes with heat > 0 and different heat.

Readers (fixed DOM parsers, no model, no graph access):
- Map: the Map draws no change or heat channel. For D1/D2/D3 it answers from what is drawn: nothing is marked changed, so "no" / the empty set. For H1-H3 it uses the visible proxy a reader without heat would use: the box with the most drawn lines (ties by label), and line count for comparisons. Same visibility rules as the Grid run (a box whose name is cut or unpainted cannot be named).
- Diff: a box is marked changed when its rendered row/box carries a visible status word (added, changed or removed) and a painted, uncut name; a line is touched when its rendered row carries the pair's two names and a status. +1 interaction per scroll to reach a row.
- Hotspots: a box's rank is the number painted on it (1 = riskiest); comparisons read the two painted numbers; a box whose number is not painted (heat 0) is "not risky". +1 interaction per scroll.
Correct = equal to the truth exactly.

Win bar, as for Grid: strictly more correct than the Map over both levels pooled, exact two-sided McNemar p < 0.05, mean interactions at most the Map's + 1; ships if it wins on at least 2 of 3 repos. Note in advance: the Map carries no change or heat channel, so on D questions it is right only where the truth is "no"; the A/B therefore mostly checks that the view's encoding is read back correctly, and an H win also has to beat the line-count proxy. A view that does not win stays behind `VIEW_ENABLED` and the discard is logged.


## 2026-10-05 · Diff and Hotspots A/B: both kept (3 of 3 repos each, one scored run)

Run as registered (entry above, committed as 250be562 before either view or route existed; bea6e43e after a rebase onto the overhaul tip, same text). One scored run per repo, no reruns: tools/measure/board-views-ab.mjs --views diff,hotspots at af8cb9ce (082116e4 after the rebase). Setup was checked before the run without scoring (the codeforge clone read through the built route functions: merge base 85bb6171, 201 changed files, 2,739 commits in 90 days). Repos: shopfront with the scripted history (12 commits, 13 files changed incl. one added), codeforge clone at af8cb9ce against 85bb6171, ml-harness clone at 33ad045 against HEAD~30.

| repo | Diff: n, view / Map, b/c, p | Hotspots: n, view / Map, b/c, p | interactions (D / H) |
|---|---|---|---|
| shopfront | 71, 71 / 54, 17/0, 1.5e-5 | 34, 34 / 15, 19/0, 3.8e-6 | 0 / 0.06 |
| codeforge | 85, 85 / 51, 34/0, 1.2e-10 | 34, 34 / 20, 14/0, 1.2e-4 | 0.38 / 0.44 |
| ml-harness | 65, 65 / 51, 14/0, 1.2e-4 | 22, 22 / 16, 6/0, 0.031 | 0.15 / 0 |

Both views answered every question right on every repo; Map was right only where the truth was "no change" (Diff, as noted in advance) or where the line-count proxy happened to match the heat order (Hotspots; ml-harness is the closest, 6 discordant pairs, p 0.031). So the Diff result mostly confirms that its encoding reads back correctly; Hotspots also beat a fair proxy on all three. **Diff kept, Hotspots kept**: the switcher is Map | Grid | Diff | Hotspots (Ctrl/Cmd+1..4); Flow stays disabled. Data in the app: GET /api/git/branch-files?base=<ref> and GET /api/git/churn?days=<n> (analyzer server/gitHistory.ts, read-only). Not drawn: boxes the branch removed (the scan is of the checkout). After the run, two display fixes that do not change the scored rows: the views' top padding clears the two-row controls panel, and a box lists its first 8 changed files with the rest behind one row.

## 2026-10-06 · Board perf, isolation guard, expand-all budget, Diff and Hotspots (kept)

Boot JS 2,477,124 -> 2,469,472 B (node menu, edge popover, More panel body and agent overlay load after the first board); ceiling lowered. tools/measure/lib/isolatedEnv.mjs puts every spawned app in a temp SEQUENCE_USER_DIR and refuses the real ~/.sequence; tools/ci/measure-isolation.test.mjs scans for spawns that bypass it (planted control caught). The real-store overwrite came from board-legibility setting only SEQUENCE_HOME. Expand all opens groups most-connected first while fit stays >= 35% zoom, the rest behind "+N groups": codeforge 1440 48 boxes open, 0 cut off, 0 overlaps; 1024 23 open, 0 cut off, 0 overlaps (locked by board-legibility --expand-all --max-cutoff 0).
Diff and Hotspots, registered before building (bea6e43e), one scored run per repo, read-only routes /api/git/branch-files and /api/git/churn (churn window ends at HEAD's date, reproducible):
| repo | Diff vs Map | p | Hotspots vs line-count ranking | p |
|---|---|---|---|---|
| shopfront | 71/71 vs 54 | 1.5e-5 | 34/34 vs 15 | 3.8e-6 |
| codeforge | 85/85 vs 51 | 1.2e-10 | 34/34 vs 20 | 1.2e-4 |
| ml-harness | 65/65 vs 51 | 1.2e-4 | 22/22 vs 16 | 0.031 |
**Both kept** (3 of 3). Caveats: the Map cannot show a change, so Diff's win mostly proves its marks read back; both views are lists, not marks on the board; Hotspots' bar is PageRank x churn but its label shows only the change count; boxes whose whole module was deleted are not drawn in Diff. Switcher: Map, Grid, Diff, Hotspots (Ctrl/Cmd+1..4). Gate at the merged head: build 0, analyzer 3207, web2 3495, test:ci 380, perf-ratchet PASS. Shots: review page round 3.

## 2026-10-06 · S0 replay harness (kept); real-store writer found

5 live Codex sessions recorded once (codex-cli 0.153.4 app-server, temp shopfront copies; plan usage window 47% -> 52%): edit-with-plan (plan arrives as thread/goal/updated), command approval allowed, file approval denied, a ~20 s silent tool, and a todo attempt (this app-server offered no update_plan, so no live turn/plan/updated; a fixture built from the binary's generated types covers it, labelled not run live). Claude fixtures from the ACP schema (sdk 1.2.1) in claude-agent-acp tool shapes, labelled not run live; claude-agent-acp's own transcripts need a download (asked). Machine strings replaced by placeholders; ids and email redacted. Replay through the real CodexAppServerClient/AcpClient (ManualClock, no sleeps; the 20 s silence replays in < 5 s), the real repo server's run-node stream (golden SSE, identical across 3 regenerations) and web2's run store and cards. A divergence control (answering an approval differently) is reported and stops the replay. The list of notifications the adapter drops today (rate limits, token usage, turn diff, turn plan, goal, output deltas, ...) is pinned so S1/S2 change it on purpose. Found: packages/desktop/src/main.ts read and wrote ~/.sequence/last-place.json directly, ignoring SEQUENCE_USER_DIR: the likely source of the real-store overwrites; fixed, and desktop-smoke now runs on a temp store (--real-store opts out). Orchestrator check: the real last-place.json mtime is unchanged across a smoke run after the fix. Gate at 5296b56d: build 0, acp 79, analyzer 3214, desktop 35, web2 3502, test:ci 380.

## 2026-10-06 · Views-2 (kept): Diff on the Map, Hotspots explained, toolbar strip, one title size per kind; Bastion audit

Hotspots rows read "N changes · centrality c" with a key stating bar = changes x centrality (Web2 2901 changes, 0.02 vs Analyzer 2277, 0.03 now explains the order); bars use the warn token. Diff: token glyphs + ~ -, "connections touched", singular "1 more file"; the list is a left panel and the Map marks changed and added boxes; a module deleted whole is a dashed "removed" ghost (only when a deleted file has a scanned extension). Board toolbar (view switcher, Find, +N groups, More) is a fixed 36 px strip and the board fits below it: under-controls 0 in every run (shopfront and codeforge, plain and expand-all, 1440 and 1024). Title size per kind at far zoom: spread shopfront 1024 services 4.9 px -> 0, codeforge expand-all modules 3.2 px -> 0 (kinds still differ: services 12.3, storage 9.6, topic 9 px). "The agent is working in chat." no longer drawn on the board. Boot JS 2,469,472 -> 2,468,241 B (agent inspector out of boot). Bastion audit: lab/specs/bastion-audit.md + 8 PNGs (public pages read only; premai read only), mismatch table with file:line both sides. Owner questions: typeface (Sequence tokens Inter, its brand book Instrument Sans, Bastion Archivo), light accent (Sequence gold, Bastion blue), dark ground (Sequence #1D1D1C warm grey, Bastion #0b0d12 blue-black). Gate at the merged head: build 0, web2 3515, test:ci 382, perf-ratchet PASS (ceiling 2,468,241).

## 2026-10-06 · S3 undo anything the agent did (kept); one title size for every kind (kept)

Shadow git-dir snapshots under <repo>/.sequence/snapshots/git at each turn start (`git add --all` + `write-tree`, no commit, no ref, GIT_* stripped, core.autocrlf=false and `* -text -filter -ident` so bytes stay exact). Per turn the agent's written paths are recorded (trackSessionWrite before the write). Revert to here restores every path written in that turn or later (paths that did not exist are deleted; files the agent never touched are left alone); Undo revert restores the pre-revert tree; revertHunk applies one hunk in reverse through the shadow dir (a stale header is refused with 409). Design after OpenCode snapshot/revert (MIT notice kept). Replay integration test on a temp shopfront repo with two S0 codex turns: bytes match codex's recorded blobs (CRLF kept); the user's own edit between turns survives every revert; revert, revert further, undo, one hunk, and a new turn after a revert all assert byte for byte. Negative control: the user's HEAD, index hash, refs, stash and staged list unchanged (shown to fail when one file is staged); mutation check (no delete-on-revert) fails the test. Claude hooks: UserPromptSubmit starts a turn; PreToolUse for Edit|Write|MultiEdit is now synchronous so paths are recorded before the write. UI: Rewind panel "Agent turns" with Revert to here and Undo revert; Review "Last turn" from the snapshot with per-hunk Revert; Diff view "Before last turn". Titles: one size for every kind at a zoom (shopfront 1024 services 12.3 / storage 9.6 / topic 9 -> all 12.5; spread 0 at every measured board), two-line word wrap inside 240 px, then a middle ellipsis; full names at far zoom. Boot JS ceiling 2,468,241 -> 2,464,312. Gate at 5b313071: build 0, analyzer 3218, web2 3524, test:ci 382, perf-ratchet PASS. Open: Codex turn start needs three calls from the acp bridge; the board is not marked stale after an agent revert (one line in V3OverlayHost); Review pane still shows git-scope chrome on Last turn; conversation rollback is S1's.

## 2026-10-05 · Registered before the run: map.md replication on a second local model

Question: does map.md at 4k in the prompt beat the current sequence arm on a model from a different family than qwen3.5:4b? This entry is committed before any scored run.
- Model: `granite4.2:3b` (Ollama, digest 40577dc168a3a9ad34e9a1234e0c2570be86097fa75a236d4574ae985705d3c4, granite family, 3.7B, Q4_K_M). Chosen from what is installed; no pull. Protocol check before registering: one question NOT from the sealed set, sequence arm only: it ran 5 bash commands and ended with the {"files": [...]} line.
- Arms: map (the sequence arm plus .sequence/map.md at 4k tokens in the system prompt, `--arm map`) vs sequence (`--arm sequence`). Everything else as in the 2026-10-05 qwen3.5:4b runs: tools/bench/agent-ab/run.mjs with bash-agent.mjs at 42e6d40a, `--agent bash`, num_ctx 32768, no temperature set (Ollama defaults), 15 commands max, repos shopfront / ml-harness / premai.
- Set: tools/bench/agent-ab/sets/arch-questions-v1.json, sha256 cdbd6fa7 (committed blob), n=36.
- Runs: exactly 3 per arm, fixed now, no extension. Interleaved per run: sequence r1, map r1, sequence r2, map r2, sequence r3, map r3, all on one day, under the card lock.
- Primary metric: paired F1 per question, mean of each arm's 3 runs, pooled 3 vs 3 same day; delta = map - sequence; SE = sd(delta)/sqrt(36).
- Win: delta above 2.5 SE.
- Verdict words. Above the bar: "map.md helps on granite4.2:3b (replicated)". Under it: "no evidence on granite4.2:3b"; then map.md still ships as a resource and MCP tool, but is not injected into the local agent's prompt by default.

Amendment before any complete run (2026-10-05, 23:10 local): the first attempt crashed 23 questions into sequence r1 (map r1 had 5 rows) when one granite4.2:3b call returned no response headers within Node fetch's 300 s and the runner threw (`UND_ERR_HEADERS_TIMEOUT`). Those partial rows are discarded, not scored. Harness change, same in both arms: a failed model call ends that question with whatever answer it has (normally none, F1 0) and is recorded as `llmError`. All 6 runs restart from r1 in the registered order; arms, set, run count, metric and bar are unchanged.

## 2026-10-06 · Result: map.md replication on granite4.2:3b (registered 5914eb37; kept)

As registered: granite4.2:3b, bash agent, sealed set cdbd6fa7, n=36, map (map.md at 4k in the prompt) vs sequence, 3 runs per arm interleaved (sequence r1, map r1, ... map r3), one sitting 2026-10-05 23:12 to 2026-10-06 04:52 local, under the card lock. Harness as amended before the restart (f86af526). No pairs added.
| run | sequence F1 | map F1 |
|---|---|---|
| r1 | 0.197 | 0.364 |
| r2 | 0.107 | 0.457 |
| r3 | 0.170 | 0.374 |
Pooled paired 3 vs 3: map 0.398, sequence 0.158, delta +0.240, SE 0.056, 4.26 SE, n=36. **Verdict: map.md helps on granite4.2:3b (replicated).** By repo: shopfront +0.49, ml-harness +0.23, premai 0.00 (one service, no edges; its map is 85 tokens).
Also: 3 of 216 questions ended on a model-call timeout (`llmError`: sequence r1, sequence r2, map r3, one each); 5 answers carried no JSON (sequence 2, map 3). Tokens/question: sequence 23.7k / 28.1k / 27.3k, map 35.8k / 20.5k / 17.8k.
With the qwen3.5:4b result (+0.148, SE 0.057, 2.58 SE, 3 vs 3 same day) this is the second model, from another family, above the 2.5 SE bar.
Raw rows: report/raw/agent-ab-bash-granite-{sequence,map}-r{1,2,3}-2026-10-05.jsonl. Card after `ollama stop granite4.2:3b`: no models loaded, 855 MiB used of 8192.

## 2026-10-06 · S1 agents that don't forget, chat fixes, Ramp Kit approval gate, snapshot hygiene (kept)

Chat: one card per tool call (status turns "needs you", Allow/Deny inside, diff once); the composer chip names the running agent; toasts only while the chat card is out of sight, stacked above elements marked data-toast-avoid. Approval gate after the Ramp Kit: "Allow once Y · Always for <prefix> A · Deny N"; prefix at command arity with shell wrappers unwrapped; rules per chat thread on the server (Codex acceptForSession, ACP allow_always); keys on a focused card or toast or when one approval waits, never in a text field. S1: the agent's thread id is stored per chat (agentThreads on the session index entry; forks do not copy it); reopening resumes (ACP session/resume or session/load with replayed history held back; Codex thread/resume), and the stream reports whether it did; turns report ended, settled and hung, no wall-clock cap; the watchdog ignores usage/rate-limit updates as progress and pauses while a person is asked; failures sorted into sign in / retry / install with "Sign in again" and "Retry" cards; the desktop restarts a crashed server once on the same port (a second crash within 5 min shows the dialog). Proof on replay fixtures under the fake clock (not run live: resume-after-restart, hung-after-start, always-prefix, signed-out): a 20 s silent tool is not a hang; ten idle periods waiting on a person is not a hang (fails without the pause); a hang fires exactly at lastProgress + idleMs. S3 hookup: the Codex bridge calls beginTurn / trackTurnWrites / noteTurnDiff in-process, and a file approval is put to the person only after its paths are tracked; Rewind marks the board stale after an agent revert. Snapshot hygiene: the shadow honours the user's .gitignore and info/exclude (50 MB ignored: 0 blobs, shadow < 512 KiB; failed before the fix for an exclude-only folder); `.sequence/` goes to the user's local .git/info/exclude when not ignored, never to .gitignore; codeforge snapshot cold 3,859 ms, warm median 103 ms over 47 turns (under 300 ms, whole-tree stays); 50 turns kept per chat, gc batched every 10 aged-out turns off the turn path (one gc 3,270 ms), shadow 27.9 MB -> 25.8 MB after 50 turns; user repo object count unchanged. The terminal WS resize test passes on the base and at the head (timing-sensitive under load only). Gate at 8a59c435: build 0, acp 94, analyzer 3234, desktop 36, web2 3542, test:ci 382, perf-ratchet PASS (bootJsBytes 2,464,274). For S2b: the command card header shows the shell wrapper instead of the command; the chip shows the agent without its mode.

## 2026-10-06 · map.md in Sequence's own agent prompt, on by default (kept)

Evidence, scoped to what was measured: a bash agent with map.md (4k) in its prompt beat the same agent without it on the sealed 36-question set (cdbd6fa7), paired, 3 vs 3 same day, on two model families: qwen3.5:4b +0.148 F1 (SE 0.057, 2.58 SE) and granite4.2:3b +0.240 F1 (SE 0.056, 4.26 SE). That is "bash-agent with map.md in the prompt", not a claim about every model or every agent; no new A/B was run for this change.
Change: every ask turn on an attached repository (/api/ask, /api/ask/stream, goal runs) carries `.sequence/map.md` as one `--- ARCHITECTURE MAP ---` section, cut so the section stays within 4,000 tokens (chars/4). Not in design mode, not on a lean product turn, and absent when the repo has no map.md. The server writes map.md on attach and rescan, and on a cache-hit attach when it is missing. Setting: "Include the architecture map in the agent's context", on by default, stored per user in agent-settings.json (GET/PUT /api/agent-settings), switch in Settings > Workspace. The line under it reads "On: map 602 tokens in every question about this project" on shopfront (screenshot at 1440x900; "map 3.9k tokens" on a repo that fills the budget); that number is the server's count of the exact section it sends.
Tests: ask-agent-map.test.ts (prompt carries the section when on and not when off; budget holds on a map that fills it; no map.md falls back cleanly; the reported count equals the sent section). The on/off test fails with the section's render removed. web2 agentMapSetting.test.tsx.

## 2026-10-06 · S5 never miss a turn (kept); one screen capture seen by the model

Notifications (turn ended, approval waiting) through one IPC channel `sequence:attention`; refused while focused; click focuses the chat. Windows: setAppUserModelId at startup equal to the electron-builder appId (dev and packaged, test-locked); badge via setOverlayIcon (setBadgeCount is a no-op on win32); flashFrame stops on focus and resumes on blur while approvals wait. Evidence from an isolated run: Electron 'show', then Windows 'failed' HRESULT -2143420140 (0x803E0114); meaning not verified; likely needs the installed package's Start-menu shortcut (installing needs the owner's yes). Toast not visually confirmed. Keys: one shortcut table drives help and matchers (Cmd/Ctrl+N, Ctrl+Tab, Up recall, Cmd/Ctrl+/ help; Shift+Tab and Y/A/N listed); matcher eager so defaults are prevented on the original event; only the help panel is lazy. Steering: codex turn/steer with an editable per-chat queue; a refused steer queues, never drops. Reject with feedback: Codex steers the reason into the turn (decline has no message field); ACP reject_once plus a queued follow-up. Not-run-live fixtures codex-s5/. Perf ratchet: bootJsBytes 2,464,265 -> 2,469,172 (+4,907) with a `$raised` note; the checker now refuses raises without a note matching from/to/bytes/date (it flagged the earlier bootRequests 25 -> 26, now noted). Production wiring into chat/** and acp is queued for the S2b builder. Gate at 74f597aa: build 0, acp 101, desktop 51, test:ci 391, perf PASS; web2 3599/3600 (KeysHost help test flaky under load, 3/3 alone; sent back). Incident: while looking for the toast, a builder took two captures of the real screen; one (a screen corner showing another app's chat window, no toast) was opened with the Read tool and so went to the model provider within the session; neither was uploaded, published or committed; both deleted. Rule since: no screen capture in any lane.

## 2026-10-06 · S5 follow-ups (kept): toasts blocked by the owner's Windows setting, degrade path

Read-only checks: `certutil -error 0x803E0114` = WPN_E_NOTIFICATION_TYPE_DISABLED ("Settings prevent the notification type from being delivered"); HKCU PushNotifications ToastEnabled = 0, i.e. Windows notifications are off system-wide by the owner's choice (left alone; no install test needed). Degrade: a 'failed' with that HRESULT sets notificationsBlocked; the overlay badge and flashFrame still fire; Settings shows "Windows is blocking Sequence notifications" (cleared by a later 'show'; other failure codes do not set it). Overlay dot moved to the blue accent #6b91ff. Shortcut text left in boot (table 1,666 B, labels 670 B, under the 1 KB threshold). Flaky help test now awaits the lazy chunk's import promise (no time waits). Gate at the merged head: build 0, desktop 54, web2 3602, test:ci 391, perf PASS (bootJsBytes ceiling 2,469,172 -> 2,469,168).

## 2026-10-06 · S4 motion and glass, Match Bastion (kept)

Owner chose "Match Bastion" (Decision 42): Archivo variable woff2 (latin, wght 350-450 confirmed in fvar; @font-face font-weight 350 450), blue accent in both themes, dark ground #0b0d12 with Bastion's own surface steps; the old warm grey stays as data-ground="warm". Thin type: no text above 450 (computed walk 0, style ratchet heavyWeights 0), dark blocks one step lighter (380/430), font-synthesis-weight none. Glass only on small controls (ink 4%/10% fill, 16%/28% rim, blur 12px, saturate 1.2); panes lost blur; the palette and floating surfaces over board text use --float-fill (surface-2 at 97%). Motion: infinite animations 27 -> 8, backdrop-filter uses 28 -> 4; no shimmer anywhere (Decision 43 supersedes 7: a running row has braille and no shimmer). Computed contrast test over the token values (text >= 4.5:1, borders and marks >= 3:1) found and fixed 5 failures. Board: every card reserves two title lines (Decision 48), so heights are equal within a kind (layout-result test at six zooms), far titles never pass their box (legibility matrix 3 repos x 2 themes x 2 widths, 0), far-zoom LOD classes flip once per crossing (600-frame sweep). Empty board: static ASCII ramp at 6% ink. Onboarding: Bastion rhythm. Chat answer at body size; tool rows share the message column. Board extras preload in the first idle period after the first layout. Decisions 42-48 in docs/brand/GRAPHITE-DECISIONS.md. Gate at 00bca75a: build 0, web2 3635, test:ci 395, perf PASS (bootJsBytes 2,469,168 -> 2,438,828, bootRequests 26 -> 23, mono 700 font gone). Shots: review page rounds 4 and 4b. Open: the duplicate "Calling search" header (S2b).

## 2026-10-06 · S2b show what the CLI is doing, S5 wiring (kept; two items partly done)

Done (tests named in the builder's report): CLI plan (Claude ExitPlanMode, codex goal) into PlanApprovalCard with Build/Keep planning; Plan maps to ACP set_mode plan; todo and subagent strip above the composer from ACP plan / turn/plan/updated; model and effort picker from model/list and configOptions, sent on codex turn/start; context ring "N% ctx" from usage and rate limits with Compact (thread/compact/start); CLI slash commands and skills under "Claude / Codex" in /; settled runs of tool calls fold into one row; command labels read as the command, not the shell wrapper; chip "Codex · <mode>" once the agent has run; Agents empty state "Start Claude Code with hooks" (writes per-session hook settings, opens the Terminal); Ramp Kit logic (block cursor while streaming, status strip with Stop, braille and no shimmer on running rows, "Thought for N s" on codex's own clock and on settled own turns via thoughtMs); one place names the active tool; the turn-start snapshot runs alongside the turn (the first Edit waits for it, reads do not; control shows the old path held the prompt 2 s; idle warm-up after open). S5 wiring: steer route (409 no-steer / 400 / 200), Enter steers while running, Tab queues only while a turn runs with text and no popup (table test; default kept otherwise), refused steer queues, queue drains in order, Up recalls, deny with reason (deny first, then the reason steered). Partly done: codex has no plan collaboration mode wired (Plan uses read-only + untrusted for codex); the board does not yet read the strip data (agents/agentActivity.ts exposes it; canvas wiring pending). Ratchet checker: `$raised.at` ISO timestamp must be strictly newer (date-only notes read as midnight). Boot JS 2,438,828 -> 2,443,651 (+4,823, raise noted at 2026-10-06T07:44:25Z). Gate at aab77366: build 0, acp 111, analyzer 3250, desktop 54, web2 3680, test:ci 398, perf PASS. No live model calls (replay fixtures; not-run-live ones labelled).

## 2026-10-06 · S7 chats in their own worktree, server and logic (kept; UI wiring pending)

Worktrees at <data>/wt/<8-hex> (outside the repo, short path; a data dir inside the repo is refused); branch sequence/<slug>-<4-hex>; base commit and branch recorded on the session index entry (forks do not copy it). Diff and changes against the base, uncommitted work included, without staging. Dry run via `git merge-tree --write-tree --name-only` (git >= 2.38; older git falls back to a throwaway detached worktree; both give the same conflict list), with uncommitted worktree edits folded in through a temporary index, changing nothing. Merge refused in one line while the main checkout is dirty (.sequence/ ignored) or on conflicts (files listed, no MERGE_HEAD left); on Merge, worktree edits are committed on its branch as the repo identity with no trailers, then --no-ff or squash; failures aborted or reset safely. Removal: `git worktree remove` without --force; `git branch -d`, -D only when the confirm lists every unmerged commit; paths Sequence did not create are refused. Setup command off by default, suggested from the lockfile, never run (test proves no file and no node_modules appear). Cap a setting, 1-64, default 8. Agent runs in a bound chat use the worktree as cwd and S3 snapshot root (own shadow dir); a missing worktree refuses the turn (409) instead of running in main. Proof through the real server: a replayed codex session and a fake codex writing hello.txt change only the worktree (main HEAD, index and status byte-identical); merge lands it; a conflicting second chat stops with 409 listing the file; deleting unmerged work is refused; controls show the unbound path writes main. 19 temp-repo tests, 10 web model tests. Gate at the merged head: build 0, analyzer 3269, web2 3690, test:ci, perf PASS (no boot bytes added). Pending: rail toggle, header chip, merge panel, Agents grouping, settings fields (S2b builder); Diff view and board reading the worktree path (views builder). Note: a worktree's snapshot history goes with it when removed.

## 2026-10-06 · Canvas batch (kept): board reuses the agent strip, Diff for worktree chats, worktree removal rules

Board: the chip on a touched box says the chat agent's doing line ("Main agent · Writing · main.py"); a board status line shows agent, doing and the todo count while it runs (unit test; the replay's plan did not produce todo items, so no count in the shot). Diff view of a chat bound to an unmerged worktree reads /worktree/changes against the recorded base, header "Worktree <branch> against <base7>"; unbound and merged chats unchanged (controls). Worktree removal (coordinator ruling): the shadow git dir goes with the tree (temp-repo test: none left under <data>; the post-remove cleanup runs only after `git worktree remove` succeeded, inside the checked Sequence path, on .sequence leftovers); the chat keeps its transcript and a removedAt record, its next turn runs in main; Rewind shows Revert off with "Worktree removed"; every remove-confirm ends "This also removes its Rewind history." ReviewPane 5.4 flake fixed by awaiting the lazy turns client. Boot JS +38 B (agentActivity's chunk name in the composer's preload list; no code in boot), raise noted; a re-export from chat/agentComposer.tsx would remove it (queued to the composer lane). Orchestrator reviewed the diff (safety classifier had timed out during this builder's run). Gate at b591de41: build 0, web2 3698, test:ci, perf PASS (2,443,689); analyzer 3270/3271: turn-snapshots "revert to a turn…" failed under full-suite load with "git add failed: exit 1" (3/3 alone). A snapshot failing under load would lose undo for that turn; root cause sent back.

## 2026-10-06 · Snapshot hardening under load (kept); root cause not reproduced

The "git add failed: exit 1" did not reproduce (72 runs of the snapshot files at 12 in parallel, 5 full analyzer suites). Its message carried git's stderr already, so it was exit 1 with empty stderr, which fits neither suspect (a held index.lock exits 128 with a message; a held work-tree file exits 1 naming the file). Both suspects are now handled and the next failure will name its cause: gitFailure() reports command, exit or signal, stderr and stdout. The per-repo queue is now keyed by the shadow dir's real path (case-folded on Windows), so two spellings of one root share a queue; index.lock gets a bounded retry (50-800 ms), then a lock older than 60 s is removed; a git killed on timeout has its lock removed. `git add -A --ignore-errors` saves partial undo points that name the files git could not read (Rewind: "Undo point skipped N files…"; revert leaves them alone); "No undo point for this turn" only when write-tree fails (revert, files and diff refuse it with git's reason). Tests: 6 overlapping calls through two spellings of the root, planted lock that clears, stale lock, a file held open with share mode None (point saved partial, revert leaves it alone, undo works). Gate at 42b654d3: build 0, analyzer 3277, web2 3700, test:ci, perf PASS. Recurring and unrelated: terminal.test "WS accepts resize control" fails occasionally under load with node-pty "AttachConsole failed".

## 2026-10-06 · S2a measurements: board MCP tool cost, codex plan mode, MCP approvals (builder's record)

Tool-listing cost of Sequence's MCP server as an agent receives it (tools/list JSON, chars/4 as agentMap.ts counts; script scratchpad mcp-tokens.mjs, packages/mcp built at the S2a head): all 16 tools 4,076 tokens (3,844 before the readOnlyHint/openWorldHint annotations); largest who_calls 504. Over the ~1.5k line, so a session Sequence starts gets the core four (SEQUENCE_MCP_TOOLS=core): map 247, who_calls 504 (neighbours; it also finds a node by name), impact 192, architecture_changed 254 (the diff) = 1,197. The other twelve sit behind the "all board tools" agent setting (agent-settings.json allBoardTools, off by default). Test-locked: packages/mcp s2a-session.test.ts asserts core <= 1,500.
Codex plan mode, from codex-cli 0.153.4's own bindings (`codex app-server generate-ts`, plain and `--experimental`): the plain output has no collaborationMode/list and no TurnStartParams.collaborationMode (CollaborationMode appears only inside ThreadSettings); `--experimental` adds ClientRequest "collaborationMode/list" (CollaborationModeListResponse { data: CollaborationModeMask[] }) and TurnStartParams.collaborationMode?: { mode: ModeKind ('plan' | 'default'), settings: { model, reasoning_effort, developer_instructions } } ("Takes precedence over model, reasoning_effort, and developer instructions"), gated on InitializeCapabilities.experimentalApi; plan output streams as item/plan/delta and a ThreadItem { type: 'plan', text }. Decision: Plan sends collaborationMode plan on turn/start (initialize opts into experimentalApi; the model comes from thread/start's response), keeps the read-only sandbox and untrusted policy as the fallback, and the plan item becomes the CLI plan (plan_update). Not run live: fixture codex-s2a/plan-mode.
MCP approvals: Claude gets mcp__sequence__* allowed (ACP _meta.claudeCode.options.allowedTools; the Agents panel's Claude through the per-session --settings permissions.allow). Codex: its ServerRequest has no MCP-tool approval request (only command, file and permissions approvals, item/tool/requestUserInput and mcpServer/elicitation/request); ThreadItem mcpToolCall carries readOnlyHint, and Sequence's tools now set it. If codex gates MCP calls in Ask through mcpServer/elicitation/request, Sequence's client refuses elicitations today and such a call would be declined: not observed (no live run), noted, not worked around.

## 2026-10-06 · S2a follow-ups: board in the installed app, freshness, elicitation, experimental probe, per-chat images, run-node in the tree (builder's record)

Experimental API: "plan mode via codex --experimental collaborationMode" depends on an experimental app-server API (InitializeCapabilities.experimentalApi, collaborationMode/list, TurnStartParams.collaborationMode). Read-only is the fallback. The first Plan turn probes collaborationMode/list once per installed codex (command plus args, cached in-process). A codex that does not answer it is not opted in again, and a turn/start that refuses collaborationMode is retried once without it. Either way the turn runs with the read-only sandbox and the untrusted policy. Not run live: fixtures codex-s2a/plan-mode, plan-mode-unsupported, plan-mode-refused-turn.
Elicitation (supersedes the line above): mcpServer/elicitation/request is accepted only for the server named "sequence", and only when Sequence put that server on the thread. Any other server's elicitation is declined, not shown as a card, because no approval-card path exists for it yet. Not run live: codex-s2a/board-elicitation.
Board server in the installed app: an esbuild bundle at analyzer/dist/sequence-mcp.cjs, written by prepare-server and booted there from the copied-out shape under Electron's Node (tools listed, map answered). Freshness: every board tool answer says "graph at <sha7>, N min old"; a Sequence worktree with no graph of its own reads the base checkout's graph and says so; nothing is analyzed on spawn. A turn's images live with their chat (.sequence/sessions/<id>/attachments) and are deleted with the chat.
Run-node turns feed the Agents tree: tool_call and tool_call_update become AgentEvents (session_start, tool_start, tool_end, stop) under the chat id in the hook store, with paths relative to the turn's checkout, so a worktree-bound chat groups its runs. CLI `sequence program run --repo <dir>` runs agent nodes in that repo (or worktree) with the board. Without --repo nothing is guessed (no board, the agent's own cwd). The app's program runs already had the repo.

## 2026-10-06 · S2a the agent sees the board, S7 UI wiring (kept)

Board MCP server injected per session without touching user config: Claude via ACP mcpServers (new, resume, load) and a per-session --mcp-config for hook-launched Claude; Codex via a per-thread mcp_servers.sequence override on thread/start and resume; entry packages/mcp/dist/server.js (index.js never connects a transport). The server reads the persisted graph (no analysis on spawn; a spawned server creates no .sequence and does not rewrite graph.json); every answer carries "graph at <sha7>, N min old", and a worktree with no graph answers from the base checkout's graph and says so. Context cost: 16 tools 4,076 tokens; the core four (map, who_calls, impact, architecture_changed) 1,197 (test holds <= 1,500), the rest behind an off-by-default setting. readOnlyHint on every read tool; Claude allows mcp__sequence__*. Codex elicitation is auto-accepted only for the "sequence" server Sequence put on the thread; others declined (no approval-card path yet). Packaged app: esbuild bundle analyzer/dist/sequence-mcp.cjs shipped by prepare-server; its isolation boot under Electron's Node listed the tools and answered map. Images: Claude image block only when initialize reports image support (else resource_link), Codex localImage pointing at the stored file, long edge capped at 1568 px, server checks header type, 5 MB and edge; stored under .sequence/sessions/<id>/attachments (deleted with the chat; other chats cannot read them). @-mentions: Claude embedded resource when embeddedContext is reported (else resource_link plus text), Codex text inline, node slice at the 1k map budget, files as resource_link with absolute paths (outside-repo refused). Codex plan mode: uses the experimental API (experimentalApi on initialize, collaborationMode plan on turn/start), probed once per installed codex; unsupported or refused falls back to the read-only plan. This depends on an experimental API. run-node turns feed the Agents tree (session_start, tool_start, tool_end, stop keyed by the chat id), so worktree grouping shows; `sequence program run --repo <dir>` gives program agents the board. S7 UI: rail "In a worktree" toggle, header chip, merge-back panel (dry run first; conflicts and dirty main block merge; discard of unmerged work needs the dialog), Agents tree grouped by worktree, settings for the cap and the setup command. Boot JS 2,443,689 -> 2,450,013 (+6,516 for S2a and S7 UI, then -281, then +89), raise notes timestamped. No live model calls (not-run-live fixtures). Orchestrator gate at d4566151: build 0, acp 123, mcp 73, analyzer 3294 (clean), desktop 54, web2 3717, test:ci, perf PASS. The builder's own analyzer runs had load failures (0xC0000142, git init exit 1) while two lanes ran suites at once; every failing file passed alone.

## 2026-10-06 · S6 server half and the terminal flake (kept)

Terminal flake root cause: killed Git Bash shells leaked grandchildren that held cygwin console slots (max 128) until reboot, so later spawns died "too many consoles in use". node-pty's Windows kill closes the console before its list agent attaches, then kills only the shell pid. Fix: taskkill /PID <root> /T /F before closing, then one sweep about 300 ms later of children of the killed pids that were created since spawn and whose parent is dead. Never by image name. Resize waits for first output and keeps the latest size; resize, write and kill after exit are safe. Load loop (40 runs x 8 parallel + 8 CPU burners): before, 35/40 pass and about 70 orphans; after, 39/40 (one runner-level spawn EPERM) and 2 orphans (being identified). Locking tests: a detached grandchild dies with its terminal, and post-exit calls do not throw; both fail before the fix. Snapshot: stale-lock cleanup removes only the shadow lock; the user's .git/index.lock keeps bytes and mtime (negative control fails as it should). S6 server: text deltas of one kind merge within 50 ms; every non-text event flushes the pending text first, and approvals, errors and turn end bypass the window; order unchanged. Recorded codex fixtures, ManualClock, n=1 deterministic: todo-plan text frames 168 -> 37 (peak/s 48 -> 8), all frames 190 -> 59; edit-with-plan text 169 -> 62 (peak/s 47 -> 16), all frames 197 -> 90. 5x target dropped (not pre-registered; these recordings stream 3 to 6 deltas/s, ceiling about 4.2x): end to end is measured as React commits per chunk in the web half, plus a synthetic 60 deltas/s fixture. Tool-call strings over 8 KB are cut with capped[{at,id,bytes,shownBytes}], the full body written under .sequence/sessions/<chat>/stream-bodies and fetched by GET /api/stream-body (session-gated, owner-only); approvals, proposals and results are never cut. Orchestrator gate at b0241063: build 0, analyzer 3308/3308, test:ci 0, perf PASS (bootJsBytes 2,450,013 unchanged).

## 2026-10-06 · S6 web: long chats stay smooth (builder's record)

Once per frame: run-node and ask stream events wait in a queue that is applied in one store update per animation frame (web2 state/frameQueue.ts; store.dispatchMany, the run store's batch). An approval, an error and the turn's end go at once, after what was queued before them. While document.hidden the queue drains every 250 ms instead (fake-clock test: no burst on return).
Virtualized: past 60 rows the transcript is drawn by @legendapp/list 3.6.0 (MIT). It loads lazily in the VirtualTranscript chunk (141.7 kB, not requested by the first board). A run is a head row, one row per item group and a foot row; keys are stable, and open cards keep their state by run and card id. It stays at the end only within 40 px. A reader who scrolled up is never moved and gets a "Jump to latest" button. Only the reader moving up leaves the end: a resize's own scroll event had unpinned the chat at 1024 px, which the shots caught.
Show all: a body the server cut (capped[]) gets "Show all (N KB)". It fetches GET /api/stream-body?id=&chat=, puts the string back at capped.at and folds it again. The opened row keeps its top on screen (anchored on the row). A command output's marker is kept with the turn in chat memory. The /api/stream-body GAP row is gone from the reachability baseline. An approval card scrolled out of the virtualized list still raises its toast, and "Show in chat" asks the list to bring the row in.
Measured on replayed todo-plan and edit-with-plan (not run live; the server's frames recorded before and after its 50 ms merge by tools/measure/s6-stream-frames.mjs, replayed by web2 chat/s6Commits.test.tsx at 60 frames a second on the replay clock). todo-plan: commits 190 -> 59 (server merge) -> 48 (merge plus per-frame apply), 6.07 -> 1.53 commits/s mean (3.96x), peak second 48 -> 8 (6.0x). edit-with-plan: 151 -> 74 -> 62, 2.61 -> 1.07/s (2.44x), peak 29 -> 10 (2.9x). The 5x mean is not reached: these recordings stream 3 to 6 deltas a second, so a frame rarely holds more than one event. The peak second reaches 6x on todo-plan. DOM: 2,000-row transcript 2,002 nodes plain -> 80 virtualized (25 rows drawn); in the built app a 300-turn chat drew 15 rows. commitsPerStreamChunk stays 1, and proseStreaming is unchanged.
Known limit: Ctrl+F (Electron findInPage) cannot see rows the virtualized list has not drawn. Sequence has no chat search, so none was built; a long chat's off-screen rows are not found by the browser's find.
Boot JS 2,450,013 -> 2,454,822 (+4,809, raise noted): the boot chat path (transcript switch, stick to bottom, frame queue, the reveal seam). The list is not in boot.

## 2026-10-06 · Terminal follow-up: node-pty's delayed pid kill, sweep scope, synthetic fast stream (kept)

node-pty's Windows kill forks conpty_console_list_agent, which always dies here with "AttachConsole failed". Its fallback 5 s later is process.kill(shellPid). That pid was logged 5.01 s after the shell was dead, when it can belong to anything; stock node-pty does this too. Under 40 runs at 8 parallel with 8 CPU burners, test runners died silently in 7 of 40 runs before the fix and 0 of 40 after, and a process poller saw none of 522 kills hit a non-terminal process. The fix is in Sequence's source (ptyShell.ts disarmConsoleListKill): once our taskkill /T tree kill has run, that terminal's agent gets an empty process list. It relies on a node-pty internal (_agent._getConsoleProcessList); the control test (node-pty's own kill lists the console, ours never does) fails if an upgrade renames it. No dependency patch. Sweep scope is the pure sweepTargets: the parent pid was reported by taskkill, that parent is dead now, the process is not a killed pid, and it was created during the kill. Removing any one of the five rules fails a test; processes outside the tree and a live holder of a reused pid survive. Not covered (written in the code): a process created during the kill whose unrelated parent died and whose pid one of our tree processes reused, all within about a second. A pty that never becomes ready (shell died at start, 0xC0000142) is now closed directly; one run had hung for 35 minutes. The test's own process.kill on a possibly reused pid now checks a command-line marker first. Commit cf148b4d's message credits that test fix with the silent deaths; node-pty's delayed kill was the main cause (ffb0d883). Known limit: 2 headless `conhost.exe --width 80 --height 24` orphans in about 480 ptys under that heavy loop, cause not found. To spot them, look for conhost with those args and no live parent. That rate will not exhaust console slots in normal use. Synthetic fast stream (fast-stream-synthetic, live:false, built from codex/todo-plan at 60 deltas/s), ManualClock, identical over 3 runs: frames 1282 -> 452, mean writes/s 48.8 -> 17.2, peak 62 -> 25; text frames 1260 -> 430. The test asserts identical text and order, fewer frames, and at most one text frame per 50 ms plus one per interruption; no ratio. Builder gate at e0d890fc: build 0, analyzer 3315/3315, test:ci 0, perf PASS. No upstream report was posted.

## 2026-10-06 · Final gate: full suite, node-pty pin (kept)

Full suite once at 5e445b85, one package after another: install 0, build 0, schema 491, acp 123, mcp 73, analyzer 3315, desktop 54, web2 3734 (7,790 tests, 0 failures), test:ci 0, perf PASS (bootJsBytes 2,455,057). node-pty pinned to 1.1.0 at c010a6f1, because disarmConsoleListKill reaches into a node-pty internal and an upgrade must be a deliberate change. The pointer comment is beside the function; pty-shell.test fails when the spec is not an exact version (negative control with ^1.1.0 fails). The lockfile changes one specifier line, edited by hand: a plain `pnpm install` here dropped the `site` importer (1,221 lines). Frozen install 0. Gate: build 0, analyzer 3316/3316, test:ci 0. The first analyzer run of that gate went silent about a minute in and was killed at the one-hour limit; the log ends on a passing test and names no file. The rerun passed in normal time. Not reproduced; watch for it.

## 2026-10-06 · Final gate: packaged build and smoke (kept)

Built from a short-path worktree (C:\sqg, detached at c010a6f1; makensis hits MAX_PATH in the long worktree path): frozen install 0, build 0, desktop dist 0. Sequence Setup 0.1.3.exe 90,000,213 B (107,400,071 at the start of the program), zip 119,587,338 B (143,862,477). `desktop-smoke --packaged` PASS, one launch (not the n=9 wall clock): main 124 ms, server up 389, ready-to-show 733, composer interactive 826, first paint 1313. Packaged node-pty check: node-pty 1.1.0 is shipped; the shipped server (dist/server/ptyShell.js and the bundled sequence-server.cjs) carries disarmConsoleListKill; and the shipped node-pty lib/windowsPtyAgent.js still defines _getConsoleProcessList. Packaged board MCP: resources/.../dist/sequence-mcp.cjs (1,722,944 B) runs under the packaged Electron with ELECTRON_RUN_AS_NODE, isolated SEQUENCE_USER_DIR, on a clean shopfront copy. initialize ok, tools/list 16 (the standalone server lists all of them; Sequence's per-session injection is what limits it to the core four), and map answered 8 services and 26 edges. Observation: on a repo with no persisted graph, the first map call scanned it and wrote <repo>/.sequence. Spawning does not scan (checked earlier), but a call on a never-scanned repo does.

## 2026-10-06 · Codex live gate: one real turn per access mode (measured, no code changed)

Four real codex-cli 0.153.4 turns (gpt-5.6-terra) went through `POST /api/acp/run-node?stream=1` with web2's body (`interactivePermissions`, `chatId`, `sessionKey`) against a scratch copy of shopfront. The server ran at c010a6f1 with an isolated SEQUENCE_USER_DIR, after the startup scan. A stdio tee in front of codex logged the app-server wire. Every approval was answered deny. One turn per mode, no retries. Ask (on-request, read-only): 2 approvals, an edit with its diff and then an Add-Content command, both declined; the repo was unchanged. Auto-edit (workspace-write): 0 approvals, README +1. Full access (never, danger-full-access, after the one-time consent; 409 without it): 0 server requests of any kind, notes/full.txt created. Plan: codex's experimental plan mode was used (collaborationMode/list offered plan, and turn/start carried collaborationMode plan); the plan came as a plan_update and the repo was unchanged. Not exercised: the model never called the `sequence` board tool (it used the user's computer-use plugin and read .sequence/map.md), so no mcpServer/elicitation/request was seen. Reported, not fixed: Plan's `untrusted` policy puts every read command to the person; codex plan mode's item/tool/requestUserInput is refused with -32601; the user's codex plugins (cua_repl, node_repl) run in Sequence turns, and in Ask and Plan the agent called cua.getState() without approval. Claude was untested live (signed out). Full record: lab/codex-live-gate.md.

## 2026-10-06 · Codex live gate follow-up: who_calls in Ask, MCP servers on the thread, processes at quit (measured)

Fresh scratch store, shopfront copy, wire tee and server (gate/codex-elicit from 5770cfa0). In Ask, the model called `sequence.who_calls` on the first try (no retry). The result was orders called by gateway ×2 [http], calling payments, inventory, order.created and postgres, at "graph at 72b2394". No mcpServer/elicitation/request appeared, and no server request of any kind: codex ran the read-only tool without asking, so the client's accept-only-for-"sequence" branch is still unexercised live. Servers on the thread: sequence (Sequence's thread/start override); node_repl, cua_repl and codex_apps (the user's codex install, not Sequence). Quit, reproduced as desktop does it (`killChild` sends SIGTERM to the server pid only, which is TerminateProcess on Windows; the analyzer has no SIGTERM handler): after 10 s, 0 of 2 codex app-server pids and 0 of 5 plugin/MCP children survived (pid plus creation-time match). Not covered: the computer-use sandbox chain (codex.exe sandbox → command-runner → cua_node), because this turn made no cua call. Correction: the first gate's node_repl trees were inside the server tree (codex.exe → intermediate → node_repl), not re-parented. Record: lab/codex-live-gate.md.

## 2026-10-06 · Quit ends the server's whole tree, by pid (kept)

Desktop stop() (what before-quit calls) sent SIGTERM to the server pid only; on Windows that is TerminateProcess on one pid. Measured with a stand-in server -> child -> DETACHED grandchild (stdio ignored, sleeping): on the old code stop() returned in 6 ms, the non-detached child died with the server (libuv's job object, which is also why the live codex tree died), and the detached grandchild survived. Fix (packages/desktop/src/tree-kill.ts, server-control.ts killChild): on Windows `taskkill /PID <server> /T /F` at once, while the server is alive, the same call as the analyzer's killWindowsTree; never by image name. No graceful SIGTERM first on Windows: it is TerminateProcess on the root alone and would orphan the tree before the walk. Not imported from the analyzer: desktop compiles its own src to CommonJS and ships only dist in the asar; the analyzer reaches the packaged app as a separate ESM server bundle. killWindowsTree's post-kill sweep is not carried over (its listing took a median 9.5 s; the quit budget is 3 s). Elsewhere: SIGTERM, then SIGKILL at 3 s, to the process group if the child was spawned detached (it is not today, so behaviour there is unchanged). Quit never waits past 3 s. Locking test quit-tree-kill.test (pid plus creation time; a bystander the test started must survive): fails before (survivors ['grandchild 25796']), passes after, 3 of 3 runs. Gate at 8d640294: build 0, desktop 55/55, test:ci 398/398, desktop-smoke (dev) PASS, perf PASS (bootJsBytes 2,455,057). Not run: the packaged smoke, and a live quit with a codex turn that called cua.getState().

## 2026-10-06 · Board MCP first scan: info/exclude and "scanned just now" (kept)

Follow-up to the packaged-smoke observation above. A board tool call on a repo with no persisted graph still scans it; now, when that scan created `<repo>/.sequence`, the server adds `.sequence/` to the repo's LOCAL `.git/info/exclude` through the S3 snapshot helper (`ensureSequenceIgnored`, now exported from the analyzer index), once and never to .gitignore, and that answer's freshness line reads "scanned just now (N s)" (the tool call's wall time, which is the scan plus the query, to one decimal) instead of "graph at <sha7>, N min old". mcp `first-scan.test.ts`, temp git repo with one commit and an isolated SEQUENCE_USER_DIR, real stdio server: before the fix `git status --porcelain` printed `?? .sequence/`; after it, empty, one `.sequence/` line after two calls, and the second call (graph persisted) says "graph at <sha7>, …". A repo whose graph exists keeps the old line and its exclude file is byte-identical. The `sequence://map` resource is not a tool call and is unchanged.

## 2026-10-06 · Plan reads without cards, and codex's clarifying question in the chat (kept)

Two findings from the codex live gate, fixed on feat/plan-question (base overhaul 5770cfa0). Replay only: no live model calls.
Plan: codex now gets on-request + read-only, the same as Ask, plus collaborationMode plan where codex offers it. It was untrusted, which put every harmless read in front of the person. Without plan mode, Plan is the same dials minus collaborationMode. The server's plan decision is unchanged: an escalation that codex asks for (a write, or a command the sandbox blocks) is still a card on an interactive stream and is denied without one. Reads in the read-only sandbox never reach it. The mode table test is keyed by AgentMode and walks AGENT_MODES. The fake codex (fake-codex-app-server) now models the read before the write that the live run showed: untrusted asks before Get-ChildItem, on-request runs it. Locking test (server): a Plan read raises no card, and the write is asked and does not land on Deny. Fail before: the read was declined ('failed'). acp 5 tests failed before, analyzer 2.
Question: item/tool/requestUserInput now goes to the caller's onQuestion. The answer goes back as ToolRequestUserInputResponse { answers: { id: { answers: [..] } } }, shaped from codex-cli 0.153.4's generate-ts types. Cancel, the turn ending (turn/completed), a Stop, teardown, or no onQuestion all answer { answers: {} }, never -32601. A request that codex reports resolved (serverRequest/resolved) is not answered again. The server relays it as acp:question { pending, requestId, questions } and waits for POST /api/acp/question { answers } | { cancel: true } with the idle watchdog paused. The settling event names who settled it: person, cancel, timeout, disconnect or ended. web2 draws a card in the approval gate's frame: options with number keys, a free-text field where isOther, Send (Y) and Cancel (N). It folds to one row when settled. The S5 watcher notifies "Codex has a question" while hidden and counts it on the badge. Fixtures codex-question/plan-question and plan-question-turn-ended are built around the request frame recorded live in the gate's Plan turn (verbatim, checked byte for byte against the wire log, sha256 bfa282ec). The header says live:false and names the frame in liveRecorded. The replay now also checks a question's answers. Fail before: adapter 5/6 (the sixth tests the new pure response builder), relay 6/7 (the no-opt-in case already passed, because the adapter answers with none), card 8/8.
Gate at 0f92cb45 (one after another, logs kept): build 0; acp 133/133; analyzer 3325/3326. The one failure is pty-shell.test.js: it went silent with a `node -e setInterval` child and was killed after about 30 min (the same hang as the earlier final gate). Alone at head it passed 11/11; this branch does not touch ptyShell. web2 363/363 files; test:ci 398/398 after naming /api/acp/question in the served-route inventory. Perf: bootJsBytes 2,455,057 -> 2,455,098 (+41, raise noted): the boot preload map now names the card's lazy CSS chunk. The card itself is not in boot. Screenshot: built app, replayed turn, dark 1440x900, scratchpad review/s5-question-card.png. Open (owner): whether Plan should refuse write escalations outright instead of asking.

## 2026-10-06 · pty-shell.test hang: lingering pty, not a blocked event loop (kept)

The suite hang in pty-shell.test ("our close never asks node-pty to list and kill") reproduced at 0dfc9a2e: 7 of 24 runs never exited with 8 files in parallel on 8 busy cores, 0 of 20 at 4 parallel unloaded. Every test had passed. An inspector attached to the hung test processes answered (event loop alive, CPU flat), with 6 pty sockets open and the control's `node -e setInterval` child alive. The cause is the control itself: with the console list stubbed to [], node-pty's own kill ends nothing it does not have to, and node-pty still emits 'exit' when the output socket closes, so the bounded cleanup thought the child had exited and skipped it; its open pty kept the process alive. The control and ours now run in a child process (support/ptyListControl.ts) that the test tree-kills by a pid it holds a handle to, with a 60 s limit: it can fail, never hang. Our close path does not block the event loop: a flood of unread output closed through our path (support/ptyCloseStall.ts, now a test with the same child-process harness), a grandchild attached to the console but outside the tree, and node-pty's raw kill all closed with a worst stall of 59 ms over 48 loaded runs; no product change. Loops after: 24/24 loaded, 20/20 at 4 parallel (wall 75.8 s). 22 orphaned headless 80x24 conhosts on the machine: 8 predate this lane's session (2026-10-05 18:04 to 2026-10-06 04:15), 14 fall inside its 05:29 to 06:11 experiments (one matches a logged spawn to the millisecond); reported, none killed.

## 2026-10-06 · Clarifying-question card, live: codex did not ask through the tool (measured)

One Plan turn at 0dfc9a2e (fresh store, shopfront copy and server; interactive; one attempt). The prompt told codex to ask about the limit strategy and the counter store before planning. Plan mode was in effect (on-request + readOnly, collaborationMode plan accepted). Codex asked in plain text as its final answer ("Which rate-limit strategy and counter store should the plan target?") and ended the turn. The wire had 0 item/tool/requestUserInput and the stream 0 acp:question, so nothing was posted to /api/acp/question and the card is still unverified live. There was no plan item, 0 approvals, no commands, and the repo was unchanged. At SIGTERM quit, 0 of 8 recorded pids survived. Record: lab/codex-live-gate.md.

Plan's ask-through-the-tool line: Sequence sent no developer instructions before; collaborationMode carried developer_instructions null, which means codex's built-in plan text. A non-null value there may replace that text, which nothing documents, so it was left alone. Plan now sets ThreadStartParams/ThreadResumeParams developerInstructions to one line: when you need a decision from the person, ask with the request_user_input tool, giving 2 to 4 options, instead of asking in plain text. Other modes send none (test over AGENT_MODES, start and resume); the user's codex config is untouched. Limit: the line is fixed when the thread is opened or resumed. A cached chat thread that switches into Plan mid-session does not get it until it is resumed, and one that leaves Plan keeps it. Note: the gate's recorded Plan turn did call requestUserInput; the plain-text ask was the coordinator's later live run, not seen here.
Boot JS for the follow-up: 2,455,098 -> 2,455,107 (+9, raise noted). The boot chunk now exports HOLD_EVENT for the lazy reveal. The toast reuses the approval card selector by card id, so the boot-path selector is unchanged.

## 2026-10-06 · Clarifying-question card live with developerInstructions: the relay works; the plan was cut off by the codex quota (measured)

One Plan turn at d2ad0729 (new chat, fresh store, shopfront copy and server; interactive; one attempt). `thread/start` carried the developerInstructions line asking codex to use request_user_input. Codex asked through `item/tool/requestUserInput` with two questions (limit_strategy: Per API key / Per user / Per IP; counter_store: Redis / In-memory / Database). Sequence relayed them as `acp:question`. I answered with the first options via POST /api/acp/question (200). The client returned `{answers: {limit_strategy: {answers: ["Per API key (Recommended)"]}, counter_store: {answers: ["Redis (Recommended)"]}}}` and codex resolved the request. One second later the turn failed with codex usageLimitExceeded (the account's quota, reset Oct 12th 2026), so no plan was produced and whether the plan follows the answer is unmeasured. The stream showed acp:error with recovery `retry`. 0 approvals, repo unchanged, 0 codex pids at SIGTERM quit (the failed turn had already disposed its client). Record: lab/codex-live-gate.md.

## 2026-10-06 · A spent Codex usage limit says wait until the reset, not Retry (kept)

Found in the gate4 live run. A `usageLimitExceeded` turn came back with recovery `retry`, but a retry could only fail the same way until the quota reset 6 days later. Now `recoveryOf` (acp recovery.ts) returns `{kind: 'wait', resetsAt}` in two cases. The first is any codex `usageLimitExceeded` (string or object CodexErrorInfo), which is a wait even with no time. The second is a rate, usage or quota error that names its reset. The adapter keeps the account/rateLimits/updated windows and gives a usage-limit failure the reset of the fullest window (epoch s to ms). Otherwise the time is parsed from codex's message ("try again at Oct 12th, 2026 4:36 PM", local time). Transient errors still retry: rateLimitExceeded "slow down", 429 with no time, a dead process, a hung turn. The server sends `recovery {kind: 'wait', provider, resetsAt}`. web2's fold keeps it, and RecoveryCard shows one line, "Codex usage limit reached. It resets <date, time>.", with no Retry button (text and data only, no layout). The new replay fixture codex-question/plan-question-usage-limit is the live gate4 turn with redactions: paths, the board MCP override, the plan type and noise frames. It covers developerInstructions on thread/start, the two-question requestUserInput (3 options each), Sequence's answer, serverRequest/resolved, the rate-limit windows, then the error and the failed turn. Locking tests: acp usage-limit.test.ts drives the adapter through the fixture; the old code classified the live error `retry`. analyzer acp-question.test.ts drives the server through it and checks the card gets both questions, the answer reaches codex in the recorded shape, and the stream ends `{kind:'wait', provider:'codex', resetsAt:1791837379000}`; pre-fix actual was `{kind:'retry'}`. It also writes sse-question/plan-question-usage-limit.sse.jsonl. web2 agents/usageLimitRun.test.tsx plays that golden; pre-fix the fold gave recovery null. No live calls. Gates at 68b39e6d: build 0, acp 139/139, analyzer 3327/3327, web2 (agents, RecoveryCard, AgentRunThread, questionCard) 56/56, test:ci 398/0, perf PASS (bootJsBytes 2,455,107, at the ceiling; the card is in a lazy chunk). The first perf collection died on an EPERM removing its temp dir while the analyzer suite ran; it passed alone.

## 2026-10-06 · Reskin board and Settings (S7, feat/reskin-board): far title size and fit, measured

Not an A/B; the measurements the reskin's board choices rest on. Instrument:
`tools/measure/board-legibility.mjs` (titles past their box, under the controls, overlaps, cut-off,
crossings, painted title px) plus a fit/fill probe (fit zoom, card area over graph box), shopfront
(fixture, chat open, board pane 788px at 1440x900 and 397-456px at 1024x700) and a git-archive copy of
seq-overhaul at 0084eb64.

| state | shopfront 1440 fit, title px | shopfront 1024 title px | seq-overhaul 1440 fit, title px |
|---|---|---|---|
| before the reskin (cards to 240 wide, no chip) | 56%, 14 | 9.6 | n/a |
| chip card, 200-260 wide, far boxes widened 1.5x | 45%, 9.5 | 5.3 | n/a |
| chip card, 168-184 wide, ELK 48/72 (edge 10/16) | 59%, 9.9 | 6.3 | 58%, 11.5 |
| + ELK 24/40 (edge 6/10) | 69%, 11.6 | 6.8 | 68%, 13.4 |
| + chip held at size, words counter-scaled | 69%, 12.3 | 7.3 | 63%, 14 |

Card area over graph box: shopfront 0.154 -> 0.202, seq-overhaul 0.194 -> 0.254. At every row:
0 titles past box, 0 under controls, 0 label or box overlaps, 0 cut off; seq-overhaul crossings 2 -> 1.
What blocks 12px at 1024: a 397px pane fits shopfront's 4-wide row at the 0.25-0.35 floor, and the
widest word ("Notifications") beside the chip caps the far scale; auto direction already lays out
both LR and TD and keeps the larger fit.

Also found and fixed: the post-attach fit was keyed on the far band, so every zoom across it
refitted within ~90 ms (100% was unreachable; predates the reskin). Live, after: 69% -> 100% -> 200%
held 1.5s; ctrl+wheel 120% held. Two load-slow tests now wait for their chunk: max 378 ms and 566 ms
over 10 runs each beside the full web2 suite (were 5.4 s and 1.07 s).

Boot (perf-counts, 3 cold reads): merge-base a9103377 2,467,218 B / 26 requests; this branch
2,475,619 B / 26 requests, +8,401 B, +0 requests. Both are above the checked-in ceiling (2,455,107 /
23); the base's excess is not this branch's, so no raise is written here.

## 2026-10-06 · Reskin shell, chat and composer (S7, feat/reskin): B ported, DeepSeek behaviour kept, UX audit fixed, gate green (kept)

uiarc.dev's B (BArc.dc.html) ported component for component into packages/web2/src/shell2 (Decision 49): the session panel (no icon rail), the chat column, B's top bar of surface pills over the stage, a split dock of at most two surfaces with the review dock, the status bar (toggle in Settings), B's composer (+ menu, mode pill, model pill with Codex's reasoning slider, context ring, round send), the takeover for approvals and questions, the changed-files line, the review dock (side by side or unified, Wrap, Revert hunk/file/turn on the S3 snapshots), and B's dialog for confirmations only. Board and Settings by the board builder, merged from feat/reskin-board f2c05851.

Kept from DeepSeek, restyled: the chat column and the split dock resize on a 24 px hit area under a hairline (chat 420 default, 400 floor, remembered; split 20 to 80 percent, remembered); Mod+B and the panel's title-row button collapse the sidebar; below 1024 px the sidebar folds and a Chat | Workspace (| Agents) switch shows one view without remounting the composer. A dock never squeezes a surface under 420 px: the sidebar folds first (and still opens over the content on request), then the Agents or review dock floats over the board. Measured in headless Chromium on the built app (scratchpad ux-shots.mjs): Agents open at 1440, stage 429 px docked; at 1024 it floats over 605 px; review at 1440, board 510 / review 510; at 1024 the review floats; 0 surface pills clipped, no pill-branch overlap; changed-files card 154 px with Review and Revert reachable (was 2 px).

UX audit fixes, each test-locked: a refused turn shows the server's sentence with Connect an agent / Add a model (server sends fix: 'provider'); Connect an agent lists what first run detected and registers it (POST /api/acp/agents/connect; Disconnect is DELETE /api/acp/agents/:id); menus answer Esc and arrows and give focus back; the palette restores focus; the takeover holds focus; confirmations trap Tab; the composer has a focus ring; Agents tree rows show the command, not codex's PowerShell launcher; answer links show the file's label with the path on hover; Jump to latest only when more than 40 px from the end. No "·" separator anywhere in web2/src (derived scan, src/noMiddleDot.test.ts).

Tests retired (subject gone, one line each); everything else was ported:
- v3/V3App "expands chat when Chat tab is selected": there is no Chat pill; the chat is a column that is always there (the empty stage is covered in app/workspaceFrame.test.tsx).
- v3/V3App "drags the live-pane splitter fluidly and snaps ON RELEASE": snap frames replaced by the continuous 20 to 80 percent divider (shell2/layout.test.tsx).
- v3/V3App "the count opens its own shelf…" and "an opened shelf does not stay opened…": Decision 35's capped shelves; B's + menu is six rows with no shelf.
- v3/V3App "a submenu opens one at a time…": the + menu has no Models/Skills/MCP submenus; Customize opens Settings (kept) and skills are on /.
- v3/V3App "separates the level from the reading…": Decision 37's bars replaced by the slider (ported into "the model pill opens the models above a reasoning slider").
- shell3b and agentsNarrow were first retired, then ported to the new controls in shell2/layout.test.tsx.

Boot (perf-counts, 3 agreeing cold reads, a3f87eb2): bootJsBytes 2,374,161 (ceiling lowered from 2,455,107: every overlay now loads when opened, which pays for the reskin's boot path; per-module numbers in the ratchet's `what`); bootModules 4; bootRequests 25 (raised from 23 with a note: Inter's 400/500/600 static cuts where one Archivo variable file was; a variable Inter package needs Jaden's yes). Gate at 2fd4d9dd: pnpm -r build 0; web2 377 files / 3816 tests 0 failed; test:ci 398/398; analyzer 3332/3332; perf-ratchet PASS.

## 2026-10-06 · Round 6 reskin merged into overhaul, closing gate (kept)

overhaul was fast-forwarded to feat/reskin f12aa27a (63 commits, all maxnaid1, no trailers). That covers the mix Jaden picked: B (uiarc.dev) ported component for component into shell2, with Ramp Kit colors, the Mix board (icon cards with one-line definitions on the dotted ground, B's dock and view pills), DeepSeek-style edits (composer takeover, changed-files line, review dock with Revert hunk/file/turn), the status bar with its Settings switch, Settings rebuilt, the Agents pane with POST /api/acp/agents/connect and DELETE /api/acp/agents/:id, and UX audit fixes (lab/specs/ux-audit-reskin.md on audit/ux d54ad98b). Codex and Claude marks come from @lobehub/icons-static-svg 1.95.1 (MIT), downloaded on Jaden's direct "Download those". Closing gate at f12aa27a, one package after another: install 0, build 0, schema 491, acp 139, mcp 75, analyzer 3332, desktop 55, web2 3817, test:ci 398, perf PASS (bootJsBytes 2,374,161, −80,946 vs the old ceiling; bootRequests 25, +2 Inter static files, noted). Packaged from C:\sqg at f12aa27a: dist 0; Sequence Setup 0.1.3.exe 90,551,849 B; 10 of 10 packaged smokes PASS. Wall clock, n=9 after 1 warm-up, quiet machine (all builders stopped): composer interactive median 620 ms (min 612, max 674), server up 339, ready-to-show 538, first paint 1106. Earlier baselines: 947 ms (program start) and 826 ms (this morning's single launch). The shipped server carries disarmConsoleListKill, node-pty is 1.1.0, and sequence-mcp.cjs is present. Known limits: shopfront titles at the fit at 1024 are 6–7 px (pane-limited); local file links in answers aren't clickable yet; the board Hotspots shot shows a lingering Grid hover; the analyzer db detector false positive is filed as a separate task. No live model calls were made after the Codex quota ran out (resets 2026-10-12 16:36).

## 2026-10-06 · Round 7 board (r7/board, Jaden's walkthrough section C): pick up the boxes, calm ASCII, readable focus, keyboard-native, Diff and Grid in B (kept)

Built from 5934a3d0, measured on git-archive copies of the ML harness (plus a git copy with a demo branch for Diff), shopfront and this monorepo, isolated SEQUENCE_USER_DIR, headless Chromium at 1440x900 and 1024, both themes.

- C.1 Drag: a 4 px click/drag threshold. Lines reroute for the moved card with no relayout. Positions are saved per repository and Map level, Reset layout is in More, and Tab then arrows nudge a card. Measured: a click moved nothing; a drag moved Src Tauri (-161, -220) and held it through a reload; Reset put it back.
- C.2 The empty-board ASCII ran on a 9.9 x 18 px glyph grid over the 20 px dot field and the two beat. Now one glyph per field cell, drawn in flow space and in the field's own ink, with empty cells drawn as the dot. Static, no animation.
- C.3 "Not connected" follows its cards: the label moved the same (-161, -220) as Src Tauri.
- C.4 Expand, drill-in and anatomy now frame the opened node at no less than 87.5%, eased over 240 ms (none under reduced motion). At 85.7% (12/14) the painted title measured 11.9 px. ML harness expand and drill-in: 87.5%, smallest title 12.3 px. Before, an expand fitted the whole board.
- C.5 Keys: hold Space to pan, also in Draw; arrows walk the selection; Esc steps back one level (Draw, selection, anatomy, drilled level); 0 fits; 1 is 100%. The keys are listed in More. The 0 and 1 swap rewrote the old key test.
- C.6 Diff is a glass card with B's segmented pill, glass rows and status chips centred by grid (0 px off). Paths are one line, cut from the left, with the full path on hover. Under 600 px of board Diff takes the whole board. Grid keeps the matrix (coordinator ruling: it won its A/B) on a glass card over the field, cells up to 56 px (5 boxes at 1440: 32 -> 56).
- Coordinator follow-ups:
  - The view pills keep their names down to 460 px of board.
  - Edge tags are placed board-wide, so none overprints a tag, a card or a line: a "+N" chip, or the line's hover, when nothing is free. board-legibility counts `edgeLabelOverlaps` (`--max-edge-label-overlaps`): 4 on the ML harness copy before, 0 after.
  - The card footer shows the kind, one status and the count, or the kind alone, and never cuts a word.

Legibility, all six runs exit 0 with --max-cutoff 0 --max-under-controls 0 --max-title-past-box 0 --max-edge-label-overlaps 0, on ml-harness, shopfront and the monorepo copy, dark and light, at 1440x900 and 1024x700. cutOff, underControls, titlesPastBox, labelOverlaps, edgeLabelOverlaps and boxOverlaps are 0 on every row. The fit-all smallest title at 1024 is shopfront 6.4 px and monorepo 9.4 px, both pane-limited as before.

Gate at 8acfc504: pnpm -r build 0; web2 380 files / 3852 tests 0 failed; test:ci 398/398; perf-counts PASS. bootJsBytes was raised with a note, 2,374,161 -> 2,381,139 (+6,978). The board's new interaction runs on the first frame. A lazy ASCII ramp cost a boot request, so it stays static; the workflow bar and the keys hint now load later. bootModules 4, bootRequests 25. Style ratchet: no new backdrop-filter.

Not done: arrow-walk does not pan to a card that is off screen. A drag can leave edge tags as chips where the cards crowd them.

## 2026-10-06 · Round 7 shell (r7/shell): Mix's cards, every surface named, projects in the sidebar, the default workspace a project, Files previews

Jaden's walkthrough section B (lab/specs/round7-walkthrough.md), built against Mix.dc.html with B's components. The sidebar, the chat and each surface are rounded cards (--r-18, hairline, B's shadow) on --bg-ground, 8 px apart and from the edge (CARD_GAP, counted in roomFor); the resize handles are the gaps, 24 px to grab. The surface bar names all four surfaces always; each open one carries its own 24 px x (Terminal included) and only the x closes (the name opens or brings forward). With no surface open the stage folds, the pills keep their icons and the chat card centres (760 px max) with its suggestions. The window buttons are 30 px icon buttons in the bar's row and in the narrow bar (no desktop change: main.ts is already frame:false). The sidebar reads Sequence and lists every opened project from GET /api/sessions (repos plus the active index): the current one first and marked, one click to switch, chats under each, folds remembered; Worktrees as before. Server, two hunks approved by the coordinator: the terminal's root falls back to the home workspace folder (fileJailRoot), so Terminal opens there with nothing attached (a read-only home still 409s); GET /api/file?raw=1 answers a raster image on an allowlist with its bytes (every existing refusal runs first, SVG stays text). Files: HTML in a sandboxed frame with a no-network policy (Run scripts adds allow-scripts only; a probe of 20 frames gave 0 server hits, 60 without the policy), Markdown as prose, images; Preview / Code in the header; the tree keeps 30 percent (180 to 320 px) with a file open and names give way in the middle. One spacing scale in shell2.css, controls from the rungs (spacing.test.ts); e2e/icons-centred.mjs scans every icon-only button in four states at 1440 and 1024 (0 off by more than 0.5 px; planted control caught).

Contracts rewritten, not weakened: the pill no longer closes on a second press (App, workspaceFrame); one surface does not fold the sidebar and roomFor counts the gaps (layout, Agents at 1472 not 1432); names give way in the middle instead of scrolling sideways (filesRailCss); with no repo a plain shell opens in the workspace (onboarding-signin; the 409 control is in terminal.test). Boot: base 5934a3d0 2,374,161 B, branch 2,377,712 B (+3,551, noted raise; the Files preview moved to its own chunk first, from +5,156); bootModules 4, bootRequests 25. Shots: scratchpad/review/r7-shell-{1,2,3}-*.png (1440x900 and 1024x700, dark and light, each set with a pair beside the Mix render). AgentsDock not mounted yet: waiting on the agents builder's commit.


## 2026-10-07 · Round 7 agents (section A, r7/agents): flashing consoles, honest failures and status, the gray screen, the dock, Settings, boot (kept)

Base 5934a3d0, rebased onto overhaul 8c014268. Fakes and replay only, plus ONE owner-approved live Claude turn.
A1 flashing consoles. 14 spawn sites lacked windowsHide (codex app-server and exec, the ACP client, git, hooks, the terminal, the desktop's server spawn, verify, citations, open-browser); all hidden now, and tools/ci/spawn-hidden.test.mjs derives the call sites by scanning packages/*/src (planted-bare and hidden controls). The loop: shell2/ConnectAgents' default fetch was a new arrow per render inside its effect's deps, so with the model menu open it re-asked forever. Measured on the built base app after a failed start: 1,207 GET /api/acp/agents and 1,207 GET /api/onboarding/providers in 5 s (now 1 and 1), each probe round and capabilities ask starting codex, claude or the agent. Also acp's respawn gate on capabilities (2 s doubling, cap 3, then the last error until refresh=1). This is also A6's gray screen (shell2/failedStartMenu.test: no scrim or modal left, composer focusable, at most one ask per open; fails on base ConnectAgents).
A2. The ACP client reads the agent's stderr and, when the process is gone, throws AgentExitedError with the exit code and its last lines (base printed "ACP connection closed"). The run says Starting/Waiting for <agent>; a failed run is one B notice with one Retry (also unclassified failures), then "Retrying below". Goldens sse-r7/ from a real dying process then the mock agent.
A3. Both clients expose activeModel() (codex thread/start|resume model, the ACP model option); run-node sends acp:model (14 goldens gain one line each); the pill and status bar name it, else the listed default, else "Default model". A spent Codex limit is recorded from the turn's wait recovery (agent-limits.json) and Codex reads "Usage limit, resets <when>" until it passes; never probed.
A4. A signed-in Claude without claude-agent-acp is state adapter (Ready / Needs sign-in / Needs adapter / Not installed, owner's sentence). Install bridge runs `npm install -g @agentclientprotocol/claude-agent-acp` only on a click (POST/GET /api/onboarding/install-adapter, fake npm in tests). Incident: one screenshot run lost its fake PATH and installed the real package at 19:21; owner kept it. The harness now refuses to run unless `where npm/claude/codex` land in the fake dir.
A5. Reproduced: the hooks command was typed into the Terminal shell, refused 409 with no project. The panel now runs its own terminal on a server-recorded ?launch= that starts claude with argv (a .cmd shim through a one-line batch file); paths with spaces tested. The one-file server bundle also wrote a stray hooks file on every boot (fixed).
A7. agents/AgentsDock is B's card (Tree|Timeline seg, Live chip, x and Esc); Shell2 mounts it in a transparent slot; with no room it swaps in for the stage, never overlays.
A9. Settings is Agents | Models | App, connect first; settingsPersist.test derives every stateful control from the panel and redraws against the same server and storage (12 on App, all kept).
A8 boot (packaged win-unpacked, smoke, isolated store, fake CLIs, n=5 medians). Two earlier windowless Sequence instances held the Chromium profile: base composer 6,533 ms; the same build on its own profile 694 clean / 728 seeded / ~600 cold; the round 6 build the same, so machine state plus no single-instance lock. Fix: single-instance hand-over and a quit bounded at 5 s. After: a second launch exits in 162-173 ms (was a whole second app at 6.5 s); own profile 583 clean / 602 seeded.
Live Claude turn (owner-approved, once): real claude 2.1.280 Ready (Pro) and the installed bridge; connect registered cmd /d /s /c claude-agent-acp; Ask mode on a temp shopfront copy: end_turn in 9.8 s, mcp__sequence__map called, 0 approvals, "Shopfront has 8 services: ...", HEAD unchanged, only the server's untracked .sequence/. Provider registry dropped by the owner.
Shots: scratchpad/review/r7-agents-{1,2,3,4,6,7}-*.png.

## 2026-10-07 · Round 8 board (r8/board): boards with tags, drawing on the architecture board, agents can draw

Built from 8c014268 against Jaden's ask: one Boards concept, tagged tabs, an Excalidraw-like space, and agents that choose which board to draw on. The design is lab/specs/r8-boards.md.

- Store: `.sequence/boards/` per project (the attached repo, else the home workspace). It holds the architecture board, which cannot be deleted, plus any whiteboards. Writes are all-or-nothing ops applied to the file on disk, so a person's stroke and an agent's shape never erase each other. Caps: 50 boards, 2,000 items, 500 characters of text, 2,000 points per stroke, 200 ops per call. Routes are `/api/boards` (list, create, get, rename, delete, ops) and `GET /api/boards/events` (SSE). The stream fires on the server's own writes and on `fs.watch` of the folder, with a 1 s stat floor, so a write from the MCP process reaches the open tab.
- UI: a tag strip on both surfaces, in B's pill style: a graph glyph for the architecture board, a pen for whiteboards, + to create, double-click to rename, and x to delete through B's ConfirmDialog. The top bar's Architecture and Whiteboard still open their kind, and a pill of the other kind switches surface. Draw on the architecture board gained a glass palette: Sketch (the old box-to-node gesture, still the default), Pen, Rectangle, Ellipse, Arrow, Text, Sticky and Erase. Space-pan and Esc are unchanged. A mark started on a card is anchored to it and follows it. Arrows bind to marks or cards. Agent marks are accent-tinted with an "Agent" tag. A text mark moves at most 24 units to get off a connector, inside its own shape first; with nothing clear in reach it keeps its place on a plate (coordinator ruling). The whiteboard runs on the same store, gains stickies, shape labels and bound arrows, imports the session's old localStorage sketch once, and falls back to that local pad when no server answers. The board's card and ground colours go through `--board-card`/`--board-ground`, so light mode takes the shell's cream pair at merge.
- MCP: `list_boards`, `create_board`, `draw` (add/update/remove rect, ellipse, arrow, line, text, sticky; `anchor` and arrow ends resolve node ids or names against the scanned graph; refusals list every reason and nothing is drawn). The descriptions say: the architecture board to explain the real system, a whiteboard for a free sketch. Token cost by the s2a rule (chars/4): list_boards 133, create_board 204, draw 460, so +797 on the full listing (4,075 -> 4,872). Core plus draw would be 1,658, over the 1,500 core line, so the tools are behind the "more tools" setting and core stays at four tools (1,199).
- Shots: scratchpad/review/r8-board-1-{tags,draw,wb}-{dark,light}.png and r8-board-2-{before,agent-arch,agent-wb}-*.png. In checkpoint 2 a scripted stdio MCP client draws next to the shopfront services and on a new "Checkout plan" whiteboard while the page is open, with no reload. The light shots have r8/shell's cream values injected.

Gate at 1ce96bc8: pnpm -r build 0; web2 388 files, 0 failed; analyzer 3,344/3,344; mcp 79/79; test:ci 398/398 (reachability inventory gained `/api/boards` and `/api/boards/`). board-legibility on shopfront, dark and light, 1440x900 and 1024x700, with --max-cutoff 0 --max-under-controls 0 --max-title-past-box 0 --max-edge-label-overlaps 0: every count is 0 and every run exits 0. perf-counts PASS: bootJsBytes 2,384,671 -> 2,397,867 (+13,196, noted raise: the tag strip is drawn from the first frame and the whiteboard was already boot code); bootModules 4; bootRequests 25 (the boards fetches moved to the first idle period after the first layout, after measuring +2 when they ran in the layout commit).

Not done: annotations on the architecture board cannot be dragged or resized (erase and redraw). The whiteboard can. In a split pane the tag strip scrolls sideways rather than showing every pill. The AI Canvas SeqDraw layer stays on localStorage.

## 2026-10-07 · Round 8 shell (r8/shell): every surface named, one rail row, one popover, warm cream light, the Bastion ASCII stage, a real Files editor

Jaden's review of round 7, nine items, built from overhaul 8c014268. Shots are from the built app (shopfront git copy with seeded chats plus ticketing, isolated SEQUENCE_USER_DIR, headless Chromium) in scratchpad/review/r8-shell-{1,2,3}-*.png at 1440x900 and 1024x700, dark and light.

1. Surface bar: while any surface is open, every pill shows its icon and its name at every width. No container query reaches a pill now (the 560 px fold is gone). When the names don't fit, the bar scrolls sideways and fades only the edge with more to scroll to (scrollFade). In a main column of 720 px or less the branch pill gives its place, and the status bar still names the branch. Icons alone appear only in the no-surface state. Locked by auditLayout, surfaceBar and e2e/rails-match (whole names at 1440 and 1024).
2. The title row reads Sequence, with no mark.
3. Sidebar icons now mean something:
   - The home workspace is a folder. A project is a repository glyph (new `repo` icon) when git answers for it or it was opened as one, and wears a branch badge when it is a chat's worktree.
   - A chat wears its agent's mark (Codex or Claude, from the live run or its `agentThreads` on disk), a branch for a worktree chat, or a plain chat bubble. No row draws the spark.
   - There is no whiteboard-chat field on a session, so no pencil.
   - Locked by railIcons.test.
4. One rail row: shell2/RailRow.tsx is drawn by the session sidebar and the Files tree. It is 30 px tall, inset 4 px plus 12 px per level, with a 16 px chevron slot and a 16 px icon slot holding a 14 px glyph, 13 px body type, and one hover fill and one selected fill. files.css no longer restates any of it. e2e/rails-match.mjs compares the computed styles of a chat row against a file row (depth 1) and a project row against a folder row (depth 0), plus the indent step and the hover and selected fills. A planted 26 px row is the positive control.
5. Composer:
   - The pills and the + are 28 px of thinner glass (2.2 percent dark, 2 percent light), with a hairline and no drop shadow.
   - The send is 30 px (--row-h) in a softened ink.
   - The card keeps a faint 2 px lift; the focus ring is unchanged.
   - Locked by composerLight.test.
6. One popover style:
   - Touched: the menus (.s2-menu: the chat's More, a chat row's actions, the composer's + / mode / model menus, the @ list), the toast (.agtoast), the confirm dialog (.s2-dlg), the takeover (.s2-take), the context-ring popover, the command palette (.shell-cmd) and any [role=tooltip].
   - They share a 16 px radius, the glass-ctl hairline, the float fill, the lift shadow, 6 px padding, 32 px rows, 13 / 11.5 px type and one key-hint chip. A dialog's words sit one step in.
   - e2e/popovers-share.mjs presses every aria-haspopup control, the palette key and a chat's Delete. It collected 5 menus, the palette dialog and the confirm alertdialog, all on one frame; a planted 8 px menu is reported.
   - The toast and the takeover need an agent run, so popoverFrame.test holds them to the same rule at the sheet.
   - Overlay panels (Settings and the like) are panels, not pop-ups, and are left as they were.
7. ASCII stage background, ported from premai components/lab/ascii-photo.tsx and hero-photo.tsx (Jaden's own repository; source, licence and photo credits in shell2/backdrop/SOURCE.txt):
   - Light takes the day photo and dark the night one, each resized to 960 px (73,477 and 33,103 B).
   - It is a still with no cursor lens, drawn once per size and theme after first paint (lazy chunk).
   - With no surface open it sits behind the centred chat, blurred (baked into the draw) and dimmed to 0.34 dark / 0.4 light. On an empty stage it is at 0.5. There is no fade under reduced motion.
8. Light room is warm cream:
   - Ground #F4F0E8, cards #FAF8F3, surfaces #FFFDF8.
   - Ink #2B2A27 / #4D4B46 / #6B6862 / #9A968E.
   - Hairlines the warm ink at 10 and 14 percent; glass and shadows warm and softer.
   - The box edge went to 52 percent to hold 3:1 on cream.
   - New chat and send are the ink mixed 78 percent toward the ground, not near-black.
   - bastionContrast floors hold. creamLight.test locks the warmth.
   - Before and after: r8-shell-2-light-before-after-*.png.
   - Dark is unchanged.
9. Files:
   - An HTML preview is a page in a framed card on the theme ground. Its header has the name, Preview / Code and a Scripts chip. A page with no <style> or stylesheet <link> gets the theme's reading defaults, injected after the CSP; a styled page renders as authored on a light canvas.
   - Editor: the lockfile has no CodeMirror, Monaco, Prism or Shiki, so nothing was added. files/CodeEditor.tsx builds on the repo's own tokenizer (review/syntax.ts). It has highlighting, a line gutter in the same scroller as the field (so it cannot drift), the current line lit, and Find (Mod+F; Enter and Shift+Enter; Esc).
   - Save is Mod+S through the panel's own Save action, and the file's tab wears a dirty dot.
   - The status row shows language, line and column, Saved / Unsaved, and B's pill buttons for Discard and Save. Tab inserts two spaces.
   - The editor loads the first time a file is edited.

Contracts rewritten, not weakened:
- The old 560 px closed-pill fold assertion (auditLayout).
- The brand's mark (projects.test).
- The light ground and ink values (bastionContrast, graphite.test).
- Three editor tests now await the lazy chunk.

Boot (perf-counts, 3 agreeing cold reads):
- Base 8c014268: 2,384,671 B. Branch at 316294b1: 2,387,672 B (+3,001). The raise is noted in the ratchet; it was +8,076 before the editor went lazy.
- bootModules 4 and bootRequests 25, unchanged.

Gate:
- pnpm -r build: 0.
- web2: 392 files / 3924 tests, 0 failed. src/v3/canvasPaneFocus.test.tsx timed out at its 5 s limit in 2 of 4 full runs under load. It runs in about 1.0 to 1.5 s alone, the same as base (base 3.9 s in a full run).
- test:ci: 398/398.
- perf-ratchet: PASS.
- e2e: icons-centred 11/11, rails-match 8/8, popovers-share 4/4.
- e2e/shell-boot.mjs exits 2 (harness: chat-column never appears). It does the same on the base build.
- Analyzer not touched.

Not done:
- At 1024 with two surfaces, the Files tree is narrow and middle-shortened names read oddly ("i…entory"). The tree's width is round 7's rule.
- The board's cards stay white in light (board builder's).

## 2026-10-07 · Round 8 integration (r8/int off overhaul d2e3bf5b): boot cut, one ratchet note, shell-boot back, two fixes found in the built app

The agents, round 8 board and round 8 shell merges, integrated and checked together. Shots are from the built app (shopfront git copy with seeded chats, isolated SEQUENCE_USER_DIR, fake claude/codex/npm/npx first on PATH, headless Chromium, no model call) in scratchpad/review/r8-final-*.png, dark and light, 1440x900 and 1024x700.

1. Boot. shell2/LiveSurface loads the Whiteboard and AI Canvas surfaces with React.lazy when first opened; the architecture board and its tag strip stay on the first frame. Merged (3 agreeing cold reads at d2e3bf5b): 2,391,117 B against the agents ceiling 2,374,877 (board +13,196, shell +3,001, agents -9,794, merge +43). After the cut: 2,312,308 B. Two shell2 test anchors for shell-boot add 52 B: the ceiling is 2,312,360, with one timestamped `$raised` note naming every part. bootModules 4, bootRequests 25.
2. canvasPaneFocus.test timed out under load: a CPU profile put 817 of its 1,047 ms in a `queryByRole` (accessible names through jsdom's style cascade, about 200 ms a call). The pill is found by attribute now: about 300 ms alone, about 1.0 to 1.1 s in a full run, 3 of 3 full runs green.
3. classCoverage went to 31 unstyled classes in the merge (bridge-fail, files-row-, s2-branch-l). The branch pill's label gets the rule it lacked (one line, ellipsis, title carries the name): 30.
4. e2e/shell-boot.mjs addressed the v3 tab layout and exited 2 on `chat-column` since the reskin. Re-pointed at shell2 with the same claims: the panes and divider total the measured stage and follow a resize; every pane stays inside the window and is a 278 px seat; a pill reads pressed exactly when its pane is drawn; below 1024 Chat and Workspace are two named views that each fit; 1280 gives everything back; the type ladder is read from the `--t-*` tokens. 18/18. A planted off-ladder size and a 900 px chat column fail five checks.
5. Integration check in the built app:
   - Light: the board's `--board-card` / `--board-ground` resolve to #FAF8F3 / #F4F0E8, the shell's cream pair; cards, tag pills and stickies paint #FAF8F3, the ground #F4F0E8, the palette a warm-ink glass over it.
   - The Agents dock sits beside the board at 1440 (dock 1072 to 1432, stage 436 to 1064) and swaps in for the stage at 1024.
   - The tag strip starts 21 px below the surface bar; its right edge stops 44 px short of the pane's floating split and full-screen buttons at both widths.
   - With no surface open, the ASCII backdrop draws behind the chat (0.34 dark, 0.4 light).
   - Every surface pill keeps its whole name while a surface is open (icons only in the no-surface state, by design).
   - A scripted stdio MCP client drew five marks and a new "Checkout plan" board while the page was open; they appeared without a reload.
   - Found and fixed: in a 1024 window with Files beside the board, the HTML preview was 61 px wide. The open tree's 180 px floor beat the narrow-pane rail (same weight, later in files.css). In a narrow pane the open tree is the rail again: 121 px. Locked by filesRailCss.test.
   - Found and fixed: every page load lit the cards of agent work that had ended minutes before. The light book kept one time per target, so a replayed call's start could not be taken back by its old end. Lights are kept per call now. Locked by two agentOverlay tests.

Gate at f5e72e71, one after another:
- pnpm -r build 0; schema 491/491; acp 145/145; mcp 79/79; analyzer 3,352/3,352; desktop 59/59; web2 401 files / 3,962 tests, 0 failed; test:ci 404/404.
- perf-counts PASS (2,312,360 B, bootModules 4, bootRequests 25).
- e2e: icons-centred 11/11, rails-match 8/8, popovers-share 4/4, shell-boot 18/18.

Not done:
- At 1024 with two surfaces the Files preview is still only 121 px; Files alone on the stage is full width.
- Agent chips on neighbouring cards overprint each other at fit zoom ("editing db.py" over "editing worker.py"), and a live chip can sit on an agent's text mark drawn above a card. The chip is the agents overlay's, counter-scaled to 11 px; truncating it to the card would hide the file name. Left for its owner.
- test:ci's site-links test runs `npm install` in site/ when site/dist is missing. On this fresh worktree it did, once: 3 registry metadata revalidations and an audit POST, no tarball fetched (npm debug log 2026-10-07T02_18_20).

## 2026-10-07 · Codex local completion, first checkpoint

Owner's latest request supersedes cloud-only: local takeover, reconcile unfinished R9, implement and verify before main/install. Remote main verified with ls-remote at 41654a100bef1d42e19a67a624151761c917ae68. Primary dirty checkout untouched. Integration branch codex/sequence-completion in C:/Users/<user>/Projects/seq-overhaul. Plan: docs/sequence-completion-plan.md; independent route/33-ask audit and primary-source DeepSeek/T3 findings: lab/specs/completion-coverage.md and deepseek-ux-followup.md.

Recovered R9 title/Markdown/home work, then integrated server-owned transcript persistence and bounded cancellation, reasoning range/context explanation, unified ASCII activity, mounted home controls and footer bounds. This is a partial checkpoint, not a complete release. Parent review identified a possible same-row persistence overwrite and frontend/server telemetry contract mismatch; sent back to runtime builder, still open.

Independent gates: acp build 0; analyzer build 0; 4 runtime transcript/cancel tests 0; web2 build 0; 6 targeted chat files / 87 tests 0; 5 targeted shell files / 47 tests 0. Logs in C:/Users/<user>/Projects/sequence-completion-{runtime,chat,shell}-gate.log and sequence-completion-web-build.log. No full suite or live provider call in this checkpoint.

Self-run browser verification: node tools/measure/completion-walk.mjs --tag completion-shell, exit 0, 8 checks (Architecture opens after close-all plus footer above status) over dark/light, 1440x900 and 1024x700. Isolated copied shopfront and SEQUENCE_USER_DIR; no real screen/user-store access. Shots tmp-shots/completion/completion-shell-*.png. Fleet verifier unavailable on 8090; no independent lane claim. The first layout wait incorrectly treated idle as incomplete; aborted that instrument run, fixed to the actual completed idle contract and repeated once. Narrow board still only 34 percent fit in the screenshot; readability acceptance remains open. Default workspace browser controls had passed baseline separately; native Electron hit testing remains unverified.

Next disjoint slices: runtime hydration/quiet/terminal-state/token diagnostics, chat/settings/trace, shell/files/onboarding/first worktree, board annotation dragging/default drawing/collision packing. Main push and installer are held until integration acceptance, not represented as shipped.

## 2026-10-07 · Codex completion, second checkpoint

Durable completion goal is active for all 33 asks, acceptance audit, green main push and local installer. Four existing builders resumed in their isolated worktrees; two additional read-only reviewers cover lifecycle correctness and mounted owner-seat contracts. Goal is not complete and the dirty primary checkout remains untouched.

Integrated lifecycle/usage, General workspace Full consent, shared token presentation, rename failure handling, startup theme watcher, Open project recovery, annotation dragging/cancellation and screen-space agent label packing. Parent gates: lifecycle 10/10, ACP adapter/final-answer 10/10, Full consent/cancellation 8/8, web command/theme/consent/run-store 20/20, title/activity/trace 28/28, annotation unit/rendered 13/13, chip geometry/rendered 10/10; bare exit codes all 0. Current web build exit 0 after a genuine old-token-shape compile failure was corrected. Undefined store in shell commands failed 3/3 before correction c7a82875, then passed the exact targeted gate.

Built owner-seat matrix exit 0: 1440 and 1024, dark/light; 929 real tracked filenames and 80 synthetic chats. Verified home hit testing, long rail/footer, fullscreen/split controls, readable HTML preview, persisted theme and Open project. Self-run browser screenshots in tmp-shots/r9-shell; visually inspected 1024 light split preview and 1024 dark Open project. Board specimen screenshots under the temporary seq-board-completion-shots-tHGntD folder show actual components but are labelled specimens, not finished-product evidence. Measurement script now asserts seq.theme survives startup rather than forcing paint; syntax/isolation gate exit 0.

Independent review findings remain assigned: fullscreen Agents visibility, palette reveal/composer focus, modal focus handling, System prepaint, successful compaction classified as empty failure, and softLoadSession bypassing transcript restore/deduplication. File operations are held until worktree scope cannot silently touch the main checkout. No live model/GPU/user-store calls or full-suite loops, no push/install claim. Evidence logs remain C:/Users/<user>/Projects/sequence-completion-*.log.
