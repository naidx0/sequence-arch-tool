# Living research (short)

Only **open or measured** notes live here — and that is now the whole of it. Spikes, older benches, and notes retired by the v2 pivot (including `ow-canvas-miro-compact.md`) were **deleted from the tree** on 2026-08-20; there is no research archive to route into. Recover one from git history if you need it.

| Doc | Why it is still here |
|-----|----------------------|
| [`teach-mode-driven-end-to-end.md`](teach-mode-driven-end-to-end.md) | Teach mode driven end to end: a repo grep for "what is machine learning", no path to a repo-less lesson, and a corrected §5 — the lift was an instruction, not an example |
| [`symbol-index-criterion.md`](symbol-index-criterion.md) | Registered before building: the four lessons a filename lookup cannot reach, and the three numbers any candidate must hold together |
| [`teach-naming-specificity-registration.md`](teach-naming-specificity-registration.md) | Registered, then WITHDRAWN before it ran: the belt already carried a specific naming clause, and it is obeyed LESS (36.8%) than the abstract one (49.3%) |
| [`service-input-card.md`](service-input-card.md) | **A real bug found, and my first verdict CORRECTED (2026-09-05).** Python env names were corrupted — `os.environ["REDIS_URL"]` extracted as `EDIS_URL`, `MY_VAR` as `Y_VAR` — because a Python string-prefix strip ran AFTER unquoting; fixed, 3 tests. An earlier revision killed the card claiming `extractFacts` cannot see assignments: that was a probe bug (`assignments` is a Map; `JSON.stringify` shows `{}`). Real state: 11 of 14 observed; the 3 remaining misses are all env nested in a composite/template literal |
| [`visual-metric-prediction.md`](visual-metric-prediction.md) | **Registered BEFORE the run landed (2026-09-05):** which of the three classes will dominate the zero-visual turns, from static reading — the contract demands a chart twice (askPipeline.ts:1008, :1012), `propose_chart` is on the teach belt (in the allowlist, NOT in ASK_MUTATING_TOOLS), and a canvas write also counts, so a zero-visual turn means the model produced neither. Predicts never-asked >70% (the prompt contract), with what would refute it |
| [`model-fit-and-the-visual-metric.md`](model-fit-and-the-visual-metric.md) | **Measured 2026-09-04 + two corrections:** every installed model runs 100% on the GPU except `deepseek-teach` (9.2B, CLIP projector), which spills 24-28% to CPU and runs at 21-26 t/s against 116 for the granites — so a run under it costs 4-5x the wall clock. CORRECTS the inference drawn from it: the visual metric grades OUTPUT (a propose_chart call, a ```seqd fence, box-drawing glyphs), so a text-only model with no projector can score 100% on it. A low visual rate is a product defect and must not be excused as a model limitation |
| [`claim-audit-resolver.md`](claim-audit-resolver.md) | **Design + kill criterion (2026-09-04):** a verb that resolves every path a session cited AT THE COMMIT that session pinned, returning the residual by class with the denominator in the answer. Carries the mistake NOT to repeat from the prior instrument — it imported scan coverage into path existence, a question git already answers, and dropped 19 citations from its denominator for no reason. Coverage governs EDGE claims; the discipline is knowing which claims it governs |
| [`context-window-truncation.md`](context-window-truncation.md) | **Measured 2026-09-04 (silent truncation):** `num_ctx` appears ZERO times in packages/, so Sequence inherits whatever window the server picked — harmless today only because the model in use bakes 65536, and broken one click away on stock `granite4.2:3b` where the running server default is 4096 and a 24k prompt silently becomes 4k with every honesty field still reporting the full denominator. Carries two CORRECTIONS to the obvious fix: `probeContextWindow` returns the model's TRAINED ceiling (GGUF metadata), not the effective window, so it is wrong by 32x in exactly the failing case; and the OpenAI-compatible path ACCEPTED `num_ctx` and ignored it (HTTP 200, `/api/ps` unchanged at 65536) — so adding the field and seeing 200 would ship a no-op as a fix |
| [`w3-predict-then-reveal.md`](w3-predict-then-reveal.md) | **W3 spec 2026-09-03 (predict-then-reveal), written against the fields that exist:** the five prediction verdicts with three of the source spec's field names CORRECTED — `evidenceClass` is really `ArchEdge.instrument`, whose fifth value `mixed` must not grade as `test-only`, and `unreadableSources` is really TWO signals (`unfollowed` = opened-but-unparseable, `unscanned` = never-visited) plus the 20k file-walk cap. Why one signal is not enough: measured on this repo, `unfollowed` reported `[]` — its contract's words for "looked, and everything was readable" — while 59 tracked source files had never been opened, so a `graph-gap` check built on it alone would confidently tell a learner their correct answer is wrong |
| [`hit-targets-on-a-zoomable-surface.md`](hit-targets-on-a-zoomable-surface.md) | **Owner ask 2026-09-02 (Teach must be easy to hit):** why a control that obeys Graphite law 3 exactly can still fail WCAG 2.2 AA — 26 board units is 26px at 100% zoom and 13px at 50%, so ten board controls pass at one zoom and fail at another without changing. Measured from both ends, with the three off-board failures zoom does not explain (the 8px resize handle among them), and the owner's separate point that the teaching PROMPT is a first-class surface with a bench (visual-present rate 13.8%) rather than a hidden constant |
| [`trust-boundary-verification.md`](trust-boundary-verification.md) | **Owner ruling 2026-09-02 (trust boundary before auto-approve):** the two security criticals read in the code before building against them — repo `AGENTS.md` reaching the model as binding instruction with no trust gate (real), the command allowlist matching a literal string over a `package.json` indirection (real), the symlinked-`AGENTS.md` read (real, fixed), and the claimed missing origin validation on three `/api` routes (FALSE — a global pre-routing gate already covers all 126, so that rule shrinks to authenticating local callers) |
| [`anatomy-view-measurements.md`](anatomy-view-measurements.md) | **Owner ruling 2026-09-02 ("anatomy is the cleanest"):** every figure behind the Anatomy view, recomputed from `.sequence/graph.json` rather than taken on report — the containment correction (a service's direct file children are its TEST overflow, 237 of 237 under analyzer), the recursive-rollup rule that three separate errors all came from missing, the five locks and which two can only ever be proven by fixture, and the A3 scope conflict with the board's standing "opening REPLACES the view" ruling |
| [`visual-board-mode.md`](visual-board-mode.md) | **Owner ask 2026-09-02:** field research behind `../decisions/visual-board-mode-madr.md` — React Flow motion + MiniMap licensing (already settled MIT), why the animation dependency and the hand-drawn look are both rejected, ELK "designed" options, the export recipe and its version pin, and which chart families can actually show change over steps |
| [`web-search-toolbelt.md`](web-search-toolbelt.md) | **Owner ask 2026-09-02:** web search in the toolbelt — the field (SearXNG / Firecrawl / Tavily / Exa / Browser Use), what Hermes and OpenClaw ship, and the keyless-first `web_search` + `web_read` plan awaiting the owner's pick |
| [`seqd-stream-park.md`](seqd-stream-park.md) | Parked open queue |
| [`harness-open-queue-tracks.md`](harness-open-queue-tracks.md) | Tracks G/H — owner-blocked |
| [`named-bakeoff-shopfront.md`](named-bakeoff-shopfront.md) | Fundraising one-pager: named us-vs-them on shopfront + their-game AA (not our run) |
| [`named-harness-shopfront-game-b.md`](named-harness-shopfront-game-b.md) | Named CLI Game B (OpenCode live-path + Cursor session 1281 tok; Claude Code not logged in) |
| [`agent-context-bench-200k.md`](agent-context-bench-200k.md) | Measured 200k dump vs 3.1k shopfront (cover 3073) |
| [`advertisable-stats-and-queue.md`](advertisable-stats-and-queue.md) | What we may plot; S3/Q1–Q4 parked with paste-ready S3 |
| [`aa-comparable-bench-plan.md`](aa-comparable-bench-plan.md) | How we run AA-style benches ourselves — no fake Sequence AA bar |
| [`subagent-failure-diagnosis.md`](subagent-failure-diagnosis.md) | Why canon dumps Stop builders |
| [`agency-loop-why-it-works.md`](agency-loop-why-it-works.md) | Mega-branch format |
| [`isometric-map-competitive-read.md`](isometric-map-competitive-read.md) | X isometric/explainer demos — **Code Architecture depth** (P0–P2); Work is plan SoT. Modes: [`../decisions/work-code-modes.md`](../decisions/work-code-modes.md) |
| [`v2-architecture-and-gaps.md`](v2-architecture-and-gaps.md) | **The v2 rebuild plan.** Ten lanes: what is thrown away and kept (measured), the engine contract, the architecture, the gap list against Codex/Claude Code, a wave-by-wave build order with locking tests, the risk register, and where the adversary landed |
| [`board-seat-walk-fulfillment-plan.md`](board-seat-walk-fulfillment-plan.md) | Owner seat-walk checklist — workspace UX, node cards, live status, context window |
| [`ml-harness-adoption.md`](ml-harness-adoption.md) | **The v2 reference implementation.** ml-harness measured against Sequence on tool calling, prompting, the composer and local text — what to port wholesale, what to adapt, what must never leak in, and the engine gaps it exposes |
| [`v32-scale-and-gaps.md`](v32-scale-and-gaps.md) | **Measured** scale (4.0s / 1326 nodes; board caps at 24 cards so paint is flat — the cost is SCAN, uncached) + the honest can-this-replace-a-main-agent answer: no, the gap is agency over time |
| [`shell-sessions-wave-plan.md`](shell-sessions-wave-plan.md) | Shell wave — sessions sidebar v2, chat home context, side-by-side layout, opaque vs glass specimens |
| [`workspace-composer-ledger.html`](workspace-composer-ledger.html) | **Pick sheet** — two specimens each for chat icon, workspace layout, composer context (open in browser) |
| [`workspace-structure-ledger.html`](workspace-structure-ledger.html) | **Pick sheet round 2–5** — C+B hybrid workspace, node corner icons, three boards (Architecture / Whiteboard / AI Canvas) |
| [`thinking-loading-ledger.html`](thinking-loading-ledger.html) | **Pick sheet round 2** — five live-animation specimens (A–D candidates + E shipped baseline) + ASCII spinner gallery |
| [`thinking-loading-fusion-ledger.html`](thinking-loading-fusion-ledger.html) | **Final pick sheet** — three B×C fusions, expanded chat column mocks (pick 1 / 2 / 3) |
| [`chat-canvas-live-ledger.html`](chat-canvas-live-ledger.html) | **Target sheet** — Codex-class chat→canvas live visualization (today vs target, wire contract) |
| [`chat-canvas-live-gap.md`](chat-canvas-live-gap.md) | Executable gap + build waves L1–L4 for real-time canvas blocks |
| [`archify-competitive.md`](archify-competitive.md) | Archify skill competitive read — borrow map vs Sequence moat (2026-08-27) |
| [`ai-canvas-tool-contract.md`](ai-canvas-tool-contract.md) | **Locked** — five native AI Canvas writers (`canvas.write_*`); closed set for tool calling |
| [`ai-canvas-moat-audit.md`](ai-canvas-moat-audit.md) | **Measured** (2026-09-18) — what of the reader's drawing reaches the model, what the agent can draw and animate, the tldraw gap list, and the three changes that landed with it |
| [`walk-4-white-glass-plan.md`](walk-4-white-glass-plan.md) | **Plan of record** (2026-09-18) — white glass becomes the default look, tuned darker and frosted toward Cursor's agent window; the goal bar collapses its plan; every site capture retaken; 0.1.1 ships only on the owner's word |
| [`carrying-harness-plan.md`](carrying-harness-plan.md) | **Plan of record** (2026-09-18, harness lane) — the carrying harness: every refusal a small model hits and what it becomes, five waves (carry the model, the canvas the agent can see and lay out, runs that survive, a harness others can run, measure), the first build slice |
| [`phase-a-dogfood-scorecard.md`](phase-a-dogfood-scorecard.md) | Phase A M1–M7 dogfood sheet (fill from measured asks only) |
| [`phase-a-metrics-harness.md`](phase-a-metrics-harness.md) | A2.1/A3.6 harness how-to — canned M2/M4/M3; M1 stays owner live |
| [`a6-path-scoped-cache-spike.md`](a6-path-scoped-cache-spike.md) | A6.2 — W1.4 per-part cache measured; scanRepo still whole on miss |
| [`a4-soft-session-switch.md`](a4-soft-session-switch.md) | A4.4 — keep reload session switch; hydrate-in-place deferred |
| [`phase-b-bakeoff-scorecard.md`](phase-b-bakeoff-scorecard.md) | Phase B B6 bakeoff sheet — empty until owner runs; no invented % |
| [`phase-d-public-beta-gate.md`](phase-d-public-beta-gate.md) | Phase D public-beta checklist (D1–D8) — owner metrics stay empty until measured |
| [`c2-browser-done-when.md`](c2-browser-done-when.md) | C2.1 Browser Done when — tool+panel over fake Chrome (landed C2.5) |
| [`c2-browser-security-review.md`](c2-browser-security-review.md) | C2.4 Browser/net-browse security — SSRF/caps before any outbound fetch |
| [`c3-desktop-inventory.md`](c3-desktop-inventory.md) | C3.1 Desktop inventory — cloud vs Mac; public CTA stays clone+start.sh |
| [`ask-control-flow.md`](ask-control-flow.md) | B1.5 ask intent paths — draw/edit early-exit, round caps, shared loop guards |
| [`c2-plugin-manifest-v0.md`](c2-plugin-manifest-v0.md) | C2.3 plugin manifest v0 + ask `call_plugin` (readonly builtins) |
| [`v2-next-phase-mega-plan.md`](v2-next-phase-mega-plan.md) | Post-MVP executable program — Phases A–D trust, speed, surfaces, public beta |
| [`mega-plan-requirement-audit.md`](mega-plan-requirement-audit.md) | Living A–D evidence map vs mega-plan; OWNER rows stay empty |
| [`mega-plan-visual-breakdown.html`](mega-plan-visual-breakdown.html) | Phase A–D visual summary (charts, before/after, UI mockups) — tip `d35d7782` |
| [`agent-workflow-mega-plan.md`](agent-workflow-mega-plan.md) | **Board → approve → long-running agent graph** — competitor/options research, Option E spine, Phases 0–6, harness tiers, owner decisions |
| [`agent-workflow-mega-plan-visual.html`](agent-workflow-mega-plan-visual.html) | Agent workflow phase visual — journey, Option E, dual surfaces, tiers |
| [`harness-checklist-audit.md`](harness-checklist-audit.md) | Scored audit vs the 12+2 harness-engineering checklist — ASK vs PROGRAM asymmetries, five ranked gaps with file-level sketches |
| [`beat-the-field-roadmap.md`](beat-the-field-roadmap.md) | Synthesis of three research lanes into a build order — the turn-budget/score ladder, sandboxed exec, cache-shaped context, what we deliberately do not build |
| [`memory-systems-adoption.md`](memory-systems-adoption.md) | supermemory / mem0 / Letta / Zep / Hermes / Prime Agent compared — the three local-first patterns adopted and the self-improvement loop over existing trajectories |
| [`eval-and-teaching-adoption.md`](eval-and-teaching-adoption.md) | SWE-bench/ACI eval practice + published tutoring science (Khanmigo, LearnLM, BEA-2025) — bench practices and the teach rubric v2 |

## The 2026-09-04/05 measurement nights — teach mode, grounding, and the benches

Predictions are registered **before** their runs and kept even when refuted; a `-result` note is
read against its own `-prediction`. A refuted prediction is not deleted — that is the point of
writing it down first.

| file | what it settles |
| --- | --- |
| [`re-baseline-2026-09-05.md`](re-baseline-2026-09-05.md) | The ranges every later arm of the night is compared against |
| [`belt-length-ablation.md`](belt-length-ablation.md) | Is the teach belt's LENGTH the cost? — registered before the numbers |
| [`belt-length-control-prediction.md`](belt-length-control-prediction.md) | The length control — registered before the first call |
| [`belt-length-control-result.md`](belt-length-control-result.md) | Indeterminate as registered; decisive against the right comparison |
| [`mid-belt-arm-prediction.md`](mid-belt-arm-prediction.md) | The mid-belt arm — registered before the first call |
| [`mid-belt-arm-result.md`](mid-belt-arm-result.md) | Both arms refuted — the belt hypothesis is finished |
| [`belt-shape-experiment.md`](belt-shape-experiment.md) | The lever is real; this change is not the one |
| [`deterministic-visual-prediction.md`](deterministic-visual-prediction.md) | The visual decided in code, not asked for in the prompt — registered |
| [`deterministic-visual-result.md`](deterministic-visual-result.md) | The metric moves, and the second prediction fails |
| [`redirect-visual-prediction.md`](redirect-visual-prediction.md) | Does the propose_topology redirect move the visual metric? — registered |
| [`redirect-visual-result.md`](redirect-visual-result.md) | Both predictions refuted, and a third cause of zero visual |
| [`derived-checkin-prediction.md`](derived-checkin-prediction.md) | The check-in decided in code — registered before the runs |
| [`derived-checkin-result.md`](derived-checkin-result.md) | The prediction is met, and half of it should not be banked |
| [`checkin-gate-result.md`](checkin-gate-result.md) | The check-in gate: 11 and 10 of 47, inside [9,13]; and the visual at 21 of 47 against a [1,3] baseline |
| [`closing-beat-shape-prediction.md`](closing-beat-shape-prediction.md) | Requiring the closing beat to be a CHECK — registered |
| [`are-the-checkins-questions.md`](are-the-checkins-questions.md) | Are teach mode's check-ins questions? — 31 of them, measured |
| [`skipper-first-scored-run.md`](skipper-first-scored-run.md) | Do teach mode's questions need the lesson? — 10 of 31 |
| [`thinking-on-vs-off.md`](thinking-on-vs-off.md) | Reasoning on vs off on teach SHAPE — and the flat band that could not fail |
| [`reasoning-on-plain-asks.md`](reasoning-on-plain-asks.md) | **Registered, unrun** — reasoning on vs off on a PLAIN ask, scored on answered-from and correctness |
| [`provider-boundary.md`](provider-boundary.md) | **Registered, unrun** — what the Ollama client path gives and withholds against the runtime's own API |
| [`trust-strip-seat-read.md`](trust-strip-seat-read.md) | The trust strip measured as a stranger — 48 px, once per repo, ruled on already, no change landed |
| [`route-parity-plain-ask.md`](route-parity-plain-ask.md) | The plain ask on both routes: 0 drift over 40 turns, with the detector shown to detect |
| [`counting-gate.md`](counting-gate.md) | The counting gate: prediction refuted (331/331), and two defects found outside the standing gate |
| [`design-page-disagreements.md`](design-page-disagreements.md) | Where this lane disagreed with the three design pages, including one change I under-built |
| [`scripted-seat.md`](scripted-seat.md) | **Registered, unrun** — the scripted seat: type, reload, reopen, ask again; four screens and a transcript |
| [`next-picture-checkin.md`](next-picture-checkin.md) | **Registered, flag off, unrun** — ask the prediction before the picture that answers it (pretesting) |
| [`lesson-checkpoint.md`](lesson-checkpoint.md) | The lesson checkpoint: schema version, build stamp, migration on open, and the fork |
| [`teach-reasoning-off-prediction.md`](teach-reasoning-off-prediction.md) | A teach turn does not think out loud — registered before the run |
| [`teach-tool-budget.md`](teach-tool-budget.md) | The tool budget per turn kind, and why a teach turn gets two rounds |
| [`lesson-kinds.md`](lesson-kinds.md) | Lesson kinds — the contract, and the first experiment |
| [`subject-condition-prediction.md`](subject-condition-prediction.md) | The repository-less condition, and the first lesson kind — registered |
| [`sequence-condition-prediction.md`](sequence-condition-prediction.md) | A bench condition that can see the re-export change — registered |
| [`sequence-condition-result.md`](sequence-condition-result.md) | The sequence condition: refuted on both clauses, and the fall tracks conceptGiven not the chart |
| [`walk-condition-prediction.md`](walk-condition-prediction.md) | The walk condition: registered before any run — six conversations change, the two new-scan arms are the control |
| [`walk-condition-result.md`](walk-condition-result.md) | The walk condition: every registered prediction confirmed, and the checkpoint prediction at last on one build |
| [`seat-read-2026-09-06.md`](seat-read-2026-09-06.md) | The seat run: refuted on two lines, and one missing lesson.json explains all three DIFFs |
| [`next-picture-result-2026-09-06.md`](next-picture-result-2026-09-06.md) | The next-picture band has no denominator: 7 questions, 0 reveals, because the bench cannot carry a prediction |
| [`next-picture-rerun-registration.md`](next-picture-rerun-registration.md) | The next-picture bands re-run under the repaired bench: kill number five reveals, registered before the run |
| [`next-picture-rerun-result.md`](next-picture-rerun-result.md) | The re-run: the carrier works (3 of 4 landable questions revealed) and the band is killed at 3 of 11 |
| [`ceiling-condition-registration.md`](ceiling-condition-registration.md) | Moving the reveal ceiling: a longer conversation first, bands registered before any run |
| [`ceiling-condition-result.md`](ceiling-condition-result.md) | The ceiling moved 4 landable questions to 19; two clauses refuted, one of them badly registered |
| [`design-the-stalled-lesson.md`](design-the-stalled-lesson.md) | A lesson that keeps drawing and stops asking: the queue never advances, and the instrument has a hole |
| [`advance-rule-registration.md`](advance-rule-registration.md) | The advance rule: a turn that taught advances whether or not it asked — kill number under 3 repeats against 17 |
| [`design-what-the-model-receives.md`](design-what-the-model-receives.md) | What the model actually gets on a turn: 46% instructions, 0.8% lesson, none of the 2,884 file edges, 99% re-sent every turn |
| [`prefix-once-registration.md`](prefix-once-registration.md) | Sending the workspace once instead of every turn: two variants by wire, with the drift clause the local one needs |
| [`belt-condition-registration.md`](belt-condition-registration.md) | Trimming the TOOLS section: on a first-tier ask the belt is 1,363 tokens and 100% tool instructions |
| [`carry-cardbound-result.md`](carry-cardbound-result.md) | The carry: calls a turn unmoved, repeats confounded by a change that shipped between control and treatment |
| [`proposed-law-the-control.md`](proposed-law-the-control.md) | Proposed to the research lane: a control taken before an unrelated change is not a control |
| [`belt-condition-result.md`](belt-condition-result.md) | Refuted: removing the TOOLS section made tool calls rise fifteenfold — the section constrains, it does not teach |
| [`seat-turn-three-result.md`](seat-turn-three-result.md) | Turn three read as an engineer: three of four checks green and the thread broken at turn 2 |
| [`carry-redesign-registration.md`](carry-redesign-registration.md) | Stage four registered: the planted-fact experiment is void because the carry is structurally empty on an engineer ask |
| [`belt-second-question-registration.md`](belt-second-question-registration.md) | Does the product draw for an engineer? A new question with its own clauses — the old belt condition stays refuted |
| [`belt-rerun-registration.md`](belt-rerun-registration.md) | The belt re-run: fabrication measured at last, with its threshold and its power limit registered first |
| [`belt-rerun-result.md`](belt-rerun-result.md) | Fabrication measured: 0 of 52 claim-checked turns in every arm — no detectable rise, and the belt now has a full verdict |
| [`belt-second-question-result.md`](belt-second-question-result.md) | Refuted: no picture in twelve turns, and the model never once asked to draw |
| [`exit-code-isolation-audit.md`](exit-code-isolation-audit.md) | Every exit produced alone: one unreachable guard, one unproved, and four causes sharing a code |
| [`carry-wiring-registration.md`](carry-wiring-registration.md) | Wiring the carry into the product: two mechanisms, two flags, and a teach half registered with regressions only |
| [`carry-wiring-result-teach.md`](carry-wiring-result-teach.md) | Charts did not fall; three of four clauses destroyed by a bench that wrote every arm to one path |
| [`carry-wiring-result-teach-rerun.md`](carry-wiring-result-teach-rerun.md) | All four clauses measured, none refuted — and the chart rise did not replicate, so it was control variance |
| [`carry-referents-result.md`](carry-referents-result.md) | Clause 1 refuted: the carried list reaches the prompt and the model does not use it |
| [`carry-placement-registration.md`](carry-placement-registration.md) | Does WHERE the carried block sits matter? Three placements, six arms, with the multiple-comparison discount registered first |
| [`carry-placement-result.md`](carry-placement-result.md) | All three placements refuted — it is not where the block sits |
| [`carry-pointed-probe.md`](carry-pointed-probe.md) | A diagnostic, not a measurement: can the model use the carried list when the question points straight at it? |
| [`carry-pointed-probe-result.md`](carry-pointed-probe-result.md) | Pointed at the list, the model answers from prose instead — and 12 informative arms have never named one of the three |
| [`carried-context-uptake.md`](carried-context-uptake.md) | **THE RESULT.** A model does not use carried context it did not fetch itself — 12 informative arms, three positions, two wordings, zero uptake |
| [`carry-instruct-registration.md`](carry-instruct-registration.md) | The last untested variable: does INSTRUCTING the model to use the block change anything? Registered with the belt run as its prior |
| [`design-the-counting-gate-for-strangers.md`](design-the-counting-gate-for-strangers.md) | The counting gate as something another repository can adopt: three literals pin it, and it has no test of its own |
| [`design-instruments-after-the-window.md`](design-instruments-after-the-window.md) | Three instrument repairs the window points at, and the card-free reproduction that comes first |
| [`design-the-subjectless-lesson.md`](design-the-subjectless-lesson.md) | A lesson request with no subject: refuse and name what is missing, not seed a subject the learner did not ask for |
| [`bench-vs-product-call-prediction.md`](bench-vs-product-call-prediction.md) | Why the product ran ~17x slower than the bench — registered |
| [`reexport-edges.md`](reexport-edges.md) | The product had been missing one dependency edge in eleven |
| [`reexport-effect-on-the-bench.md`](reexport-effect-on-the-bench.md) | Which of the night's numbers move with 251 more edges — registered |
| [`prompt-service-edges-prediction.md`](prompt-service-edges-prediction.md) | The prompt stops rolling imports up — registered before the change |
| [`container-edges-prediction.md`](container-edges-prediction.md) | Do container edges exist? — registered before looking |
| [`queue-paraphrase-prediction.md`](queue-paraphrase-prediction.md) | buildQueue on natural phrasing — registered before the change |
| [`env-read-forms.md`](env-read-forms.md) | Which env-read forms the extractor sees |
| [`expression-position-env-slot.md`](expression-position-env-slot.md) | The expression-position fact slot — design, not built |
| [`seat-check-2026-09-05.md`](seat-check-2026-09-05.md) | The pictures still had not been looked at, and what stopped it |
| [`seat-read-2026-09-05.md`](seat-read-2026-09-05.md) | A derived chart, on the route users actually drive |
| [`ten-from-the-night.md`](ten-from-the-night.md) | Ten things the night established, and what each is worth doing about |
| [`repo-on-the-board-2026-09-09.md`](repo-on-the-board-2026-09-09.md) | A real repo on the board: 1 connector for 1101 nodes, and why the obvious fix is refused |
| [`agent-drawing-and-teaching-visuals.md`](agent-drawing-and-teaching-visuals.md) | Why the teach drawings are bad (the product asked for three boxes), and what a tldraw-class agent canvas would actually take |
| [`code-canvas-program.md`](code-canvas-program.md) | The tldraw equivalent: the Whiteboard already IS the spatial canvas, and the agent could neither see nor draw on it — the waves that close that, plus the IDE files panel and the session lock |
| [`agent-draw-harness-moat.md`](agent-draw-harness-moat.md) | **Moat research 2026-09-15** — Diagram IR → layout → scene peer; §10–§14 languages / translation / latency Pareto / SeqDraw S0–S8 fix path |
| [`agent-draw-research-program.md`](agent-draw-research-program.md) | **Research CLOSED** — R0–R7 rounds (competitive, in-tree audit, IR/wire, layout, co-edit, licence); implementation gate; wait for owner build call |
| [`ui-redesign-drafts-brief.md`](ui-redesign-drafts-brief.md) | The harness UI redesign: what the macOS and 21st.dev research actually returned (and what it did not), plus the binding brief for three comparable design drafts |
| [`draft-v3-macos-harness.md`](draft-v3-macos-harness.md) | **Draft V3** — from-scratch Apple liquid-glass harness mock, then Graphite skin toggle (`ui-drafts/draft-v3-macos-harness.html`) |
| [`v3-hd-ui-gate-t3.md`](v3-hd-ui-gate-t3.md) | **HD UI gate** — Sequence V3 vs sibling `t3code` clone; locking harness + checklist (not a bakeoff %) |
| [`overhaul-formats-v2.md`](overhaul-formats-v2.md) | Overhaul formats v2 (2026-10-05): ontology v2 (api, external, tags), composite board view state, map.md grammar and budget, agent-event schema |
| [`pi-and-opencode-study.md`](pi-and-opencode-study.md) | Pi coding agent vs Sequence (2026-10-12): gap map, six ranked trust changes, and OpenCode's keyless web tools |
| [`rea-security-review.md`](rea-security-review.md) | Security review of the bundled Reverse Engineer Anything component: ship with edits and a safety preamble |

Do not invent “50% cheaper” or “beats LangGraph.” Live 200k accuracy % is UNFINISHED.
