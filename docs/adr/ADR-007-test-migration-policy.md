# ADR-007 — Binding tests move with their surfaces; never deleted, never weakened

- **Status:** Accepted (2026-07-24)
- **Drives:** `v20-plan.md` Phase 1 (and any future surface move)

## Context

The standing gate (`vision.md` §7) locks feature bindings with asserting e2e suites — e.g.
`test:e2e:scratch` asserts double-click-create on the Scratch board. ADR-001 retires Scratch as
a surface. A naive implementation would delete the suite, which is indistinguishable from
reward-hacking (the gate's own anti-goal).

## Decision

When a surface moves or folds into another, its binding tests **migrate with the capability**:

1. The assertion is **re-targeted** at the capability's new home (double-click-create → the one
   canvas in empty-draft design mode) in the same commit that moves the surface.
2. The suite may be **renamed**; the rename and its justification are recorded in the round
   note (`loop-log.md`) and `vision.md` §7 is updated in the same commit.
3. The assertion's strength may only stay equal or grow. A migration that loosens what is
   asserted is a gate violation, not a migration.
4. A capability that is genuinely dropped (with owner sign-off) has its test removed in a
   commit that *says so explicitly* — never buried in a refactor.

## Consequences

- Phase 1 ships `e2e/scratch-create.mjs` re-targeted (and likely renamed) with the gate list
  updated atomically; CI skip-on-browserless behavior is preserved.
- Reviewers treat any silently vanished test as a HIGH finding.

## Alternatives considered

- **Delete + write a fresh test later** — rejected: opens a window where the gate lies.
- **Keep the old suite green against a dead surface** — rejected: tests must measure the
  product that exists.
