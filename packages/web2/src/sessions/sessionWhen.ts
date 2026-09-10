import { spanLabel } from '../activity/activityModel';

/**
 * When a session was last touched, as one short token: `4m`, `1h`, `8d`.
 *
 * Uses the same coarse register as Activity rows (`spanLabel`) so the sidebar
 * matches Runs timing. Refreshed by the panel on a minute tick while mounted —
 * a sleeping tab may read stale by one bucket, which is acceptable for a list
 * the reader is not watching continuously.
 */
export function sessionWhenLabel(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const delta = Math.max(0, now - t);
  return spanLabel(delta);
}
