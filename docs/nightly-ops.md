# Ops check — on demand, not a cron

Sequence is a local-first visual AI editor. This page is how we keep GitHub
clean so it is not “Max plus infinite `mxcr/*` branches.”

**There is no scheduled cron.** Max asks in a chat when he wants a pass.
The agent **reports**. Max still merges. CI (`tools/ci/no-cron.test.mjs`) fails
if any GitHub workflow grows a `schedule:` / `cron:` timer.

When Max says “ops check”, “nightly”, “health”, or “what landed today” in
chat, follow the prompt in this file. Do not create a GitHub Action schedule,
a Cursor Automation, or any other timer.

## What each pass checks

- **PRs for the day / merged / created** — `gh pr list` in a 24h window (or
  the window Max names).
- **Docs check** — every living `docs/*.md` is in `docs/README.md`; research
  notes in `docs/research/README.md` (`tools/ci/docs-catalog.test.mjs`).
- **Health check** — last `CI` workflow on `main`; open PRs that mix
  `packages/` or `site/` with HANDOFF / AGENTS.md / CLAUDE.md.
- **File / branch check** — remotes = **`main` + open PR heads**. Stale
  `mxcr/*` is a fail.
- **Out of date** — unindexed docs; research notes that stamp 40-char git
  hashes; two open PRs both touching `site/` (sequence them — no `site/` exists
  today, retired 2026-08-20, but the check still recognises the prefix).
- **Everything okay** — no findings, or a short owner action list. The agent
  does not merge to “make it okay.”

Local:

```bash
pnpm nightly:health
# or: node tools/ci/nightly-health.mjs --since 24h
# JSON: node tools/ci/nightly-health.mjs --json
```

## Chat prompt (when Max asks)

You are the ops manager for Sequence (`naidx0/sequence-arch-tool`). Max merges his own
work. You do not merge. You do not open a PR unless Max asks. You do not
delete branches unless Max asks. You do not reopen archived OF*/owner-walk
plans. You do not stamp git hashes into research notes. You do not mix
`packages/` or `site/` with `docs/HANDOFF-AGENT-RESTART.md`, `AGENTS.md`, or
`CLAUDE.md`. You do not set up cron jobs, GitHub `schedule:` workflows, or
Cursor Automations.

1. Read this file and `docs/HANDOFF-AGENT-RESTART.md` (program state only —
   not a queue to execute).
2. Run:

```bash
node tools/ci/nightly-health.mjs --since 24h
node --test tools/ci/docs-catalog.test.mjs tools/ci/merge-lanes.test.mjs
```

3. `gh pr list --state open` and merged PRs in the window.
4. `git ls-remote --heads origin`.
5. `gh run list --branch main --workflow CI --limit 5`.

Do not invent PRs, files, or CI results. Write the brief in the chat reply.
Do not comment on a GitHub issue unless Max asks.

Report sections: PRs for the day, what merged, progress vs HANDOFF, what was
created, docs check, health, branch hygiene, what’s out of date, everything
okay. Label Max-intent vs accident. If the tree is already `main` only,
catalog green, CI green — say **everything okay** and stop.

## Hard rules (same as merge lanes)

- Max merges. The ops pass does not.
- One site lane at a time.
- Feature PRs do not rewrite `docs/HANDOFF-AGENT-RESTART.md` / `AGENTS.md` /
  `CLAUDE.md`.
- Do not reopen archived OF* / owner-walk programs.
- GitHub → Settings → General → **Automatically delete head branches** so
  merged `mxcr/*` refs do not pile up.

## Bringing someone on

Point them at [`build-guide.md`](build-guide.md) +
`docs/HANDOFF-AGENT-RESTART.md`. Ops is this page, on demand.
