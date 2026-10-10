/* ══════════════════════════════════════════════════════════════════════════
   A READ MADE BEFORE BOOT SETTLES IS ALREADY THE READ FOR THE BOOT ROOT
   packages/web2/src/app/bootRead.ts

   Measured 2026-10-05 (tools/measure/first-board.mjs, shopfront, cold): the
   sessions rail and the goal-run hook each read once at mount, while the
   client did not yet know the attached root, and then read the same route
   again in the render where boot settled and the root arrived. The server
   keys those routes on its own attached root, which is the root boot then
   reports, so the second read asked the same question twice.

   This decides, for an effect that re-runs on a root, whether the read it made
   last time still answers. Only the boot transition is excused: a root that
   changes after boot (attach, switch) is a different answer and is read again.
   ══════════════════════════════════════════════════════════════════════════ */

export interface RootRead {
  /** Whether boot had settled (`state.net.reachable !== null`) when this read was keyed. */
  booted: boolean;
  /** The root the client knew at that moment; null when it knew none. */
  root: string | null;
  /** Everything else the read depends on (client, session id). Compared by identity. */
  deps: readonly unknown[];
}

export function readStillAnswers(prev: RootRead | null, next: RootRead): boolean {
  if (prev === null) return false;
  if (prev.deps.length !== next.deps.length) return false;
  if (prev.deps.some((d, i) => !Object.is(d, next.deps[i]))) return false;
  /* Only the render where boot settles is excused. */
  if (prev.booted || !next.booted) return false;
  /* Boot settled and nothing else moved, or it brought the root the server already had. */
  return prev.root === next.root || prev.root === null;
}
