# Finish-open phase plan (post–v2 rebuild)

**Status:** living program plan · **Started:** 2026-08-26 · **Owner:** Max  
**Delivery:** **one mega PR** while this program runs (owner 2026-08-26) — do not split every junction into a separate PR. Tip-bump of `HANDOFF` / `AGENTS.md` / `CLAUDE.md` stays a separate docs lane after merge (merge-lanes rule).

Closed PAR / Waves 0–5 / Wave 7 are largely **already on tip**. Canonical closed register: [`OUTSTANDING.md`](OUTSTANDING.md). Owner ruling: **systems layer only** — hierarchical Wave 6 nesting stays **CUT** ([`BUILD-PLAN.md`](BUILD-PLAN.md)).

**Agent run Done (2026-08-26 owner ruling):** functioning app + everything an agent can land for deployment-readiness (honesty docs, no fake installer/CTA, checklists, harnesses). **Not in scope for this agent:** code-signing, funding/deploying gateway, Vercel dashboard clicks, P6 Lane A measurement, P8 unparks — owner does those later when choosing to ship/measure. Cursor “Agent is blocked” setup-action cards for those items were a **misuse** of env-setup tooling; **Cancel or Mark as done** — they are not real blockers.

**On tip (PR #123):** Seat Gates 1–4 + P0–P7 agent batches + ask surface + Plan mode + ACP preflight + Settings facts/doors + start.ps1/HOW_TO_RUN freshness + ACP stub CI lock + P6 Lane B harness (UNVERIFIED) + P7 honesty docs + free-tier Settings “not live yet” + **G3 ask Stop aborts provider fetch + tool loop** (`abortable: true`) + P1 toolbelt door locks. P5 remains PARTIAL on `.gitignore` policy + B7 (not pretended closed). Remotes: `main` + open PR heads (`mxcr/phase-p2-board-agent-3669`, `site/graphite-rebuild`) + one parked brand branch `brand/sheet-14-diff-inspector` (unique tip — owner discard or land; do not silent-prune).

```
P0 TruthOps → P1 StopLying → P2 BoardAgentLoop → Seat1
  → P2.5 WorkspaceChrome (icons / tabs / split)   ← owner mega-vision fold-in
  → P2.6 BoardInteract (nodes / draw / expand)    ← owner photo fold-in
  → P2.7 ChatOutput (diagram land / prose / tools)← owner transcript fold-in
  → P3 Autonomy → P4 Workflows → Seat2
  → P5 EngineWatch → Seat3
  → P6 Claims → P7 ShipBeta → Seat4
  → P8 Unpark (owner only)
```

## P0 — Truth & ops

Tip-bump HANDOFF · prune merged remotes · CI/release-gate truth · Vercel noise · analyzer quarantine (packages/ follow-up, not mixed here).

**P0 batch (2026-08-26):** pruned three stale remote heads with no open PR (`claude-sessions-ledger-35cd`, `code-scratch-create-repo-35cd`, `dropdown-session-density-35cd`). Tip-bump of HANDOFF/AGENTS/CLAUDE stays a separate docs lane after merge. Analyzer CI re-enabled (terminal hang cleared; same-ms session rename bump hardened). **Parked (do not silent-prune):** `brand/sheet-14-diff-inspector` — unique tip, no open PR; owner discard or land with brand/site work. Marketing/Vercel attach is owner later (PR #124 Graphite site).

## P1 — Stop lying

Wire toolbelt (breakdown / what-breaks / start-workflow) · skills honesty or ship · models → Settings · rescan from stale · work-row opens beyond Review.

**P1 batch (2026-08-26):** toolbelt picks ask / Activity / Settings provider; skills Settings copy is honesty (loader real, no fake editor); stale rail Retry → `rescanRepo`; work-row `opens` routes canvas / rail / review via host commands. Locked in `stopLying.p1.test.ts` + Composer/IndexRail/App tests.

## P2 — Board ↔ agent

`WbNodeRef` creatable · whiteboard Generate hand-off · dual-board grounding · fit polish · restored-turn honesty · **headless boot hydrate** (`--repo` → store).

**P2 batch (2026-08-26):** whiteboard link tool creates `WbNodeRef`; Generate hand-off seeds composer (no auto-send); Architecture + whiteboard chips both ground `context.lines`; attach/proposal camera fit; restored-turn honesty in transcript/memory; `ConnectedBootHydrate` settles `--repo` into the store. Locked in Whiteboard / Board / sendPayload / store / transcript tests.

**Seat Gate 1:** shopfront walk covering P1+P2 (one video) — **landed 2026-08-26** (`seat_gate1_shopfront_walk_complete.mp4`: chat-alone boot, Sessions sidebar, Architecture interact, draw toggle, context chip, +→Files rail, Whiteboard). Batch with P2.5–P2.7 in the same mega PR.

## P2.5 — Workspace chrome & tabs (owner mega-vision)

Owner Done when (human seat):

- **Sessions label returns** — worded "Sessions" visible; not icon-only disappearance.
- **Unique section identity icons** — sessions, chat, architecture, whiteboard, files, browser, terminal, AI-canvas each have their own glyph; **one shared minimize (`minus`) icon** on every pane card.
- **One workspace, OpenCode-style tabs** — default opens to **chat alone**; Architecture + Whiteboard available immediately; **+** opens browser / terminal / file view / AI canvas (agent-drawn, not human-editable).
- **Split is flexible** — minimize any pane; split chat+board by default when editing; AI may open at most **three** views at once (chat + two others) without replacing panes. **Board minimise (2026-08-26):** Architecture/Whiteboard shared `minus` docks the pane; dock restores without detaching. **Multi-view (2026-08-26):** `workspaceViews.requestOpen` caps secondaries at board + files; Architecture↔Whiteboard switches in-slot; unshipped / over-cap opens refuse with an on-chrome notice — never displace an open view.
- **Visual-first** — owner intent: propose edits and visual views unless Plan mode (no edits). **Not a separate product lock beyond Plan-mode Settings** — do not claim a dedicated visual-default switch.
- **Blank-workspace sessions** — sessions survive without an attached repo (home / browse-root general sessions; per-repo sections when attached).
- **Repo catalog → attach+switch** — clicking a session under a repo name attaches that repo and reloads into that thread (P2.5, 2026-08-26).
- **+ → Files** — when attached, opens Architecture and expands the index rail (files & functions); browser / terminal / AI canvas stay disabled until shipped.

## P2.6 — Board interactivity (owner photo)

Owner Done when:

- Nodes readable and not clumped / stuck through each other; kinds = **icons** (entry / service / datastore), not many competing card designs.
- Hover float visible mid-air; select→chat chip **names the context tool** and what the model receives.
- Drawing can create/edit boxes; expand-into-node has a clear exit; **Back to systems** does not overlap edgeless/file chrome.

### P2.6 diagnosis (owner photo 2026-08-26)

| Symptom | Where | Root cause | Fix in this batch | Still open |
|--------|-------|------------|-------------------|------------|
| Nodes clump / overlap on attach | `layout.ts` ELK `PITCH`/`LAYER_GAP`; resting `box-shadow` on cards | Spacing too tight (36/56); heavy shadows read as stacked slabs | `PITCH=48`, `LAYER_GAP=72`; resting cards `box-shadow: none` | Seat Gate 1 walk 2026-08-26 |
| Hover “float” invisible | `board.css` `.node:hover` | `-2px` lift + weak shadow on dark `--surface-3` | `-5px` + `--e3` + drop shadow; `z-index: 6` | — |
| Select node → chat unclear | `connect.tsx` ask payload; `Composer.tsx` chips | Not a tool — **grounded ask context** sent as `context.lines`: `node:<id> (<label>)` | Chip badge **context** + tooltip naming payload | Doc in usability walk |
| Too few arrows | `ConnectedBoard.tsx` derived/import edges | Import-only scans are edgeless; derived edges off by default | Auto-enable derived edges on attach when no traced edges | More traced edges when scan supports |
| Drawing “does nothing” | Ink path requires `doc` + pen toggle | Silent no-op without whiteboard doc / mode | Ink note when draw blocked; pen toggle bottom-right on Architecture | Seat Gate 1 video 2026-08-26 |
| Hard to expand / escape | `NodeCard.tsx`; `interiorbar` CSS | Expand was double-click only; bar was top-centre over tabs + edgeless note | Header **expand** icon (`flow`); bar **bottom-left** above furniture | — |
| Competing card designs | `board.css` silhouette rules | Six chassis shapes fought each other | One chassis; kind = icon only (P2.6 prior) | — |

**Naming:** select→chat is **grounded ask context** (chip), not a named agent tool. Payload field: `context.lines[]` on `POST /api/ask`.

## P2.7 — Chat output honesty (owner transcript)

Owner Done when:

- Ask → **diagram / topology lands on the board** (not raw JSON tool blobs in the transcript).
- Prose is clean (no asterisk soup); tool/reasoning blocks use **Cursor-like ASCII loading** with shared type ramp + higher contrast; reasoning only when the model provides it.
- Clarifying-question loops yield to **draw it** when the user says stop asking.

**P2.7 batch (2026-08-26):** analyzer strips bare `propose_topology` JSON from answers and emits `topology:proposal` SSE; web2 topology work row **`opens: canvas`** (bordered affordance below the answer) and auto-switches Architecture when a proposal lands. `isFigureItOutAsk` / `isShowOnBoardAsk` cover "stop asking", "draw it", "map it out", etc.

## P3 — Autonomy

Auto-edit / Full + Settings rules · evidence memory · hooks that fire as claimed.

**P3 batch (2026-08-26):** Settings → Workspace enables Auto-edit / Full (persisted prefs). Composer modes unlock after opt-in. Auto-edit writes `propose_files` through the same jail + `pre-write` hooks as `PUT /api/file` (no Accept). Full keeps `run_command`. Server passes all permission modes on `/api/ask`. Rule algebra already loads `.sequence/permissions.json`. Chat memory **v2** persists work / evidence / coverage across reload (v1 prose files still restore empty). Settings → Workspace **Tool permissions** editor: `GET/PUT /api/permissions` edits the same file text. **Plan mode follow-up:** `PLAN_MODE_INSTRUCTIONS` is injected into streamed asks when Permission=Plan (was built in `@sequence/acp` but unreachable); Settings Planning points at the composer control.

## P4 — Workflows

Start workflow → real program run · curated built-ins · Activity territories / waiting-on-you.

**P4 batch (2026-08-26):** toolbelt **Start a workflow** opens Activity with the author form prefilled from the composer (draft / chips), so Confirm posts `POST /api/program/run` via the existing Activity start path. Curated schema built-ins picker: Activity author lists the five `BUILTIN_PROGRAMS` and Start posts the catalogue Program (not a freeform prompt). **Territories:** Activity reads `GET /api/git/worktrees` + `/api/status` into `territoryView` and renders main/parallel rows (no invented file-ownership conflicts — structural worktrees only). **ACP preflight:** author form probes `GET /api/acp/available` (+ `/api/acp/agents` when available) and shows the engine reason / empty-registry copy before Start — no longer a blind POST that only learns the gate after 403.

**Seat Gate 2:** permissions + workflow pause/resume/notify — **landed 2026-08-26** (`seat_gate2_permissions_pause_resume.mp4`: Workspace Tool permissions without reload, Notifications long-runs copy, Activity UI Pause → Waiting on you → Resume). Built-ins still need a registered ACP agent or a configured AI gateway for a live agent step.

## P5 — Engine watch

`fs.watch` → stale · `.gitignore` / IGNORE_DIRS policy · B7 after P3.

**P5 batch (2026-08-26):** analyzer `repoWatch` (IGNORE_DIRS + `.sequence`, debounce) arms on attach / stops on detach → `markGraphStale`; `/api/status` carries the same stale marker as `/archgraph.json`; web2 polls into `repo/stale` `reason: 'external'` (does not overwrite write-driven stale). Rescan stays user Retry — no auto-rescan. **Still PARTIAL by design:** scanner does not read `.gitignore` (owner product decision, recorded in IGNORE_DIRS); B7 graph-aware permission predicates are not built and not pretended.

**Seat Gate 3:** external edit → stale → rescan — **landed 2026-08-26** (`seat_gate3_external_stale_retry.mp4`: rail “Not tracking · last read …” + Retry → idle).

## P6 — Claims

Owner A/B (Claude Code ± MCP) · **UNVERIFIED** until measured · no fake competitor bars.

**P6 note (2026-08-26):** no competitor chart or scoreboard shipped. Keep claims off socials until the owner runs the A/B. MCP `scan_repo` README no longer stamps a fixed "290k tokens" corpus figure (graph size moves; tool description already warned in megabytes).

**Lane B harness (2026-08-26):** `node tools/p6-claims-ab.mjs` runs the ten §5.5-shaped questions through Sequence MCP tools (`who_calls` / `path_between` / `find_negatives`) and writes an **UNVERIFIED** report with Lane A marked `PENDING_OWNER`. Locked by `tools/ci/p6-claims-ab.test.mjs` (shopfront fixture). Owner still fills Lane A in Claude Code + grep; do not publish bars from Lane B alone.

## P7 — Ship / public beta

Desktop or honest `./start.sh` · rewrite W5 walks for web2 · socials one true sentence · gateway (owner).

**P7 batch (2026-08-26):** [`docs/w5-journeys-web2.md`](w5-journeys-web2.md) — Journey A/B scripts for web2 + the one true socials sentence (clone + `./start.sh` / `.\start.ps1`; no fake installer CTA). README canvas copy corrected for Whiteboard / Graphite (no five-theme / Task Board lie). Pitch §10 + cover rewritten off GitHub Releases / trysequence.app download CTAs. Ask tool placement hint no longer names Task Board. `DEPLOY_CHECKLIST.md` gate commands point at `@sequence/web2`. Follow-up honesty: `HOW_TO_RUN` / README / deploy checklist no longer claim a shipped Terminal tab or live tldraw Task Board blocker; `how-to-verify` points at `@sequence/web2`; workspace `+` → Files is attach-gated (not “not shipped”); ask surface copy names Whiteboard only. Desktop release assets + gateway remain **owner**.

**Seat Gate 4:** cold install → five-verb loop → Review → one workflow — **landed 2026-08-26** (`seat_gate4_cold_five_verb_workflow.mp4` + `seat_gate4_review_accept_apply.mp4`: cold home attach; see/ask/drill; Proposed edits → Review **Last turn** → Accept → Apply wrote `gateway/src/lib/seat4-health.ts`). Fix: proposal door no longer opens Unstaged. Desktop installers / public-beta claim remain **owner**. Workflow Start still honest when ACP agent missing.

## P8 — Unpark (do not interleave)

PTY · seqd stream · Scratch · LoRa · glyphs · Work/light deferred · cron stays refused.

## Owner later (not agent blockers · not Cursor setup actions)

Do **not** file these via `request-environment-setup-actions`. They do not block the agent run. Agent tip: see git HEAD on PR #123.

| Later | When you choose | Notes |
|-------|-----------------|-------|
| **P6 Claims** | Want measured token/correctness bars | Lane B: `node tools/p6-claims-ab.mjs`. Lane A: Claude Code + grep. Keep UNVERIFIED until both. **No fake competitor bars.** |
| **P7 Desktop** | Public installers for strangers | Code-sign macOS/Windows + app icon (`packages/desktop/README.md`). |
| **P7 Gateway** | Free-tier ask without a user key | Fund/deploy when ready — [`DEPLOY_CHECKLIST.md`](DEPLOY_CHECKLIST.md) Path B-gateway. Not required for a functioning local app. |
| **P8 Unpark** | One item at a time | PTY · seqd · Scratch · LoRa · glyphs · Work/light; cron stays refused. |
| **Docs tip-bump** | After mega PR merges | Separate lane for HANDOFF / AGENTS / CLAUDE (merge-lanes). |
| **Marketing site** | Site Graphite rebuild lives on PR #124 | Do **not** treat “disconnect trysequence.app” as a finish-open agent blocker; owner decides Vercel attach when publishing the new site. |
| **P5 PARTIAL** | Only if you reverse `.gitignore` / fund B7 | Not pretended closed. |

## Testing doctrine

Feature batches share Seat Gates. **One mega PR** for this finish-open arc unless merge-lanes force a docs tip-bump split. Locking tests + targeted package tests per batch. Full analyzer/desktop only at phase boundary.

## Deliberately not reopened

Wave 6 nesting · resurrecting `packages/web` · cron · Claude Code tool-breadth race · archived OF* plans.
