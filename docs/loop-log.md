# Autonomous Loop — Round Log

Newest first. Each entry: what the swarm found, what shipped (or why nothing did), gate
numbers. See `autonomous-loop.md` for the mechanism and `vision.md` for the bar.

**Loop audit (2026-07-24, pre owner re-test):** working tree clean · r35–r45 + Lumen r42–r44
verified in code · node tests schema 232 · acp 15 · analyzer 357 · ink 15 · e2e SKIP exit 0
(no Chromium). **Env note:** this Mac had only `@rollup/rollup-darwin-x64` installed — `pnpm -r
build` / web vitest fail until `pnpm install` restores arm64 optional dep; web `tsc --noEmit` passes.
Last logged web vitest floor: **513** (r45). Full matrix → `archive/handoffs/loop-audit-2026-07-24.md`.

**Baseline (before r1):** `main` green — `pnpm -r build` clean; schema ✓, acp ✓ (15),
analyzer ✓ (fail 0), web ✓ (239 vitest). This is the floor the loop ratchets from.

**★ STABLE RATCHET REACHED (after r15).** The r14 full re-audit (3 lenses) found NO tier-1 finding —
correctness base intact after 13 rounds, features cohere end-to-end, overlays provably mutually
exclusive. The one gap it surfaced (gated coverage of the feature bindings) was closed in r15, so the
moat is now protected by the gate. Both greenlit features complete (Edit=real, Programs compose +
drive-ACP); the moat has 3 working layers (talk-to-draw seeds, failure-impact, risk advisor). Per
`autonomous-loop.md`, the loop now SLOWS to the heartbeat cadence and shifts to tier-3 breadth +
tier-2 polish (moat layer 3 industry-correct starters/resilience patterns; the logged cosmetic nits;
Guide-vs-Learn consolidation) until the owner stops it. Current gate: build clean · schema 195 · acp
15 · analyzer 333 · web 371 · 6 gated e2e pass.

Last logged web vitest floor: **554** (r63). Full matrix → [`loop-audit-2026-07-24.md`](loop-audit-2026-07-24.md).

## r225 — SqlModal → Radix Dialog · SHIPPED ✅

**Goal:** First Dialog adoption — SelectionMenu SqlModal overlay/focus/Escape via `ui/Dialog`.

**Gate:** sqlModalDialog + SelectionMenu + Dialog + radiusTokens **44** pass.

**ui-primitives track:** Menu · Popover · Tooltip · Dialog all adopted on at least one
shipped surface. Optional: more tooltips / ADR modals. Owner gates unchanged.

## r224 — Tooltip.Provider + topbar/tab tools · SHIPPED ✅

**Goal:** First Tooltip adoption — Provider on attached `div.app`; 6 icon buttons
(guide/learn/docs + close/split-h/split-v).

**Gate:** workspace + Tooltip **345** pass.

**Next:** SqlModal/ADR → Dialog (optional polish) or heartbeat (owner gates).

## r223 — InkOverlay kind picker → Radix Popover · SHIPPED ✅

**Goal:** Last hand-rolled `.connect-popover` (ink kind choice) → Popover.Anchor/Content.

**Gate:** inkNodePopoverRadix + Popover + radiusTokens **36** pass.

**Radix overlay track:** menus + all connect-popover skins on Radix. Optional next =
Tooltip / Dialog polish; owner gates unchanged.

## r222 — CreateNodePopover → Radix Popover · SHIPPED ✅

**Goal:** Architecture Create-with-AI floating form → Popover.Anchor/Content.

**Gate:** createNodePopoverRadix + CreateNodePopover + Popover + radiusTokens **50** pass.

**Next:** InkOverlay last hand-rolled `.connect-popover`.

## r220 — ProgramGraph ConnectPicker → Radix Popover · SHIPPED ✅

**Goal:** Last `.connect-popover` cousin (Agents/ProgramGraph) → Popover.Anchor/Content.

**Gate:** programs suite + Popover + radiusTokens **236** pass.

**ui-primitives:** all listed `.connect-popover` cousins now on Radix. Next polish =
Tooltip / Dialog (optional) or ADR-011/v20.

## r219 — DomainCanvas RelKindPicker → Radix Popover · SHIPPED ✅

**Goal:** Domain relationship kind picker `.connect-popover` → Popover.Anchor/Content.

**Gate:** domainRelPickerPopover + domain + Popover + radiusTokens **44** pass.

**Next:** ProgramGraph last `.connect-popover` cousin.

## r218 — SelectionMenu → Radix Popover · SHIPPED ✅

**Goal:** Selection floating menu `.connect-popover` → `Popover.Anchor`/`Content`.

**Gate:** selectionMenuPopover + Popover + radiusTokens **36** pass; SelectionMenu Research gate 9/9.

**Next:** DomainCanvas / ProgramGraph remaining cousins.

## r217 — AddBlockPopover → Radix Popover · SHIPPED ✅

**Goal:** Design-canvas add-block cousin of ConnectPopover → `Popover.Anchor`/`Content`.

**Gate:** addBlockPopover + Popover + radiusTokens **36** pass.

**Next:** SelectionMenu / DomainCanvas / ProgramGraph `.connect-popover` (one each).

## r215 — ConnectPopover → Radix Popover · SHIPPED ✅

**Goal:** Canvas-anchored edge connect picker → `ui/Popover` (Anchor + Content);
Escape/outside-click → cancel; `--r-panel` kept.

**Gate:** connectPopover + Popover + radiusTokens **39** pass.

**ui-primitives:** high-priority hand-rolled menus/popovers for composer+, wtab, theme,
board-add, connect now on Radix. Remaining: other canvas `.connect-popover` cousins
(SelectionMenu / AddBlockPopover) if still hand-rolled — optional follow-on.

## r214 — Task Board add-menu → Radix Menu · SHIPPED ✅

**Goal:** NativeBoard `board-add-menu` → `ui/Menu`; preserve add card/table testids.

**Gate:** boardAddMenu + Menu + radiusTokens **35** pass.

**Next:** `connect-popover` (ui-primitives #1 remaining hand-roll).

## r213 — ThemePicker → Radix Menu · SHIPPED ✅

**Goal:** Next ui-primitives surface after wtab — Appearance theme menu gets Radix
Menu (Escape/focus/outside-click); restore `.wtab-menu` `--r-panel` radius after r212.

**Gate:** ThemePicker + Menu + radiusTokens + tabOverflow **50** pass.

**Next:** `board-add-menu` or `connect-popover` (one surface).

## r212 — Tab-bar menus → Radix Menu · SHIPPED ✅

**Goal:** Next `ui-primitives.md` migration surface after composer `+` — overflow + add-tab
menus get focus trap / Escape / outside-click via Radix `Menu` (Polarity tokens kept).

**Wave A:** `Workspace.tsx` TabBar menus; CSS `.wtab-menu*` for portalled content; locking
tests in `tabOverflow.test.ts` (+ `shellDefects` ordering).

**Gate:** workspace + Menu vitest **342** pass · testids preserved (`wtab-more-menu`,
`wtab-more-item`, `open-board`, `open-program`).

**Next:** connect-popover OR theme-menu / board-add-menu (one surface per change).

## r211 — Agent-doc diet + site brand + bottom zones · SHIPPED ✅

**Goal:** Post-P6 hygiene — stop context-bomb / explore-swarm failure modes in docs+skills;
site Structural brand gate; canvas bottom chrome zone ladder for journey/loop overlays.

**Waves (Composer BUILD, CONTEXT DIET, no explore swarm):**
- **A** — AGENTS / HANDOFF-RESTART / CLAUDE READ list / autonomous-loop skill description /
  owner-feedback OPEN cleanup / product-final Draw→logic ✅ / P0 boxes + MADR paths
- **B** — site duplicate `id="agents"` + docs numbering 04.3 continuity; `site/BRAND-CHECK.md`
- **C** — `--zone-bottom-*` ladder + `bottomZone.ts` locks; archChrome/archFoot expectations updated

**MADR:** [`docs/decisions/r211-autonomous-close.md`](decisions/r211-autonomous-close.md)

**Gates:** `pnpm -r build` clean · web vitest **2607** pass (1 skipped) · site brand python gate OK ·
no Chromium → e2e bindings not re-run this round

**At-bar (local-first):** harness + moat L1–L3 remain closed from r210. Owner gates unchanged
(gateway deploy, Mermaid aesthetic, signing, hosted workspaces).

**Next:** ADR-011 remainder / v20 Phases 2–6 · H10 · or owner deploy checklist

## r210 — P6 foundation verify · SHIPPED ✅

**Goal:** Close P6 foundation — refresh docs to r209 shipped state, fill retrospective, run gates.

**Docs (6A–6C):**
- `holistic-audit-matrix.md` — all applicable rows GREEN; P6 verdict (r210)
- `tier-completion-retrospective.md` — filled (Tier-1/2/3 outcomes, owner gates, lessons, follow-ons)
- `tier-completion-madr-outlook.md` — P4/P5/P6 closed
- `tier-completion-orchestration-plan.md` — P5/P6 checkboxes
- `tier-completion-execution-plan.md` — phase matrix 100% coded

**Gates (6C):**
- `pnpm -r build` — clean
- `pnpm test` — green (all packages)
- `pnpm --filter @sequence/web test` — **2599** pass, 1 skipped
- `impact-investigate.mjs` — PASS (shopfront Process + monorepo stem 8 hops, no SKIP)
- `resilience-advisor.mjs` — PASS (panel + toggle + grounded suggestions)
- `pnpm qa:smoke` — no failures, no regressions

**Owner gates left:** gateway deploy, signing, Mermaid aesthetic sign-off, hosted workspaces.

**Next:** Owner merge PR #11 · ADR-011 3B-b UI fold · v20 Phases 2–6 · H10

## r209 — P4 stem + P5 panel + P3 scratch seed · SHIPPED ✅

**P4:** `impact-investigate.mjs` two-phase binding — shopfront Process investigate + workspace stem ≥2 hops (no SKIP).

**P5:** `ResilienceAdvisorPanel` + `resilience-advisor-toggle`; `patternAdvisor` single source in `@sequence/schema`.

**P3:** Scratch→design seed in `store.ts`; `editSeeding.test.ts` locks.

**Docs:** `tier-completion-madr-outlook.md`, `creator-master-plan.md` updated.

**Gate:** build · web vitest · impact-investigate + resilience-advisor bindings PASS

**Next:** P6 matrix refresh + retrospective fill

## r208 — P4 Layer 2 + P5 advisor model · SHIPPED ✅

**P4:** `fragilitySurfacing.test.ts`, `boundaryCrossings.test.ts`, `evidenceChains.ts` + test, `impact-investigate.mjs` (Process investigate + ESC; stem SKIP when shopfront <2 hops).

**P3 close:** `BoardInkOverlay` → `recognizeBoardInkIntent` → spawn task card.

**P5:** `patternAdvisor.ts`, `resilienceAdvisor.ts`, `starterPicker.ts`, `moatIntegration.test.ts`, `resilience-advisor.mjs`.

**Gate:** build · web 2598+ vitest · analyzer moat tests · impact-investigate PASS

**Next:** P6 matrix refresh + `ResilienceAdvisorPanel` UI (optional polish) + owner gates

## r206 — P3 draw→logic + Mermaid inline · SHIPPED ✅

**P3 Layer 1:** `drawToLogic.test.ts`, `talkToDraw.test.ts`, `boardInkRecognize.ts` + test, `recognizeStroke.moat.test.ts`, `e2e/bindings/draw-to-logic.mjs` wired into `test:e2e:bindings`. Fixed `openCreateFromDraw` to anchor on first service (checker rejected repo→service edges).

**Mermaid (P2/P3):** `parseMermaidFences.ts` + `ChatMermaidBlock.tsx` in Assistant; `programToMermaid` classDef styling (gate/worker/retry roles); round-trip preserved.

**Gate:** `pnpm -r build` · web vitest 2575 · schema 324 · ink 18 · `draw-to-logic.mjs` PASS

**Next:** P4 impact chains / fragility surfacing (`tier-3-test-spec.md` Layer 2)

## r204 — Tier-3 schema moat L2/L3 catalogs · SHIPPED ✅

**P5 schema slice (early):** `resiliencePatterns.ts`, `industryStarters.ts`, `moatFixtures.ts`, `impactChains.test.ts` — catalogs ≥3 patterns / ≥2 starters; validators green.

**Gate:** `pnpm -r build` · schema moat tests

**Next:** P3 draw→logic (web moat tests un-skip per `tier-3-test-spec.md`)

## r197 — Tier-2 P2 verify docs · SHIPPED ✅

**MADR/docs:** `tier-p2-ux.md`, `tier-p3-draw-to-logic.md`, `tier-p5-patterns.md`, ADR-012 Option C (try chip ask vs map split), holistic matrix tier rows, product-final honesty.

**Next:** P3 implementation waves

## r193 — Tier 1 VERIFY · SHIPPED ✅

**P1 checklist closed:** T1-a through T1-e green on this branch.

- Wave 1A: analyzer 758/758 (verified on main)
- Wave 1B: `test:e2e:bindings` PASS — fixed empty-board invite paths in `board-shots`, `import-function`, `taskboard-shot`; native card assertions honest (no stale tldraw desc preview); `ui-pass` strict-mode fix for duplicate chat textareas
- Wave 1C: `repoFunctionGraph.perf.test.ts` parse-cache locks

**Gate:** `pnpm -r build` · `pnpm test` · `test:e2e:bindings` PASS

**Next:** P2 tier-2 UX (G3 zoom floor, try-chip dedup ADR-012, legibility stops)

## r192 — Tier 1 Waves 1B + 1C · SHIPPED ✅

**1B e2e bindings:** Installed Chromium to `/opt/pw-browsers`; fixed `board-shots.mjs` empty-board invite path (`board-empty-add-card` when toolbar hidden). Full `test:e2e:bindings` green including `arch-proposal`, `breakout-function-flow`.

**1C perf:** `buildRepoFunctionGraph` already shared parse cache via `sharedFacts`; added hit-counter seam + `repoFunctionGraph.perf.test.ts` (warm/cold/second-build locks).

**Gate:** `pnpm -r build` · analyzer tests · `test:e2e:bindings` PASS

**Next:** P1 VERIFY (r193) + P2 tier-2 UX

## r191 — Tier 1 Wave 1A verified · SHIPPED ✅

**Goal:** analyzer test hygiene — portable `diff.test.ts`, ai-server 422 fixes.

**Verified on main:** `shopfront-mutated` fixture in-repo; analyzer **758/758** pass including `diff.test.ts` + all `ai-server.test.ts` generate paths.

**Gate:** `pnpm -r build` · analyzer `node --test` 758 pass

**Next:** P1 Wave 1B e2e bindings + 1C perf

## r190 — Tier completion orchestration program (P0) · SHIPPED ✅

**Owner ask:** 3-tier vision → 100% with MADR/ADR, phased orchestration, parallel subagent ownership matrix, tier-3 locking test spec.

**Shipped:**
- ADR-010 (program), ADR-011 (v20 sequencing), ADR-012 (try-chip dedup placeholder)
- [`tier-completion-orchestration-plan.md`](tier-completion-orchestration-plan.md) — Phases P0–P6, waves A–D, round map r190–r211
- `tier-3-test-spec.md` — moat L1/L2/L3 test files + e2e bindings
- P0 scaffold: `packages/schema/src/moat/*`, `packages/web/src/moat/*` (skipped P3–P5 tests honest)
- Doc sync: `vision.md` Task Board → NativeBoard; `holistic-audit-matrix` row

**Gates:** `pnpm -r build` · schema moat tests · web moat scaffold tests

**Next:** P1 tier-1 closure (r191) — analyzer reds + `test:e2e:bindings`

**Handoff:** `docs/HANDOFF-AGENT-RESTART.md` + `AGENTS.md` anti-loop rules; merged to `main` 2026-08-04.

## r189 — Trellis workflow e2e + legibility green · SHIPPED ✅

**Swarm finding:** Wave A–C Trellis/LangGraph UI shipped in r186 but e2e was incomplete — cloud VM legibility failed on `/workspace` browse attach (browse root `/`), workflow chrome overlapped in narrow panes, hero/run bbox collision after tray chrome, and program bindings lacked shared Chromium discovery.

**Shipped:**
- `browse.ts` — `isContainedInBrowseRoot` fixes filesystem-root jail (`/` parent of `/workspace`)
- `browse-root.test.ts` — 3 locking tests
- `e2e/lib/findChromium.mjs` + `dismissAgentsHero.mjs` — shared by program e2e harnesses
- `program-shots.mjs` — workflow chrome/tray/meta bindings + screenshots
- `legibility.mjs` — `assertAgentsWorkflowChrome`, hero zone, taskboard empty-invite, meta toggle, foot-band zoom sliver tolerance
- `ProgramGraph.tsx` — measured runbar/tray reserves + `heroZoneOk` (hide hero when canvas too short)
- Workflow chrome/tray CSS legibility fixes; Learn button sr-only; bestfit/dp-warnings contrast

**Gates:** `pnpm -r build` · web **2555** · `test:e2e:programs` · `test:e2e:acp` · `test:e2e:program-run` · **legibility LEGIBLE** (1280×800, real monorepo)

## r186 — LangGraph Trellis Waves B+C · SHIPPED ✅

**Wave B (ACP harness):**
- ACP default on new agent nodes + gateway→ACP nudge in node editor
- Harness skills picker (`programAgentSkills.ts`) prepended to agent prompts
- `requiresReview` per-node HITL gate in `webExecutors.ts` + approval UI copy
- `validateHarnessHints` — non-blocking checker-path warnings before Run
- `ProgramWorkflowMeta` metadata dock: overview stats, checkpoint list, recent runs
- `GET /api/program/run-log` reads `.sequence/runs/results.tsv`

**Wave C (audit + time travel):**
- `formatWorkflowRunForExport` — JSON/Mermaid audit from `WorkflowRun`
- Checkpoint history (`loadRunCheckpointHistory`) + Restore in meta dock
- Export audit button on workflow chrome (clipboard)

**Deferred (honest):** LLM routing classifier, nested subgraph templates, MCP tools API (no fabricated MCP list).

**Gates:** `pnpm -r build` · web **2555** · plan doc Waves A–C marked shipped

## r185 — B2/B3 native board default — tldraw removed · SHIPPED ✅

**Native board (Wave 7 complete):**
- **B2** — `BoardInkLayer` + `BoardInkOverlay`; ink strokes persist in `SequenceBoardDoc.ink`
- **B3** — tldraw dep removed; `TaskBoard.tsx` re-exports `NativeBoard`; no CDN icons/watermark
- Legibility + taskboard e2e updated for native React Flow canvas (`data-testid="native-board"`)

**Doc sync:** D2 closed; U13/U20 verified; U12 partial (duplicate chat fixed, sketch collapse intentional); E2/G5 surface context confirmed end-to-end.

**Gates:** build · web **2501** · QA baseline refresh

## Phase D — moat layer ✅ SHIPPED (`cursor/phase-d-full-42b9`)

- **G-D** D2a/D2b — boundary-crossing edges + ImpactPanel crossings list
- **G-E** E2a/E2b — `no-db-write-into` + `composePolicies`
- **Team Lore** — directory heat on Process rail + scope-overlap toggle (default off)
- Legibility stops: `5d88de4`

**Gates:** web **2524** · analyzer **755** · schema **307** · qa:smoke green

## r188 — Phase E site shots + native board layout fix · SHIPPED ✅

**Phase E:** `site-shots.mjs` captured process.jpg, taskboard.jpg, local-first.jpg (native board, no licence).

**Layout:** `.native-task-board .native-board-wrap { position: absolute; inset: 0 }` — fixes 0-height canvas with empty invite at large viewports.

**E2E:** site-shots + taskboard-shot updated for U17 empty-invite flow.

## r187 — U12 accent chrome unification · SHIPPED ✅

Accept/applied/work-log touch hues unified to `--accent` per brand B—16.

## r186 — U36 module naming + qa:full green · SHIPPED ✅

**U36:** `uniqueModuleLabels` per-cluster disambiguation — spring-boot autoconfigure collisions no longer poison siblings.

**Phase C:** `pnpm qa:full` 27/27 green, no regressions (post-U36).

**Docs:** r185 ledger sync; `docs/research/phase-d-remaining.md` (G-D/E + Team Lore slices).

**Gates:** web **2501** · analyzer **745** · qa:full green

## r185 — B2/B3 tldraw removed, native board default · SHIPPED ✅

- Ink overlay (`BoardInkOverlay`, `BoardInkLayer`); `boardTools` row replaces CDN toolbar
- `tldraw` dep removed; `TaskBoard` → `NativeBoard`; D2 licence blocker closed
- Web **2501** tests; qa:smoke green

## r184 — B1 native board + master plan + U37/U2 · SHIPPED ✅

**Master plan:** `docs/MASTER-IMPLEMENTATION-PLAN.md` — full document fulfillment program.

**B1 native board:**
- `SequenceBoardDoc` in schema; GET/PUT `/api/board` → `.sequence/board.json`
- NativeBoard: import, spawn, run, persistence; 141 board tests

**Phase B/C:**
- U2 grouped card subtitle sanitization (test dirs filtered)
- U37 stemFlow deprioritizes test-file stems
- `docs/research/corpus-language-matrix.md` (27-repo language map)
- E2/U20 wiring locks

**Gates:** web **2510** · schema **301** · analyzer **744**

## r183 — Autonomous agent wave: B0 board + G14/U24/U14/U17/U32/U34 · SHIPPED ✅

Four parallel builders (Composer) after `docs/autonomous-agent-flow.md` landed:

- **B0** — `NativeBoard.tsx` + `TaskCardNode.tsx` spike (`VITE_BOARD_ENGINE=native`)
- **G14** — counted symbols before domain in breakout sub-line (`explain.ts`)
- **U24** — collapse dominant orphan lane (>50% modules) with expand affordance
- **U14** — best-fit summary chip; Learn stays on PlainCanvas/GroupedCanvas
- **U17** — Task Board empty invite; no three-panel stack on first open
- **U32** — lock test for shared-backend single ingestion
- **U34** — `stemQualityOk` metric in qa-loop

**Gates:** build · web **2490** · analyzer **741** · qa:smoke green

## r182 — Tier-2 UX + H10 Go import edges · SHIPPED ✅ (PR `cursor/handoff-mega-42b9`)

**Tier-2 UX (G10, U15, U16, U18, partial U12):**
- G10 pair chip no longer clipped in breakout header
- U15 process rail middle/tail truncation for English bucket titles
- U16 Agents hero title ellipsis at narrow width
- U18: hide canvas cue when Files open; Service not Svc; stable proposal footer; hide empty Recent
- U12 partial: skip duplicate chat confirm on Architecture Accept

**H10 — Go cross-package import edges:**
- `goResolve.ts` + fixture `go-import-cross-pkg/`; wired through scan + buildFunctionGraph
- Analyzer **740** tests; QA re-baseline deferred to orchestrator full tier run

**Gates:** build · web **2475** · analyzer **740** · site LEGIBLE

**Deferred:** U12 collapse-to-strip (owner call); U14/U17; full QA baseline re-record

## r181 — Autonomous program waves 1–3: U19 brand + U31 resolver + E6/F7 · SHIPPED ✅ (PR `cursor/handoff-mega-42b9`)

Owner redirected: organize full handoff queue and execute autonomously (not stop at D1/U4).

**Plan:** `docs/autonomous-program-plan.md` + `docs/research/*`

**Shipped:**
- **U19** — in-app chrome no longer uses queue/orange for touch affordances (Research mode,
  AI-unset, gateway research cards); `inAppBrandPass.test.ts` locks CSS contract.
- **U31** — `jsResolve.ts`: `this.method` same-file resolution + CJS anonymous export extraction;
  express function edges 52 → **78**; `js-call-resolution.test.ts` + `express-cjs` fixture.
- **E6** — Agents harness surfacing: hero copy, agent/checker sublines, tools editor, harness caption.
- **F7** — multi-Assistant tabs with per-tab `chatThreads` / `threadId`; chat singleton removed.

**Gates:** build clean · web vitest **2460** · analyzer **733** · `test:e2e:site` LEGIBLE.

**Next waves:** tier-2 UX (U12–U18), H10 Go imports (last), U32/U34.

## r180 — D1 risks panel removed + U4 attach chrome sequencing · SHIPPED ✅ (PR `cursor/handoff-mega-42b9`)

Owner directive: delete the Risks panel (D1) — risks stay promptable via assistant
("What's fragile here?"); stop auto-stacking attach overlays (U4).

**Shipped:**
- **D1** — removed `RisksPanel` toggle/render from `ViewCanvas` (`Canvas.tsx`); fragility
  path in `BoardChat` / `fragility.ts` unchanged.
- **U4** — `attachChromeSequence.ts`: first-run guide never auto-opens; attach order is
  AI notice → canvas-first cue → learn tour offer (one at a time); locking tests.
- `FirstRunGuide`, `Workspace`, `LearnTour` wired to the sequence helpers.

**Gates:** `pnpm -r build` · web vitest **2448** · `test:e2e:site` LEGIBLE.

**Deferred (owner: stop after this batch):** U19 full brand pass, U31 express resolver,
H10 Go import edges, E6/F7 harness scoping, task-board screenshot.

## r178 — HANDOFF mega branch: site brand + tier-1/2 queue slice · SHIPPED ✅ (PR `cursor/handoff-mega-42b9`)

Owner asked for one mega PR carrying the Aug-3 handoff forward — site Structural brand,
honest captures, and the highest-value open engineering items that do not need an owner call.

**Shipped (7 commits on one branch):**
- Site layout gate (`test:e2e:site`) + CSS containment; `og:image`
- U13 on-board edge legend (`ArchEdgeLegend`)
- Site Fig 05.1 + 06.3 captures (`site-shots.mjs`, `process.jpg`, `local-first.jpg`)
- G11 gin/render complement test (code was on main; test locked)
- G15 double-and join fix
- U3 flow/walkthrough dead-end copy names next step
- U20 cleared stale legibility KNOWN entries
- sock-shop → `negativeCase` in QA manifest
- orchestration-protocol §5 rebuild-before-measure rule

**Deferred (owner or license):** Task Board marketing shot (`VITE_TLDRAW_LICENSE_KEY`);
D1 Risks surface-or-delete; U4 first-run modal stack; E6/F7 product scoping; H10 Go import
edges; full product brand pass (`packages/web` chrome); U31 express resolver; Team Lore primitives.

**Gate:** `pnpm -r build` 0 · web vitest **2444** · analyzer **724** · `test:e2e:site` LEGIBLE.

## r183 — owner schwai_com session: the chrome, the pack, the interior, the copy · SHIPPED ✅

Owner tested a REAL customer repo (5–8 services) at HIS screen size, not the
1280×800 fixture harness, and sent screenshots. Four defects, and the coverage
gap that let all four through.

- **Foot chrome "all over the place."** Seven floating elements on the
  Architecture board each owned a private absolute position, and every collision
  anyone had noticed was patched with a neighbour-conditional dodge tuned at one
  viewport. Replaced by ONE slot grid (`canvas/archFootLayout.ts` +
  `styles/board.css`): zoom cluster bottom-left row 1, Try strip bottom-left row
  2, a single **tool cluster** (Show main flow · Draw · kind lens) bottom-right
  row 1, transient bars bottom-centre. Left owns row 2, right owns row 1, so the
  stacks are separated structurally at every width. Caps come from the MEASURED
  canvas and the REAL chip count, not from literals sized for the 10-node
  fixture; the lens is bounded by its cluster and scrolls, so it can no longer
  hang off the right edge. React Flow's zoom cluster is horizontal now — it is
  ~78px tall stacked, which is what the new geometry check caught it doing to
  the Try strip on the REAL repo at the default viewport.
- **The tooltip printed over the panel text** because it was the platform's
  `title` attribute, placed relative to the CURSOR and never in the DOM — a
  defect no rule could see. It is an app element now, placed to clear the whole
  strip (`panels/tryChipTooltip.ts`), with the prompt still on the button's
  `aria-label`.
- **Decision pack = a wall of text.** `dryRunSummary` was being assigned to the
  card's summary paragraph. `dryRunHeadline` replaces it with one plain line
  ("Writes 2 files: a decision record and its notes. 1 already exists — needs
  your OK."); the paths, the create/overwrite verbs and the no-silent-overwrite
  sentence all still render, behind **Show details**, closed by default. The card
  is closeable and its actions are icon-first. Nothing about write safety moved:
  the checker still gates the overwrite and the test asserts it.
- **The interior flow broke out of its boxes.** `layoutComponentInterior` drew a
  straight chord between chip centres — correct only for adjacent rows, which is
  all a 3–6 part fixture ever has. Connectors are routed orthogonal polylines
  now, constrained to row gutters and side lanes, with the margins that makes
  possible; and the diagram is fit-to-fill in a measured slot instead of
  rendering at natural size in a flexible panel. Locked by an ELEVEN-file
  fixture that also proves the OLD geometry crossed cards.
- **"A group of 11 related files."** The keyless summary said the same nothing
  about every module in the repo. `explain/fileSignals.ts` derives a grounded
  one-liner from the real file names ("Checkout and payment components") with a
  conservative coverage floor, and keeps the count sentence as the honest LAST
  resort when the names say nothing.

**The coverage gap:** every stop audited one board shape at one viewport.
`architecture-large`, `architecture-large-chip-tip` and
`architecture-large-breakout-map` seed a synthetic 8-service graph
(`e2e/lib/syntheticLargeGraph.mjs` — generic commerce shape, no customer data)
at a second viewport, plus an explicit pairwise foot-band geometry assertion.
They earned their keep on the first run: Try-chip labels truncated at real
service-name length, the cue overlapping two different top-left panels after a
first attempt at moving it, the zoom cluster under the Try strip on the REAL
repo, and a part card sliced at the breakout's edge while the audit passed
because a rule exempts scroll containers.

**Gate:** `pnpm -r build` clean · schema 273 · acp 15 · export 43 · analyzer
**541** · web vitest **1884** · `test:e2e` PASS · `test:e2e:bindings` EXIT 0 ·
legibility **LEGIBLE**, KNOWN empty.

## r179 — AAA production program: one design language, every surface, every gate · SHIPPED ✅

Owner directive: "Cursor and Polarity had a baby" (coding-canvas-demo the
reference), consistent through every feature, production-ready. Run as an
orchestrated program: 3 wave-1 builders → 3 wave-2 builders → coverage →
finisher → adversarial critic, disjoint file ownership throughout.

Commits: r179a analyzer hardening (overwrite consent · orphan endpoints
removed, spec flow made real · gatewayLive stamped) — r179b design core +
e2e repair (r179 token layer · traffic lights out · **Accept stole the
pane** fixed · orphan scripts wired/deleted · bindings chain made passable)
— r179c every surface on the system (+ overwrite-consent UI, Try dedupe by
role) — r179d pair link restored + Process rail reads (two pre-existing red
suites, both real product defects) — r179e 11 new legibility stops for the
five never-audited surfaces (stops caught the cue-over-editor overlap and
the global --danger contrast failure immediately) — r179f browser
empty-first, terminal banner, last grid literals.

**Gate at r179f:** analyzer 526 · web vitest 1815 · bindings chain EXIT 0 ·
legibility LEGIBLE across ~50 stops on the real monorepo · KNOWN empty.

## r178 — owner Windows session: crash, honesty, fonts, debloat · SHIPPED ✅

Owner tested on Windows + the from-scratch Design flow; four Sonnet explorers
mapped the defects, three Opus builders fixed them with disjoint file
ownership, one Opus fixer closed the regression the gate caught.

- **Windows scan crash**: `treesitter.ts` dynamic import of an absolute path →
  `pathToFileURL`. The only computed-path dynamic import in the analyzer.
- **Error honesty**: ten server strings carried `POST/PUT /api/...` verbatim to
  the screen; rewritten to human copy + source-scan lock. Every web sink now
  routes through `aiErrors`/`AiErrorNotice` (ScratchPanel and AiControls were
  rendering raw).
- **Repo-less assistant**: `/api/ask` accepts `design {title, outline}`; a new
  project can talk to the assistant grounded to its design, no fabricated
  evidence.
- **Free-model honesty**: labeled "(not live yet)" before selection.
- **ScratchPanel debloat**: Auto-sort button removed (r33 canon regression),
  embedded Connect AI form removed (one key path), Save/Open behind overflow.
- **Windows fonts**: Inter bundled locally; `--font-mono` defined at last —
  Cascadia Mono → Consolas (was Courier New on Windows); badges mono.
- **Chrome**: ctrl-shadow off transparent buttons; `programs.css` light-mode
  block (the r96 patch it never got); 6 AsciiSpinner swaps.
- **Assistant expanded by default** — and the gate caught the fallout: Try
  strip ∩ kind strip 17×34px. The fix exposed two latent defects: the
  collapsed rail painted the full thread at 40px (`[hidden]` beaten by an
  author `display:flex`), and the Draw control was unclickable under the
  strip. All three fixed structurally; stops now hit-test.

**Gate:** build clean (bare exit code) · schema 269 · acp 15 · export 43 ·
ink 15 · analyzer **516** · web vitest **1542** · legibility **LEGIBLE, 52
stops**, `KNOWN` empty. Pre-existing on clean HEAD, deferred: `arch-proposal`,
`bindings/breakout-function-flow` (+ `risks-shots` by design).

## r175 — Shell S7 sketch auto canvas-focus · SHIPPED ✅

**No-Max slice:** sketch Try chips auto-enter canvas-focus when thinking/proposal
theatre starts; Accept, Dismiss, and Esc release it (`enterSketchAutoCanvasFocus` /
`exitSketchAutoCanvasFocus` in `shellLayoutModel.ts`; wired from `BoardChat`,
`acceptArchProposalFlow`, `dismissArchProposal`). Locks: `shellLayoutModel.test.ts`,
`shellLayout.test.ts`.

**Still Max-blocked:** live English BYO verify · hosted `$0.10/day` deploy/funding ·
Codex session→phase tree depth (analyzer wave) · optional E6 / S8–S9 · Agents visual wow 2.

**Gate:** web vitest **1446+** · build assumed clean.

## AAA UX — final status · DOCS ✅

**WOWED tracks closed** (harsh critic): kind strip D3/D5 (r154) · Process chrome
(r169) · shell ~90% / canvas-focus (r170) · edges + E7 PNG (r162) · Agents + PNG
(r160) · Try→sketch→accept + T12 (r173). **Gate:** full `test:e2e:legibility`
LEGIBLE @ 1280×800 (`94c7873` r174) · web vitest ~1443+. **Not** product-final
complete — residuals: Agents visual wow 1≠2, Codex tree depth (Max-blocked
analyzer wave), hosted free tier (Max-blocked deploy), live English BYO,
optional E6 / S8–S9; **S7 sketch auto-focus shipped r175**. Status →
`archive/aaa-ux/aaa-ux-status.md`.

## r173 — Try→sketch→accept WOWED · SHIPPED ✅

**AAA Try track (closes critic T11 + third sketch intent):** checker-gated Accept work-log
ritual (2–3 grounded steps, ~750ms cadence, `prefers-reduced-motion` instant path) on canvas
bar + copilot card; durable-events sketch template (Order Events topic). Critic:
**Try→sketch→Accept WOWED** (avg 4.29) — T1–T11 closed. **T12 canon reconcile** (docs vs
shipped Try chips): `vision.md`, `product-final.md` §5, `archive/aaa-ux/aaa-ux-attack-plan.md` §6.
Full critic → `archive/aaa-ux/aaa-ux-critic-try-r173.md`. Does **not** claim
full `product-final.md` bar.

**Gate:** web vitest **1443** · build clean.

## r128 — AAA Architecture canvas polish · SHIPPED ✅

**coding-canvas bar on first viewport (GroupedCanvas / MadrBreakout / board.css):**

- **Cards:** 13px service titles, two-line English subtitles, quieter SVC badges, sub-list divider.
- **Flows:** `LABEL_ZOOM_MIN` 0.38 so edge pills show at default fit; token-ground edge labels on paper.
- **Lanes:** accent-tick column headers (Entry / Exit tiers).
- **Breakout:** Functions rows render grounded `row.sub` English line; segmented Functions|Files toggle.
- **Locks:** `archChrome.test.ts` r128 suite; AsciiSpinner-only loading path unchanged.

**Gate:** `pnpm --filter @sequence/web test` **1263** · build clean.

## r127 — AAA Assistant + Agents chrome · SHIPPED ✅

**Cursor-grade composer + Agents polish (no attach-chip / Draw regressions):**

- **Build / Research** — segmented toggle (not a flip button); Research active state
  queue-tinted; Promote to Build unchanged.
- **Composer chips** — pill tokens in a subtle tray; workflow (magic) + research (queue)
  tints; `+` menu research rows match.
- **Gateway cards** — kind badge with icon; left accent by kind (MADR / Research / pack);
  summary in muted sentence case.
- **Agents rail** — labels wrap instead of ellipsizing; route table tier pills sentence-case.
- **Model picker** — typography only (weight / radius tokens).

**Gate:** web vitest green. r125 attach-chips + r123 Draw untouched.

## r125 — Agents attach-chips + stop + Decision pack · SHIPPED ✅

**Owner bugs (Agents vs Assistant composer):**

- **Intents attach, never send.** Agents "Add a step" / "Run in parallel" etc. queue
  purple `WORKFLOW_COMPOSER_ACTIONS` chips via `composerAttachBus` → BoardChat; user sends.
- **Rail tools sized + labelled.** Vertical Polarity ctrl stack with one-line labels and
  full tooltip definitions (route table included).
- **Decision pack / Write MADR.** Gateway card only — quiet persist, no editor-tab flood;
  Decision pack always dry-run/pending until Accept.
- **Stop works.** Shared `workflowAbort` bus + Agents Stop + chat Stop (busy ask or live
  workflow); ACP/metered fetch abort threaded.
- **Typography.** Sentence-case route tiers and run summary; no all-caps intent header dump.

**Gate:** web vitest **1251** green. Avoided r123 Draw / r124 AI-settings ownership.

## product-final loop · ACTIVE (2026-07-30)

**Bar:** `product-final.md` — coding-specific visual harness; user test §4;
phased path F0–F8. Baseline: `pnpm -r build` clean · web vitest **1123/1123**.

## r122 — multi-file agent apply (Decision pack + file-map gate) · SHIPPED ✅

**Why:** r120 Write MADR is one file. Cursor-parity needs one assistant turn to
create/edit multiple files with propose → checker → write (no silent overwrite).

**Shipped:**
- **Decision pack** (+ menu, Implementation) — grounded MADR + companion notes under
  `.sequence/decisions/`; checker (path jail + allow-set) before write; primary opens;
  gateway card lists each file with Open.
- **Accept / dry-run gate** when any path already exists; agent `{files:[…]}` maps in
  Implementation mode surface as pending apply (never auto-write).
- `openWritablePath` helper — explicit-path create-only-on-404 (same no-silent-overwrite
  contract as `openAdrInEditor`); multi-file helpers live in `multiFileGateway.ts` /
  `multiFileApply.ts` (disjoint from live-research’s `gatewayArtifacts.ts`).
- Locks: `multiFileApply.test.ts`, gatewayArtifacts pack, analyzer multi PUT jail,
  `productFinalWiring` r122; §11 marked partially closed (honest thinner gap).

**Still thinner than Cursor:** no streaming multi-edit in arbitrary repo trees from a
general coding agent loop; no diff hunk UI; file maps only apply after Accept.

**Gate:** `pnpm -r build` + `pnpm --filter @sequence/web test`.

## r121 — Live research gateway (fetch + cite, BYO key) · SHIPPED ✅

**Why:** Research stayed scan/local-only — thinner than Cursor’s research path.
Live web was deferred to avoid hallucinated URLs and no-key breakage; Max wanted
the live path when a key is present, with honesty when it isn’t.

**Shipped:**
- **`POST /api/research`** — resolve URLs (explicit / extracted / DuckDuckGo Instant
  Answer FirstURLs) → fetch pages (SSRF-guarded) → BYO provider brief → markdown
  under `.sequence/decisions/` citing **only URLs actually fetched**; failures listed.
- **Live research** composer chip (Research mode) → `postLiveResearch`; without a
  configured key, honest empty state (`LIVE_RESEARCH_NEEDS_KEY`) — offline
  **Research brief** / Doc ingest unchanged.
- Locks: `live-research.test.ts`, `research-api.test.ts` (mocked fetch),
  `researchSkills.test.ts`, `productFinalWiring` r121; §11 updated.

**Honesty rails:** no invented sources; private/loopback refused; no key ⇒ 400 /
UI empty state; failed fetches stay ❌ in the brief.

**Verify (owner):** Settings → Connect AI (OpenRouter) → Assistant **Research** →
`+` → **Live research** → paste a public `https://` URL or a topic → Send → brief
opens beside chat with Sources (fetched).

**Gate:** `pnpm -r build` + `pnpm --filter @sequence/web test`.

## r120 — Cursor-parity artifacts (Write MADR + Research gateway) · SHIPPED ✅

**Why:** Assistant still felt “chat-like” for docs/research — MADR Open-in-editor lived
only on the service pop-up; Research skills were paste-prompt chips whose answers
stayed bubble text. Cursor creates the file and opens it beside chat.

**Shipped:**
- **Write MADR** (+ menu) — immediate-act: grounded `buildServiceAdrContent` → write
  `.sequence/decisions/{slug}.md` via `openAdrInEditor` → durable gateway card.
- **Research brief** (+ menu, Research mode) — same create+open path with RFC-shaped
  local brief (goal / graph / risks / checklist / evidence); no key required.
- **ChatGatewayArtifact** — Open in editor · Show on canvas · Promote to Build.
- Research skill answers (Compare / Doc ingest) **promote** into the same gateway file+card.
- Locks: `gatewayArtifacts.test.ts`, `productFinalWiring` r120; §11 row.

**Still thinner than Cursor:** no multi-file agent edits from one turn; English polish
on briefs still needs BYO ask. *(Live web scrape closed in r121.)*

**Gate:** `pnpm -r build` + `pnpm --filter @sequence/web test`.

## r119 — Process Investigate + Research promote + BYO/free-tier honesty · SHIPPED ✅

**Finding:** F1–F8 CODE wires are real (not hollow) per `productFinalWiring.test.ts`;
remaining hollows were Process-rail Investigate entry, Research promote chrome,
and under-documented BYO / free-tier gaps.

**Shipped:**

- **Process-rail → Investigate.** `startInvestigate` / `clearInvestigate` on store;
  Process row click enters investigate pill (shared with stem); ESC clears.
- **Research Promote to Build.** Explicit `assistant-promote-build` when Research
  is on (writes / Create-with-AI unlock on switch).
- **BYO verify path** documented in `productFinalWiring.test.ts` header; locking
  tests for `/api/explain`+`/api/annotate` wires + Process/Promote chrome.
- **product-final §11** updated with exact free-tier inventory (gateway
  undeployed; analyzer DeepSeek path 100 req≈$0.25/day when funded — not the
  ~50/$0.10 bar).

**Still NOT product-final complete (owner/funding):** live English annotate
(BYO OpenRouter verify); hosted $0.10/day deploy. Optional: deeper talk-to-draw /
F8 motion / BYO per-call model honor.

**Gate:** `pnpm -r build` clean · web vitest **1215/1215**.

## r117 — kill Design-mode dead-end from Create / error chrome · SHIPPED ✅

**Finding (swarm):** Create popover "Need services & connections? Open Design mode"
(`create-node-design`) and graph-error "switch to Design mode" dumped users into
the deprecated Edit/Design canvas (`final-product-design.md` removed r45) with no
return chrome — while Create-with-AI already proposes services & connections on
Architecture. Tier-1 misleading surface.

**Shipped:**

- Removed Create popover Design link; unused `setMode` subscription.
- Graph error recovery → honest **Open folder** (`setShowHome`) instead of Design.
- Dropped `.cp-design-link` CSS; Canvas comment notes `design` is internal/test-only.
- Locking tests in `productFinalWiring.test.ts` (no `create-node-design` /
  `setMode('design')` in Create/App chrome).

**Parked (optional / Max-only):** live English annotate (BYO); hosted $0.10/day;
Process-rail Investigate entry; BYO per-call model honor on `/api/ask`; Research
promote-to-Build chrome; deeper talk-to-draw / F8 motion.

**Gate:** `pnpm -r build` clean · web vitest **1212/1212**.

**Verdict:** RELEASABLE CODE-complete for product-final §11 greens; NOT
product-final complete (owner live verify + funding yellows remain).

## r116 — ArchDraw iPad path + W3 dry-run/approval chrome · SHIPPED ✅

**Shipped (spot-check hollows closed after r115 claims):**

- **Architecture Draw → Create-with-AI.** `ArchDrawOverlay` + Draw toggle on
  GroupedCanvas; closed box opens Create popover (`initialName` supported);
  Research mode blocks writes via store-shared `assistantMode` + `researchBlocksWrites`.
- **W3 chrome.** ProgramGraph dry-run toggle + `waitForApproval` Approve/Deny UI;
  webExecutors dry-run previews without AI/terminal side effects.
- **Investigate honesty.** Stem/investigate refuse empty id sets; fitView on scope.
- **F5 evidence.** Context compiler emits grounded `file:line` evidence under budget.
- **F8 mono toggle.** Titlebar ASCII brand toggle → `BrandMark ascii`.

**Gate:** `pnpm -r build` clean · web vitest **1211/1211**.

**Still NOT product-final complete (owner-only):** live English annotate (BYO
OpenRouter); hosted $0.10/day free tier. Optional: deeper talk-to-draw / Process-rail
Investigate entry; BYO per-call model honor on `/api/ask`.

## r115 — W5 remaining templates + route table + research skills + offline download · SHIPPED ✅

**Shipped:**

- **W5 templates.** `buildCouncilAgainstRisksProgram`, `buildRouteByBlastRadiusProgram`,
  `buildDogfoodLoopProgram` — each validateProgram-clean, checker-gated, fixture-runnable;
  loadable from ProgramPanel (with review-loop).
- **Route-table UI.** `routeTable.ts` defaults (step → cheap/smart) + ProgramPanel toggle /
  Apply; locking tests with W5 templates.
- **Research-skills pack.** compare-patterns, grounded-brief, doc-ingest (local/scan only) —
  attached via composer `+` when Research mode is on.
- **Offline download UX.** Settings next-steps after hardware recommend (Ollama / LM Studio
  links); never claims a model is installed.

**Gate:** `pnpm -r build` clean · schema **259** · web vitest **1205/1205**.

**Still NOT product-final complete:** live English annotate (BYO OpenRouter); hosted
$0.10/day free tier. Optional: draw→logic polish, deeper F8 motion.

## r114 — harness W4 durable run + W5 review-loop (+ per-node cost) · SHIPPED ✅

**Shipped:**

- **W4.** Scheduler `RunCheckpoint` + `shouldPause` / `resume` / `retryNodeIds`;
  localStorage `persistRun`; ProgramGraph Pause / Resume controls. Soft restart
  resumes without re-running completed nodes; partial failure retries only
  errored nodes.
- **W5.** First-class `checker` node kind (pure `checkGraphMutation` against
  `groundedGraph`); `buildReviewLoopProgram` template (propose → checker →
  loop until clean / max 3); ProgramPanel load button. Fixture-runnable with
  locking tests (ungrounded caught; grounded converges).
- **Cost chrome.** Estimated `~N tok` on Program nodes after run (from W2
  `perNodeTokens`).

**Gate:** `pnpm -r build` clean · web vitest **1192/1192**.

**Still NOT product-final complete:** live English annotate (BYO key); hosted
$0.10/day. (r115 closed remaining W5 templates, route-table UI, research-skills
pack, offline download next-steps.)

## r113 — Create-with-AI §4.3 + harness W2/W3 (+ F5 budget ask) · SHIPPED ✅

**Shipped:**

- **F3 §4.3.** `proposeCreateBeforeWrite` → graph cards/edges + `checkGraphMutation` **before**
  any file write; `pendingCreateWrite` deferred until Accept (`acceptArchProposalFlow`);
  routing/storage as proposed cards (never silent overwrite). Locking tests for propose-before-write
  + checker reject path.
- **W2.** `RunOptions.shouldStop` + `runBudget` (token/$ ceiling, halt, estimated cost summary on
  ProgramGraph runs — no gateway required).
- **W3.** Per-agent `tools` allow-list + irreversible-command approval gate in `webExecutors`.
- **F5 deepen.** Ask path uses `DEFAULT_ASK_TOKEN_BUDGET` / `remainingTokens` to shrink context.

**Gate:** `pnpm -r build` clean · web vitest **1186/1186**.

**Still NOT product-final complete:** live English annotate (BYO key); hosted $0.10/day; W4–W5;
research-skills pack; full route-table UI.

## r105–r112 — product-final F1–F8 · SHIPPED ✅

**Note:** composer-build / `agent` CLI blocked by Pro Student spend limit — implemented in-session
with edit/test/commit (no CLI retry).

**Shipped:**

- **F1 (r105–r106).** Breakout + interior use annotate bullets (`fileSubtitles`); Connect AI
  structural nudge stays on PlainCanvas; English live verify still needs owner OpenRouter key.
- **F2 (r107–r108).** Stem flow button + investigate pill/ESC on GroupedCanvas (`stemFlow.ts`).
- **F3.** Create-with-AI: clarify via `askBoard` then `prompt-file`; grounded context package.
- **F4.** `checkGraphMutation` gates `acceptArchProposal` (design-slice validate).
- **F5.** BoardChat `compileAskContext` / `withCompiledContext` on send.
- **F6.** Settings → local-model hardware recommend (`localModelRecommend.ts`).
- **F7.** Assistant Build/Research toggle (`assistantMode.ts`).
- **F8.** `AsciiSpinner` (board load + thinking), `BrandMark` in titlebar, mono mode toggle.

**Gate:** `pnpm -r build` clean · web vitest **1167/1167** · wiring lock `productFinalWiring.test.ts`.

**Owner-only remaining:** live English annotate on brain repo (BYO key / billing); hosted free-tier
$0.10/day bar when gateway funded.

## r100–r104 — native English view Tier A (structure without key) · SHIPPED ✅

**Loop activated (2026-07-29).** Baseline: build clean · web **1112** · analyzer **472**.

**Shipped (screenshot-gap program Tier A + partial D/E):**

- **r100 service boundaries.** Brain-shaped grouped-arch test locks ≥3 cards with Routers/Core/Brain
  modules; analyzer monorepo-root tests already guard mega-service swallowing.
- **r101 function-first breakout.** `MadrBreakout` Functions | Files toggle; defaults to Functions when
  spans exist; `functionFlowHighlight` pulses canvas on row click; e2e `breakout-function-flow.mjs`.
- **r102 card interior cap.** `DEFAULT_VISIBLE_SUB_COMPONENTS = 6` (+ honest overflow in breakout).
- **r103 import hierarchy.** Task Board picker: expand classifier → member → function; e2e
  `import-function.mjs`.
- **r104 Process rail copy.** Orphan tier → "No cross-service calls detected" (honest, not "tool failed").
- **r109 workflow composer attaches.** `WORKFLOW_COMPOSER_ACTIONS` in `+` menu; purple attach chips.
- **r110 cron badge.** `scheduledDetect.ts` → `meta.scheduled` on service; clock badge on Architecture cards.

**Gate:** `pnpm -r build` clean · web vitest **1123/1123** (105 files) · analyzer scheduled-detect +3.

**Parked (Tier B/C — needs OpenRouter key for live English verify):** r105–r108 investigate + stem flow.

## r100 — native English view (structure first) · PLANNED

**Plan:** [`r100-native-english-view-plan.md`](r100-native-english-view-plan.md) — owner
screenshots (brain, Pawgress, health repo) vs coding-canvas-demo bar; Tier A structure
without key (service boundaries, function-first breakout, import hierarchy, Process rail);
Tier B annotate/English; Tier C investigate + stem flow; Tier D Agents composer attaches +
cron badge. r100–r111 round map for autonomous loop.

## r99 — diagram artifacts, journey motion, terminal agent steps · SHIPPED ✅

**Scope (v20 Phase 5 wedge + Glowmotion-adjacent motion):**

- **DiagramView (ADR-008).** `packages/web/src/diagram/DiagramView.tsx` — lazy `mermaid` chunk
  (597 KB / 139 KB gzip), token-themed init, honest text fallback; Export menu renders
  mermaid-flow preview; sequence/service-map stay on pure `@sequence/export` SVG.
- **Chat diagram artifacts.** `ChatDiagramArtifact` + `diagramArtifactScope.ts` — grounded
  `scopeGraph` → `mermaidFlow`/`mermaidSequence`; `showDiagramOnCanvas` focuses real nodes.
- **Journey dots.** `programEdges.tsx` `activeJourney` — marching dash + SVG animateMotion dot
  during Agents runs; `renderSequenceSvg({ animate })` for export demos.
- **Terminal copilot steps.** `CopilotStepStrip` — monospace `›`/`✓`/`✗` strip in workflow artifact.
- **r97/r98 carry-over.** Annotate web, edge labels, proposal honesty overlay, motion gate,
  legibility stops, Radix Export popover, Try-chips removal.

**Gate:** `pnpm -r build` clean · web vitest **1112/1112** (105 files) · export 43 · e2e bindings
include `export-diagram.mjs` (SKIP without Chromium).

**Mermaid lazy chunk:** `mermaid.core` 597 KB raw / 139 KB gzip — not in main bundle until render.

## r97 — annotate web, edge labels, proposal honesty, motion gate · merged into r99

**Scope (parallel agents, not yet on `main`):**

- **Annotate web (W2a).** Wire `POST /api/annotate` bullets onto Architecture cards —
  `cardAnnotations.ts` maps per-node bullets to grouped cards via `sourceRefs`;
  `fetchAnnotations` in `aiClient.ts`; store slice + `PlainCanvas` fetch; ELK dims
  account for bullet height.
- **Edge labels (v21 D3).** `GroupedEdgeComp` renders `data.labels` as pills
  (`groupedEdgeLabel` / `groupedEdgeLabelTitle` in `edgeStyle.ts`); hover reveals
  labels when zoomed out; family word is the honest fallback when no labels exist.
- **Proposal honesty (v21 D1/D4/D5).** Accept must change the Architecture board
  (not just `store.draft`); proposed edges carry real kind/colour — no fabricated
  `redis`/`db_read` stamps.
- **Motion gate (v21 D7).** Gate `grouped-flow-edge-pulse`, `grouped-flow-pulse`,
  `grouped-removing-pulse`, and `.thinking-line-dot` behind
  `prefers-reduced-motion: no-preference`.
- **r98 verifiers (queued).** Legibility stops + locking tests for copilot proposal
  and step states — follows once r97 lands.

**Working-tree vitest (pre-merge):** **1101/1101** (102 files).

**Gate at r97:** TBD — run full gate (`pnpm -r build`, package tests, e2e bindings,
`test:e2e:legibility`) before merge to `main`.

## r68 — owner UX canon (schwai_com) · DOCS ✅

**Result:** Owner re-test on schwai_com + site — captured as design canon **before** r69–r72 code.
**Docs:** [`owner-ux-canon-r68.md`](owner-ux-canon-r68.md); `final-product-design.md` §4/§6a/§8;
`vision.md` §4/§6 aligned. **Locked removals:** Architecture **system-flow strip** (UI) — parked
as REMOVED per owner; workflow pulse stays on Assistant artifact only. **Next:** r69 Task Board import
(services+functions, fit-to-fill) → r70 Process buckets + strip removal → r71 MARD pop-up → r72 site.

## r67 — docs canon sweep + 100% gap parity · SHIPPED ✅

**Result:** `archive/round-plans/workflow-graph-gap-analysis.md` all 9 dimensions **100%**; `archive/round-plans/holistic-audit-matrix.md`; `archive/version-plans/v20-plan-closure.md`; `archive/handoffs/loop-audit` updated; removed ~91% partial percentages from canon. **Gate:** build · schema 233 · web **554** · e2e bindings SKIP exit 0.

## r66 — holistic audit matrix · SHIPPED ✅

**Result:** Concept×surface×test matrix — drawing→code, writing→code, Agents, Architecture, Task Board, Assistant all **GREEN**; zero tier-1 open. Doc: [`holistic-audit-matrix.md`](holistic-audit-matrix.md).

## r65 — v20 plan closure doc · SHIPPED ✅

**Result:** Every origin/v20 item mapped SHIPPED/CUT/MERGED; PR #3 merge remains owner-only. Doc: `archive/version-plans/v20-plan-closure.md`.

## r64 — MARD markdown completeness lock · SHIPPED ✅

**Result:** `buildAdrMarkdown` never zero-byte — all MARD sections always present; Open in editor path locked. Locks: `adrMarkdown.test.ts` (non-empty MARD).

## r63 — gate retry dotted loops → 100% · SHIPPED ✅

**Result:** Schema allows branch-false gate-retry cycles (like loop-back); demo program `No: revise plan` → Planner, `No: return feedback` → Worker; ELK low-priority on branch-false; snapshot dashed styling. Locks: `program.test.ts` gate-retry, `demoProgram.test.ts`, `ProgramGraphSnapshot.test.ts`.

## r62 — MARD linkage + Codex demo + gate polish · SHIPPED ✅

**Result:** `meta.serviceId` on program nodes; MARD on snapshot/compose dbl-click + flow-step click; gate decision summaries; Codex default demo (planner→worker→3 reviewers→gates); brown diamond CSS + dashed branch-false retry labels. Locks: `programSnapshotRoles.test.ts`, `workflowBoardImport.test.ts`, `demoProgram.test.ts`. **Gate:** build · schema 232 · acp 15 · analyzer 357 · ink 15 · export 14 · web **552** · e2e bindings SKIP exit 0.

## r61 — workflow graph parity docs + audit closure · SHIPPED ✅

**Result:** Gap analysis updated to **~87% core Codex parity** (~81% incl. optional MARD); loop-log r57–r60; final-product-design §10; site/docs inline workflow note. **Gate:** build · schema 232 · acp 15 · analyzer 357 · ink 15 · export 14 · web **549** · e2e bindings SKIP exit 0.

## r60 — Architecture pulse + Task Board run import bridge · SHIPPED ✅

**Result:** During run, active workflow node title → `matchProcessToServiceIds` → Architecture card pulse; post-run **Import run services to Task Board** one-click. Locks: `workflowArchPulse.test.ts`, `workflowBoardImport.test.ts`. Commit `3be6cb6`.

## r59 — bidirectional Assistant ↔ Agents workflow navigation · SHIPPED ✅

**Result:** `lastWorkflowRun` persists; visualize intent/chip re-opens artifact; artifact node click → Agents tab + compose selection. Locks: `workflowNavigation.test.ts`. Commit `ec8ca16`.

## r58 — Codex inline graph read semantics polish · SHIPPED ✅

**Result:** ~560px artifact card, parallel-join node styling (3+ branches), distinct loop-back edges + labels, prose stats caption from events. Locks: `workflowRunStats.test.ts`, `ProgramGraphSnapshot.test.ts`. Commit `c260378`.

## r57 — workflow artifact Expand/Copy · SHIPPED ✅

**Result:** Expand (Agents + fitView, Shift pop-out), Copy (Mermaid/JSON); enabled header actions. Locks: `workflowArtifactActions.test.ts`. Commit `a3cab27`.

## r56 — Architecture workflow-run pulse · SHIPPED ✅

**Result:** When `activeWorkflowRun.status === 'running'`, Architecture **system-flow strip** derives steps from append-only run events (`buildWorkflowFlowSteps`) and pulses the active node (`workflowFlowActiveIndex`) — label switches to **Agent run**; grouped card layout dims widened. Locks: `systemFlowSteps.test.ts`. **Gate:** build · export 14 · web **538** vitest. Commit `00c3fc7`.

## r55 — Codex snapshot read semantics · SHIPPED ✅

**Result:** Inline snapshot maps **planner/worker/reviewer/gate/output** role CSS; branch edges label **Yes/No** (+ loop-back **No: retry**); snapshot node click opens grounded **MARD** when title matches a service. Locks: `programSnapshotRoles.test.ts`. Commit `57c3741`.

## r54 — enlarged Agents/Architecture nodes · SHIPPED ✅

**Result:** `PROGRAM_SIZES` bumped ~15–20% for Agents compose/read surfaces. Grouped Architecture card ELK dims widened in r56. Commit `4a7945a`.

## r53 — shared WorkflowRun live sync bus · SHIPPED ✅

**Result:** `activeWorkflowRun` store slice; Agents run inserts Assistant artifact at start and patches `runView` on each scheduler event; BoardChat reads live `activeWorkflowRun.runView`. Locks: `workflowRun.test.ts`. Commit `31dcf6b`.

## r52 — inline workflow graph snapshot in Assistant · SHIPPED ✅

**Result:** Read-only `ProgramGraphSnapshot` artifact in BoardChat after Agents run (`mirrorWorkflowToChat`, default on); disabled Expand/Copy with honest r55 tooltips. Locks: `ProgramGraphSnapshot.test.ts`; e2e `workflow-snapshot.mjs` in `test:e2e:bindings`. Commit `0d4ce4f`.

## docs — Codex inline workflow graph gap · DOCS ✅

**Result:** Owner screenshot vs Sequence Agents — **~32% parity** (~68% gap). Inline chat graph + shared run state + Codex read semantics are the misses; scheduler/parallel/gates/loops ~half there. **Docs:** [`workflow-graph-gap-analysis.md`](workflow-graph-gap-analysis.md), [`r52-workflow-graph-plan.md`](r52-workflow-graph-plan.md), r35 backlog W1–W5. **Next:** r52 `ProgramGraphSnapshot` in BoardChat after Agents run. Commit `92c49a1`.

## r51 — MARD pop-up + classify buckets lock · SHIPPED ✅

**Result:** **MARD** — ServiceAdrModal rendered ADR markdown (Context, Components, Connections, Evidence); auto-generate on open; Open in editor writes `.sequence/adr/*.md`. `classifyProcessBuckets` shopfront vitest lock. **Origin merge BLOCKED** — 30+ conflicts with origin v20; PR https://github.com/naidx0/sequence-arch-tool/pull/3 (`loop/r51-owner-canon` → `main`). Commits `0f9305b`, `4f52cfb`, `774465a`. **Gate:** build · schema 232 · acp 15 · analyzer 357 · ink 15 · export 14 · web 528 · e2e SKIP exit 0.

## r50 — origin merge + full gate · SHIPPED ✅

**Result:** Full standing gate green. **Merge `origin/main` BLOCKED** — 30+ conflicts (origin v20 deleted scratch/Legend paths; local r45–r50 unified Architecture canon). Aborted; owner PR required. Audit → [`loop-audit-2026-07-24.md`](loop-audit-2026-07-24.md). **Gate:** build · schema 232 · acp 15 · analyzer 357 · ink 15 · export 14 · web 525 · e2e SKIP exit 0.

## r49 — vision + loop docs canon · SHIPPED ✅

**Result:** `vision.md` §4 unified Architecture bar; `final-product-design.md` r47–r50 changelog; `loop-log.md` + `GO_LIVE.md` deploy path updated.

## r48 — system flow · export SVG · pop-out · SHIPPED ✅

**Result:** Architecture **system-flow strip** grounded from scan (`buildSystemFlowSteps`); **Export** grouped service-map SVG (`renderServiceMapSvg`); **pop-out panes** via `?popout=` + tab link button (`PopoutShell`). Locks: `systemFlowSteps.test.ts`, `serviceMapSvg.test.ts`, `popoutUrl.test.ts`.

## r47 — Accept→Board · buckets v2 · Agents UX · SHIPPED ✅

**Result:** Proposal **Accept** merges draft + queues `pendingBoardImport` Task Board cards (auto-spawn + zoom); `classifyProcessBuckets` v2 graph edge profile; `structuralView` dead code removed; Agents **Combine agent nodes** + **Create Parallel workflow**. Locks: `boardArchImport.test.ts`, `programEdits.test.ts`, `classifyProcessBuckets.test.ts`.

## r46f — Learn grounded tour stats · SHIPPED ✅

**Result:** Learn offer + intro step show grounded scan stats from `groundedLearnTourStats` (service + file counts from graph/plainTree) — no generic "N parts M files" copy. Locks: `learnTourStats.test.ts`. Gate: build · web 518 vitest. Commit `7b98c7c`.

## r46e — SideRail repo home actions · SHIPPED ✅

**Result:** Files tab header **Import repo · Start new project · Open folder** wired to `setShowHome` / `startDesign`. Folder hover peek unchanged. Commit `4f86832`.

## r46d — Agents rename + generate CTA · SHIPPED ✅

**Result:** UI strings **Programs → Agents**; prominent **Talk to Assistant to Generate** button; compact icon add-node palette + Parallel hint. Locks: `addable.test.ts`. Gate: build · web 518 vitest. Commit `e452a80`.

## r46c — Task Board grid + multi-import · SHIPPED ✅

**Result:** Dot-grid canvas background; compact multi-select Import from Architecture picker; grid spawn + zoom-to-selection. Commit `eb2ae44`.

## r46b — Process Lumen classified buckets · SHIPPED ✅

**Result:** `classifyProcessBuckets` groups Process tree into English buckets (API, Database, Brain, Core); dense parent rows when many children; leaf click → ADR + flow highlight unchanged. Locks: `classifyProcessBuckets.test.ts`, updated `processList.test.ts`. Gate: build · web 516 vitest. Commit `18b6f33`.

## r46a — Remove Try chips · SHIPPED ✅

**Result:** Removed Architecture `arch-try-strip` Try chips + Assistant empty-state Try chips; **thinking line** during agent work retained on Assistant + Architecture overlay. Locks: `tryChipsModel.test.ts` (model kept). Gate: build · web 513 vitest. Commit `3c1bc3e`.

## r42a — Lumen Try chips + thinking line · SHIPPED ✅ (Try UI removed r46a)

**Result:** P0 Lumen landing — 3–4 repo-grounded **Try** chips (Assistant empty state + Architecture strip); chip click → focus Assistant with pre-filled prompt; animated **thinking line** during agent work. Locks: `tryChipsModel.test.ts`, `tabs.test.ts`. Gate: build · web 510 vitest. Commit `5e7c685`.

## r42b — Lumen proposal overlay Accept/Dismiss · SHIPPED ✅

**Result:** P0 sketch-before-apply — `archProposal.ts` pure apply/dismiss; ghost proposed cards on GroupedCanvas (450ms entrance) + Accept/Dismiss bar; Accept saves draft plan (post-r45: "Import from Architecture" / "Open in editor" — not Edit depth). BoardChat attaches grounded cache/rate-limit proposals from assistant answers. Locks: `archProposal.test.ts`. Gate: build clean · web 510 vitest. Code `ab27650`; loop-log hash follow-up `0a011ed` (duplicate message only — not a second ship).

## r42c — Lumen flow highlight · SHIPPED ✅

**Result:** Process tree hover/click → `flowHighlightForProcessNode` pure mapper pulses matching grouped cards + edges on Architecture (subset only, no zoom). Process panel instruction strip: "Mapped N services — select a step to highlight on canvas". Locks: `processList.test.ts` (`processNodeToServiceCardIds`, `flowHighlightForProcessNode`, `countMappedServices`). Gate: build clean · web 510 vitest. Commit `8ed05c3`.

## r43b — Lumen card kind silhouettes · SHIPPED ✅

**Result:** Lumen P1a — grouped Architecture cards get distinct silhouettes by kind (service terminal strip, datastore circuit frame, topic pill) plus compact kind badge (SVC/DB/TOPIC). Pure `groupedCardSilhouetteClass` mapper in `groupedArchModel.ts`; CSS in `styles.css`. Locks: `groupedArchModel.test.ts` (kind → silhouette class). Gate: build clean · web vitest (+1). Commit `fe20957`.

## r43a — Lumen folder hover peek · SHIPPED ✅

**Result:** SideRail Files row hover → lazy Architecture card peek (no file open). **(1)** `filePathToServiceCardId` + `filesHoverPeekLabel` pure mappers in `sideRailModel.ts`. **(2)** `filesHoverPeek` store slice (separate from r42c `flowHighlight`). **(3)** Subtle `grouped-card-files-peek` on GroupedCanvas; optional left tooltip with English service · file label. Locks: `sideRailModel.test.ts`. Gate: build clean · web vitest (mapper suite). Commit `2027085`.

## r45 — unified Architecture · live ADR import on Task Board · SHIPPED ✅

**Result:** owner evening direction (2026-07-24) — **(1)** Removed Edit + Structural depth toggles; Architecture tab is one unified grouped surface (`depthModel.ts`, `Canvas.tsx`). **(2)** ServiceAdrModal **Open in editor** replaces Copy MD clipboard; `openAdrInEditor` store path. **(3)** Task Board **Import from Architecture** picker + linked task cards (`linkedServiceIds`); Paste ADR removed. **(4)** `groupedArchModel` merges brain+backend-brain into one English card. Locks: `boardArchImport.test.ts`, `groupedArchModel.test.ts` (merge), `depthModel.test.ts`. Gate: build · web 513 vitest. Commit `3a7d8ef`; Accept-copy fix after Edit removal `516bfc2`.

## r44 — Lumen P2 keyboard shortcuts overlay · SHIPPED ✅

**Result:** Lumen P2 polish — compact `?` keyboard-shortcuts modal (~22rem) with kbd chips; toggles globally except while typing in fields; Esc/backdrop dismiss. Locks: `keyboardShortcuts.test.ts`. Gate green: build · web vitest (+4). Commit `bbe5996`.

## r41 — cross-surface ADR → Task Board sync · SHIPPED ✅

**Result:** Phase 5 cross-surface sync (superseded in r45). **(1)** ADR modal **Open in editor** + Task Board **Import from Architecture** replace clipboard Copy MD / Paste ADR. **(2)** Process leaf click → ADR modal + `setEditFocus` scope. Commit `e0def8d`; clipboard flow removed in `3a7d8ef`.

## r40 — Architecture Structural toggle + area emphasis · SHIPPED ✅

**Result:** owner Lumen/Codex reference — third **Structural** pill in architecture corner; `structuralView` sorts grouped cards by area (frontend/backend/data) and shows area badges. Condensed grouped default unchanged (≤12 cards). Locks: `structuralView.test.ts`. Commit `2c80e07`.

## r39 — compact ADR Markdown modal · SHIPPED ✅

**Result:** ServiceAdrModal compact layout; `buildAdrMarkdown` grounded preview; lazy `getFile` evidence on expand; Copy MD button. Exclusive pop-up (close before open). Locks: `adrMarkdown.test.ts`. Commit `725da90`.

## r38 — Process Codex English tree · SHIPPED ✅

**Result:** SideRail Process → expandable hierarchical tree (`buildProcessTree`) with PlainTree + sub-component leaves; leaf click → Architecture sync + ADR. Locks: `buildProcessTree` + exclusive ADR sync tests. Commit `fa1e4d5`.

## r37 — Task Board editable fields, recreate table, run · SHIPPED ✅

**Result:** owner tier-1 Task Board broken — fixed pointer-events on tldraw shape; inline title/description/status; `+` menu (task card · **task table template** · sticky); Run wired via real executor; description + Paste ADR. Locks: `boardTemplates.test.ts`, taskCardRun F7 description migration. Commit `48f052a`.

## r37-docs — Lumen/Codex breakdown + canon · DOCS ✅

**Result:** Phase 0 research — `docs/lumen-codex-breakdown.md`; `final-product-design.md` locked decisions from coding-canvas demo + Codex screenshots. Commit `6913b5d`.

## r36 — ADR service pop-up, process grouping, lazy file open · SHIPPED ✅

**Result:** owner eve feedback — prior r35b "finished" claims wrong (file spam + awkward zoom). **(1)**
`buildProcessGroups()` merges related services in SideRail Process (brain + backend-brain; features
nested under parent). **(2)** `ServiceAdrModal` — ADR pop-up with English cards, sub-components,
edges; "Open file" explicit secondary action only. **(3)** Process row + grouped canvas card click →
ADR modal + selection ring, **not** `openFile` by default. **(4)** Removed selection-triggered
`fitView` zoom on GroupedCanvas. **(5)** Edit depth scopes via `editFocusServiceIds` +
`scopeDraftToServices`. Vitest locks: grouping, sync without openFile, ADR content, edit scope.
Gate green: build · schema 232 · acp 15 · analyzer 357 · ink 15 · web 470 vitest · e2e/learn/bindings SKIP (browserless) / exit 0.
Commit `365f24c`. **Next:** r36b Edit condensed process-node seed (P3 backlog); Structural view toggle (P1b).

## r35-docs — owner eve vision canon (process sync · edit unification) · DOCS ✅

**Result:** owner evening session (2026-07-24) — product canon updated, no code ship. **(1)**
`docs/archive/v1-ui/final-product-design.md` §4: Edit → process-node model (draw/notes on click, not full
pyramid); Structural view toggle in architecture corner; Process click → architecture zoom + file
drill; system-flow animations + visual errors (planned); §6 Programs layout (compact header, Run
icon-left, fit-fill, responsive pyramid/tree, drop shared-state chrome, AI generate graph planned);
§6a Task Board `+` + deep customization; §6b pop-out panes (r36). **(2)**
`docs/r35-product-backlog.md` — prioritized implementable slices P1–P6 + stretch. **Next:** loop
Round A (P1a Technical grouped + export SVG + e2e).

## r35a — Programs UI polish (compact run, fit-fill, responsive layout) · SHIPPED ✅

**Result:** Programs surface — compact run/stop overlay on graph left; fit-to-fill on mount + pane resize (`FIT_OPTS`); responsive ELK direction (`programLayoutDirection` + test); shared-state rail removed; "Generate with AI" chip opens assistant. Gate green: build · web 464 vitest. Follow-up `745873f` — overlay CSS that TSX referenced but first commit omitted.

## r35b — Process click → Architecture sync · SHIPPED ✅

**Result:** SideRail Process rows drive the Architecture board — focus graph tab, `plain` depth,
select grouped cards via `matchProcessToServiceIds` (prefix/token multi-match, e.g. brain +
backend-brain), `GroupedCanvas` fitView + selection ring, open primary evidence file via
`primaryFileForService`. Vitest locks in `processList.test.ts`. Commit `e45a406`; canon changelog
§10 in `final-product-design.md`. **Next backlog:** Edit follows Process selection (P3); AI shared-component analyze (stretch).

## r34 — ADR grouped architecture canvas (English service cards) · SHIPPED ✅

**Result:** Simple depth now shows a **stable grouped service map** instead of an infinite
pyramid — Codex/ADR-style cards in plain English with inline sub-components and
service-level edges. **(1)** Pure projection `packages/web/src/graph/groupedArchModel.ts`
(lift via `@sequence/export` `projectEdges`, PlainTree title index, ≤12 cards, ≤8
sub-rows). **(2)** `GroupedCanvas.tsx` — flat macOS card chrome, ELK RIGHT layout,
`FIT_OPTS` auto-fit on attach. **(3)** `PlainCanvas` delegates to grouped view;
pyramid `buildBoardModel` path retained in schema but not the Simple default.
**(4)** Vitest locks: ticketing titles, edge parity vs `serviceLevelEdgeKeys`, sub-cap.
**(5)** Placeholder "System flow" strip for r35 agent-loop diagram. **Deferred r35:**
Technical grouped default, export SVG service map, e2e binding, Edit drill-down modal.
Gate green: build · schema · web vitest · node --test.

## r33 — owner hands-on UX round (assistant left · noise trim) · SHIPPED ✅

**Result:** owner `./start.sh` feedback — five clear-cut trims, three backlog notes. **(1)** Default
workspace now seeds `[Assistant | Architecture]` (chat pane left of canvas, Cursor-style) via
`buildLayout('chat')` + CSS border flip. **(2)** Removed the confusing Auto-sort button from
BoardChat (deterministic sort stays in ScratchPanel / store). **(3)** Stripped duplicate keywall
CTA from assistant empty state + errors — ModelPicker `+` → Settings is the single path (r19). **(4)**
Domain model dropped from the `+` menu (`ADDABLE` lock: six kinds); schema/store/routing kept for
internal use. **(5)** SideRail Graph segment hidden until copy/UX is clearer — Files-only default.
**Backlog (deferred):** grouped "services-as-cards" depth mode (Codex ADR / macos-ui style); Programs
auto-open under workflow depth; fitView zoom-by-function grouping. **Docs:** cross-session layout canon
→ `docs/archive/v1-ui/final-product-design.md`. Gate green: build clean · web 435 vitest.

## r31 — Programs edit-intent honesty + fitView call-site locks (tier-1/2 B1 + C1) · SHIPPED ✅

**Result:** tier-1 compose honesty for the unfinished edit path and a behavioral lock on the v18
auto-fit policy. **(1)** Programs agent intent select: `edit` is visible but disabled with next-wave
copy; legacy edit nodes get `program-agent-edit-blocked` (pure `agentIntentCompose` + vitest).
**(2)** `fit.test.ts` now asserts every React Flow surface spreads `FIT_OPTS` into programmatic
`fitView` and sets `fitViewOptions={FIT_OPTS}`; fixed the one gap in `DomainCanvas.tsx`.
Ink-stroke e2e deferred (D4 — larger harness). Gate green: build clean · web 434 vitest · bindings
5× SKIP browserless / exit 0.

## r30 — Programs ACP run gate + Settings agent-list honesty (tier-1 D1 + A1) · SHIPPED ✅

**Result:** closed the largest remaining Programs §4 gap and the Settings honesty asymmetry.
**(1)** Settings › Local coding agents now shares the Programs picker's `useAcpAgents()` /
`getAcpAgentsResult()` path — list fetch failures render `acp-error` + retry, never the
"No agents yet" empty-registry hint (`localAgentsBodyState` + 3 locking vitest cases).
**(2)** New gated e2e binding `program-acp-run.mjs`: seeds a minimal [start→acp→end] program with
a registered mock agent, runs from the Programs UI, and ASSERTS the acp node reaches
`data-status=done` via real `POST /api/acp/run-node` (SKIP exit 0 without `/opt/pw-browsers`).
Wired as `test:e2e:program-run` and the 5th script in `test:e2e:bindings`; vision §7 updated.
Gate green: build clean (9 pkgs) · schema 232 · acp 15 · analyzer 357 · ink 15 · web 427 ·
e2e switch-repo/learn/bindings SKIP (browserless Mac) / exit 0.

## r32 — ADR sequence SVG export preview (macOS theme · export × usability) · SHIPPED ✅

**Result:** Phase 0 spike from `docs/adr-diagram-output-plan.md` — custom macOS-dark SVG sequence
diagrams grounded in the same `projectEdges` projection as Mermaid text export, without bundling
Mermaid. **(1)** `@sequence/export`: `graphToSequenceModel` + `macOsTheme` (`diagramModel.ts`) and
`renderSequenceSvg` (`renderSvg.ts`) with macos-ui edge hues (HTTP `#4b6e9e`, DB `#3f7d5a`, pub/sub
`#9a8330`, canvas `#191919`, arrowhead `#6a6a70`). **(2)** Export menu: Preview/Text toggle for
Mermaid sequence format only; `DiagramPreview.tsx` embeds responsive SVG; copy/download still emit
`.mmd` text unchanged. **(3)** `diagram.test.ts` locks participant order, theme colors, determinism,
label escaping, no `<script>`. Parked for r31+: package/flow SVG, Diagram tab, ADR markdown bundle.
Gate green: build clean (9 pkgs) · export 12 · web 427 · schema/acp/analyzer unchanged from r29 floor.

## r29 — gate repair after env cut (tier-1 correctness · build + verifier) · SHIPPED ✅

**Result:** wifi/interrupt left `main` unbuildable on case-insensitive macOS and one analyzer test
pointing at a developer `/tmp` scratchpad path. **(1)** Renamed four logic modules that collided with
same-directory React components (`legend`/`scratchWelcome`/`learnTour`/`sideRail` → `*Model.ts`) and
rewired imports — fixes TS1149 on Mac without changing behavior. **(2)** Added
`packages/analyzer/test/fixtures/shopfront-mutated/` (gateway without payments route) and pointed
`diff.test.ts` at it — locks the removed-edge drift case in-repo. **(3)** Aligned binding e2e scripts
(`impact-shots`, `risks-shots`, `program-acp-shot`) with vision §7: **SKIP exit 0** when no Chromium
under `/opt/pw-browsers` (same as switch-repo/scratch-create), so browserless hosts don't hard-fail
`test:e2e:bindings`. Program e2e on this Mac: all four bindings **SKIP** (picker/run assertions need
CI Chromium — see `docs/r30-discovery-backlog.md` D1 for the next gated Programs run binding).
Gate green: build clean (9 pkgs) · schema 232 · acp 15 · analyzer 357 · ink 15 · web 424 · e2e
switch-repo/learn/bindings SKIP (browserless) / exit 0.

## r27 — grounded risk facts in the assistant's digest (the MOAT · grounded-AI × design-intelligence) · SHIPPED ✅

**Result:** the design-advisor intelligence (SPOF blast-radius + circular deps) previously lived only in
the Risks panel; now the **grounded assistant** can answer "what's fragile / what breaks if X fails /
what's circular?" from PRECOMPUTED truth. Three phases: **(1)** shared the pure risk engines
(`impact`/`risks`/`cycles`) from web → `@sequence/schema` (one source of truth; 6 web import sites
rewired, ~37 engine tests moved+converted vitest→node:test, behaviour byte-preserved). **(2)** new pure
`serviceLevelRisksInput(graph)` (`analyzer/explain/serviceGraph.ts`) projecting the ArchGraph to
SERVICE-level id-keyed edges + nodes (files lifted to owning service/datastore/topic; imports +
self-edges dropped). **(3)** `buildDigest` now injects a compact grounded `risks` section (SPOFs with
real blast-radius counts + cycles), and `buildAskPrompt` gained a clause that **REINFORCES** grounding
("cite ONLY that section's numbers — do NOT derive/estimate/recompute blast radius yourself"); the r19
grounding + register clauses are **byte-unchanged** (a 3-way test locks all three). **Adversarial review:
one BLOCKER, fixed** — `liftToTopLevel` (and its pre-existing `score.ts buildLift` cousin) walked
`parentId` with no visited-guard, so a malformed containment cycle (AI-authored/persisted graphs can
have one; `validateGraph` flags but doesn't block them) would infinite-loop and hang `buildDigest`
(reviewer reproduced a 5s timeout). Added a `visited` guard to both + a locking test that provably
terminates; also capped the digest cycles list symmetrically with SPOF's `DEFAULT_TOP_N`. Re-verified:
no hang (analyzer suite well under timeout). Every risk fact is a verbatim grounded number tied to real
nodes; risks-shots e2e still PASSES (panel unregressed). Note: end-to-end assistant use needs a live
model/deploy; the digest-includes-risks + grounding-preserved parts are deterministically test-locked.
Gate green: build clean (9 pkgs) · schema 232 · analyzer 357 · web 395 · acp 15 · ink 15.

## r26 — circular-dependency detection (the MOAT · vision §2 layer 3 design-advisor) · SHIPPED ✅

**Result:** the first-timer audit (r25) showed usability is largely at the bar, so per the vision the loop
shifts to the **moat**. Added a second grounded design-advisor check beside the shipped SPOF/blast-radius
one: **circular dependencies**. A directed cycle in the depends-on graph is a real architecture smell —
mutually-dependent components can't be built, deployed, failed over, or reasoned about independently.
New pure `computeCycles(links, nodes)` (`graph/cycles.ts`): **iterative Tarjan SCC** (no recursion → no
overflow) over the SAME real `srcId→dstId` edges the SPOF advisor uses; reports SCCs of size ≥2 (+
self-loops as size-1). GROUNDED by construction — an edge contributes only when BOTH endpoints are real
non-`repo` nodes, so a stray/unknown-id edge can never fabricate a cycle; every reported cycle is a real
directed cycle. Surfaced in the Risks panel as a distinct "Circular dependencies" section (its own accent
chip, not danger-red), each row click-selecting a member through the existing select→highlight path;
empty-state + toggle badge now cover both risk kinds. +10 unit tests (DAG→[], 2/3-cycle with dangling-node
exclusion, disjoint pair, self-loop, no-double-count, unknown-id-ignored, totality, ordering).
**Adversarial review: RELEASABLE** — the reviewer fuzzed the Tarjan against a reference on 3000 random
graphs (0 mismatches) + a 20k-node chain (no overflow), confirmed no fabrication path, and the SPOF panel
byte-identical (risks-shots e2e still PASSES). Fixed the one cosmetic note (made the cycle-sort tiebreak
fully total). Honest limit: couldn't screenshot the cycles SECTION against a live scan — the fixtures are
DAGs (cycles are genuinely rare) and the env-URL trick didn't produce a cyclic view; the section renders
on the same verified `view.edges` the SPOF advisor uses and is engine-locked by the 10 tests. Gate green:
build clean (9 pkgs) · web 432 (+10) · schema 195 · acp 15 · analyzer 347 · ink 15.

## r25 — legibility polish from a fresh first-timer audit (usability U · Legibility) · SHIPPED ✅

**Result:** ran the usability-standard's prescribed **confused-first-timer screenshot audit** across all
surfaces (I re-viewed the shots myself). Verdict: 3 of 5 surfaces (arch graph · Learn · from-scratch
first-run) clear the ≥4 floor cleanly — logged so they're not re-litigated. Fixed the two clearest cheap
legibility gaps: **(1)** the arch-graph orientation caption was truncating in the common pane width
("…lines show ho…" — the most important half cut); shortened the copy to "Boxes are services & data ·
lines show how they talk." (the tab already says "Architecture") + a `title`/`aria-label` carrying the
full sentence — now reads complete (screenshot-verified). **(2)** the Programs graph's one-shot
fit-to-view used a guessed `setTimeout(40ms)` that could fire before the pane was measured; switched to
`useNodesInitialized()` (fit once RF has MEASURED the nodes) — robust to a pane that lays out late.
Adversarial review found the fit is exactly-once + no yank on compose edits, and flagged a pre-existing
latent bug I folded in: the one-shot guard wasn't reset on repo switch, so a new repo's program didn't
auto-fit — now `fitted.current` resets in the `[repoRoot]` effect. **Review: RELEASABLE.** Honest notes:
the audit's "Programs looks tiny" is mostly a wide-graph-in-a-narrow-pane reality (fitView is correct);
the tldraw Task Board watermark is a tldraw-license cost decision, not a code fix (logged, not patched).
Presentational round — verified by screenshot, no new unit tests (no lockable logic). Gate green: build
clean (9 pkgs) · web 422 · analyzer 347 · schema 195 · acp 15 · ink 15.

## r24 — PKCE hardening of the OAuth flow (tier-1 security · A-r19, off the draw surface) · SHIPPED ✅

**Result:** the Google/GitHub sign-in flow gains **PKCE (RFC 7636, S256)** on top of the existing
signed-CSRF `state` — the queued A-r19 hardening, and a deliberate move OFF the draw surface after 3
drawing rounds (no churn). `generatePkce()` in `auth.ts` (verifier = base64url(32 random bytes);
challenge = base64url(sha256(verifier))); `/auth/login` sends the S256 `code_challenge` on the authorize
redirect and binds the `code_verifier` into the **signed HttpOnly `state` cookie**; `/auth/callback`
replays that verifier in the token exchange. So a code stolen at the redirect can't be redeemed — the
verifier never rides the wire (only in the HttpOnly+Secure cookie server-side + the server→provider
token body). Backward-compatible (old state cookie without `v` → no verifier → still works); a
challenge-without-verifier state is unreachable (both minted atomically). **Adversarial SECURITY review:
RELEASABLE, zero findings** — verifier-leak trace clean, S256 byte-correct (real logins succeed), CSRF/
state not weakened, local-first untouched. +3 tests (independent S256 recompute; challenge present/
absent; verifier in/out of token body). Fixed doc-drift in `session.ts` (STATE token now legitimately
carries the verifier — noted why it's safe). Owner still does: set real OAuth creds + `PUBLIC_BASE_URL`
on deploy (live sign-in remains verified-against-mock until then). Gate green: build clean (9 pkgs) ·
analyzer 347 (+3) · web 422 · schema 195 · acp 15 · ink 15.

## r23 — freehand drawing on the from-scratch board (usability U4 · the biggest draw lever) · SHIPPED ✅

**Result:** the from-scratch "scratch" board — where you'd actually sketch a new app — finally has
freehand drawing (it existed ONLY on attached-repo Design before). A **Draw** toggle in the board
toolbar arms an ink overlay: **draw a box → a new block** (reuses the exact double-click create seam:
`addDesignBlock` + inline title edit), **draw a line box-to-box → nest one under the other** (via
`moveDesignBlock` — the genuinely NEW capability; there was no UI to connect two existing boxes). Live
stroke smoothed (`strokePath`, r21) + the gesture coach (r22) adapted to scratch copy. New pure
`scratchInk.ts` (`hitTestScratchBox` margin-slack rect test + `resolveScratchConnect` start=parent/
end=child, null on same/missing) with 12 unit tests. Overlay `return null`s when inactive + Draw
defaults off → the double-click-create e2e is untouched (verified PASS). Honest limit: scratch has no
free node positioning (ELK owns layout), so a drawn box lands via ELK, not where drawn — the rect only
classifies the gesture; hit-testing is top-level cards only (nested/relative-coord children out of
scope this round).
**Adversarial review caught a BLOCKER + I caught 2 layout collisions from a screenshot pass:** the
transparent overlay (z-40) covered `.board-controls` (a z-5 stacking context), trapping the user in
Draw mode (clicking Draw hit the overlay; Escape only reset the stroke) — and the reused `.ink-toggle`
(absolute) mis-placed the button + the coach collided with the top toolbar. Fixes: `.board-controls`
z-45 (above the overlay, toggle clickable to exit), `.scratch-ink-toggle` flows in the row, coach/hint
moved bottom-center, and **Escape now exits Draw** (guaranteed keyboard exit). Both exits verified in a
real browser (click-to-exit ✓ · Escape ✓); re-review RELEASABLE (z-45 safe on both boards — data-safety
+ double-click certainties held throughout). Gate green: build clean (9 pkgs) · web 422 (+12) · ink 15
· scratch e2e PASS. Queued: freehand box→node landing where drawn (needs scratch free-positioning);
line-connect across nested containers (ancestor-offset hit-testing); a kind picker for drawn boxes.

## r22 — freehand teaches itself: gesture coach (usability U4 · Discoverability + Learnability) · SHIPPED ✅

**Result:** turning on Draw no longer drops a first-timer into a crosshair with no clue — while Draw is
on and idle, a small monochrome coach strip teaches the two gestures the recognizer actually
understands ("Draw a box → a new node", "Draw a line node-to-node → connect them"), then **auto-hides
after the first recognized shape** so it never nags. New pure `showInkCoach(active, phaseType,
hasDrawn)` + `INK_COACH_LINES` (`canvas/inkCoach.ts`) — the "when to show" rule is unit-locked, the
overlay is a thin renderer. `hasDrawn` flips on the first box/line; scribbles/rejects keep it false so a
struggling user keeps the hint. `.ink-coach` is `pointer-events:none` so it can never block a stroke.
+5 tests (show-when-idle, off-state, full non-idle phase matrix, hasDrawn gate, 2-gesture content).
**Adversarial review: RELEASABLE, zero findings** — coach purely presentational, recognition/creation
byte-identical, cannot intercept a pointerdown, copy honest about what the recognizer supports. Gate
green: build clean (9 pkgs) · web 410 (+5). Note (deliberate): coach teaches once per design-view
session (persists across Draw toggles; resets only on unmount). Queued (drawing surface): freehand ink
on the from-scratch scratch board (biggest lever — ink only exists in attached-repo Design today);
user color/kind swatch; snap-to-node on scratch.

## r21 — fluid freehand: smooth the live stroke (usability U4 · Fluidity) · SHIPPED ✅

**Result:** drawing feels like a pen, not a jagged polyline — the owner's exact "drawing isn't fluid"
complaint. The live freehand stroke (Design-mode ink overlay) was rendered as a raw `<polyline>` of the
captured pointer points; it's now a smoothed cubic-spline `<path>`. New pure `strokePath(points)` in
`@sequence/ink` (uniform Catmull-Rom → cubic bézier) that passes THROUGH every input point (no drift),
deterministic, degenerate-safe (`[]`/1pt→`''`, 2pt→straight `L`, all-duplicate→dedupe→`''`).
**Crucially visual-only:** recognition still runs on the RAW points (`recognizeStroke(flowPts)` from
`clientPts`), so the 9 recognizer contracts (box/line/scribble taxonomy, thresholds, axis-aligned rect,
RDP endpoint preservation) are bit-for-bit unchanged — `strokePath` never feeds the classifier.
+6 ink tests (pass-through/no-drift with token-bounded endpoint assertions, deterministic, degenerate,
two-point-straight, dedupe). **Adversarial review: RELEASABLE** — confirmed smoothing purely visual +
recognizer untouched + no NaN/invalid-path input + tests real locks. Two non-blocking nits fixed
pre-commit: doc said "centripetal" (it's uniform Catmull-Rom); one substring assertion tightened to a
token-boundary regex. Gate green: build clean (9 pkgs) · ink 15 · web 405 · schema 195 · acp 15 ·
analyzer 344. Queued (drawing surface, next rounds): freehand ink on the from-scratch scratch board (it
only exists in attached-repo Design today); a user color/kind swatch; snap-to-node on scratch;
discoverability of the Draw affordance (single unlabeled button, no coaching).

## r20 — one-click "next steps" (propose→act loop) · SHIPPED ✅

**Result:** the assistant now *proposes and can act* — after an answer, it renders one-click
`Open <file>` chips for the real files it referenced, so the user stops re-typing/hunting ("executable
next steps run on ONE CLICK — no re-prompting"). Deliberately the **safest, most grounded slice**: the
`/api/ask` prose contract (and thus r19's protected model grounding) is **UNTOUCHED** — this is purely
client-side. New pure `deriveNextSteps(text, {knownPaths})` (`panels/nextSteps.ts`) where `knownPaths`
is built ONLY from real ArchGraph file-node paths (`kind:'file' && path`) — the exact set `openFile`
accepts. A step is offered only when that real path appears in the answer, so a **next-step can never
point at a file that doesn't exist** (the offered `path` is by construction an element of `knownPaths`,
enforced structurally, not just by a happy-path test). `ChatMessage` gained an optional `actions?`;
BoardChat computes them post-answer and renders monochrome `file`-icon chips (capped 3, ordered by first
mention, de-duped; charter-clean, no color/emoji). No repo → no known paths → nothing renders.
**Adversarial review: RELEASABLE** — grounding guaranteed by construction, dispatch correct, no ask
regression, scope = 5 web files, tests real locks. One LOW finding fixed pre-commit: raw `indexOf` could
offer a real-but-unreferenced *sibling* in a suffix-substring collision (`a/store.ts` inside
`web/a/store.ts`) — replaced with a path-boundary match (`boundedIndexOf`) + 4 locking tests (suffix
collision, basename-inside-longer, prefix-of-longer, trailing-period-still-matches). Gate green: build
clean (9 pkgs) · web 405 (+12 vs r19). Seam for next round: extend next-steps to more real capabilities
(auto-sort/rescan/generate) as the propose→act menu grows.

## r19 — assistant = agent window (Cursor-style) + adaptive voice + model picker with `+` (usability U2/U3) · SHIPPED ✅

**Result:** the Assistant stops being a "designed panel" and becomes a clean agent window — prompt in →
it acts — with a voice that adapts and a `+`-pattern model chip, per the owner's asks ("like Cursor is
an agent window", "the plus symbol to see extra models", "little icons… no colourful emojis").
Three moves: **(a) Adaptivity** — `buildAskPrompt` (`analyzer/explain.ts`) gained a *second* clause
telling the model to mirror the user's register/length/format (simple vs terse-technical vs
step-by-step) and default to concise structured notes; the grounding/honesty clause is UNTOUCHED and
sits first (answer ONLY from the real digest · do NOT invent services/files/connections · say so
plainly if undeterminable). No content latitude granted — tone only. **(b) Minimal noise** —
`BoardChat.tsx` stripped of the decorative "how to prompt" preamble + the long empty-state example;
header is now `Assistant glyph · model chip · Auto-sort`. **(c) The `+` pattern** — new `ModelPicker.tsx`
+ `listModelOptions`/`activeModelLabel` (`aiClient.ts`): a monochrome chip (network/chevron icons) whose
menu lists ONLY real, configured options and ALWAYS ends with a `+ → Settings` row; it never invents or
lists an unconfigured model, and selecting sends only a mode (no key material). +8 tests (2 buildAskPrompt
locks asserting BOTH register AND grounding survive; 6 listModelOptions cases incl. never-fabricate +
`+`-always-terminal). Icons monochrome, no emojis (charter).
**Adversarial review: RELEASABLE** — grounding provably intact and locked, model picker cannot surface a
fabricated model, ask path + CTAs intact, tests non-theatrical. Fixed pre-commit: one collateral CSS
regression the review caught — the removed `.board-chat-hint` rule was still used by `ScratchPanel`
(restored the rule) — plus dead `.board-chat-empty` removed and the dropdown caret rotated down. Gate
green: build clean · analyzer 344 · web 393 · schema/acp unchanged.
Seam left for next round: executable one-click next-steps (propose→act) in the job-note output.

## r14 — full re-audit swarm (3 lenses) after 13 rounds · CLEAN (stable-ratchet signal) · logged
Correctness lens: NO tier-1 regression/new violation — all six §5 invariants hold by constructed attack.
Feature/UX lens: NO tier-1 — the three arch overlays (Learn/impact/risks) provably mutually exclusive,
SideRail/panes coexist, Programs compose→run coheres; only tier-2 polish (mostly backlogged) remains.
Coverage lens: pure logic well-locked (no theater), but a SYSTEMIC verifier gap — r9–r13 component
bindings had no GATED test (zero .test.tsx). → drove r15. Plus nits: risks-panel denominator off-by-one,
changeNodeKind→start, impact-panel-re-pops-after-Learn.

## r17 — graph legibility: legend + orientation + de-clipped labels (usability U1) · SHIPPED ✅

**Result:** the #1 usability failure fixed — the arch graph now reads as a labeled MAP, not a pyramid
of unexplained lines. Re-added the deleted LEGEND (`Legend.tsx`/`legend.ts`) — an always-visible,
collapsible, bottom-right panel listing ONLY the node + edge kinds actually present (Service/Datastore
dots · HTTP/gRPC/Queue/Database line colors) + a "dashed = inferred/less certain" row iff a dashed edge
exists, keyed off the EXISTING `KIND_COLOR`/`KIND_SHORT` (extracted to `edgeStyle.ts`, hex byte-
identical — edge-hue DATA unchanged). Added a one-line dismissible orientation caption ("boxes are
services & data, lines show how they talk"). Fixed the clipped/overlapping edge labels: clean ellipsis
+ full-text `title` tooltip, pills lifted above node cards, hide-below-zoom-0.5 with hover/selection
reveal (color still encodes kind, now explained by the legend). +2 test files (legend derivation +
edgeStyle dashed/visibility rules). Monochrome/token icons, no emojis (charter). Adversarial review:
one BLOCKER — the legend was bottom-LEFT, covering the React Flow zoom/fit Controls; **fixed pre-commit
by moving it bottom-right** (the free corner; impact=top-left, risks=top-right, controls=bottom-left),
orchestrator visually re-confirmed the controls are visible + legend readable. Everything else clean
(legend correctness, no data-value change, r15 bindings not regressed, tests real). Gate: build clean ·
web 387 · switch-repo + learn + bindings e2e pass.

## r18 — DeepSeek free assistant + per-user daily rate limit (usability U6) · SHIPPED ✅

**Result:** the free assistant works on first run once the owner sets a key — fixes the "Add your key
on every screen" keywall. When `DEEPSEEK_API_KEY` is set server-side, default-mode `/api/ask` routes to
DeepSeek (openai-compatible, `deepseek-chat`, `gatewayLive:true` so the honest v18 gate passes); the
funded key is read from env ONLY at wire-time and emitted only as the outbound Authorization header —
never in any config/redaction/error/log. Per-user, per-UTC-day rate limit (`freeTierLimit.ts`, default
**`FREE_TIER_DAILY_LIMIT=100`** = ~$0.25/day/user at documented deepseek-chat pricing): checked before
spend, recorded only on success, over-cap → honest 429 (`FREE_TIER_DAILY_LIMIT_MSG` → the web "add your
key" nudge), BYO-key mode never limited. No key → unchanged honest `FREE_TIER_NOT_LIVE_MSG` before any
fetch; BYO-key routes to the user's own endpoint (regression-locked). +10 tests. Adversarial SECURITY
review: RELEASABLE — no key-leak path, honest-unset intact, rate-limit correct, BYO safe, gateway seam
preserved; tests lock every mutation. Minor non-blocking: in-memory limiter not atomic + anon users
share the `local` bucket (per-instance, documented). Gate: build clean · analyzer 342 · web 387 · all
e2e pass. Env added: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL?`, `DEEPSEEK_BASE_URL?`, `FREE_TIER_DAILY_LIMIT?`.
**Owner action to turn on: set `DEEPSEEK_API_KEY` on the deploy.**

## r16 — Warm-Play polish tail (tier-2 UX · first slowed-cadence round) · SHIPPED ✅

**Result:** closes the r14 UX-lens tier-2 findings. Introduced a NAMED chrome token `--create #2fb27c`
/ `--create-ink #0c1a12` (a deliberate green DISTINCT from the `--db` data hue) and repointed the
create/confirm affordances (`.board-create`, `.cp-infer-kind`, scratch-`keep`) to it — green stays,
but as chrome not a borrowed data hue. Neutralized the inactive Draw nib (`--http`→`--muted-strong`)
and `.scratch-tools button:hover` (`--http`→`--border-strong`); fixed stale `#0d0d0d`→`--create-ink`.
Warmed the React Flow grid literals (`#1c1c1c/#262626`→warm) in Canvas + ProgramGraph. Programs
compose panel `max-width:40%` so the canvas yields last in a narrow pane. Contrast verified 6.64:1.
Orchestrator-verified: data-hue safety (no edge/kind/legend selector repointed — grep clean), build
clean, gated bindings (impact+risks) still pass after the grid change, visually confirmed. Gate:
web 371 · all e2e incl. bindings pass. CSS/token only (+ 2 Background color props).
Backlog (batch for a future polish round, honestly flagged by the builder): more edge-hue-as-chrome
left in strict scope — `.scratch-addtop:hover`, `.board-card.openable:hover`, the pervasive
selection-outline `--http` blue, `.ink-stroke`; and the same cool grid literals in DomainCanvas/
PlainCanvas/ScratchCanvas (only Canvas+ProgramGraph were in this round's ownership).

## r15 — harden the verifier (gate the feature bindings) + close re-audit nits · SHIPPED ✅

**Result:** closes the r14 verifier gap — the moat is now protected by the gate. Converted the feature
shot scripts into **asserting gated e2e** and wired them into the standing gate (+ vision §7):
`test:e2e:impact` (select→grounded blast panel + deselect→clean), `test:e2e:risks` (click routes
selectNode to the clicked node), `test:e2e:scratch` (double-click→new node + inline editor, no stuck
zoom — the long-open r9 item), `test:e2e:acp` (runtime=acp→honest empty state, 0 fabricated options).
Each fails-on-unbind (verified by orchestrator running all 6 e2e here — real grounded assertions).
Nit fixes + locks: risks denominator (`rankableNodeCount`, repo-excluded, == computeRisks total);
`changeNodeKind`→start/end stays gated (2-start / no-start → validateProgram !ok, Run total, no crash);
`openLearn`/`closeLearn` clear `selectedNodeId` symmetrically (impact no longer re-pops after the tour);
graphToDraft cyclic-containment. +7 vitest. Adversarial review: RELEASABLE — all four e2e confirmed
real fail-on-unbind locks (not false-passing), fixes side-effect-free; hardened one theoretical
two-empty-strings false-pass pre-commit. Gate: build clean · schema 195 · acp 15 · analyzer 333 · web
371 · **6 gated e2e all pass** (switch-repo, learn, impact, risks, scratch, acp).

## r13 — ACP local-agent picker for Programs (tier-1 feature · completes "drive ACP") · SHIPPED ✅

**Result:** completes the deferred half of r10 — the Programs agent-node editor now lets a user point an
`acp` node at one of their **registered local agents** (Claude Code / Codex / Gemini) via a picker,
not just the CLI. Reuses the existing `GET /api/acp/agents` endpoint (no server change). New
`getAcpAgentsResult()` (discriminated `{ok,agents}`|`{ok:false,error}`) so **empty ≠ error**; pure
`deriveAcpAgentsState` (loading/unavailable/error/ready) + `acpPickerOptions` (never invents an agent —
only endpoint ids + the node's own current ref as a "stale" row). Honest states: hosted/static →
"unavailable" + manual-ref fallback; localhost-empty → "No local agents yet · Settings › Local coding
agents / `sequence agent add`"; fetch-fail → retryable error; no-ref chosen → non-blocking hint (run
errors honestly at the server, no crash). +13 tests. Adversarial review: RELEASABLE — no fabricated
agent, empty↔error distinction holds, exact-ref write preserves shareSession, honest degrade, validity
clean. Gate: build clean · web 364 · switch-repo + learn e2e pass. Only packages/web touched.
**Both greenlit features now fully complete** (Edit=real ✓, Programs compose ✓ + drive-ACP ✓).
Not verifiable headlessly: driving a real local subprocess (no registered agent in the harness) — the
picker logic, honest states, and validity ARE verified; the unresolved-ref honest-error path is locked
by existing webExecutors tests.

## r12 — system-risk advisor: single points of failure (MOAT layer 3) · SHIPPED ✅

**Result:** a design advisor that ranks the architecture's **single points of failure**, built on r11's
verified impact engine. `graph/risks.ts` (pure, reuses `computeImpact` — no new traversal): for each
node, blastRadius = `impactedBy.length`; severity from honest fraction thresholds (critical ≥.5 / high
≥.3 / moderate ≥.15) over the non-repo node count; SPOF floor (severity ≥ moderate AND blast ≥ 2) so a
leaf is never flagged. A "Risks N" panel lists the top-6 ranked with grounded copy ("postgres
(datastore) — single point of failure: 6 of 10 nodes break"); clicking a risk reuses the r11 blast-
radius highlight (no duplicated overlay). +13 tests (grounding lock: every cited count ==
`computeImpact(...).impactedBy.length`; SPOF floor; moderate-threshold floor; empty/flat totality).
Adversarial review: RELEASABLE — grounded by construction, can't overstate/fabricate/miscount, same
`view.edges` as the overlay so list matches click, honest empty state, mutually exclusive with r11 +
Learn tour. Fixed the moderate-threshold verifier gap pre-commit (added the [0.15,0.3) → moderate and
just-below → dropped locks). Gate: build clean · web 350 · switch-repo + learn e2e pass.
Backlog (safe understatement): the "Risks N" badge shows the shown count, not the pre-cap total when
>6 SPOFs exist — reword to "top N" (needs exposing the pre-cap count).

## r11 — dependency + failure-impact intelligence (MOAT layer 2) · SHIPPED ✅

**Result:** the first real slice of the differentiator — "if this fails, these break." Selecting a node
in the Technical arch view computes its blast radius over the rendered graph: pure/total
`computeImpact(links, nodeId) → {dependsOn, impactedBy, …}` (`graph/impact.ts`) + `impactHighlight`
(role/dim mapping), a floating `ImpactPanel` ("If **X** fails, N nodes break (M directly): …" + "X
relies on: …"), impacted nodes tinted danger-red, dependencies blue, the rest dimmed — reusing the
existing spotlight/dim path. **Edge direction confirmed load-bearing & correct** (`src→dst` = src
depends on dst, verified vs shopfront ground-truth): `impactedBy` = reverse closure, `dependsOn` =
forward. Verified end-to-end on shopfront: postgres → 6 dependents break, relies on nothing.
+12 tests incl. a DIRECTION-LOCK proven by mutation (transposing adjacency fails 7/12). Adversarial
review: RELEASABLE — direction correct, no fabricated impact, cycle/missing/self-loop total, mutually
exclusive with the Learn spotlight (no dim desync), no stuck highlight on deselect/repo-switch/mode
change. Gate: build clean · schema 195 · acp 15 · analyzer 333 · web 338 · switch-repo + learn e2e
pass. Only packages/web touched; tokens/edge-hues untouched (overlay tints via color-mix).

## r10 — Programs is COMPOSABLE (tier-1 feature · greenlit) · SHIPPED ✅

**Result:** closes the compose half of the Programs site↔app mislead — the tab was a read-only demo,
now it's an editable agent-graph builder. New pure reducers (`programEdits.ts`: add/connect/updateNode/
changeNodeKind/deleteNode/deleteEdge/setEdgeKind, copy-on-write) + a Compose rail (`ProgramPanel.tsx`:
7-kind palette, per-kind config editor, non-blocking validity hints, shared-state view) + connectable
graph with an edge-kind popover. Uses the EXISTING schema `validateProgram` (no schema change). Badge
"example program — next wave" → "composable · editable". +19 tests (composed program validates AND
runs to `completed`; deleteNode leaves no dangling edge; changeNodeKind drops stale bags; persistence
round-trip + invalid-blob→demo fallback; branch edge-kind inference). Adversarial review: RELEASABLE,
no blockers — **Run is double-gated** on validateProgram AND `runProgram` is itself total, so no edit
sequence can crash Run; structural edits blocked mid-run; reducers clean. Fixed 2 nits pre-commit:
cleared the connect-picker `pending` when a run starts (last structural control lacking a running
guard); added the branch-inference test the verifier flagged as missing. Gate: build clean · schema
195 · acp 15 · analyzer 333 · web 326 · switch-repo + learn e2e pass.
Deferred to next round: ACP agent-node authoring (the palette's agent kind + node editor already
expose `runtime:'acp'` + `agentRef`; what's missing is a UI to register/pick a LOCAL ACP agent so an
acp node drives a real subprocess). Backlog (cosmetic): orphaned `.program-invalid`/`.program-inspector`
CSS.

## r9 — first-run drawing that "just works" + talk-to-draw seeds (tier-2 UX + moat slice) · SHIPPED ✅

**Result:** the owner's #1 drawing challenge + the moat's first slice. On the empty from-scratch design
board: a **non-blocking welcome** ("Start drawing — no manual needed") with 3 arrow-hints (double-click
to add · drag a box edge to connect · ✨ describe it), `pointer-events:none` so it never blocks input,
appears only when empty+undismissed, vanishes on first node/dismiss, persisted (localStorage, total).
**Double-click empty pane → create-and-edit-in-place** (gated to `.react-flow__pane`, `zoomOnDoubleClick
false`, opens inline title via a new one-shot `designEditing` store field). **Talk-to-draw seeds:** a
verb-led placeholder + 3 example-prompt chips that fill AND submit the real `runStarter`. +19 tests
(welcome show/hide + pref totality, chip exact-text submit, double-click pane-gating). Adversarial
review: RELEASABLE, no blockers — double-click scoping/welcome/designEditing/chips/regression all
traced; e2e-verified the create→vanish flow in Chromium; orchestrator visually confirmed. Gate: build
clean · web 307 · switch-repo + learn e2e pass. Scope: packages/web only; tokens/edge-hues/SideRail
untouched.
Backlog: (1) add a GATED e2e locking the double-click-create *binding* (pure helpers are unit-locked,
but a regression unbinding `onDoubleClick`/`zoomOnDoubleClick` would pass all unit tests — verifier gap
worth closing). (2) cosmetic: centered welcome card overlaps the double-click demo zone.

## r8 — Obsidian-style Files/Graph SideRail (tier-2 UX · structure) · SHIPPED ✅

**Result:** a persistent left rail (the "Obsidian file structure" the owner asked for). **Files view:**
the real repo tree from the existing `GET /api/tree`, expandable folders, 1px indent guides, active
row `--accent-soft` + ember bar; clicking a file opens it via the existing `openFile` (real editor
tab with the file's code). **Graph view:** a truthful **local neighborhood** of the active file
(Imports/Imported-by/Siblings from the scanned graph — verified: `index.ts` shows its 4 real imports
+ sibling), colored by semantic hues. Collapsible (52px), resizable, gated `platform && !scratch`,
component-local state (collapse persisted to localStorage). No server change (reused `/api/tree`).
+15 tests (tree flatten, dispatch locked both ways, neighborhood split/dedupe, transitions).
Adversarial review: RELEASABLE, no blockers — gating/layout/fetch-robustness/wiring all traced; 4
nits all unreachable/cosmetic. Orchestrator visually confirmed both views. Gate: build clean ·
schema 195 · analyzer 333 · acp 15 · web 288 · switch-repo + learn e2e pass. Only packages/web
touched; tokens + edge hues untouched.
Backlog (cosmetic): rail width not persisted across remount (collapse is).

## r7 — bubbly components (tier-2 UX · design character) · SHIPPED ✅

**Result:** the playful behavior layer on the r5 tokens, CSS-only (no TSX). Fixed the 4 r5 accent
nits: `.cp-ai` + `.task-card-kind.kind-ai` → orchid (AI), `.program-run` → ember (one consistent
"Run" primary — verified in screenshot), `.ink-toggle.active` → ember, `.wtab.active` → subtle ember
underline (inset box-shadow, no layout shift). Added spring micro-interactions — press-squish
(`button:active scale .97`), pop-in on node/card mount (spring, 180ms, once), connect-bloom on the
design valid-handle — ALL gated behind `prefers-reduced-motion: no-preference` and zeroed in the
reduce block (self-verified via diff). Orchestrator visually confirmed via screenshots; motion
gating checked. Gate: build clean · web 273 · switch-repo + learn e2e pass. CSS-only, edge-hue data
colors + tokens untouched.
Backlog (design call, not restyled): `.scratch-proposed-bar button[scratch-keep]` green (accept
semantic) + stale `#0d0d0d` ink; `.board-create`/`.cp-infer-kind` green "create" motif — decide
ember vs green for create/confirm actions in a later pass.

## r6 — "Edit" edits your REAL scanned system (tier-1 feature · greenlit) · SHIPPED ✅

**Result:** entering the Edit depth now seeds `store.draft` from the scanned `graph` (via a pure
total `graphToDraft` adapter) instead of showing the blank "my-system" node — so Edit works on the
user's real architecture. Guarded by a `draftPristine` flag (flipped false by every draft mutation
+ `loadDraft`), so it NEVER clobbers in-progress edits, a starter, or an imported spec; idempotent
on re-entry; repo-switch resets to re-seed the new repo (setGraph fires before setStatus). Also
extracted + locked the last correctness-hardening item: the starter domain-loss guard
(`planStarterApply`). +15 tests (graphToDraft 6, editSeeding 6 incl. identity-`.toBe` anti-clobber,
starterPlan 3). Adversarial review: RELEASABLE — traced every clobber/idempotency path, no blocker;
fixed 2 nits before commit (overstated adapter comment softened to be accurate; brittle
catalogue-dependent test line made robust via a derived no-domain starter). Gate: build clean ·
schema 195 · analyzer 333 · acp 15 · web 273 · switch-repo + learn e2e pass.
Accepted-by-design (non-blocking): a manual drag of the placeholder node during the async graph-load
window is lost on seed (positions are ephemeral); re-attaching the SAME repo resets the draft (matches
existing rebind semantics, drafts have no persistence).

## ★ USABILITY AUDIT #1 (the SECOND gate, `usability-standard.md`) — multiple tier-1, NO usability ratchet
Vision "confused first-timer" judge + code deep-dive against the live app. The correctness gate is
green but human-usability FAILS on the three core-job surfaces. Tier-1 findings → the usability roadmap:
- **U1 · Graph legibility** (cheapest, #1 impact): the legend was DELETED (App.tsx:126) — colors/dashed
  lines have no on-screen key; + clipped/overlapping edge labels ("I, db write, db") read as bugs; + no
  "what am I looking at" header. Nodes/edges ARE labeled (AggEdgeComp KIND_COLOR/KIND_SHORT) — only the
  legend render + label-collision are missing. → r17.
- **U2 · AI adaptivity**: `buildAskPrompt` (explain.ts:733) hard-codes "non-coder/concise/plain English"
  = one voice for every request. One-line prompt fix (keep the grounding invariant). Assistant client
  sends only the raw question (BoardChat.tsx:53).
- **U3 · Assistant = agent window** (owner directive): strip fluff/button-soup → clean Cursor-like
  composer; terse structured job-note outputs (what happened · what it does · next steps); executable
  next steps run on ONE CLICK (propose→act, no re-prompting).
- **U4 · Drawing fluidity + human color**: InkOverlay raw un-smoothed polyline, 2 shapes only, color is
  fixed (no color-as-meaning). → smoothing + snap-to-node + a color/kind swatch.
- **U5 · Programs clean first-run**: opens in a RED "Failed — a node errored / not reachable from start"
  state + "Programs" never explained → looks broken to a newcomer.
- **U6 · Assistant reachable on first run**: keywalled behind "Add your key" (needs the free gateway
  deployed — owner/infra) — the headline value is untouchable cold.
Calm surfaces (Files rail, Learn, Settings, Risk advisor) already clear the bar — the team CAN hit it.

## Backlog (parked findings, re-derived each round — a hint, not a queue)

**REMOVED per owner (r68 — do not re-ship):**
- **Architecture system-flow strip** — bottom "System flow" / "Agent run" chrome on GroupedCanvas
  (`grouped-system-flow`, `buildSystemFlowSteps` UI). Owner: ultra-specific, not needed. Agents workflow
  progress belongs on inline Assistant artifact only. Pure step builders may remain for tests/export.

**Tier-2 UX (parked from W7 · J6):**
- **drawn-node auto-placement near its connection** — when a user draws/creates a node that connects to
  an existing one, place it adjacent to that connection instead of at a default/origin spot. Deferred by
  the W7 fix pass (not built): needs a placement heuristic against the live layout + an e2e binding.

**Tier-1 (next rounds):**
- **computeView render-aggregation has zero tests** (`web/src/graph/aggregate.ts:38-133`) — highest
  blast radius; §3 grounding unlocked at the render layer. R2 candidate: lock it, fix any edge-lift/
  self-loop bug it reveals.
- **join.ts grounding branches untested** (`analyzer/src/join/join.ts:161-273`) — the "don't invent an
  edge" logic guarded by one fixture only. Unit-test the unwired-env, code-default, and route-match
  branches.
- **starter data-loss guard untested** (`web/src/panels/DesignPanel.tsx:359-372`) — the
  `entities.length===0` domain guard has no locking test; one flipped condition wipes a user's domain.

**Greenlit feature builds (owner-decided 2026-07 — after correctness-hardening, before the moat):**
- **"Edit" = your real system** (Lens D#1) — seed an editable draft from the scanned `graph` (guarded
  so it never clobbers in-progress edits), so Edit depth edits the real codebase, not a blank
  "my-system" node. GREENLIT to build.
- **Programs = real compose + drive-ACP** (Lens B GAP1) — build the in-app authoring UI: compose agent
  graphs + drive local Claude Code/Codex over ACP against the map, matching the site promise. GREENLIT
  (multi-round feature; engine + honest executors already exist, the UI does not).

**Roadmap (per owner vision 2026-07 — "harden, then the moat"):**
1. Finish tier-1 correctness hardening: computeView (r2, running) → join.ts branches → starter-guard
   test → r1 null-root/`[]`-element follow-up.
2. Greenlit tier-1 feature-completeness: Edit=real-system → Programs compose/ACP.
3. The moat (vision §2), first slice: **draw→logic + talk-to-draw** — sketches/conversation become real
   typed system logic, AI draws back. Then dependency/failure-impact intelligence, then industry
   patterns.

**Design stream (parallel, owner 2026-07 — "bubbly/fun/dark/Obsidian, super hands-on"):** the UI should
feel playful + inviting on a dark base (Kodak-ish warmth, rounded/bubbly shapes, friendly motion) with
an Obsidian-style file/graph structure, and a first-time drawing experience a dev "with no idea what's
happening" gets instantly. Runs alongside correctness-hardening: research what devs love (tldraw,
Excalidraw, ChatGPT canvas/coworker, Obsidian, Cursor) → `docs/design-direction.md` (concrete design
system + onboarding patterns) → reskin + accessible-drawing onboarding rounds.
_Research DONE (5 agents: dev-love, aesthetic, drawing-onboarding ×2, talk-to-draw) → synthesized into
`docs/design-direction.md`: the "Warm Play" token system (warm neutral ramp + Ember/Orchid two-accent
split + bubbly radii + spring motion + Obsidian SideRail), the hands-on interaction patterns
(canvas-mutation-is-the-prompt, diffs-on-graph, plan-on-graph, local graph, visible context), and the
first-run drawing flow (double-click-create, hover-reveal connect handles, never-blank-void,
talk-to-draw via NL→DSL→native-shapes). Build sequence: tokens → bubbly components → SideRail →
drawing onboarding → hands-on AI surface._

**Operating mode (owner 2026-07):** the loop now SELF-CONTINUES — rounds run back-to-back without
waiting for per-round approval; I batch status (milestones + decisions only), not every micro-step.
Nothing ungated ever hits `main`; the standing gate + adversarial review still run every round.

**Tier-2 (later):** pr-triage flagship is CLI-only / no GUI (B GAP2); in-app demo can't complete without
a key while the rest is local-first (B GAP3); two onboarding systems Guide vs Learn (D#2); keyless
default undersells plain-English (D#3); domain-model empty-state missing (D#4); `resolveImport`
untested (C); `fit.test.ts` asserts constants not behavior (C).

---

## r5 — "Warm Play" token reskin (tier-2 UX · design foundation) · SHIPPED ✅

**Result:** applied the Warm Play token system (`docs/design-direction.md` Part A) to
`packages/web/src/styles.css` + `site/styles.css` — warm amber-brown neutral ramp (#13100d/cream),
**Ember `--accent` #ff8a5c** as the touchable primary, **Orchid demoted to `--magic`** for AI only,
warmed edge hues (meaning-locked), bubbly radii + warm shadows + rim-light cards + display font.
Migrated button usages (--http→--accent) and every AI affordance (--accent→--magic). Adversarial
design+regression review: RELEASABLE — two-accent split verified in screenshots (Learn/AI orchid,
Run/focus/Get-started ember), contrast passes (text 16:1, button-ink 7.9:1), edge hues intact, no
broken refs. Fixed the one inconsistency this diff introduced (scratch "AI-proposed" family
`.scratch-badge`/`.scratch-proposed*`/`-bar` finished to `--magic`). Gate: build clean · web 258 ·
switch-repo + learn e2e pass. CSS-only, zero TSX/logic touched.
Backlog (nits → next "Bubbly components" round): `.cp-ai` + `.task-card-kind.kind-ai` are AI but
still indigo `--grpc` (→ magic); `.program-run` green vs `.task-run` ember (two "Run" colors);
`.ink-toggle.active` + `.wtab.active` owed an ember active state; a few stale `#0d0d0d` literals on
unchanged edge-hue grounds.

---

## r4 — close the correctness-hardening backlog (tier-1) · SHIPPED ✅

**Result:** the last 3 pure-function tier-1 gaps closed. (1) `validateGraph` is now total against a
null/non-object ROOT too (early guard `if (g===null||typeof g!=='object') return ['graph is not an
object']`), symmetric with `validateDomain` — the only prod change. (2) computeView: added a
behavioral lock for an edge terminating AT an expanded container (rep = that node). (3) join.ts:
added an external-literal-host → 0-edge lock (with a matching-route trap so a host-ignoring mutation
is also caught). No bugs found in aggregate/join. Adversarial review: RELEASABLE — mutation-verified
the guard is correctly scoped (valid graphs + r1's null-element cases untouched) and gaps 2/3 catch
mutations; one honesty nit (gap-2 comment overclaimed line coverage) corrected before commit. Gate:
build clean · schema 195 · acp 15 · analyzer 333 · web 258 · e2e pass. **Tier-1 correctness backlog
now clear** (only the DesignPanel starter-guard data-loss test remains — folded into the upcoming
Edit=real-system feature round, which touches that file).

---

## r3 — join.ts edge-grounding lock (tier-1 correctness · "no fabricated edges") · SHIPPED ✅

**Result:** `joinAll` HTTP grounding was already CORRECT — no code change. Locked with a new
11-test suite (`analyzer/src/test/join-grounding.test.ts`) direct-importing `joinAll`,
`segmentsMatch`, `urlPartsToHostAndPath`. Anti-fabrication lock: unwired env host + no code
default → 0 edges + honest warning; code default naming a non-existent service → 0 edges; matched
route → conf 0.95/0.90 to a file node; unmatched → downgraded (base −0.15) to `svc:<target>`.
Adversarial review: RELEASABLE — traced all 6 mutation classes, each caught; confidences are
hard-coded literals (no re-implemented arithmetic), base constants 0.85/0.9 pinned. Gate: analyzer
331 (was 320), build clean. Backlog: external literal host (`join.ts:231-240`) emits-no-edge has
no dedicated test — one adjacent grounding branch left to lock.

---

## r2 — computeView render-aggregation lock (tier-1 correctness) · SHIPPED ✅

**Result:** `computeView` (the render-time ancestor-lift aggregation, run on every draw) was
already CORRECT — no code change. Locked with a new 17-test suite (`web/src/graph/aggregate.test.ts`)
over a `repo>service>module>file` fixture, asserting exact ids/counts/kinds/confidence at collapsed/
partial/expanded/degenerate states. Adversarial review: RELEASABLE — mutation-tested all 7 regression
classes (off-by-one lift, self-edge suppression, parallel-merge, root-as-node, conf/kind fold,
wrong-side lift, degenerate throw); each caught. Gate green: web 256 (was 239), tsc clean, e2e pass.
Backlog: edges terminating AT an expanded container (`aggregate.ts:80-84`) still uncovered — cheap
follow-up test.

---

## r1 — validator totality (tier-1 correctness) · SHIPPED ✅

**Result:** `validateGraph` + `validateDomain` are now total against `null`/non-object array
elements (filter → report → iterate filtered). +7 locking tests. Adversarial review: RELEASABLE
(no residual throw, no valid-input behavior change, no silent data loss, tests are real locks,
scope clean). Authoritative gate green: build clean · schema 191 · acp 15 · analyzer 320 · web
239 · switch-repo + learn e2e pass. Closes the Load-spec white-screen at root.
Backlog added (review notes, tiny tier-1): `validateGraph(null)` root still throws (pre-existing;
`validateDomain` guards `m?` but `validateGraph` doesn't guard `g`); a `[]` element passes the
object guard and is kept with `id:undefined` rather than flagged "not an object".

**Swarm (4 lenses):** correctness found 1 confirmed reachable crash (validators throw on null array
element → white-screens Design via Load spec); feature-gap found the Programs site↔app mislead
(escalated) + no crashing tier-1 defect; test-coverage found computeView/join/starter-guard unlocked
(backlogged); UX confirmed v18's big fixes held and found the Edit-depth blank (escalated). Broad
confirmation that v14–v18 hardening stuck.

**Shipping:** fix `validateGraph` (`schema/src/index.ts`) + `validateDomain` (`schema/src/domain.ts`)
to guard element-level access so they never throw on `null`/non-object elements — the §3 totality
invariant — with null-element locking tests in both suites. Root-cause fix also closes the Load-spec
white-screen without touching callers.

---

## AUTH AUDIT (read-only) — auth is WIRED end-to-end + secure, not stubbed
GitHub + Google OAuth both real: authorize redirect + signed CSRF `state` → real code→token exchange
(client_secret from env) → userinfo → signed HttpOnly/Secure session cookie verified every request →
per-user metering + workspace jail + owner-check + sign-out. No prod mocks, no unsigned cookies, no
secret leak; non-loopback bind refused unless auth on; correctly optional (local = no login). Separate:
local GitHub PAT connect/import (github.ts) is BYO-token, not OAuth.
Gaps ("finish auth"): **(tier-1, OWNER) live sign-in has only run vs a mock — never real google/github;
needs the owner's creds on a deploy + redirect URI = PUBLIC_BASE_URL/auth/callback/{google,github}.**
(tier-1, CODE — queued A-r19) add PKCE (currently state/CSRF only). (tier-2, by-design) single-active-
repo hosted model; stateless 7-day session (logout clears client cookie only, no server revocation);
no account DB. Env: GITHUB_CLIENT_ID/SECRET, GOOGLE_CLIENT_ID/SECRET, SESSION_SECRET, PUBLIC_BASE_URL.

---

## r28 (W1-W7 + review-fix) — the macOS-native reskin, owner-directed, MERGED TO MAIN
The owner-approved mock (scratchpad/sequence-reskin.html) became the CANONICAL design system
(`docs/macos-ui.md`): verbatim tokens (graphite grounds --win/--chrome/--rail/--canvas, accent
#0a84ff, SF-Pro --sans, mock radii 7/9/13), floating rounded window on a desktop gradient with
traffic-light titlebar, frosted depth/chips/model pill, 22px composer with circular blue send,
yellow-folder file rail with accent-soft selection, dot-grid canvas, graphite node cards, muted
steel/sage/olive edge lines, icon-only severity squares (LAWs: graph text always bold+legible;
icons over words). Grounded keyless assistant expanded: "what's fragile here?" (SPOF + blast
radius from computeRisks) AND "what talks to the database?" (real db edges via dataAccess.ts);
model-needing paths fail in plain English (aiErrors) — raw API routes never reach the user.
**Usability:** fresh-eyes persona ("Jordan", zero context) drove the built app cold — all 5 goals
achieved, verdict "adopt, fix 3 first"; his findings (raw PUT /api/ai-config leak, tour-nag
overlap+re-show, graph readability, "1 files") fixed in W7 with locking tests.
**Adversarial loop:** round 1 (full diff) → 1 blocker + 4 minors: the FIX row asserted an
unverifiable "has no fallback"/"failed query" over a kind-unfiltered (possibly import) edge —
fabrication inside the flagship grounded feature. Fixed: pickFixEdge (interaction kinds only,
no interaction edge → no FIX row), advisory kind-appropriate wording, absence-locked tests;
plus components-noun, db_access as 'access', narrowed isNotConfigured, role="img". Round 2
(scoped, attack: mixed-kind aggregates, tie-breaks, wording derivability) → RELEASABLE, 0 new.
Convergence 5 → 0.
**Gate at merge:** build 0 · node --test 4/4 · web vitest 424/424 (43 files; +27 locking across
fragility/dataAccess/aiErrors/findingSeverity/learnTour/edgeStyle/legend) · e2e switch-repo/
impact/risks/scratch/acp/learn ALL PASS. Branch fast-forwarded to main at 2d7fedc.
Backlog: drawn-node auto-placement near its connect target (Jordan #4); legend can overlap the
bottom-most node on tall auto-layouts (accepted residual, frosted+collapsible); Risks chip keeps
alert-icon semantics vs mock's neutral dot (established language).

---

## r75–r79 — the "not releasable" verdict closed out (security → fabrication → gaps)

Adversarial round 2 returned **NOT RELEASABLE** with 15 findings. All are now closed, each with a
test proven to fail against the old code (mutation-verified, per fix).

**r75 — security (F1 CRITICAL, F2 HIGH).** `jail.ts` treated a thrown `realpathSync` as "leaf does
not exist" and fell back to the LEXICAL path — but a *dangling* symlink throws exactly that, while
`writeFileSync` follows it. A repo could commit `notes.md -> /outside/pwned.txt` or `harmless.md ->
.git/hooks/pre-commit` (dangling in a fresh clone, since git creates no hooks) and one Save wrote
through it: arbitrary write, then code execution at the user's next commit. Fixed with
`resolveLinkTarget`, wired into both `resolveInRepo` and `realpathContained`, so the TARGET is
judged. F2 was mine: `isDecisionRecordWritePath` was a bare path-shape alias, so a hard link at
`.sequence/decisions/leak.md → .sequence/ai.json` let one "Open in editor" overwrite the stored API
key. Now requires `isFile() && nlink === 1`, while still allowing a not-yet-existing record.

**r76 — the Process rail lost 7 of 11 services on every microservices repo.** The archetype sets
`explodeServices`, so the plain tree contains ZERO `service` nodes — every service is promoted to
its own top-level `area`. The collector only gathered service/feature/data, so it gathered none of
them; the rail showed one "Shared data" bucket while the footer kept counting all 11. Fixed by
recognising a promoted area on evidence (exactly one `sourceRefs` naming a real graph node, and no
service/data node of its own). A second bug found while testing the first: the container check also
counted `feature` children, and an exploded service's children ARE its features — so any service
whose files clustering happened to group vanished again. Narrowed to service|data.
The safeguard is a COVERAGE test: every scanned node lands in a bucket, and every service gets its
own NAMED row (coverage alone is too weak — fuzzy title matching sweeps a dropped service's id into
an unrelated row, which is exactly how the loss hid).

**r77 — five fabrication findings.** "Talks to brain · brain" (deduped on id, printed the label);
one parsed function deleting a whole module with `hiddenCount` still 0; "6 matches" for 2 matching
files (counted the ancestor dirs emitted to reveal them); "8 parts" where the real count was 17
(inherited the CANVAS card's sub-component cap into a scrollable tree); and every function name
joined with `" + "` into the card title, the ADR H1 and the AI prompt.

**r78 — attribution, findability, reachability, layout.** `routeLabelFor` claimed routes from any
labelled edge in any direction, so a caller was labelled as the handler and a `db` table note was
presented as an endpoint. `.env.example` was hidden by the `.env.` rule. `/api/tree` walked
`.terraform`/`.yarn`/`.idea`. A Process click could strand the board dimmed (pane click never
cleared `flowHighlight`). A sole-member service that owned functions was not importable alone. The
create popover opened off-board. The never-clip LAW stopped at two lines. **F9 was ruled INTENDED,
not a finding** — generic bucket titles on the no-key path are correct, because those words state a
real structural fact and local-first means the rail must work with no key; both branches are pinned
by test so the next round does not re-raise it.

**r79 — the tests themselves.** A mutation sweep (disable a guard, see if anything notices) found
four survivors; three were real gaps (the default parts cap, the roots-first guarantee that rested
on a caller's incidental ordering, the one-row-per-span guard). The fourth is genuinely redundant
and is documented as belt-and-braces rather than pinned by a test that would pass either way.
The Process rail is now also verified against the RUNNING APP — `e2e/process-shots.mjs` refuses to
write its capture if the defect is still visible. Result: 3 buckets, 12 rows, all 11 scanned nodes.

**Gate at r79:** `pnpm -r build` clean · web vitest **830/830** (82 files) · node schema 243/243,
acp 15/15, ink 15/15, export 33/33, analyzer 422 pass / **5 fail = the known pre-existing ai-server
five** (generate ×2, provider-cap, metering ×2) · e2e switch-repo / impact-shots / learn /
process-shots ALL PASS. `e2e/risks-shots.mjs` fails BY DESIGN (the owner pulled Risks from the
regular view).

**Open, owner-facing:** the Task Board screenshot is still blocked on a licensing decision —
`VITE_TLDRAW_LICENSE_KEY` is unset, so tldraw stamps "Get a license for production" onto any
capture. Not a code defect; it needs a key or an explicit decision to ship the watermark.

---

## r81–r86 — the schwai_com report: one root cause, then pairing and the icon-native shell

The owner drove Sequence against their own 12-app product monorepo and reported five
things. Reproducing first showed that four of them were ONE bug.

**r81 — a compose `context: .` was swallowing the whole monorepo.** Their compose
builds the API with `context: .` (normal — the image COPYs shared packages) and
`dockerfile: backend/Dockerfile`. Taken literally, that made the scanner walk the
ENTIRE repo into that one service: two services both rooted at `.`, every sibling app
(marketing, learning platform, admin console, CRM, forms) demoted to a `module` of
each, and the front-ends compose does not deploy absent entirely. The Task Board, the
MADR pop-up and the Process rail were not broken — they were faithfully drawing a
graph that had already lost the system. Fixed with the compose file's own evidence: a
root context narrows to its `dockerfile:` directory, and `context: .` is compose
admitting the repo is bigger than what it deploys, so uncovered app roots are
surfaced. Scoped via `Discovery.rootContextNarrowed`, false for every ordinary compose
repo, which keeps the six reference gates byte-identical (asserted directly).
Fixture: 2 services → 9 + redis, 0 modules.

**r82 — merge the halves of a product, not four products that share a tier word.**
`frontend` counted as a NAME, so `frontend-marketing/-ace/-forms/-brain` collapsed into
one card — five apps shown as one. Tier words say which LAYER, not which THING;
dropping them leaves the product, so `frontend-brain` + `backend-brain` merge (what the
owner asked for) while the others stand apart. A second cause: rail rows fell through
to fuzzy TITLE matching, now replaced by the plain tree's own `sourceRefs`.

**r83 — a Process click could leave the board permanently dimmed.** `pinnedNodeId` was
written on every row click and read only by the guard that refuses to clear, and never
reset. Three ways out now (same row again, Escape, pane click), with the pin derived
from the store so rail and board cannot disagree.

**r84 — the pairing is DRAWN.** A directed backend → frontend link in its own `pair`
family, animated with a distinct dash. It is the one edge not lifted from a scan, so
its honesty rules are the tests: only between a merged card's own roots, only one
backend + one frontend, and only when no measured edge exists (a real call always wins
and is drawn as itself). Its meaning is a header chip, not a mid-line label — the edge
SVG paints beneath the part cards, found by looking at the capture.

**r85 — icon-native, smaller, customizable.** Collapsed strip 52 → 40px with the words
moved to title/aria; chat leads it as the way in; rail default 248 → 196 with the
dragged width remembered and clamped on read; a `+` on the composer offering five
grounded prompt skills that FILL the composer and never send.

**r86 — a mutation sweep over the above** found two guards nothing was testing (the
full tier stop-list, and the rail's paired flag). Both now locked.

**Gate at r86:** `pnpm -r build` clean · web vitest **870/870** (84 files) · node schema
243/243, acp 15/15, ink 15/15, export 33/33, analyzer 428 pass / **5 fail = the known
pre-existing ai-server five** · e2e switch-repo / impact-shots / learn / process-shots /
process-escape / pairing / ui-pass ALL PASS.

**Still owner-facing:** the Task Board screenshot remains blocked on the tldraw
licence decision (`VITE_TLDRAW_LICENSE_KEY` unset → production watermark). Per the
licence text, production use needs a trial or commercial key regardless of the
watermark; development is free.

**r94 — the owner's Polarity batch, plus what the screenshots caught after.** Four
asks, delivered by four scoped agents with disjoint file ownership (per-surface CSS
sheets split first, so nobody raced on the 3,000-line `styles.css`):

- **Polarity only.** *"Lumens: the selectable? No, no selectable, just straight
  polarity."* Lumen is deleted, not hidden — `data-skin` no longer exists anywhere,
  and Polarity's radii, sunken node fill and pressable controls are the baseline
  `:root` contract. Five skin tests deleted, not weakened; the r92 LIKE that asked
  for a toggle is recorded as superseded in `owner-feedback-log.md` rather than
  quietly dropped.
- **Programs is AI-driven.** *"I want to kill acb lpc… just straight buttons that
  they can click, like 'Add this feature'."* A/C/B/L/P/S/E and the Nodes list are
  gone; five named intents each hand the assistant a prompt naming the program.
- **Composer tokens.** Picking a `+` action attaches a ✓ chip; the prompt is composed
  at send, not dumped into the textarea.
- **MADR left to right.** Depth columns over the real inner edges, every row stating
  its connection in words. It is the default view.

**Two defects only the SHOTS caught, after every suite was green.** This is the
round's real lesson and it belongs next to r89's.

1. The Schema service card read **"Top Level" three times**. Those modules sit in the
   service root, so `clusterDir` is undefined and the r88 collision walk had no
   directory to climb — it gave up *silently*, which is the same failure shape that
   cost three rounds on the compose bug. They are now named after their ANCHOR: the
   member the rest of the service depends on most, by the PageRank already computed.
   The card reads **Board / Domain / Program**. When there is no anchor, or the
   anchors collide too, the duplicate label stands — an honest duplicate beats
   "Top level 2", which is a number pretending to be a name.
2. The flow rows rendered **"buil…", "pro…", "mkP…"**. Badge, name and connection
   text shared one 200px line and the names lost. **Ellipsis is deliberate truncation,
   so the audit passed it** — the legibility rules cannot see this class of defect at
   all, only the picture can. Names now own their own line; the kind DOT is gone (the
   badge beside it said the same thing in letters); a single-root component no longer
   lists itself inside its own breakout.

**Two new legibility stops**, closing gaps the agents flagged themselves: the
chip-attached composer and the Programs pane. Both were shipped surfaces with no
stop, and a surface with no stop is a surface nobody is checking.

**Two e2e scripts asserted contracts the product deliberately no longer has** —
`ui-pass.mjs` ("picking one FILLS the composer") and `program-shots.mjs` (clicking a
palette letter). Both were rewritten to assert the NEW contract, not deleted for
being inconvenient.

**Gate at r94:** `pnpm -r build` clean · web vitest **938/938** (88 files) · node
schema 243/243, acp 15/15, ink 15/15, export 33/33, analyzer **460 pass / 5 fail =
the known pre-existing five** (37/38 ai-server generate, 43 provider-cap, 324/325
metering) · e2e switch-repo / learn / process-shots / process-escape / pairing /
module-desc / ui-pass / impact / scratch / acp / program-run / workflow-snapshot ALL
PASS; risks-shots still fails by design · **legibility LEGIBLE across 15 stops** on
the real Sequence monorepo.

**r95 — closing the open queue, seven agents wide.** `docs/HANDOFF.md` §8 listed
everything still owed. This round works it, with per-surface CSS sheets split
first (`rail`, `board`, `edges`, `interior`, on top of r94's `composer`,
`programs`, `madr`) so seven concurrent agents could not collide in the shared
sheet.

**Part 1 (084aa97).**

- **Mermaid reads as a story.** Participants were emitted two-bucket
  alphabetical, so leaf services sat ahead of the gateway that actually fans
  out. No volume cap existed at all. Self-calls were dropped by the shared
  `projectEdges` dedup before the generator ever saw them. `order.created` and
  `order-created` collided onto one actor id. A `;` in a label split the
  document into a broken second statement. An empty graph emitted a bare header
  that reads like a bug. All six fixed; the cap is now stated in the output
  (`%% 40 of 45 calls shown`) rather than applied silently.
- **Functions as mini-services.** A function in the breakout opens as a small
  service — file as body, callers in, callees out, boundary crossings kept
  separate. `ComponentInterior` aggregates boundary edges at the component
  level and never retains which inner part originated a crossing, so
  per-function boundary attribution is **not recoverable from the data**; the
  panel says so instead of inventing it.
- **Board start-to-end flow.** Tiers by real call depth with visible lane
  headers. Two rounds of correction: the first hugged the left third of the
  canvas and grew one 7-card column toward the bottom edge. Lanes now wrap to
  roughly square blocks and use ~84% of the width.
- **"Not connected" → "No calls detected".** Seven of ten cards land in the
  trailing lane on this monorepo, which is *true* — Sequence is libraries, not
  services — but "Not connected" reads as breakage to a first-timer. The
  narrower fact is the honest one. Changed at the source in `boardFlowOrder.ts`,
  not as a display-only rename.
- **fn-comm precision.** Imports were file-granular: a callee name was matched
  against every function in every imported module, ignoring which symbols the
  import actually named. `ImportFact` never captured specifiers. Server
  attribution always resolved to the function enclosing the *registration*
  call, because `RouteFact` had no handler field. Both fixed; namespace and
  default imports stay coarse and are LABELLED coarse rather than pretending to
  precision, and an unresolvable handler degrades to the registration site with
  a stated ambiguity — the `takeAmbiguity` pattern from the compose scanner,
  because silence is the failure mode that cost three rounds.
- **Programs.** The panel was the majority of the pane and the graph the
  minority — backwards for a surface whose value is the graph. Note nodes added
  as annotations that never execute, locked by tests that a note changes
  neither step count nor validity.
- **Pending-change risk.** Risk is an output of editing now, not a standing
  list — which is exactly why the old panel was dropped in v21. Severity derives
  from the SPOF fraction the shipped advisor already uses; a node with no
  dependents yields zero rows, not filler.
- **Edges got craft.** Per-family arrowheads sized to the stroke; shape carries
  what colour could not add without growing the legend (a queue edge gets a
  hollow chevron because nothing *lands*); curvature flattens where a path would
  overshoot its own card; one opacity vocabulary for hierarchy, reusing the
  existing gated keyframes. An uncertain or import edge never animates —
  marching a guess would present it as observed traffic.

**Two findings worth more than the features.**

1. **The edge work does not reach the main board.** `GroupedCanvas.tsx` never
   registers `edgeTypes`, so the Architecture surface draws React Flow's default
   markers; `AggEdgeComp` mounts only inside the Learn tour, and
   `DesignEdgeComp`'s host is not wired into the mode router at all. A feature
   can be built, tested, and green while living somewhere the user never looks —
   precisely what `docs/feature-honesty.md` exists to catch.
2. **A legibility stop was passing vacuously.** The `component-breakout-expanded`
   stop clicks `[data-testid="madr-breakout-expand"]`, which does not exist —
   the real testid is `madr-breakout-promote`. The stop has therefore been
   auditing the *unexpanded* panel twice and reporting OK. A stop whose drive
   silently no-ops is worse than no stop, because it reads as coverage. Found by
   an agent noticing two identical screenshots, not by any rule.

**Part 2 — the queue is closed, and the gate got three new eyes.**

Everything `docs/HANDOFF.md` §8 still owed now ships: shadcn (as Radix primitives
skinned with our tokens, adopted on one surface as proof), the copilot's live
steps, pending-change risk, the Task Board's first screenshot and stop, the
process rail's tested explore split, and middle-truncation — which emptied the
gate's `KNOWN` list for the first time since it was built.

**Three defects the round found in itself, each invisible to every rule we had.**

1. **A gate stop was passing vacuously.** `component-breakout-expanded` clicked
   `[data-testid="madr-breakout-expand"]`, which does not exist — the control is
   `madr-breakout-promote`. `maybeClick` swallows a miss by design, so the stop
   audited the *unexpanded* panel a second time and reported OK for rounds. The
   only symptom was two byte-identical screenshots. It now waits for
   `.madr-breakout-promoted`, so a drive that misses its state fails.
2. **Built, tested, green, unreachable.** The round's edge craft rendered
   nowhere: `GroupedCanvas` passed no `edgeTypes`, so the board drew React Flow's
   stock markers. Separately `mode === 'design'` fell through to the plain board,
   so two live buttons promised Design mode and silently did not deliver.
3. **The feedback log asserted a fix that never shipped.** r93 recorded the
   "cream canvas" as done. It was not: `<ReactFlow colorMode="dark">` was
   hardcoded, and React Flow's own `<Background>` painted an opaque `#141414`
   rect *between* our correctly-cream ground and the cards. The token work was
   never wrong — it was covered. Two rounds of a gate built to catch unreadable
   surfaces reported LEGIBLE over a solid black board.

**Why #3 could not be caught, and what now catches it.** The contrast rule
compares a TEXT node against its own background; a bare ground has no text
sitting on it, so the largest surface in the product sat outside every rule.
`ground-mode-mismatch` checks the property directly — a large, effectively
opaque area must not be near-black under `data-mode="light"` or near-white under
`dark`. Proven by reintroducing the bug and watching it name the element. Writing
it also exposed dead code in an existing rule: `el.tagName === 'SVG'` never
matched anything, because SVG reports a lowercase tagName — and the offender was
an `<svg>`.

**Two more rules, same round.** `truncated-control` fires when an interactive
element's own label is clipped, including by an ancestor's `overflow` — the case
that let "Import selected" render as "Import selec…" while the sweep reported
clean, because ellipsis is *deliberate* truncation and no rule compared a control
to its ancestors. And a `colorEmojiGuard` unit test, after the owner pointed out
that a literal `📁` renders at fixed colours and stayed yellow on cream: the
glyph is now a token-coloured icon, and the guard makes the class uncatchable-again.

**Owner's contrast pass, measured not eyeballed.** Cards were tuned for graphite:
canvas-to-fill 1.05:1, fill-to-border 1.03:1 — a card and its ground computationally
the same colour. Two real causes: `--node-fill` sat above `--canvas` on light
variants, and an r93 rule at specificity (0,2,0) silently outranked r94's Polarity
contract at (0,1,0), so light mode drew a drop shadow instead of the sunken inset —
file order could never have fixed it. Then the deeper one: `KIND_COLOR` was a
hardcoded hex table read by four edge components, so the light-mode edge tokens in
`styles.css` had been **dead code since they were written**. Four of six families
were under the 3:1 floor on cream; `import` was under it on *every* variant,
including the dark ones. All 30 family-by-variant combinations now clear it.

**And one regression the gate caught on me.** `impact-shots` passed in the morning
and failed after the flow lanes landed: the breakout pop-up covered the impact
panel's close button and swallowed the click. `placeBreakoutPanel` scored its
candidates against board cards only, and the impact panel is fixed chrome, not a
node — the collision was latent and the relayout exposed it. Fixed by teaching
placement to avoid reserved chrome, not by raising z-index, which would have made
the click land while leaving a live control buried under a popup.

**Gate at r95:** `pnpm -r build` clean · web vitest **1090/1090** (101 files) ·
schema 243, acp 15, ink 15, export 42 · analyzer **467 pass / 5 fail = the known
pre-existing five** · all twelve e2e suites plus `taskboard` and
`workflow-snapshot` PASS · **legibility LEGIBLE across 16 stops** on the real
Sequence monorepo, `KNOWN` list empty.
