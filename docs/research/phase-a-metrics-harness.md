# Phase A metrics harness (A2.1 / A3.6)

**Status:** code + locking tests · **Program:** mega-plan Phase A  
**Rule:** do not invent M1–M7 greens. Canned wallMs is not live latency.

## What it measures

| Metric | Source | Honest use |
|--------|--------|------------|
| M2 rounds | `runDesignDrawBaseline` askMetrics | Harness ≤2 rate on canned scripts |
| M4 board open | `topology:proposal` / `canvas:block` in stream | Proxy matching web2 auto-open lock |
| M3 residual dumps | A3 honesty fixtures after salvage | Fixture rate ≠ seat dogfood % |
| M1 wall | — | **Owner live asks only** (trajectory `askMetrics.wallMs`) |

## Run

```bash
pnpm --filter @sequence/analyzer build
node tools/bench/phase-a-metrics-report.mjs          # writes tmp/phase-a-metrics-harness-report.*
node tools/bench/phase-a-metrics-report.mjs --write-docs  # also docs/research/ (label before citing)
```

Locking tests: `design-draw-baseline.test.ts` (packaged under analyzer `pnpm test`).

## Scorecard path

1. Run harness → confirm M2/M3/M4 **harness** rows.
2. For M1 (and live M3/M4): real asks → `.sequence/trajectory/<runId>.json` → `askMetrics`.
3. Paste **measured** numbers into [`phase-a-dogfood-scorecard.md`](phase-a-dogfood-scorecard.md).
