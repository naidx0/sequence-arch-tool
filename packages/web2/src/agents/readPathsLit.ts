/* I10, UI half (plan 3.9): the services whose files an agent run read, as board node ids. */

export interface GraphNodeLike {
  id: string;
  parentId?: string | null;
  path?: string | null;
  file?: string | null;
  kind?: string | null;
}

const norm = (p: string): string => p.replace(/[\\]/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

/** `AgentRun.readPaths` arrives from the backend; absent on older runs. */
export function readPathsOf(run: object): string[] {
  return (run as { readPaths?: string[] }).readPaths ?? [];
}

/**
 * The top-level node (the service) that holds each repo-relative path read, de-duplicated, in scan order.
 * A path no scanned node owns lights nothing.
 */
export function readNodeIds(readPaths: readonly string[], nodes: readonly GraphNodeLike[]): string[] {
  if (readPaths.length === 0) return [];
  const wanted = new Set(readPaths.map(norm));
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const lit = new Set<string>();
  for (const n of nodes) {
    const own = n.path ?? n.file;
    if (!own || !wanted.has(norm(own))) continue;
    let top = n;
    /* Climb to the service. The scanner's `repo` root sits above every service and is never drawn, so the climb stops at a
       service, or at the node whose parent is a root (no parent of its own). */
    for (let hops = 0; top.kind !== 'service' && top.parentId && hops < 32; hops++) {
      const up = byId.get(top.parentId);
      if (!up || !up.parentId) break;
      top = up;
    }
    lit.add(top.id);
  }
  return [...lit];
}
