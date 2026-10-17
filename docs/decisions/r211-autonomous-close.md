# MADR — r211 autonomous product close

- **Status:** Active (loop r211)
- **Date:** 2026-08-04
- **Branch:** `mxcr/r211-product-close-4b6c`
- **Models:** Grok 4.5 = plan/MADR · Composer 2.5 = BUILD only
- **Parent run:** BUILD MAIN (`bc-3067586e-f136-4ed4-988e-fdea79ba4b6c`)

## Context

Tier-completion P0–P6 foundation closed at r210 on `main`. Owner asked for an
autonomous close: stop loose agents, slim overlapping agent rules, fix subagent
failure modes, verify harness-at-bar, brand/site consistency (Structural +
shadcn/Radix primitives), and ship remaining codeable work without supervision.

## Decision

1. **No explore swarms this round.** Subagent failures are diagnosed
   (`docs/research/subagent-failure-diagnosis.md`): context bomb + autonomous-loop
   skill misfire + parallel explore overlap. BUILD waves only, CONTEXT DIET,
   max one retry on stop.
2. **At-bar claim (local-first harness):** coded product-final §11 greens + moat
   L1–L3 locks hold. Remaining 🟡 are owner gates (gateway deploy, Mermaid
   aesthetic, BYO live English verify) or honesty gaps in docs — not missing
   core harness code.
3. **r211 ships three waves:**
   - **A — Agent-doc diet:** AGENTS / HANDOFF-RESTART / CLAUDE READ list /
     skill description / stale OPEN rows / product-final L1 honesty / P0 boxes.
   - **B — Site brand:** Structural Engineering book compliance + no shadcn-CLI
     drift (site stays static; app uses Radix+Polarity per `ui-primitives.md`).
   - **C — Chrome zone bottoms:** journey/loop/coach bottom chrome collision
     audit + NativeBoard residual tldraw-zone comments; Polarity/Radix adoption
     gaps that mislead.
4. **Do not fake deploy / billing / signing.** Escalate those; leave honest 🟡.
5. **SUB BLOAT** (`bc-5e5be4ce…`, branch `cursor/site-brand-fixes-42b9`) is IDLE —
   do not resume it; Wave B owns site on this branch.

## Consequences

- Fresh agents read a short AGENTS + HANDOFF-RESTART pointing at **post-P6**.
- Site and brand book stay one system; app chrome stays Polarity + Radix, not
  wholesale shadcn Tailwind.
- Loop floor matches docs: r210 closed → r211 = hygiene + honesty + brand/site.

## Gate

```bash
pnpm -r build
pnpm --filter @sequence/web test
pnpm test   # if time; at least schema + web
# e2e bindings when Chromium present — skip cleanly otherwise
```

## Wave A — done (agent-doc diet)

- AGENTS.md: post-P6 / r210 current program + CONTEXT DIET bullet
- HANDOFF-AGENT-RESTART.md: paste block + tables → post-P6 follow-ons
- CLAUDE.md: shrunk READ THESE FIRST; rest → Reference (on demand)
- owner-feedback-log OPEN: tldraw superseded; r97 rows → SHIPPED
- product-final §11 Draw→logic → ✅ (holistic matrix alignment)
- orchestration plan P0 boxes [x]; MADR paths → `docs/decisions/`
- autonomous-loop skill description: explicit-phrase trigger only
