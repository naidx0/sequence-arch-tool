# Mega-plan requirement audit (living)

**Status:** living evidence map · **Tip branch:** `main` · **Tip commit:** `e51631e0`  
**Plan:** [`v2-next-phase-mega-plan.md`](v2-next-phase-mega-plan.md)  
**Rule:** no invented M1–M7 % or bakeoff wins. OWNER rows stay empty until Max fills them.

## Agent code lane (merged to main — PR #141)

**All agent-buildable mega-plan code rows are LANDED** on `main`. The program goal remains **open** until OWNER rows below have evidence.

**Post-merge docs:** HANDOFF tip-bump (`docs/HANDOFF-AGENT-RESTART.md`) landed in `3f8773a9` follow-up / this lane.

**Local verification (tip):**

| Gate | Result |
|------|--------|
| `pnpm test:ci` | 112/112 |
| `pnpm --filter @sequence/web2 test` | 1976/1976 |
| `e2e/browser-pane.mjs` | 4/4 (Chromium) |
| `e2e/terminal-pane.mjs` | green (Chromium + fixture repo) |

GitHub Actions CI may be red on **billing** (0 runner steps) — see plan §0.1.

## How to read

| Status | Meaning |
|--------|---------|
| LANDED | Code + locking test (or research Done when) on this branch |
| PARTIAL | Meaningful start; named gap remains |
| OPEN | Not evidenced |
| OWNER | Requires owner dogfood / keys / ops / tip-bump docs lane |

---

## Phase A

### A0 — Program hygiene

| ID | Status | Evidence |
|----|--------|----------|
| A0.1 | LANDED | HANDOFF paste block points at mega plan (post-merge docs lane) |
| A0.2 | LANDED | Branch `mxcr/phase-a-trust-speed-3669` / PR #141 |
| A0.3 | LANDED | `trajectoryStore.askMetrics` + `ask-metrics-trajectory.test.ts` |
| A0.4 | PARTIAL | Template [`phase-a-dogfood-scorecard.md`](phase-a-dogfood-scorecard.md) — OWNER fills live rows |

### A1 — Session ↔ Architecture

| ID | Status | Evidence |
|----|--------|----------|
| A1.1 | LANDED | `scratchSession` / boardSeqd rebuild path |
| A1.2 | LANDED | boardSeqd hydrate/PUT wired |
| A1.3 | LANDED | Dead claims removed with A1.2 |
| A1.4 | LANDED | `SessionsPanel` + `sessions-arch-scope` test |
| A1.5 | LANDED | `boardSeqdSession.test.tsx` New-chat empty |
| A1.6 | LANDED | scratch migration on upgrade |

### A2 — Design-ask latency

| ID | Status | Evidence |
|----|--------|----------|
| A2.1 | LANDED | `designDrawBaseline` + `phase-a-metrics-harness.md` (canned; M1 live = OWNER) |
| A2.2 | LANDED | `DESIGN_DRAW_ASK_TOOL_ROUNDS` / `isDesignShortPathAsk` |
| A2.3 | LANDED | once-per-turn topology/canvas |
| A2.4 | LANDED | parallel independent reads |
| A2.5 | LANDED | per-turn tool result cache |
| A2.6 | LANDED | design-path evidence trim |
| A2.7 | LANDED | Round k/n UI |
| A2.8 | LANDED | stall / provider-slow notice |
| A2.9 | LANDED | Settings design-model hint |
| A2.10 | LANDED | ask-tool-loop design-draw ≤2 rounds + baseline harness |

### A3 — Output honesty

| ID | Status | Evidence |
|----|--------|----------|
| A3.1 | LANDED | `ask-honesty` fixtures + corpus tests |
| A3.2 | LANDED | soft/unknown kind coerce |
| A3.3 | LANDED | settled theater |
| A3.4 | LANDED | `chatBoardIntegration` auto-open |
| A3.5 | LANDED | prompt refusal examples |
| A3.6 | LANDED | `m3m4Reporter` + CLI report |

### A4 — Workspace chrome

| ID | Status | Evidence |
|----|--------|----------|
| A4.1 | LANDED | workspace equal-pane resize |
| A4.2 | LANDED | `chromeTabModel` localStorage widths |
| A4.3 | LANDED | `.node:focus-visible` composed ring + `NodeCard` is `<button>` |
| A4.4 | LANDED | Investigation [`a4-soft-session-switch.md`](a4-soft-session-switch.md) — keep reload |
| A4.5 | LANDED | sessions title-card (#139) |
| A4.6 | LANDED | Settings sidebar + body (#139) |

### A5 — KINDS / descriptions

| ID | Status | Evidence |
|----|--------|----------|
| A5.1 | LANDED | detailed whatItDoes soft-warn |
| A5.2 | LANDED | LOD subtitle boost |
| A5.3 | LANDED | `roleIconMap` cache/queue/gateway/vault |
| A5.4 | LANDED | `board-legend-hint` “same box, different icon” |
| A5.5 | LANDED | draw + ghost drag regression |

### A6 — Watch / scan

| ID | Status | Evidence |
|----|--------|----------|
| A6.1 | LANDED | rescan progress / `scanProgressModel` |
| A6.2 | LANDED | Spike [`a6-path-scoped-cache-spike.md`](a6-path-scoped-cache-spike.md) (W1.4 per-part already) |
| A6.3 | LANDED | Per-part cache + A6.1 progress + `repoWatch` debounce (`REPO_WATCH_DEBOUNCE_MS`) |

### A7 — Exit

| ID | Status | Evidence |
|----|--------|----------|
| A7.1 | OWNER | Scorecard empty until dogfood week |
| A7.2 | OWNER | Owner walk video |
| A7.3 | LANDED | Merged to `main` PR #141; HANDOFF + AGENTS tip-bump (post-merge docs lane) |

---

## Phase B

| ID | Status | Evidence |
|----|--------|----------|
| B1.1–B1.2 | LANDED | `askIntent` + draw early-exit / caps |
| B1.3 | LANDED | `resolveUnproductiveRoundLimit` — explore=3, else=2 |
| B1.4 | LANDED | edit early-exit + once-per-turn propose_files |
| B1.5 | LANDED | [`ask-control-flow.md`](ask-control-flow.md) |
| B2.1–B2.4 | LANDED | forced final, native tools, instructionHash, ASK_TOOL_REGISTRY |
| B3.1–B3.4 | LANDED | memory inject, trim honesty, Rewind, ContextRing |
| B4.1–B4.2 | LANDED | Review diffs + Accept/Deny + store sync |
| B4.3 | LANDED | ReviewPane line comment → composer (`ReviewPane.test` lock 3) |
| B5.1–B5.3 | LANDED | hooks honesty, autonomy matrix, denyStreak |
| B6.* | OWNER | [`phase-b-bakeoff-scorecard.md`](phase-b-bakeoff-scorecard.md) empty |
| B7.* | OWNER | p50 / soak / tip-bump |

---

## Phase C

| ID | Status | Evidence |
|----|--------|----------|
| C1.* | LANDED | Terminal PTY/pipe, pane, e2e; removed from UNSHIPPED |
| C2.1 | LANDED | [`c2-browser-done-when.md`](c2-browser-done-when.md) |
| C2.2 | LANDED | MCP Settings GET/PUT `/api/mcp` + Workspace editor + add-server form |
| C2.3 | LANDED | manifest + `GET /api/plugins` + `call_plugin` ask (`askWired: true`, builtin `ping`) |
| C2.4 | LANDED | [`c2-browser-security-review.md`](c2-browser-security-review.md) |
| C2.5 | LANDED | `POST /api/net-fetch`, ask `fetch_url`, `BrowserPane`, browser pill, composer control; `e2e/browser-pane.mjs`; SSRF locks in `live-research.test.ts` + `netFetchEndpoint.test.ts` |
| C3.1 | LANDED | [`c3-desktop-inventory.md`](c3-desktop-inventory.md) |
| C3.2–C3.5 | OWNER | Public CTA / notifications / signing |
| C4.1 | LANDED | flow playback + `--seq-dur-cam` hop ease |
| C4.2 | LANDED | Wave 6 nesting CUT (no reopen) |
| C4.3 | LANDED | board→rail card highlight |
| C5.1 | LANDED | Terminal ships with honest CTA (`d4WorkspaceCtaHonesty.test.ts`); Desktop download CTA stays OWNER (C3.2/D7) |
| C5.2 | LANDED | Browser ships as tool+panel (not fake Chrome); `d4WorkspaceCtaHonesty.test.ts` |

---

## Phase D

See [`phase-d-public-beta-gate.md`](phase-d-public-beta-gate.md).

| ID | Status | Evidence |
|----|--------|----------|
| D4 code | LANDED | Browser + Terminal pills; `fetch_url`/`call_plugin` belt honesty; `d4WorkspaceCtaHonesty.test.ts`; MCP Settings copy fixed in `askTools.ts` |
| D4 owner walks | OWNER | Seat walk videos per `feature-honesty.md` |
| D1–D3, D5–D8 | OWNER | Scorecards, marketing, desktop, HANDOFF tip-bump |

## Scorecard fill path (no invented numbers)

1. Harness: `node tools/bench/phase-a-metrics-report.mjs` — [`phase-a-metrics-harness.md`](phase-a-metrics-harness.md).
2. Live asks → `.sequence/trajectory/<runId>.json` → `askMetrics`.
3. Paste measured numbers into [`phase-a-dogfood-scorecard.md`](phase-a-dogfood-scorecard.md) — never canned wallMs as M1.

## Explicitly unfinished for goal-complete

**OWNER-only (no further agent code on this branch until filled):**

| Area | Rows | What Max / docs lane must do |
|------|------|------------------------------|
| Metrics | A0.4, A7.1, D3 | Run dogfood week; paste measured M1–M7 into [`phase-a-dogfood-scorecard.md`](phase-a-dogfood-scorecard.md) |
| Bakeoff | B6.*, B7.* | Run shopfront game; fill [`phase-b-bakeoff-scorecard.md`](phase-b-bakeoff-scorecard.md) |
| Walks | A7.2, D1–D2, D4 owner | Seat walk videos per [`feature-honesty.md`](../feature-honesty.md) |
| Desktop / marketing | C3.2–C3.5, D5–D7 | Clone-only CTA or signed assets; ops |
| Tip-bump | A0.1, A7.3 | HANDOFF + AGENTS updated — CLAUDE optional follow-up |

Do **not** mark the mega-plan goal complete until every plan checkbox is LANDED or OWNER-filled with evidence.
