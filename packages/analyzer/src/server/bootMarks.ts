/* ══════════════════════════════════════════════════════════════════════════
   BOOT MARKS — where the server's start goes, from process start to the
   first GET /api/status 200
   packages/analyzer/src/server/bootMarks.ts

   The desktop's own stage marks (tools/desktop-smoke.mjs) showed the server is
   about 570 of the ~950 ms to the composer, and one number cannot say which
   part. These are the parts, on `performance.now()` (ms since this process
   started):

     modulesLoaded   cli.js's static imports are evaluated
     serverCreate    createRepoServer entered
     signature       the attached repo's content signature is computed
     graphFromCache  | graphScanned   the graph is ready, and how
     routesReady     createRepoServer returns
     listening       the socket is bound
     status200       the first GET /api/status is answered

   Recorded always (a few numbers, once) and printed only with
   SEQUENCE_BOOT_PROFILE=1: one stderr line, `SEQUENCE_BOOT [...]`, on the
   first status answer. Nothing is recorded after that, so a long-lived server
   that attaches repos all day does not grow this list.
   ══════════════════════════════════════════════════════════════════════════ */

export interface BootMark {
  name: string;
  ms: number;
}

const marks: BootMark[] = [];
let reported = false;

/* Reachable by an in-process harness without importing this module twice. */
(globalThis as { __sequenceBootMarks?: BootMark[] }).__sequenceBootMarks = marks;

export function bootMark(name: string): void {
  if (reported) return;
  marks.push({ name, ms: Math.round(performance.now()) });
}

export function bootMarks(): readonly BootMark[] {
  return marks;
}

/** The first GET /api/status answer closes the record, and prints it when asked to. */
export function reportBootOnce(env: NodeJS.ProcessEnv = process.env, write: (s: string) => void = (s) => process.stderr.write(s)): void {
  if (reported) return;
  bootMark('status200');
  reported = true;
  if (env.SEQUENCE_BOOT_PROFILE === '1') write(`SEQUENCE_BOOT ${JSON.stringify(marks)}\n`);
}
