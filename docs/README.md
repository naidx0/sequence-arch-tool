# Sequence docs — start here

> ### ⚠ THE UI IS BEING REBUILT FROM ZERO (2026-08-20)
>
> The decision of record is [`PIVOT-V2.md`](PIVOT-V2.md); the executable plan is
> [`research/v2-architecture-and-gaps.md`](research/v2-architecture-and-gaps.md).
> **The brand source of truth is the frozen Graphite book, [`brand/graphite/`](brand/graphite/)** —
> substrate plus 12 sheets, one copy. Cite `graphite/`.
> **`packages/web` was deleted 2026-08-20 (`20d1424`)**; v2 surfaces are built in `packages/web2`.
> The two superseded books, **Console v3.1** and **Ledger v2**, were **deleted from the tree**
> 2026-08-20. Any text naming either is history; `git log` still has them.

**Current program state:** [`HANDOFF-AGENT-RESTART.md`](HANDOFF-AGENT-RESTART.md).
**Finish-open ladder (P0–P8):** [`FINISH-OPEN-PHASE-PLAN.md`](FINISH-OPEN-PHASE-PLAN.md).
**Build from zero:** [`build-guide.md`](build-guide.md).
**Building a v2 UI surface:** [`rebuild/README.md`](rebuild/README.md) — the only reading list (six documents, in order, plus what is retired by name). Start there, not here.
**Onboarding + traps:** [`HANDOFF.md`](HANDOFF.md).

**There is no archive folder.** Retired material is deleted from the tree, not parked in it — every
file listed here is live. To read something that was retired, use git (`git log --diff-filter=D --
docs/`), not a path.

Order in this file is the read order. Do not reshuffle tables to “look newer.” Every living `docs/*.md` is listed here; CI fails if a root doc is added without an index row (`tools/ci/docs-catalog.test.mjs`).

## From zero

| Doc | Role |
|-----|------|
| [`TEACH-MODE-GOAL.md`](TEACH-MODE-GOAL.md) | **The plan of record for Teach mode (2026-09-04).** The owner ask stated as something you can stand in front of, decomposed into ten ordered tasks with a deliverable and a gate each, marked DONE / IN FLIGHT / NEXT / PARKED, plus what is blocked on Max rather than on us. Updated in the same commit as the work it describes, because a task list that goes stale reads as a plan while describing a past |
| [`build-guide.md`](build-guide.md) | Clone → install → build → run → tests → merge lanes → on-demand ops check |

## Living canon (read these)

| Doc | Role |
|-----|------|
| [`AI-CANVAS-IS-A-DOCUMENT.md`](AI-CANVAS-IS-A-DOCUMENT.md) | **Design of record for the AI Canvas** (2026-09-09) — it is one document, not a shelf of cards; why "whiteboard" here means Obsidian's markdown view and not a spatial plane, and what would overturn that |
| [`CANON.md`](CANON.md) | **One page that wins every disagreement** — what Sequence is, the measured advantage, the design and UX rules |
| [`PIVOT-V2.md`](PIVOT-V2.md) | **The v2 pivot (2026-08-20)** — the UI is rebuilt from zero against Graphite; the engine stays. Read before touching any surface. |
| [`product-final-plan.md`](product-final-plan.md) | **Owner product canon** — journeys, scope, acceptance. Its brand + layout sections are RETIRED by the pivot and carry banners; Graphite wins every visual disagreement |
| [`product-principles.md`](product-principles.md) | How to think before you build or judge |
| [`owner-feedback-log.md`](owner-feedback-log.md) | Verbatim owner decisions — read before UI changes |
| [`usability-standard.md`](usability-standard.md) | Human-usability gate |
| [`release-gate.md`](release-gate.md) | Binding gate commands + what GitHub PR CI covers |
| [`how-to-verify.md`](how-to-verify.md) | `sequence doctor`, local-first vs keyed AI |
| [`orchestration-protocol.md`](orchestration-protocol.md) | Multi-agent dispatch (when spawning builders) |

[`vision.md`](vision.md) holds the correctness invariants (grounded-not-guessed, local-first, honest
errors) — still binding. Its §6 "Look & feel" paragraph and its r68 surface rows describe the v1 UI
and are RETIRED by the pivot; the file carries a banner saying so. The v1 layout inventory
(`final-product-design.md`) and the 2026-07-30 `product-final.md` bar were **deleted** 2026-08-20 —
neither was canon, and both are in git history.

## Brand

**Active canon is Graphite, frozen at [`brand/graphite/`](brand/graphite/)** — the substrate
`_core.html` plus 12 sheets in `pages/`. Adopted 2026-08-19; the v2 UI is rebuilt against it
([`PIVOT-V2.md`](PIVOT-V2.md)). **Cite `graphite/`** — there is one copy — and
never edit a sheet to encode a ruling — new rulings are numbered decisions in
[`brand/GRAPHITE-DECISIONS.md`](brand/GRAPHITE-DECISIONS.md).

| Path | Role |
|------|------|
| [`brand/graphite/`](brand/graphite/) | **Active brand book — Graphite. One copy** (Decision 3). Substrate + 12 sheets + its assembler. A sheet changes only with a matching `GRAPHITE-DECISIONS.md` entry, enforced by `tools/ci/graphite-freeze.test.mjs` |
| [`brand/GRAPHITE-DECISIONS.md`](brand/GRAPHITE-DECISIONS.md) | **Owner rulings that bind** — the freeze, light deferred (1), node kinds without hue (2) |
| [`brand/GRAPHITE-SHELL-SHEETS-BRIEF.md`](brand/GRAPHITE-SHELL-SHEETS-BRIEF.md) | **Scope, not canon.** What the eleven unsheeted shell surfaces (§5.6) each need, and the one-copy question that blocks them |
| [`brand/GRAPHITE-MIGRATION-PLAN.md`](brand/GRAPHITE-MIGRATION-PLAN.md) | Token-collision reference (the nine names that exist in both systems and agree on none) |
| [`brand/README.md`](brand/README.md) | Brand folder index |

**Deleted 2026-08-20 — do not go looking for these.** The lineage was Structural → Ledger v2 →
Console v3.1 → Graphite. The first three are gone from the tree along with everything scoped to
them: both book folders, the Console owner-walk defect register and its wave scaffold, the
2026-08-17 owner-walk screenshot catalog, the four v3 sample theme books, and the older
Kimi/owner-walk gate docs. They were evidence of the v1 UI, never a spec for the v2 one, and an
agent that can route into them will. **Graphite is the only brand book.**

## Open / parked (short)

Living research index: [`research/README.md`](research/README.md) (do not duplicate that table here).

V2 rebuild docs live under [`rebuild/`](rebuild/):

| Path | Role |
|------|------|
| [`rebuild/README.md`](rebuild/README.md) | **The one reading list for building a v2 surface** — the decision of record, the owner rulings, the frozen book (cite `brand/graphite/`), your plan section, the inherited constraints, the reference implementation, and what is retired by name |
| [`rebuild/inherited-constraints.md`](rebuild/inherited-constraints.md) | Wave 0 item 0.2 — the "why" comments salvaged out of the v1 tree before it is deleted, each quoted with its original `file:line`. Read it before "cleaning up" any constant in v2, and read it **instead of** opening `packages/web`. Locked by `tools/ci/inherited-constraints.test.mjs` |

The nine v1-surface plans that used to sit here were **deleted 2026-08-20**. Nothing living was
queued behind them.

| Doc | Role |
|-----|------|
| [`decisions/`](decisions/) · [`adr/`](adr/) | MADRs / ADRs still referenced. **Read them as the "why" record, not as layout canon** — ADR-001/002/003/006 and `decisions/work-code-modes.md` ratify v1 surfaces that the pivot deletes, and each carries a superseded banner. Roles: [`decisions/model-roles.md`](decisions/model-roles.md) |

## Pitch

[`pitch/README.md`](pitch/README.md) — living Markdown only (stale PDF removed). Do not expect a pitch.pdf in this tree.

## Deploy (read in this order — not four competing SoTs)

| # | Doc | When |
|---|-----|------|
| 1 | [`DEPLOY_CHECKLIST.md`](DEPLOY_CHECKLIST.md) | Path A — local / desktop, ship today |
| 2 | [`GO_LIVE.md`](GO_LIVE.md) | Path B — Render hosted free tier |
| 3 | [`GATEWAY_DEPLOY.md`](GATEWAY_DEPLOY.md) | Gateway spec; live steps are in GO_LIVE |
| 4 | [`DEPLOY_BLUEPRINT.md`](DEPLOY_BLUEPRINT.md) | v10 hosted hardening (terminal, metering, isolation) |

## Honesty / eval

| Doc | Role |
|-----|------|
| [`feature-honesty.md`](feature-honesty.md) | Claims must match the running product |
| [`w5-journeys-web2.md`](w5-journeys-web2.md) | P7 — Journey A/B walks rewritten for web2 + one true socials sentence |
| [`TRANSLATION_GRADE.md`](TRANSLATION_GRADE.md) | Internal scan→English grade (`pnpm grade`) |

## Reference (not competing product canon)

The frozen Graphite book [`brand/graphite/`](brand/graphite/) wins every visual disagreement.
[`product-final-plan.md`](product-final-plan.md) still wins on **product intent** — users, journeys,
moat, scope, QA bar — and nothing else.

| Doc | Role |
|-----|------|
| [`design-refs/README.md`](design-refs/README.md) | External UI refs (isometric maps, explainers) — not canon |
| [`macos-ui.md`](macos-ui.md) | **RETIRED** legacy macOS mock tokens; kept only while `packages/export` cites them. Graphite wins |
| [`seqdiagram-sdk.md`](seqdiagram-sdk.md) | `.seqd` IR overview. Live contract; note its `theme` enum still names two retired books |
| [`TLDRAW_LICENSE.md`](TLDRAW_LICENSE.md) | tldraw license — obligation stands only if `packages/web2` keeps the dependency |
| [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) | Notices that must ship with the product. React Flow is MIT: the on-canvas badge is optional, the notice is not |
| [`OWNER-REFERENCES.md`](OWNER-REFERENCES.md) | What good looks like, in the owner words and the sources: the Coding Canvas layers, the native-English bar, the architect-agent thread |
| [`BACKLOG.md`](BACKLOG.md) | What is OPEN in this tree, every entry grounded in a file or commit a reader can check. Ordered by what is lost if it stays undone |
| [`OUTSTANDING.md`](OUTSTANDING.md) | Closed / partial register — what a user sees, the evidence, the gate. Prefer FINISH-OPEN for what to build next |
| [`FINISH-OPEN-PHASE-PLAN.md`](FINISH-OPEN-PHASE-PLAN.md) | **Living finish ladder (P0–P8)** — stubs, seat loop, autonomy, workflows, watch, claims, ship, unpark. Tip program as of 2026-08-26 |
| [`HANDOFF-2026-08-24.md`](HANDOFF-2026-08-24.md) | Snapshot of 2026-08-24 state — superseded as tip by HANDOFF-AGENT-RESTART + FINISH-OPEN |
| [`OWNER-PLAN-2026-08-24c.md`](OWNER-PLAN-2026-08-24c.md) | Shell / board / inline program — **LANDED** 2026-08-25 (Decisions 5–8) |
| [`OWNER-PLAN-2026-08-24b.md`](OWNER-PLAN-2026-08-24b.md) | Owner second pass the same day — P2 / Seat1 agent Done whens landed under FINISH-OPEN (2026-08-26); remaining items are owner-later parks |
| [`OWNER-FEEDBACK-2026-08-24.md`](OWNER-FEEDBACK-2026-08-24.md) | The owner's own run of the app on 2026-08-24, turned into ordered phases. Read the first section before building any of it: three of the reported symptoms diagnose to the OPPOSITE of the obvious fix |
| [`GAP-CLOSE.md`](GAP-CLOSE.md) | The durable state of the gap-closing programme — the phases, who owns which lane, and the mechanical acceptance rule (a lane is done when its reachability-baseline row is deleted) |
| [`codex-user-test.md`](codex-user-test.md) | The prompt handed to a Codex session with computer use, to drive the packaged app as a first-time user. A hidden pane measures nothing — this is the lane no headless review can cover |
| [`BUILD-PLAN.md`](BUILD-PLAN.md) | Earlier ladder (Phases 1–6 largely closed on tip). Systems-layer-only ruling (Wave 6 nesting CUT) still binds |
| [`OWNER-WALK-2026-08-22.md`](OWNER-WALK-2026-08-22.md) | The plan built from the owner's walkthrough — six phases, and it separates confirmed defects from the board behaviour that is working as designed |
| [`COMPETITIVE-GAPS-2026-08-22.md`](COMPETITIVE-GAPS-2026-08-22.md) | 41 verified gaps against Codex and Claude Code, phased. The pattern is one thing: built but not reached |

## Loop (do not ingest as backlog)

| Doc | Role |
|-----|------|
| [`autonomous-loop.md`](autonomous-loop.md) | Loop mechanism — only when running it |
| [`loop-log.md`](loop-log.md) | Historical round log — skip on a fresh chat |

## Ops (management — not a product queue)

| Doc | Role |
|-----|------|
| [`nightly-ops.md`](nightly-ops.md) | On-demand ops check in chat — not a cron; Max still merges |
| [`PUBLIC-README.md`](PUBLIC-README.md) | The README the public mirror carries — built into it by tools/release/mirror.mjs |

## There is no archive

**Deleted, not parked.** On 2026-08-20 the owner ruled that a retired doc must leave the working
tree rather than move to `docs/archive/`, because an archive is still a path an agent can route
into. `docs/archive/` and `docs/brand/refs/` no longer exist, and neither does the banner-and-
carve-out machinery that held them open.

Nothing is lost: git history is complete. To read a retired doc, find it there —

```bash
git log --diff-filter=D --name-only -- docs/    # what was deleted, and when
git show <commit>^:docs/<path>                  # the file as it stood
```

Gone in that pass: the whole v1 marketing site (`site/`, 32 files plus both Vercel configs), the
nine v1-UI surface plans, the Console v3.1 and Ledger v2 brand books with their gate docs, the
owner-walk registers and screenshot catalogs, old round plans, handoffs and stale research, and the
five orphan v1 screenshots that sat in this folder. **trysequence.app is no longer deployed from
this repo**; a Graphite-era site is separate work. The two research snapshots that lived in
`site/data/` were promoted to [`research/data/`](research/data/) and are still live.

[`teach-mode.md`](teach-mode.md) — **Teach Mode**: the design of record for the graded,
visual, one-concept-per-turn teaching surface, its five build waves, the live hardening arc,
and the 54-conversation testing bench results.

[`report/bench-report.html`](report/bench-report.html) — the website-ready benchmark chart
report: the v8–v16 trajectory with reverted experiments, the fix ledger, the field comparison.

Still **living** but retired: [`macos-ui.md`](macos-ui.md) — `packages/web` is gone; the file
remains while `packages/export` cites its token literals for SVG. It goes when that call site does.
