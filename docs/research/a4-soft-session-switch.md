# A4.4 — Soft session switch (reload vs hydrate-in-place)

**Status:** investigation · **Date:** 2026-08-28 · **Program:** mega-plan A4.4  
**Binding honesty:** session Architecture is **per-chat** (`boardSeqd` / A1). Soft switch must not reintroduce shared-board leaks.

## Options

| Approach | How | Pros | Cons |
|----------|-----|------|------|
| **A — Reload (shipped)** | Session switch remounts / reloads store paths that own Architecture + transcript | Matches A1.5 lock (New chat empty board); simple; no stale DocProvider | Brief flash; loses ephemeral UI (open rail filter, scrubber) |
| **B — Hydrate in place** | Keep shell; swap session id, PUT/GET `boardSeqd`, replace chat turns | Feels faster; preserves chrome | Easy to leave prior session’s `canvas` / DocProvider / proposal ghosts; harder locking tests |

## Ruling for now

**Keep A (reload)** until a hydrate path has:

1. Locking test: session A Accept → switch to B → Architecture empty / different doc id (already `boardSeqdSession.test.tsx`).
2. Explicit clear of canvas slice, proposals, and rail selection on every switch.
3. No shared `sequence.arch-scratch.workspace` fallback.

## Done when

- [x] Tradeoffs documented (this note).
- [ ] Implement B only if owner still feels reload lag after A1 honesty is proven in dogfood.

## Inverted-fix ban

Do not “speed up” switch by keeping the previous board visible under a new session title.
