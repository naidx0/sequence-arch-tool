/* ══════════════════════════════════════════════════════════════════════════
   THE ANNOTATE CLIENT — Wave 2, Decision 6.
   packages/web2/src/canvas/annotateClient.ts

   POST /api/annotate has been built and served since the understand layer
   landed (POST /api/annotate in packages/analyzer/src/server/repoServer.ts)
   and was called by nothing. This file is the call.

   THE WIRE SHAPE IS THE SERVER'S, VERBATIM:

     { annotations: Record<nodeId, string[]>,   // grounded bullets per real id
       mode: 'ai' | 'none',
       provider?: string,
       detailLevel: 'regular' | 'advanced' }

   The route's own contract does the grounding for us: ids are validated
   against the scanned graph server-side ("Every key in annotations MUST be a
   component id taken VERBATIM from the digest"), so a key here that no board
   node carries simply renders nowhere — there is nothing to filter twice.

   CALM ABSENCE, AND IT IS THE WHOLE ERROR STRATEGY. The route answers 200 with
   `{annotations:{}, mode:'none'}` when no provider is bound; this origin may be
   a static host that answers index.html; the request may be aborted by a
   rescan. Every one of those is "no English for these cards" — a fact about
   the surface's inputs, not a failure the board should wear chrome for. So the
   only outcomes are a validated map or `{}`, and the caller renders absence.

   SAME-ORIGIN ONLY, like every other lane: production is same-origin and
   development proxies /api, so there is no absolute URL to add.
   ══════════════════════════════════════════════════════════════════════════ */

import type { NodeId } from '../state/types.js';

export type Annotations = Record<NodeId, string[]>;

/**
 * Validate an untyped body INTO the shape the state slice stores, dropping
 * anything that is not id → string[]. Exported because it is the part worth
 * locking: a malformed provider payload must degrade to fewer bullets, never
 * to rendered `[object Object]`s.
 */
export function annotationsFrom(body: unknown): Annotations {
  if (body === null || typeof body !== 'object') return {};
  const raw = (body as { annotations?: unknown }).annotations;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Annotations = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const bullets = value.filter((line): line is string => typeof line === 'string');
    if (bullets.length === 0) continue;
    out[id] = bullets;
  }
  return out;
}

/**
 * POST /api/annotate. Resolves to the validated map, or `{}` on ANY outcome
 * that is not a JSON body carrying one — unreachable, refused, HTML fallback,
 * malformed. It throws for nothing except a same-origin violation, which is a
 * programmer error rather than a wire outcome.
 */
export async function fetchAnnotations(
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
): Promise<Annotations> {
  let response: Response;
  try {
    response = await fetchImpl('/api/annotate', { method: 'POST', signal });
  } catch {
    // Unreachable or aborted — both are calm absence.
    return {};
  }
  if (!response.ok) return {};
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {}; // A static host answered index.html. Not English. Calm.
  }
  return annotationsFrom(body);
}

/* ── FINDING F8 — ONE SCAN, AT MOST ONE ASK ───────────────────────────────
   `ConnectedBoard` mounts per Board↔Whiteboard tab flip, so an effect keyed on
   `scannedAt` fired POST /api/annotate on EVERY mount while its comment claimed
   "one ask per scan". The memo lives HERE rather than in the component because
   the promise "one scan → at most one fetch" is a fact about the endpoint's
   caching contract (`scannedAt` is the route's own invalidation key), not about
   which component happens to be mounted. A remount answers from this map and
   never touches the wire.

   ── REVIEW ROUND 2, FINDING G1 — ONLY SETTLED ANSWERS ARE ANSWERS ────────

   The map above cached whatever `fetchAnnotations` resolved — and an aborted
   ask resolves to calm `{}` like every other non-answer. So: board mounts on
   scan A, reader flips to Whiteboard before the POST answers, cleanup aborts,
   and `{}` was cached under scan A forever. No annotations for that scan all
   session, invisibly. Three rules fix it, all here and not in the component:

     · An ABORTED ask never enters the map. Calm absence for the mount that
       asked; not a fact about the scan. Only a settled, non-aborted answer
       is cached.
     · While an ask is on the wire, concurrent callers SHARE one promise per
       `scannedAt` rather than double-POSTing.
     · The map holds ONE scan. A new `scannedAt` evicts every older entry —
       the cache is bound to the current scan, not to session length. */
const ANNOTATIONS_BY_SCAN = new Map<string, Annotations>();

/** Asks currently on the wire, at most one per `scannedAt`. */
const IN_FLIGHT = new Map<string, Promise<Annotations>>();

/** Forget the per-scan answers and any asks on the wire. Tests use it; a
 *  rescan does not need to — a new scan carries a new `scannedAt`, evicting
 *  the old entry by itself. */
export function clearAnnotationCache(): void {
  ANNOTATIONS_BY_SCAN.clear();
  IN_FLIGHT.clear();
}

/** The ask, once per scan. `{}` is a real cached answer too — a scan with no
 *  provider bound must not re-ask on every tab flip any more than one with
 *  English on every card. An ABORTED ask resolves to `{}` for its own caller
 *  but caches nothing, so the next mount against the same scan asks again. */
export function annotationsForScan(
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
  scannedAt: string,
): Promise<Annotations> {
  const cached = ANNOTATIONS_BY_SCAN.get(scannedAt);
  if (cached) return Promise.resolve(cached);
  const sharing = IN_FLIGHT.get(scannedAt);
  if (sharing) return sharing;

  const ask: Promise<Annotations> = (async () => {
    try {
      const answer = await fetchAnnotations(fetchImpl, signal);
      /* The initiator's signal is the only one that can abort this wire call.
         If it fired, what came back is silence, not the scan's face — resolve
         calm absence upward, but leave the map (and the seat) free. */
      if (!signal?.aborted) {
        ANNOTATIONS_BY_SCAN.set(scannedAt, answer);
        /* Bound the map to the current scan: a newer scannedAt retires the
           older entries rather than accumulating them. */
        for (const key of [...ANNOTATIONS_BY_SCAN.keys()]) {
          if (key !== scannedAt) ANNOTATIONS_BY_SCAN.delete(key);
        }
      }
      return answer;
    } finally {
      IN_FLIGHT.delete(scannedAt);
    }
  })();
  IN_FLIGHT.set(scannedAt, ask);
  return ask;
}
