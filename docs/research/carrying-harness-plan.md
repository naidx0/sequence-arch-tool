# The carrying harness — a plan to make Sequence carry small models, and let others run it

**Opened 2026-09-18** on the owner's instruction, after the MiniMax Code read
(`docs/research/README.md` names it): *"everything you guarded and found to empower our agents to
work well in our system, let's make a plan and then build off of that; I'm not big on refusals with
dumb models, so our system should change in that sense; take-soon items also in this plan; reason
about what could empower a harness as a whole, our moat in mind, and build a way others can replace
their current harness setup with something better; go deeper into our moat, the AI Canvas and its
auto setup."*

**Status:** plan of record for the harness lane. Waves are ordered; each row names the file it owns,
the behaviour it changes, and the test that locks it. Line numbers were verified on 2026-09-18 and
will drift; the identifiers will not.

---

## 0. Ground truth, in one table

Everything below was measured on the tree (`harness-checklist-audit.md`, `ai-canvas-moat-audit.md`,
and the two inventories taken on 2026-09-18). "Exists" means built and reachable from the product.

| Area | Exists | Does not exist |
| --- | --- | --- |
| Ask loop (`askPipeline.ts`) | Round caps 8/16/32, unproductive-round stop, once-per-turn latches, cumulative de-duplicated evidence ledger, per-turn read cache, one corrective round for malformed tool JSON, forced final answer, prompt-cache breakpoint, syntax gate on written files, `done_when` gate, change receipt | A steer before the stop (the model is told nothing new, the turn just ends); argument repair before the corrective round; an approval channel (a denied call is refused, never asked about); a turn that survives a closed socket |
| Goal runner (`goalRunner.ts`) | 24-turn cap, strikes and parks, a stop row on disk, 14 named stop reasons, per-turn checkpoint, plan file with gate-is-not-a-step refusal | Any check before a step is ticked beyond the model saying so; a plan when the model writes none (`no_plan_written` ends the run); a verdict at the end (the run stops at `turn_cap` with no audit) |
| Tools (`askTools.ts`) | 20 registry tools plus canvas, board and diagram writers; uniform `{ok, evidence}`; refusals name the fix; `who_calls` blast radius in one call; `read_topology` lists real ids on a miss | Resolution on a near miss (`who_calls "askPipeline"` is refused when `packages/analyzer/src/server/askPipeline.ts` is the only candidate); line numbers on an ambiguous `edit_file`; a fuzzy match on a stale `oldString` |
| Provider (`provider.ts`) | Two wires (Anthropic messages, OpenAI-compatible); one retry without thinking on a reasoning-only reply; retries clamped 0 to 5, default 0; honest context-window discovery for Ollama | Retry on an allow-list (a 401 and a 429 are handled the same: not retried); quota separated from rate limit; a MiniMax preset; reasoning blocks carried between turns on the OpenAI wire |
| Canvas (`AiCanvas.tsx`, `Whiteboard.tsx`) | Five typed writers, charts validated against the graph, a SeqDraw pad the agent appends to by id, persistence of blocks on the server, point-to-ask on charts, a deterministic lane layout (`systemBoardLayout.ts`) | The agent seeing what the reader drew (the freeform plane never fills the board channel); positions in the document (they live in the browser's localStorage); any re-layout after first placement; seeding the canvas from the scan; the lane layout reachable from the product |
| Others running it | 15-tool MCP server; ACP client; `sequence ask --json --done-when`; six provider presets | An ACP server (editors cannot drive Sequence's loop); `sequence goal` headless; a receipt in the JSON output; a harness profile others can copy |

---

## 1. The rules of the harness

These are the design laws for the waves below. Each one is a sentence the code can be checked against.

1. **Repair before refuse.** A tool call that can be made valid is made valid, and the repair is
   named in the evidence. A refusal is reserved for a call that cannot be made true (an invented
   node, a write outside the jail, a mutation in Plan mode).
2. **Route before stop.** When the loop would end for lack of progress, the model is first told
   what repeated and told to change one thing. The stop comes after the steer, never instead of it.
3. **Prove, then claim.** A goal step is done when evidence says so. The run ends with an audit
   that names each requirement and what proved it, not with a turn count.
4. **The graph answers first.** A question about structure is answered from the scan; a file is
   opened to cite, not to discover. This is the token saving the site measures and the reason a
   2.5B model can hold a repository.
5. **Coverage still gates the answer.** Nothing here weakens `scanCoverage`, the premise check or
   `contextFit`. Repairing a call is not the same as inventing evidence.
6. **A turn always ends in words, and a run always ends in a verdict.**
7. **Everything durable is on disk under `.sequence/`.** Steers, audits and receipts are rows, not
   memory.
8. **The canvas is a document the agent can read.** What the reader draws reaches the model in the
   same channel the agent's own items use.

---

## 2. Every refusal, and what it becomes

The owner's instruction is specific: a small model should not hit dead ends. This table is the
whole of "not big on refusals" turned into behaviour. Refusals that stay are the ones that protect a
law.

| Refusal today | Where | Becomes |
| --- | --- | --- |
| `who_calls found no node matching "X"` | `askTools.ts` `executeWhoCalls` | Rank candidates (exact, suffix, label, basename, then the same fuzzy used by `@` mentions). One clear best: run it and prefix the evidence with `resolved "X" to <id>`. Several: return them as evidence, `ok: true`, with the instruction to pick one. None: refuse as today. |
| `read_topology unknown service "X"` | `executeReadTopology` | Same resolution over service ids and labels. |
| `read_file "X" not found` | `executeReadFile` | Resolve a unique basename or path suffix inside the jail and read it, saying so; several matches listed; none refused. |
| `locate_symbol takes one identifier` | `executeLocateSymbol` | Extract the first identifier from the string (a small model sends `locate_symbol("the runAskPipeline function")`). |
| `edit_file "oldString" appears N times` | `executeEditFile` | Keep the refusal, add the line numbers of every occurrence. |
| `edit_file "oldString" not found` | `executeEditFile` | One bounded fuzzy pass: trailing whitespace, smart quotes, dashes, line-number prefixes stripped; the match is mapped back to the original bytes and refused if the normalised span differs. Evidence says `matched after normalising whitespace`. |
| Malformed tool JSON, one corrective round | `askPipeline.ts` corrective block | Before the corrective round: repair the common shapes (single-quoted JSON, trailing commas, a JSON string where an array was expected, `edits` as a string, `path` with a leading `./`). Repaired calls execute this round; the evidence names the repair. The corrective round stays for what repair cannot fix. |
| `AI Canvas tools are not active for this turn` | `askTools.ts` canvas gate | On a repo, active for any explain, what, how, why, show ask (already widened 2026-09-18 for explain-file); the plot-ask inversion that refuses every writer in favour of `propose_chart` is removed: both are on, and the belt says which fits. |
| Mutating tool in Plan or Teach | `mutatingToolRefusal` | Stays. In Plan, `edit_file` and `propose_files` are routed to a proposal instead of refused; Teach stays read-only (a law). |
| `run_command` outside Build | dispatch gate | Stays; the message already names the switch. |
| `THERE IS NO APPROVAL CHANNEL OPEN IN AN ASK TURN` | `askTools.ts` permission verdict | In the app: emit `permission:ask` on the stream, hold the call for a bounded wait (60 s), and the composer's permission control answers it; a denial is recorded in the receipt. Headless keeps the refusal. |
| `no_plan_written` ends the goal run | `goalRunner.ts` plan turns | After the second empty plan turn the harness writes a skeleton itself from the goal text and the graph (files named in the goal, their importers by depth 1, a verify step), and the third plan turn asks the model to refine it. The run never ends for lack of a plan while the graph can supply one. |
| Unproductive rounds end the turn | `askPipeline.ts` `spentOnNothing` | One steer first: a message naming what repeated (the same call, the same error family, no new evidence) and asking for one changed variable or a different route. The stop follows only if the next round repeats. |
| Goal run stops at `turn_cap` | `goalRunner.ts` | The last turn is a completion audit (§3, A4) and the run ends in `PASS`, `PARTIAL` or `FAIL` with reasons, not a bare cap. |
| `the_model_only_narrated` after four turns | `goalRunner.ts` | The narration nudge fires on the first narrated turn (it fires today after one, then the counter runs to four); on the second, the harness issues the step's most likely first tool call itself (read the file the step names) so the model has evidence to act on. |
| Reasoning-only reply | `provider.ts` | Stays (one retry with reasoning off). |
| Untrusted echo | `askPipeline.ts` | Stays. |

---

## 3. The waves

### Wave A — carry the model (engine, first)

| # | Ship | Owns | Done when (locked by) |
| --- | --- | --- | --- |
| A1 | **Argument repair** before validation: single quotes, trailing commas, string-encoded arrays and objects, `edits` as a string, `./` paths, `path` given as `file` | `askTools.ts` new `repairAskToolArgs` called from `parseAllToolRequests`; `askPipeline.ts` corrective block reads the repaired set | `ask-tool-repair.test.ts`: six malformed shapes execute in the same round with evidence naming the repair; a shape repair cannot fix still takes the corrective round |
| A2 | **Resolve, don't refuse** for `who_calls`, `read_topology`, `read_file`, `locate_symbol` per §2 | `askTools.ts` resolvers, sharing `rankMentions`-style scoring in one helper `resolveAskTarget` | `ask-resolve.test.ts`: a basename resolves to the one path; two candidates come back as evidence with `ok: true`; an invented name is still refused |
| A3 | **Steer before stop**: one runaway steer per turn, on the same call repeated, the same error family, or two rounds of no new evidence | `askPipeline.ts` between the unproductive count and the stop; steer text in `askTools.ts` | `ask-steer.test.ts`: a scripted provider repeating a call gets the steer once, then the stop; the steer never counts as a strike in a goal run |
| A4 | **Completion audit and verdict** in the goal runner: on the last allowed turn, or when every step is ticked, a final turn whose scaffold is the audit (requirements from the goal and plan, evidence per requirement, PASS / PARTIAL / FAIL); the verdict is written to `goal-run.json` and shown in the goal bar | `goalRunner.ts` (new stop reasons `audited_pass`, `audited_partial`, `audited_fail`), `goalPlan.ts` (audit scaffold), `web2/src/v3/goalRunVerdict.ts` | `goal-runner.test.ts`: a run whose steps are all ticked ends in an audit turn; a PARTIAL names what was unverified; `V3GoalRun.test.tsx` renders the three verdicts |
| A5 | **Anti-substitution and fidelity clause** in the live goal voice: optimise for the requested end state, not the easiest passing change; never redefine success around what exists | `goalPlan.ts` `renderGoalSection` live voice | `goal-plan.test.ts`: the clause is present in the live voice and absent from the idle voice |
| A6 | **Plan skeleton from the graph** when the model writes none | `goalRunner.ts` plan turns; `goalPlan.ts` `skeletonFromGraph(goal, graph)` | `goal-runner.test.ts`: a bare goal naming two files yields a plan with a read step per file, an edit step, a verify step, and the run continues |
| A7 | **Narration to action**: nudge on the first narrated turn, harness-issued read on the second | `goalRunner.ts` | test: two narrated turns produce one nudge and one harness read; the counter still ends the run at four |
| A8 | **Line numbers on ambiguous edits, bounded fuzzy match on a stale `oldString`**, fail-closed | `askTools.ts` `executeEditFile`; helper `fuzzyLocate` | `edit-file.test.ts`: the refusal lists lines; smart quotes match and map back; a widened span that differs after normalising is refused |
| A9 | **Approval channel in the app**: `permission:ask` stream event, bounded wait, answer from the permission control; denial recorded in the receipt | `askPipeline.ts`, `askTools.ts`, `api-types`, `web2/src/chat/PermissionControl.tsx`, `state/store.ts` | `permission-ask.test.ts` (engine) and `PermissionAsk.test.tsx` (UI): a denied rule under Build with the app attached asks once and executes on allow; headless still refuses |

### Wave B — the canvas the agent can see and lay out

This is the moat work. Nothing here adopts tldraw; the AI Canvas is Sequence's own surface and
the plan finishes it. "Auto setup" is defined here for the first time: **the harness seeds, places
and re-flows the canvas without the model inventing coordinates, and the reader's marks are part of
the document the agent reads.**

| # | Ship | Owns | Done when |
| --- | --- | --- | --- |
| B1 | **LANDED BEFORE THIS PLAN** — `withDrawingState` already merges the reader's marks. **The agent reads the drawing.** `session.canvasDrawing` (notes, noderefs, strokes named by `summarizeStrokes`) fills `AskSurfaceBoard` for the AI Canvas plane, blurry and focused like the blocks | `web2/src/state/connect.tsx` (`withBoardState` fed the drawing), `state/store.ts`, `explain/askSurface.ts` renderer | `canvas-read-half.test.ts`: a note and a recognised box reach the prompt as `note "…" at top-left` and `box near "gateway"` |
| B2 | **LANDED (commit 4).** **Positions in the document.** `CanvasDocBlock` gains `frame {x, y, w, h}`; the SeqDraw pad reads and writes them; `PUT /api/sessions/<id>` carries frames and the drawing, so a canvas restored on another machine keeps its arrangement | `web2/src/state/types.ts`, `sessions/canvasMemory.ts`, `analyzer/src/server/sessionsStore.ts`, `repoServer.ts` canvas-doc route | `canvasRestore.test.tsx`: frames survive a reload from the server with localStorage cleared |
| B3 | **Auto layout.** New artifacts are placed by the lane layout (`systemBoardLayout.ts`, reachable for the first time) with collision avoidance against existing frames; `diagram.layout` re-flows a track while respecting pinned frames (a frame the reader moved is pinned) | `web2/src/draw/systemBoardLayout.ts`, `materializeCanvasArtifacts.ts`, `whiteboardModel.ts` (`pinned`), `analyzer/src/server/diagramTools.ts` | `materializeCanvasArtifacts.test.ts`: twenty artifacts never overlap; a pinned frame keeps its position through a re-layout; the same IR twice gives the same geometry |
| B4 | **LANDED (commit 3).** **Auto seed.** On an explain, draw or design ask with a repo, the harness places a grounded frame before the model speaks: the topology of the ask's scope (services and edges from the scan, each card carrying `nodeId`), laid out by B3. The model annotates and patches it by id instead of starting from an empty pad | `askPipeline.ts` (seed step emitting `board:item` before round 1), `boardTools.ts` (card builder reused), `askIntent.ts` scope | `home-workspace-canvas.test.ts` and a new `canvas-seed.test.ts`: an explain-file ask emits a seeded frame with real node ids; a design ask on the home workspace seeds nothing (no scan) |
| B5 | **Grounding law on the pad.** A card that claims code cites `nodeId` or `path:line` or is drawn as a sketch; the two never look alike | `whiteboardModel.ts`, `CodeCard.tsx`, `boardTools.ts` | `board-tools.test.ts`: a card with an invented id is refused whole; a sketch note renders without the code frame |
| B6 | **Select-and-ask for drawn parts** (charts have it): a selected note, card or recognised shape becomes a composer chip | `Whiteboard.tsx`, `connect.tsx`, `canvasBlockChip.ts` | `Whiteboard.test.tsx`: selecting a card lands a chip naming it |
| B7 | **Redo, marquee, resize handles** (the three tldraw-parity items the audit ranks first) | `Whiteboard.tsx`, `whiteboardModel.ts` | `whiteboardModel.test.ts`: redo restores an undone frame; marquee selects two; resize writes `wb/resize` with an undo frame |

### Wave C — runs that survive

| # | Ship | Owns | Done when |
| --- | --- | --- | --- |
| C1 | **Retry on an allow-list**, quota and auth separated from rate limit, sixteen error kinds with a plain message, default retries 2 with Retry-After honoured and half-jitter backoff | `provider.ts` classifier and `requestModelTextWithUsage`; `web2` composer shows the kind | `provider-retry.test.ts`: 401 and `credits_exhausted` retry zero times; 429 honours Retry-After; a network error retries twice |
| C2 | **An ask turn survives a closed socket.** The turn runs to its end on the server (as goal runs do); the client replays from `?since=` on reconnect | `repoServer.ts` `/api/ask/stream` (detach abort from socket close), `askTurnLog.ts` (comment is stale and becomes true), `web2/src/state/connect.tsx` reconnect | `ask-stream-detach.test.ts`: killing the client mid-turn leaves the provider called to the end and the log complete |
| C3 | **Evidence receipts on trim.** When `selectCarriedEvidence` drops a tool result it leaves a one-line receipt naming the tool and arguments and saying it is not evidence; goal, plan and todo state are never trimmed | `askTools.ts` `selectCarriedEvidence` | `ask-evidence-ledger.test.ts`: a dropped read leaves `[earlier read_file src/x.ts, trimmed; not evidence]` |
| C4 | **Reasoning carried between turns** for models that need it: on the Anthropic wire keep thinking blocks in history; add a MiniMax preset over the Anthropic-compatible endpoint with `think` preserved; on Ollama thinking models keep the `reasoning` field out of the answer (already) and out of the history (new) | `provider.ts`, `providerPresets.ts`, `explain.ts` history renderer | `provider-thinking.test.ts`: a two-turn Anthropic conversation resends the signed block; the MiniMax preset probes and saves |

### Wave D — a harness others can run

The strategic note in `docs/CANON.md` says the strongest position may be as the MCP server other
harnesses consume. This wave makes both true: our graph inside their loop, and our loop runnable by
them.

| # | Ship | Owns | Done when |
| --- | --- | --- | --- |
| D1 | **`sequence goal`** headless: start a goal run from the CLI, stream its turns, exit with the audit verdict as the exit code | `packages/analyzer/src/cli.ts`, new `goalCli.ts` | `goal-cli.test.ts`: a run on a fixture repo exits 0 on PASS, 7 on FAIL, and prints the receipt |
| D2 | **The receipt in `--json`**: runId, rounds, stopReason, tools with arguments, model route, policy hash, retries, corrections, rollback point (the audit's check 14) | `askCli.ts`, `askPipeline.ts` (`tool:start` carries arguments) | `ask-cli.test.ts`: every field present; absent-not-zeroed |
| D3 | **An ACP server mode**: `sequence acp` speaks the Agent Client Protocol so Zed, JetBrains and any ACP editor can drive Sequence's loop, with the graph tools on the belt | new `packages/acp-server` on `@agentclientprotocol/sdk` | `acp-server.test.ts`: an ACP session runs an ask and receives tool events |
| D4 | **The harness profile**: a documented set a team copies into a repo: `AGENTS.md`, `.sequence/permissions.json`, `.sequence/done-when`, skills under `.sequence/skills`, a provider preset; plus `docs/replace-your-harness.md` showing three setups (Claude Code plus our MCP, our loop with their model, our loop headless in CI) | `docs/`, `packages/analyzer/src/server/instructions.ts` (skills roots include `.agents/skills`) | `docs-catalog` gate; a fixture repo with the profile passes `sequence doctor` |
| D5 | **Coverage first on the MCP server**: `coverage` is the first tool listed and every graph answer carries its coverage line, as CANON asks | `packages/mcp/src/index.ts` | `mcp.test.ts`: `who_calls` output ends with the coverage line |

### Wave E — measure it

Before Wave A lands, record a baseline on the local default model (`minicpm5-hermes`) over twenty
asks on this repository and five goal runs: refusals per turn, tool rounds per turn, turns ending in
`no-progress`, draw rate on explain asks, goal runs ending in a verdict. After each wave, the same
twenty asks. The numbers go in `docs/research/data/` and the site's Difference section quotes only
what moved. The MiniMax read is the reason this wave exists: their numbers were taken in other
people's harnesses, and ours should be taken in ours, on the model our users actually run.

---

## 4. Order, and the first build

A1, A2, A3, A4, A5, A6, C1 first: they are engine-only, each under a day, each with a locking
test, and together they are the difference between a small model dying at round two and a small
model finishing. Then B1, B2, B4 (the canvas the agent reads and the auto seed), then A8, A9, C2,
C3, C4, then D1, D2, D4, then B3, B5, B6, B7, D3, D5.

The first commit on this plan carries A1, A2, A3 and C1 with their tests; the second carries A4,
A5, A6, A7; the third opens Wave B.

**Landed.** Commit 1 (A1 `askToolRepair.ts`, A2 `askResolve.ts`, A3 the steer in `askPipeline.ts`,
C1 `classifyProviderError` in `provider.ts`) and commit 2 (A4 `auditThen` and `parseAuditVerdict` in
`goalRunner.ts` with the audit voice in `goalPlan.ts` and three `audited_*` stop reasons; A5
`FIDELITY_CLAUSE`; A6 `skeletonFromGoal` in place of the third plan turn; A7 `narrationNudgeHard`
with the harness read on the second narrated turn) are on main. The audit turn replaces the last
allowed turn at the cap and adds one turn after a worked-down plan; a reply with no `VERDICT:` line
leaves the run on its pre-audit reason and records why in `lastAuditNote`.

Commit 3 opens Wave B with **B4, the auto seed** (`boardSeed.ts`, seeded from `askPipeline.ts`
before round one) and records that **B1 was already built**: `withDrawingState` in
`web2/src/app/workspaceAskSurface.ts` merges the reader's marks into the board channel and
`workspaceAskSurface.drawing.test.ts` locks it, so that row needed a check rather than a build.
Commit 4 carries **B2, positions in the document**: `CanvasDoc.frames` keyed by the pad's own
artifact id (a map, not a field per block, because a chart is not a block and the artifact id is
already the key every side agrees on), written by the drawing reducer, carried by the session PUT
and honoured by the layout. Writing it found a second instance of the defect `CanvasDoc.forSession`
was added for: a session switch stamps a fresh empty canvas with the NEW id in the same dispatch
that leaves the pad reporting the OLD thread's artifacts, so an identity check cannot see it. The
guard is the document's own artifact ids instead. B3 is the remaining Wave B work.

## 5. What this plan does not do

It does not add a shell sandbox (Sequence does not run arbitrary shell for the user; the allowlisted
runner stays). It does not adopt tldraw or any canvas package. It does not raise the round caps; it
spends the existing rounds better. It does not weaken coverage, the premise check or the untrusted
wrappers. It does not bump the version; the 0.1.1 gate is the owner's.
