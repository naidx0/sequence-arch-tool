/**
 * Presentation kinds for the Architecture React Flow board (OF7b).
 * Maps grounded SeqDiagram / ArchGraph kinds → coding-canvas legend:
 * Service · Module · Datastore · Topic · Agent, plus the Entry position.
 * Entry is a heuristic on service labels only — never invents topology.
 *
 * GRAPHITE — kind carries NO hue (owner Decision 2; sheet 03 §03.2). A kind is
 * icon + silhouette + border treatment + neutral tone, and nothing else. This
 * file returns identifiers only: no colour token is named here, and none may be
 * added. The four channels live in product.css as --arch-sil/style/weight/tone.
 */
import type { SeqDiagramNode, SeqDiagramNodeKind } from '@sequence/schema';

export type ArchPresentKind = 'entry' | 'agent' | 'service' | 'module' | 'storage' | 'topic';

export const ARCH_PRESENT_KINDS: readonly ArchPresentKind[] = [
  'service',
  'module',
  'storage',
  'topic',
  'agent',
  'entry',
] as const;

/**
 * The legend, in the book's own order — sheet 03 §03.3 and §03.7.
 *
 * Two facts are encoded in that order. First, `module` sits next to `service`,
 * because those are the two the reader now has to tell apart and adjacency is
 * what makes the dashed border and the folder tab readable as a difference.
 * Second, `entry` is LAST, because it is a *position* and not a kind: §03.7 —
 * "a legend that lists entry among the kinds teaches the reader that entry is a
 * thing you can build, which it is not." The book draws the two groups apart
 * with a hairline (`.kindlegend .grpsep`). That separator is markup, so it is
 * owed to ArchCanvasBoard; putting entry last here means the separator is one
 * insertion at one place rather than a re-sort of a rendered row.
 *
 * `storage` keeps its identifier and its label says Datastore. Sheet 01 §01.5
 * rules on the two-words-for-one-kind defect: the schema declares 'datastore'
 * (packages/schema/src/seqdiagram.ts:57), this file mapped it to a presentation
 * kind whose legend label read "Storage", and "no sheet may print Storage for a
 * node kind" — the *label* is the defect. The same section says the short form
 * stays: ".n-store and --arch-*-store are short forms of the same word, not a
 * third one, and renaming them buys nothing." So the id stays 'storage' and
 * every selector keyed off it (.arch-rf-card-storage, arch-rf-kind-storage,
 * .product-index-flow-chip--storage) keeps working.
 */
export const ARCH_KIND_LEGEND: ReadonlyArray<{ kind: ArchPresentKind; label: string }> = [
  { kind: 'service', label: 'Service' },
  { kind: 'module', label: 'Module' },
  { kind: 'storage', label: 'Datastore' },
  { kind: 'topic', label: 'Topic' },
  { kind: 'agent', label: 'Agent' },
  { kind: 'entry', label: 'Entry' },
];

/** Tokens that mark an inbound/API/web surface — applied only to `service` nodes. */
const ENTRY_RE =
  /(^|[\s._/-])(gateway|edge|ingress|api[-_]?gateway|frontend|web|ui|portal|bff|entrypoint|entry)([\s._/-]|$)/i;

export function isEntryLabel(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return ENTRY_RE.test(t);
}

/**
 * Map schema kind → presentation kind (Entry wins over Service when label matches).
 *
 * MODULE IS FIRST CLASS. It was being flattened onto `service` before it ever
 * reached the picture, so `microDocFromParts` — the one view that shows
 * sub-service granularity, and which emits `kind: 'module'` nodes at
 * microDocFromParts.ts:48,54 — drew a board of mislabelled Services, and the
 * legend could contain no Module while the board was full of them.
 *
 * Which schema kinds present as Module is settled by sheet 07 (§ "Two schema
 * kinds present as Module. Two are not nodes at all."):
 *
 *  - `module` and `package` both present as Module. They "never stand on the
 *    ground — they only ever appear inside something". They share one
 *    silhouette and one icon by decision and are told apart by the literal
 *    schema kind printed in the mono kind tag, which is card markup and is owed
 *    to ArchNodeCard. Collapsing either to Service is named as an error there:
 *    a package is not a deployed thing.
 *  - `file` and `function` are interior detail, not board kinds. They "never
 *    take a card, never enter the legend and never enter the pair matrix", and
 *    `nodeVisibleAtLevel` already filters them out at every level. They are
 *    absent from ARCH_KIND_LEGEND for exactly that reason. This function is
 *    total, so it must still answer for them, and Module is the only honest
 *    answer left: the same sheet says a file kind "would take Module's icon,
 *    Module's dashed border, Module's tone and Module's silhouette, so the two
 *    would render byte-identically". Service is the one answer that is wrong —
 *    it asserts a deployed thing about a source file.
 */
export function presentKindFor(
  kind: SeqDiagramNodeKind,
  labelParts: readonly string[],
): ArchPresentKind {
  if (kind === 'agent') return 'agent';
  if (kind === 'datastore') return 'storage';
  if (kind === 'topic') return 'topic';
  if (kind === 'service') {
    for (const part of labelParts) {
      if (isEntryLabel(part)) return 'entry';
    }
    return 'service';
  }
  // module · package — containers, presented as Module.
  // file · function — interior detail; filtered before they reach a card, and
  // shaped as Module rather than Service if one ever does. See above.
  return 'module';
}

export function presentKindForNode(node: SeqDiagramNode): ArchPresentKind {
  return presentKindFor(node.kind, [node.label, node.detail?.whatItIs ?? '', node.id]);
}

export function presentKindLabel(kind: ArchPresentKind): string {
  return ARCH_KIND_LEGEND.find((k) => k.kind === kind)?.label ?? kind;
}

/** SeqDiagram node kinds that open the grounded MADR interior on select (OF8). */
export function isMadrBreakoutSeqNode(node: Pick<SeqDiagramNode, 'kind'>): boolean {
  return node.kind === 'service' || node.kind === 'agent' || node.kind === 'module';
}
