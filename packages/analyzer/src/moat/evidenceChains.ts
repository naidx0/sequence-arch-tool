/**
 * Trace service-level impact edges back to scan evidence (file:line).
 *
 * The digest's `risks` section and ask-intent blast-radius answers both project
 * the ArchGraph through {@link serviceLevelRisksInput} before running
 * `computeImpact` / `computeRisks`. This module collects the underlying evidence
 * anchors for each lifted edge so tests can lock the honesty chain:
 * impact edge → contributing ArchEdge(s) → real file:line on disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ArchGraph, Evidence } from '@sequence/schema';
import { liftToTopLevel, serviceLevelRisksInput } from '../explain/serviceGraph.js';

export interface ImpactEvidenceChain {
  srcId: string;
  dstId: string;
  anchors: Evidence[];
}

/** Service-level impact edges with every contributing scan-evidence anchor. */
export function impactEvidenceChains(graph: ArchGraph): ImpactEvidenceChain[] {
  const { edges: impactEdges } = serviceLevelRisksInput(graph);
  const lift = liftToTopLevel(graph);
  return impactEdges.map((ie) => {
    const anchors: Evidence[] = [];
    for (const e of graph.edges) {
      if (!e || e.kind === 'import') continue;
      const src = lift(e.srcId);
      const dst = lift(e.dstId);
      if (src?.id !== ie.srcId || dst?.id !== ie.dstId) continue;
      for (const ev of e.evidence ?? []) anchors.push(ev);
    }
    return { srcId: ie.srcId, dstId: ie.dstId, anchors };
  });
}

/** Whether `ev.file:ev.line` resolves inside `repoRoot` on disk. */
export function evidenceExistsOnDisk(repoRoot: string, ev: Evidence): boolean {
  if (!ev || typeof ev.file !== 'string' || typeof ev.line !== 'number') return false;
  const fp = path.join(repoRoot, ev.file);
  if (!fs.existsSync(fp)) return false;
  const lines = fs.readFileSync(fp, 'utf8').split(/\r?\n/);
  return ev.line >= 1 && ev.line <= lines.length;
}
