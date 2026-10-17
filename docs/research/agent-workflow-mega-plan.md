# Agent workflow mega plan — Architecture board → approve → long-running graph

**Status:** living executable program · **Created:** 2026-08-28 · **Owner:** Max  
**Tip at authoring:** `65e226b3` (post #143 settings frame; layout classifier on PR #145)  
**Delivery format:** agency-loop mega branches on `packages/` as needed; **this doc is research lane** — tip-bump HANDOFF/AGENTS/CLAUDE only after merges (merge-lanes).  
**Pairs with:** [`v2-architecture-and-gaps.md`](v2-architecture-and-gaps.md) · [`ai-canvas-tool-contract.md`](ai-canvas-tool-contract.md) · [`ml-harness-adoption.md`](ml-harness-adoption.md) · [`archify-competitive.md`](archify-competitive.md) · [`v2-next-phase-mega-plan.md`](v2-next-phase-mega-plan.md) (Phases A–D trust/speed — orthogonal, runs in parallel where file ownership allows)

**Visual summary:** [`agent-workflow-mega-plan-visual.html`](agent-workflow-mega-plan-visual.html)

---

## 0. One-page verdict

| Question | Answer |
|----------|--------|
| What does Max want? | Design architecture on the **Architecture board** → like it → **Build this** → see a **large agentic loop graph** (orchestrator, planner, builder, verifier, UX/scaffold parent agents) → **approve** → launch a **long-running multi-agent workflow** that stays visible on **two connected surfaces**: Architecture (structure, models, files, system detail) + **AI Canvas** (runtime narrative). Click an agent node → edit instructions + scoped files. |
| Do we pick the first option? | **No.** This plan compares five architecture options, three harness tiers, and six competitor classes before recommending **Option E** (event bus + dual projection). |
| What already landed? | **Phase 0 partial:** diagram kind classifier + `circular-loop` layout for `agent-workflow` (PR #145). Server-side `runProgram` (`POST /api/program/run`, SSE, checkpoints). Five built-in Programs in Activity. AI Canvas five writers + live SSE blocks (Waves L1–L5). |
| What is the blocker today? | No `.seqd` → `Program` compile. `fromBoardSeqd` rejects `kind !== 'service-flow'`. No board **Approve → Launch** bar. No agent prompt packs on nodes. No run-event overlay on board nodes. |
| Recommended spine | **Option E:** `.seqd` = design truth; frozen `Program` at approve; unified durable event log; Architecture board + AI Canvas as **two projections** of the same run — not one merged React surface. |
| Anti-claims | Do not invent “beats LangGraph / Claude Code / Devin.” Do not treat LLM-invented topology as Architecture truth. Do not merge Architecture and AI Canvas into one freeform board. |

---

## 1. Owner journey (contract)

**Owner quote (2026-08-28):** *Design on the board → build it → show the huge agentic graph loop → approve → launch long-running workflow with named agents (orchestrator, planner, builder, verifier, UX/scaffold parent). Two connected surfaces, not one merged board. Click agent → see/edit instructions + files.*

### 1.1 User-seat Done when (whole program)

| Step | Human sees |
|------|------------|
| Design | Architecture board shows grounded or accepted ghost topology; agent-workflow kinds use **circular loop** layout, service-flow uses LR/TD as classified. |
| Intent | “Build this architecture” (or equivalent) is discoverable from board chrome — not buried in Activity only. |
| Preview | Before launch: board swaps or overlays to the **compiled agent graph** (same loop shape Max described); each node shows role title + model/runtime badge. |
| Inspect | Click agent node → side panel: **prompt pack**, `agentRef`, **scope files**, autonomy hint — editable **before** launch; read-only audit trail **after**. |
| Gate | Explicit **Approve & launch** — no silent start. Pause/resume visible on long runs. |
| Run | Architecture board: node borders pulse by status (`pending` / `running` / `waiting_human` / `done` / `failed`). AI Canvas: orchestrator streams phase cards, markdown plans, mermaid sub-flows via the five native writers only. |
| Trust | Closing the tab does **not** kill the run (server-side). Event log replayable from `.sequence/runs/<id>/events.jsonl`. |
| Honesty | Checker/verifier nodes are deterministic grounded gates — agents propose, checker commits. No fabricated “completed” without evidence. |

### 1.2 Inverted-fix ban

- Do **not** satisfy “show the loop” by dumping a static PNG or a one-shot mermaid in chat only.
- Do **not** collapse Architecture + AI Canvas into one Miro-style surface (owner ruled two boards).
- Do **not** fix persistence by stripping `agent-workflow` back to `service-flow`.
- Do **not** make Temporal/Inngest the **user-visible** model in v1 — durability can be local `.sequence/` first.

---

## 2. Competitive landscape (research synthesis)

Market splits into **authoring graphs**, **runtime monitors**, and **architecture maps**. Sequence must borrow mechanisms, not copy products.

### 2.1 Competitor matrix

| Class | Examples | What they do well | What Sequence must **not** copy |
|-------|----------|-------------------|-----------------------------------|
| **Graph authoring + runtime** | LangGraph Studio, LangGraph Cloud | Explicit nodes/edges; checkpoint pause/resume; thread_id durability; “not every step is LLM” | Export-only interop as the **primary** truth; LangGraph store as Architecture source |
| **Role crew plots** | CrewAI (Agent + Task + Crew) | Readable role names; sequential/parallel/hierarchical process types | LLM-invented topology replacing scan-grounded `.seqd` |
| **Trace / eval monitors** | LangSmith, Langfuse | Id-numbered event log; span tree; replay; eval datasets | Freeform canvas as orchestration UI |
| **IDE agent streams** | Cursor Agents, Codex item stream, Claude Code | Subagent isolation; environment cards; background sessions; worktree handoff | ReAct soup as default; 45-tool breadth chase |
| **Architecture maps** | Windsurf Codemaps, Archify, DeepWiki | Instant visual payoff; plain-English “map this repo” | LLM-generated maps as **Architecture board** truth |
| **Autonomous builders** | Devin, OpenHands | Long-horizon plan → execute → verify loops; optional auto-proceed timers | Marketing “fully autonomous” without grounded gates |

### 2.2 Borrow register (steal mechanism → Sequence landing)

| Borrow | Source | Sequence landing | Phase |
|--------|--------|------------------|-------|
| Durable id-numbered event log | LangSmith, ml-harness | Extend `programRunStore` `events.jsonl` + monotonic `seq` | 2–3 |
| Checkpoint pause/resume | LangGraph, Claude `/rewind` | Wire existing `RunCheckpoint` + seat UX | 5 |
| Plan → human gate → run | Devin 30s proceed vs LangGraph interrupt | **Owner decision** (§8.1) — default recommend explicit approve | 2 |
| Single tool registry | ml-harness | Reuse analyzer tool schema; canvas stays five writers | 3 |
| Subagent isolation + summarized return | Claude Code, Cursor | ACP `agentRef` + `shareSession`; orchestrator emits canvas blocks, not full child transcript | 4 |
| Environment / repo cards | Cursor Cloud, Codex | Activity run row + board node badge: repo path, branch, model | 3 |
| Parallel fan-out | LangGraph `Send` | `parallel` Program nodes (already in schema) | 6 |
| Validate-before-show | Archify | Checker nodes + `validateProgram` before launch | 2 |
| Graph as workflow monitor | LangGraph Studio time-travel | Board node status overlay from SSE | 3 |
| Explicit graph vs ReAct soup | LangGraph docs | Deterministic `branch`/`loop`/`checker` in `Program`; LLM only in `agent` bodies | 1–2 |

### 2.3 Sequence moat (do not abandon)

From [`archify-competitive.md`](archify-competitive.md) and [`v2-architecture-and-gaps.md`](v2-architecture-and-gaps.md):

- **Architecture board** = scan-grounded `.seqd` with evidence rows — not LLM-invented maps.
- **AI Canvas** = five typed writers only — runtime narrative without format sprawl.
- **Local-first** — core attach/scan/board works with no key.
- **Grounded checker** — agents propose graph ids; deterministic verifier commits.

---

## 3. Architecture options (evaluated, not first-seen)

Five options were compared for how **design** (`.seqd`) becomes **execution** (`Program`) and how **two surfaces** stay in sync.

| Option | Shape | Pros | Cons | Verdict |
|--------|-------|------|------|---------|
| **A** | `.seqd` → compile → `Program` → `runProgram` | Reuses shipped scheduler; single compile step | Needs schema for agent fields; one-way unless rebuild | **Core of recommendation** |
| **B** | LangGraph export / interop | External runtime maturity | Two runtimes to test; Architecture truth drifts; local-first weak | **Defer** — optional export in Phase 6+ |
| **C** | `.seqd` only + event log projection | Minimal new types | No deterministic control flow; loops are LLM-guessed | **Reject** — violates program.ts principles |
| **D** | Bi-directional sync (run edits rewrite `.seqd`) | Pretty “live editing” demo | Highest complexity; merge conflicts; lies about grounded state | **Reject** for v1 |
| **E** | **Event bus + dual projection** | `.seqd` design truth; frozen `Program` at approve; unified event log; board + canvas as projections | Requires compile + projector modules | **Recommended spine** |

### 3.1 Option E — detailed shape

```
┌─────────────────────────────────────────────────────────────────┐
│  DESIGN TIME (.seqd on Architecture board)                       │
│  kind: agent-workflow | service-flow | …                         │
│  nodes: roles, prompts, agentRef, scopeFiles (Phase 1 schema)    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ Approve & launch
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  compileSeqDiagramToProgram(diag, templateTier) → Program        │
│  validateProgram → snapshot frozen at run start                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ POST /api/program/run
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  runProgram (server) → events.jsonl (seq, kind, nodeId, payload)│
└───────────────┬─────────────────────────────┬───────────────────┘
                │                             │
                ▼                             ▼
   Architecture projection          AI Canvas projection
   (node status, active edge)        (canvas.write_* via orchestrator)
```

**Rules:**

1. **Design edits** after launch do not mutate the frozen `Program` — new run requires re-approve (honest error if user tries).
2. **Canvas writes** only through orchestrator/agent executors — not direct UI mutation mid-run.
3. **Architecture overlay** is read-only projection unless user pauses and “revisions” (Phase 5+).

---

## 4. Harness templates (three tiers)

Built-ins today (`packages/schema/src/programs/catalogue.ts`): `pr-triage`, `review-loop`, `council-against-risks`, `route-by-blast-radius`, `dogfood-loop`.

New template **`build-architecture`** (Phase 6) composes existing patterns — do not rewrite the scheduler.

### 4.1 Tier 1 — Minimal (review-only loop)

**When:** user already has a small change set; wants verifier loop only.

| Node | Role | Maps from |
|------|------|-----------|
| Planner | Single agent: scope + ids | — |
| Builder | ACP/gateway agent | — |
| Verifier | `checker` + conditional loop | `review-loop` |

**Existing:** `review-loop` — **reuse as-is** for Tier 1 picker entry.

### 4.2 Tier 2 — Standard (default for “Build this architecture”)

**When:** owner journey — design approved, multi-step build with human gate.

| Stage | Nodes | Source pattern |
|-------|-------|----------------|
| Scout | agent | `dogfood-loop` scout |
| Plan | agent → `canvas.write_markdown` | new orchestrator hook |
| **Human gate** | pause checkpoint | Phase 2 approve bar |
| Build loop | agent (builder) → checker → loop | `dogfood-loop` gate |
| Command | `command` node (tests/build) | schema `command` kind |
| Review | agent | `dogfood-loop` review |

**Existing:** `dogfood-loop` — **extend** with plan gate + canvas emissions; do not fork a second scheduler.

### 4.3 Tier 3 — Full council (parallel critics + scaffold parent)

**When:** high blast-radius change; owner wants parallel risk council before build.

| Stage | Nodes | Source pattern |
|-------|-------|----------------|
| Parallel council | `parallel` → 3× agent critics | `council-against-risks` |
| Synthesize | agent | same |
| Route | `branch` on blast band | `route-by-blast-radius` |
| Scaffold parent | ACP agent (GLM/composer lane) | orchestration-protocol |
| UX gate | human checkpoint | Phase 5 |
| Build loop | Tier 2 tail | composite |

**Existing:** compose `council-against-risks` + `route-by-blast-radius` + Tier 2 tail — **Phase 6**.

### 4.4 Template selection UX

| Trigger | Default tier | Override |
|---------|--------------|----------|
| “Build this architecture” on board | Tier 2 | Settings → default template |
| Activity picker | user picks built-in | unchanged |
| High blast-radius edge selected | suggest Tier 3 | user confirm |

---

## 5. Current codebase — measured inventory

### 5.1 Shipped (reuse, do not rebuild)

| Asset | Location | Notes |
|-------|----------|-------|
| Program schema + validator | `packages/schema/src/program.ts` | Deterministic control flow; `agent`, `checker`, `parallel`, `loop`, `branch` |
| Scheduler | `packages/schema/src/scheduler.ts` | `runProgram` — browser-safe core, server executes |
| Built-in templates | `packages/schema/src/programs/*` | Five catalogue entries |
| Server runner | `packages/analyzer/src/server/programRunner.ts` | SSE, cancel, checkpoint hooks |
| Run persistence | `programRunStore` / `.sequence/runs/` | events.jsonl |
| Diagram kinds + layout classifier | `packages/schema/src/diagramLayout.ts` | `agent-workflow` → `circular-loop` |
| Board circular layout | `packages/web2/src/canvas/layout.ts` | `circularLayoutPositions` |
| Ask infer kind on propose | `packages/analyzer/src/server/askTools.ts` | ghost proposals get `agent-workflow` |
| AI Canvas contract | five `canvas.write_*` tools | locked |
| ACP executor | `packages/acp` | real local agent turns |

### 5.2 Gaps (honest)

| Gap | Evidence | Blocks |
|-----|----------|--------|
| **`fromBoardSeqd` kind lock** | `boardMemory.ts:47` — `doc.kind !== 'service-flow'` → null | agent-workflow designs don’t round-trip to session |
| **No agent fields on SeqDiagram nodes** | `seqdiagram.ts` — no `prompt` / `agentRef` / `scopeFiles` | click-to-edit instructions |
| **No compile function** | no `compileSeqDiagramToProgram` in tree | approve → launch |
| **No board launch bar** | ConnectedBoard has accept/deny for ghosts, not run | owner journey step 3–4 |
| **No run overlay on board** | node cards lack run status binding | “pop” / live graph |
| **No canvas projector from runs** | orchestrator doesn’t emit `canvas.write_*` on program events | AI Canvas narrative |
| **Checkpoint seat UX** | server supports; UI thin | long-run trust |
| **Workflow file persistence** | `.sequence/diagrams/` exists for `.seqd`; no `.sequence/workflows/` convention | reload across sessions |

---

## 6. Phase plan (executable)

Each phase: **Goal → Deliverables → Locking tests → Exit gate → Must-not-touch**.

Phases **0–2** unblock the owner journey spine. **3–5** make it feel alive. **6+** expand templates and polish.

### Phase 0 — Layout & kind foundation ✅ (partial)

**Goal:** Agent-workflow **shapes** render correctly on Architecture board.

| ID | Deliverable | Status |
|----|-------------|--------|
| 0.1 | `classifySeqDiagramLayout` + `circular-loop` engine | ✅ PR #145 |
| 0.2 | ELK LR/TD for service-flow / service-sequence | ✅ PR #145 |
| 0.3 | Ask `propose_topology` infers kind + layout | ✅ PR #145 |
| 0.4 | Repo integration test (real `.sequence/` scan) | ✅ PR #145 |

**Exit:** Layout classifier merged; vitest + schema tests green.

**Next:** Phase 0 does **not** include persistence or launch — explicitly out of scope.

---

### Phase 1 — Schema & persistence for agent-workflow

**Goal:** Agent-workflow `.seqd` round-trips; nodes carry prompt-pack fields.

| ID | Deliverable | Owner |
|----|-------------|-------|
| 1.1 | Extend SeqDiagram node type: optional `agent?: { prompt, agentRef?, scopeFiles?, runtime? }` | BUILD |
| 1.2 | JSON Schema bump + `validateSeqDiagram` | BUILD |
| 1.3 | Fix `fromBoardSeqd` / `toBoardSeqd` — accept `agent-workflow` (+ keep `service-flow`) | BUILD |
| 1.4 | Persist workflow diagrams under `.sequence/workflows/<slug>.seqd` (parallel to `diagrams/`) | BUILD |
| 1.5 | Board memory tests: agent-workflow serialize/parse | BUILD |
| 1.6 | Document fields in `docs/seqdiagram-sdk.md` | BUILD |

**Locking tests:**

- `boardMemory.test.ts`: `agent-workflow` with 4 agent nodes survives `toBoardSeqd` → `fromBoardSeqd`.
- Schema test: invalid agent node (prompt missing on kind=agent) fails validation.

**Exit:** Session reload preserves agent-workflow board; no silent downgrade to `service-flow`.

**Must-not-touch:** `scheduler.ts` behavior, HANDOFF/AGENTS/CLAUDE.

---

### Phase 2 — Compile + Approve → Launch

**Goal:** One click from approved design to server `runProgram`.

| ID | Deliverable | Owner |
|----|-------------|-------|
| 2.1 | Pure `compileSeqDiagramToProgram(diag, { tier, templateId? })` in `packages/schema` | BUILD |
| 2.2 | Map diagram nodes → `Program` `agent`/`checker`/`loop`/`branch` — deterministic edge walk | BUILD |
| 2.3 | `validateProgram(compile(...))` always before API accept | BUILD |
| 2.4 | Board chrome: **Preview workflow** → **Approve & launch** (Tier 2 default) | BUILD |
| 2.5 | `POST /api/program/run` with `sourceDiagramId` + frozen snapshot hash in run metadata | BUILD |
| 2.6 | Catalogue entry `build-architecture` (Tier 2) or compile-only without new id — **pick one in PR** | BUILD |

**Compile rules (v1):**

- One board node with `kind: agent` or role meta → one `agent` Program node.
- Cycle in `agent-workflow` edges → `loop` + `checker` back-edge (mirror `review-loop`).
- Fan-in parallel critics → `parallel` node (Tier 3 only).
- Unmapped node kinds → compile error, not silent drop.

**Locking tests:**

- Fixture `.seqd` (4-node loop) → `validateProgram` clean; node count ≥ 4.
- `compileSeqDiagramToProgram` snapshot test (golden JSON).
- E2E or vitest: Approve bar calls run API with expected program id.

**Exit:** Shopfront fixture: accept agent-workflow ghost → launch → Activity shows run id.

---

### Phase 3 — Dual-surface projection (board + AI Canvas)

**Goal:** Same run visible on Architecture overlay and AI Canvas narrative.

| ID | Deliverable | Owner |
|----|-------------|-------|
| 3.1 | Subscribe run SSE in ConnectedBoard; map `nodeId` → card status classes | BUILD |
| 3.2 | Active edge highlight (last transition) | BUILD |
| 3.3 | Orchestrator agent emits `canvas.write_markdown` (plan) + `canvas.write_mermaid` (sub-flow) on phase changes | BUILD |
| 3.4 | Auto-open AI Canvas tab on launch (workspace three-board model) | BUILD |
| 3.5 | Run metadata chip on board: run id, elapsed, pause | BUILD |

**Locking tests:**

- Vitest: SSE event sequence updates node `data-run-status`.
- Canvas test: program event projects to canvas doc block list (mock executor).

**Exit:** User sees pulsing nodes on Architecture **and** phase markdown on AI Canvas for same run id.

**Must-not-touch:** five-writer contract — no sixth format.

---

### Phase 4 — Agent node inspector (autonomy)

**Goal:** Click agent node → edit prompt pack pre-launch; ACP picker.

| ID | Deliverable | Owner |
|----|-------------|-------|
| 4.1 | Inspector panel: prompt textarea, scopeFiles multi-select (repo-relative), agentRef dropdown | BUILD |
| 4.2 | Wire edits → `.seqd` node.agent + session PUT | BUILD |
| 4.3 | Pre-launch validation: empty prompt blocks launch with honest error | BUILD |
| 4.4 | Post-launch: inspector read-only + link to run event slice | BUILD |

**Locking tests:**

- Inspector saves prompt; compile uses updated prompt (snapshot diff).
- Launch blocked when prompt empty — error string locked.

**Exit:** Owner can tune builder vs verifier prompts before Approve.

---

### Phase 5 — Long-run durability & pause/resume

**Goal:** Tab-close-safe; human gates mid-run.

| ID | Deliverable | Owner |
|----|-------------|-------|
| 5.1 | Wire `RunCheckpoint` UI: Pause, Resume, Retry node | BUILD |
| 5.2 | Reload session → reconnect SSE by run id; board overlay restores | BUILD |
| 5.3 | Human gate at plan stage (Tier 2) — run waits, canvas shows “waiting for you” | BUILD |
| 5.4 | Activity row: deep-link to board + canvas with run context | BUILD |

**Locking tests:**

- Integration: pause → state `waiting_human` → resume continues same node.
- Reload test: events replay restores terminal node statuses.

**Exit:** 30+ minute run survives browser refresh; owner approves plan mid-flight.

---

### Phase 6 — Template expansion & board “pop”

**Goal:** Tier 3 council; optional export; visual polish.

| ID | Deliverable | Owner |
|----|-------------|-------|
| 6.1 | `build-architecture-full` Tier 3 composite in catalogue | BUILD |
| 6.2 | Blast-radius hint suggests Tier 3 (uses existing `route-by-blast-radius` predicate shape) | BUILD |
| 6.3 | Optional LangGraph JSON export (Option B) — **read-only**, not runtime | BUILD |
| 6.4 | Board pop: role icons on agent nodes, model badge, failure strip | BUILD |
| 6.5 | Live edge animation (respect reduced-motion) | BUILD |

**Exit:** Owner-demo ready loop with council variant; export for external tooling only.

---

### Phase 7+ — Deferred (explicitly not v1)

| Item | Why deferred |
|------|--------------|
| Temporal/Inngest as default durability | Local `.sequence/` sufficient for dogfood; marketing durability later |
| Bi-directional run → `.seqd` sync (Option D) | Conflict complexity |
| Full Claude Code 45-tool parity | v2-architecture P15 — company-sized |
| Merged Architecture + Canvas surface | Owner ruled two boards |
| LLM-chosen branch conditions | Violates deterministic `Predicate` model |

---

## 7. Measurement & scorecard

Do not claim wins without rows below filled.

| ID | Metric | How | Target | Fail → |
|----|--------|-----|--------|--------|
| W1 | Design → launch steps | Count clicks from board | ≤ 3 after design accepted | UX consolidation |
| W2 | Compile reliability | % agent-workflow `.seqd` that compile clean | 100% on shopfront + workspace fixtures | Schema/compile fix |
| W3 | Run survival | % runs that survive tab close (server) | 100% | P8 regression |
| W4 | Dual-surface lag | ms from SSE event → board + canvas update | p95 < 500ms local | projector perf |
| W5 | Honesty | % runs marked done with checker violations | 0% | gate bug |
| W6 | Owner preference | “Would you launch this from Sequence vs Activity-only?” | owner yes | revisit template defaults |

**Anti-claims (hard):** no “beats LangGraph”; no “50% cheaper”; no “fully autonomous” without checker gates documented.

---

## 8. Owner decisions (unresolved)

These block defaults in Phase 2–5. Recommendations included — **owner pick required**.

### 8.1 Human-in-the-loop default

| Option | Behavior | Recommend |
|--------|----------|-----------|
| LangGraph-style | Pause at every checkpoint node until click | Safer for dogfood |
| Devin-style | 30s auto-proceed unless cancelled | Faster, lower trust |
| **Hybrid** | Auto-proceed **only** for scout/read nodes; pause at plan + pre-merge | **Default recommend** |

### 8.2 Durability tier for marketing

| Tier | Storage | When |
|------|---------|------|
| Local | `.sequence/runs/` | **v1 ship** |
| Cloud queue | Temporal/Inngest | Phase 7+ if multi-machine runs required |

### 8.3 Nesting depth

Activity today: flat program list. Claude Code: nested task lists.

**Recommend:** v1 flat run list + board shows **one** active program graph; nested sub-programs deferred.

### 8.4 Subagent model

| Model | Pros | Cons |
|-------|------|------|
| ACP isolated sessions | Real repo writes; matches Claude Code | Cost, setup |
| In-process summarized return | Cheap | Weaker isolation |

**Recommend:** ACP for builder/scaffold nodes; gateway for read-only scout/plan.

---

## 9. Agency-loop execution order

Suggested mega-branch sequence (disjoint ownership):

| Wave | Branch focus | Phases | May touch |
|------|--------------|--------|-----------|
| W-A | Schema + persistence | 1 | `packages/schema`, `packages/web2/src/sessions/boardMemory.*` |
| W-B | Compile + launch API | 2 | `packages/schema`, `packages/web2/src/canvas/ConnectedBoard.*`, `packages/analyzer/src/server/programRunner.*` |
| W-C | Projections | 3 | `packages/web2/src/canvas/*`, `packages/analyzer` canvas emit |
| W-D | Inspector + durability | 4–5 | `packages/web2` inspector, run reconnect |
| W-E | Templates + pop | 6 | `packages/schema/src/programs/*`, board chrome CSS |

**Do not parallelize** W-A and W-B on same files. W-C waits on W-B SSE shape.

---

## 10. Relationship to other plans

| Plan | Relationship |
|------|--------------|
| [`v2-next-phase-mega-plan.md`](v2-next-phase-mega-plan.md) Phases A–D | Trust/speed/surfaces — **parallel** where files disjoint (e.g. Phase A latency does not block Phase 1 schema) |
| [`FINISH-OPEN-PHASE-PLAN.md`](../FINISH-OPEN-PHASE-PLAN.md) P0–P8 | P8 server runs **landed** — this plan **consumes** P8, adds board→compile→project |
| [`chat-canvas-live-gap.md`](chat-canvas-live-gap.md) L1–L5 | Canvas live path **landed** — Phase 3 adds **program-run-driven** writes |
| PR #145 layout classifier | Phase 0 ✅ |

---

## 11. Immediate next action (when owner says go)

1. Merge PR #145 (Phase 0 layout) if not already on `main`.
2. Open **W-A** mega branch: Phase 1 schema + `fromBoardSeqd` fix.
3. Owner ruling on §8.1 (HITL default) before Phase 2 Approve bar ships.

**Until then:** research lane complete — **no Armageddon build** without owner ack on this doc.
