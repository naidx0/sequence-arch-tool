# Competitive read — isometric / explainer system maps vs Sequence

**Date:** 2026-08-15  
**Owner ask:** Full product analysis against X builds that look “quite similar” —
isometric system maps with legend, explainer, moving payloads, deep English.
**References:** [`docs/design-refs/isometric-system-maps/`](../design-refs/isometric-system-maps/README.md) (refs 01–04).  
**Canon:** [`docs/product-final-plan.md`](../product-final-plan.md) §3 was the canon when this was
written; **§3 is retired by the v2 pivot** (2026-08-20) along with the OF7b/OF8 board surfaces it
locks. The depth target in this read still stands and is what the v2 Code architecture board is
measured against — the current canon for that surface is
[`docs/brand/graphite/`](../brand/graphite/) plus §1 of
[`docs/research/v2-architecture-and-gaps.md`](v2-architecture-and-gaps.md).  
**Do not stamp tip hashes here** — tip lives in HANDOFF only.

---

## 1. Verdict (one paragraph)

Those X demos are strong at **narrative system storytelling**: spatial map +
categorized legend + right-rail English + sparse moving packets you can
inspect. Sequence is already stronger as a **product**: chat and board on one
page, grounded scan → `.seqd`, Draw sync, agent workflows, Index rail, MADR
drill-down. The gap is not “we need a new app”; it is that our Architecture
browse still reads as a **static ELK card graph**, while the demos sell
**discussable, playable runtime paths**. Steal the *grammar* (legend /
explainer / pause-step / inspectable packets / go-inside). Keep our *SoT*
(2D RF English cards by default, evidence-bound edges, Ledger chrome). Do not
replace OF7b with isometric as the only Architecture mode without an explicit
owner call.

---

## 2. What Sequence looks like today (user seat)

| Surface | Reality on tip ProductShell |
|---------|-----------------------------|
| Shell | Chat left · Architecture board right · Index rail on the board |
| Architecture browse | 2D `@xyflow/react` cards (Entry/Agent/Service/Storage/Topic), ELK layouts, orthogonal elbows |
| English on card | Short “how it works” subtitle; expand under card |
| Deep English | MADR breakout (OF8) + Index Selection (`whatItDoes` / evidence codes) |
| Legend | Kind legend (filter) + dim strip (level / counts / provenance) |
| Motion | No live payload packets on Architecture; rail “execution order” exists; Glowmotion is export/skill, not browse |
| Playback | No Pause / Trace one step / Reset on the map |
| Regions | No trust-boundary / plane zones on the default map |
| Grounding | Active `SeqDiagramV1` from scan/chat/design; proposals Accept/Deny; no invented scan topology |

Key paths: `packages/web/src/product/ProductBoard.tsx`,
`packages/web/src/product/arch/ArchCanvasBoard.tsx`,
`packages/web/src/product/ProductMadrBreakout.tsx`,
`packages/web/src/product/board/BoardDetailRail.tsx`.

---

## 3. How good are their designs? (honest score)

Scored as *first-time developer understanding a foreign repo in &lt;60s* —
Sequence’s own usability bar, not “pretty screenshot.”

| Dimension | Ref 01 dark iso | Ref 02 parchment | Ref 03 rivers | Ref 04 flat explorer | Sequence today |
|-----------|-----------------|------------------|---------------|----------------------|----------------|
| Instant “what is this system?” | High | High | Med–High | High | Med–High (if scan rich) |
| Spatial memory | High (3D grid) | High (regions) | High | Med | Med (ELK 2D) |
| Discussability with AI | Med (static panel) | High (trace) | High (intent) | **Highest** (ask blueprint) | **Highest potential** (chat is first-class) — underused on map |
| Inspectable data motion | High metaphor | High | High (origin) | Low | **Missing** on browse |
| Grounded honesty | Unknown (demo risk) | Unknown | Unknown | Claims file cites | **Our moat** |
| Editing / draw / agents | Usually absent | Absent | Absent | Weak | **Our moat** |
| Brand / chrome fit for Sequence | Clash | Clash | Clash | Closer | Ledger / Polarity |

**Bottom line:** Their *presentation* often beats ours for “show me the loop.”
Our *system* beats theirs for “live in this repo and change it.” The winning
move is to import presentation grammar onto our grounded board — not to chase
one-off HTML exports as the product.

---

## 4. Pattern library — what to take

### 4.1 Must-consider (high leverage, fits canon)

1. **Explainer panel as a first-class board companion**  
   Tabs: *What it does* / *How it’s built*. Always show: 2–4 sentence English,
   process chain, **file cites**, payload/type when known.  
   *Sequence today:* split across card subtitle, Index Selection, MADR breakout.  
   *Change:* unify into one persistent explainer that tracks selection + active
   flow (rail can stay functions-first; explainer is the story panel).

2. **Sparse inspectable payloads**  
   Thread rule: few packets, real snippets, clickable, not a fireworks show.  
   *Sequence today:* Glowmotion export path; unused flow-focus maths on ProductShell.  
   *Change:* wire `computeFlowFocus` into Arch canvas; animate 1–3 packets on
   the highlighted path; click opens payload drawer (schema / sample from
   evidence, never invent).

3. **Playback chrome: Pause / Trace one step / Reset**  
   Even if the path is a grounded simulation of a scan-derived flow, the
   controls teach causality.  
   *Fits* Journey B (“explain this repository”) and harness visibility moat.

4. **Narrative legend sections**  
   Group left legend by *story* (entry → loop → outputs), not only by kind.  
   Kind colors stay; sections add reading order.

5. **Go inside / come back out**  
   Already OF8 + scoped `.seqd`. Steal the **affordance copy and zoom metaphor**
   from ref 03 so drill-down feels like entering a building, not opening a modal
   that fights the map.

6. **Trust / region overlays when evidenced**  
   Ref 02/04: CONTROL PLANE vs DATA PLANE, TRUST BOUNDARY.  
   Only when manifests / network / auth boundaries exist in the graph —
   otherwise omit (honesty over drama).

### 4.2 Optional (presentation modes, owner decision)

7. **Isometric 3D presentation mode**  
   Ref 01–03. Powerful for marketing and “wow” day-one.  
   Recommend as **optional view** projecting the same `.seqd` — never a second
   topology SoT. Default remains OF7b RF cards unless owner flips §3.

8. **Multi-sheet atlas** (ref 04)  
   Overview / Architecture / Path / Simulation. Sequence already has
   Architecture | Whiteboard | scoped digests. Don’t add six sheets; do add
   **named flows** as selectable stories on one map (like “Generation loop”).

### 4.3 Do not take

- Invented services/edges for prettier maps (violates grounded moat).
- Ops-health “NOMINAL” as primary chrome (we’re not Datadog).
- Pure glow-hacker or sepia-blueprint as ProductShell default (Ledger wins).
- Replacing chat with “Ask the blueprint” only — chat already is the ask surface;
  teach it to **point at** map selection + packets.

---

## 5. What Sequence should keep (non-negotiable)

From `product-final-plan.md` moat + OF locks:

1. **Chat \| board same page** — their demos are often diagram-only.
2. **Grounded scan → `.seqd`** — evidence refs, proposal Accept/Deny.
3. **Draw ↔ chat sync** and agent workflows on the graph.
4. **OF7b default:** RF English cards for Architecture browse.
5. **OF8 MADR breakout** for service interior — deepen, don’t abandon.
6. **Local-first** — map must read without a model key; AI deepens English.
7. **Ledger / Polarity** chrome — steal grammar, not their skins.

---

## 6. Design / structure changes (ranked)

**Retarget (2026-08-15):** P0–P2 apply to **Code Architecture** only. Work Architecture is a plan SoT, not an isometric runtime map. See [`docs/decisions/work-code-modes.md`](../decisions/work-code-modes.md).

### P0 — Usability wins without new SoT

| Change | User-seat Done when | Inverted-fix ban |
|--------|---------------------|---------------------|
| Selection → unified explainer (What it does / How built + file cites) | Selecting a service shows deep English without hunting Index + breakout | Don’t stuff the explainer *inside* the card border as a tiny overflow |
| Wire flow highlight on RF canvas | Choosing a flow dims non-path nodes and lights the path | Don’t only update the rail list while the board stays static |
| Pause / Step / Reset on active flow | User can step a request across 3+ services | Don’t autoplay forever with no inspect UI |
| Clickable packet → real snippet panel | Click shows evidence-backed payload shape / sample | Don’t invent JSON “for demo” |

### P1 — Storytelling

| Change | User-seat Done when |
|--------|---------------------|
| Named runtime flows dropdown (scan-derived) | “Auth login” / “Checkout” selectable like Generation loop |
| Narrative legend sections | Left list reads as a story, codes match map |
| Evidence-backed region overlays | Trust boundary visible only when graph supports it |

### P2 — Optional presentation (owner gate)

| Change | Gate |
|--------|------|
| Isometric / 3D building mode | Explicit “add to final plan?” — presentation over same `.seqd` |
| Marketing export via Glowmotion | Already a skill — use for socials, not as browse replacement |

### Structure (engineering)

- Keep SoT: `SeqDiagramV1` + ArchGraph evidence.
- Add a thin **FlowPlayback** model: ordered node ids + edge ids + optional
  payload descriptors from scan/annotate — consumed by Arch canvas + explainer.
- Reuse Glowmotion path-math for browse packets where possible; do not fork a
  second animation IR.
- Locking tests: assert packet click shows evidence id; assert invented payload
  cannot render without evidence; assert default Architecture remains RF cards
  unless isometric flag on.

---

## 7. Usability comparison (confused first-timer)

| Question | Their demos | Sequence |
|----------|-------------|----------|
| What am I looking at? | Usually clear in 5s (title + legend + map) | Clear if scan succeeded; empty/cold-start still the hard case |
| How does a request move? | Motion teaches it | User must read edges / open breakout / ask chat |
| Can I discuss this with AI? | Sometimes (ref 04); often the diagram *is* the discussion aid | Chat is always there — but chat↔selection↔packet loop is incomplete |
| Can I change the system? | Rarely | Yes (Draw, proposals, agents) — our differentiator |
| Do I trust the picture? | Unknown | Must stay yes — never trade for prettier lies |

**Score read:** Sequence wins on power and honesty; loses on *teach-the-path*
theatre. Closing P0 closes most of the perceived gap without an isometric rewrite.

---

## 8. Prompt they used — how Sequence should answer it

External prompt:

> Analyze [repo] at latest main. Create an isometric system map with legend and
> explainer panel. Show infrastructure as varied 3D buildings on a grid, with
> dependencies and payloads tracing real control/data paths. Cite files.

**Sequence-native interpretation (recommended):**

1. Attach / scan repo (grounded).
2. Project Architecture RF map (default) **or** optional isometric presentation.
3. Build legend from real components + narrative sections from dominant flows.
4. Explainer panel from annotate / `nodeDetail` / interior — cite real files.
5. Play payloads only along evidenced edges; snippets from typed contracts or
   honest “shape unknown.”
6. Chat remains available: “discuss this path” uses the active flow + selection
   as context (token diet already exists for scoped digests).

That is a **product feature**, not a one-shot Claude HTML dump.

---

## 9. Quality-testing checklist (when we implement)

- Empty board, filled shopfront, real monorepo, ~360px width (owner-seat-ui).
- Legibility sweep on real repo after explainer + playback chrome.
- Locking tests for: flow step order, packet evidence binding, no topology invention.
- Owner walk: Journey B “Explain this repository” — can they *see* a path move
  and open a packet without being told.

---

## 10. Suggested next step

Owner grill 2026-08-15 locked Work | Code. Implement [`docs/decisions/work-code-modes.md`](../decisions/work-code-modes.md): canon first, then shell, clone, two Architectures, Canvas artifacts, then **this file's P0** on Code Architecture (explainer, packets, playback). Isometric remains optional Code presentation.
