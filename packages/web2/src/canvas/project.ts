/* ══════════════════════════════════════════════════════════════════════════
   THE PROJECTION — a grounded `.seqd` document onto the board
   packages/web2/src/canvas/project.ts

   Pure. This is the only place a `SeqDiagramV1` becomes something the board
   draws, so there is exactly one answer to "what does this node say".

   NOTHING HERE INVENTS A FACT. Every field is read off the document or left
   null, and the two rules that could have been fudged are written down instead:

   PROVENANCE. Sheet 02.5 gives the two words their meanings — "Traced means the
   analyzer followed it in the source. Declared means a manifest or a config
   said so and the source could not confirm it" — and they are the EDGE proof
   vocabulary verbatim, so a node and the connectors leaving it never disagree
   about what proof means. `evidenceRef` is the only thing on the document that
   can settle it, and the discriminator is whether the ref lands on a LINE: a
   ref ending `:<n>` is a place in the source the analyzer actually reached; one
   that does not is a claim from a manifest that no line confirms. AN ABSENT
   REF IS NEITHER, and it draws NO FOOTER AT ALL — not a Declared tag, which
   would be asserting that something claimed this node, and not a blank chip.
   A node the analyzer has nothing further to say about gets no footer and is
   shorter for it. v1 carries `evidenceRef` on every card and renders it
   nowhere.

   COUNTS. Graphite law 4: "every count on a node card is a placeholder …
   the engine computes all of them, and a plausible number in a specimen is the
   exact failure Law 4 exists to prevent." So the only count drawn is one the
   document actually carries — `detail.parts.length`, the parts the scan found
   inside this node. No parts array means no count, never a zero: a zero says
   "we looked and there are none", and absent says "nobody looked".

   THE LAYOUT HERE IS THE SEED, NOT THE LAYOUT. `layout.ts` is now wired to the
   elkjs worker and `ConnectedBoard` replaces every position below with ELK's
   answer as soon as it lands. What stays here is the FIRST FRAME — the
   arrangement the board paints while ELK is still running, and the one it keeps
   in an environment that has no `Worker` at all.

   It lays the graph out by DEPTH FROM ITS ENTRY POINTS, left to right, which is
   what `elk.direction: 'RIGHT'` produces on the layered case and is therefore
   the same picture at lower fidelity — not a different one. Positions are
   presentation, not claims about the world, so a stand-in here is honest in a
   way a stand-in for an edge would not be.

   ITS ONE KNOWN FAILURE, WRITTEN DOWN RATHER THAN LEFT TO BE REDISCOVERED: with
   NO edges there is no depth to walk, so every node comes back at depth 0 and
   the seed is a single 160px column. On this repository that is the whole
   graph, because every scanned edge is an `import` and those are skipped (see
   `proofOf` below and `packages/export/src/project.ts:124`). That column was
   what the board actually shipped, and `layout.ts` is what replaces it —
   `layout.test.ts` asserts the failure here as well as the fix there, so the
   fallback's shape stays known.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SeqDiagramEdge, SeqDiagramNode, SeqDiagramV1 } from '@sequence/schema';
import { classifySeqDiagramLayout } from '@sequence/schema';

import type { EdgeProof } from './ElbowEdge.js';
import type { BoardEdge } from './Board.js';
import type { BoardNode } from './NodeCard.js';
import { CARD_W, cardHeight } from './cardBox.js';
import { isGlanceNoise } from './glanceLine.js';
import { saysMoreThan } from './naming.js';
import { edgeTag } from './edgeTag.js';
import { presentationFor } from './kinds.js';

export interface Projection {
  nodes: BoardNode[];
  edges: BoardEdge[];
  positions: Record<string, { x: number; y: number }>;
}

/** A ref that ends in `:<line>` is a place in the source. Anything else is a
 *  claim from somewhere the source cannot confirm. */
const AT_A_LINE = /:\d+$/;

export function provenanceOf(node: SeqDiagramNode): BoardNode['provenance'] {
  const ref = node.evidenceRef?.trim();
  if (!ref) return null;
  return AT_A_LINE.test(ref) ? 'traced' : 'declared';
}

/**
 * The one line of summary earns its place on the card, or it is not drawn.
 *
 * The rule lives in `naming.ts` because the TITLE uses it too — see the note
 * there. Measured on ml-harness: of 300 nodes, 293 summaries were an exact echo
 * of the label and none said anything new, so the card printed its own name
 * twice on two consecutive rows.
 *
 * Dropped rather than rewritten: nothing is invented to fill the line, and a
 * card without a summary is simply shorter (`cardBox.ts` already sizes for it).
 */
function informativeSubtitle(label: string, summary: string | undefined): string | null {
  const text = summary?.trim();
  if (!text) return null;
  if (!saysMoreThan(label, text)) return null;
  /* Owner first-glance: paths and inventory lists wait for select/expand. */
  if (isGlanceNoise(text)) return null;
  return text;
}

export function boardNodeFrom(node: SeqDiagramNode): BoardNode {
  const parts = node.detail?.parts;
  return {
    id: node.id,
    label: node.label,
    /*
     * `whatItDoes`, NOT `whatItIs` — the card was reading the wrong field.
     *
     * The two names are misleading. In `seqdNodeDetailFromStructuralTree`,
     * `whatItIs` is the structural tree's TITLE and `whatItDoes` is its SUMMARY,
     * so the field that reads like the description is the one that just repeats
     * the name. Measured on ml-harness, 311 nodes carrying detail:
     *
     *     whatItIs   — 302 of 311 an EXACT echo of the label ("db.py" -> "db.py")
     *     whatItDoes — 311 of 311 present, 0 echoes
     *
     * and what it actually says is worth a line:
     *
     *     "18 ts files in frontend, defining absoluteTime, activateProvider, App."
     *     "frontend/src/App.tsx (ts, 728 lines)"
     *     "lib · build · types · 2 more"
     *
     * The previous comment here reasoned that `whatItIs` was "the analyzer's own
     * one-line summary" and that `whatItDoes` was "a second sentence" too long
     * for a one-line card. Both halves were wrong about which field is which.
     *
     * `informativeSubtitle` still guards the result. It now almost never fires,
     * which is the point — the guard exists so a summary that DOES echo its
     * label is dropped, not so a whole field can be quietly useless.
     */
    subtitle: informativeSubtitle(node.label, node.detail?.whatItDoes),
    present: presentationFor(node),
    schemaKind: node.kind,
    provenance: provenanceOf(node),
    /* THE SAME REF, ASKED A WEAKER QUESTION. `provenanceOf` asks what kind of
       proof there is and answers `null` when there is none — an absence, drawn
       as a missing footer on a card the reader has to select first. This asks
       only whether ANYTHING on disk points at this node, which is a fact the
       card can carry at rest. Every scanned node has a ref (measured on this
       monorepo: 11 of 11); `docEdit` gives a drawn one none, deliberately. */
    grounded: Boolean(node.evidenceRef?.trim()),
    count: parts?.length ? { label: 'parts', value: String(parts.length) } : null,
    /* THE NAMES BEHIND THE COUNT — MADR amendment A2, "structure the spec
       already carries but the plain view collapses". `count` above is twelve
       names reduced to the numeral 12, and the numeral is all any surface in
       this package has ever drawn. Visual mode draws the names.

       CARRIED VERBATIM AND IN THE DOCUMENT'S OWN ORDER. `detail.parts` is
       `string[]` in `packages/schema/src/seqdiagram.ts`; nothing here sorts it,
       filters it or shortens it, because A4 makes the drawing a pure function
       of the spec and re-ordering here is exactly the layout jitter A4 forbids
       — the spec's order IS the tie-break.

       `null`, NEVER `[]`. An absent parts array means nobody looked; an empty
       one would mean somebody looked and found nothing, and the schema never
       emits the second. Same rule `count` follows one line up. */
    parts: parts?.length ? parts : null,
  };
}

/**
 * An edge's proof state.
 *
 * NOTE THAT ON THIS ENGINE NO `import` EDGE EVER REACHES THIS FUNCTION, and
 * that is a decision rather than an accident — item canvas-fixes 3.
 * `packages/export/src/project.ts:124` drops them (`if (e.kind === 'import')
 * continue;`) before the diagram is built. An import says one FILE names
 * another; the board's nodes are services, so drawing it as a connector would
 * assert at the system level a thing only measured at the file level. The
 * reasoning, and the honest empty state the board draws instead, are in
 * `ConnectedBoard.tsx`'s `edgeless` memo.
 *
 * `import` and `call` are things the analyzer followed in the source. `http`,
 * `grpc`, `queue` and `db` are, on this engine, overwhelmingly read out of
 * configuration — and CANON records what it cost to get this wrong the other
 * way: `svc:gateway`'s only two inbound edges were nginx confs inside test
 * fixtures, both carrying `origin: 'deterministic'`, and the board drew them as
 * facts. When the wire carries a real per-edge origin (item 1.x), this function
 * reads it and the family stops being a proxy. Until then it under-claims,
 * which is the direction an honest tool errs in.
 */
/** `{}`, `{label}` or `{label, labelFull}` — never a key set to undefined. */
function tagFields(label: string | undefined): {
  label?: string;
  labelFull?: string;
} {
  const tag = edgeTag(label);
  if (!tag) return {};
  return tag.full ? { label: tag.text, labelFull: tag.full } : { label: tag.text };
}

export function proofOf(edge: SeqDiagramEdge): EdgeProof {
  return edge.family === 'import' || edge.family === 'call' ? 'traced' : 'declared';
}

/**
 * Depth from the entry points, then a column per depth.
 *
 * Cycles are normal in a real repository, so the walk is a BFS with a visited
 * set rather than a topological sort that could refuse to terminate. A node no
 * BFS reaches — an island — is placed in the first column rather than dropped:
 * the board never declines to draw a node the analyzer found.
 */
function depths(nodes: readonly SeqDiagramNode[], edges: readonly SeqDiagramEdge[]) {
  const inbound = new Map<string, number>();
  for (const node of nodes) inbound.set(node.id, 0);
  for (const edge of edges) {
    if (inbound.has(edge.to)) inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
  }

  const out = new Map<string, string[]>();
  for (const edge of edges) {
    if (!out.has(edge.from)) out.set(edge.from, []);
    out.get(edge.from)!.push(edge.to);
  }

  const depth = new Map<string, number>();
  const roots = nodes.filter((node) => (inbound.get(node.id) ?? 0) === 0).map((node) => node.id);
  const queue = roots.length ? [...roots] : nodes.slice(0, 1).map((node) => node.id);
  for (const id of queue) depth.set(id, 0);

  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!;
    const here = depth.get(id) ?? 0;
    for (const next of out.get(id) ?? []) {
      if (depth.has(next)) continue;
      depth.set(next, here + 1);
      queue.push(next);
    }
  }

  for (const node of nodes) if (!depth.has(node.id)) depth.set(node.id, 0);
  return depth;
}

/** The gutter between columns and rows. --arch-card-w + --sp-40 across.
 *  Vertical pitch is content-tall: each card's own first-glance height
 *  (CARD_FLOOR when the work description is blank; taller when English earns
 *  a line) plus --sp-24. Never the old 96px chassis. */
const COLUMN_GAP = 40;
const ROW_GAP = 24;
/** Extra vertical separation between TD layers in the seed layout. */
const LAYER_GAP = 48;

export function projectDocument(doc: SeqDiagramV1): Projection {
  const profile = classifySeqDiagramLayout(doc);
  const depth = depths(doc.nodes, doc.edges);
  const nodes = doc.nodes.map(boardNodeFrom);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const positions: Record<string, { x: number; y: number }> = {};

  if (profile.engine === 'circular-loop') {
    const ids = doc.nodes.map((n) => n.id);
    const n = ids.length;
    const radius = 220;
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i]!;
      const angle = (2 * Math.PI * i) / Math.max(n, 1) - Math.PI / 2;
      positions[id] = {
        x: radius * Math.cos(angle) - CARD_W / 2,
        y: radius * Math.sin(angle),
      };
    }
  } else {
    const direction = profile.direction;
    /** Running y cursor per LR column. */
    const yIn = new Map<number, number>();
    const layerIndex = new Map<number, number>();

    for (const node of doc.nodes) {
      const layer = depth.get(node.id) ?? 0;
      const idx = layerIndex.get(layer) ?? 0;
      layerIndex.set(layer, idx + 1);
      const board = byId.get(node.id)!;

      if (direction === 'TD') {
        positions[node.id] = {
          x: idx * (CARD_W + COLUMN_GAP),
          y: layer * (cardHeight(board, 1) + LAYER_GAP),
        };
      } else {
        const y = yIn.get(layer) ?? 0;
        positions[node.id] = { x: layer * (CARD_W + COLUMN_GAP), y };
        yIn.set(layer, y + cardHeight(board, 1) + ROW_GAP);
      }
    }
  }

  const known = new Set(doc.nodes.map((node) => node.id));

  return {
    nodes,
    // An edge whose endpoints are not both on the board is dropped HERE rather
    // than drawn to a guessed coordinate. A connector between two places the
    // reader cannot see is the grounded claim spent on nothing.
    edges: doc.edges
      .filter((edge) => known.has(edge.from) && known.has(edge.to))
      .map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        proof: proofOf(edge),
        /* THE VERB THE DOCUMENT ALREADY CARRIED, and which this projector used
           to drop. `SeqDiagramEdge.label` is where an AI-proposed topology puts
           'publishes order.placed' and where a scanned http edge puts its
           route; `renderSeqDiagramSvg` has rendered it for the same document
           since it was written. Dropping it here is why the CLI's picture said
           more than the canvas did.

           BOUNDED BY `edgeTag`, because the projector joins a projected edge's
           distinct member labels with ', ' and this repository's one scanned
           connector arrives as four of them — 480 painted pixels of --t-10 mono
           lying across the board, measured in the shipped bundle. An SVG <text>
           has no `text-overflow`, so the budget has to be applied to the STRING
           or not at all.

           SPREAD, NOT SET TO undefined: `BoardEdge.label` is optional, and an
           explicit `label: undefined` is a different object shape from an
           absent key — enough to defeat the identity checks the router and
           `promoteOnFlow` lean on. */
        ...tagFields(edge.label),
      })),
    positions,
  };
}
