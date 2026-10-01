import fs from 'node:fs';
import type { ArchGraph } from '@sequence/schema';

/**
 * Score a scanned graph against a hand-written service-level ground truth.
 * Projection: every interaction edge endpoint is lifted to its owning
 * service / datastore / topic; kinds are compared as families
 * (db_read/db_write/db_access -> db_access).
 */

interface GroundTruth {
  edges: { src: string; dst: string; kind: string }[];
}

export function kindFamily(kind: string): string {
  if (kind.startsWith('db_')) return 'db_access';
  return kind;
}

/**
 * Build a function that lifts a leaf node id to its owning service /
 * datastore / topic label. Shared by scoring and diffing so both always
 * agree on what a "service-level edge" is.
 */
export function buildLift(graph: ArchGraph): (id: string) => string | undefined {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return (id: string): string | undefined => {
    // Guard against a malformed containment cycle (a real scan is a tree, but an
    // imported/persisted graph need not be) so the parent walk can't hang.
    const visited = new Set<string>();
    let cur = byId.get(id);
    while (cur && !visited.has(cur.id)) {
      if (cur.kind === 'service') return cur.label;
      if (cur.kind === 'datastore') return cur.label;
      if (cur.kind === 'topic') return `topic:${cur.label}`;
      visited.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return undefined;
  };
}

export function projectToServiceLevel(graph: ArchGraph): Set<string> {
  const lift = buildLift(graph);
  const out = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind === 'import') continue;
    const src = lift(e.srcId);
    const dst = lift(e.dstId);
    if (!src || !dst || src === dst) continue;
    out.add(`${src} -> ${dst} [${kindFamily(e.kind)}]`);
  }
  return out;
}

export function scoreGraph(
  graphPath: string,
  truthPath: string
): { precision: number; recall: number; report: string } {
  const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8')) as ArchGraph;
  const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8')) as GroundTruth;

  const predicted = projectToServiceLevel(graph);
  const expected = new Set(
    truth.edges.map((e) => `${e.src} -> ${e.dst} [${kindFamily(e.kind)}]`)
  );

  const tp = [...predicted].filter((e) => expected.has(e));
  const fp = [...predicted].filter((e) => !expected.has(e));
  const fn = [...expected].filter((e) => !predicted.has(e));

  const precision = predicted.size === 0 ? 0 : tp.length / predicted.size;
  const recall = expected.size === 0 ? 1 : tp.length / expected.size;

  const lines: string[] = [];
  lines.push(`predicted service-level edges: ${predicted.size}, ground truth: ${expected.size}`);
  lines.push(`true positives: ${tp.length}`);
  for (const e of tp) lines.push(`  ✓ ${e}`);
  lines.push(`false positives: ${fp.length}`);
  for (const e of fp) lines.push(`  ✗ FP ${e}`);
  lines.push(`false negatives: ${fn.length}`);
  for (const e of fn) lines.push(`  ✗ FN ${e}`);
  lines.push('');
  lines.push(`precision: ${(precision * 100).toFixed(1)}%  recall: ${(recall * 100).toFixed(1)}%`);
  lines.push(`gate (spec §3.3): precision >= 80%: ${precision >= 0.8 ? 'PASS' : 'FAIL'}, recall >= 60%: ${recall >= 0.6 ? 'PASS' : 'FAIL'}`);
  return { precision, recall, report: lines.join('\n') };
}
