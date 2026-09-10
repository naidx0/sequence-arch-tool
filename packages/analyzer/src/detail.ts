import type { ArchEdge, ArchGraph } from '@sequence/schema';
import { buildLift, kindFamily } from './score.js';
import { pathToSegments, segmentsMatch } from './join/join.js';

/**
 * Detail-aware conformance: the additive layer that lets `sequence diff`
 * verify HTTP method/path and DB table — not just service-pair + direction +
 * kind. Kept in its own module (never in score.ts) so the coarse service-level
 * projection every reference gate exercises is provably untouched.
 *
 * Every matcher is *tolerant*: an unspecified (undefined/empty) or wildcard
 * field on EITHER side imposes no constraint. A design author who left a path
 * blank, or a scanner that couldn't recover an HTTP method, must never produce
 * a spurious mismatch — the check only fires when both sides name a concrete,
 * conflicting value.
 */

/** Uppercase; undefined → the wildcard `'*'`. */
export function normalizeMethod(m?: string): string {
  return m ? m.toUpperCase() : '*';
}

/** Methods match when equal after normalization, or either is a wildcard. */
export function methodsMatch(a?: string, b?: string): boolean {
  const na = normalizeMethod(a);
  const nb = normalizeMethod(b);
  return na === nb || na === '*' || nb === '*';
}

/**
 * Paths match when either is unspecified (no constraint), or their normalized
 * segment lists are the same length and equal segment-by-segment with `*`
 * matching anything. Reuses the scanner's own `pathToSegments`/`segmentsMatch`
 * so `{id}`/`:id`/`<id>`/`*` all fold to one wildcard segment — the exact
 * comparison the joiner uses to match a client call against a declared route.
 */
export function pathsMatch(a?: string, b?: string): boolean {
  if (!a || !b) return true;
  return segmentsMatch(pathToSegments(a), pathToSegments(b));
}

/** Tables match when either is unspecified (no constraint), else case-insensitively equal. */
export function tablesMatch(a?: string, b?: string): boolean {
  if (a === undefined || b === undefined) return true;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * A stable, human-readable signature of an edge's scaffoldable detail, for
 * summarizing what an implementation actually wired. `http` → `METHOD path`;
 * `db_*` → `table=<name>`; anything else has no compared detail → `'*'`.
 */
export function detailSignature(
  kind: string,
  detail: Record<string, unknown> | undefined
): string {
  if (kind === 'http') {
    return `${normalizeMethod(detail?.method as string | undefined)} ${
      (detail?.pathPattern as string | undefined) ?? '*'
    }`;
  }
  if (kind.startsWith('db_')) {
    return `table=${((detail?.table as string | undefined) ?? '*').toLowerCase()}`;
  }
  return '*';
}

/**
 * Do two edges of the same coarse kind agree on their compared detail? For
 * `http`: method AND path (tolerantly). For `db_*`: table (tolerantly). For
 * every other kind there is nothing extra to compare (queue topics are already
 * nodes, so redundant with the coarse key) → always true.
 */
export function detailsMatch(
  kind: string,
  a?: Record<string, unknown>,
  b?: Record<string, unknown>
): boolean {
  if (kind === 'http') {
    return (
      methodsMatch(a?.method as string | undefined, b?.method as string | undefined) &&
      pathsMatch(a?.pathPattern as string | undefined, b?.pathPattern as string | undefined)
    );
  }
  if (kind.startsWith('db_')) {
    return tablesMatch(a?.table as string | undefined, b?.table as string | undefined);
  }
  return true;
}

/**
 * Does the implementation (the head-side leaf edges for one service pair)
 * satisfy a single spec (base-side) leaf edge's pinned detail?
 *
 * This is the per-pair decision that drives the mismatch report. It is a
 * deliberate refinement of a naive "some head edge matches this spec edge
 * field-by-field": the scanner emits, for a DB-using service, BOTH real
 * table-access edges (`detail.table` present) AND a connection-level
 * `db_access` edge with NO table (just `detail.database`). A naive per-edge
 * `tablesMatch` treats the tableless edge as an unconstrained wildcard, so it
 * would rescue ANY wrong table — silently reopening the exact v4 gap this phase
 * exists to close (a scaffold writing `widgets` still "conforms" to a spec
 * pinning `tickets`).
 *
 * So for a spec edge that pins a table: if the implementation exposes ANY table
 * for this pair, the pinned table must be among them; only when the table is
 * genuinely undetectable (connection-only, no table-bearing edge at all — the
 * real shared-library / manifest-only case) is it tolerated.
 *
 * HTTP has the exact same twin. http edges do NOT always carry a path: the
 * scanner emits `pathPattern: ''` for a bare-host call with no path segment —
 * e.g. `fetch(process.env.API_URL)`, where `urlPartsToHostAndPath` (join.ts)
 * returns an empty `pathSkeleton`. Because `pathsMatch` treats an empty path as
 * "no constraint", such a path-less edge would silently rescue ANY pinned spec
 * path (a scaffold that never calls `/tickets` still "conforms" to a spec
 * pinning `GET /tickets`) — the HTTP twin of the tableless-db_access loophole.
 * So for a spec edge that pins a concrete path, a path-less impl edge is treated
 * exactly like a tableless db edge: it is not a candidate; only path-bearing
 * impl edges satisfy the pinned path, and only when NO path-bearing impl edge
 * exists at all for the pair (path genuinely undetectable — the bare-host /
 * connection-only case) is the pinned path tolerated. A spec that pins no
 * concrete path (undefined/empty) still imposes no path constraint.
 *
 * Method is deliberately NOT given the path/table treatment. The scanner does
 * emit http edges with an undetected method (`detail.method` undefined — Spring
 * config clients, `methodFromCalleeName` misses), but an undefined verb always
 * means "couldn't recover the verb", never a concrete "this call has no method"
 * (every HTTP call has one). So a method-less impl edge is genuine-unknown, and
 * tolerating it is the intended, tested behavior — not a wrong value passing as
 * conforming. `methodsMatch` therefore stays a pure existential-wildcard match.
 */
export function specEdgeSatisfied(spec: ArchEdge, headLeaves: ArchEdge[]): boolean {
  if (spec.kind.startsWith('db_')) {
    const specTable = spec.detail?.table as string | undefined;
    if (specTable === undefined) return true; // spec pins no table → no constraint
    const tableBearing = headLeaves.filter(
      (h) => (h.detail?.table as string | undefined) !== undefined
    );
    if (tableBearing.length === 0) return true; // table genuinely undetectable → tolerate
    return tableBearing.some((h) => tablesMatch(specTable, h.detail?.table as string | undefined));
  }
  if (spec.kind === 'http') {
    const specPath = spec.detail?.pathPattern as string | undefined;
    // Spec pins no concrete path → path imposes no constraint (existing, tested
    // tolerance). Plain existential on the remaining detail (method).
    if (!specPath) return headLeaves.some((h) => detailsMatch('http', spec.detail, h.detail));
    // Spec pins a concrete path. A path-less impl edge (empty pathPattern) is
    // not evidence the path is wired — mirror the tableless-db case exactly.
    const pathBearing = headLeaves.filter((h) => {
      const p = h.detail?.pathPattern as string | undefined;
      return p !== undefined && p !== '';
    });
    if (pathBearing.length === 0) return true; // path genuinely undetectable → tolerate
    return pathBearing.some((h) => detailsMatch('http', spec.detail, h.detail));
  }
  return headLeaves.some((h) => detailsMatch(spec.kind, spec.detail, h.detail));
}

/**
 * Same traversal and filters as `projectToServiceLevel` (skip `import`, skip
 * self-loops and unliftable endpoints, collapse kinds to families), but instead
 * of a Set of coarse-key strings, keep every underlying leaf edge grouped under
 * its coarse key — so a detail-level cross-comparison can be done per pair.
 *
 * `buildLift`/`kindFamily` are imported from score.ts, never reimplemented, so
 * this always agrees with the coarse projection on what a "service-level edge" is.
 */
export function projectDetailed(graph: ArchGraph): Map<string, ArchEdge[]> {
  const lift = buildLift(graph);
  const out = new Map<string, ArchEdge[]>();
  for (const e of graph.edges) {
    if (e.kind === 'import') continue;
    const src = lift(e.srcId);
    const dst = lift(e.dstId);
    if (!src || !dst || src === dst) continue;
    const key = `${src} -> ${dst} [${kindFamily(e.kind)}]`;
    const arr = out.get(key) ?? [];
    arr.push(e);
    out.set(key, arr);
  }
  return out;
}
