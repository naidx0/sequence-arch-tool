# Design refs — isometric / explainer system maps (X 2026)

Owner-collected competitive screenshots used as **reference points** when grilling
or designing Sequence Architecture board work. Drop original PNGs into this folder
when available (`ref-01-*.png` … `ref-04-*.png`). Until then, the structured notes
below are the binding memory of what Max liked.

**Related analysis:** [`../../research/isometric-map-competitive-read.md`](../../research/isometric-map-competitive-read.md)  
**Skill hook:** `/grill-me` / `/grilling` — when the topic is architecture visualization,
read this file first.

---

## Shared pattern (all four)

Every example is the same grammar, different skins:

| Layer | Job |
|-------|-----|
| **Top chrome** | Repo identity + live stats + playback (`PAUSE FLOW` / `TRACE ONE STEP` / `RESET VIEW`) |
| **Left legend** | Categorized modules with short codes + counts |
| **Center map** | Spatial system map (often isometric 3D “buildings” on a grid) |
| **Right explainer** | Plain-English depth: what it does / how it’s built, file cites, active trace |
| **Motion** | Few moving “payload” dots on real control/data paths — inspectable, not decorative |

Thread insight Max captured: *individual data packets that are snippets of real
data transfer; not many different ones; clickable; zoom into a process for more detail.*

---

## Ref 01 — Dark “RUNTIME TOPOLOGY” (autocontext / generation loop)

**Prompt that spawned similar builds:**

> Analyze [repo] at latest main. Create an isometric system map with legend and
> explainer panel. Show infrastructure as varied 3D buildings on a grid, with
> dependencies and payloads tracing real control/data paths. Cite files.

**What works**
- Varied 3D building silhouettes (blocks vs plate stacks vs diamond clusters) encode *kind* without a wall of color.
- Left legend grouped by narrative sections (“ENTRY AND CONTROL”, “THE EVOLUTION LOOP”, “WHAT COMES OUT”) — story order, not alphabet.
- Right panel: selected flow → process chain → paragraph → **source files** → payload type (`GenerationContext`).
- Sparse payloads (“PAYLOADS IN MOTION”) — one glowing packet is enough to teach the metaphor.
- Playback controls sell “this is a live system,” even when the path is simulated.

**Risks if Sequence copied blindly**
- Pure black + glow + monospace reads as generic “hacker dashboard,” not Ledger/Polarity.
- Isometric is a *presentation mode*, not a second SoT — easy to fake topology for drama.

**Suggested local filename:** `ref-01-runtime-topology-dark.png`

---

## Ref 02 — Light parchment “Repository System Map” (background-agents)

**What works**
- Architectural **regions** on the grid (OPERATOR EDGE / CONTROL PLANE / DATA PLANE / EXTERNAL) — spatial trust boundaries.
- Numbered **request path** in the left rail (1…5) as the primary story; supporting systems secondary.
- Selection sync: sidebar highlight ↔ glowing block on the map.
- Right panel: responsibility + “in the flow” + **active trace** timeline with current step highlighted.
- Legend as layer checkboxes (ENTRY / CONTROL / DATA) — dim-the-rest, not just filter chips.

**Risks**
- “NOMINAL” health dots drift toward monitoring product; Sequence’s moat is grounded *code* understanding, not ops dashboards.
- Region labels need real evidence (deploy/manifest boundaries), or they become invented swimlanes.

**Suggested local filename:** `ref-02-repo-system-map-parchment.png`

---

## Ref 03 — Sepia “Rivers of Empire” evolution harness (origin of the debate)

**Caption / thread intent**
- Diagrams so you can *discuss* the codebase with the model more easily.
- Moving dots = data snippets you can inspect.
- Want: few real packets, clickable, zoom *into* a process for more detail (`+ GO INSIDE` / `- COME BACK OUT`).

**What works**
- Height as meaning (“tall structures are the measuring parts”) — visual hierarchy beyond color.
- Explicit go-inside / come-back-out language matches Sequence’s MADR breakout / scoped `.seqd` drill.
- Explainer teaches *how to read the diagram*, not only what one node is.

**Risks**
- Single-letter codes scale poorly past ~12 modules without a strong left legend.
- Sepia blueprint aesthetic fights Sequence brand book if used as default ProductShell skin.

**Suggested local filename:** `ref-03-rivers-evolution-harness.png`

---

## Ref 04 — Flat “CODE EXPLORER” architecture sheet (AmfionHQ)

**What works**
- Closest to Sequence today: **2D** role boxes (SUR / API / RUN / DAT / EXT), English blurbs on the card, solid vs dashed edges.
- **TRUST BOUNDARY** as a first-class visual region — security storytelling without 3D.
- Multi-sheet navigation (Overview / Architecture / Chat path / Source walk / …).
- Right rail is **Ask the blueprint** — grounded Q&A with file links (chat × diagram), not only a static explainer.
- Legend highlights a layer and dims the rest.

**Risks**
- Sheet proliferation can become a second product IA if not scoped.
- “Ask the blueprint” without evidence discipline invents trust boundaries Sequence must not ship.

**Suggested local filename:** `ref-04-code-explorer-amfion.png`

---

## Steal vs keep (one-liner for agents)

| Steal | Keep (Sequence) |
|-------|-----------------|
| Legend + explainer + sparse inspectable packets | Grounded `.seqd` / scan evidence — never invent topology |
| Pause / step / reset flow playback framing | Chat \| board shell; Ledger/Polarity chrome |
| Region / trust-boundary storytelling when evidenced | 2D RF English cards as default Architecture browse (OF7b) |
| Go-inside process detail | MADR breakout + scoped diagrams (OF8) — polish, don’t fork |
| Deep English “what it does / how built” with file cites | Local-first; AI optional overlay, not required to read the map |

Do **not** treat isometric 3D as the new default Architecture SoT without an owner
decision against `docs/product-final-plan.md` §3.

**Mode (2026-08-15):** these refs are the **Code Architecture depth** target, not Work.
Work uses plan/process Architecture + Canvas artifacts. See
[`docs/decisions/work-code-modes.md`](../../decisions/work-code-modes.md).
