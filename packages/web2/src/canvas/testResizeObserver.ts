/**
 * A ResizeObserver for jsdom, for the board's render tier only.
 *
 * WHY IT IS HERE AND NOT IN `test/setup.ts`: that file is shared infrastructure
 * and this lane does not own it. One agent per file is the rule that cost this
 * project a repair cycle when it was broken, and a stub installed globally
 * would change what every other lane's tests run against.
 *
 * WHY A STUB IS HONEST HERE, which is the part worth arguing rather than
 * assuming. jsdom implements no layout at all, so a real ResizeObserver would
 * have nothing to report: every box is 0 x 0. @xyflow/react constructs one
 * unconditionally at mount (`dist/esm/index.js:1298`) and throws without it, so
 * the choice is not "accurate observer or stub" — it is "stub, or no render
 * tier for the board".
 *
 * WHAT THAT COSTS, STATED: no assertion in this tier may be about a MEASURED
 * size, because the stub never fires and the sizes would be zero anyway. Every
 * size question — the field's transform, the card's height, the radii, the
 * contrast — is asked in `boardRendered.test.ts`, in a real browser. The stub
 * exists so the DOM can be inspected, never so a measurement can be faked.
 */

class NoLayoutResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Call once at the top of a board render test. Idempotent, and it never
 *  replaces a real implementation if the environment has one. */
export function installResizeObserver(): void {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = NoLayoutResizeObserver as unknown as typeof ResizeObserver;
  }
}
