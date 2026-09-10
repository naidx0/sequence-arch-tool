/**
 * ArchGraph ⇄ Architecture Markdown (Wave 1 round-trip core, additive & PURE).
 *
 * A human-readable architecture spec — components with one-line descriptions and
 * labeled flows — that round-trips with the {@link ArchGraph} service-level
 * projection. Both functions are pure, deterministic, and browser-safe (no
 * fs/network/LLM), modeled on `programMermaid.ts`.
 *
 * ── The dialect (what round-trips losslessly) ────────────────────────────────
 * This module targets ITS OWN emitted format, not arbitrary Markdown. What
 * survives a `markdownToArch(archToMarkdown(g))` round-trip on the
 * **service-level projection** (via projectEdges / buildLift):
 *   - each component's `label`, lifted `kind` (service | datastore | topic),
 *     `meta.tech` (or the composed language/framework string), and
 *     `meta.description`;
 *   - each flow's source label, destination label, compact comm kind
 *     (http | grpc | queue | db | import), and detail text.
 *
 * What Markdown deliberately does NOT carry (a spec, not the full graph):
 * evidence, confidence, scan-mode file/module leaves, node positions,
 * pageRank, parentId containment, repo node, and the distinction between
 * queue_publish vs queue_consume (both fold to `queue`) or db_read vs db_write
 * vs db_access (all fold to `db`). Parsed graphs are always `mode:'design'`
 * with origin `'design'` and empty evidence.
 *
 * ── Label hygiene ────────────────────────────────────────────────────────────
 * Labels are plain text in the wire format. Before emit, embedded newlines
 * collapse to a single space and U+2192 RIGHTWARDS ARROW (`→`) becomes `->`
 * so a label cannot break the flow-line ` → ` delimiter.
 *
 * ── Node ids on parse ────────────────────────────────────────────────────────
 * id = slug(label): lowercase, non-alphanumeric runs become `-`, repeated `-`
 * collapsed, leading/trailing `-` trimmed. Empty slug → `node`. On collision,
 * suffix `-2`, `-3`, … in first-seen order.
 *
 * ── Wire shape ───────────────────────────────────────────────────────────────
 *   # <repoName> — Architecture
 *
 *   ## Components
 *   - **<label>** `<kind>` (<tech>) — <description>
 *
 *   ## Flows
 *   - <srcLabel> → <dstLabel>: `<flowKind>` <detail>
 */

import type { ArchGraph, ArchNode, ArchEdge, EdgeKind, NodeKind } from '@sequence/schema';
import {
  projectEdges,
  orderParticipants,
  orderEdgesByFlow,
  participantKinds,
  type LiftedKind,
  type ProjectedEdge,
} from './project.js';

const LIFTED_KINDS: ReadonlySet<string> = new Set<LiftedKind>(['service', 'datastore', 'topic']);
const COMPACT_KINDS: ReadonlySet<string> = new Set(['http', 'grpc', 'queue', 'db', 'import']);

/** Strip characters that would break a single-line Markdown component or flow. */
function sanitizeLabel(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/→/g, '->').trim();
}

/** Display label for a lifted participant key (`topic:foo` → `foo`). */
function displayLabel(participantKey: string): string {
  return participantKey.startsWith('topic:') ? participantKey.slice(6) : participantKey;
}

function findNode(graph: ArchGraph, participantKey: string, kind: LiftedKind): ArchNode | undefined {
  const label = displayLabel(participantKey);
  return graph.nodes.find((n) => n.kind === kind && n.label === label);
}

function composeTech(node?: ArchNode): string {
  const m = node?.meta;
  if (!m) return '';
  if (m.tech != null && String(m.tech).trim()) return String(m.tech).trim();
  return [m.language, m.framework].filter(Boolean).join(', ');
}

function composeDescription(node?: ArchNode): string {
  const d = node?.meta?.description;
  if (d == null) return '';
  return sanitizeLabel(String(d));
}

/** Map a projected edge family to the compact flow-kind token in the dialect. */
function familyToCompact(family: string): string {
  if (family === 'queue_publish' || family === 'queue_consume') return 'queue';
  if (family === 'db_access' || family.startsWith('db_')) return 'db';
  if (family === 'http' || family === 'grpc' || family === 'import') return family;
  return family;
}

function flowDetailText(pe: ProjectedEdge): string {
  if (pe.labels.length > 0) return sanitizeLabel(pe.labels.join(', '));
  return '';
}

function emitComponentLine(label: string, kind: LiftedKind, tech: string, description: string): string {
  let line = `- **${sanitizeLabel(label)}** \`${kind}\``;
  if (tech) line += ` (${tech})`;
  if (description) line += ` — ${description}`;
  return line;
}

function emitFlowLine(src: string, dst: string, compactKind: string, detail: string): string {
  let line = `- ${sanitizeLabel(src)} → ${sanitizeLabel(dst)}: \`${compactKind}\``;
  if (detail) line += ` ${detail}`;
  return line;
}

/**
 * Render an {@link ArchGraph} as the canonical Architecture Markdown dialect.
 * Projects to service / datastore / topic participants only — file and module
 * leaves never appear.
 */
export function archToMarkdown(graph: ArchGraph): string {
  const projected = projectEdges(graph);
  const participantOrder = orderParticipants(projected);
  const kinds = participantKinds(projected);
  const orderedFlows = orderEdgesByFlow(projected, participantOrder);

  const lines: string[] = [`# ${graph.repoName || 'architecture'} — Architecture`, ''];

  if (participantOrder.length > 0) {
    lines.push('## Components');
    for (const p of participantOrder) {
      const kind = kinds.get(p)!;
      const node = findNode(graph, p, kind);
      const label = displayLabel(p);
      lines.push(emitComponentLine(label, kind, composeTech(node), composeDescription(node)));
    }
    lines.push('');
    lines.push('## Flows');
    for (const e of orderedFlows) {
      const detail = flowDetailText(e);
      lines.push(
        emitFlowLine(displayLabel(e.src), displayLabel(e.dst), familyToCompact(e.family), detail)
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

function slugify(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return s || 'node';
}

interface ParsedComponent {
  label: string;
  kind: LiftedKind;
  tech?: string;
  description?: string;
}

interface ParsedFlow {
  srcLabel: string;
  dstLabel: string;
  compactKind: string;
  detail: string;
}

const H1_LINE = /^#\s+(.+?)\s+—\s+Architecture\s*$/;
const COMPONENT_LINE =
  /^- \*\*(.+)\*\* `(service|datastore|topic)`(?: \((.+)\))?(?: — (.+))?$/;
const FLOW_LINE =
  /^- (.+?) → (.+?): `(http|grpc|queue|db|import)`(?:\s+(.*))?$/;

/** Best-effort parse of a free-text flow detail into edge.detail fields. */
function parseDetailText(detail: string): ArchEdge['detail'] {
  const t = detail.trim();
  if (!t) return undefined;
  const http = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)$/i.exec(t);
  if (http) return { method: http[1].toUpperCase(), pathPattern: http[2] };
  const publish = /^publish\s+(.+)$/i.exec(t);
  if (publish) return { topic: publish[1].trim() };
  const consume = /^consume\s+(.+)$/i.exec(t);
  if (consume) return { topic: consume[1].trim() };
  const read = /^read\s+(.+)$/i.exec(t);
  if (read) return { table: read[1].trim() };
  const write = /^write\s+(.+)$/i.exec(t);
  if (write) return { table: write[1].trim() };
  const table = /^table\s+(.+)$/i.exec(t);
  if (table) return { table: table[1].trim() };
  if (/^https?:\/\//i.test(t)) return { url: t };
  return { pathPattern: t };
}

/** Map compact flow kind + detail text to a representative edge kind and detail bag. */
function parseFlowKind(compact: string, detail: string): { kind: EdgeKind; detail?: ArchEdge['detail'] } {
  const t = detail.trim();
  if (compact === 'queue') {
    if (/^consume\b/i.test(t)) {
      const topic = t.replace(/^consume\s+/i, '').trim();
      return { kind: 'queue_consume', detail: topic ? { topic } : undefined };
    }
    if (/^publish\b/i.test(t)) {
      const topic = t.replace(/^publish\s+/i, '').trim();
      return { kind: 'queue_publish', detail: topic ? { topic } : undefined };
    }
    return { kind: 'queue_publish', detail: parseDetailText(t) };
  }
  if (compact === 'db') {
    if (/^write\b/i.test(t)) {
      const table = t.replace(/^write\s+/i, '').trim();
      return { kind: 'db_write', detail: table ? { table } : undefined };
    }
    if (/^read\b/i.test(t)) {
      const table = t.replace(/^read\s+/i, '').trim();
      return { kind: 'db_read', detail: table ? { table } : undefined };
    }
    if (/^table\b/i.test(t)) {
      const table = t.replace(/^table\s+/i, '').trim();
      return { kind: 'db_access', detail: table ? { table } : undefined };
    }
    return { kind: 'db_access', detail: parseDetailText(t) };
  }
  if (compact === 'grpc') return { kind: 'grpc', detail: parseDetailText(t) };
  if (compact === 'import') return { kind: 'import', detail: parseDetailText(t) };
  return { kind: 'http', detail: parseDetailText(t) };
}

/**
 * Parse OUR Architecture Markdown dialect back into a design-mode
 * {@link ArchGraph}. Total — never throws. Tolerant of blank lines, extra prose,
 * and unknown headers.
 */
export function markdownToArch(md: string, opts?: { repoName?: string }): ArchGraph {
  const components: ParsedComponent[] = [];
  const flows: ParsedFlow[] = [];
  let repoName = opts?.repoName ?? 'architecture';
  let section: 'none' | 'components' | 'flows' = 'none';

  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    const h1 = H1_LINE.exec(line);
    if (h1) {
      if (!opts?.repoName) repoName = h1[1].trim();
      section = 'none';
      continue;
    }
    if (line === '## Components') {
      section = 'components';
      continue;
    }
    if (line === '## Flows') {
      section = 'flows';
      continue;
    }
    if (line.startsWith('## ')) {
      section = 'none';
      continue;
    }

    if (section === 'components') {
      const cm = COMPONENT_LINE.exec(line);
      if (cm) {
        components.push({
          label: sanitizeLabel(cm[1]),
          kind: (LIFTED_KINDS.has(cm[2]) ? cm[2] : 'service') as LiftedKind,
          tech: cm[3]?.trim() || undefined,
          description: cm[4]?.trim() || undefined,
        });
      }
      continue;
    }

    if (section === 'flows') {
      const fm = FLOW_LINE.exec(line);
      if (fm) {
        flows.push({
          srcLabel: sanitizeLabel(fm[1]),
          dstLabel: sanitizeLabel(fm[2]),
          compactKind: COMPACT_KINDS.has(fm[3]) ? fm[3] : 'http',
          detail: fm[4]?.trim() ?? '',
        });
      }
    }
  }

  const labelToId = new Map<string, string>();
  const usedSlugs = new Map<string, number>();
  const nodes: ArchNode[] = [];

  function assignId(label: string): string {
    const base = slugify(label);
    const count = (usedSlugs.get(base) ?? 0) + 1;
    usedSlugs.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    labelToId.set(label, id);
    return id;
  }

  function ensureNode(label: string, kind: LiftedKind = 'service'): string {
    const existing = labelToId.get(label);
    if (existing) return existing;
    const id = assignId(label);
    nodes.push({ id, kind: kind as NodeKind, label });
    return id;
  }

  for (const c of components) {
    const id = assignId(c.label);
    const meta: ArchNode['meta'] = {};
    if (c.tech) meta.tech = c.tech;
    if (c.description) meta.description = c.description;
    nodes.push({
      id,
      kind: c.kind as NodeKind,
      label: c.label,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
    });
  }

  // Flow endpoints not declared in Components become bare services (tolerant).
  for (const f of flows) {
    const srcKind =
      components.find((c) => c.label === f.srcLabel)?.kind ??
      (labelToId.has(f.srcLabel) ? (nodes.find((n) => n.id === labelToId.get(f.srcLabel))?.kind as LiftedKind) : undefined) ??
      'service';
    const dstKind =
      components.find((c) => c.label === f.dstLabel)?.kind ??
      (labelToId.has(f.dstLabel) ? (nodes.find((n) => n.id === labelToId.get(f.dstLabel))?.kind as LiftedKind) : undefined) ??
      'service';
    ensureNode(f.srcLabel, srcKind);
    ensureNode(f.dstLabel, dstKind);
  }

  const edges: ArchEdge[] = flows.map((f, i) => {
    const srcId = labelToId.get(f.srcLabel)!;
    const dstId = labelToId.get(f.dstLabel)!;
    const parsed = parseFlowKind(f.compactKind, f.detail);
    return {
      id: `e${i}`,
      srcId,
      dstId,
      kind: parsed.kind,
      confidence: 1,
      origin: 'design' as const,
      evidence: [],
      detail: parsed.detail,
    };
  });

  return {
    version: 1,
    mode: 'design',
    repoName,
    repoRoot: '',
    scannedAt: '',
    nodes,
    edges,
    warnings: [],
  };
}
