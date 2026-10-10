# A6.2 — Path-scoped cache invalidate vs full-tree signature (spike)

**Status:** research Done when · **Date:** 2026-08-28 · **Program:** mega-plan A6  
**Code of record:** `packages/analyzer/src/server/graphCache.ts` (W1.4 per-part cache)

## Question

Does Sequence still pay a full-tree miss on every write (G16 “7–8 s”), or is there a cheaper invalidate story?

## Measured facts (already in `graphCache.ts` header)

| Step | Cost (this monorepo) | Note |
|------|----------------------|------|
| `computeSignature` / part hashes | ~54–78 ms | **Not** the bottleneck |
| Full `scanRepo` after miss | ~3.2–4.5 s | Dominated by per-file `extractFacts` (~79%) |
| Read cached **unchanged** part | ~18 ms | After W1.4 partition |

W1.4 already partitions the **cache** by package-manifest roots (`PART_MANIFESTS` + `<root>`). Editing `packages/mcp` no longer throws away a warm `packages/web` slice. Asking about an unchanged part after a write elsewhere measured **~96 ms** vs **~4.5 s** before (~46×).

## What W1.4 does **not** do

- It does **not** make `scanRepo` incremental. A **changed** part still forces a full scan (global discovery / joins).
- Path-scoped *invalidate* of individual files inside a part is not a separate layer — the part hash already drops that part’s slice.
- Further wins sit in `scan.ts` / shared facts persistence (reuse `extractFacts` across rescans), not another signature scheme.

## Recommendation for A6.3 (cheapest win)

1. **Already shipped:** per-part cache + rescan **progress** UI (A6.1) — keep those; do not invent a second invalidate API.
2. **Next cheap product win:** debounce rapid write→rescan storms (watcher) so the user sees one progress bar, not N overlapping scans.
3. **Larger (defer):** persist per-file facts across rescans so a changed part re-parses only dirty files.

## Done when (this spike)

- [x] Document current signature/cache behavior with measured numbers (this note).
- [x] Name what is NOT incremental (`scanRepo` still whole-repo on miss).
- [x] Point A6.3 at debounce+progress / facts reuse — not a new fake “path % complete” invent.

## Explicit non-claims

Do not market “path-scoped invalidate” as eliminating rescan cost on the edited package. Do not invent % wins beyond the measured ~46× warm-part hit already recorded in `graphCache.ts`.
