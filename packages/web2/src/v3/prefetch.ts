/* ══════════════════════════════════════════════════════════════════════════
   WARM THE ARCHITECTURE TAB BEFORE THE CLICK
   packages/web2/src/v3/prefetch.ts

   A pointer on the Architecture tab starts what the board needs on mount and
   would otherwise fetch after the click: its lazy chunk (the visual strip; the same import() specifiers the board uses, so the
   same chunks) and the ELK layout worker. The graph itself is read by the
   boot ladder (boot/bootSequence.ts) whatever tab is open, so there is
   nothing to start for it here. Once per page.

   The worker is started through `prewarmLayoutWorker` in canvas/layout.ts
   when that export exists (canvas belongs to the views lane); without it the
   chunks are still warmed.
   ══════════════════════════════════════════════════════════════════════════ */

let warmed = false;

export function prefetchArchitecture(): void {
  if (warmed) return;
  warmed = true;
  void import('../canvas/visual/VisualMetaStrip.js').catch(() => {});
  void import('../canvas/layout')
    .then((m) => (m as { prewarmLayoutWorker?: () => void }).prewarmLayoutWorker?.())
    .catch(() => {});
}

/** Tests only: let the next call warm again. */
export function resetPrefetchForTests(): void {
  warmed = false;
}
