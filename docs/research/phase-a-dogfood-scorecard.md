# Phase A dogfood scorecard (M1–M7)

**Status:** template · **Program:** [`v2-next-phase-mega-plan.md`](v2-next-phase-mega-plan.md) §2  
**Rule:** fill from measured asks only. Do not invent p50/p95 or “beats LangGraph.”

Use after ≥2 weeks dogfood **or** N≥50 design-draw asks (whichever first). Source rows from ask trajectory `askMetrics` (`wallMs`, `rounds`, `stopReason`, `designMode`, tokens) plus seat notes.

Harness (canned, not M1): [`phase-a-metrics-harness.md`](phase-a-metrics-harness.md) — `node tools/bench/phase-a-metrics-report.mjs`.

| ID | Metric | How | Target | Sample (date / N) | Result | Notes |
|----|--------|-----|--------|-------------------|--------|-------|
| M1 | Ask wall (design draw/show on board) | Turn elapsed + provider spans | p50 &lt; 45s, p95 &lt; 2m | | | |
| M2 | Tool rounds per design-draw | Provider rounds in askPipeline | ≤ 2 clear draws | | | |
| M3 | Output honesty | % turns with visible raw tool/seqd JSON | &lt; 5% | | | |
| M4 | Board open rate | % draw asks that open Architecture without click | ≥ 90% | | | |
| M5 | Session trust | New chat empty board; title summary; timer = last prompt | 100% on 20 rebuilds | | | |
| M6 | Time to useful board | Shopfront attach → readable graph | &lt; 60s | | | |
| M7 | Preference probe | Weekly: prefer Sequence for architecture vs Claude Code? | Honest yes for topology | | | |

## Latency split (fix dominant term first)

| Window | LLM time | Tool time | Round count | Dominant |
|--------|----------|-----------|-------------|----------|
| | | | | |

## Exit (A7)

- [ ] Scorecard filled for a named dogfood week
- [ ] Owner walk: New chat empty board + design draw &lt; 2m + theater + Accept
- [ ] Phase A PR merged; HANDOFF tip-bump → Phase B (docs lane)
