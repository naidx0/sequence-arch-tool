# Agent-draw harness — architecture research for the product moat

**Opened 2026-09-15 on owner instruction:** evolve beyond cloning Codex+tldraw /
Excalidraw demos into a system-design harness where humans and agents co-draw,
code side-by-side, with low latency, thoroughness, and determinism where possible
(fallback allowed). Research only — no design freeze, no build wave.

**Owner references (examples of the field):**
- Tasmap-style tldraw architecture board (dense tracks, typed legend, issue grid)
- [x.com/xuanwo/status/2098413657407525360](https://x.com/xuanwo/status/2098413657407525360)
- [x.com/alexanderOpalic/status/2098715981866525124](https://x.com/alexanderOpalic/status/2098715981866525124)

**Prior Sequence notes this supersedes as the *moat* brief (they remain useful history):**
[`agent-drawing-and-teaching-visuals.md`](agent-drawing-and-teaching-visuals.md),
[`code-canvas-program.md`](code-canvas-program.md). Those closed the “port the
protocol / wire the whiteboard” job. This note answers: *what architecture would
actually beat freehand agent placement.*

---

## 0. Verdict (one page)

The field’s miracles are not “strong models painting rectangles.” They are
**structured system narratives** rendered on an infinite canvas: typed roles
(component / action / state / store / runtime), horizontal tracks, dense text
inside marks, priority pins on edges, issue cards as first-class objects. The
model supplies *meaning*; the board supplies *space and editability*.

**Clone path (refuse as the product):** give the model free `(x,y)` and hope —
that is SeqDraw today, and it is why live outputs look empty next to tldraw demos.

**Evolve path (the moat):** a four-plane harness —

| Plane | Job | Determinism |
|---|---|---|
| **1. Diagram IR** | Semantic document: nodes, edges, tracks, roles, issues, evidence ids | High — schema-validated |
| **2. Layout engine** | Turns IR → geometry (ELK / lane / poster); model rarely invents coords | High — same IR → same layout |
| **3. Scene document** | Editable marks humans move; agent patches by stable id | Medium — merge rules |
| **4. Grounding** | Cards/edges cite scan `nodeId` / path:line or are marked sketch | High — refuse invented claims |

Perception for agents is **AST-first** (ms), screenshot-second (lint / self-critique).
Latency comes from *not* asking the model to be a layout engine and *not*
screenshotting every turn.

Sequence already owns plane 2 for Architecture (`elkjs` worker in
`packages/web2/src/canvas/layout.ts`) and plane 4 as product law. SeqDraw only
partially owns plane 3 with a tiny create vocabulary. **The invention work is
plane 1 + the agent↔scene peer loop + the dual grammar (structured vs free).**

---

## 1. What the examples actually prove

### 1.1 The Tasmap board (owner screenshot)

Not “pretty boxes.” It is a *system-design worksheet*:

1. **Legend-bound roles** — colour = kind (component / action / state / store /
   runtime). Humans parse kind before reading text.
2. **Narrative tracks** — numbered horizontal bands (search fan-out → focus
   coordination → architecture debt). Space encodes story order.
3. **Dense interiors** — bullets, symbol names, runtime APIs inside marks.
4. **Issue objects** — red-framed P1–P6 cards + a metrics summary; debt is spatial,
   not a chat afterthought.
5. **Pins on edges** — P1/P3 markers on connectors = critique without a second diagram.

An agent that can only `add_note` / `add_card` / `connect` / `frame` cannot emit
this grammar. A model that *can* emit it on tldraw still pays layout tax in tokens
and variance.

### 1.2 Codex / Claude + tldraw or Excalidraw (the X pattern)

Measured from public MCP / starter kits (not the X HTML — those URLs 403’d from
this environment):

| Pattern | What it does | Limit |
|---|---|---|
| **tldraw Agent Starter Kit** | Prompt parts (blurry / focused / peripheral + screenshot) → Zod actions → stream apply | Free geometry; licence if shipped; UI is theirs |
| **tldraw MCP App** | create / edit / delete shapes; canvas state back into chat | Thin CRUD; still shape-level |
| **codex-tldraw-mcp** | Offline `.tldr` snapshots from repo scan; L→R layout; drift markers | Reliable for Codex; **not a live harness** |
| **mcp_excalidraw** | Live CRUD + screenshot-verify-fix skill loop | Agent-native; no Sequence grounding |
| **AetherDraw / AiDiagram / Glyphic** | Diagram-as-data + Dagre/ELK; model skips coordinates | Closest to the evolve path |

**Owner intuition confirmed:** stronger models draw faster and denser on a free
canvas. That is real — and it is a **commodity** as models improve. The durable
wedge is the harness: IR, layout, grounding, code side-by-side, revise-by-id,
drift against scan.

---

## 2. Architecture options (research field)

### 2.A Freehand scene actions (tldraw / SeqDraw today)

**Model emits:** create/update/delete shapes with coordinates and style.

| Pros | Cons |
|---|---|
| Maximum flexibility; matches whiteboard feel | Ugly layout unless model is excellent |
| Easy to demo | Non-deterministic; hard to lock in tests |
| Human tools match agent tools | Screenshot perception is slow + token-heavy |

**Use as:** *sketch mode* and human freehand only — not the default for
architecture / code-flow boards.

### 2.B Diagram-as-data + deterministic layout (evolve core)

**Model emits:** typed JSON (nodes, edges, tracks, roles, issue severity).
**Engine emits:** positions, edge routes, frames.

Precedents: Glyphic (`@glyphicjs/schema` + elkjs), AiDiagram (Lane / Poster /
Dagre / ELK hot-switch without re-query), AetherDraw (`create_diagram` → Dagre).

| Pros | Cons |
|---|---|
| Same IR → same picture; locking tests possible | Grammar must be designed (this *is* the product work) |
| Tiny prompts vs coordinate soup | Free creative drawing needs a second mode |
| Relayout without calling the model | Over-constrained IR fights human drag — need “pin” / “free” flags |

**Use as:** default for system-design and code-flow visualizations.

### 2.C Constraint / optimization layout (Penrose)

Domain / Substance / Style → numerical optimization. Feynman (2026) wraps LLMs
around Penrose for knowledge diagrams.

| Pros | Cons |
|---|---|
| Beautiful underconstrained math/teaching diagrams | Wrong latency profile for an IDE harness |
| Separates meaning from style | Heavy; not Graphite-native; overkill for module graphs |

**Use as:** optional teach/math path later — **not** the code-harness spine.

### 2.D Agent as CRDT peer (Yjs)

Electric / Sim: agent is a server-side Yjs peer; tools → minimal CRDT updates;
humans never get clobbered by wholesale replace.

| Pros | Cons |
|---|---|
| True co-edit; concurrent human drag survives | Multiplayer infra Sequence does not need for v1 local-first |
| Teaches “patch, don’t replace” | Excalidraw-Yjs often syncs whole elements, not fields |

**Use as:** *discipline* even without Yjs — event-sourced scene ops with
`origin: agent | human`, append-by-id (already SeqDraw law), never wholesale
replace. Add Yjs only if multiplayer becomes a product requirement.

### 2.E Offline board files (codex-tldraw-mcp)

Write `.tldr` / `.excalidraw` into the repo; append diagrams to the right.

| Pros | Cons |
|---|---|
| Works in headless CLI agents | Not interactive in the harness |
| Drift markers against code graph | Second app to open the board |

**Steal:** drift / stale / changed markers. **Do not** make offline snapshots the
primary UX — Sequence’s job is live chat ∥ canvas ∥ code.

---

## 3. Recommended spine (research recommendation, not a ruling)

```
 scan / chat intent
        │
        ▼
 ┌──────────────────┐
 │  Diagram IR      │  Zod-validated · roles · tracks · issues · evidence
 │  (semantic)      │  sketch marks allowed but typed as sketch
 └────────┬─────────┘
          │ layout profile: layered | lane | poster | packed
          ▼
 ┌──────────────────┐
 │  Layout engine   │  elkjs worker (exists) + lane/poster profiles
 │  (deterministic) │  pins: human-fixed coords survive relayout
 └────────┬─────────┘
          │ materialize / patch by id
          ▼
 ┌──────────────────┐     human tools (pan, drag, ink)
 │  Scene document  │◄──── agent tools (patch IR or scene ops)
 │  (editable)      │────► perception: AST blurry/focused; shot = lint
 └────────┬─────────┘
          │
          ▼
   code panel / Architecture grounding / chat selection chips
```

### 3.1 Dual grammar (do not collapse these)

| Mode | Who places geometry | Done when |
|---|---|---|
| **Structured** | Layout engine | Human can read tracks/roles in &lt;10s; agent can revise IR and relayout |
| **Free / ink** | Human or model coords | Sketch and teach doodles; never claims scan topology |

Mixing them without tags is how boards become untrustworthy.

### 3.2 Agent tool shape (evolution of SeqDraw)

Keep closed Zod actions. Expand *up* the stack, not sideways into more shapes:

1. `diagram.upsert` — patch IR (nodes/edges/tracks/issues)
2. `diagram.layout` — choose profile / relayout (no LLM coords)
3. `scene.patch` — rare: move/pin/style after human intent
4. `scene.lint` — optional screenshot or geometric lint → fix loop
5. Keep `board.add_note` for sketch; keep grounded `board.add_card` for code cards

Refuse invented `nodeId`s whole (existing law).

### 3.3 Perception ladder (latency)

| Tier | Cost | When |
|---|---|---|
| IR + scene AST (ids, kinds, bounds, text) | ms | Every turn |
| Focused subset (selection / named ids) | small | Point-and-ask |
| Peripheral clusters | small | Large boards |
| Viewport screenshot | expensive | Lint / “make it readable” mode only |

tldraw’s blurry/focused/peripheral idea is correct; Sequence should bind it to
**IR+scene**, not only SVG marks.

### 3.4 Determinism + fallback

| Claim | Mechanism |
|---|---|
| Same IR + same layout profile → same geometry | Pure layout function; lock in tests |
| Model fails schema | Repair once → refuse; never half-apply |
| Layout ugly | Switch profile without re-asking the model (AiDiagram pattern) |
| Human dragged a node | Pin flag; relayout respects pins |
| Need a miracle sketch | Fall back to free scene actions explicitly |

### 3.5 Languages and libraries (fit for this monorepo)

| Layer | Choice | Why |
|---|---|---|
| IR + tools | TypeScript + Zod (already) | Matches ask/board tools |
| Layout | **elkjs 0.11.x (already in web2)** + lane/poster | Measured; worker-isolated |
| Scene | Native Whiteboard / Architecture scene — **not tldraw** | Licence + Graphite |
| Raster QA (optional) | SVG → PNG via existing export / resvg-class tools | Offline lint |
| Collab | Event log first; Yjs later if needed | Local-first |
| Penrose | Out of core path | Latency / fit |

**Do not vendor tldraw.** Port protocol ideas; keep Graphite rendering.

---

## 4. Where Sequence already has leverage (steal from ourselves)

| Asset | Path / note | Role in moat |
|---|---|---|
| ELK worker + layout profiles | `packages/web2/src/canvas/layout.ts` | Plane 2 exists |
| Grounded Architecture board | web2 canvas / node cards | Plane 4 surface |
| Whiteboard scene model | `whiteboardModel.ts`, `WbNodeRef` | Plane 3 substrate |
| Board tools skeleton | `packages/analyzer/src/server/boardTools.ts` | Expand to IR tools |
| SeqDraw blurry summary | `packages/web2/src/draw/seqDraw.ts` | Seed of perception |
| Chart / teach grammars | token-strip, matrix, layered-stack | Teaching visuals ≠ system board |
| Export lane layout | `packages/export/src/seqDiagramLayout.ts` | Candidate lane profile |
| Drift idea (external) | codex-tldraw `compare_code_graph` | Bind to live scan, not `.tldr` |

**Honest gap:** SeqDraw “LANDED” means wire + four create tools + tests. It does
**not** mean Tasmap-class output. Owner seat is correct.

---

## 5. Latency program (what to optimize, in order)

1. **Stop coordinate generation** for structured boards (biggest win).
2. **Stream IR patches**; materialize incrementally (shapes appear as nodes
   complete — feel of tldraw without waiting for full JSON).
3. **Relayout locally** when human pins/drags — no model round-trip.
4. **Cache layout** keyed by IR hash + profile + pin set.
5. **Screenshot only in lint mode** or after N geometric lint failures.
6. **Mode-gated tool belts** (tldraw modes): explore vs draw vs critique — fewer
   tools per turn → fewer wrong calls.

Model strength still matters for *what* goes in the IR (thoroughness). The
harness decides whether that thoroughness becomes a readable board in &lt;2s.

---

## 6. Competitive position — evolve, don’t mimic

| Player | Offer | Sequence evolve |
|---|---|---|
| tldraw agent | Best freehand agent UX | Own scene + Graphite; steal parts/actions |
| Excalidraw MCP | Live CRUD + skill loop | Add grounding + IR layout |
| Codex-tldraw MCP | Repo `.tldr` + drift | Live harness + drift on Architecture |
| Glyphic / AiDiagram | Diagram-as-data infra | IR inside Sequence with code binding |
| Isometric X demos | Narrative maps | Grammar already studied in `isometric-map-competitive-read.md` |

**Moat sentence:** *Sequence is the only local-first harness where the same
grounded scan that powers Architecture also powers an agent-editable
system-design board, laid out deterministically, revised by id beside the code.*

If a feature does not strengthen that sentence, it is a demo clone.

---

## 7. Risks and non-goals

- **Fourth spatial surface** — refuse; finish Whiteboard / Architecture / AI Canvas jobs ([`code-canvas-program.md`](code-canvas-program.md) §0).
- **Hand-drawn aesthetic as brand** — Graphite wins; “sketch feel” is optional ink, not the system board.
- **Waiting for smarter models** — improves IR content, not layout honesty.
- **Penrose / 3D LLM viz as P0** — teach depth later; harness first.
- **Yjs before event-sourced local ops** — premature.

---

## 8. What “done research” unlocks next

§10–§14 below answer the follow-up: languages (honest coverage), agent↔canvas
translation layers, latency Pareto, gap meaning, and the SeqDraw SOTA fix path.
Design freeze still waits on an owner call — the path is written so a design
session can start without re-researching.

---

## 9. Sources (loaded this session)

- tldraw Agent Starter Kit docs + template README (prompt parts, actions, modes, SSE)
- tldraw MCP App blog (create/edit/delete + state in chat)
- jananadiw/codex-tldraw-mcp (offline `.tldr`, drift, `draw_architecture`)
- yctimlin/mcp_excalidraw (live CRUD, screenshot-verify skill)
- wisecoders/AiDiagram (Lane/Poster/Dagre/ELK without re-query)
- MS-Teja/Glyphic (diagram-as-data, Zod, elkjs, no browser for raster)
- AetherDraw / WebMCP writeup (AST tools + Dagre)
- Electric / Sim (agent as Yjs peer)
- Penrose + Feynman arxiv (constraint layout; deferred for core)
- elkrs / elk-rs (native Rust / WASM ELK; byte-exact claims vs Java oracle)
- frankenmermaid (Rust+WASM deterministic diagram engine, sub-ms layout claims)
- pmx-canvas (MCP canvas: typed nodes, SSE, intent ghosts, schema describe/validate)
- In-tree: `layout.ts` elk worker, `boardTools.ts`, `seqDraw.ts`, prior research notes above

---

## 10. Languages — honest coverage (we did *not* survey “every” language first)

**Round 1 surveyed architectures and in-tree fit, not an exhaustive language
catalog.** Round 2 fills that. “Language” here means three different things
people conflate: **implementation language**, **diagram IR / DSL**, and
**wire protocol**. You pick one of each.

### 10.1 Implementation languages (where the engine runs)

| Language | Fit for Sequence | Exists today | Invent / try? |
|---|---|---|---|
| **TypeScript / JS** | **Default spine** — ask tools, Zod, web2, SSE already here | Full harness | Stay; put IR + tools here |
| **Rust (+ WASM / NAPI)** | Layout, hit-test, raster, deterministic geometry hot path | elkrs, elk-rs, frankenmermaid | **Try later** as drop-in for elkjs worker if measured slow |
| **Java** | Original ELK oracle | Reference only | Do not ship |
| **Python** | Fast MCP spikes, research agents | Many MCP servers | Out of process only; not the canvas |
| **Go** | CLIs / net services | Occasional diagram CLIs | Skip for interactive board |
| **C++ / Skia** | Figma-class renderers | Closed / heavy | Skip — Graphite+SVG/RF enough |
| **Swift / Kotlin** | Native mobile shells | — | Out of scope for harness moat |
| **Zig / C** | Tiny WASM kernels | Niche | Only if a measured hotspot needs it |
| **Elixir / BEAM** | Multiplayer presence | Unusual for canvas | Skip until multiplayer is a product |
| **WGSL / WebGPU** | GPU particle / iso maps | Research demos | Optional later for motion maps, not IR |

**Ruling for SeqDraw vNext:** keep **TypeScript as the product language**. Treat
Rust/WASM as an *optional layout accelerator* behind the same ELK-JSON contract
you already speak — invent nothing until elkjs worker is a measured bottleneck
(Architecture already isolates it off the main thread).

### 10.2 Diagram languages / IRs (what the *model* speaks)

| IR / DSL | Exists | Agent-friendly | Human-editable on canvas | Groundable to scan | Notes |
|---|---|---|---|---|---|
| Free shape JSON (tldraw / Excalidraw / SeqDraw marks) | Yes | Medium | Yes | Weak | Today’s SeqDraw |
| **Mermaid / flowchart** | Yes | High (models know it) | Weak (regenerate) | Weak | Fast demos; poor revise-by-id |
| Graphviz DOT | Yes | Medium | No | Weak | Classic; batch |
| PlantUML | Yes | Medium | No | Weak | Spec-heavy |
| ELK JSON | Yes | Low (verbose) | Via layout only | Medium | Good *engine* input, bad *model* output |
| Penrose Domain/Substance/Style | Yes | Low | No | Weak | Teach/math |
| Glyphic / AiDiagram JSON | Yes | High | After materialize | Medium | Closest prior art |
| `.tldr` / `.excalidraw` files | Yes | Medium | In their apps | Weak | Offline Codex path |
| **Sequence Diagram IR v0** | **No** | Design for it | Via materialize | **Yes — our wedge** | Roles, tracks, issues, evidence ids |

**Invent:** one Sequence Diagram IR (Zod), not twelve DSLs. Optionally *accept*
Mermaid as an import that compiles *into* IR (fallback), never as the live SoT.

### 10.3 Wire / communication languages (agent ↔ canvas)

| Channel | Exists in field | In Sequence today | Role |
|---|---|---|---|
| Tool-call JSON (Zod schemas) | Everywhere | `board.*`, `canvas.write_*` | Primary agent write |
| SSE event stream | tldraw / pmx / us | `board:item`, `canvas:block` | Push marks to client |
| MCP stdio / streamable HTTP | tldraw MCP, excalidraw MCP, pmx | MCP package exists; not SeqDraw SoT | External agents |
| Scene AST read (blurry/focused) | tldraw | Partial (`blurryBoardSummary`) | Agent eyes |
| Viewport screenshot | tldraw / excalidraw skills | Teach/HTML path; not board loop | Lint only |
| CRDT / Yjs updates | Electric, y-excalidraw | No | Multiplayer later |
| Intent / ghost preview | pmx-canvas `ax-intent` | No | **Invent** — show proposed marks before commit |
| Geometric lint report | Rare | No | **Invent** — overlaps, orphan edges, empty tracks |
| Protobuf / FlatBuffers | Unusual for LLM tools | No | Skip — JSON is the model’s native tongue |
| NDJSON action stream | tldraw SSE actions | Partial (batch board items) | **Upgrade** — one action per event, apply on complete |

---

## 11. Agent ↔ canvas translation — exist / missing / invent

Think in **layers of translation**. Latency and quality are decided by *which
layer the model is forced to speak*.

```
Intent (chat) 
  →  Semantic IR          (meaning: roles, tracks, edges, issues, evidence)
  →  Layout request       (profile + pins; no coordinates from model)
  →  Geometry             (engine output)
  →  Scene ops            (create/patch/delete by id)
  →  Pixels               (SVG / RF / whiteboard paint)
  →  Perception back      (AST → optional lint shot → chat)
```

### 11.1 What exists (field + Sequence)

| Layer | Field | Sequence |
|---|---|---|
| Semantic → geometry | Glyphic, AiDiagram, AetherDraw | Architecture ELK only — **not** SeqDraw |
| Scene CRUD | tldraw / Excalidraw agents | `board.add_*` create-mostly |
| Stream apply | tldraw SSE actions | `board:item` append-by-id |
| Read AST | tldraw blurry/focused/peripheral | Blurry text summary only |
| Grounding | Rare (codex drift markers) | Card `nodeId` refuse — **strength** |
| Validate before paint | Zod everywhere; pmx `validate` | Board tool envelope checks |

### 11.2 What does not exist (gaps)

| Gap | Why it hurts |
|---|---|
| **Diagram IR as SoT for SeqDraw** | Model stuck emitting free coords → ugly boards |
| **Update / move / align / delete** on board tools | Cannot revise; only dump |
| **Focused + peripheral** board perception | Agent cannot self-correct layout in text |
| **Layout profiles on Whiteboard** | ELK trapped on Architecture |
| **Intent ghosts** | Human cannot veto a bad draw mid-stream |
| **Geometric lint** | Screenshot becomes the only quality loop (slow) |
| **Drift on live board** | Codex does files; we should do scan↔board |
| **Mode-gated belts** | Too many tools → wrong tool choice |

### 11.3 What we can invent (Sequence-specific)

1. **`diagram.upsert` IR patches** — model never sends `x,y` in structured mode.
2. **`diagram.layout({ profile, respectPins })`** — local, synchronous to the client after IR lands.
3. **Role×track grammar** — Tasmap-class: Component/Action/State/Store/Runtime × numbered bands + Issue cards.
4. **Evidence handles** — every grounded mark carries `nodeId | path+lines`; sketch marks carry `claim:none`.
5. **Intent ghosts** — stream IR → translucent scene preview → commit or reject (steal pmx idea, Graphite skin).
6. **Lint without vision** — overlap AABB, edge-through-node, empty track, >N unlabeled marks → structured fix list the model can patch.
7. **Compile bridges** — Mermaid/DOT → IR (import); IR → scene; scene pins → IR (round-trip).
8. **Critique mode** — only then attach a viewport PNG; default path stays AST.

---

## 12. Latency ↔ quality Pareto (frameworks and sweet spot)

Wall-clock for “a board appears” is dominated by **model tokens**, not layout
ms. Layout is usually &lt;50ms (elkjs worker) to &lt;1ms (claimed Rust WASM engines).
Do not optimize Rust until the model path is honest.

### 12.1 Operating points (schematic)

| Mode | Typical feel | Quality | Cost drivers | When to use |
|---|---|---|---|---|
| **A. Mermaid / one-shot SVG dump** | Fastest first paint | Low revise; brittle | Short generation | Throwaway explainers |
| **B. IR → deterministic layout** (sweet spot) | Fast first paint + instant relayout | High readability; lockable | IR tokens only | System design / code flow |
| **C. Freehand scene CRUD** (tldraw / SeqDraw now) | Medium; variable | High ceiling if model god-tier; usually messy | Coords + styles in tokens | Sketch / ink |
| **D. CRUD + screenshot lint loop** | Slowest | Highest freehand polish | Vision tokens × N rounds | Critique / publish polish |
| **E. Penrose optimize** | Slow / spiky | Beautiful underconstrained | Solver + model | Teach math later |

**Yes — you can go faster and perform worse:** A, or C with tiny models and no
layout. **Yes — slower and better:** D (vision loops), or bigger models filling
richer IR. **Sweet spot for Sequence:** **B as default**, C as explicit sketch
mode, D as opt-in critique. That is “fast enough to feel live” *and*
“thorough enough to be Tasmap-class” without paying vision on every turn.

### 12.2 Framework pair (honest)

| Stack | Speed | Quality lever | Sequence fit |
|---|---|---|---|
| **SeqDraw path (TS + Zod + SSE + elkjs)** | Layout cheap; model is the wait | IR richness + profiles | **Build here** |
| **tldraw agent path** | Similar model wait; richer freehand apply | Model skill + screenshot | Licence / Graphite conflict |
| **Rust layout (elkrs / frankenmermaid)** | Faster layout, same model wait | Same IR quality | Optional accelerator |
| **Offline .tldr MCP** | No live UX | Good for CLI agents | Not the harness |

**Sweet-spot machine:** TypeScript harness + Diagram IR + elkjs (worker) +
AST perception + optional critique screenshot. Measure before swapping elkjs
for Rust.

### 12.3 Knobs (product, not vibes)

| Knob toward speed | Quality risk | Mitigation |
|---|---|---|
| Smaller / fewer tools | Wrong grammar | Modes: explore / draw / critique |
| Cap IR nodes (e.g. 12–40) | Underspecified | Multi-pass: skeleton → densify |
| Skip screenshot | Miss visual bugs | Geometric lint first |
| Stream incomplete shapes | Flicker / junk | Apply only on `complete` (tldraw law) |
| Bigger model | Latency ↑ | Parallel: stream IR while layout warms |

| Knob toward quality | Speed risk | Mitigation |
|---|---|---|
| Vision lint loops | 2–10× tokens | Critique mode only |
| Dense Tasmap IR | Longer gen | Skeleton pass then fill |
| Full peripheral dump every turn | Context bloat | Blurry + focused only |
| Perfect freehand | High variance | Prefer IR mode |

---

## 13. Where the gap is — and what it means

```
                    EXISTS                 MISSING                 MEANING
Agent write     board.add_* create     IR upsert + revise     Can dump, can't compose
Layout          ELK on Architecture    ELK/lane on SeqDraw    Pretty graphs ≠ agent board
Perception      blurry string          focused/peripheral/lint Agent is half-blind
Grammar         notes/cards/frames     roles×tracks×issues    Can't emit Tasmap shape
Human peer      drag locally           ghosts + pins↔IR       Co-edit is one-way
Grounding       card nodeId refuse     drift scan↔board       Trust exists; drift doesn't
Feel            tests/fixtures         live session miracles  Owner is right
```

**Meaning in one line:** SeqDraw is a **transport** with a **thin vocabulary**.
SOTA is a **compiler + peer editor**: chat compiles to IR, IR compiles to
geometry, geometry is a shared document, perception closes the loop without
vision by default.

---

## 14. SOTA machine + SeqDraw fix / implementation path

### 14.1 The machine (process every draw turn)

1. **Classify** — structured system-design vs free sketch vs critique.
2. **Belt** — only tools for that mode.
3. **Perceive** — IR + scene AST (blurry/focused); never raw screenshot unless critique.
4. **Act** — `diagram.upsert` patches (or sketch `board.*`); validate; refuse bad grounding.
5. **Layout** — local profile; respect pins; emit scene diffs.
6. **Stream** — SSE apply-on-complete; optional intent ghosts before commit.
7. **Lint** — geometric rules; if fail, one repair turn; if still fail → critique shot.
8. **Lock** — tests on IR→geometry identity, refuse paths, pin survival, Tasmap fixture.

### 14.2 SeqDraw implementation waves (recommended)

| Wave | Ship | Done when (user seat) |
|---|---|---|
| **S0 — Honesty** | Stop calling current SeqDraw “tldraw-class” in UI copy | User sees “sketch / early” not miracle claims |
| **S1 — Diagram IR v0** | Zod schema: node{id,role,track,label,bullets?,evidence?}, edge{from,to,pin?}, issue{}, profile | Fixture JSON validates; invent nodeId refused |
| **S2 — Materialize** | IR → Whiteboard items (frames=tracks, cards/notes by role, arrows, issue rects) + legend | Tasmap-shaped fixture readable without model |
| **S3 — Layout bind** | Reuse elk worker + **lane** profile from export; `respectPins` | Same IR twice → same geometry in test |
| **S4 — Agent tools** | `diagram.upsert`, `diagram.layout`, keep sketch `board.add_note`; add update/delete by id | Live ask draws a 2-track board with legend |
| **S5 — Perception** | focused + peripheral + geometric lint into ask surface | Agent fixes overlap without screenshot |
| **S6 — Peer UX** | Intent ghosts, pin-on-drag, point-and-ask chip | Human moves a box; next turn agent keeps it |
| **S7 — Critique (opt)** | Screenshot lint mode + drift markers vs scan | Publish-quality pass, not default path |
| **S8 — Accelerate (opt)** | Measure elkjs; if hot, trial elkrs/WASM behind same JSON | No API change; only timings improve |

**Inverted-fix ban:** do not “fix” empty SeqDraw by stuffing Mermaid into the
AI Canvas and calling it done. Structured SeqDraw must land on the spatial
board humans can drag.

### 14.3 File ownership sketch (when build starts)

| Owns | Paths |
|---|---|
| IR + Zod | `packages/schema` or `api-types` (pick one SoT) |
| Tools / validate | `packages/analyzer/src/server/boardTools.ts` → `diagramTools.ts` |
| Pipeline / SSE | `askPipeline.ts`, `askTools.ts` |
| Materialize + summary | `packages/web2/src/draw/` |
| Layout profiles | `packages/web2/src/canvas/layout.ts` + whiteboard bind |
| UI | `Whiteboard.tsx`, `ConnectedWhiteboard.tsx`, `AiCanvas` SeqDraw mount |
| Locks | `seqDraw.test.ts`, new `diagramIr*.test.ts`, one e2e ask→board |

### 14.4 Success metric (SOTA bar)

A single live ask — “draw current search architecture and its top issues” —
produces, without a vision loop: numbered tracks, role legend, ≥1 grounded
card when a scan exists, ≥1 issue object, readable at ~40% zoom, revisable by
a second ask that *moves* marks instead of wiping the board. Layout identity
test green. That is the bar the Tasmap / X demos set; SeqDraw clears it only
when S1–S6 land.

