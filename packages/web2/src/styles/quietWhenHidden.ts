/* ══════════════════════════════════════════════════════════════════════════
   QUIET WHEN HIDDEN (S4, Part 7 R13)
   packages/web2/src/styles/quietWhenHidden.ts

   Sets `data-hidden` on the root while the page is hidden (another window, a
   minimised app, a background tab), and clears it when it is shown again.
   tokens/graphite.css pauses every running CSS animation under that attribute,
   so no loader, shimmer or edge flow repaints a window nobody can see.
   ══════════════════════════════════════════════════════════════════════════ */

export function quietWhenHidden(doc: Document = document): () => void {
  const sync = (): void => {
    doc.documentElement.toggleAttribute('data-hidden', doc.visibilityState === 'hidden');
  };
  sync();
  doc.addEventListener('visibilitychange', sync);
  return () => doc.removeEventListener('visibilitychange', sync);
}
