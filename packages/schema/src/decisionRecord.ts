/**
 * Grounded architecture decision records (ADR-009).
 *
 * Pure, browser-safe builder: every section traces to real computed facts
 * (`computeRisks`, `computeCycles`, `computeImpact`) or the applied patch by
 * real id. Optional model prose is filtered against the allow-set — a claim
 * keyed to no fact is dropped. Works key-free: structural summaries always emit.
 *
 * Diagram mermaid text is NOT produced here (schema stays independent of
 * `@sequence/export`); callers attach `diagrams.before` / `diagrams.after`
 * before `decisionRecordToMarkdown`.
 */
import type { ArchEdge, ArchGraph, ArchNode, EdgeKind, NodeKind } from './index.js';
import { computeCycles } from './cycles.js';
import { computeImpact } from './impact.js';
import { computeRisks, rankableNodeCount, type RiskNode } from './risks.js';

export interface AppliedNode {
  id: string;
  kind: NodeKind;
  label: string;
}

export interface AppliedEdge {
  id: string;
  srcId: string;
  dstId: string;
  kind: EdgeKind;
}

/** The applied graph change — nodes/edges by real id only. */
export interface AppliedPatch {
  addedNodes: AppliedNode[];
  addedEdges: AppliedEdge[];
  removedNodeIds: string[];
  removedEdgeIds: string[];
}

/** A genuinely presented option that was not chosen. */
export interface RejectedAlternative {
  title: string;
  rationale: string;
  patch: AppliedPatch;
}

export interface DecisionRecordInput {
  before: ArchGraph;
  after: ArchGraph;
  patch: AppliedPatch;
  /** Rejected proposals / discarded patches — only real alternatives. */
  alternatives?: RejectedAlternative[];
  /** ADR sequence number (caller assigns via directory scan). */
  number: number;
  /** Short title, e.g. "Add a read cache in front of postgres". */
  title: string;
  /** ISO date (YYYY-MM-DD); defaults to today UTC. */
  date?: string;
  /** Optional model prose per section — filtered by allow-set before render. */
  prose?: {
    context?: string;
    decision?: string;
    consequences?: string;
  };
  /** Mermaid source from a pure projection (ADR-008); attached by the caller. */
  diagrams?: {
    before?: string;
    after?: string;
  };
}

export interface DecisionRecord {
  number: number;
  title: string;
  status: 'Accepted' | 'Superseded';
  date: string;
  context: {
    risks: Array<{ nodeId: string; label: string; severity: string; reason: string }>;
    cycles: Array<{ nodeIds: string[]; labels: string[]; reason: string }>;
    summary: string;
    prose?: string;
  };
  decision: {
    patch: AppliedPatch;
    summary: string;
    prose?: string;
  };
  consequences: {
    impacts: Array<{
      nodeId: string;
      label: string;
      beforeBlast: number;
      afterBlast: number;
    }>;
    summary: string;
    prose?: string;
  };
  alternatives: RejectedAlternative[];
  diagramScope: { before: string[]; after: string[] };
  diagrams?: { before?: string; after?: string };
  /** Grounded node/edge ids prose may reference. */
  allowedFactIds: string[];
}

const ADR_FILENAME_RE = /^ADR-(\d{3})-/i;

/** Derive the applied patch by diffing two design graphs (real ids only). */
export function diffAppliedPatch(before: ArchGraph, after: ArchGraph): AppliedPatch {
  const beforeNodeIds = new Set((before.nodes ?? []).map((n) => n.id));
  const afterNodeIds = new Set((after.nodes ?? []).map((n) => n.id));
  const beforeEdgeIds = new Set((before.edges ?? []).map((e) => e.id));
  const afterEdgeIds = new Set((after.edges ?? []).map((e) => e.id));

  const nodeByIdAfter = new Map((after.nodes ?? []).map((n) => [n.id, n]));

  return {
    addedNodes: (after.nodes ?? [])
      .filter((n) => !beforeNodeIds.has(n.id))
      .map((n) => ({ id: n.id, kind: n.kind, label: n.label })),
    addedEdges: (after.edges ?? [])
      .filter((e) => !beforeEdgeIds.has(e.id))
      .map((e) => ({ id: e.id, srcId: e.srcId, dstId: e.dstId, kind: e.kind })),
    removedNodeIds: (before.nodes ?? []).filter((n) => !afterNodeIds.has(n.id)).map((n) => n.id),
    removedEdgeIds: (before.edges ?? []).filter((e) => !afterEdgeIds.has(e.id)).map((e) => e.id),
  };
}

/** Collect repo-relative ADR filenames and return the next unused number. */
export function nextDecisionRecordNumber(existingFilenames: Iterable<string>): number {
  let max = 0;
  for (const name of existingFilenames) {
    const base = name.split('/').pop() ?? name;
    const m = ADR_FILENAME_RE.exec(base);
    if (m) max = Math.max(max, Number.parseInt(m[1], 10));
  }
  return max + 1;
}

/** Slug for ADR filename from title. */
export function decisionRecordSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function riskNodes(graph: ArchGraph): RiskNode[] {
  return (graph.nodes ?? [])
    .filter((n): n is ArchNode => !!n && typeof n.id === 'string')
    .map((n) => ({ id: n.id, kind: n.kind, label: n.label }));
}

function labelById(graph: ArchGraph): Map<string, string> {
  return new Map((graph.nodes ?? []).map((n) => [n.id, n.label]));
}

/** Node ids touched by the patch plus one-hop neighbors (diagram scope). */
export function patchDiagramScope(
  patch: AppliedPatch,
  graph: ArchGraph,
): string[] {
  const touched = new Set<string>();
  for (const n of patch.addedNodes) touched.add(n.id);
  for (const id of patch.removedNodeIds) touched.add(id);
  for (const e of patch.addedEdges) {
    touched.add(e.srcId);
    touched.add(e.dstId);
  }
  for (const id of patch.removedEdgeIds) {
    const edge = (graph.edges ?? []).find((e) => e.id === id);
    if (edge) {
      touched.add(edge.srcId);
      touched.add(edge.dstId);
    }
  }
  touched.delete('repo');
  return [...touched].sort();
}

function structuralDecisionSummary(patch: AppliedPatch, labels: Map<string, string>): string {
  const parts: string[] = [];
  for (const n of patch.addedNodes) {
    parts.push(`Add **${n.label}** (\`${n.id}\`, ${n.kind})`);
  }
  for (const e of patch.addedEdges) {
    const src = labels.get(e.srcId) ?? e.srcId;
    const dst = labels.get(e.dstId) ?? e.dstId;
    parts.push(`Connect **${src}** → **${dst}** via \`${e.kind}\` (\`${e.id}\`)`);
  }
  for (const id of patch.removedNodeIds) {
    parts.push(`Remove node \`${id}\` (${labels.get(id) ?? 'unknown'})`);
  }
  for (const id of patch.removedEdgeIds) {
    parts.push(`Remove edge \`${id}\``);
  }
  return parts.length ? parts.join('. ') + '.' : 'No structural change recorded.';
}

function structuralConsequencesSummary(
  impacts: DecisionRecord['consequences']['impacts'],
): string {
  if (!impacts.length) return 'No blast-radius change on affected nodes.';
  const deltas = impacts
    .filter((i) => i.beforeBlast !== i.afterBlast)
    .map(
      (i) =>
        `**${i.label}** (\`${i.nodeId}\`): blast radius ${i.beforeBlast} → ${i.afterBlast}`,
    );
  return deltas.length
    ? deltas.join('; ') + '.'
    : 'Blast radius unchanged on affected nodes.';
}

function structuralContextSummary(
  risks: DecisionRecord['context']['risks'],
  cycles: DecisionRecord['context']['cycles'],
): string {
  const parts: string[] = [];
  if (risks.length) {
    parts.push(
      `${risks.length} risk${risks.length === 1 ? '' : 's'} in scope` +
        (risks[0] ? ` (top: **${risks[0].label}**, ${risks[0].severity})` : ''),
    );
  }
  if (cycles.length) {
    parts.push(`${cycles.length} circular dependenc${cycles.length === 1 ? 'y' : 'ies'} in scope`);
  }
  return parts.length ? parts.join('; ') + '.' : 'No elevated risks or cycles in the affected scope.';
}

/**
 * Drop prose sentences that reference node/edge ids outside the allow-set.
 * Ungrounded claims are removed; structural summaries are unaffected.
 */
export function filterGroundedProse(prose: string | undefined, allowedIds: Set<string>): string | undefined {
  if (!prose?.trim()) return undefined;
  const idRe = /`([^`]+)`/g;
  const sentences = prose.split(/(?<=[.!?])\s+/);
  const kept = sentences.filter((s) => {
    let m: RegExpExecArray | null;
    idRe.lastIndex = 0;
    while ((m = idRe.exec(s)) !== null) {
      if (!allowedIds.has(m[1])) return false;
    }
    return true;
  });
  const out = kept.join(' ').trim();
  return out || undefined;
}

function affectedNodeIds(patch: AppliedPatch): Set<string> {
  const ids = new Set<string>();
  for (const n of patch.addedNodes) ids.add(n.id);
  for (const id of patch.removedNodeIds) ids.add(id);
  for (const e of patch.addedEdges) {
    ids.add(e.srcId);
    ids.add(e.dstId);
  }
  return ids;
}

/** Build a grounded decision record from before/after graphs and the applied patch. */
export function buildDecisionRecord(input: DecisionRecordInput): DecisionRecord {
  const {
    before,
    after,
    patch,
    alternatives = [],
    number,
    title,
    date = new Date().toISOString().slice(0, 10),
    prose,
    diagrams,
  } = input;

  const nodes = riskNodes(before);
  const edges = (before.edges ?? []) as ArchEdge[];
  const affected = affectedNodeIds(patch);

  const allRisks = computeRisks(edges, nodes);
  const scopedRisks = allRisks.filter((r) => affected.has(r.nodeId));

  const allCycles = computeCycles(edges, nodes);
  const scopedCycles = allCycles.filter((c) => c.nodes.some((id) => affected.has(id)));

  const labelsBefore = labelById(before);
  const labelsAfter = labelById(after);

  const impacts: DecisionRecord['consequences']['impacts'] = [];
  for (const id of [...affected].sort()) {
    if (id === 'repo') continue;
    const beforeImpact = computeImpact(before.edges ?? [], id);
    const afterImpact = computeImpact(after.edges ?? [], id);
    if (!beforeImpact.exists && !afterImpact.exists) continue;
    impacts.push({
      nodeId: id,
      label: labelsAfter.get(id) ?? labelsBefore.get(id) ?? id,
      beforeBlast: beforeImpact.impactedBy.length,
      afterBlast: afterImpact.impactedBy.length,
    });
  }

  const allowedFactIds = new Set<string>();
  for (const n of before.nodes ?? []) allowedFactIds.add(n.id);
  for (const e of before.edges ?? []) {
    allowedFactIds.add(e.id);
    allowedFactIds.add(e.srcId);
    allowedFactIds.add(e.dstId);
  }
  for (const n of after.nodes ?? []) allowedFactIds.add(n.id);
  for (const e of after.edges ?? []) {
    allowedFactIds.add(e.id);
    allowedFactIds.add(e.srcId);
    allowedFactIds.add(e.dstId);
  }
  for (const alt of alternatives) {
    for (const n of alt.patch.addedNodes) allowedFactIds.add(n.id);
    for (const e of alt.patch.addedEdges) allowedFactIds.add(e.id);
  }

  const allowedSet = allowedFactIds;

  const contextRisks = scopedRisks.map((r) => ({
    nodeId: r.nodeId,
    label: r.label,
    severity: r.severity,
    reason: r.reason,
  }));
  const contextCycles = scopedCycles.map((c) => ({
    nodeIds: c.nodes,
    labels: c.labels,
    reason: c.reason,
  }));

  const diagramScope = {
    before: patchDiagramScope(patch, before),
    after: patchDiagramScope(patch, after),
  };

  return {
    number,
    title,
    status: 'Accepted',
    date,
    context: {
      risks: contextRisks,
      cycles: contextCycles,
      summary: structuralContextSummary(contextRisks, contextCycles),
      prose: filterGroundedProse(prose?.context, allowedSet),
    },
    decision: {
      patch,
      summary: structuralDecisionSummary(patch, labelsAfter),
      prose: filterGroundedProse(prose?.decision, allowedSet),
    },
    consequences: {
      impacts,
      summary: structuralConsequencesSummary(impacts),
      prose: filterGroundedProse(prose?.consequences, allowedSet),
    },
    alternatives,
    diagramScope,
    diagrams,
    allowedFactIds: [...allowedSet].sort(),
  };
}

function formatAlternatives(alts: RejectedAlternative[]): string {
  if (!alts.length) return '_None recorded._';
  return alts
    .map((a) => `- **${a.title}** — ${a.rationale}`)
    .join('\n');
}

function formatDiagramBlock(source: string | undefined, caption: string): string {
  if (!source?.trim()) return '';
  return `\n### ${caption}\n\n\`\`\`mermaid\n${source.trim()}\n\`\`\`\n`;
}

/** Render a decision record as markdown matching this repo's ADR shape. */
export function decisionRecordToMarkdown(record: DecisionRecord): string {
  const num = String(record.number).padStart(3, '0');
  const lines: string[] = [
    `# ADR-${num} — ${record.title}`,
    '',
    `- **Status:** ${record.status} (${record.date})`,
    '',
    '## Context',
    '',
    record.context.prose ?? record.context.summary,
  ];

  if (record.context.risks.length) {
    lines.push('', 'Grounded risks in scope:');
    for (const r of record.context.risks) {
      lines.push(`- **${r.label}** (\`${r.nodeId}\`, ${r.severity}): ${r.reason}`);
    }
  }
  if (record.context.cycles.length) {
    lines.push('', 'Circular dependencies in scope:');
    for (const c of record.context.cycles) {
      lines.push(`- ${c.labels.join(' ↔ ')}: ${c.reason}`);
    }
  }

  lines.push(
    '',
    '## Decision',
    '',
    record.decision.prose ?? record.decision.summary,
  );

  if (record.decision.patch.addedNodes.length || record.decision.patch.addedEdges.length) {
    lines.push('', 'Applied patch:');
    for (const n of record.decision.patch.addedNodes) {
      lines.push(`- Node \`${n.id}\` (${n.kind}): **${n.label}**`);
    }
    for (const e of record.decision.patch.addedEdges) {
      lines.push(`- Edge \`${e.id}\`: \`${e.srcId}\` → \`${e.dstId}\` (${e.kind})`);
    }
  }

  const structural = record.decision.patch.removedNodeIds.length > 0 ||
    record.decision.patch.removedEdgeIds.length > 0;
  if (structural && record.diagrams?.before) {
    lines.push(formatDiagramBlock(record.diagrams.before, 'Before'));
  }

  lines.push(
    '',
    '## Consequences',
    '',
    record.consequences.prose ?? record.consequences.summary,
  );

  if (record.consequences.impacts.length) {
    lines.push('', 'Blast radius (before → after):');
    for (const i of record.consequences.impacts) {
      if (i.beforeBlast !== i.afterBlast) {
        lines.push(`- **${i.label}** (\`${i.nodeId}\`): ${i.beforeBlast} → ${i.afterBlast} dependents`);
      }
    }
  }

  if (record.diagrams?.after) {
    lines.push(formatDiagramBlock(record.diagrams.after, structural ? 'After' : 'Scope'));
  }

  lines.push(
    '',
    '## Alternatives considered',
    '',
    formatAlternatives(record.alternatives),
    '',
  );

  return lines.join('\n');
}

/** Filename for a new decision record (never overwrites — caller must verify absent). */
export function decisionRecordFilename(record: DecisionRecord): string {
  const num = String(record.number).padStart(3, '0');
  const slug = decisionRecordSlug(record.title) || 'decision';
  return `ADR-${num}-${slug}.md`;
}
