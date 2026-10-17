# Sequence v2 — next-phase mega plan (post-MVP)

**Status:** living executable program · **Created:** 2026-08-27 · **Owner:** Max  
**Tip at authoring:** `079e890b` (PRs #137 sessions/theater mega + #138 seat salvage + #139 board-leak / rail / settings)  
**Delivery format:** agency-loop mega branches on `packages/` / `tools/` as needed; **this doc is research lane** — tip-bump HANDOFF/AGENTS/CLAUDE only after merges (merge-lanes).  
**Supersedes for “what next after MVP dogfood”:** informal chat analysis + `/opt/cursor/artifacts/sequence_v2_next_phase.md`. Does **not** replace [`FINISH-OPEN-PHASE-PLAN.md`](../FINISH-OPEN-PHASE-PLAN.md) (P0–P8 finish stubs) — this plan is the **product quality / competitive / expansion** layer **on top of** a working MVP.

---

## 0. One-page verdict

| Question | Answer |
|----------|--------|
| Do we have an MVP? | **Yes.** Attach/scan → sessions → ask → Architecture ghosts → Accept → Review. Local-first scan/board without a key. |
| Private dogfood? | **Yes, with eyes open** — after #139 trust fixes; still slow asks + output leaks. |
| Public beta? | **No** until Phase A metrics green + honesty/desktop gate. |
| What is the next version about? | **Trust, speed, measurable output quality, then surfaces** (terminal / browse / desktop) — not another visual redesign. |
| Moat we must not abandon | Grounded architecture graph + visual Accept/Deny. Graphs that are “pretty only” die; graphs inside the ask/edit loop survive (Codemaps lesson). |

**Owner product law for this program:** do not turn a blind eye to competitors. Borrow mechanisms (token budgets, routers, checkpoints, subagents, PTY, rewind) when they make *our* loop faster and more honest. Never claim “beats LangGraph / Claude Code” without a named bakeoff row.

---

## 0.1 Branch execution status (`mxcr/phase-a-trust-speed-3669` · PR #141)

**Tip (agent code lane):** `20c4a662` · **Living evidence map:** [`mega-plan-requirement-audit.md`](mega-plan-requirement-audit.md)

| Phase | Agent-buildable code | Still OWNER (blocks goal-complete) |
|-------|----------------------|-------------------------------------|
| **A** | A0.2–A0.3, A1–A6, metrics harness — **LANDED** | A0.1 HANDOFF tip-bump; A0.4 / A7 live M1–M7 scorecard + owner walk |
| **B** | B1–B5 — **LANDED** | B6 bakeoff script rows; B7 p50/soak |
| **C** | C1 Terminal, C2 browse/MCP/plugins, C4.*, C5.1–C5.2 — **LANDED** | C3.2–C3.5 desktop public CTA / signing / notifications E2E |
| **D** | D4 code honesty (Settings, pills, composer, ask belt) — **LANDED** | D1–D3 walks + metrics weeks; D5–D8 ops / sign-off |

**Local gates (tip):** `pnpm test:ci` 112/112 · `@sequence/web2` vitest 1976/1976 · `e2e/browser-pane.mjs` + `e2e/terminal-pane.mjs` green when Chromium present.

**CI note:** GitHub Actions may fail with billing/spending-limit (0-step jobs) — not a code regression on this branch.

**Do not mark the program goal complete** until OWNER rows above are filled with measured evidence (no invented M1–M7 % or bakeoff wins).

---

## 1. Competitive borrow register (keep eyes open)

Every row is **steal the mechanism**, not copy the product. Cite where Sequence should land the borrow.

### 1.1 LangGraph / LangChain — token & latency saving (owner callout)

| Borrow | Why it wins | Sequence landing |
|--------|-------------|------------------|
| **Not every step is an LLM call** | Deterministic routers / Python branches cut rounds | `askPipeline.ts`: design-mode & “draw X” → short path (salvage/propose) without 8 full provider rounds |
| **Explicit graph vs ReAct soup** | Linear `router → tool → synth` beats open loops for common paths | Named stop reasons + forced-answer round (ml-harness already teaches this) |
| **Parallel independent tools** | Fan-out when tools don’t depend | When model requests multiple reads, execute parallel where safe |
| **Cache tool results** | Same `read_file` / search signature shouldn’t re-hit disk | Per-turn tool result cache keyed by (name, args hash) |
| **Less context in each call** | Latency ∝ input tokens | Carry evidence ledger already exists — harden trim/summarize; don’t re-dump full graph |
| **Measure rounds / cost / wall** | “Slow” is usually tool or round count | Trajectory + UI: show round #, tokens, wall; dogfood scorecard §3 |
| **Checkpoints / thread_id** | Resume without re-paying history | Session chat v2 + checkpoints exist — wire UX; don’t invent LangGraph store |

**Anti-claim:** Do not invent “50% cheaper than LangGraph.” Measure our own p50/p95 ask wall and round counts.

### 1.2 Claude Code

| Borrow | Landing |
|--------|---------|
| Subagent isolation (don’t pollute main transcript) | Later: explore-only subcalls with summarized return — not Phase A |
| `/rewind` checkpoints | Checkpoint routes exist — seat UX for restore |
| Worktree isolation for parallel work | `gitWorkspace` — Activity territories partial |
| Hooks that actually fire | Settings hooks — audit honesty (P1 StopLying spirit) |
| Terminal-native speed | Phase C: real PTY (current terminal is pipe-shell) |

### 1.3 Cursor / Windsurf / Codemaps

| Borrow | Landing |
|--------|---------|
| Graph as free feature inside workflow | Keep Architecture primary; never orphan the board from ask |
| Multi-pane IDE chrome | Phase A: pane resize; pills already toggle |
| Background indexing feel | Phase A/B: progress on rescan; don’t block chat on 7–8s full invalidate (engine G16) |

### 1.4 ml-harness (internal reference — [`ml-harness-adoption.md`](ml-harness-adoption.md))

| Borrow | Landing |
|--------|---------|
| Provider-native tool calling (not prose fences only) | Phase B: structured tools when provider supports |
| Named turn endings + forced final answer | Phase B: never silent after tool-only round |
| Instruction fragments + hash version | Phase B: prompt version stamp on trajectory |
| Durable event log / replay | Phase B aspirational — SSE ids |

### 1.5 System-design / diagram apps

| Borrow | Landing |
|--------|---------|
| Ghost drag, clear KINDS | Partially landed #138/#139 — keep icon≠chassis discipline |
| Collaboration / multiplayer | Out of scope this program |

---

## 2. Measurement scorecard (instrument before claiming)

Run for **≥2 weeks dogfood** or **N≥50 design-draw asks**, whichever first. Store in trajectory / a `tmp-shots/metrics/` or Activity export — do not invent numbers.

| ID | Metric | How | Dogfood target | Fail → |
|----|--------|-----|----------------|--------|
| M1 | Ask wall time (design “draw/show on board”) | Turn elapsed + provider spans | p50 &lt; 45s, p95 &lt; 2m | Cap rounds; change default model path |
| M2 | Tool rounds per design-draw | Count provider rounds in askPipeline | ≤ 2 for clear draw asks | Short-circuit path |
| M3 | Output honesty | % turns with visible raw tool/seqd JSON | &lt; 5% | Expand salvage + locking dumps |
| M4 | Board open rate | % draw asks that open Architecture without click | ≥ 90% | Salvage + auto-open |
| M5 | Session trust | New chat empty board; title summary; timer = last prompt | 100% on rebuild sample of 20 | Regressions on #139 |
| M6 | Time to useful board | Shopfront fixture attach → readable graph | &lt; 60s | Scan/cache work |
| M7 | Preference probe | Weekly owner: “prefer Sequence for architecture vs Claude Code?” | Honest yes for topology tasks | Revisit moat narrative |

**Latency doctrine (LangGraph-aligned):** measure **LLM time vs tool time vs round count** separately. Fix the dominant term first.

---

## 3. Phase A — Trust & speed (EXECUTE FIRST)

**Goal:** Dogfood no longer feels “broken on trust or waiting.”  
**Exit:** M1–M5 green on a named dogfood week; locking tests for every A.* row that ships code.

### A0 — Program hygiene

- [ ] **A0.1** Tip-bump HANDOFF paste block to point at this mega plan (docs lane only, after first A merge).
- [ ] **A0.2** Open one mega PR branch `mxcr/phase-a-trust-speed-3669` (or wave slices with disjoint may-touch).
- [ ] **A0.3** Add metrics harness skeleton: log `{wallMs, rounds, inputTokens, outputTokens, stopReason, designMode}` per ask to trajectory / debug endpoint.
- [ ] **A0.4** Owner scorecard sheet (spreadsheet or Activity export) for M1–M7.

### A1 — Session ↔ Architecture honesty

**Owner quote:** new chat must not load last chat’s board; session is the unit of memory.

- [ ] **A1.1** Verify #139 scratch/`activeId` on a clean rebuild (manual + `scratchSession.test.tsx`).
- [ ] **A1.2** **Wire `boardSeqd`:** GET session → hydrate DocProvider; Accept/edit → PUT; createSession starts empty.
- [ ] **A1.3** If A1.2 deferred: **delete or hide** dead `boardSeqd` API claims in client comments — no lying fields.
- [ ] **A1.4** Repo-attached: distinguish **scan projection** (shared) vs **session overlays** (proposals/scratch) in UI copy.
- [ ] **A1.5** Locking test: session A Accept → session B New chat → Architecture empty / different doc id.
- [ ] **A1.6** Migrate any remaining `sequence.arch-scratch.workspace` leftovers on upgrade.

**Inverted-fix ban:** do not “fix” leak by hiding Architecture tab on New chat.

### A2 — Design-ask latency (LangGraph token/round saving)

**Owner quote:** 7 minutes for a simple draw is unacceptable.

- [ ] **A2.1** Measure baseline: 20 scripted design draws (shopfront + blank workspace) → M1/M2.
- [ ] **A2.2** **Design short-path:** if `designMode` + draw intent (`isShowOnBoardAsk`), clamp `maxRounds` to 1–2.
- [ ] **A2.3** **One write per surface per turn** (propose_topology once; canvas.write_* once) — stop redraw storms.
- [ ] **A2.4** Parallelize independent read tools when multiple requested in one round.
- [ ] **A2.5** Per-turn **tool result cache** (name+args hash) — LangGraph-style.
- [ ] **A2.6** Trim carried evidence harder on design path (less context → less latency).
- [ ] **A2.7** UI: show “Round k/n · Xs” live (perceived latency).
- [ ] **A2.8** Provider timeout / stall notice (honest: “provider slow”, not “board broken”).
- [ ] **A2.9** Default model guidance in Settings: recommend faster model for design sketching.
- [ ] **A2.10** Locking tests: design-draw fixture completes ≤2 rounds in harness with canned provider.

**Inverted-fix ban:** do not fake speed by skipping salvage so JSON dumps return.

### A3 — Output honesty (no word-print tool dumps)

**Owner quote:** tool UI instead of straight JSON print; diagram must open.

- [ ] **A3.1** Corpus of owner dumps (`process-sequence`, bare nodes, fenced json) as golden strip/salvage fixtures.
- [ ] **A3.2** Coerce unknown seqd `kind` (already) + soft node kinds where safe.
- [ ] **A3.3** Settled theater always when topology work/tools present (landed).
- [ ] **A3.4** Auto-open Architecture on proposal; AI Canvas on new landed blocks (landed) — regression suite.
- [ ] **A3.5** Prompt: NEVER paste bare JSON; ask compact vs detailed once (landed) — strengthen with refusal examples.
- [ ] **A3.6** Metrics M3/M4 dashboard or test reporter.

### A4 — Workspace chrome smoothness

- [ ] **A4.1** Drag-resize between equal workspace panes (reuse shell resizer patterns).
- [ ] **A4.2** Persist pane widths per workspace session (local).
- [ ] **A4.3** Click-focus ring already — ensure keyboard/a11y focus matches.
- [ ] **A4.4** Soft session switch investigation: reload-only vs hydrate-in-place (document tradeoffs; implement if safe).
- [ ] **A4.5** Sessions rail title-card hierarchy regression (#139).
- [ ] **A4.6** Settings sidebar + one scrolling body regression (#139).

### A5 — KINDS / descriptions reliability

- [ ] **A5.1** Compact vs detailed: if user says detailed, require `detail.whatItDoes` on ≥80% nodes (server validate soft warn).
- [ ] **A5.2** LOD: show subtitle one rung longer for detailed proposals.
- [ ] **A5.3** Expand roleIconMap (filesystem landed) — cache, queue, gateway, vault patterns.
- [ ] **A5.4** KindLegend copy: “same box, different icon” helper line.
- [ ] **A5.5** Draw mode + ghost drag regression (#138).

### A6 — Engine watch / scan pain (partial G16)

- [ ] **A6.1** Surface rescan progress (don’t spin forever).
- [ ] **A6.2** Research spike: path-scoped cache invalidate vs full tree signature (doc only → A6.3).
- [ ] **A6.3** Implement cheapest win from spike (even if “debounce + progress” only).

### A7 — Phase A exit gate

- [ ] **A7.1** Dogfood week scorecard filled (M1–M7).
- [ ] **A7.2** Owner walk video: New chat empty board + design draw &lt; 2m + theater + Accept.
- [ ] **A7.3** Merge Phase A mega PR; tip-bump HANDOFF to Phase B.

---

## 4. Phase B — Agent loop quality (token-aware, competitor-parity depth)

**Goal:** Ask behaves like a modern harness: fewer wasted tokens, never silent, tools structured when possible.  
**Depends on:** A2 metrics baseline exists.  
**Exit:** Named bakeoff rows vs “our previous self”; no fake vs-Claude-Code claims.

### B1 — LangGraph-style control flow inside askPipeline

- [ ] **B1.1** Classify intent: `draw | explore | edit | chat` (heuristic + optional tiny router model later).
- [ ] **B1.2** Draw path: router → propose_topology/canvas → synth prose (max 1–2 LLM).
- [ ] **B1.3** Explore path: allow more rounds but **unproductive cap** already exists — tune signatures.
- [ ] **B1.4** Edit path: propose_files + diff-first review depth.
- [ ] **B1.5** Document control-flow graph in this file’s appendix when landed.

### B2 — ml-harness ports (high value)

- [ ] **B2.1** Named stop reasons + forced final answer when tools-only (never empty transcript).
- [ ] **B2.2** Provider-native `tools` / `tool_calls` where OpenAI-compatible (keep fence salvage as belt).
- [ ] **B2.3** Instruction fragment hash on trajectory `turn.started`.
- [ ] **B2.4** Tool schema registry single source (name, JSON Schema, UI verb).

### B3 — Memory & context (Claude + LangGraph)

- [ ] **B3.1** Ensure v2 chat memory work/evidence actually injected into next ask prompts.
- [ ] **B3.2** Summarize long threads (token save) with user-visible “memory trimmed” honesty.
- [ ] **B3.3** Checkpoint restore seat UX (list + restore conversation/code/both).
- [ ] **B3.4** `/context`-like chip already (ContextRing) — show breakdown of what filled the window.

### B4 — Diff review depth (Codex/Cursor parity slice)

- [ ] **B4.1** FileEdit proposal: per-file expand diff, not filename list only.
- [ ] **B4.2** Accept/Deny per file.
- [ ] **B4.3** Line-anchored comment → follow-up ask (stretch).

### B5 — Permissions & autonomy honesty

- [ ] **B5.1** Audit Settings hooks fire as claimed; lock tests.
- [ ] **B5.2** Plan / Propose / Auto-edit / Full: one matrix diagram in Settings.
- [ ] **B5.3** Circuit breaker after N consecutive denials (Codex-inspired).

### B6 — Competitive bakeoff (measured, not marketed)

- [ ] **B6.1** Script Game: shopfront “what calls X” / “draw local harness” on Sequence vs Claude Code vs Cursor (owner runs where keys allow).
- [ ] **B6.2** Record token counts, wall time, whether graph was grounded.
- [ ] **B6.3** Update [`named-bakeoff-shopfront.md`](named-bakeoff-shopfront.md) style rows — no invented % wins.

### B7 — Phase B exit

- [ ] **B7.1** Draw path p50 improved ≥30% vs Phase A baseline (or document why not).
- [ ] **B7.2** Zero empty-answer incidents in 50-turn soak.
- [ ] **B7.3** Tip-bump → Phase C eligible.

---

## 5. Phase C — Surfaces expansion (after A green)

**Goal:** Browser / Terminal / Desktop become real — or stay honestly unshipped.  
**Hard rule:** no fake pills. [`workspaceViews.ts`](../../packages/web2/src/app/workspaceViews.ts) `UNSHIPPED` stays until Done when holds.

### C1 — Terminal (real PTY)

**Today:** `/api/terminal` is a **pipe shell**; resize is no-op; no TTY (`v2-architecture-and-gaps` §3).

- [ ] **C1.1** Spike: node-pty / similar in analyzer; security (repo jail, cap 8).
- [ ] **C1.2** Protocol: stdin/stdout + real resize + exit codes.
- [ ] **C1.3** web2 Terminal pane (tab toggle like Architecture).
- [ ] **C1.4** Composer Terminal control enables when shipped.
- [ ] **C1.5** `run_command` / program nodes can show exit code + stdout (engine G11).
- [ ] **C1.6** Locking e2e: echo + resize + exit.
- [ ] **C1.7** Remove `terminal` from `UNSHIPPED` only when C1.3–C1.6 green.

### C2 — Browser / plugins / MCP

- [ ] **C2.1** Define Done when: allowlisted browse tool vs embedded Chromium (prefer tool+panel over fake Chrome).
- [ ] **C2.2** MCP depth already in engine — Settings UI to add servers (honesty if stub).
- [ ] **C2.3** Plugin manifest v0 (read-only tools first).
- [ ] **C2.4** Security review before any net browse.
- [ ] **C2.5** Unship `browser` pill only when C2.1 Done when met.

### C3 — Desktop app

- [ ] **C3.1** Inventory `packages/desktop` build story in cloud vs owner Mac.
- [ ] **C3.2** One-click install path OR honest “clone + start.sh” only on socials.
- [ ] **C3.3** Notifications path (`isDesktop`) end-to-end.
- [ ] **C3.4** Auto-update policy (or explicit none).
- [ ] **C3.5** Code-signing = owner-later (not agent-blocked).

### C4 — Files / rail depth (without Wave 6 nesting)

- [ ] **C4.1** Functions-first click → canvas re-sort (product canon) — audit gaps.
- [ ] **C4.2** Do **not** reopen hierarchical Wave 6 (owner CUT).
- [ ] **C4.3** File view ↔ Architecture selection sync polish.

### C5 — Phase C exit

- [ ] **C5.1** At least one of Terminal or Desktop ships with honest CTA.
- [ ] **C5.2** Remaining pills still say “not shipped” if undone.

---

## 6. Phase D — Public beta gate

**Goal:** Claim public beta only when Seat Gates + metrics + honesty hold.

- [ ] **D1** Rewrite W5 owner walks for **web2** ([`feature-honesty.md`](../feature-honesty.md)).
- [ ] **D2** Seat Gates 1–3 videos current on tip.
- [ ] **D3** M1–M5 green for 2 consecutive weeks.
- [ ] **D4** No lying Settings/CTA copy (free-tier, Browser, Terminal).
- [ ] **D5** Marketing site reconnect or disconnect ghost Vercel (owner ops).
- [ ] **D6** Socials one-liner is a **true** sentence only.
- [ ] **D7** Desktop assets **or** honest clone path only.
- [ ] **D8** Owner sign-off checklist in HANDOFF tip-bump.

**Parked (P8 — owner unpark only):** unrestricted ambient PTY cloud clone; seqd incremental stream; ADR Scratch fold; LoRa; live 200k accuracy %; nightly cron (refused).

---

## 7. Execution protocol (how to run this plan)

1. **Never mix** HANDOFF/AGENTS/CLAUDE into packages PRs (merge-lanes).
2. **CONTEXT DIET** for builders: this plan section + 2–4 code paths + owner-seat-ui rule.
3. Every code todo expands to: Owner quote → Direct problem → User-seat Done when → Inverted-fix ban → Locking test.
4. Prefer **one mega PR per phase** (A, then B, …) unless ownership forces split.
5. **Measure first** on A2 before optimizing the wrong layer.
6. Competitive borrows land as **code + test + scorecard row**, not blog claims.
7. If a todo conflicts with FINISH-OPEN P0–P8 unfinished honesty, **honesty wins**.

### Suggested first builder wave (Phase A kickoff)

| Wave | may-touch | Todos |
|------|-----------|-------|
| A-metrics | `askPipeline`, trajectory types, web2 Activity/debug | A0.3, A2.1 |
| A-boardSeqd | `sessionsClient`, `DocProvider`, `ConnectedBoard`, analyzer sessions | A1.2–A1.5 |
| A-latency | `askPipeline`, `askTools`, design hints | A2.2–A2.6, A2.10 |
| A-chrome | `App.tsx`, `shell.css`, chromeTabModel | A4.1–A4.3 |

---

## 8. Relationship to other living docs

| Doc | Role vs this plan |
|-----|-------------------|
| [`FINISH-OPEN-PHASE-PLAN.md`](../FINISH-OPEN-PHASE-PLAN.md) | Finish stubs / seat gates P0–P8 — still binding for honesty |
| [`v2-architecture-and-gaps.md`](v2-architecture-and-gaps.md) | Engine gap list G* — feed A6/B/C |
| [`ml-harness-adoption.md`](ml-harness-adoption.md) | Reference implementation for B2 |
| [`PIVOT-V2.md`](../PIVOT-V2.md) | Decision of record — graph+Graphite |
| [`archify-competitive.md`](archify-competitive.md) | Visual/architecture competitive read |
| This file | **Post-MVP product quality + competitive + expansion program** |

---

## 9. Appendix — owner seat quotes that bind this program

- Tool UI instead of straight word-print JSON; diagram must open when asked.
- Session name = summary of asks; timer = last prompt not last click.
- New chat must not load previous Architecture.
- Section titles (General / repos) bigger than session rows.
- Settings = sidebar + one scrolling box.
- Same node box for service/module; difference is icon (filesystem cue).
- Multi-pane tabs open/close; want resize.
- 7-minute simple prompt is too long — treat as product defect.
- Do not turn blind eyes to competitors (e.g. Lang token saving).

---

## 10. Changelog

| Date | Change |
|------|--------|
| 2026-08-27 | Initial mega plan from seat walks + competitive analysis + #137–#139 tip |

*Do not stamp git hashes into forever prose beyond tip-at-authoring; tip lives in HANDOFF after tip-bump.*
