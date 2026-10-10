# Teaching flow: the plan

**End state, one sentence:** a "teach me / break down X" turn turns the engine into a
lesson that explains the root flow and every supplementary part, and draws that flow on the
AI canvas as an ordered, steppable, animated diagram grounded in scanned files and edges —
and opening a service on the architecture board shows the same kind of flow of its parts,
not a directory listing.

Owner, 2026-09-22 (verbatim, trimmed): "when I ask to teach it, it should turn itself into
teaching mode … dive into what that means at root … explain all the working components that
are supplementary … create a detailed maybe even animated diagram on the AI canvas which
shows the flows coming from engine sending all of the AI token requests into the harness".
And on the board: "I don't want to play with the architecture board that comes up initially
… when I click on that service I want a macro diagram of how everything comes together,
apart from the files within each service".

## What is wrong today (measured, with the line)

From the explorer on the pipeline (head `df12bcda`):

1. **A classified teach turn is not a lesson.** `classifyAskIntent` returns `teach` for
   "teach me" (askIntent.ts:83-84, 226) and the pipeline sets `teach: true` on the input
   (askPipeline.ts:3185-3190), but the server hands `beginTeachTurn` only the toggle
   (`body.teach === true`, repoServer.ts ~5536). With the toggle off — his real state, a Plan
   chat — `beginTeachTurn` returns `NOT_TEACHING` (teachTurn.ts:94): no lesson, no concept,
   `propose_plan` offered but never asked for (askPipeline.ts:2318-2333), thinking left on
   (teachTurn.ts:77-79), so the model plans "TEACH MODE" in its reasoning and answers briefly.
2. **The teach rules forbid the dive.** "EXACTLY ONE concept … at most ~150 words"
   (askPipeline.ts:1996), "NEVER advance to a second concept … NEVER dump an outline"
   (2029-2030), grader rejects over 250 words (2603-2607, 4418). A first-turn learner who
   "knows nothing" needs the root overview naming every part and hop; these lines send the
   opposite.
3. **The teach floor draws nothing without a concept.** `buildConceptChart` returns nothing
   when there is no `concept.nodeId` (conceptChart.ts:55); with a repo attached the fallback
   (askPipeline.ts:4310) is skipped.
4. **The forced draw round accepts a note.** `forcedDrawDemand('canvas')` asks for "a diagram,
   a chart or a note" (askPipeline.ts:3082-3086); a markdown note satisfies it and one draw
   call of any kind ends the round (5291-5297). It never asks for a flow.
5. **No tool returns a flow.** `who_calls` gives one hop (askTools.ts:2772, 2824-2860);
   `read_topology` gives modules and files; the only flow tracer is client-side
   (`flowForFunction`, web2/src/rail/railModel.ts:525-545) and the model cannot call it.
6. **Nothing on the AI canvas animates.** Story routes are a list with prev/next
   (CanvasStoryNav.tsx:14-46); `walk_example` renders `TeachWalk` stepped by hand, and its
   chart highlight is unwired (`onFocusPart` never passed, AiCanvas.tsx:394). The board's
   flow playback runs only from the Index rail (ConnectedIndexRail.tsx:257); no chat event
   reaches it.
7. **The service interior is a directory listing.** Modules are directory clusters
   (cluster.ts), edges are not rolled up between them, and nothing orders them as a flow.

Sections for the canvas primitive (explorer 2), role grouping (explorer 3) and the live
baseline (explorer 4) are appended below as they land.

## Slices, in dependency order

Each slice has its own gate and lands on its own; none waits for a later one.

### Slice 1 — a teach turn is a lesson, and it explains the root first (pipeline + guidance)

- `repoServer.ts` (~5536): pass `isTeachTurn({ teach: body.teach, question })` into
  `beginTeachTurn`, so a classified teach turn gets the lesson, the first concept, the
  `propose_plan` step and thinking off. Keep `body.teach` as the toggle's own meaning
  elsewhere.
- `askPipeline.ts` guidance: a **first-turn root overview** exception to the one-concept
  rule — when the lesson has no prior concept (or `teachKnown === 'new'`, or the question
  asks for "at the root" / "how it works" / "break down"), the turn names every component
  and every hop between them in order, in plain words, then offers the first concept to go
  into; word ceiling for that turn ~350 with the grader aligned. Guidance, not a gate: say
  what is wanted, not what is forbidden (see memory: small models read guidance as rules).
- `forcedDrawDemand('canvas')` on a teach turn asks for a **flow**: a `propose_chart`
  data-flow (or the flow block from Slice 3 once it exists) whose items are the components
  named in the answer, in the order the data moves; a note does not satisfy it.
- Teach floor: with no concept, draw from the question and the answer (the components the
  answer named) rather than nothing.
- **Gate:** unit tests in `ask-tool-loop.test.ts` / teach tests (a teach-classified turn with
  the toggle off has a lesson and `reasoningEffort: 'none'`; first-turn overview guidance is
  present only on the first turn; the forced round refuses a note on a teach turn); the live
  battery `teach-flow` case (explorer 4's shape) scored as a rate against the baseline.

### Slice 2 — `trace_flow` tool (engine)

Move `flowForFunction`'s logic to the server as an ask tool: `trace_flow({ from, to? })`
returns ordered hops `[{file, symbol, line, edgeKind}]` with evidence, or the honest refusal
"no scanned path". Offered on teach and draw turns. Gate: `ask-tool-belt.test.ts` on the
shopfront fixture with a real call chain; the model's tool sequence in the battery.

### Slice 3 — an animated flow block on the AI canvas (client + tool)

Explorer 2's ruling (appended below): no new block kind. `propose_chart`'s flow family
gains an ordered `steps` list `{from, to, says, detail?}`; the chart renders left-to-right
with a stepper (Play/Pause, Prev/Next, the current hop and its two nodes lit, the rest
dimmed), grounded like every chart (steps must match links, so scanned edges are checked).
Wire `onFocusPart` so `walk_example` highlights the chart part it is on. Gate: schema, chart
and AiCanvas tests; the live case's drawn source carries steps.

### Slice 4 — the service interior as a flow of roles (scan + board)

Explorer 3's design (appended below): role buckets from scanned evidence, edges rolled up
between them, laid out as a flow; the top-level board unchanged. Gate: `serviceInterior`
tests on the ML Harness shape, a screenshot.

### Slice 5 — a chat turn can play the board's flow

A `canvas/flow` dispatch from a chat action so a lesson can animate engine → provider →
harness on the board when the learner is looking at it. Gate: store test + e2e anchor.

## The edge (out)

- The top-level architecture board's look and layout: unchanged.
- No new model, no fine-tuning; the local model as configured.
- Voice-over, video export, and a general animation editor.

## First shippable slice

Slice 1, built this session by a builder in a worktree off `a0b3f4f8`.

## Explorer 2: the canvas primitive (head `df12bcda`)

- Five block kinds (markdown, mermaid, svg, html, react; canvasTools.ts:9-24) plus the chart
  pipeline (`propose_chart`, 45 kinds; askTools.ts:3430). Nothing steps a path hop by hop.
  html/svg/react may animate themselves (`@keyframes`, SMIL: canvasTools.ts:116-150).
- `TeachWalk` has Back/Next and no autoplay (TeachWalk.tsx:22-27); its `onFocusPart` is passed
  nowhere (AiCanvas.tsx:313, :394). Charts already have a spotlight (`focusItemId`,
  chartLayout.ts:90-95, charts.css:194-205).
- **The story nav is only in `AiCanvas`, which the app never mounts** — V3Shell mounts
  `ConnectedAiCanvas` (V3Shell.tsx:202) and that has no nav (AiCanvas.tsx:409-462). A story
  route is saved (store.ts:2231-2238) and never shown. Same class as the unmounted V3 surfaces.
- Board playback: `FlowPlayback {hops[], cursor, playing}` (types.ts:364-379), one timeout per
  hop (canvasChannel.tsx:197-213), dim off-path (flowFocus.ts:153-194), started only from the
  Index rail (ConnectedIndexRail.tsx:257). askPipeline.ts:503-505: "no tracer can build a
  FlowPlayback".
- Mermaid 11.17.2 client-side, `securityLevel: 'strict'`, no click hooks (MermaidBlock.tsx:206).
- **Ruling for Slice 3: extend `propose_chart`'s flow family with an ordered `steps` list,
  not a new block kind.** Steps must match links (so every step between two real nodes goes
  through the scanned-edge check, chart.ts:395-411). New: `steps` in schema/src/chart.ts,
  the tool schema and hint (askTools.ts:5823-5840, :5334), `activeStep` on FlowChart.tsx, a
  `FlowStepper` (TeachWalk + Play/Pause/Prev/Next, reduced motion), marching-dash keyframes in
  charts.css, wiring in AiCanvas.tsx:301/:386 (which also connects `onFocusPart`). ~210 lines
  + ~150 of tests; the four pinned tool-name tests stay green. Caps to respect: 40 chart
  items (chart.ts:311), 120 KB per block, `ChartBoundary` around any renderer.

## Explorer 3: role-based flow inside a service (head `df12bcda`)

- The scan has file→file import edges with evidence (scan.ts:948-961), test detection
  (`isTestFile`, testFiles.ts:29-50 — used only to keep tests out of clustering, which is
  why ML Harness has exactly 49 loose files: all tests), paths, and a words-to-role dictionary
  (`SIGNALS`, explain/fileSignals.ts:50-194). No file carries a role; no import is rolled up
  above a service (`buildLift` stops at service/datastore/topic, project.ts:55-67).
- `serviceInterior` keeps only raw edges with both ends placed (serviceInterior.ts:182-183);
  every import is file→file, so **the modules level has zero edges and ELK falls back to
  rectpacking** (layout.ts:274-277). That is the "floating modules".
- On the real ML Harness scan (143 files, 264 import edges, one service `web/`), a role
  bucketing (tests / build & glue / look & brand / startup / engine & connections / screens /
  models & readers) gives 49/5/4/1/19/38/27 and a flow Startup → Engine, Screens → Models
  (67) and Engine (26), Engine → Models (5), Tests → Models/Engine/Screens.
- **Caveat that matters for his example:** the scan holds only `web/`. The Python `app/`,
  `tests/` and `scripts/gate.py` were never scanned, so "the gates" are not in the graph and
  no grouping can draw them. Covering the Python side is its own slice (scan detection).
- Grounding: "every diagram node id must exist on the ArchGraph" (seqdFromGraph.ts:31-36);
  a synthetic group card is refused. So role groups must come from the SCAN as
  `kind:'module'` nodes with `meta.role` (second slice; touches module-identity /
  module-naming-honesty / doctor / digest tests).
- **First slice (export only):** a lift-parameterised roll-up in `serviceInterior` —
  lift each import edge's ends to the nearest placed card, count per pair, drop self-loops,
  majority direction at 3:1, drop pairs under 3, keep the heaviest 12, label `N imports`.
  ELK's layered layout then orders the modules left to right. Locking test on the ML Harness
  fixture with the real module-level counts (Readers→Ui 14, Ui→Panes 14, Engine→Ui 6,
  Panes→Engine 5, Ui↔Panes 14:3).

## Explorer 5: why ML Harness's Python side is not in the scan

- Discovery takes the code-first path (scan.ts:414-426). `discoverCodeFirst`
  (discovery/codefirst.ts:364-375) checks workspaces first: the root `package.json` declares
  `"workspaces": ["web"]`, so `rootDirs = ["web"]` and `collectManifestRoots` — the walk built
  to split "a Python root with a JS UI beneath it" (codefirst.ts:284-307, whose comment names
  ml-harness) — never runs. The root `pyproject.toml` (`[project] name = "ml-harness"`) and
  `setup.py` are never read. Second trap: `ecosystemOf` returns the first manifest in
  `ROOT_MANIFEST_FILES`, and `package.json` is first (codefirst.ts:87-88, 188-190).
- Files outside every service are never parsed (scan.ts:617-627); the graph's own
  `unscanned` field already says what it skipped: tests 394, frontend 162, app 134, scripts 66,
  evals 15, packages 12. The scan is current (scannedAt after the last commit; all 143 file
  ids exist on disk). Discovery is the gap, since the root `package.json` was added (ff43949).
- Fix (Slice 6, building): when workspace members exist AND the root has a real non-JS
  manifest and source outside the members, run the manifest walk with the root's ecosystem set
  to the non-JS one and union with the members; a tooling-only `pyproject.toml` must not make
  a giant root service. Expected after a rescan: `svc:ml-harness` at `.` (~641 files incl.
  `scripts/gate.py`), `frontend`, `web` as today. **He needs to rescan ML Harness after it
  lands** (`functions.json` too).

## The live baseline (explorer 4, six runs on a copy of ML Harness, 2026-09-22)

Same prompt, Plan chat, three runs with the Teach toggle off and three on, under the GPU lock.
Every run classified `teach`. Scored against the owner's intent:

| | root flow engine→model | names harness, gates, UI | drew on the AI canvas | drawing is a flow | grounded |
|---|---|---|---|---|---|
| off ×3 | 0/3 | partial, no real gates | 2/3 (one stream died) | 1/3 | partial |
| on ×3 | 0/3 | partial | 3/3 | 2/3 | 2/3 |

What the runs showed, each with the line in the logs
(`scratchpad/teach-baseline/` in this session's temp folder):
- **The scan never saw the engine.** Every explanation stops at `web/src/harness/engine.ts`;
  the model→provider hop and the gates live in `app/*.py`, which `graph.unscanned` listed.
  Fixed on main by `181c727e` (needs a rescan).
- **The teach rules capped the dive** ("at most ~150 words" quoted back in the model's own
  reasoning). Fixed on main by Slice 1 (`edcc9a2c`..`9d0f8bda`).
- **Module-level links were refused six times** — "no edge mod:…/0 -> mod:…/3 … a chart may
  not invent a connection" — because the chart check sees only file→file edges while the
  board now rolls them up. Building: the chart check lifts scanned edges to modules/services.
- **The example question was copied verbatim** as the answer's closing line ("Which component
  do you think the auth service calls next?") in both r1 runs; this repo has no auth service.
  Building: the example is built from this repository's own labels.
- **Searches died in `.venv`** ("no matches (stopped after 5000 files)"). Building.
- **r3 (off): the stream died inside the forced draw round** at t=410 s — `propose_chart`
  started, no `tool:end`, no `result`; and the battery printed PASS with `drew`, because the
  engine auto-places one box at every turn start and the judge counts it. Diagnosing.
- The best drawing (r3 on) was a four-hop system chart ui → platform → harness-server →
  engine → gateway with correct line citations; the only real flowchart (r3 off) went into the
  chat text as Mermaid and was then overwritten by the rewrite.

## Landed on main since the plan (2026-09-22, evening)

- Slice 1 (`edcc9a2c` `bf57f610` `05f4ea15` `9d0f8bda`): classified teach turn is a lesson
  with thinking off; first-turn root overview (~250–350 words, grader at 400); forced round
  demands a data-flow and a note does not answer it; the floor draws the flow the answer named.
- Slice 3 (`13c01365` `e0dcb4c5` `c1244b1d`): `propose_chart` flow charts carry ordered
  `steps`; `FlowStepper` plays hop by hop (Play/Pause/Prev/Next, marching dash, reduced
  motion honoured); `walk_example` lights its part.
- Slice 4a (`6183b0f0` `b04df3ef`): module→module import edges in the service interior; on
  ML Harness 6 modules now carry 8 edges and lay out as a flow.
- Slice 6 (`181c727e`): a workspaces-only root `package.json` no longer hides a Python root;
  the ML Harness copy scans to 946 file nodes across `.`, `frontend`, `web` (`src-tauri`
  shows as a 0-file service), `unscanned` empty, `file:scripts/gate.py` present.
- Chat naming at the start of the first turn, once (`a0b3f4f8`, gated to request-named
  threads in `b5883301`).

## Explorer 6: the stream death (r3) and the judge

- Not a deadline. `tool:start propose_chart` at t=410 s, then the socket ended 3 ms later:
  `askPipeline.ts:5429-5434` pushes `tool:start` and awaits `executeAskTool` with no
  try/catch (the main-loop sites at ~5005/5054 and the rescue sites ~5279/5329 are the
  same); `executeAskTool` (askTools.ts:1541-1635) catches nothing; `repoServer.ts:6064-6105`
  handles only `RequestAbortedError`/`ProviderError` and rethrows the rest, and the last
  guard (repoServer.ts:2188-2194) sees headers already sent and calls `res.end()` with no
  frame and no stderr line; the battery starts the engine with `stdio: 'ignore'`.
- The likely thrower: `validateChart` (schema/src/chart.ts:366) checks `nodeId !== undefined`
  and then lower-cases it (`normaliseRef`, :211); `nodeId: null`, a number or an object all
  throw a TypeError (reproduced against `schema/dist`). The model had just been told to "drop
  the nodeId", which a small model writes as `null`.
- The turn deadline (`ASK_TURN_DEADLINE_MS` = 180 s, askTools.ts:762) is soft and checked only
  at the top of the loop (askPipeline.ts:4243-4245); neither the draw contract (5372-5385)
  nor the answer rescue (5227-5232) checks it, so the forced round began 94 s past it.
- Fix (Slice 7, next): `nodeId` accepted only as a string; `executeAskTool` body in try/catch
  returning `refused: <name> failed: <msg>`; the route emits `{type:'error'}` + `res.end()` +
  `finalizeTrajectory` and a stderr line instead of `throw e`; the draw contract and rescue
  skip when out of time and end the turn with the answer plus the harness note.
- The judge (`a192b631`, landed): a drawing counts for the model only inside its own drawing
  tool call and only when not refused; the seed is nobody's; a stream ending on a bare
  `tool:start` fails.
- Why the model never called `who_calls` or `read_topology` with a `module`: each module row
  carries 5 sample paths and 40 of 264 edges with no word that the list is partial
  (askTools.ts:2530, :2543, :2552); the `who_calls` hint (askTools.ts:5505) frames it for
  "what uses this / what breaks", not for tracing how one part flows into another; the chart
  refusal (chart.ts:501-502) says "draw it as a concept" rather than pointing at `who_calls`.
  r3's reasoning: "That's the only edge I can verify." Slice 2's `trace_flow` is the answer.

## Landed on main, second batch (2026-09-22, night)

- Chart links between modules (`6494b163` `18652269`): the chart check lifts every scanned
  edge to the containers around its ends, so a module→module or service→service arrow is held
  to the imports between their files — the six live refusals no longer fire for real flows —
  and a refused arrow names up to three pairs the scan does connect from its start.
- Teach-turn faults from the baseline (`bef2bc64` `13aa067b` `7f77bf2a`): `search_files`
  skips hidden and dependency folders and says how many (on the ML Harness copy 4,698 of the
  5,000 walked files were `.claude/worktrees`, not `.venv` as first read); a note in the main
  loop no longer counts as a lesson's drawing; the closing example names a part of THIS
  repository (`gateway` on shopfront, `ml-harness-app` on ML Harness) and a verbatim copy of
  it is bounced by the grader.
- No silent stream death (`0d6d55c9` `6bc1adf0` `72159172`): a chart item's `nodeId` must be
  text (null lands the chart as a concept); a tool that throws is a refusal the model reads,
  with a stderr line; an unknown error mid-stream ends the stream with an `error` frame and a
  receipt. Still open from Explorer 6: the draw contract and the answer rescue do not check
  the turn deadline (Slice 7b).
- The battery judge (`a192b631`): a drawing counts for the model only inside its own drawing
  call; the seed is nobody's; a stream ending on a bare `tool:start` fails.
- Hygiene found by three builders at once: in a fresh worktree `tools/ci` shows two
  `site-links` failures (`spawnSync npm ENOENT` — the test spawns `npm`, not `npm.cmd`) and a
  `canon-paths` failure on `GRAPHITE-DECISIONS.md:2913` (a sentence saying `app/BootSmoke.tsx`
  is gone is read as a citation). Both pass in the owner's checkout; both cost every builder a
  base run. Fix the two tests so a clean tree is green.
- Slice 2 (`44c4ab07`): `trace_flow({ from, to?, depth? })` — the flow the scan can prove,
  breadth-first, ordered by edge kind then label, ≤24 hops, shortest path with `to`, files
  read as their module when traced from a service or module, and a ready `propose_chart`
  data-flow skeleton at the end that validates against the same graph. On the teach, plan,
  build and work belts; `who_calls` and `read_topology` point to it; `read_topology` now says
  its edge list is a sample. The rail's `flowForFunction` and the tool agree on every hop of
  shopfront (test-locked). Known gaps: `locate_symbol` does not find Python `def`, so a bare
  Python name cannot start a trace (`file.py#name` works); a flow that reaches a topic does not
  continue to its subscribers, because the scan records consume edges consumer → topic.

## The re-measure (six runs at `53cc2a8d`, 2026-09-22 late; case `teach-flow` is now in the battery, `18c9d480`)

| | baseline | now |
|---|---|---|
| root flow engine→model | 0/6 | 1/6 (partial: "routed to model providers (`app/providers`)") |
| names harness, gates, UI | partial, no real gates | harness + UI 6/6; real gates (`app/diagnosis.py`, ledgers, `gate.py`) 0/6 |
| drew on the AI canvas | 5/6, one stream died | 5/6 (model 2, harness floor 3); 0 streams died |
| drawing is a flow | 3/6 | right order 2/6; with `steps` 0/6 |
| grounded | partial | names real 6/6; claims right 2/6 |

What the runs showed, with the line: 5 of 6 stopped on `stopReason: deadline` (180 s) with
25–38k chars of thinking each — on lesson turns that set `reasoningEffort: 'none'`
(diagnosing: does the value reach the wire on every round?). `trace_flow` was called in 3/6
runs (`client.ts → app/main.py — 1 hop`; `app/main.py — 24 hops`) and its chart skeleton was
never drawn. `read_topology` with `module` 0/6; every call a `svc:` (×3 per run). The harness
floor drew 3 of the 5 charts in the answer's order of mention ("the arrows follow the order
the answer gave, not edges the scan found"). r1's final answer was the model's reasoning
(begins "I need to ground my teaching…", ends `</think>`) after a 7,575-char root overview
had streamed and was dropped; raw `sequence-tool` fences streamed as text. Building: the floor
draws the trace's skeleton or scanned order; a reasoning-shaped rescue is never the answer and
the streamed answer stands; fences never stream as text; the judge reads deltas too.
Deadline fix (`246d8346`) landed after these runs and is not in them.

## Landed after the re-measure (2026-09-23, early)

- `f1103d2d`: a lesson turn sends `reasoning_effort: none` on EVERY round, over the profile's
  `medium` — the whole 180 s was thinking (r4 call 3: 122.9 s of a 191 s turn); the one round
  that ran with `none` (r3's rescue) produced 0 reasoning chars in 5.8 s.
- `ce5fd3a9`: `read_topology` groups edges by file pair and kind (40 same-pair routes →
  one row), never repeats an edge already shown this turn, caps the service page at 12k, and
  `services: [...]` returns one brief per service with no edges (ML Harness: 1,284 chars for
  the whole app; the fixture page 5,851 → 1,225).
- `b778587b`: the teach floor draws a `trace_flow` made this turn (trimmed to the named
  parts, steps in hop order) or, without one, the named parts ordered by scanned edges; the
  order-of-mention caption only when no edge joins any of them.
- `16b29e48`: leaked `<think>` text is cut from every round; a reply that only plans ("I need
  to…", never addressing the reader) is not the answer on a teach turn or from the rescue; a
  lesson bounced only for length or check-in stands over an empty or planning retry; tool
  fences are held back until known and never stream as text (replayed on the six raw logs:
  fences 5→0 in r1, 1→0 in r4); the judge reads deltas. Open: a lesson bounced for
  grounding still ends on the no-answer line (r1's case) — a ruling for the owner.

## The third measurement (six runs at `10954118`, 2026-09-23 00:15 local)

| | baseline | re-measure | now |
|---|---|---|---|
| engine→model explained | 0/6 | 1/6 partial | 0/6 |
| harness, gates, UI named | partial | harness+UI 6/6, real gates 0/6 | harness+UI 6/6, real gates 0/6 |
| drew on the AI canvas | 5/6, one death | 5/6 | **6/6**, 0 deaths, 0 leaks |
| drawing is a flow | 3/6 | steps 0/6 | **steps 6/6**; a hop to the model 0/6 |
| grounded | partial | names 6/6, claims 2/6 | names 6/6, claims 2/6 |
| median thinking chars | 34,691 | 29,053 | **0** |
| median turn seconds | 233.8 | 271.2 | **15.3** |

The budget fault is closed. What the runs showed next, with the line:
- **With thinking off the model stops digging.** `trace_flow` 0/6 (was 3/6), `read_topology`
  with `module` 0/6, at most two files read (`client.ts`, `app/main.py` lines 1–259 of 3,283);
  r5 answered in 3.2 s with no tool call ("expected at least one tool call and made none").
  A 7B model without a reasoning pass does not plan a research path; the harness has to hand
  it the evidence.
- **The grader's rewrite trades a rich draft for a thin one, in view of the reader.** r1's
  first draft (1,975 chars, naming `security_boundary`, `_check_database_opens`, the `/oc`
  facade — all real in `app/main.py`) was bounced for one uncited file (`hwdetect.py`) and the
  final answer is 96 words; streamed vs final: 4801/691, 4153/1535, 3329/716. No final
  reached the 250–350-word overview. Planning sentences stream as visible text.
- **Invented facts survive.** `/api/ask` in two finals and two drafts; it exists nowhere in
  the copy. r4's final invents a previous turn and ends on a question to the user.
- The floor's charts: all six use scanned order (no trace to follow); three drew the same
  service triangle frontend → ml-harness → ml-harness-app → ml-harness. r2's own model chart
  was closest to the question (ui → engine → provider, "AI token request") and ungrounded.

Building next (Slice 8): the harness gathers the evidence before the first call on a
lesson's first turn — the services brief and a `trace_flow` from the UI's entry file through
the deepest scanned hop — into the prompt; the grader repairs rather than rewrites (drop or
mark the one uncited claim, keep the draft); route strings in an answer are checked against
scanned http edges; planning sentences are not the reader's text.

## Slice 8 landed (2026-09-23, early)

- `9f7e2f37` `21ab5e8c`: on a lesson's first turn the harness gathers the evidence before the
  first call — services brief, a `trace_flow` from each service's entry file (tests never an
  entry) and from the parts the question names, the deepest hop's first 40 lines — capped at
  6k chars, cached as already run, its sources counted as read. On the ML Harness copy the
  trace from `client.ts` reaches `app/providers/__init__.py` and `app/diagnosis.py` (not
  `scripts/gate.py`; 24-hop cap, 112 more at that depth).
- `cd812f11`: the grader repairs a lesson bounced only for an unread citation (the path is
  marked "(not read this turn)", one note, no extra call); a shape failure is bounced once
  asking for one change; a second failure ends on the richest draft; routes not in the scan
  are repaired and noted; a planning lead before a tool round is not streamed.
- `37c355b5`: the floor draws a gathered or model-made trace cut to the parts the answer
  named (two or more on the trace; else scanned order; nothing named, nothing drawn).

## The fourth measurement (six runs at `ada4ec24`, 2026-09-23 01:15 local)

| | baseline | re-measure | measure 3 | now |
|---|---|---|---|---|
| engine→model explained | 0/6 | 1/6 | 0/6 | 0/6 |
| harness, gates, UI named | partial | 6/6, gates 0/6 | same | same |
| drew on the AI canvas | 5/6 | 5/6 | 6/6 | 6/6, 0 deaths, 0 leaks |
| drawing is a flow | 3/6 | steps 0/6 | steps 6/6 | steps 6/6, **on the gathered trace 6/6** |
| grounded | partial | claims 2/6 | claims 2/6 | claims 2/6 |
| median thinking chars | 34,691 | 29,053 | 0 | 0 |
| median turn seconds | 233.8 | 271.2 | 15.3 | **9.0** |

New: evidence section in the first prompt 6/6 (replayed byte-identical, 4,205 chars, deepest
files `app/providers/__init__.py` and `app/diagnosis.py`); an evidence line cited 1/6; the
fuller draft kept over a thinner rewrite 4/6, final ≥ richest draft 5/6; input tokens ~22k
per turn (was ~52k); the model made no tool call in any run — the harness did the research.

What stands in the way now, with the line:
- **The hop to the model is in the evidence and no answer or chart reaches it.** The trace
  row that carries it is labelled by module (`7. Db --import--> facade: app/main.py:182 →
  facade; app/main.py:35 → app/providers/__init__.py`, `ev-r1.txt`); the question's own words
  (engine, model, provider, gates) are not used to aim the trace. All six floor charts open
  on the side hop `client.ts → hwdetect.py (GET /local_specs)`.
- **Every run spent its second call on a check-in-shape bounce the retry failed the same
  way** ("ends by OFFERING the learner a choice"), and answers stay at 82–208 words against
  the 250–350 contract. The harness already derives a check-in; it should append it rather
  than bounce for it.
- **Invented claims pass the grader** (`app/tools/asking.py` for `app/asking.py`: only the
  basename is checked; "SolidFS"; a reversed hop), and a route repair leaves broken prose
  ("sends (a route not in the scan) and related HTTP calls").
- **The battery's `expectTool` fails all six** now that the harness gathers first — the
  instrument, not the turn.

Slice 9 (building): the evidence aims at the question's words — for each named target
(model/provider, gates/diagnosis, engine, UI) the file whose path matches is found and a
`trace_flow` with `to` gives the explicit path, named as such ("the hop to the model
provider: app/main.py:35 → app/providers/__init__.py"), and the floor cuts its chart to that
path first; the check-in is appended by the harness, never bounced for; citations are checked
by full path and a wrong directory is repaired to the basename with a note; route repairs keep
the route text and mark it; the battery case expects the evidence and a chart on the trace,
not a model tool call.

## Slice 9 landed (2026-09-23, morning)

- `c3254864` `8e452a55` `007bbf49`: the question's words aim a trace at each target
  (model/provider, gates, engine, UI, database, and any part it names) — `trace_flow` with
  `to`, written first in the section with file-level names: on the ML Harness copy "The hop
  to the model provider: client.ts → app/main.py → app/providers/__init__.py (app/main.py:35)"
  and "The path to the gates: … → app/diagnosis.py (app/main.py:27)"; a module-level row
  leads with the deepest file hop; the floor draws the aimed path first, whole, from its
  first hop (shopfront: `orders.ts > routes.py > payments_client.py > index.js`).
- `d0623e48` `49de5f78` `63728b94`: a closing choice-offer is replaced by the harness's own
  derived check-in with no second call (`deriveFlowCheckIn` asks about the chart's last hop);
  a mid-lesson comprehension question stands; citations are checked by full path and a wrong
  directory is repaired to the real path with a note; a route not in the scan is marked in
  place, prose kept; the battery case expects the evidence in the prompt and a chart on the
  trace (`expectEvidence`, `expectFlowOnTrace`), not a model tool call — the evidence summary
  rides on the `result` event (a new event type would have crashed web2's reducer).

## The fifth measurement (six runs at `92cf84df`, 2026-09-23 10:12 local)

| | baseline | re-measure | m3 | m4 | now |
|---|---|---|---|---|---|
| engine→model explained | 0/6 | 1/6 | 0/6 | 0/6 | **4/6** at file level |
| harness, gates, UI named | partial | gates 0/6 | same | same | **real gates (`app/diagnosis.py`) 4/6** |
| drew on the AI canvas | 5/6 | 5/6 | 6/6 | 6/6 | 6/6 (floor 5, model 1); 1 leak (r6) |
| drawing is a flow | 3/6 | steps 0/6 | steps 6/6 | on trace 6/6 | on the aimed path from `client.ts` 5/6; provider hop 3/6 |
| grounded | partial | claims 2/6 | 2/6 | 2/6 | names 6/6; claims clean 0/6 |
| median thinking chars | 34,691 | 29,053 | 0 | 0 | 0 |
| median turn seconds | 233.8 | 271.2 | 15.3 | 9.0 | 12.5 (17.9 with r1's 180 s model load) |

New columns: evidence in the prompt 6/6 (5,326 chars, replayed byte-identical); names
`app/providers` 4/6; names `app/diagnosis.py` 4/6; chart on the aimed path from the UI entry
5/6; bounces 2/6 (was 6/6); final ≥ richest draft 5/6. Median answer 119 words.

What stands in the way now, with the line:
- **The files are named; what is said about them is invented.** `app/diagnosis.py` is "the
  five-gate honesty test, executed instead of asserted" (its own docstring); the answers call
  it gateway logic (r3), error gates (r6), run validation (r4). The evidence hands the model
  paths and lines, not what the target file IS. Also `/api/asks`, `/api/ask` (marked), "solid
  SvelteKit", an `auth` module that does not exist.
- **One aimed path per chart, and its first hop is the health check** ("calls main.py over
  HTTP (GET /health)") — the shortest proven path, not the request the question asked about;
  Teach-on runs aimed at diagnosis, Teach-off at providers; no chart drew both.
- **r6**: the model's own step-less chart stood in for the floor's; call 3 streamed ~10k chars
  of thinking as text ("Okay, the user is teaching me … </think>") — the delta hold covers
  fences and planning leads, not a think block streamed as content; the final still ends on a
  choice list. **r2**: bounced for "NO VISUAL" before the floor's chart landed at 16 s (the
  grader ran ahead of the floor — inferred from an offline replay).

Slice 10 (building): the evidence includes each aimed target file's first lines (its
docstring — what it IS) under its path; the aimed chart carries every target the question
named as one flow, and prefers the hop whose label matches the question's request over a
health check when both join the same files; the floor draws before the grader reads, and on a
teach turn a model chart with no steps does not stand in for it; a think block in the deltas
is held like a fence; a closing choice list is replaced like a choice offer.

## Slice 10 landed (2026-09-23, midday)

- `aa59457b`: under each aimed block the target file's own opening docstring or comment,
  quoted (700 chars, cut at a paragraph): on ML Harness "The provider protocol, and the two
  adapters v1 ships. We ship no AI. The user lends us theirs…" and "The diagnosis engine: the
  five-gate honesty test, executed instead of asserted…"; the section is 5,088 chars.
- `13f2e4bb`: the floor's chart is the union of every aimed path from the entry (≤12 parts);
  when the question speaks of a request, a step takes its label from the scanned edge between
  the same files whose label carries that word — ML Harness's first step is now
  `POST /api/threads/*/run`, not `GET /health`.
- `a1af095d`: correction to the fifth measurement's inference — the floor already ran before
  the grader; r2 was bounced because its draft named nothing on the aimed path and the floor
  drew nothing. Now the floor draws the aimed path in that case too, and a model chart with no
  steps no longer stands it down while an aimed path exists.
- `1fffa996`: a think block in the deltas is held and dropped like a fence (r6's ~10k chars);
  a closing question followed by a list of options is replaced by the derived check-in.

## The sixth measurement (six runs at `c702bd5d`, 2026-09-23 10:52 local)

| | baseline | re-measure | m3 | m4 | m5 | now |
|---|---|---|---|---|---|---|
| engine→model explained | 0/6 | 1/6 | 0/6 | 0/6 | 4/6 | **5/6** |
| harness, gates, UI named | partial | gates 0/6 | same | same | gates 4/6 | **`app/diagnosis.py` 5/6**, UI 6/6 |
| drew on the AI canvas | 5/6 | 5/6 | 6/6 | 6/6 | 6/6, 1 leak | **6/6, 0 leaks** |
| drawing is a flow | 3/6 | steps 0/6 | steps 6/6 | on trace 6/6 | aimed 5/6 | **both targets, request edge first, 6/6** |
| grounded | partial | 2/6 | 2/6 | 2/6 | claims clean 0/6 | names 6/6, claims clean 1/6 |
| median thinking chars | 34,691 | 29,053 | 0 | 0 | 0 | 0 |
| median turn seconds | 233.8 | 271.2 | 15.3 | 9.0 | 12.5 | **7.3** |

Battery verdict 6/6 PASS; final ≥ richest draft 6/6; the model made no tool call (the harness
ran nine: three aimed traces, three entry traces, three file reads); all six charts identical:
`client.ts → main.py (POST /api/threads/*/run)`, `main.py → app/providers/__init__.py`,
`main.py → app/diagnosis.py`. Describes providers right 2/6; the diagnosis docstring's phrase
appears 5/6 but its role is right 1/6.

What stands in the way now, with the line:
- **The chart's shape overrides the docstring.** `main.py → diagnosis.py` is drawn as a step
  in the request flow, so three answers put the honesty test on the token path ("runs a
  five-gate diagnosis check before any model answer is returned"). The edge is an import
  (`app/main.py:27`), not a request hop, and nothing says so. The providers quote is cut at
  "Two adapters, and this is decided…" before the adapters are named (`ev-r1.txt`).
- **The evidence prose still says `GET /health`** where the chart says the run route
  (`ev-r1.txt:7/24/38`); Slice 10 relabelled the chart only.
- **Bounces with side effects.** r2: the grader read "Solid.js" (a framework) as a cited file
  that does not exist, and `docs/diagnosis_engine.yaml` — on disk, named in the quoted
  docstring — as missing (it is not a scanned file); the redo opened with "I can't name
  `solid.js`". r3: the retry was byte-identical and the harness then appended its check-in,
  so the answer ends on three questions.

Slice 11 (building): a step over an import edge says so ("imports — not a request hop") in
the chart and the prose; the prose first hop uses the chart's labeller; a target's quote runs
to the end of its first list when the cap allows; the grader treats a cited name as a file
only when it is a scanned path or exists on disk (framework names are not files); a retry
identical to the draft is not re-graded and a closing check-in is appended once.

## Slice 11 landed (2026-09-23, midday)

- `4ec88bb3` `28bb0b82`: the prose names the hop the chart draws (one shared labeller,
  `hopTheQuestionAsked`; the section no longer says `GET /health`), and an import hop says it
  is one, in the chart's step and the aimed block's title: "The path to the gates: … →
  app/diagnosis.py (reached by an import from app/main.py:27, not by a request)"; a hop line
  reads "imports diagnosis.py — a module main.py loads, not a request hop".
- `7e0b011e`: a target's own words run to the end of the list its colon line promises — the
  providers quote now names both adapters (lines 1–14); section 5,734 chars.
- `b145128c`: a capitalised framework name (`Solid.js`, `Next.js`) is not a citation; a file
  on disk the scan skipped (`docs/diagnosis_engine.yaml`) stands; a scanned-but-unread path is
  still repaired. Narrower than asked so `char_freq.js`/`fabricated_module.py` still bounce
  (a made-up `App.js` would pass — a ruling for the owner).
- `8912aedf`: a retry identical to its draft is not re-graded; the draft stands with one
  check-in at the end.

## The seventh measurement (six runs at `4dd2e1fa`, 2026-09-23 11:31 local)

| | baseline | m6 | m7 |
|---|---|---|---|
| engine→model explained | 0/6 | 5/6 | 5/6 |
| harness, gates, UI named | partial | diagnosis.py 5/6 | diagnosis.py 3/6 (run-to-run noise: nothing relevant changed) |
| drew on the AI canvas | 5/6, one death | 6/6, 0 leaks | 6/6, 1 leak (r2) |
| drawing is a flow | 3/6 | both targets + request edge 6/6 | same, 6/6 |
| grounded | partial | claims clean 1/6 | claims clean 0/6 |
| median thinking chars | 34,691 | 0 | 0 |
| median turn seconds | 233.8 | 7.3 | 10.1 |

Verdict from the lane, with the lines: **two faults left are the harness's** — (1) r2's retry
streamed 14,065 chars of planning with no opening `<think>` and a bare `</think>` at the end
(`delta-r2.txt`: "The user is asking for a visual breakdown… Let me make the call. </think>");
the hold catches only a delimited block; (2) on the kept-draft path the draft is restored
without `removeClosingOffer`, so "Which part would you like to explore next?" (r5) and the
copied example question (r6) survive under the appended check-in — two closing questions.
**The rest is the model's residue**: diagnosis on the token path in 5/6 answers against three
explicit "not a request hop" lines and every chart step; providers conflated with the gates
(r6); invented claims. Slice 12 fixes the two; after it the turn shape is done on the harness
side, and the next lever is the model (a larger local model, or a cloud provider for lessons)
— the owner's decision.

## Slice 12 landed (2026-09-23, afternoon) — the harness side of the ask is closed

- `db0f84fe`: a round that opens on the user in the third person or on a plan, and does not
  address the reader in its first 200 chars, is held; a bare `</think>` drops what was held
  and what follows streams; a tool round drops it; past 2,000 chars it goes to the Thinking
  fold as a `reasoning` event, never the answer.
- `f5b97325`: every path that settles on a draft (kept richer, identical retry, repaired,
  retry as given) runs one closing repair — the choice-offer or copied example goes, the
  derived check-in is appended only when the text does not already end on a question to the
  reader.

Where the program stands after seven measurements (baseline `df12bcda` → `4dd2e1fa`):
median turn 234 s → ~10 s; thinking 34,691 chars → 0; stream deaths 1 → 0; a drawing on the
AI canvas 5/6 → 6/6, on the proven path with both target files and the request edge first;
the model hop and the gates named 0/6 → 5/6 (with run-to-run noise of ±2). The residue is the
model's: a 7B model puts the honesty test on the token path against three explicit lines and
every chart step, and invents claims. The next lever is the model used for lessons — a larger
local model, or a cloud provider — which is the owner's decision. The battery case
`teach-flow` stays as the instrument.
