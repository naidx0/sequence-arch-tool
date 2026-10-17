# Open-queue tracks mapped to harness phases

**Status:** living map · **Date:** 2026-08-11 · **Companion:** [`visual-harness-moat-madr.md`](../decisions/visual-harness-moat-madr.md)

## Tracks G / H — owner-driven (not default code)

### Track G — Owner gates (out-of-band)

| Gate | Why not harness 3–5 |
|------|---------------------|
| Gateway deploy / signing | Money/ops; local-first complete without hosted deploy |
| Mermaid aesthetic sign-off | Taste / brand owner gate, not an agent loop |
| Hosted workspaces | Infra product; not required for board-visible harness |

**Done when:** owner explicitly kicks the gate; agents must not code-fake green.

### Track H — ADR-011 Scratch fold

| Item | State |
|------|--------|
| ADR | [`docs/adr/ADR-011-v20-sequencing.md`](../adr/ADR-011-v20-sequencing.md) — Accepted; UI fold deferred |
| Blocker | **Owner sign-off** before one-canvas Scratch fold |
| Ownership | Disjoint from harness chrome (`Workspace` / `ScratchPanel`) |

**Done when:** owner signs off; separate PR with disjoint `may-touch`.

## Parallel tracks already slotted

| Track | Slot | Status |
|-------|------|--------|
| A Trajectory disk | Phase 1 | Shipped (#50) |
| B Skill distill | Phase 3 | Thin seam shipped (#54); LLM bodies / stem clustering still UNFINISHED |
| C `/refine` Accept/Deny | Phase 4 | Thin seam shipped (#54 + #57 bar mount); LLM refine + rollback UI still UNFINISHED |
| D Verify gate | Phase 5 | Thin seam shipped (#54); allowlisted command verify still UNFINISHED |
| E Seqd stream + camera | Parallel | Parked stub (#52) until provider deltas |
| F Plan Tasks → cards | Parallel OF6 | Shipped (#51) |
| G Owner gates | Out-of-band | This doc — do not code-fake |
| H ADR-011 | Sign-off | This doc — owner sign-off required |

**Out-of-band (not harness waves):** ADR-013 Phase E (OAuth/JCode adapters); LoRA/weight training. Phases A–D of ADR-013 are shipped.
