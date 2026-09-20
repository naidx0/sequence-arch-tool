/* ══════════════════════════════════════════════════════════════════════════
   KIND, POSITION, AND THE FOUR NON-CHROMATIC CHANNELS — item 3.7
   packages/web2/src/canvas/kinds.ts

   Written against docs/brand/graphite/pages/03-node-kinds-without-hue.html
   and the substrate docs/brand/graphite/_core.html.

   OWNER DECISION 2, restated because everything in this file exists to serve
   it: a node's KIND is a category and a category is not a claim, so a category
   gets no hue. Kind is carried by four non-chromatic channels — an icon, a
   silhouette, a border treatment and a step in the neutral tone ramp — and
   this module returns identifiers for exactly those. NO COLOUR TOKEN IS NAMED
   IN THIS FILE AND NONE MAY BE ADDED. The channels themselves live in
   board.css as --arch-sil / --arch-style / --arch-weight / --arch-tone, which
   tokens/graphite.css declares.

   ENTRY IS A POSITION, NOT A KIND (sheet 03.7). "A service that nothing
   upstream calls is an entry; make one call to it from inside the scope and it
   is a service again, without having changed what it is." So this module models
   a node as a KIND plus an entry FLAG, and never as six peers. Five kinds are
   things you can build; entry is where the reader comes in. The legend draws
   the two groups apart for the same reason — a legend that lists entry among
   the kinds teaches the reader that entry is a thing you can build, which it is
   not.

   THE ENTRY HEURISTIC IS NOT REDERIVED. `isEntryLabel` comes from
   `archKinds.ts`, the module item 3.2 lifted from v1 byte-identical. A second
   regular expression for the same question is how two surfaces come to
   disagree about which nodes are entries.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SeqDiagramNode, SeqDiagramNodeKind } from '@sequence/schema';

import { isEntryLabel } from './archKinds.js';
import type { BoardIconName } from './BoardIcon.js';

/**
 * THE FIVE BUILDABLE KINDS. Entry is deliberately absent — see the header.
 *
 * `storage` keeps v1's identifier and the label says Datastore. Sheet 01.5
 * ruled on the two-words-for-one-kind defect and settled it the same way
 * `archKinds.ts` records: the schema declares `datastore`, `.n-store` and
 * `--arch-*-store` are short forms of the same word rather than a third one,
 * and the LABEL is the thing that was wrong. So the identifier stays and the
 * label is fixed.
 */
export type BoardKind = 'service' | 'module' | 'storage' | 'topic' | 'agent';

/**
 * The order sheet 03.3 draws them in, and the order the legend uses.
 *
 * `module` sits next to `service` on purpose: those are the two the reader now
 * has to tell apart, and adjacency is what makes the dashed border and the
 * folder tab readable as a difference rather than as noise.
 */
export const BOARD_KINDS: readonly BoardKind[] = [
  'service',
  'module',
  'storage',
  'topic',
  'agent',
] as const;

/**
 * What a silhouette can be: one of the five kinds, or the entry MODIFIER
 * grafted over whatever kind the node actually is.
 *
 * This is the type the CSS is keyed on, and it is separate from `BoardKind`
 * precisely so that nothing can accidentally treat entry as a sixth thing you
 * could build.
 */
export type Silhouette = BoardKind | 'entry';

/** Every silhouette the board draws, kinds first and the position last. */
export const SILHOUETTES: readonly Silhouette[] = [...BOARD_KINDS, 'entry'] as const;

/**
 * How a node presents: what it is, and whether it is the way in.
 *
 * Both facts are kept, and neither replaces the other, because sheet 03.7
 * requires the card in the entry position to keep its kind glyph rather than
 * swap it: "The reader is told both facts and neither replaces the other."
 */
export interface KindPresentation {
  kind: BoardKind;
  entry: boolean;
}

/** The silhouette a presentation paints with. Entry wins, because it is a
 *  modifier grafted onto the base rectangle (sheet 03.7). */
export function silhouetteOf(present: KindPresentation): Silhouette {
  return present.entry ? 'entry' : present.kind;
}

/**
 * The substrate's own class names, `_core.html:1276-1281`.
 *
 * These are the BOOK's names, not v1's — `.n-store`, never `.arch-rf-card-
 * storage`. The board sheet namespaces them under `.board-scope` the same way
 * `chat.css` namespaces the book's `.toolrow` and `.composer`, so two lanes
 * cannot collide over a name the substrate also uses.
 */
const SILHOUETTE_CLASS: Record<Silhouette, string> = {
  service: 'n-service',
  module: 'n-module',
  storage: 'n-store',
  topic: 'n-topic',
  agent: 'n-agent',
  entry: 'n-entry',
};

export function silhouetteClass(silhouette: Silhouette): string {
  return SILHOUETTE_CLASS[silhouette];
}

/**
 * Legend swatch class — module paints with the service chassis (P2.6), so the
 * key must not advertise a folder tab the card no longer carries.
 */
export function legendSwatchClass(silhouette: Silhouette): string {
  return silhouette === 'module' ? SILHOUETTE_CLASS.service : silhouetteClass(silhouette);
}

/**
 * One glyph per kind, one meaning per glyph — sheet 03.10, and Decision 2's
 * "an icon that means two things means neither".
 *
 * The icon is ranked the STRONGEST of the four channels in sheet 03.2 and this
 * is the map that makes that true. It is exhaustive over `Silhouette` so a new
 * kind cannot be added without being drawn.
 */
const SILHOUETTE_GLYPH: Record<Silhouette, BoardIconName> = {
  service: 'service',
  module: 'module',
  storage: 'database',
  topic: 'topic',
  agent: 'agent',
  entry: 'entry',
};

export function silhouetteGlyph(silhouette: Silhouette): BoardIconName {
  return SILHOUETTE_GLYPH[silhouette];
}

/**
 * The words the card's mono kind tag and the legend both print.
 *
 * ONE VOCABULARY, TWO SIZES. Sheet 08.4: "The census in the card foot and the
 * census in the popover are the same grammar at two sizes." A second label
 * table for the legend is how "Storage" survived in one place after being
 * fixed in the other.
 */
const SILHOUETTE_LABEL: Record<Silhouette, string> = {
  service: 'Service',
  module: 'Module',
  storage: 'Datastore',
  topic: 'Topic',
  agent: 'Agent',
  entry: 'Entry',
};

export function silhouetteLabel(silhouette: Silhouette): string {
  return SILHOUETTE_LABEL[silhouette];
}

/**
 * Schema kind → board kind.
 *
 * Settled by sheet 07 and recorded in `archKinds.ts`, which this deliberately
 * agrees with rather than re-decides:
 *
 *  - `module` and `package` both present as Module. Neither ever stands on the
 *    ground; they only appear inside something. They share one silhouette and
 *    one icon by decision, and are told apart by the literal schema kind
 *    printed in the mono tag — which is card markup, and is `NodeCard`'s job.
 *    Collapsing either onto Service asserts a deployed thing about a package.
 *  - `file` and `function` are interior detail. They never take a card and
 *    never enter the legend. This function is total so it must still answer,
 *    and Module is the only honest answer left: Service would assert a deployed
 *    thing about a source file.
 */
export function boardKindFor(kind: SeqDiagramNodeKind): BoardKind {
  if (kind === 'agent') return 'agent';
  if (kind === 'datastore') return 'storage';
  if (kind === 'topic') return 'topic';
  if (kind === 'service') return 'service';
  return 'module';
}

/**
 * How one grounded node presents.
 *
 * THE ENTRY TEST IS APPLIED TO SERVICES ONLY, which is `archKinds.ts`'s rule
 * verbatim and is not a simplification: a datastore called `api-gateway-cache`
 * is not the way into the system, it is a cache with an unfortunate name. Entry
 * is a claim about the graph's shape, and the label heuristic is the weakest
 * possible stand-in for it — it may never be allowed to invent topology.
 *
 * `entry` is a heuristic today and will become a graph fact (a node with no
 * inbound edge from inside the scope) the moment the scope is computed here.
 * Whichever it is, it never changes `kind`.
 */
export function presentationFor(node: SeqDiagramNode): KindPresentation {
  const kind = boardKindFor(node.kind);
  if (kind !== 'service') return { kind, entry: false };

  const parts = [node.label, node.detail?.whatItIs ?? '', node.id];
  return { kind, entry: parts.some((part) => isEntryLabel(part)) };
}

/**
 * The legend, as TWO GROUPS.
 *
 * Sheet 03.7 requires the split and the substrate supplies the two parts
 * (`.kindlegend .grp`, `.kindlegend .grpsep`) so that nine sheets do not invent
 * nine separators. Returning groups rather than a flat list with a magic index
 * means a renderer cannot draw the separator in the wrong place, and a legend
 * showing a subset with no entry in it draws no separator because there is no
 * second group to separate.
 */
export interface LegendGroup {
  caption: string;
  silhouettes: Silhouette[];
}

export function legendGroups(present: readonly Silhouette[] = SILHOUETTES): LegendGroup[] {
  const kinds = BOARD_KINDS.filter((kind) => present.includes(kind));
  const groups: LegendGroup[] = [];
  if (kinds.length) groups.push({ caption: 'Kinds', silhouettes: [...kinds] });
  if (present.includes('entry')) groups.push({ caption: 'Position', silhouettes: ['entry'] });
  return groups;
}
