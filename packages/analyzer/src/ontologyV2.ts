/* ══════════════════════════════════════════════════════════════════════════
   ONTOLOGY v2 — api and external nodes, apiId on edges
   packages/analyzer/src/ontologyV2.ts

   docs/research/overhaul-formats-v2.md §3.1. Pure, and additive: a v1 reader
   still finds every node and edge it knew, with the same ids.

     api       one per registered route, `api:<svcId>:<METHOD> <path>`, under the
               service that registers it (built from the routes the scan
               already collects).
     external  one per host the code calls that no scanned service owns,
               `ext:<host>`, no parent (the joiner draws the edges).
     apiId     on a matched http edge: the api node it lands on. `dstId` is
               unchanged (the route file), so old readers keep working.
   ══════════════════════════════════════════════════════════════════════════ */

import { apiNodeId, externalNodeId, type ArchEdge, type ArchNode } from '@sequence/schema';

export interface RouteLike {
  service: string;
  method: string;
  path: string;
  file: string;
  line: number;
}

export function apiNodes(routes: readonly RouteLike[], nodeIds: ReadonlySet<string>): ArchNode[] {
  const out = new Map<string, ArchNode>();
  for (const r of routes) {
    const svc = `svc:${r.service}`;
    if (!nodeIds.has(svc)) continue;
    const id = apiNodeId(svc, r.method, r.path);
    if (out.has(id)) continue;
    out.set(id, {
      id,
      kind: 'api',
      label: `${r.method.toUpperCase()} ${r.path}`,
      parentId: svc,
      meta: { evidenceRef: `${r.file}:${r.line}` },
    } as ArchNode);
  }
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function externalNodes(hosts: ReadonlyArray<{ host: string; file: string; line: number }>): ArchNode[] {
  return hosts.map(
    (h) =>
      ({
        id: externalNodeId(h.host),
        kind: 'external',
        label: h.host,
        meta: { evidenceRef: `${h.file}:${h.line}` },
      }) as ArchNode,
  );
}

/** Sets `apiId` on every http edge whose matched route has an api node. */
export function linkApis(edges: ArchEdge[], apiIds: ReadonlySet<string>): void {
  for (const e of edges) {
    if (e.kind !== 'http') continue;
    const target = e.detail?.targetService;
    const matched = e.detail?.matchedRoute;
    if (typeof target !== 'string' || typeof matched !== 'string') continue;
    const space = matched.indexOf(' ');
    if (space < 0) continue;
    const id = apiNodeId(`svc:${target}`, matched.slice(0, space), matched.slice(space + 1));
    if (apiIds.has(id)) e.apiId = id;
  }
}
