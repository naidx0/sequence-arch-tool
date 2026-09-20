/**
 * MAY THIS SEAT TYPE AN ASK THAT COULD REACH A MODEL?
 *
 * Written after a seat read put a ten-second model call on another lane's GPU
 * card. The card lock said `lane=mlharness`; the seat typed anyway, because
 * nothing in it had ever read the lock. `gpu-lock.mjs check` existed by then and
 * did not help: it guards SCRIPTS, and this was a person's ask going through the
 * product.
 *
 * The rule: while another lane holds the card, the seat types nothing unless the
 * ask is one the product refuses WITHOUT a provider call.
 *
 * ── WHY THE CHECK IS LOCAL AND NOT AN API PROBE ──────────────────────────
 *
 * The obvious probe — POST the ask and see whether it comes back
 * `source: 'lesson'` — IS the call we are trying to avoid. If the answer is "not
 * refused", the model has already run. So the verdict is computed from the
 * product's OWN `subjectlessRefusal` over the served repository's graph: the
 * same function the route calls, one step earlier, with nothing on the wire.
 *
 * That is a deviation from "ask the API", and it is the safe direction: a false
 * "would be refused" is caught immediately by the seat seeing a real answer, and
 * a false "would not be refused" only costs a skipped run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The lane holding the card, when it is NOT this one. Null means "go ahead":
 * no lock configured, no lock file, or the lock is ours.
 *
 * An unreadable lock returns the string 'unreadable' rather than null — a lock
 * that cannot be parsed is not permission, and this is the same rule as the
 * reaper that refuses to clear what it cannot decide.
 */
export function foreignLaneHolds(lockPath, lane) {
  if (typeof lockPath !== 'string' || lockPath === '') return null;
  if (!fs.existsSync(lockPath)) return null;
  let text;
  try {
    text = fs.readFileSync(lockPath, 'utf8');
  } catch {
    return 'unreadable';
  }
  const held = /lane=(\S+)/.exec(text)?.[1];
  if (held === undefined) return 'unreadable';
  return held === lane ? null : held;
}

/**
 * Would this ask be refused before any provider call?
 *
 * Uses the built product, so the seat and the route cannot disagree about what
 * "refusable" means. Returns false when the answer cannot be computed — an
 * unknown is not a permission.
 */
export async function wouldBeRefusedWithoutACall(repoRoot, ask, distDir) {
  try {
    const u = (p) => pathToFileURL(path.join(distDir, p)).href;
    const { scanRepo } = await import(u('scan.js'));
    const { buildQueue, subjectlessRefusal } = await import(u('server/lessonState.js'));
    const graph = await scanRepo(repoRoot, { cluster: true });
    return subjectlessRefusal(ask, buildQueue(graph, ask)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * WHICH HALF OF THE PRODUCT IS BEHIND, from `/api/build`.
 *
 * The stamp reports two halves; every caller that acts on staleness needs the
 * same reading of it, or they drift — and the reason this file exists at all is
 * that the server half and the client half of one commit were in two packages
 * and nobody was comparing them.
 *
 * Returns `{ server, client }` booleans plus a one-line `why` naming the stale
 * half with its two times, or null when the endpoint cannot be read: an app that
 * cannot say what it is running is not evidence that it is current.
 */
export function staleHalves(stamp) {
  if (stamp === null || typeof stamp !== 'object') return null;
  const half = (h) => (h !== null && typeof h === 'object' && h.stale === true);
  const server = half(stamp.server);
  const client = half(stamp.client);
  const parts = [];
  if (server) parts.push(`server built ${stamp.server.builtAt} against source ${stamp.server.sourceAt}`);
  if (client) parts.push(`client bundle built ${stamp.client.builtAt} against source ${stamp.client.sourceAt}`);
  return {
    server,
    client,
    /* The process half is separate: the code moved after this process loaded it,
       which a rebuild does not fix and a restart does. */
    process: stamp.stale === true && !server && !client,
    why: parts.length === 0 ? null : parts.join('; '),
  };
}

/** The pnpm filter that rebuilds a half, for a caller that wants to fix it. */
export const REBUILD = {
  server: ['--filter', '@sequence/analyzer', 'build'],
  client: ['--filter', '@sequence/web2', 'build'],
};
