# Sequence — Final product plan (owner canon, 2026-08-05)

> ### ⚠ THIS FILE IS PRODUCT CANON, NOT VISUAL CANON (amended 2026-08-20 by the v2 pivot)
>
> Its **product intent survives and still binds**: §2 users, §4 journeys, §5 moat, §6 bloat vs core,
> §7 QA bar, §9 change-control. Its **brand, layout and shell sections are RETIRED** — every one of
> them describes `packages/web`, which was deleted 2026-08-20. Build v2 surfaces in
> `packages/web2`. Where this file disagrees with a Graphite sheet, **the sheet is right**.
>
> **Active authority order (amended 2026-08-20):**
> 1. [`docs/brand/graphite/`](brand/graphite/) — **active brand canon: the Graphite book, one copy.** Cite `graphite/`. Extend the book before inventing a component.
> 2. [`docs/brand/GRAPHITE-DECISIONS.md`](brand/GRAPHITE-DECISIONS.md) — the owner rulings that bind it: the freeze, light deferred (1), node kinds without hue (2).
> 3. [`docs/PIVOT-V2.md`](PIVOT-V2.md) — the decision of record for what is being built at all.
> 4. **This file** — product journeys, acceptance rules, scope. **Product intent only.**
> 5. [`docs/owner-feedback-log.md`](owner-feedback-log.md) — verbatim owner decisions.
>
> **Retired brand books, newest first, none of them canon — all deleted from the tree 2026-08-20:** Console v3.1, retired 2026-08-19; Ledger v2, retired 2026-08-18; v1 Structural before that. The v1 layout record (`final-product-design.md`) went with them. They live in git history only; do not build from any of them, and do not go looking for a path.
>
> If a future idea conflicts with this doc, **ask the owner**: “Add this to the final plan?” — do not silently drift.

**Status:** Owner-described 2026-08-05; **screenshot review same day** tightened visual acceptance (see §11). Supersedes ad-hoc “shipped IR/export” framing as the *product* goal.
**What shipped on `main` (PR #12–#16):** infra + SeqDiagram IR/CLI/MCP + partial cold-start chrome — **not** this full product vision. Treat those as foundation, not the destination.

---

## 1. One sentence

Sequence is a **local-first, model-agnostic visual workbench**: **Work** (planning) and **Code** (repo/system design) in one app — Claude/Codex-shaped sessions, English-first Architecture as the meta-document, a freeform Canvas for artifacts, chat beside the board. Plan → implementation is a **clone hop** when the user asks; each mode is a complete product alone. `.seqd` remains the portable Architecture IR.

**Modes (amended 2026-08-20):** [`decisions/work-code-modes.md`](decisions/work-code-modes.md) — **no longer binding on chrome.** `docs/research/v2-architecture-and-gaps.md` §1.2 puts **Work mode on the v2 CUT list**, and the topbar Work|Code switcher it locks is a `packages/web` component being deleted. Read it for the clone-hop reasoning, not for a layout. (owner grill 2026-08-15; chrome: one topbar Work\|Code, inferred Architecture/Canvas, tools/skills/memory in Settings).
**Model roles:** [`decisions/model-roles.md`](decisions/model-roles.md) — local default + optional frontier advisor + cheap vision.

---

## 2. Who the users are

| Persona | Who | Why they come |
|---------|-----|----------------|
| **A — Work** | Builders **and** people running difficult/delicate work systems (founders, operators, planners) | Directive planning, company/process Architecture, Canvas artifacts, planning agents. May not live in a repo. |
| **B — Code** | Technical people — repos, from-scratch systems, visual system design | Grounded Architecture of a real (or generated) repo, coding agents, draw → files, deeper map grammar |

Overlap is expected: the same human plans in Work and implements in Code. **Not** a consumer chatbot. Discoverable in &lt;60s, legible board, honest local-first, export other agents can open.

---

## 3. What they see when they open Sequence

> **⚠ RETIRED SECTION (v2 pivot, 2026-08-20).** The ASCII shell below, the board-surface roster and the OF7b/OF8 locks describe the v1 `packages/web` shell being deleted at Wave 7. **The v2 shell comes from the Graphite canvas sheets (`docs/brand/graphite/pages/05-the-canvas.html`, `08-board-density-and-overflow.html`, `11-the-functions-rail.html`) and §1 of `docs/research/v2-architecture-and-gaps.md`.** Read this section for *what the user is trying to do*, never for where a pane goes. Work mode, the whiteboard and the workflows surface are on the v2 CUT list.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  topbar: brand · Work|Code · repo (or empty) · Import / New / Open · ⚙   │
├──────────┬─────────────────────┬─────────────────────────────────────────┤
│ THREADS  │  CHAT (slightly     │  VISUAL STAGE                           │
│ (slim    │   wider default;    │  Architecture SoT or Canvas — chat      │
│  rail;   │   either pane       │  infers the surface; quiet crumb;       │
│  past)   │   expands)          │  English cards / plan or repo map       │
└──────────┴─────────────────────┴─────────────────────────────────────────┘
```

**Cold start:** always **Work + new empty chat**, chat | board ~equal, empty Architecture (Canvas when chat infers it). Composer works. No keywall. Attach via **topbar only**. **One** Work\|Code switcher (topbar). Empty drafts **auto-delete** after leave; the live thread still shows in the slim rail. Tools · skills · memory are a **Settings** section, not chat chrome.
**Not acceptable:** Git/files as the home visual stage; keywall / choose-repo as first full page; sharing one canvas across Work and Code; inventing scan topology.

### Board surfaces (OF4 lock, 2026-08-06 · OF6 amend 2026-08-06 · Work/Code 2026-08-15)

Each **session** owns its own Architecture + Canvas. Work and Code sessions are **not** the same documents. Clone hop copies into a new session.

| View | What the user sees | Source of truth |
|------|--------------------|-----------------|
| **Architecture** (default tab) | React Flow native-English map. **Work:** plan/process meta-document (`diagramFamily: process`). **Code:** system parts (scan when attached). X isometric maps = Code *presentation* later, same `.seqd` | Session `SeqDiagramV1` |
| **Canvas** (tab; was Whiteboard) | Freeform surface: draw, pull info, **chat-created HTML/draw artifacts**. Not grounded Architecture | Session whiteboard JSON + artifacts |
| **Sketch / Draw** | Draw tool on Architecture `.seqd` | same Architecture doc |
| **Export** | `.seqd` / Structural SVG / Mermaid | projections of Architecture doc |

**OF7b lock (2026-08-06):** Code Architecture *browse* = `@xyflow/react` English cards + ELK layouts unless the user turns on an isometric **view**. `.seqd` remains IR / export / Draw. Do **not** treat Structural SVG lanes as the default Architecture read.

**OF8 lock (2026-08-07):** Clicking a Code service (or entry) opens a **MADR breakout**. Work Architecture drills plan sections, not fake files.

**Clone hop (2026-08-15):** Switch modes **clones** the session. Work→Code: plan objects become coding/scaffolding diagram with origin `design`/`chat` (never fake `scan`). Code→Work: repo map becomes a plan/process document marked derived-from-repo. Original session untouched.

**Scoped `.seqd` (OF6):** one repo-level diagram is **not** the whole product. Same as markdown docs, diagrams live under `.sequence/diagrams/` at **repo / service / ask** scope. Switching scope swaps the board doc; ask digests the **active** scoped doc (token diet).

**Ghost proposals (OF6):** additive topology on an attached repo lands as a **proposal layer** on the Architecture board (Accept / Deny). Accept merges into the active `.seqd` as design/proposal origin (scan graph stays honest — B3). Deny drops the layer. Never invent fake *scanned* services.

**Plan artifacts (OF6):** Plan tasks / improve-API turns produce (a) chat summary, (b) `.sequence/plans/<slug>.md` checklist guide, (c) Task Board cards linked to that plan.

Do **not** remount legacy GroupedCanvas as ProductShell default (S2). OF7b Architecture RF is a **new** product board surface projecting the same grounded `SeqDiagramV1` — English titles still come from explain/`nodeDetail` / annotate into that doc (or card overlay), never fabricated topology.

**K3 / Fit (OF6):** Fit **MUST** frame content AABB (not empty MIN_VIEW pad); Architecture **MUST** fill the usable board viewport on a real repo to the coding-canvas-demo bar. A postage-stamp sheet in steel-00 void is a failure.

---

## 4. Two primary journeys (acceptance stories)

### Journey A — Work home (insurance / company plan)

1. Open Sequence → **Work** new chat | empty Architecture + Canvas.
2. User: “I want to create an insurance company — what does that process look like?”
3. **Left:** planning assistant. **Right:** live **plan Architecture** (English steps/roles).
4. User draws / edits the plan → `.seqd` updates. Canvas for freeform artifacts.
5. Optional: **Switch modes** clones into a **Code** session to scaffold/implement.
6. Export `.seqd` / SVG / Mermaid.

### Journey B — Code (attach or clone)

1. Attach a repo **or** clone a Work session into Code (optional model key later — never block attach).
2. Chat: “Explain this repository to me.”
3. **Right:** grounded Code Architecture — services, flows, in plain English.
4. Playback / packets / explainer are Code depth (not required for Work).
5. Draw + coding agent workflow; optional clone back to Work to turn the repo into a company/plan with non-code parts.

---

## 5. Moat (non-negotiable)

1. **Visual-first harness** — chat + board same page (Cursor shell × Miro/tldraw board).
2. **Grounded** — every edge/claim from real evidence when a repo is attached.
3. **`.seqd` native** — IR is the collaboration artifact; Mermaid/SVG are projections; board *is* the SeqDiagram experience.
4. **Draw ↔ chat sync** — drawing updates assistant context and `.seqd` (finish-draw gesture TBD with owner).
5. **Agent workflows on the graph** — monitorable, local, model-agnostic (own model later). Inspectable-harness shape: see [`visual-harness-moat-madr.md`](decisions/visual-harness-moat-madr.md) (board-visible run graph, phases 1–2).
6. **Brand book** — *(RETIRED: "Structural Engineering" was the v1 book, two books before Graphite. The brand SoT is now the frozen `docs/brand/graphite/`; the moat point — that one book covers web **and** the architecture board — still stands.)* Structural Engineering for web **and** the architecture board (fonts, steel, signal orange discipline, icons) — reference: owner-loved [`coding-canvas-demo.vercel.app`](https://coding-canvas-demo.vercel.app) for diagram *feel*, Structural book for Sequence identity.

---

## 6. What is bloat vs core (cut / demote)

| Keep / elevate | Demote / fix |
|----------------|--------------|
| Chat \| board shell | Keywall / Connect AI as first screen |
| Topbar Import / New / Open | Same three buttons on Files rail |
| Native SeqDiagram board view | “Download Export to see brand diagram” as only path |
| Process rail that **fits** | Overflowing Investigate/flows chrome |
| Equal ±/send, centered composer | Fat Plan-tasks pill / weird + toolbar |
| Structural board aesthetic | Stock Mermaid / random MADR-as-default when personal map view is wanted |
| One empty board cold start | Walkthrough/Patterns dump on first open |

---

## 7. QA bar (users must pass these)

**Human-usability (persona tests)**
- A opens app → can chat + see empty board without attaching or pasting a key.
- A gets a plan with **diagram on the right** from one prompt.
- B attaches repo → “explain this” → board shows grounded overview they can export.
- B starts an agent workflow from a latency ask and can watch steps.
- Neither sees rail duplicate attach CTAs; Process pane fully readable (no clipped rows).
- Composer: + and send same size; placeholder vertically centered; attach chips icon-native.

**Brand (one-to-one with Structural book)** — **⚠ RETIRED (v2 pivot).** `--steel-*` / `--signal*` / `--ctrl-*` are the v1 Structural vocabulary and `brandTokens.test.ts` compares against a retired book. Graphite's own tokens (`--surface-1`…, `--accent`) from `docs/brand/graphite/_core.html` replace them, and Graphite law 4 — *never invent a number* — replaces the byte-identical rule. Keep the *intent*: tokens come from the book, not from a developer's eye.
- ProductShell tokens byte-identical to brand HTML `--steel-*`, `--signal*`, `--ctrl-*`, `--sans`, `--mono` (K1 + B—17.4).
- Architecture board matches Structural book: 4&nbsp;px steel cards, not 20&nbsp;px glass; signal orange &lt;3% / annotation + active path only — **not** ordinary button fill.
- Flow-first `.seqd` board default — not stock Mermaid sequence or unreadable vertical sequence.
- Draw: inline name-only field + magic→assistant (B—21); no naming modal.
- Workflow: product-native horizontal step monitor (B—22); proportional caption, not demo overlay.
- Diagram density/feel competitive with coding-canvas-demo (owner bar).
- Screenshot acceptance matrix: **deleted 2026-08-20** (superseded as a gate first by the Console book's sheet 40 and then, 2026-08-19, by Graphite). The v2 visual gate is the `docs/brand/graphite/` sheet the surface touches plus the legibility gate in `docs/release-gate.md`.

**Correctness**
- `.seqd` validate/export round-trip; grounded ids; no fabricated services.
- Local-first works with no key.

**Regression**
- Existing gates: `pnpm -r build`, `pnpm test`, e2e bindings when Chromium present.
- Product persona + matrix rows: `pnpm --filter @sequence/web test:e2e:product` (`product-journey.mjs`; its v1 matrix lock doc was deleted 2026-08-20).

**Legacy retirement**
- Legacy App/Workspace/SideRail **deleted**; `ProductApp` is the only boot path (`productRouteAudit.test.ts`). `?legacy=1` is ignored without server inject.

---

## 8. Honest gap vs this branch (2026-08-05, updated post Wave M)

> **⚠ RETIRED SECTION (v2 pivot, 2026-08-20).** This is a status table for v1 ProductShell rows in `packages/web`. Every "Shipped" claim here is about a surface being deleted at Wave 7. Kept as the honest record of what was built and gated; it is not a v2 backlog. The v2 status lives in `docs/research/v2-architecture-and-gaps.md`.


> ProductShell is the **default** boot path; `test:e2e:product` locks matrix rows + Journey A/B smoke. Owner §11 still requires **brand-book one-to-one + screenshot matrix green** — e2e alone is not done.

| Vision item | Status on rebuild branch |
|-------------|--------------------------|
| ProductShell cold start (chat \| empty board) | **Shipped** — `product-shell` · `product-journey` (journey-a) e2e |
| Topbar Import/New/Open only | **Shipped** — `product-attach` · `product-journey` (journey-b) |
| Native board = SeqDiagram / flow-first `.seqd` | **Shipped** — `product-seqd-board` · shopfront attach |
| English / evidence on attach | **Shipped** — server `nodeDetail` → board rail |
| Chat → live `.seqd` on board | **Partial** — design/path commits seqd from ask (#46); `product-chat-diagram` stubs `/api/ask`; **real-model Journey A not owner-signed** |
| Plan Tasks → Task Board cards | **Shipped** — #51 (`pendingItemsFromPlanTasks` / `queuePlanBoardImport`) |
| Craft from 0 → real files | **Partial** — Wave 2 depth (#58): scoped generate, build/test verify nodes, Promote to scan; Journey A owner walk still open |
| Harness on the graph (Moat §5.5) | **Partial** — trajectory + distill/refine/verify (#48–#58); mid-turn tool loop = **Main Agent Moat W1** |
| Ask honesty (thinking / chip-only / thin How-it-works) | **Shipped** — #59 notes + Build CTA; chip-only keepers; SSE phase labels |
| Mid-turn ask tool loop (read/search) | **Shipped** — Main Agent Moat W1 (`askTools` + SSE; #60) |
| Multi-file edit Accept in product path | **Shipped** — Main Agent Moat W2 (`FileEditProposalBar`) |
| In-product Git (status/diff/commit) on Index | **Shipped** — Main Agent Moat W3 (`/api/git/*` + Index Changes) |
| Denser session stack in chat column | **Shipped** — Main Agent Moat W3 (`product-chat-session-stack`) |
| `@` grounded mentions (service/file/function) | **Shipped** — Main Agent Moat W4 (composer `@` picker → context chips) |
| MCP **consume** (allowlisted external tools) | **Shipped** — Main Agent Moat W5 (`/api/mcp/*` + Index Tools); `@sequence/mcp` remains **export** |
| Draw inline name + magic→assistant | **Shipped** — `product-draw` e2e; owner visual still required |
| Draw ↔ chat ↔ `.seqd` sync | **Partial** — finish-draw gesture owner TBD; provisional accept path only |
| Composer B—18 geometry + keeper menu | **Shipped** — unit + `product-composer-geometry` e2e; owner visual still required |
| Product-native workflow (no demo dump) | **Shipped** — `product-workflow-surface` e2e; shot review open |
| Structural brand one-to-one | **Open** — matrix B—17–B—23 e2e locks added; owner shot sign-off pending |
| Site marketing shots = ProductShell | **Shipped** — `site/assets` ProductShell binaries; owner one-to-one review open |
| Legacy App/Workspace/SideRail | **Deleted** — ProductApp-only (`productRouteAudit.test.ts`) |
| ADR-013 model efficiency | **Partial** — Phases A–D shipped; Phase E (OAuth/JCode adapters) open / out-of-band |
| Journey B density / persona walk | **Partial** — `product-journey` + attach e2e; real-repo legibility + owner walk open |
| Incremental seqd stream + camera | **Parked** — provider delta SSE (`docs/research/seqd-stream-park.md`) |
| Codemap regenerate | **Parked** — no documented generate command |
| Track G deploy/signing/hosted | **In program** — Public beta + Replace Cursor (`docs/decisions/public-beta-replace-cursor-madr.md`); install/site CTA/trial pack + owner walk |
| ADR-011 Scratch fold | **Out-of-band** — owner sign-off (Track H) |

**Acceptance rule (§11 / Appendix M4):** a row above is not done until the matching brand sheet / matrix harness passes **and** rendered shots are inspected. Green unit tests alone do not close §11.

---

## 9. Change-control (so we don’t stray)


1. This file = **source of truth for product** (users, journeys, moat, scope, QA bar). The **source of truth for visual** is the frozen Graphite book `docs/brand/graphite/` plus `docs/brand/GRAPHITE-DECISIONS.md` — not the Structural book, which this line named and which was retired two books ago.
2. New feature proposals must map to Journey A, Journey B, or Moat §5 — or be labeled **parked**.
3. If owner (or agent) proposes something outside this plan: ask
   **“Confirm: add to final plan?”** → only then amend this doc and build.
4. Prefer cutting bloat over adding parallel surfaces.

---

## 10. Immediate build program

> **⚠ RETIRED SECTION (v2 pivot, 2026-08-20).** Superseded by `docs/PIVOT-V2.md` and the wave order in `docs/research/v2-architecture-and-gaps.md`. The program below built the v1 ProductShell.


**Active (2026-08-15):** **Work \| Code visual workbench** — `docs/decisions/work-code-modes.md`. Canon + ProductShell dual-mode chrome, clone hop, Canvas artifacts, Code Architecture depth.

**Prior (closed on main):** Main Agent Moat W1–W5 (#60); How-it-works honesty (#59); full-product Waves 0–4 (#58).

**Strategy (close-out, historical):** ProductShell-only; **hard-delete** quarantined legacy chrome; ADR-013 efficiency Phase A→B; regenerate ProductShell `site/assets` shots; close screenshot matrix rows. Reuse SeqDiagram IR + scan/API only.
**Execution (historical):** agency waves on PR #19 — see close-rebuild-gaps plan (validate → legacy wipe ∥ site shots ∥ JCode A → JCode B → matrix → release).

Historical from-scratch waves 1–6 landed on this branch; do not re-run them:

1. ProductShell cold start (chat \| empty board) — done
2. Native SeqDiagramBoard (Structural) — done
3. Attach → graph → `.seqd` on board — done
4. Chat → board `.seqd` sync (minimal) — done (mock-e2e)
5. Composer + brand CSS — done
6. Draw (inline + magic) — done

---

## 11. Owner screenshot review (2026-08-05)

> **⚠ RETIRED SECTION (v2 pivot, 2026-08-20).** The **owner's complaints are still evidence** — "old Mac / overwhelming" chrome, wrong composer geometry, flow direction — and the v2 surface must not reproduce them. But the **remedies are retired**: B—17–B—23, the Structural screenshot-acceptance matrix and "Console sheet 40" all name books that no longer bind, and every target is a `packages/web` component. The v2 visual gate is the Graphite sheet the surface touches plus the legibility gate in `docs/release-gate.md`.


Verbatim owner reaction to current product screenshots (logged in [`owner-feedback-log.md`](owner-feedback-log.md)):

| Topic | Owner's words (summary) | Binding rule |
|-------|-------------------------|--------------|
| Overall chrome | Current UI reads **old Mac / overwhelming** — not Structural | ProductShell MUST match brand book B—17–B—23 one-to-one or stop and extend the book first |
| Mermaid sequence | **Unreadable** | Flow-first `.seqd` board default; Mermaid sequence is export-only projection |
| Flowchart direction | **Has merit** | Keep horizontal flow lanes (B—19.3) |
| Rail CTAs | Import/New/Open on rail is **wrong** | Topbar-only (C3/C4); Files rail tree-only if retained |
| Composer | Center/size/context bar **wrong** | B—18: equal 32×32 controls, centred placeholder, token context row |
| Draw | Must be **inline name-only** + **magic→assistant** | B—21; no modal naming |
| Workflow | Demo/caption/proportions **wrong** | B—22 product-native step monitor |
| Brand fidelity | **One-to-one with brand book or back to drawing board** | The Structural screenshot-acceptance doc and Console sheet 40 were the historical visual stops; both are **retired and deleted**. The live one is the Graphite sheet for the surface (`docs/brand/graphite/pages/`) |

**Acceptance:** a change touching any row above is not done until the matching brand sheet spec passes in the running ProductShell **and** the screenshot matrix row is green.

---

## 12. JCode — late architecture track (parked)

> **⚠ RETIRED SECTION (v2 pivot, 2026-08-20).** Still parked, still late. Its constraint is restated: when scheduled it obeys **Graphite** tokens (`docs/brand/graphite/`), not "Structural tokens", and there is no parallel macOS chrome to avoid because that tree is deleted.


**JCode** (Java/Kotlin grounded architecture extraction and board presentation) is explicitly **late** in the program — after ProductShell parity on §11. Do not block shell/board/composer/draw work on JCode. When scheduled: must still obey Structural tokens and `.seqd` flow-first rules; no parallel macOS chrome.

---

*Owner: Max · Locked into repo so every agent session can re-read instead of re-guessing.*

---

# Appendix A — Owner words → product rules

**Added 2026-08-05.** Every major claim the owner has made about this product, restated as a
**MUST** or **MUST NOT** with zero ambiguity, plus how a machine or a human checks it. This appendix
is *derived from* the owner's words; it adds no new product scope. Sections 1–10 above stay canon —
where this appendix is more specific, the specific version wins.

**How to use it:** before building, find the rule your change touches. If your change would break a
MUST or perform a MUST NOT, stop and ask *"Confirm: add to final plan?"* (§9). If a claim is missing
here, it has not been decided — do not infer it.

Execution plan for these rules: the v1 `product-from-scratch-plan.md` — **deleted 2026-08-20**, superseded by [`PIVOT-V2.md`](PIVOT-V2.md) and [`rebuild/README.md`](rebuild/README.md).

**Provenance.** An earlier round (`0e02e00`) added a compact MUST / MUST NOT table under the same
heading. Every row of it is **folded into the sections below** — nothing from it was dropped, and A.0
exists specifically to carry the rules that only that table stated. Recorded here in the shape
`docs/owner-feedback-log.md` uses for superseded entries, so the merge reads as a consolidation and
not as a decision quietly redesigned away.

---

## A.0 Personas and entry paths (folded from the r-prior compact table)

| # | Owner's words | Rule | Checked by |
|---|---|---|---|
| E1 | Work is not engineers-only; Code is technical (grill 2026-08-15) | **MUST** design Work for planners/operators of real work systems and Code for technical repo work. **MUST NOT** treat a non-work consumer chatbot as the primary user | Persona tests in §7 |
| E2 | "Visual-first beats outdated text-only coding tools" | **MUST** put chat and board on one page. **MUST NOT** ship a chat-only or files-first default | Cold-start e2e (C1) |
| E3 | Three ways in: start from scratch, attach a repo, or just chat | **MUST** support all three from the same cold start. **MUST NOT** force an attach before the user can chat | `product-shell` e2e sends a message with no repo attached |
| E4 | "Cursor and Polarity had a baby … coding-canvas-demo" (r179) | **MUST** hold one design language across every product surface | Token/selector tests (K4) |
| E5 | "Export for other agents (Claude teammates)" | **MUST** offer `.seqd` / SVG / Mermaid export. **MUST NOT** auto-write artifacts to the repo without an explicit user toggle | The `.seqd` auto-write preference stays opt-in (default OFF) |
| E6 | "Stock Mermaid / random MADR-as-default" is bloat (§6) | **MUST NOT** present stock Mermaid green, or a MADR view, as the default board | Board default is the `.seqd` Structural view |
| E7 | "Board only as static screenshot download" is not the product | **MUST** make the board interactive (draw later, AI now). **MUST NOT** ship it as a picture of a diagram | B1 + Wave 6 |

---

## A.1 The shell (owner: 2026-08-05, "start from scratch")

> **⚠ RETIRED SECTION (v2 pivot, 2026-08-20).** S1's rule — *build the default experience in a new tree that does not import the current shell* — is what the pivot now executes at full scale: the new tree is **`packages/web2`**, not `packages/web/src/product/`. The owner quote binds; the path does not.


| # | Owner's words | Rule | Checked by |
|---|---|---|---|
| S1 | "Start from scratch for the product shell/UI" | **MUST** build the default experience in a new tree that does not import the current shell — as of the v2 pivot that tree is **`packages/web2`** (it was `packages/web/src/product/`) | Import-firewall test over `product/**` |
| S2 | "do NOT keep building on the bloated current App/Workspace/SideRail/Try-strip stack as the default experience" | **MUST NOT** add product features to `App.tsx`, `Workspace.tsx`, `SideRail.tsx`, `GroupedCanvas.tsx` or the Try strip; they are legacy-only from now on | Wave may-touch/must-not-touch lists; PR review |
| S3 | "Hide the current UI behind a legacy flag (`SEQUENCE_LEGACY_SHELL=1` or localStorage) — default NEW shell" | **MUST** resolve legacy from a **runtime**-visible server flag (`SEQUENCE_LEGACY_SHELL=1`), then `?legacy=1`, then `localStorage['sequence:legacyShell']`, else product. A build-time-only read does **NOT** satisfy this (see from-scratch plan T8/T9) | `productLegacy.test.ts` + e2e both ways on a prebuilt bundle |
| S4 | same | **MUST NOT** delete the legacy shell in this program; it stays reachable, buildable and green | `pnpm test` unchanged; `?legacy=1` e2e stop |
| S5 | "Reuse only essential cores: SeqDiagram IR, analyzer scan/API, chat send path if thin, store attach/graph primitives, brand tokens" | **MUST** reuse exactly those (enumerated in the from-scratch plan §1.3 REUSE). **MUST NOT** import any other legacy module into `product/` | Import-firewall test |
| S6 | "chat send path **if thin**" | The 1345-line `BoardChat.tsx` is **not** thin: **MUST** reuse only `askBoard` (one `fetch`) and rebuild the chat UI small | `product/chat/sendAsk.ts` exists; firewall test forbids importing `BoardChat` |
| S7 | "owner wakes up to a product that matches the final plan journeys A/B" | Overnight **done** = Journey A step 1–5 and Journey B step 1–3 are walkable in the default shell with no key and no manual setup | Persona walkthrough + product e2e harnesses |

## A.2 Cold start (§3)

| # | Owner's words | Rule | Checked by |
|---|---|---|---|
| C1 | Work home: chat + board ~equal, Codex session rail | **MUST** render chat + visual stage on first paint with no repo and no key; default session `mode=work` | e2e: `product-chat` + `product-board` + `product-mode-work` |
| C2 | "no keywall first" · "Not acceptable: dumping keywall + choose-repo as the first full-page experience" | **MUST NOT** render a key prompt, Connect-AI CTA, or repo picker as a full-page first screen. **MUST** keep the composer usable without a key | e2e: DOM has no `ai-connect-cta` / `home-screen` at root |
| C3 | "Attach via **topbar only**" | **MUST** expose Import / New project / Open folder in exactly one place, the topbar | Attach-control count == 1 in the product DOM |
| C4 | "Files rail: tree only — NO Import/New/Open duplicates" · "rail still showing Import / New / Open" is *not acceptable* | **MUST NOT** render any attach CTA outside the topbar — in a rail, an empty state, or a board overlay | Same count test, asserted on the empty state too |
| C5 | "One empty board cold start" vs "Walkthrough/Patterns dump on first open" | **MUST NOT** auto-open a tour, guide, hero, patterns list or template gallery on first open | e2e first-paint DOM assertion |
| C6 | "Local attach … never block attach" · local-first non-negotiable | **MUST NOT** require a key, login or network for attach, scan, board render, `.seqd` open/save | `sequence doctor`; key-less e2e path |
| C7 | "Process pane overflowing / unreadable" is not acceptable | Any pane the product ships **MUST** fit its box or scroll; a clipped row is a failure, not a cosmetic issue | Legibility gate + shot review |

## A.3 The board and `.seqd` (§5.3, Journey A step 4)

| # | Owner's words | Rule | Checked by |
|---|---|---|---|
| B1 | "native **SeqDiagram** view of the plan … **not** 'go Export and download'" · OF4 regular Architecture = coding-canvas *feel* | **MUST** render the diagram in-app from the `.seqd` document as a **native-English architecture map** (readable cards: title + what-it-does, typed edges, expandable rollups) judged against coding-canvas-demo density (K3). **MUST NOT** make export/download the only path to a brand diagram; **MUST NOT** leave the default attach view as postage-stamp FLOW·LANE boxes | `product-seqd-board` e2e; English-label + expand tests; owner shot |
| B2 | "`.seqd` native — IR is the collaboration artifact; Mermaid/SVG are projections; board *is* the SeqDiagram experience" | Architecture's single source of truth **MUST** be a `SeqDiagramV1` document; every Architecture visual **MUST** be derived from it. Sketch/Draw writes the same doc. Whiteboard ink is a separate companion file | Board renders Architecture only from the doc; draw/chat write the doc, not the pixels |
| B3 | "Grounded — every edge/claim from real evidence when a repo is attached" | **MUST NOT** place a node or edge that is not in the scan. Ids **MUST** trace to graph ids | `seqdFromGraph.test.ts`: node ids ⊆ graph ids, endpoints resolve |
| B4 | "Grounded, never fabricate" (product principles) | When an answer contains no diagram, the board **MUST** stay unchanged and say so. **MUST NOT** synthesise a plausible diagram | `sendAsk.test.ts`: prose-only answer writes nothing |
| B5 | "User can export `.seqd` / Structural SVG / Mermaid to other agents" | `.seqd` **MUST** validate and round-trip; projections **MUST** come from the same doc | Schema round-trip tests; export projection reuse |
| B6 | "can see every micro feature, service, and function throughout the entire board … more detailed, in more English, and more followable for beginners" (r184) | Density is a feature: **MUST** show more real rows and scroll, **MUST NOT** re-cap sub-rows at 6 | r184 note in `owner-feedback-log.md` — superseded decision, do not "restore" |
| B7 | "'+N more' was a dead end" | Any truncation **MUST** expand in place to something real; **MUST NOT** be a decorative count | Board expansion test + shot |
| B8 | "native English names, not path casing" · "name things from patterns when nothing explicit exists" | Labels **MUST** be the plan's or the repo's English names; **MUST NOT** staple mechanical suffixes ("… service") onto a name that already reads | `seqdFromPlan` / labelling tests |
| B9 | "a fit that cannot be read is not a fit" (r184 paired change) | The board **MUST** hold a readable zoom floor and pan instead of zooming out past legibility | `boardViewModel.test.ts` fit floor |

## A.4 Brand (§5.6, §7 Brand)

> **⚠ RETIRED SECTION (v2 pivot, 2026-08-20).** K1's `--steel-*` / `--signal*` / `--ctrl-*` and K6's macOS-legacy scoping are retired with the Structural and macOS books. **The rule that survives is K1's shape, not its token names: product tokens MUST be the brand book's own values** — now `docs/brand/graphite/_core.html`, under Graphite law 4 (never invent a number). K5 (no fake traffic lights) is a settled dislike and still binds.


| # | Owner's words | Rule | Checked by |
|---|---|---|---|
| K1 | "Brand book — Structural Engineering for web **and** the architecture board" | Product tokens **MUST** be the brand book's own `--steel-*` / `--signal*` / `--ctrl-*` / `--sans` / `--mono` values, byte-identical | `brandTokens.test.ts` reads the brand HTML and compares |
| K2 | "signal orange <3% / title rules, not orange buttons" | Signal **MUST** be reserved for title rules, active edges and status; **MUST NOT** be a button fill; **MUST** stay under 3% of default-board pixels | Signal-budget check + shot review |
| K3 | "Diagram density/feel competitive with coding-canvas-demo (owner bar)" | The board's read **MUST** be judged against that reference on a real repo, not a fixture | Human-usability gate on the Sequence monorepo |
| K4 | "consistent throughout every single feature, not just a single feature" | Every product surface **MUST** read from the one token layer; **MUST NOT** declare inline colours or its own font stack | Selector/token tests; r166 font-stack contract |
| K5 | "the macOS top-left red-light/green-light thing … shouldn't be shown as actual design things" | **MUST NOT** draw fake traffic lights or other OS chrome imitations | Settled dislike — do not reintroduce |
| K6 | brand additivity (this program) | Structural tokens **MUST** be the ProductShell default. Legacy macOS tokens stay scoped to `?legacy=1` until parity, then **retire** — not maintained in parallel | `selectorSafety.test.ts` + legacy flag e2e |

## A.5 Composer and chrome (§7)

| # | Owner's words | Rule | Checked by |
|---|---|---|---|
| M1 | "+ and send same size; placeholder vertically centered; attach chips icon-native" | **MUST** derive both control boxes from one size constant and centre the placeholder off the input's own line-height | `composerModel.test.ts` + shot |
| M2 | "Equal ±/send, centered composer" vs "Fat Plan-tasks pill / weird + toolbar" | **MUST NOT** ship a fat action pill or a second toolbar row in the composer | Composer model + shot review |
| M3 | "planned tasks: what breaks and break it down" · OF5 Models submenu + Start a workflow | The product `+` menu **MUST** contain keepers **Plan tasks, Break it down, What breaks**, plus **Start a workflow** (opens agent workflow + chat), plus a **Models** submenu (Cursor-style: search · Auto · list · Add models — not a fourth flat Free/Add dump). **MUST NOT** grow further keepers without the owner | `composerModel.test.ts` exact-set + Models submenu assertion |
| M4 | "Code landed; owner still sees fail" (composer chrome, §8) | A fix **MUST NOT** be called done on a code diff; it is done when the owner's reported shape passes in the running product | Locking test built from the *reported* shape + shot |
| M5 | "when you choose /plan you don't see these things" (r-E2) | Mode/context/draw information **MUST** travel as structured fields; **MUST NOT** be spliced into the user's typed message | `sendAsk.test.ts` payload assertions |

## A.6 Draw ↔ chat ↔ `.seqd` (§5.4, Journey A step 5)

| # | Owner's words | Rule | Checked by |
|---|---|---|---|
| D1 | "User **draws** on the board to change the plan → assistant adapts → `.seqd` updates" | A drawn shape **MUST** end up in the document and in the assistant's context | `drawSync.test.ts` + `sendAsk` context test |
| D2 | "finish-draw gesture TBD with owner" | **MUST NOT** invent and ship a finish-draw gesture as canon; use an explicit accept and flag it as provisional | Wave 6 accept-gated proposals |
| D3 | grounded + no fabrication | A stroke that does not resolve (an arrow with no endpoint) **MUST** be refused, not guessed | `drawSync.test.ts` refusal case |
| D4 | "Draw toggle" on one canvas (final-product-design canon) · OF3/OF4 Architecture\|Whiteboard | **MUST** keep Architecture understanding and editing on **one `.seqd` SoT** with a Draw toggle on that board. **MAY** offer a Whiteboard **ink mode** (strokes/shapes JSON) that is **not** architecture schema and never becomes grounded services. **MUST NOT** remount legacy GroupedCanvas/PlainCanvas as a parallel product board (S2) | ProductBoard modes; whiteboard export tests; firewall |

## A.7 Agent workflows and scope order (§5.5, §10)

| # | Owner's words | Rule | Checked by |
|---|---|---|---|
| W1 | "When ready: AI icon / agent workflow turns drawing into real files (monitored graphic workflow)" | Workflows **MUST** be monitorable, local and model-agnostic; **MUST NOT** write files without a visible, approvable step | Existing approval-gate tests; product wave later |
| W2 | "we aren't launching it for people to use just yet" | **MUST NOT** prioritise auth, metering, multi-tenant or hosted free-tier work over journeys A/B | From-scratch plan §4 non-goal 10 |
| W3 | "Rebuild alone does not close this gap" (§8) · "Do NOT claim product-done because SeqDiagram Export/CLI shipped" | **MUST NOT** report product progress from infra/IR/CLI work; progress is measured in journey steps a human can walk | Round reports cite journey steps, not files |
| W4 | "If a future idea conflicts with this doc, **ask the owner**" (§9) | **MUST** ask "Confirm: add to final plan?" before building anything outside §4/§5; **MUST** then amend this doc | Change-control; PR review |
| W5 | "Prefer cutting bloat over adding parallel surfaces" (§9.4) | **MUST NOT** add a surface to work around a broken one; fix or hide the broken one | Wave scoping |

## A.8 Process, honesty and standards (owner-feedback-log, product-principles)

| # | Owner's words | Rule | Checked by |
|---|---|---|---|
| P1 | "maximum triple-A UX, UI, features, fallbacks, no failures, production-ready" | Every change **MUST** clear all three gates: correctness, legibility, human-usability | `docs/release-gate.md` |
| P2 | "'it runs' ≠ 'a human can use it'" | **MUST** judge from the user's seat as a confused first-timer; a feature that cannot be found or read is **not** done | Human-usability gate |
| P3 | "How do we make sure features are actually consistent with what we say?" | A claim **MUST** be derived from, or verified against, the thing it describes — never written alongside it | `docs/feature-honesty.md` |
| P4 | "Fixture scale proves logic; only a REAL repo proves the result" | Any claim about layout, truncation, counts or density **MUST** be checked on the real Sequence monorepo | Legibility gate + shot review |
| P5 | Owner-reported defects (r183/r184/E1 pattern) | A fix for a reported defect **MUST** carry a test built from the **reported** shape that fails before the fix | Locking-test discipline |
| P6 | Superseded-like notes (r94, r102, r184) | **MUST NOT** redesign away a recorded LIKE, and **MUST NOT** reopen a settled dislike; a reversal **MUST** be written down as the owner's decision | `docs/owner-feedback-log.md` |
| P7 | "Never leak a user key" · local-first | **MUST** keep `.sequence/` reserved; only the narrow, realpath-judged `.seqd` and decision-record holes are readable/writable | Analyzer jail tests, incl. symlink/hard-link refusal |
| P8 | honest errors | Every failure the user can reach **MUST** say what happened in plain English (422 no-manifests, 403 browse-root, no-key) — no stack traces, no silent empty state | Error-copy unit tests per flow |
| P9 | "don't manufacture churn" | **MUST NOT** rewrite a working surface for taste; the from-scratch decision is scoped to the shell the owner named | Wave file ownership |

