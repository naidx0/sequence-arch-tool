/* ══════════════════════════════════════════════════════════════════════════
   WHAT THE READER POINTED AT, AS THE AGENT RECEIVES IT
   packages/web2/src/askInPlace/askReference.ts

   "You can click on any type or anywhere on the artifact, and it will let you
   chat and send to the agent right away, and that session can be referenced, so
   the agent can reference exactly what you're highlighting." (owner)

   A reference is the selection, reduced to the facts an agent can act on:

     whiteboard    each item's id, kind, label and CONNECTIONS (the bound arrows
                   in and out), so "fix the arrow into Tool call" names a mark
                   the board tools can edit by id
     architecture  each node's id, name, kind and FILE PATHS, and each edge's
                   endpoints

   It is a COMPACT BLOCK, not a description of pixels: the same ids the existing
   board tools take, so the agent answers by editing exactly those items.

   PURE. Selection in, reference out. The chip (what the reader sees) and the
   block (what the prompt carries) come from the same targets, so they cannot
   disagree about what was pointed at.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ContextChip } from '../state/types';

export type AskSurfaceName = 'whiteboard' | 'architecture';

/** One thing the reader pointed at. */
export interface AskTarget {
  id: string;
  /** rect, ellipse, arrow, sticky, text, stroke, node-ref, artifact; or a node/edge kind. */
  kind: string;
  label: string;
  /** Source files behind an architecture node, or the file a code card shows. */
  paths?: string[];
  /** Connections in plain words: "to r2 (Tool call)", "from r1 (Model)". */
  links?: string[];
}

export interface AskReference {
  surface: AskSurfaceName;
  targets: AskTarget[];
  /** What the chip says: "Model", or "3 items: Model, Tool call, loop". */
  summary: string;
  /** What the prompt carries. */
  block: string;
}

/** Targets named in the chip before it says "+N more". */
export const CHIP_NAMES = 3;
/** Targets listed in the block; the rest are counted, never silently dropped. */
export const BLOCK_MAX = 24;
const LABEL_MAX = 60;

const squash = (text: string, max = LABEL_MAX): string => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
};

/** "Model" for one; "3 items: Model, Tool call, loop" for several. */
export function referenceSummary(labels: readonly string[]): string {
  const names = labels.map((l) => squash(l, 24)).filter((l) => l !== '');
  if (labels.length === 0) return '';
  if (labels.length === 1) return names[0] ?? '1 item';
  const shown = names.slice(0, CHIP_NAMES).join(', ');
  const more = labels.length > CHIP_NAMES ? `, +${labels.length - CHIP_NAMES} more` : '';
  return `${labels.length} items: ${shown}${more}`;
}

function lineOf(t: AskTarget): string {
  const parts = [t.id, t.kind, t.label === '' ? '(no label)' : `"${squash(t.label)}"`];
  if (t.paths && t.paths.length > 0) parts.push(t.paths.slice(0, 3).join(', '));
  if (t.links && t.links.length > 0) parts.push(t.links.slice(0, 6).join('; '));
  return `- ${parts.join(' | ')}`;
}

/** Targets in, reference out. Null for an empty selection. */
export function buildReference(surface: AskSurfaceName, targets: readonly AskTarget[]): AskReference | null {
  if (targets.length === 0) return null;
  const listed = targets.slice(0, BLOCK_MAX);
  const lines = [
    `[${surface} selection: ${targets.length} item${targets.length === 1 ? '' : 's'} the user pointed at; ids are the ones the board tools take]`,
    ...listed.map(lineOf),
  ];
  if (targets.length > listed.length) lines.push(`- (+${targets.length - listed.length} more not listed)`);
  lines.push('[/selection]');
  return {
    surface,
    targets: [...targets],
    summary: referenceSummary(targets.map((t) => t.label || t.kind)),
    block: lines.join('\n'),
  };
}

/** The composer chip for a reference. `detail` is what the prompt carries. */
export function referenceChip(reference: AskReference): ContextChip {
  const ids = reference.targets.map((t) => t.id);
  return {
    id: `board-ref:${reference.surface}:${ids.join(',')}`,
    kind: 'board-ref',
    /* Namespaced: the composer keeps one chip per `ref`, and a board node's id is also the id of its own node chip. */
    ref: `board-ref:${reference.surface}:${ids.join(',')}`,
    label: reference.summary,
    nodeKind: null,
    detail: reference.block,
  };
}

/* ── whiteboard ─────────────────────────────────────────────────────────── */

/** The slice of a whiteboard item this reads (WbItem, structurally). */
export interface WbRefItem {
  id: string;
  kind: 'stroke' | 'shape' | 'text' | 'noderef' | 'artifact' | 'svg' | 'scene' | 'video';
  shape?: 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'path' | 'frame';
  label?: string;
  text?: string;
  sticky?: boolean;
  fromId?: string;
  toId?: string;
  nodeId?: string;
  path?: string;
}

function wbKind(item: WbRefItem): string {
  if (item.kind === 'shape') return item.shape ?? 'shape';
  if (item.kind === 'text') return item.sticky ? 'sticky' : 'text';
  if (item.kind === 'noderef') return 'node-ref';
  return item.kind;
}

/**
 * The selected whiteboard items as a reference. `labelOf` is the label as
 * DRAWN (a box's words live on a neighbouring text item once composed), so the
 * chip says what the reader reads on the board, not what the document stores.
 */
export function whiteboardReference<T extends WbRefItem>(
  items: readonly T[],
  ids: readonly string[],
  labelOf: (item: T) => string,
): AskReference | null {
  const byId = new Map(items.map((i) => [i.id, i]));
  const name = (id: string): string => {
    const found = byId.get(id);
    return found ? `${id} (${squash(labelOf(found), 24) || wbKind(found)})` : id;
  };
  const targets: AskTarget[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    const links: string[] = [];
    if (item.kind === 'shape' && item.shape === 'arrow') {
      if (item.fromId) links.push(`from ${name(item.fromId)}`);
      if (item.toId) links.push(`to ${name(item.toId)}`);
    } else {
      for (const other of items) {
        if (other.kind !== 'shape' || other.shape !== 'arrow') continue;
        if (other.fromId === id && other.toId) links.push(`to ${name(other.toId)}`);
        else if (other.toId === id && other.fromId) links.push(`from ${name(other.fromId)}`);
      }
    }
    const target: AskTarget = { id, kind: wbKind(item), label: labelOf(item) };
    if (item.path) target.paths = [item.path];
    if (links.length > 0) target.links = links;
    targets.push(target);
  }
  return buildReference('whiteboard', targets);
}

/* ── architecture ───────────────────────────────────────────────────────── */

export interface ArchRefNode {
  id: string;
  label: string;
  kind: string;
  paths?: readonly string[];
}

export interface ArchRefEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

/** The selected nodes and edges of the architecture board as a reference. */
export function architectureReference(
  nodes: readonly ArchRefNode[],
  edges: readonly ArchRefEdge[],
  nodeIds: readonly string[],
  edgeIds: readonly string[],
): AskReference | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nameOf = (id: string): string => byId.get(id)?.label ?? id;
  const targets: AskTarget[] = [];
  for (const id of nodeIds) {
    const node = byId.get(id);
    if (!node) continue;
    const target: AskTarget = { id, kind: node.kind, label: node.label };
    if (node.paths && node.paths.length > 0) target.paths = [...node.paths];
    targets.push(target);
  }
  for (const id of edgeIds) {
    const edge = edges.find((e) => e.id === id);
    if (!edge) continue;
    const target: AskTarget = {
      id,
      kind: 'edge',
      label: `${nameOf(edge.source)} to ${nameOf(edge.target)}`,
      links: [`from ${edge.source}`, `to ${edge.target}`],
    };
    if (edge.label) target.links?.push(`labelled ${squash(edge.label, 30)}`);
    targets.push(target);
  }
  return buildReference('architecture', targets);
}
