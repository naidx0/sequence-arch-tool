# Agent-draw research program — rounds closed

**Owner ask (2026-09-15):** conduct all research and exploration rounds; survey what
we can really do; **only then** start implementation.

**Status: RESEARCH CLOSED for implementation planning.**  
Implementation does **not** auto-start. Owner must explicitly call “start S1 /
freeze IR / build SeqDraw.” This file is the gate receipt.

Companion architecture note: [`agent-draw-harness-moat.md`](agent-draw-harness-moat.md)
(§0–§14). This file records **what was surveyed**, **what was measured in-tree**,
and **what is frozen enough to build**.

---

## Research Done when (all must hold)

| # | Criterion | Status |
|---|---|---|
| 1 | Architecture spine written (IR → layout → scene → grounding) | ✅ moat §0 |
| 2 | Languages surveyed as impl / IR / wire (not one mushy list) | ✅ moat §10 |
| 3 | Agent↔canvas translation: exist / missing / invent | ✅ moat §11 |
| 4 | Latency↔quality Pareto + sweet spot | ✅ moat §12 |
| 5 | Competitive + academic field sampled | ✅ this file R1 |
| 6 | In-tree Sequence capability audited (code, not hope) | ✅ this file R2 |
| 7 | Wire/perception gaps named with file paths | ✅ R2 + R3 |
| 8 | Layout/runtime options + when to try Rust | ✅ R4 |
| 9 | Co-edit / perception patterns + invent list | ✅ R5 |
| 10 | Licence / Graphite / security constraints | ✅ R6 |
| 11 | SeqDraw waves S0–S8 ordered with Done when | ✅ moat §14 |
| 12 | Explicit “do not build yet” until owner call | ✅ this banner |

If a new competitor or paper appears later, open a **delta round** — do not
re-open the whole program unless the spine changes.

---

## Round ledger

| Round | Question | Status | Artifact |
|---|---|---|---|
| **R0** | Program + Done when | ✅ | this file |
| **R1** | Competitive / academic field | ✅ | §R1 |
| **R2** | In-tree SeqDraw / board / IR audit | ✅ | §R2 ([scout](facfb763-26e9-4aec-8e4b-eb5126a36ea9)) |
| **R3** | IR/DSL + wire protocols | ✅ | §R3 + moat §10–11 |
| **R4** | Layout / runtime / perf | ✅ | §R4 + moat §12 |
| **R5** | Co-edit UX + perception | ✅ | §R5 |
| **R6** | Licence / brand / security | ✅ | §R6 |
| **R7** | Synthesis → implementation gate | ✅ | §Gate |

---

## R1 — Competitive & academic field

### Products / kits (sampled)

| Player | Mechanism | Steal | Not our clone |
|---|---|---|---|
| tldraw Agent Kit / MCP App | Parts + actions + SSE; freehand CRUD | Modes, apply-on-complete, blurry/focused | SDK licence + Graphite |
| Excalidraw MCP / skills | Live CRUD + screenshot verify-fix | Critique loop as **opt-in** | Ungrounded topology |
| Codex-tldraw MCP | Offline `.tldr` + drift markers | Drift idea | Not live harness |
| Glyphic / AiDiagram / AetherDraw | Diagram-as-data + ELK/Dagre | **IR → layout** (core) | No Sequence scan |
| CodeBoarding | Static analysis + LLM → Mermaid/docs | Incremental map + agent docs | Mermaid SoT; not peer canvas |
| Eraser | AI architecture + MCP edit | Prompt→structure→edit | SaaS; not local-first |
| pmx-canvas | Typed MCP nodes, validate, intent ghosts | Ghosts + schema validate | Different product job |
| Penrose / Feynman | Constraint optimize | Teach/math later | Wrong latency for IDE |

### Academic (sampled)

| Work | Idea | Use for us |
|---|---|---|
| DiagrammerGPT | Planner–auditor loop then render | Critique/repair turns without vision-first |
| DiagramAgent (CVPR-ish text-to-diagram) | Plan / Code / Check / Diagram-to-Code | Multi-agent draw pipeline shape |
| ArchView empirical study | Domain-aware agents beat naive GPT on architecture views | Domain IR + scan tools beat freehand |
| SLR UML/ER 2023–25 | Hallucination, eval chaos, class-diagram bias | Grounding + locking tests mandatory |

**R1 verdict:** Field confirms IR/plan → render → check. Nobody owns
**local-first grounded scan + editable spatial peer board + deterministic
layout** in one harness. That remains the moat sentence.

---

## R2 — In-tree audit (measured)

Scout: [SeqDraw in-tree audit](facfb763-26e9-4aec-8e4b-eb5126a36ea9).

| Fact | Evidence |
|---|---|
| Agent board tools = 4 **add-only** | `board.add_note/card/connect/frame` in `boardTools.ts` |
| No agent update/delete/move | Explicit; humans have `wb/move|text|delete|clear` |
| Wire kinds | `text` \| `shape` \| `noderef` (`api-types`) |
| Whiteboard kinds | + `stroke` (human-only) |
| ELK on whiteboard | **No** — only Architecture `canvas/layout.ts` |
| SSE path | `askPipeline` → `connect.tsx` → `store` → `ConnectedWhiteboard` / AiCanvas |
| Canvas perception | blurry + focused wired (`withCanvasState`) |
| Board perception | Server can render `surface.board`; **client does not send items** (`withBoardState` missing); `blurryBoardSummary` tests-only |
| Architecture IR exists | **`SeqDiagramV1`** in `packages/schema/src/seqdiagram.ts` + `diagramLayout.ts` |
| SeqDraw IR | **Does not exist** — no bridge SeqDiagram → whiteboard |

**R2 verdict:** Substrate is real. The missing middle is IR+layout+read-half+revise.
**Major reuse finding:** do not invent architecture semantics from zero —
**extend / project `SeqDiagramV1` (or a sibling SystemDesign IR) into the
whiteboard scene**, instead of a disconnected fourth IR.

---

## R3 — IR / DSL / wire (arranged)

### What exists (use)

- Tool-call JSON + Zod validation  
- SSE `board:item` / `canvas:block`  
- `SeqDiagramV1` grounded IR + layout profile picker  
- AI Canvas blurry/focused  
- Board tool refuse-on-bad-nodeId  

### What does not exist (build)

- System-design / Tasmap IR (roles × tracks × issues) **or** SeqDiagram→whiteboard projector  
- Client `withBoardState()`  
- `diagram.upsert` / layout / update / delete  
- Intent ghosts, geometric lint  
- Mode-gated draw belts  

### What we invent (closed invent list)

1. **SeqDraw document IR** — either a thin SystemDesign layer *on* SeqDiagram, or a sibling schema that can cite `nodeId` / evidence like SeqDiagram’s `grounded` block.  
2. **Materializer** IR → `WbItem[]` + legend.  
3. **Whiteboard layout bind** (elk/lane/poster + pins).  
4. **Peer ops** — upsert/delete/pin + ghosts.  
5. **AST lint** — overlap / orphan / empty track.  
6. **Mermaid import** as compile-into-IR only.

**Wire language stays JSON.** No protobuf. MCP is optional external face later.

---

## R4 — Layout / runtime / perf

| Option | Role | Call |
|---|---|---|
| elkjs worker (in-tree) | Default layout | **Use** |
| Lane/poster (export + AiDiagram pattern) | Tasmap tracks / overview | **Use** |
| elkrs / Rust WASM | Faster layout | **Only if measured hot** |
| frankenmermaid | Alt diagram engine | Skip for SeqDraw spine |
| Penrose | Constraint beauty | Teach later |
| Vision lint every turn | Quality↑ latency↓↓ | Critique mode only |

**Sweet spot unchanged:** IR → deterministic layout; model tokens dominate wall clock.

---

## R5 — Co-edit + perception

| Pattern | Source | Sequence call |
|---|---|---|
| Blurry / focused / peripheral | tldraw | Finish board half; wire client |
| Apply on complete | tldraw | Keep for SSE |
| Agent as peer (patch not replace) | Yjs essays | Event log + origins; Yjs later |
| Intent ghosts | pmx-canvas | Invent Graphite ghosts |
| Planner–auditor | DiagrammerGPT | Lint repair turn |
| Point-and-ask | In-tree AI Canvas | Port board-item chip |
| Human pin survives relayout | Research | Required for peer trust |

---

## R6 — Licence / brand / security

| Constraint | Ruling |
|---|---|
| tldraw SDK | **Do not vendor** — production needs paid/hobby key + watermark politics |
| Excalidraw | MIT — optional import path, not core UI |
| React Flow / xyflow | Already in Architecture; MIT + existing notices |
| Graphite | System board = Graphite; freehand sketch ≠ brand law for Architecture |
| Decision 15 | `allow-scripts` without `allow-same-origin` on AI Canvas HTML — not SeqDraw default |
| Local-first | No required cloud layout service |
| Grounding law | Invented `nodeId` refuses whole call |

---

## Synthesis — what we can really do

**Can do now (high confidence):**

1. Keep native Whiteboard + SSE (no tldraw).  
2. Add Diagram/SystemDesign IR (reuse SeqDiagram grounding patterns).  
3. Materialize + ELK/lane on whiteboard.  
4. Wire `withBoardState` so agents revise.  
5. Expand tools to upsert/delete/layout; modes for sketch vs structured.  
6. Geometric lint before vision.  
7. Lock with fixtures (Tasmap-shaped) + identity tests.

**Can do later:**

- Critique screenshots, drift markers, Rust layout, Mermaid import, MCP face, Penrose teach.

**Should not do:**

- Fourth spatial surface, vendoring tldraw, Mermaid-as-SoT, vision-every-turn, claiming SeqDraw is SOTA before S1–S6.

---

## Implementation gate

```
RESEARCH  ████████████  CLOSED (this file)
DESIGN    ░░░░░░░░░░░░  Owner freezes IR shape (SeqDiagram extend vs sibling)
BUILD     ░░░░░░░░░░░░  Starts only on explicit owner call → S1
```

**Suggested first build call (when ready):**  
“Freeze SeqDraw IR v0 and start wave S1–S3” — schema + materialize + layout bind +
locking tests; no UI copy claiming miracle until S4 live ask works.

**Owner-seat Done when for the whole program (post-build):**  
Live ask draws tracks + role legend + issue objects; grounded card when scan
exists; second ask revises without wipe; layout identity test green; human pin
survives relayout.

Until that call: **no SeqDraw implementation in this program.**
