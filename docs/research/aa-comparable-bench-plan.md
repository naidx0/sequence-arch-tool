# AA-comparable benches — Sequence on the same landscape

**Owner quote:** Do not half-ass Sequence onto Artificial Analysis. AA is the example of what charts should look like. Take those tests, run them ourselves, then sit on that landscape with a real score. Until then advertise our own named benches (Hermes, Aegis, Hyperform).

**User-seat Done when:** A human can open this file and see (1) which AA components we will run, (2) what Sequence is missing as a Harbor/Pier agent, (3) the named Sequence benches we already plot, (4) a paste block for the bench agent. Sequence does not appear as a bar or scatter dot on the AA Index until a row exists in `docs/research/data/aa-coding-agents-snapshot.json` from **our** run.

**Inverted-fix ban:** Do not copy Claude Code / Cursor CLI / OpenCode AA scores onto a Sequence bar. Do not plot Sequence at 0. Do not label shopfront Game B as DeepSWE. Do not call file-stuffing “Claude Code.”

**Status:** 2026-08-13. Research only. No Sequence DeepSWE / Terminal-Bench / SWE-Atlas score exists.

---

## Two landscapes (do not mix)

| Landscape | What it is | Sequence today |
| --- | --- | --- |
| **Artificial Analysis Coding Agent Index v1.3** | DeepSWE + Terminal-Bench v2 + SWE-Atlas-QnA. Same-model harness bake-off (Claude Code, Cursor CLI, OpenCode). | **Not run.** Snapshot in `docs/research/data/aa-coding-agents-snapshot.json` is copied from AA pages, dated. |
| **Sequence benches** | Hermes, Aegis, Hyperform — our asks, our tokenizer (`approxTokens`), our file-stuffing harness vs the architecture board. | **Plotted.** Cover Aegis is 3.1k vs 50,000. |

The workflow: keep AA’s chart language (2×2, named tests, logos, lower/higher-is-better subheads). Run the **same three AA tests** with Sequence as the agent under test. Then, and only then, add a Sequence row next to Claude Code / Cursor CLI / OpenCode.

---

## What AA actually runs (so we can run it)

Retrieved 2026-08-13 from [Artificial Analysis Coding Agents](https://artificialanalysis.ai/agents/coding-agents). Components:

| AA name on site | Upstream | How you run it | Sequence adapter today |
| --- | --- | --- | --- |
| Deep Software Engineer | [DeepSWE](https://github.com/datacurve-ai/deep-swe) (113 Harbor tasks, program verifiers) | `uv tool install datacurve-pier` then `pier run -p deep-swe/tasks --agent <agent> --model <model>` | **None.** Pier drives `mini-swe-agent`, `claude-code`, `codex`, `gemini-cli`, `opencode`. Not Sequence. |
| Terminal Bench | Terminal-Bench v2 (Harbor) | Harbor / Pier `--agent` on the TB v2 task pack AA cites | **None.** Sequence has no headless Harbor agent. |
| Software Engineer Atlas | [SWE-Atlas Codebase QnA](https://github.com/comandopetra-spec/SWE-Atlas) | Harbor + Modal (or Docker); example configs under `run_config/` | **None.** |

Cost/time: DeepSWE tasks allow ~90 min agent budget; full 113-task Modal run is a keyed, paid session. A 10-task subset (`--n-tasks 10 --sample-seed 0`) is the honest first Sequence score — labeled **subset**, not Index.

**Blocker:** Sequence is a local visual harness (`pnpm app` / analyzer ask loop + architecture board). It is not a Pier/Harbor `--agent`. Comparable results need a headless driver that: takes a task workspace, calls Sequence tools / ask, writes a patch or answer, exits. Until that adapter exists, Sequence cannot sit on the AA chart.

---

## Named Sequence benches we advertise now

These are **our** names, on **our** tests. Them = file-stuffing agent (list / grep / read), not a logged-in Claude Code run.

| Name | Ask / fixture | Sequence | Them | Chart |
| --- | --- | --- | --- | --- |
| **Hermes** | “Break down a Hermes agent…” empty board | **1312** + 6-node seqd | **14061**, no board | Lower is better |
| **Aegis** | Shopfront architecture board vs stuffed window | **3.1k** (exact 3073) flat at every 50,000 bucket | Filled **50,000** then **200,000** | Lower is better |
| **Hyperform** | This monorepo “what is fragile?” | Digest **25948** / prompt ~26854 | **200,000** filled window | Lower is better |

OpenCode on Aegis (named CLI, 2026-08-13): **19,129** input tokens at a 50,000 haystack — did not fill the window. Claude Code not logged in. Cursor CLI not on PATH. That is a named-CLI probe on **Aegis**, not an AA Index score.

Grounded edges (shopfront 15/15 and named truths) stay a fourth cell: higher is better, these graphs not all GitHub.

---

## Paste into the benchmark agent

```
Run Sequence onto the Artificial Analysis landscape — do not fake a score.

Landscape (AA Index v1.3, we already snapshot their numbers):
1. DeepSWE via Pier (datacurve-ai/deep-swe)
2. Terminal-Bench v2 via Harbor/Pier
3. SWE-Atlas-QnA via Harbor (comandopetra-spec/SWE-Atlas)

Sequence is not a Pier/Harbor --agent today. First job: say whether a
headless Sequence adapter is feasible this session (analyzer ask +
tools on a task workspace, write patch/answer, exit). If not, write
UNFINISHED and stop — do not plot Sequence on AA.

If an adapter exists:
- Same model string on all three Sequence runs, written down.
- Start with DeepSWE --n-tasks 10 --sample-seed 0. Label it subset.
- Record date, pier/harbor version, model, task count, pass rate,
  tokens if the runner emits them.
- Append a Sequence row to docs/research/data/aa-coding-agents-snapshot.json
  only from that run. Source: "our run", not "copied from AA".
- Then the site may draw Sequence on the AA 2x2.

Do not copy Claude Code 27 onto a Sequence DeepSWE bar.
Do not mix Aegis 3.1k onto the AA axis.
Do not name file-stuffing Claude Code.

Until that JSON row exists, the site keeps Sequence off the AA chart
and advertises Hermes / Aegis / Hyperform instead.
```

---

## Site lock

- AA panel: Claude Code, Cursor CLI, OpenCode + “we did not run” + Sequence **not plotted**.
- Ours panel: Hermes, Aegis, Hyperform with Sequence vs file-stuffing.
- Cover Aegis: 3.1k vs 50,000. Exact 3073 in the footnote.
