/**
 * Grounded `scan:…` evidence pointers for SeqDiagram nodes/edges — pure, browser-safe.
 */
import type { ArchEdge, ArchNode, ArchGraph, Evidence } from '@sequence/schema';
import { buildLift, kindFamily } from './project.js';

/** Format one scan evidence record as `scan:<file>:<line>`. */
export function formatScanEvidenceRef(ev: Evidence): string {
  const file = ev.file.replace(/^\/+/, '');
  return `scan:${file}:${ev.line}`;
}

/**
 * Best grounded evidence ref for an arch edge — prefers compose env-var anchors when
 * present, otherwise the first file:line record.
 */
export function archEdgeEvidenceRef(e: ArchEdge): string | undefined {
  const first = e.evidence?.[0];
  if (!first) return undefined;
  const envVar = e.detail?.envVar;
  if (typeof envVar === 'string' && envVar.trim()) {
    const composeSvc = composeServiceFromEvidence(e, first);
    if (composeSvc) return `scan:compose:${composeSvc}:env.${envVar.trim()}`;
  }
  return formatScanEvidenceRef(first);
}

function composeServiceFromEvidence(e: ArchEdge, ev: Evidence): string | undefined {
  const file = ev.file.toLowerCase();
  if (!file.includes('compose') && !file.includes('docker-compose')) return undefined;
  const note = typeof ev.note === 'string' ? ev.note : '';
  const snippet = ev.snippet ?? '';
  const hay = `${note} ${snippet}`;
  const m = hay.match(/service[:\s]+['"]?([a-zA-Z0-9_-]+)/i);
  if (m?.[1]) return m[1];
  const url = e.detail?.url;
  if (typeof url === 'string') {
    const host = url.match(/\/\/([a-zA-Z0-9_-]+)/);
    if (host?.[1]) return host[1];
  }
  return undefined;
}

/** Node-level evidence when the scan recorded a repo-relative path. */
export function archNodeEvidenceRef(n: ArchNode): string | undefined {
  const path = n.path?.trim();
  if (path) return `scan:${path.replace(/^\/+/, '')}:1`;

  /*
   * A node with no FILE of its own can still be traced to one.
   *
   * An inferred datastore is the case that found this: it exists because parsed
   * statements read and write its tables, and the scan records the first of them
   * on `meta.evidenceRef` as `file:line`. Without this the board drew it with no
   * proof chip at all — the one node on the card whose whole justification is a
   * citation, rendered as if nobody had checked. It is not a path, so it cannot
   * come through the branch above; it is a real pointer, so it must not be
   * dropped.
   */
  const cited = n.meta?.evidenceRef;
  if (typeof cited === 'string' && /:\d+$/.test(cited.trim())) return `scan:${cited.trim()}`;
  const desc = n.meta?.description;
  if (typeof desc === 'string' && desc.trim()) {
    // meta.description is scan-derived prose, not a file pointer — omit evidenceRef.
  }
  return undefined;
}

function projectedEdgeKey(src: string, dst: string, family: string): string {
  return `${src}\0${dst}\0${family}`;
}

/**
 * Map projected service-level edge keys to the best evidence ref among member arch edges.
 */
export function projectedEdgeEvidenceRefs(graph: ArchGraph): Map<string, string> {
  const lift = buildLift(graph);
  const out = new Map<string, string>();
  for (const e of graph.edges) {
    if (e.kind === 'import') continue;
    const src = lift(e.srcId);
    const dst = lift(e.dstId);
    if (!src || !dst || src.label === dst.label) continue;
    const family = kindFamily(e.kind);
    const key = projectedEdgeKey(src.label, dst.label, family);
    const ref = archEdgeEvidenceRef(e);
    if (!ref) continue;
    if (!out.has(key)) out.set(key, ref);
  }
  return out;
}

export { projectedEdgeKey };
