# Phase B competitive bakeoff scorecard (B6)

**Owner quote:** Borrow competitor mechanisms; never claim “beats LangGraph / Claude Code” without a named bakeoff row.

**User-seat Done when:** This sheet has measured rows for Game scripts the owner actually ran (tokens, wall time, grounded yes/no). Empty cells stay empty.

**Inverted-fix ban:** Do not invent % wins. Do not fill Claude Code / Cursor CLI rows without keys. Do not mix meters (prompt `approxTokens` vs vendor `usage.input`) without naming the unit. Do not rewrite cover numbers from [`named-bakeoff-shopfront.md`](named-bakeoff-shopfront.md).

**Fixture:** `packages/analyzer/test/fixtures/shopfront`  
**Scripts (B6.1):** pick one per row — “what calls X” / “draw local harness” / Game B ask from the named bakeoff.

| Date | Product / lane | Script | Tokens (unit named) | Wall time | Graph grounded? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| | Sequence (this tip) | | | | | |
| | Claude Code CLI | | | | | owner key |
| | Cursor CLI `agent -p` | | | | | owner key |
| | OpenCode | | | | | |
| | Prior Sequence tip (Phase A baseline) | | | | | for B7.1 draw-path Δ |

## How to fill

1. Attach shopfront (or `--repo` that fixture).
2. Run the same ask text on each product.
3. Record the meter the product actually reports — never convert across meters.
4. Grounded = needles present on the map / citations, not “sounds right.”
5. Paste into [`named-bakeoff-shopfront.md`](named-bakeoff-shopfront.md) only after owner review (B6.3).

## UNFINISHED

| Item | Why empty |
| --- | --- |
| All measured rows | Agent must not invent runs; owner fills where keys allow |
| B7.1 draw-path p50 ≥30% | Needs Phase A baseline + Phase B measured draw asks |

See also: [`phase-a-dogfood-scorecard.md`](phase-a-dogfood-scorecard.md) for M1–M7 honesty metrics.
