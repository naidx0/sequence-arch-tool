# The belt's second question — refuted: the model never asks for a picture

**Four arms, 2026-09-08T03:56:53Z–04:18:15Z, one card hold (1,282 s) plus an earlier 5 s hold that
aborted, `granite42-hermes`, the real `sequence` repo, three turns an arm, interleaved
control/treatment, tree at `5ebc100d`.**

> **MODEL NOTE, added 2026-09-08 when the workspace default changed.** Every number on this page was measured on **`granite42-hermes`, Q4_K_M**, on a local endpoint. `.sequence/ai.json` now defaults to `minicpm5-hermes` (Q8_0), and `model_bench.py` scores 13/13 for both — the bench does not discriminate between them, so the switch is a choice rather than a measured win. **Nothing here transfers to another model or another quantisation**, and a comparison arm must name both.


## The registered clause

> **Clause 1:** with the flag on, at least one of the three turns **renders a chart**, in both runs.
> **Refuted if both runs give three turns and no picture.** *This is the whole question and it is
> binary on purpose.*

| arm | `SEQUENCE_ASK_TRIM_TOOLS` | turns | proposed | drawn | refused | verdict |
|---|---|---|---|---|---|---|
| control | off | 3 | 0 | 0 | 0 | **NO_PICTURE** |
| treatment | **on** | 3 | 0 | 0 | 0 | **NO_PICTURE** |
| control | off | 3 | 0 | 0 | 0 | **NO_PICTURE** |
| treatment | **on** | 3 | 0 | 0 | 0 | **NO_PICTURE** |

**Both treatment runs gave three turns and no picture. Clause 1 is REFUTED.**

**The control did the same**, so removing the `TOOLS` section changed nothing about whether an
engineer gets a picture.

## The number that makes this a finding rather than a null: `proposed 0`

Across **twelve turns in four arms, the outer marker never appeared once.** The model did not draw
and be refused; **it never asked to draw at all.** `propose_chart` was not called on a single turn of
a dependency question — the exact question a diagram answers.

That distinction only exists because the witness reads three things:

- `[data-testid="ai-canvas-chart"] [data-testid="seqchart"]` — a frame drew;
- `[data-testid="seqchart-fail"]` — the product decided to draw and then refused;
- the outer marker alone — an article holding neither, a fourth state nobody has seen.

**`refused 0` and `unaccounted 0` in every arm.** So the earlier concern that a chart *refusal* might
be scored as a picture is moot on this data — with `proposed 0` there was nothing to mis-score, and
the two derivations (nested and unnested) agree exactly. **The correction cost a sentence, as
predicted; it would have cost the result if the model had proposed anything.**

## What it does not say

- **Not that the product cannot draw.** The Architecture board renders the scanned graph from a scan
  with no turn at all, and `propose_chart` survives on a non-teach ask — it is in
  `ASK_TOOL_ALLOWLIST`, not mutating, and not filtered by `askToolsForJobMode`. The path is open and
  unused.
- **Not that the belt suppresses it.** Control and treatment are identical here. The belt condition's
  fifteenfold rise in tool calls was measured on **teach** turns where the derived chart already
  fires; those arms could never have supported a claim about an engineer's picture, which is why that
  sentence was withdrawn before this run rather than after it.
- **Not a claim about other models or questions.** One model, one conversation shape, two runs a side.

## What it does say

**On a first-tier ask, the chart tool is reachable, documented, and not reached for.** The gap is not
that the product refuses to draw for an engineer — it is that nothing on that path ever asks it to.
The derived-chart fallback that fires on teach turns is gated on `input.teach === true`, so an
engineer's turn has neither the fallback nor a model that calls the tool.

**That is a product finding, not an instrument one**, and it is the first in this line.

## The harness, which can now report on itself

**Eight invocations produced four records.** Every one is in `tools/bench/out/picture-arm.log`:

| | |
|---|---|
| measurement aborts | **4**, all `exit=4 reason=stale-build` |
| measurement records | **4**, all `exit=0` |
| proof runs | 0 in this file (the earlier proof lines were cleared with it) |

**Before tonight those four aborts would have left nothing** — no file, no line, indistinguishable
from arms nobody started. `docs/BACKLOG.md` item 2 was written about exactly that gap in the
referents runner, and this arm was built with the fix rather than repeating it.

**The stale half was the CLIENT, and finding out cost an hour.** A test file edited after the last
web2 build counts as a source, so `/api/build` reported the client bundle behind its source while the
server half was current. My own pre-flight check compared `analyzer/dist` against `analyzer/src` and
reported *"build current? yes"* — **one of the two halves the guard checks.** The guard was right and
the check that was supposed to anticipate it was half-blind.

**And the log needed an `intent` field to be readable.** Four earlier lines were written by deliberate
exit-proving runs; read without intent they say *the environment is broken*, and a reader concluded
exactly that. The record was accurate about what happened and silent about what it was for. With
`intent=` the same file distinguished a proof from a genuine `stale-build` abort — which is how the
real blocker was confirmed.

## Cost

**1,282 seconds of card for the four arms**, plus 5 seconds for the aborted hold. Two earlier
attempts were stopped without spending: one over a witness that would have scored a refusal as a
picture, one over the stale client half.
