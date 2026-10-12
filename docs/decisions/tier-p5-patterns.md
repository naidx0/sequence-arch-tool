# Tier-3 Layer 3 — Resilience patterns catalog v1 (P5)

- **Status:** Accepted **scope** (catalog content fills in P5; types/validators scaffolded in P0)
- **Phase:** `tier-completion-orchestration-plan.md` Phase 5 · Tier-3 test spec Layer 3 (spec deleted 2026-08-20; in git history)
- **Related:** `packages/schema/src/moat/index.ts` · ADR-010

## Context

Moat layer 3 (`vision.md` §2.3) is industry-correct design advice: resilience patterns and
starters that cite **checker rules grounded in schema/scan evidence**, never LLM-invented
topology. P0 shipped empty catalogs + validators; P5 fills content and advisor UI.

## Decision — v1 catalog scope

### In scope for patterns v1 (≥3 grounded patterns)

| Pattern id | Intent (appliesWhen sketch) | Checker discipline |
|------------|------------------------------|--------------------|
| `read-cache` | Read-heavy path to a datastore with no cache hop in evidence | Rule cites real read edge / missing cache node — not "you should use Redis" prose |
| `circuit-breaker` | Downstream call fan-out without isolation / timeout evidence | Rule ids map to harness checker, not freeform advice |
| `idempotent-consumer` | Queue/topic consumer without idempotency evidence | Same — `checkerRules[]` required or pattern invalid |

Types already fixed in schema:

```ts
ResiliencePatternId = 'read-cache' | 'circuit-breaker' | 'idempotent-consumer' | …
ResiliencePattern = { id, domain, appliesWhen, checkerRules: CheckerRuleRef[] }
```

Validators (`validateResilienceCatalog`) reject missing id/domain/appliesWhen or empty
`checkerRules`. **No pattern ships without at least one grounded checker rule ref.**

### Industry starters (P5 companion)

- `IndustryStarter` with `groundedOnly: true` ⇒ every service/node must trace to manifest or
  scan evidence; `fragmentIds` are compose-valid fragments only.
- Empty-repo starter picker offers a **bounded** set (≤N); each load passes `validateGraph`.

### Out of scope for v1 (do not claim)

- Generative "design the whole system from a prompt" without scan anchors.
- Patterns that only exist as chat prose with no `checkerRules`.
- Claiming hosted free-tier advisor without deploy (P6 owner gate).
- Expanding past the three core ids above before the advisor + e2e binding are green.

## Done when (P5 checklist excerpt)

- [ ] `RESILIENCE_PATTERNS` length ≥ 3; `validateResilienceCatalog` clean
- [ ] `resiliencePatterns.test.ts` / `industryStarters.test.ts` green
- [ ] `patternAdvisor` / `resilienceAdvisor` list only precondition-matching patterns
- [ ] Integration: draw → propose → pattern checker → Accept; violation names rule id
- [ ] `resilience-advisor.mjs` binding: suggestion or honest empty state on shopfront

## Consequences

- P5 builders fill `packages/schema/src/moat/` catalogs and advisor panels; they must not invent
  pattern ids outside the grounded set without extending types + tests in the same wave.
- Advisor **dismiss must not mutate the graph** (advisory only until user Accepts a proposal).
- Fabrication risk register (orchestration plan): patterns without checker rules are a ship block.

## Alternatives considered

- **LLM-authored pattern library** — rejected: contradicts grounded/never-fabricate invariant.
- **Huge catalog before advisor** — rejected: three locked patterns + advisor > twenty hollow rows.
- **Silent auto-apply of patterns** — rejected: propose→act; user Accepts.
