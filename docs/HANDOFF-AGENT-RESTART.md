# Agent restart handoff — paste into a fresh chat

**Updated:** 2026-09-14 · **Tip:** `ea4d4983` — see the first section below, which is the current state. · **Historic tip merge:** `3f8773a9` (mega-plan Phase A–D agent code on `main`; PR #141 merged). · **Current program:** [`docs/research/v2-next-phase-mega-plan.md`](research/v2-next-phase-mega-plan.md) — trust, speed, agent loop, Terminal/Browser, public-beta gate. Living evidence: [`docs/research/mega-plan-requirement-audit.md`](research/mega-plan-requirement-audit.md). Visual summary: [`docs/research/mega-plan-visual-breakdown.html`](research/mega-plan-visual-breakdown.html). · **Still binding:** [`docs/FINISH-OPEN-PHASE-PLAN.md`](FINISH-OPEN-PHASE-PLAN.md) (P0–P8 honesty/stubs — mega plan layers on top, does not replace). · **Pivot tip:** v1 UI **deleted** (`20d1424`); launcher + analyzer serve `packages/web2/dist`. Brand SoT: `docs/brand/graphite/` + `docs/brand/GRAPHITE-DECISIONS.md`.

## 2026-09-14 (later) — the canvas program, the IDE panel, and three UI drafts

**Tip:** `ea4d4983`. Everything below is on `main` and green: **2796 web2 · 2595 analyzer · counting gate
exit 0**, and the desktop app is installed per-user with a bundle byte-identical to the repo build.

### The code canvas — the "tldraw equivalent"

The finding that shrank it from a rewrite to a wiring job: **we already had the canvas.**
`packages/web2/src/whiteboard/` has had an infinite pan/zoom camera, a document model, an edit
vocabulary and fifty frames of undo since it was written — and `WbNodeRef`, *"a reference to a real
node of the scanned graph"*, **had never been produced by anything**. The seam was cut and unused.
What was missing was what the AI Canvas lacked until this week: the agent could neither see the board
nor draw on it. A grep for "whiteboard" across `packages/analyzer/` returned two comments and no code.

| | what |
|---|---|
| `boardTools.ts` | `board.add_note` / `add_card` / `connect` / `frame`, 48 tests. Ids are model-supplied so one round can draw four cards AND join them. A card naming a node the scan lacks is refused whole, with near-misses listed. |
| `askSurface.ts` | `surface.board` — the read half, **with positions**, because "put the cache next to the database" is unanswerable without them. |
| `CodeCard.tsx` | the renderer `WbNodeRef` was cut for. Left-elides paths in JS: `text-overflow` only cuts from the end and `direction: rtl` is the bidi algorithm, not a truncation rule. |
| `Whiteboard.tsx` | `onDocChange` + `agentItems`, appended by id so a replay cannot double-draw. |

**Two "shipped but unreachable" defects were caught here, and the second only by checking the
installed artefact:**
1. `board.*` cases were added to the dispatch switch, build clean and suite green, and every call
   still returned `refused: unknown tool` — `executeAskTool` checks `ASK_DISPATCHABLE_TOOLS` by name
   **before** the switch. `board-tools-wired.test.ts` exists for exactly this and earned its keep on
   the first run.
2. `CodeCard` shipped with 23 passing tests and was rendered by **nothing**. Tests green, build
   clean, and `code-card` did not appear in the shipped JavaScript at all. *A module test proves the
   module; only the artefact proves the mount.*

### Also landed

- **Files is a real workspace tab** (was an overlay covering the chat it sits beside). The
  Files-means-the-index-rail alias is **severed**; two tests locked the old meaning and were reversed
  in place with the reasoning recorded. Pane capacity moved 6 → 7 against a bar that seats four at
  1440, so Files refuses out loud when the frame is full.
- **The IDE files panel** — tree, diff, edit; 92 tests. Reuses `review/diffModel.parseUnifiedDiff`
  rather than writing a second answer to "what line number is this".
- **Edit approval card** — `proposal/file-decide` existed since the review overlay was built and the
  overlay was the ONLY place it could be pressed. Diff + accept/reject now sit where the edit was
  proposed. It derives "settled" from the FILES, not from `status`.
- **Session lock** ("Drive") — four lines of behaviour, because work rows have carried `opens` since
  they were written. Per-session, so switching conversations stops the surfaces moving on their own.
- **Session multi-select** + bulk delete through the same confirm.
- **Tool card** — three states; a refusal no longer renders like a success.
- **Decisions 16 and 17** — the material, finally correct. Four attempts failed for one reason: a
  frosted pane must be **lighter than its ground**, and `backdrop-filter` over a flat fill is
  arithmetic with no visible effect. Glass is neutral; colour comes from behind. Ground is charcoal,
  colour is spent only on buttons, selections and tool state.

### The UI redesign — three drafts, awaiting the owner's pick

`docs/research/ui-drafts/` — **A · Native**, **B · Workstation**, **C · Liquid**, all bound to one
fixture (`docs/research/ui-redesign-drafts-brief.md` §2) so anything differing between them is a
design choice. View them with a chooser:

```
node <scratch>/drafts.mjs   # or just open the three files
```

**All three independently said the same thing first, unprompted:** build the **subagent surface**
before anything cosmetic. C put it bluntly — *"a long-running child is currently a silence …
everything else here is paint; this is a missing organ."*

### The two genuine functional gaps, named so they are not mistaken for style

1. **No subagent surface.** `WorkProofStack` is one flat list. There is no child agent with its own
   nested work, elapsed time, and the tool it is inside right now — the 21st.dev Subagent Tool shape,
   and the thing the owner named about Cursor's iOS app. **B's RUNS panel is a concrete proposal.**
2. **Permission `ask` never asks.** `permissionRules.ts` refuses with *"this turn has no approval
   channel open, so it was NOT run"* — so an `ask` rule is effectively `deny`, and the approval-card
   pattern has nothing to approve against. This is a server change: the turn must pause, ask, and
   resume.

### A process note the next orchestrator should read

A subagent caught me running `git add -A` in a shared tree while other lanes were mid-write, which
swept their in-progress files into commits about something else. That is
`docs/orchestration-protocol.md`'s disjoint-file-ownership rule broken **by the orchestrator**.
Commit only the paths your own lane owns while agents are running.

---

## 2026-09-14 — the four programs handed to a fresh session are DONE

Closed on `main`, each with locking tests built from the reported shape and the full gate green
(2508 analyzer · 2562 web2 · `pnpm -r build` clean). Details in `docs/brand/GRAPHITE-DECISIONS.md`.

| | commit | what it actually was |
|---|---|---|
| teach vs design | `932a8e87` | **The diagnosis on record was wrong.** It blamed `ASK_SHOW_ON_BOARD_CLAUSE`; a test built from the owner's own words shows that clause never fired. `isFigureItOutAsk` ("show me how…") and `prefersSeqdDiagramAsk` ("explain how", "walk me through") were the two that did. `AskComposition.teach` now reaches the PROMPT builders, which had never been told while the belt builder always had. |
| canvas read half | `0c62241f` | Stage 3 of `agent-drawing-and-teaching-visuals.md`. Stages 1–2 were already built (`visuals.ts`, the kind-picking drawer) — the handoff said "not built" and was out of date. |
| work list | `0fa993b6` | `update_todos`. A plan nothing executed and an execution that kept no plan, joined. |
| local workspace | `14972f8c` | `<user store>/workspace` + `GET /api/workspace` + the rail panel. |

Plus `67db566d` — Decision 13, Sora as the display face above `--t-15` only (it is 10–13% wider
than Instrument Sans at the working sizes; the numbers are in the decision).

Then the last three closed too:

| | commit | |
|---|---|---|
| scrim | `a12c72e9` | A scrim dims for a DECISION, not for navigation — `attach` no longer darkens the app. Only the dim; click-outside, focus trap and Escape are untouched. |
| thinking ink | `91d93cf8` | It meant the streaming answer, and there was a defect under it: local models put reasoning inline in `<think>` tags and nothing on the client looked for them, so they printed into the answer. Split, ordered, `--ink-3` at a measured 4.90:1 against the answer's 13.65:1. |
| the walk | `8a332691` | `walk_example` — the fourth beat. Both open design questions were settled by machinery that already existed; the picture stays a canvas pane and a beat is a moving highlight, not a redraw. |

**Nothing the owner raised on 2026-09-13 is open.** Tip: `8c225e35`.

---

> **Everything under "Shipped in v1" in older paste blocks is history.** `packages/web` is **gone**
> — deleted in `20d1424`. Build in `packages/web2`.

Closed: OF5–OF8, visual-first harness stack, seat-walk #117–#120, **mega-plan agent code lane** (PR #141). Do **not** reopen archive plans. Wave 6 hierarchical nesting stays **CUT**.

---

## Paste this block into a new Cursor / Cloud Agent chat

```
You are continuing Sequence (naidx0/sequence-arch-tool) on tip main.

## THE UI IS BEING REBUILT FROM ZERO (owner, 2026-08-20)
packages/web is GONE — deleted in 20d1424. Build v2 in packages/web2.
Brand SoT = docs/brand/graphite/ — one copy. Sheets change only via
GRAPHITE-DECISIONS.md. No docs/archive/.

## Current program (2026-08-28)
docs/research/v2-next-phase-mega-plan.md — Phase A–D mega plan.
Agent-buildable code LANDED on main (PR #141 merge). Evidence map:
docs/research/mega-plan-requirement-audit.md
Do NOT invent M1–M7 % or bakeoff wins. OWNER fills scorecards + walks.
FINISH-OPEN-PHASE-PLAN.md still binds P0–P8 honesty where not superseded.
Do NOT mix HANDOFF/AGENTS/CLAUDE edits into packages/ PRs (merge-lanes).

## Read first (CONTEXT DIET — 2 to 5 paths)
1. docs/research/v2-next-phase-mega-plan.md   # program of record (post-MVP)
2. docs/research/mega-plan-requirement-audit.md  # what's LANDED vs OWNER
3. docs/PIVOT-V2.md + docs/brand/GRAPHITE-DECISIONS.md
4. packages/web2 paths your wave owns (+ .cursor/rules/owner-seat-ui.mdc)
5. docs/rebuild/inherited-constraints.md
Skip loop-log.md / OF* archives / full canon dump.

## Orchestration
- Claude-native chain preferred per docs/orchestration-protocol.md §1 when dispatching.
- CONTEXT DIET: 2–5 paths only. Owner-seat UI rule always on.

## True on tip (v2) — mega-plan code landed
- Session ↔ Architecture: boardSeqd per session; New chat empty board.
- Design-ask: short path ≤2 rounds (harness), round k/n UI, tool cache, parallel reads.
- Output honesty: theater + strip/salvage; auto-open Architecture on topology.
- Workspace: pane resize, Terminal PTY pane, Browser fetch tool+panel (not fake Chrome).
- Agent loop: intent paths, native tools, ContextRing, Rewind, review diffs, hooks honesty.
- Settings: MCP editor (GET/PUT /api/mcp), plugins call_plugin, autonomy matrix.
- Composer: terminal + browser workspace controls; work rows open Terminal/Browser.

## OWNER queue (blocks public beta claim — do not fake green)
- M1–M7 dogfood scorecard (docs/research/phase-a-dogfood-scorecard.md)
- B6 bakeoff rows (docs/research/phase-b-bakeoff-scorecard.md)
- Owner walk videos (D1–D2, feature-honesty.md)
- Desktop public CTA / signed assets OR honest clone-only (C3.2, D7)
- Marketing/Vercel ghost disconnect (D5) — owner ops

## Still parked (P8 — owner unpark only)
- Unrestricted ambient PTY / cloud Background Agents clone
- Seqd incremental stream — docs/research/seqd-stream-park.md
- ADR Scratch fold · LoRa · live 200k accuracy %
- Nightly cron — stays refused

Gate: pnpm -r build && pnpm --filter @sequence/web2 test && pnpm test:ci
Harness (canned M2/M4, not live M1): node tools/bench/phase-a-metrics-report.mjs
```

## Public beta release checklist — see Phase D

> Do not claim public beta until Phase D rows in
> `docs/research/phase-d-public-beta-gate.md` are evidenced.
> D4 **code** honesty landed; owner walks + M1–M5 weeks still OWNER.

- [x] Local path: `./start.sh` / `pnpm app -- --repo …`
- [x] Terminal + Browser ship with honest CTAs (not fake Chrome)
- [ ] M1–M5 green for 2 consecutive dogfood weeks
- [ ] Publish desktop release assets (or honest “clone + start.sh” only on socials)
- [ ] Socials one-liner (true sentence only)
- [ ] W5 / Seat Gate owner walks signed against **web2**
- [ ] Vercel / trysequence.app: disconnect or replace ghost deploy (owner ops)

---

## Branch map

In-flight only. Merged heads pruned. Feature PRs must not edit this file (merge lanes).

| Branch | Status |
|--------|--------|
| **`main`** | Tip — **test here** (`3f8773a9`) |
| **Mega plan** | **MERGED** PR #141 → `main` (`d35d7782` code + audit) |
| **Finish-open** | `docs/FINISH-OPEN-PHASE-PLAN.md` — overlapping P1 items largely landed in mega PR; check audit before reopening |
| **Stale remotes** | Prune merged `mxcr/*` heads after merge (GitHub auto-delete if enabled) |

PR CI: `.github/workflows/ci.yml`. **Note:** Actions may fail on account billing (0-step jobs) — local gates green on tip.

## Quick verify

```bash
git checkout main && git pull
pnpm build && pnpm app -- --no-open --port 4173 --repo "$PWD"
# Harness (canned): node tools/bench/phase-a-metrics-report.mjs
# E2E (needs Chromium): pnpm --filter @sequence/web2 test:e2e:browser
```
