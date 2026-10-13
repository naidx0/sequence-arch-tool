import type { ArchEdge, ArchGraph, ArchNode, ArchRoute } from '@sequence/schema';

/* ══════════════════════════════════════════════════════════════════════════
   WHAT THE SCAN KNOWS ABOUT ONE NODE — the node sub-surface's model (E5/E6)
   packages/web2/src/canvas/nodeSurface.ts

   Jaden: "Imagine you're in a project and you click on one of the nodes and you
   see a subsurface ... AI analysis ... a button just like generate workflow".

   EVERY FIELD IS READ OFF THE GRAPH; NOTHING IS GUESSED. A field the scan did
   not record is absent from the result and the panel draws no row for it: an
   empty "Routes" heading would read as "this service has no routes", which is a
   claim the scan did not make. Counts are counts of what is listed.
   ══════════════════════════════════════════════════════════════════════════ */

export interface NodeLink {
  id: string;
  label: string;
  kind: string;
  /** The edge kinds that connect them (http, import, queue_publish, ...), once each. */
  via: string[];
  /** How many scanned edges connect the two. */
  count: number;
}

export interface NodeSurface {
  id: string;
  label: string;
  kind: string;
  path?: string;
  /** The scan's own sentence, when it has one (meta.description, else the detail's whatItDoes). */
  description?: string;
  language?: string;
  framework?: string;
  loc?: number;
  owner?: string;
  tags: string[];
  /** Files at or below the node, repo-relative, sorted. */
  files: string[];
  /** Registered endpoints in this service, when the scan recorded routes. */
  routes: ArchRoute[];
  /** What this node's subtree calls, imports or publishes to. */
  dependsOn: NodeLink[];
  /** What calls, imports or consumes this node's subtree. */
  callers: NodeLink[];
  /** Direct children, for a node that has an inside. */
  parts: { id: string; label: string; kind: string }[];
}

/** The node kinds a sub-surface is offered for: things with an inside. */
export const SURFACE_KINDS: ReadonlySet<string> = new Set(['service', 'module', 'datastore', 'topic']);

/** The kinds a user-flow workflow makes sense for: things with pages. */
export const WORKFLOW_KINDS: ReadonlySet<string> = new Set(['service', 'module']);

export function nodeSurface(graph: ArchGraph, nodeId: string): NodeSurface | null {
  const byId = new Map<string, ArchNode>(graph.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return null;

  const inside = (id: string): boolean => {
    for (let cur = byId.get(id), hops = 0; cur && hops < 64; cur = cur.parentId ? byId.get(cur.parentId) : undefined, hops += 1) {
      if (cur.id === nodeId) return true;
    }
    return false;
  };
  /** The nearest thing at or above an endpoint that is not a bare file: the thing a reader names. */
  const named = (id: string): ArchNode | undefined => {
    let cur = byId.get(id);
    for (let hops = 0; cur && cur.kind === 'file' && cur.parentId && hops < 64; hops += 1) cur = byId.get(cur.parentId);
    return cur;
  };

  const files = graph.nodes
    .filter((n) => n.kind === 'file' && n.path && inside(n.id))
    .map((n) => n.path!.replace(/\\/g, '/'))
    .sort((a, b) => a.localeCompare(b));

  const link = (edges: readonly ArchEdge[], otherEnd: (e: ArchEdge) => string): NodeLink[] => {
    const grouped = new Map<string, NodeLink>();
    for (const e of edges) {
      const other = named(otherEnd(e));
      if (!other) continue;
      const row = grouped.get(other.id) ?? { id: other.id, label: other.label, kind: other.kind, via: [], count: 0 };
      row.count += 1;
      if (!row.via.includes(e.kind)) row.via.push(e.kind);
      grouped.set(other.id, row);
    }
    return [...grouped.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  const outgoing = graph.edges.filter((e) => inside(e.srcId) && !inside(e.dstId));
  const incoming = graph.edges.filter((e) => inside(e.dstId) && !inside(e.srcId));

  const routes = (graph.routes ?? []).filter((r) => r.service === node.id || r.service === node.label);

  const detail = (graph as { nodeDetail?: Record<string, { whatItDoes?: string; whatItIs?: string }> }).nodeDetail?.[nodeId];
  const description =
    (typeof node.meta?.description === 'string' && node.meta.description.trim()) ||
    (detail?.whatItDoes && detail.whatItDoes.trim()) ||
    undefined;

  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    ...(node.path ? { path: node.path } : {}),
    ...(description ? { description } : {}),
    ...(typeof node.meta?.language === 'string' ? { language: node.meta.language } : {}),
    ...(typeof node.meta?.framework === 'string' ? { framework: node.meta.framework } : {}),
    ...(typeof node.meta?.loc === 'number' ? { loc: node.meta.loc } : {}),
    ...(node.owner ? { owner: node.owner } : {}),
    tags: node.tags ?? [],
    files,
    routes,
    dependsOn: link(outgoing, (e) => e.dstId),
    callers: link(incoming, (e) => e.srcId),
    parts: graph.nodes.filter((n) => n.parentId === nodeId).map((n) => ({ id: n.id, label: n.label, kind: n.kind })),
  };
}

export type WorkflowAudience = 'auto' | 'admin' | 'customer';

/**
 * THE ASK THAT "GENERATE WORKFLOW" SENDS TO THE CHAT. The node itself rides as a
 * board reference chip (ids, kinds, file paths), so the text carries only the
 * instruction and the audience.
 */
export function workflowAsk(label: string, audience: WorkflowAudience): string {
  const who =
    audience === 'admin'
      ? 'Draw the ADMIN workflow: the pages an administrator of this service moves through.'
      : audience === 'customer'
        ? 'Draw the CUSTOMER workflow: the pages a customer of this service moves through.'
        : 'Decide the audience from the code: an admin interface gets the admin workflow, a customer interface gets the customer workflow.';
  return [
    `Generate the page-to-page user workflow for "${label}" and draw it on a Space.`,
    who,
    'Each page or screen is a node, each path between pages is an arrow labelled with the action, and every outcome the user can choose at a step is its own branch.',
    'Build it only from what the code contains (routes, pages, handlers); where the code does not say, leave the step out and say so.',
  ].join(' ');
}
