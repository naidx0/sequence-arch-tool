# AGENTS.md

Agent guidance for this repo. **Product reasoning, gates, and canon** live in `CLAUDE.md` and the
docs it points at — read that for *what* Sequence is and *how* to judge work. This file is the
practical layer: environment quirks, how to run things, and what agents in Cursor Cloud actually
need day to day.

**Always-on UI rule:** `.cursor/rules/owner-seat-ui.mdc` — owner quote → user-seat Done when;
ban inverted fixes; empty+narrow layout check; locking tests assert the ask, not a workaround.
Do **not** “fix” missing product sense by stuffing more canon into every subagent (see
`docs/research/subagent-failure-diagnosis.md`).

---

> ### ⚠ THE UI IS BEING REBUILT FROM ZERO (2026-08-20)
>
> Max ordered the entire v1 UI deleted and rebuilt against the Graphite brand book.
> **`packages/web` is GONE — deleted in `20d1424`, not pending a wave.** Do not resurrect it, do
> not restore it from git to copy from, do not cite it as precedent. v2 surfaces are built in
> **`packages/web2`**. A machine that ran v1 keeps a gitignored `packages/web/dist`; nothing reads
> it and deleting it by hand is safe.
> **The brand source of truth is `docs/brand/graphite/`** — the substrate plus the sheets in
> `pages/`, one copy. A sheet changes only through a numbered decision in
> `docs/brand/GRAPHITE-DECISIONS.md`. Decision of record: `docs/PIVOT-V2.md`.
> Any section below that names `packages/web` is describing something already deleted. The two
> superseded brand books, **Console v3.1** and **Ledger v2**, were **deleted** 2026-08-20 — there
> is no path to either, and a doc that names either as authority is stale.

## What this is (30 seconds)

Sequence is a **local-first, visual-first AI code editor**: scan a repo into a grounded architecture
graph, read and edit it on one canvas, chat beside it, drill into files and functions. The analyzer
+ web app ship as a pnpm monorepo; local-first means core value works with no login and no API key.
**That is the product, not a description of the shipped v1 screens** — the canvas is the one surface
the owner kept; everything else is being rebuilt (`docs/PIVOT-V2.md`).

---

## Read first

| Doc | Why |
|-----|-----|
| **`CLAUDE.md`** | Product context, three gates, repo shape, non-negotiables — the main agent brief |
| **`docs/PIVOT-V2.md`** | **The decision of record** — what is thrown away, what is kept, why demolition is literal |
| **`docs/brand/GRAPHITE-DECISIONS.md`** | **The owner rulings that bind visually** — the freeze at `graphite/`, light deferred, node kinds without hue |
| **`docs/brand/graphite/`** | **The frozen brand book.** Read the one or two sheets your surface touches, plus `_core.html` for tokens — never all twelve |
| **`docs/research/v2-architecture-and-gaps.md`** | **The executable plan.** Read *your section only*; each is written to be handed to one agent |
| **`docs/rebuild/inherited-constraints.md`** | The hard-won "why" salvaged out of v1 — read this **instead of** opening the v1 tree |
| **`docs/README.md`** | Doc map. Everything it lists is living — there is no archive folder; retired docs are deleted, not parked |
| **`docs/HANDOFF-AGENT-RESTART.md`** | Current program state (paste block for fresh chats) |
| **`docs/research/v2-next-phase-mega-plan.md`** | **Post-MVP program of record** — Phase A–D (trust, agent loop, Terminal/Browser, public beta) |
| **`docs/research/mega-plan-requirement-audit.md`** | Living LANDED vs OWNER map — do not invent M1–M7 % or bakeoff wins |
| **`docs/HANDOFF.md`** | One-pass onboarding: run commands, traps, open queue |
| **`docs/product-principles.md`** | How to think before you build or judge |
| **`docs/how-to-verify.md`** | `sequence doctor`, local-first vs keyed AI |
| **`docs/release-gate.md`** | Binding gate commands when you claim "done" |

Tier-completion program status (if relevant): `docs/decisions/tier-completion-retrospective.md`,
`docs/loop-log.md`.

---

## The three gates (summary)

A change is not done until all three hold — details and exact commands in `docs/release-gate.md`.

**Filter note (pivot):** the `@sequence/web` filter names a package that no longer exists. For v2
work, run the same gates against **`@sequence/web2`**. The gate shapes do not change; the filter does.

1. **Correctness** — `pnpm -r build`, package tests, `pnpm --filter @sequence/web2 test`, and the
   e2e suite `pnpm --filter @sequence/web2 test:e2e`.
2. **Legibility** — nothing to run yet. The v1 legibility sweep lived in the tree being deleted;
   v2's equivalent is not built. Until it is, judge legibility by opening the app and looking:
   nothing overflows its box, no two texts overlap, nothing is clipped, no two sibling rows read
   the same, every scrollable region scrolls.

   **Do not invent a script name here.** `packages/web2` ships exactly six: `dev`, `build`,
   `preview`, `test`, `test:e2e`, `test:e2e:shell`. This block previously named
   `test:e2e:bindings` and `test:e2e:legibility` — collateral from a blanket `web`→`web2`
   rewrite — and both returned `ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT`. An agent brief that hands out
   a command which errors is worse than one that says "not yet".
3. **Human-usability** — `docs/usability-standard.md`: discoverable, legible, non-confusing for a
   first-time user.

Fixture tests prove logic; layout and density claims need the real repo (hundreds of files).

---

## Repo shape

pnpm monorepo under `packages/`:

| Package | Role |
|---------|------|
| `schema` | Graph/domain/program types + validators |
| `analyzer` | Scanner, API server, AI provider, auth |
| `acp` | Agent-client-protocol |
| **`web2`** | **The v2 UI — build here.** Rebuilt from zero against `docs/brand/graphite/` |
| ~~`web`~~ | The v1 React UI — **deleted 2026-08-20 (`20d1424`).** Listed so the name resolves; not a source of precedent, and not restorable for one |
| `ink` | Freehand recognition |
| `export`, `desktop`, `mcp`, `gateway` | Optional / deploy paths |

Docs and the autonomous loop live in `docs/`.

---

## Cursor Cloud — environment

The VM startup script runs `pnpm install`. Standard commands are in root `package.json` and
`start.sh`. Below is what is **not** obvious from those.

### Build before app or e2e

`pnpm build` (`pnpm -r build`) is required before running the app or e2e suites. The analyzer serves
a compiled web bundle via `packages/analyzer/dist/cli.js` — both must be built. (~30s.) Unit tests
(`pnpm test`) compile per package and do not need a prior root build; the app and e2e do.

**Pivot note:** the analyzer serves `packages/web2/dist`, and so does `./start.sh`. v1 was deleted
on 2026-08-20; the launcher and both `findWebDist()` copies followed on 2026-08-21. If a machine
ever ran v1 it still has a gitignored `packages/web/dist` — nothing reads it, and `start.sh` says
so on launch. Check which package actually built before assuming the app is stale.

### Running the app

**Full stack (recommended):**

```bash
pnpm build
pnpm app -- --no-open --port 4173
# or: node packages/analyzer/dist/cli.js app --no-open --port 4173
# or: ./start.sh
```

Binds `127.0.0.1:4173` — web UI and `/api/*` on one origin. Use `--no-open` in headless/cloud.
`SEQUENCE_BIND_HOST` overrides host (loopback only; non-loopback is refused).

**Frontend-only** (`pnpm --filter @sequence/web2 dev`, port 5173) has no `/api` proxy — platform/AI/file
UI auto-hides. Use only for static UI/canvas work.

### Attaching a repo (browse-root jail)

`/api/attach` and `/api/browse` are confined to **browse root = `$HOME`** (`/home/ubuntu` in cloud).
Paths outside it return `path escapes the browse root` (so `/workspace/...` fails from the home picker).

- Clone or copy the repo under `$HOME` and attach from the home screen, **or**
- Launch with `--repo <abs-path>` (e.g. `pnpm app -- --repo /workspace`) to scan on startup and bypass
  the jail.

Repos need compose/K8s/Helm manifests to scan; manifest-less repos get a calm 422 (`no-manifests`).
Demo fixture: `packages/analyzer/test/fixtures/shopfront` (8 services, 2 datastores, 1 topic).

### Tests

- `pnpm test:ci` — docs catalog + merge lanes (also GitHub Actions hygiene job).
- `pnpm test` — all packages (`node --test` + `packages/web2` vitest). Green on a clean clone: analyzer 1224/1224, web2 704/704 with a scan cache (49 files / 1 skipped without one — the rail tiers skip on a missing `.sequence/`, they do not fail). The v1 vitest suite went with the package.
- e2e (`pnpm test:e2e`, `test:e2e:bindings`, shot scripts) needs Chromium at `/opt/pw-browsers` or in
  the Playwright cache. If neither is present, harnesses **skip cleanly (exit 0)** — not part of
  default `pnpm test`.
- Known pre-existing analyzer failures on a clean tree are documented in this file's history and
  `docs/decisions/tier-completion-retrospective.md`; do not treat unrelated red as your regression
  without checking.

### Local-first / no network

Core product works with no login and no key. AI is optional (Settings → Connect AI); keys live under
the repo's gitignored `.sequence/`. `@sequence/gateway` and `@sequence/desktop` are not required for
core dev; desktop cannot build in cloud without the Electron binary.

---

## Working as an agent here

- **Grounded, not guessed** — edges and claims trace to scan evidence; no fabricated topology.
- **Locking tests** — fixes that matter carry a test that failed before the fix; do not weaken
  assertions to go green.
- **User seat, not machine seat** — "tests pass" ≠ "a human can use it"; see usability standard.
- **Minimal scope** — match existing conventions; smallest correct diff.

For multi-file programs or overnight loops, skills under `.claude/skills/` (`orchestrated-build`,
`autonomous-loop`) exist if the owner asks — not a default requirement every session.

> **Unresolved — who builds.** This section and the next name Composer / GLM 5.2 / Kimi K3 as BUILD
> lanes. `docs/HANDOFF-AGENT-RESTART.md`'s paste block names a **Claude-native chain only** ("no
> Cursor/Composer, no Codex, no GLM/Kimi"). `CLAUDE.md` makes `docs/orchestration-protocol.md` §1
> binding for any session that dispatches agents — **follow §1 and treat the routing table below as
> the non-Claude fallback**, until the owner rules on whether Composer is still a build lane.

**Mega-branch format (non-Claude lanes):** say **`agency loop`** — loads `.cursor/skills/agency-loop`
(universal copy: `~/.cursor/skills/agency-loop`). Parent narrates; Composer BUILD waves;
one PR. See `docs/research/agency-loop-why-it-works.md`.

**Subagents are not default:** single-line edits, one-file fixes, and one-shot search/
explore stay with the parent. Spawn BUILDERS only when multi-phase or parallel ownership
pays for the overhead.

**Program status:** `docs/HANDOFF-AGENT-RESTART.md` only — do not copy a queue into this file.

**PR CI:** `.github/workflows/ci.yml` (docs catalog + merge lanes + build + green package tests).
Draft PRs skip the build job. Full three gates stay `docs/release-gate.md`. Feature PRs must not
edit HANDOFF / AGENTS.md / CLAUDE.md; tip-bump after merge. Do not reopen archived OF*/owner-walk
plans. After merge, delete the head branch (GitHub: Automatically delete head branches).

**Subagent routing (when used):** Grok 4.5 = plan/MADR · **GLM 5.2 = scaffolding / hard backend
structure** (`.cursor/agents/glm-scaffolder.md`, model id `glm-5.2`) · Composer = UI BUILD/test ·
Kimi K3 = design gate (this lane was named for the retired **Ledger** book; any design gate now
reads `docs/brand/graphite/`). Parallel BUILD only with disjoint `may-touch` / `must-not-touch`.
On stop: synthesize once, one tighter retry max.
**CONTEXT DIET:** every subagent prompt lists 2–3 read paths only — no full `CLAUDE.md` canon dump
(`docs/research/subagent-failure-diagnosis.md`).

**GLM 5.2 note:** `.cursor/environment.json` cannot pin models (Cursor schema has no model field).
Repo pin is `.cursor/agents/glm-scaffolder.md`. For cloud parent runs, also set **Dashboard →
Cloud Agents → Default model** to GLM 5.2. If a Task spawn rejects the slug, run scaffolding on
the parent with GLM selected (or `model: inherit`) until the platform Task allowlist includes it.

---

## Non-negotiables

Never leak a user API key. Local-first path must keep working without login. Honest errors over
silent failure. Terse, structured reporting.
