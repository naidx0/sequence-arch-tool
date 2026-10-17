# `tools/qa-loop` — the multi-repo QA loop (deterministic tier)

> ### ⚠ ONE METRIC BROKEN SINCE THE v1 DELETION — 2026-08-20
>
> `stemFound` reads `detectStemCandidates` from `packages/web/src/graph/stemFlow.ts`, deleted with
> v1 in `20d1424`. `pnpm qa:test` fails 1 of 98 on `Cannot find module …/stemFlow.ts`, and the
> smoke/full tiers cannot compute that metric. Every other metric here is unaffected. Nothing in
> CI invokes this, which is why it was silent. Porting `stemFlow` into a live package is open work.


**Fixture scale proves logic; only a REAL repo proves the result** (`CLAUDE.md`). Every
fixture in this monorepo is 3–10 files, where an overflow, a truncation or a wrong
cluster label *cannot occur*. Until this harness existed, the only real repository any
check ran on was Sequence itself — and the four hand-verified edge truths in
`docs/ground-truth/` were consumed by **nothing**.

This is the deterministic half of `docs/final-vision-gap-plan.md` §G-A. It clones a
pinned-SHA set of real open-source repositories and drives the **shipped** engine over
each one. It needs no API key, touches no network beyond `git fetch`, and calls no model.

## Run it

```bash
pnpm -r build          # the harness reads dist/, exactly like `pnpm grade`
pnpm qa:smoke          # 10 repos, minutes
pnpm qa:full           # the whole manifest (27 repos, some very large)
pnpm qa:test           # the harness's own locking tests

node tools/qa-loop/run.mjs --repos spring-petclinic     # one red row, one command
node tools/qa-loop/run.mjs --local /path/to/any/repo    # no clone, no network
node tools/qa-loop/run.mjs --tier full --concurrency 2  # opt-in parallelism
node tools/qa-loop/run.mjs --help
```

Output lands in `tools/qa-loop/runs/<stamp>/`:

| file | what |
|---|---|
| `summary.md` | the human table: hard findings, regression diff, per-repo row, verbatim scanner warnings and stacks |
| `results.jsonl` | one JSON line per repo — **triage data**, full stacks, every warning, nothing trimmed |
| `judge.jsonl` | one skip row per repo (see *AI-judge tier* below) |
| `graphs/<id>.graph.json` | the scanned `ArchGraph`, written only for ground-truthed repos — `scoreGraph` reads paths, and it doubles as the repro artefact |
| `children/<nn>-<id>.{job,row}.json` | what each per-repo child was asked to do and what it wrote back — the raw handoff, kept for triage |

`runs/` is git-ignored. `baseline.json` is **committed** — it is the reference a
regression is measured against.

## What it measures, and with what

Nothing here re-implements the engine. Every number comes from a shipped function:

| metric | comes from |
|---|---|
| `counts` | node kinds on the real `ArchGraph` from `scanRepo(dir, {cluster:true})`, plus `emptyModules`/`emptyServices` — containers nothing declares a parent of |
| `evidencePct` | `validateGraph`'s own `edge <id> has no evidence` problems (schema §invariant), not a re-derived rule |
| `evidenceResolvedPct` | share of evidenced edges with at least one citation that **opens**: the file is on disk in the clone and the line is inside it |
| `scoreVsTruth` | `scoreGraph(graphFile, docs/ground-truth/<id>.json)` — service-level edge precision/recall vs hand-verified truth |
| `fallbackTitlePct` | modules labelled `'Top level'` (cluster.ts), summarised `A group of N related files.` (explain.ts), **or blank** — the engine saying "I could not tell you what this is" |
| `dupTitleCount` | sibling modules under one service whose titles *read* the same (trimmed, whitespace-collapsed, case-folded) — settled owner canon (`HANDOFF` §6). `dupTitleCountExact` is the old byte-identical count |
| `stemFound` | `detectStemCandidates` (packages/web/src/graph/stemFlow.ts) over the real `buildRepoFunctionGraph` — a stem was **named** |
| `stemPlays` / `stemHops` | `mainFlowState(graph, functionGraph)` — the same function `canvas/GroupedCanvas.tsx` calls to decide whether "Show main flow" acts on a click, and how many grounded edges the played path uses |
| `elapsedMs` / `rssMb` | wall clock and peak process RSS |
| `warnings` | `graph.warnings`, verbatim — "silence is the worst failure mode" |

## U30 — every metric must measure the OUTCOME, not the attempt

`stemFound` was `candidates.length > 0`. It was `true` on **all 26 scanning repos**,
including flask, express, gin and n8n, while clicking "Show main flow" dead-ended on
four of them (U23). It measured that a stem was *named*, not that a flow *plays* — so
the loop ran the exact defect 27 times a round and reported green.

That is a **class** of failure, not one bug, so every metric here was audited against
the same question: *does this measure that the thing was attempted, or that it worked?*

| metric | verdict | what changed |
|---|---|---|
| `stemFound` | **was blind** | kept, unchanged, beside `stemPlays` — the gap between the two IS the finding |
| `stemPlays` / `stemHops` | new | asks the user's question, using the product's own `mainFlowState`. Hops recorded because a 1-hop flow and a 34-hop flow are both "plays" and are not the same answer |
| `evidencePct` | **honest but narrow** | left alone. It measures the schema invariant (`evidence.length > 0`) and now says so in its doc comment |
| `evidenceResolvedPct` | new | the outcome half: an edge can be 100% "evidenced" and 0% openable — nothing in the schema checks the file exists or the line is in it |
| `fallbackTitlePct` | **was blind** | a BLANK label scored 0%. G12 (an empty flask module label, 35 files, "reads as nothing at all") was invisible to the metric that exists to count bad titles. Blank label/summary now count |
| `dupTitleCount` | **was blind** | keyed on the raw string, so `Core` / `core` / `Core ` were three titles to the metric and one row to the reader. Now normalised; the old count survives as `dupTitleCountExact` |
| `counts.*` | **honest, insufficient** | a tally that only ever claimed to be a tally — but `modules: 8` cannot tell eight useful modules from eight empty cards, so `emptyModules`/`emptyServices` answer that directly |
| `promptSize.budgetCut` | **honest** | it matches the marker the budget actually emitted when it cut. Outcome, not intent |
| `promptSize.approxPromptTokens` | **honest, and named as approximate** | chars/4, the analyzer's own approximation; it does not claim to be a tokenizer |
| `scoreVsTruth` | **honest** | precision/recall against hand-verified edges. It cannot be satisfied by trying |
| `elapsedMs` / `rssMb` | **honest** | measured facts. `rssMb` includes the interpreter's own floor and says so below |
| `warnings` | **honest** | verbatim passthrough; no judgement to be blind with |

**A false `stemPlays` is not automatically a defect.** sqlfluff's calls land in
frameworks the scan does not read; `false` there is the correct, honest value. So a
dead end is a **named row** in `summary.md` carrying the exact sentence the user would
be shown — never a silent ✅, and never a fabricated failure. It becomes a regression
only when it was `true` before.

### A redefined metric must never read as a regression

`dupTitleCount` and `fallbackTitlePct` both got *wider*, so both can only rise against a
baseline recorded under the old rule — and a rise is a regression under
`REGRESSION_RULES`. So `baseline.json` now carries `metricVersion` beside the file
`version`, and a diff across versions **refuses to judge** the redefined metrics,
naming them on stdout and in the summary until the baseline is deliberately re-recorded
with `--update-baseline` on a whole tier. Metrics whose meaning did not change are
still judged in full.

The committed `baseline.json` is still `metricVersion: 1` — the next full tier should
re-record it. Nothing about the product changed in U30; only the harness did.

## Three levels of red

1. **Failures** — the scan threw. Full stack in `summary.md` and `results.jsonl`.
2. **Hard findings** — wrong on their own terms, no baseline needed: a repo that matched
   *none* of its hand-verified ground truth, a scan that reported success and produced
   **zero files**, or a graph whose every edge cites evidence and **not one citation
   opens**. These exist because a first run has no baseline and would otherwise
   report an empty graph as a clean pass — and the next `--update-baseline` would freeze
   that nothing in as the expectation.
3. **Regressions** — a tracked metric moved the wrong way against `baseline.json`.
   Thresholds and their reasoning are in `lib/report.mjs` (`REGRESSION_RULES`).

Any of the three exits `1`.

## The manifest

`manifest.json`, 27 repos. Every `sha` was resolved with `git ls-remote <url> HEAD` and is
a real commit — the placeholder `"pin-me"` validates but is **refused at run time**, because
a benchmark that silently follows upstream HEAD produces numbers nobody can compare. Every
`license` is the SPDX id GitHub reports; `NOASSERTION` means a custom/source-available
licence GitHub cannot map (terraform, n8n, strapi) — read-only benchmark use only.

`tiers: ["smoke","full"]` puts a row in both; `smoke` is ten small/medium repos and
includes **all four ground-truthed repos**, which are the only rows where a number can be
checked against something a human verified. `full` is the whole manifest.

`rails` is a deliberate **negative case**: Ruby has no parser in this engine, so the honest
outcome is "nothing I can read here". It gets its own section in the summary that reports
*what happened* rather than a pass/fail — a confident-looking Ruby architecture would be a
fabrication, and that is the failure the row exists to catch.

## AI-judge tier — a seam, not a feature

`lib/judge.mjs` contains no HTTP call, no prompt and no model id. Today every repo gets an
explicit SKIP row naming the reason (no key / `--no-ai` / not implemented), and no judged
number ever reaches a summary. The contract for whoever builds it is written at the top of
that file. A half-built judge emitting plausible scores is exactly the fabrication
`CLAUDE.md` forbids.

## One process per repo — and why

Every repo is measured in its **own child process** (`lib/runner.mjs` spawns `lib/child.mjs`,
which runs `lib/measure.mjs`). The parent only clones, collects rows and writes the report.

This is not tidiness. Until it changed, all 27 repos ran in one process, and the full tier
**could not finish**: it wedged on n8n — 34+ minutes at 102% CPU, RSS flat at ~1.5GB, no
`Aborted()` — while n8n measured *alone* takes ~148s. Rows 1–20 were each as fast as they
are alone; the failure is not a gradual slide, it is a cliff at the largest repo once
twenty earlier repos have raised the WASM heap's high-water mark and churned it. Tree-sitter
parses into an emscripten heap that grows and is never returned to the OS, so the biggest
workload arrives last and pays for everyone. Before the leak fix (`9fb4dbc`) this was
invisible, because every repo after the abort read zero files and did no work at all.

A fresh process per repo makes a repo's cost a property of the repo, not of its position.
`--concurrency <n>` (default `1`) will measure n repos at once; leave it at 1 whenever the
wall clock is the number you care about.

## The per-repo timeout is a real kill

`--timeout-ms` (default 900000) is a **hard cap on one repo**, enforced by killing its child
— SIGTERM, then SIGKILL after a 2s grace. It stops a synchronous WASM parse, which is the
only thing that has ever actually hung, and which the old in-process `Promise.race` could
not touch: that raced a timer against a promise and merely *abandoned* the loser, leaving
the parse running.

A repo that blows the cap becomes an ordinary red row naming the repo, the cap and the
elapsed time, and the run carries on to the next repo:

```
n8n exceeded the 900000ms per-repo cap and was killed after 900412ms (signal SIGTERM).
Raise --timeout-ms, or reproduce alone with `node tools/qa-loop/run.mjs --repos n8n`.
```

A child that dies without writing a row (`ChildCrashError`) or writes an unreadable one
(`ChildResultError`) is red the same way. Nothing is ever silently absent.

## Honest limits

- **`rssMb` now measures one repo**, because one repo owns the process — but it includes
  the Node interpreter's own baseline (a few tens of MB), so it is a footprint with a
  constant floor, not a pure attribution.
- **`stemFlow.ts` is loaded as TypeScript source** via Node's type stripping (Node ≥ 22.18).
  There is no compiled copy of the web package; its imports there are type-only, so this
  works — but it is the one place the harness does not read a `dist/` artefact.
- **The clone cache lives outside this repo** (`$SEQUENCE_QA_CACHE`, else
  `<tmpdir>/sequence-qa-cache`) so a benchmark repo can never be scanned as part of Sequence.
- **The full tier clones several very large repositories** (strapi, n8n, spring-boot,
  terraform). Budget disk and time before running it.
