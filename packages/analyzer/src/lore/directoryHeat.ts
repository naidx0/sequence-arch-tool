/**
 * Team Lore — directory heat rollup (pure, no AI).
 *
 * Grounded signals only: risk severity from {@link computeRisks} and cycle
 * membership from {@link computeCycles}. Each repo-relative file path earns a
 * weight from the highest-severity risk node it traces to, plus a cycle bonus;
 * weights roll up to directory segments and propagate a decayed max (0.7) up
 * the ancestor chain.
 */
import type { ArchGraph, ArchNode } from '@sequence/schema';
import { computeCycles, type SystemRisk, type RiskSeverity } from '@sequence/schema';

/** Decayed-max factor when bubbling child directory heat to a parent. */
export const HEAT_DECAY = 0.7;

/** v1 weight table — high / medium / low risk tiers plus cycle membership. */
export const HEAT_WEIGHT = {
  high: 3,
  medium: 2,
  low: 1,
  cycle: 2,
} as const;

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function dirname(filePath: string): string {
  const normalized = normPath(filePath);
  const idx = normalized.lastIndexOf('/');
  return idx <= 0 ? '' : normalized.slice(0, idx);
}

function riskTierWeight(severity: RiskSeverity): number {
  if (severity === 'critical' || severity === 'high') return HEAT_WEIGHT.high;
  if (severity === 'moderate') return HEAT_WEIGHT.medium;
  return 0;
}

function fileWeight(
  inCycle: boolean,
  severity: RiskSeverity | undefined,
): number {
  let base = severity ? riskTierWeight(severity) : 0;
  if (base === 0 && inCycle) base = HEAT_WEIGHT.low;
  if (inCycle) base += HEAT_WEIGHT.cycle;
  return base;
}

function buildIndex(graph: ArchGraph): {
  byId: Map<string, ArchNode>;
  pathToNodeIds: Map<string, string[]>;
} {
  const byId = new Map<string, ArchNode>();
  const pathToNodeIds = new Map<string, string[]>();
  for (const n of graph.nodes) {
    byId.set(n.id, n);
    if (n.path) {
      const p = normPath(n.path);
      const ids = pathToNodeIds.get(p) ?? [];
      ids.push(n.id);
      pathToNodeIds.set(p, ids);
    }
  }
  return { byId, pathToNodeIds };
}

function ancestorChain(nodeId: string, byId: Map<string, ArchNode>): string[] {
  const out: string[] = [nodeId];
  let cur = byId.get(nodeId);
  while (cur?.parentId) {
    out.push(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return out;
}

function maxSeverity(
  nodeIds: Iterable<string>,
  riskByNode: Map<string, RiskSeverity>,
): RiskSeverity | undefined {
  let best: RiskSeverity | undefined;
  let bestW = 0;
  for (const id of nodeIds) {
    const sev = riskByNode.get(id);
    if (!sev) continue;
    const w = riskTierWeight(sev);
    if (w > bestW) {
      bestW = w;
      best = sev;
    }
  }
  return best;
}

function nodeInCycle(nodeIds: Iterable<string>, cyclicNodes: ReadonlySet<string>): boolean {
  for (const id of nodeIds) if (cyclicNodes.has(id)) return true;
  return false;
}

/**
 * Map repo-relative directory paths → heat score. Keys use POSIX `/` segments
 * relative to the scanned repo root (same shape as `ArchNode.path` directories).
 */
export function directoryHeatMap(
  graph: ArchGraph,
  risks: SystemRisk[],
): Map<string, number> {
  const riskByNode = new Map<string, RiskSeverity>();
  for (const r of risks) riskByNode.set(r.nodeId, r.severity);

  const cyclicNodes = new Set<string>();
  for (const cycle of computeCycles(graph.edges, graph.nodes)) {
    for (const id of cycle.nodes) cyclicNodes.add(id);
  }

  const { byId, pathToNodeIds } = buildIndex(graph);
  const fileWeights = new Map<string, number>();

  const allFiles = new Set<string>();
  for (const n of graph.nodes) {
    if (n.path) allFiles.add(normPath(n.path));
  }
  for (const e of graph.edges) {
    for (const ev of e.evidence ?? []) {
      if (ev.file) allFiles.add(normPath(ev.file));
    }
  }

  for (const file of allFiles) {
    const related = new Set<string>();
    for (const id of pathToNodeIds.get(file) ?? []) {
      for (const anc of ancestorChain(id, byId)) related.add(anc);
    }
    for (const e of graph.edges) {
      for (const ev of e.evidence ?? []) {
        if (normPath(ev.file) !== file) continue;
        for (const id of [e.srcId, e.dstId]) {
          for (const anc of ancestorChain(id, byId)) related.add(anc);
        }
      }
    }
    const w = fileWeight(nodeInCycle(related, cyclicNodes), maxSeverity(related, riskByNode));
    if (w > 0) fileWeights.set(file, w);
  }

  const dirHeat = new Map<string, number>();
  for (const [file, w] of fileWeights) {
    const dir = dirname(file);
    if (dir === '') continue;
    dirHeat.set(dir, Math.max(dirHeat.get(dir) ?? 0, w));
  }

  const byDepth = [...dirHeat.keys()].sort(
    (a, b) => b.split('/').length - a.split('/').length,
  );
  for (const dir of byDepth) {
    const parent = dirname(dir);
    if (parent === '' || parent === dir) continue;
    const propagated = (dirHeat.get(dir) ?? 0) * HEAT_DECAY;
    if (propagated > 0) {
      dirHeat.set(parent, Math.max(dirHeat.get(parent) ?? 0, propagated));
    }
  }

  return dirHeat;
}

/** Map a continuous heat score to a discrete rail tint level 0–3. */
export function heatLevelFromScore(score: number): 0 | 1 | 2 | 3 {
  if (score <= 0) return 0;
  if (score < 2) return 1;
  if (score < 4) return 2;
  return 3;
}
