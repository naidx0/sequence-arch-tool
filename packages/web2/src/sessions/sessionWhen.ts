import { spanLabel } from '../activity/activityModel';

/**
 * When a session was last touched, as one short token: `1m`, `1h`, `8d`.
 *
 * Uses the same coarse register as Activity rows (`spanLabel`) so the sidebar
 * matches Runs timing. Refreshed by the panel on a minute tick while mounted —
 * a sleeping tab may read stale by one bucket, which is acceptable for a list
 * the reader is not watching continuously.
 *
 * Sub-minute ages are HIDDEN. Owner walk 2026-09-16: opening a catalog chat
 * without sending anything still read `4s` / `now`, which looked like activity
 * that never happened. The server already refuses to bump `updatedAt` on a
 * bare open; the rail must not invent a live clock either.
 */
export function sessionWhenLabel(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const delta = Math.max(0, now - t);
  if (delta < 60_000) return '';
  return spanLabel(delta);
}
