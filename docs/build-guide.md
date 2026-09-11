# Build guide — from zero to a running Sequence

This is the onboarding page for a human or agent joining the repo. Product canon
is [`product-final-plan.md`](product-final-plan.md). Current tip is
[`HANDOFF-AGENT-RESTART.md`](HANDOFF-AGENT-RESTART.md). Traps are
[`HANDOFF.md`](HANDOFF.md). This file is **how to build, run, test, and keep
GitHub clean.**

Ops check (on demand in chat, not a cron): [`nightly-ops.md`](nightly-ops.md).

---

## What you are building

Sequence is a **local-first, visual-first AI code editor**. It scans a real repo
into a grounded architecture graph. Chat is on the left; the canvas is the same
page (Draw toggle); files/functions sit on the right rail.

pnpm monorepo:

| Package | Role |
|---------|------|
| `schema` | Graph / domain types + validators |
| `analyzer` | Scanner, API server, AI provider, CLI (`sequence`) |
| `acp` | Agent-client protocol |
| `web` | React UI (canvas, chat, rails) |
| `ink` | Freehand recognition |
| `export` · `desktop` · `mcp` · `gateway` | Export, Electron, MCP, hosted path |

There is no marketing site — the v1 site was retired and deleted 2026-08-20. Living docs are
`docs/` (indexed in [`README.md`](README.md)); there is no archive folder, so everything the
index lists is current.

Core value works with **no login and no API key**. A key only buys names and chat.

---

## Prerequisites

| Need | Version |
|------|---------|
| Node.js | **≥ 20** (`package.json` `engines`) |
| pnpm | **10.33.0** (`packageManager` field). `./start.sh` enables it via Corepack if missing |
| Git | any recent |
| Optional: Chromium | e2e / Playwright only (`/opt/pw-browsers` in cloud). Missing browser → e2e **skips clean (exit 0)** |
| Optional: `gh` | GitHub CLI, for PRs and `pnpm nightly:health` |

macOS / Linux / WSL are the supported shells. Desktop installers are a separate,
unsigned Electron path — see [`DEPLOY_CHECKLIST.md`](DEPLOY_CHECKLIST.md). Do not
block local-first work on Electron.

---

## 1. Clone

```bash
git clone <this repository's URL> sequence
cd sequence
git checkout main
git pull
```

<!--
  THE URL IS A TOKEN, NOT AN OMISSION.

  This guide ships in the public mirror, and the working repository it is written
  in is private. A concrete clone URL here is the URL of a door the mirror's
  reader cannot open — which is the whole failure this token prevents, and it was
  found staged and unpushed rather than by a reader hitting it.

  `tools/release/mirror.mjs` substitutes the mirror's own destination when a
  `public` remote is configured, and refuses to stage a guide carrying a concrete
  github clone URL that is not that destination. With no destination configured
  it cannot verify one, so it refuses them all.
-->

Work on a branch `mxcr/<short-name>`. One concern per PR. Remotes should stay
**`main` + open PR heads**.

---

## 2. Install

```bash
pnpm install
```

First run of `./start.sh` does this for you. Re-run `pnpm install` after pulling
lockfile changes.

---

## 3. Build

**Required before the app or e2e.** The analyzer serves the built web bundle via
`packages/analyzer/dist/cli.js`. Unit tests compile per package and do not need
a prior root build.

> **⚠ Pivot note (2026-08-20).** The analyzer serves **`packages/web2/dist`**. `packages/web`
> (v1 UI) was deleted (`20d1424`); a leftover gitignored `packages/web/dist` is ignored — see
> `start.sh`. Filters and gate commands use **`@sequence/web2`**.

```bash
pnpm build          # same as pnpm -r build  (~30s)
```

`./start.sh` rebuilds if `packages/analyzer/dist/cli.js` or
`packages/web2/dist/index.html` is missing **or older than source** (so a
`git pull` cannot serve a stale UI).

Sanity:

```bash
test -f packages/analyzer/dist/cli.js && test -f packages/web2/dist/index.html && echo ok
```

---

## 4. Run

**One command (opens a browser):**

```bash
./start.sh
# or attach a repo immediately:
./start.sh /path/to/your/project
```

**Full stack, headless / cloud:**

```bash
pnpm app -- --no-open --port 4173 --repo "$PWD"
# same: node packages/analyzer/dist/cli.js app --no-open --port 4173 --repo "$PWD"
```

Binds **`127.0.0.1:4173`** — UI and `/api/*` on one origin. Override host with
`SEQUENCE_BIND_HOST` (loopback only; non-loopback is refused).

**Frontend-only** (`pnpm --filter @sequence/web2 dev`, port 5173) has **no `/api`
proxy**. Platform / AI / file UI auto-hides. Use only for static canvas CSS work.

### Browse-root jail

`/api/attach` and `/api/browse` stay under **`$HOME`**. Paths outside it return
`path escapes the browse root` (so `/workspace/...` fails from the home picker
in cloud). Fix: clone under `$HOME`, or launch with `--repo <abs-path>`.

### Repos that scan

Compose / K8s / Helm manifests are what the scanner needs. Manifest-less repos
get a calm 422 (`no-manifests`). Demo fixture:

```bash
pnpm app -- --no-open --port 4173 --repo "$PWD/packages/analyzer/test/fixtures/shopfront"
```

Shopfront: 8 services, 2 datastores, 1 topic.

### Optional AI

Settings → Connect AI, or write `<repo>/.sequence/ai.json` (gitignored). Never
commit or paste a key into chat. Structure is identical without a key; a key
buys names. See [`how-to-verify.md`](how-to-verify.md).

```bash
node packages/analyzer/dist/cli.js doctor /path/to/repo
```

---

## 5. Tests (what “green” means)

| Command | What it proves |
|---------|----------------|
| `pnpm test:ci` | Docs catalog + merge lanes + nightly-health unit tests. This is GitHub **hygiene** |
| `pnpm nightly:health` | Live snapshot: open/merged PRs, stale remotes, catalog. Exit 1 if remotes are clutter |
| `pnpm -r build` | Types / bundles |
| `pnpm --filter @sequence/schema test` (and acp, export, ink, mcp, gateway) | Green package tests on PR CI |
| `pnpm --filter @sequence/web2 test` | Vitest for the v2 UI (`packages/web` and its suite are gone) |
| `pnpm test` | All packages. Analyzer has **known pre-existing reds**; do not “fix” those by weakening assertions |
| `pnpm --filter @sequence/web2 test:e2e` | The e2e suite (Playwright). `test:e2e:shell` runs just the shell |

A change is not done until the three gates in [`release-gate.md`](release-gate.md)
hold: **correctness**, **legibility** (real repo + `tmp-shots/legibility/`),
**human-usability**. Fixture-scale green is not a layout proof.

---

## 6. How we merge (so a second person is not lost)

Hard rule: [`.cursor/rules/merge-lanes.mdc`](../.cursor/rules/merge-lanes.mdc).

- Feature work under `packages/` or `site/` **must not** edit
  `docs/HANDOFF-AGENT-RESTART.md`, `AGENTS.md`, or `CLAUDE.md`. Tip-bump those
  in a follow-up PR after the feature merges.
- If a `site/` lane ever returns: one at a time. If two PRs need the same file,
  **sequence them**. (No `site/` exists today — retired 2026-08-20 — but the
  classifier still recognises the prefix.)
- Every living `docs/*.md` must be listed in [`docs/README.md`](README.md).
- Do not stamp git hashes into research notes. Tip lives in HANDOFF only.
- Do not reopen archived OF* / owner-walk programs.
- **Max merges.** Agents report; they do not `gh pr merge` unless Max says so
  for that request.
- GitHub → Settings → General → **Automatically delete head branches**.

PR CI (`.github/workflows/ci.yml`): hygiene on every PR; build + green package
tests on non-draft PRs and on `push` to `main`. Draft bench PRs skip the
build job on purpose.

---

## 7. Ops check (on demand — no cron)

There is **no scheduled job**. Max asks in chat. Local facts:

```bash
pnpm nightly:health
```

What that covers, and the chat prompt: [`nightly-ops.md`](nightly-ops.md).
Do not add a GitHub `schedule:` workflow or a Cursor Automation unless Max
asks for a cron again.

---

## 8. If something is wrong

| Symptom | Likely cause |
|---------|----------------|
| App shows yesterday’s UI after `git pull` | Dist stale — run `pnpm build` or `./start.sh` (it timestamp-checks now) |
| **Windows: `./start.sh` returns instantly and opens an editor** | PowerShell/cmd cannot execute `.sh`; Windows opened it with the app associated to the extension. **Nothing started.** Use `.\start.ps1` (or `.\start.cmd`). See README → Run it. |
| Windows: `.\start.ps1` blocked by execution policy | `powershell -ExecutionPolicy Bypass -File .\start.ps1` |
| `path escapes the browse root` | Attach from `$HOME` or pass `--repo` |
| 422 `no-manifests` | Repo has no compose/K8s/Helm — use shopfront fixture to prove the app |
| Chat refuses | No key; local-first still works. Settings → Connect AI |
| PR CI red on “mixes program-state” | You edited HANDOFF/AGENTS/CLAUDE in a `packages/` or `site/` PR. Split it |
| Docs catalog red | Added `docs/foo.md` without a row in `docs/README.md` |
| Nightly health red | Stale `mxcr/*` remotes with no open PR — delete the heads |
| Analyzer tests red on a clean tree | Known; not your regression unless the failing names are new |

---

## 9. Done when (your machine)

```bash
pnpm install
pnpm build
pnpm test:ci
pnpm app -- --no-open --port 4173 --repo "$PWD"
node packages/analyzer/dist/cli.js doctor "$PWD"
```

Browser: `http://127.0.0.1:4173` — home screen or the attached graph, no key
required. That is a working Sequence checkout.
