/* ══════════════════════════════════════════════════════════════════════════
   ANATOMY — one node's children, drawn inside that node's own footprint
   packages/web2/src/canvas/anatomy.ts

   Owner ruling, 2026-09-02 (relayed): "anatomy is the cleanest." Clicking a
   node does not open a side panel of text — the node shows what it is MADE OF.
   Children are a packed treemap, cell AREA = lines of code, and an edge leaving
   the container is drawn from the CELL OF THE FILE IT ACTUALLY LEAVES FROM
   rather than from the border of a box.

   THE MEASUREMENTS ARE docs/research/anatomy-view-measurements.md AND THEY WERE
   TAKEN BEFORE THIS FILE EXISTED. Every rule below is one of that document's,
   and each of them corrects a mistake that was made on the way to it. Nothing
   here is re-derived; where a number in that document has since moved, this
   file pins the INVARIANT instead of the number — see `rollUpAnatomy`.

   ── WHAT THIS IS NOT, AND THE RULING THAT SAYS SO ─────────────────────────

   The architecture board has a STANDING RULING that containment was cut:
   opening REPLACES the view, one level at a time. It is enforced in
   `BoardMenu.tsx` (`onOpen`) and `ConnectedBoard.tsx` (`openedService`), locked
   by `boardMenuRendered.test.tsx`, and a crumb trail was once built and
   REVERTED for violating it (docs/COMPETITIVE-GAPS-2026-08-22.md §33).

   ANATOMY IS A THIRD GESTURE AND TOUCHES NEITHER OF THE OTHER TWO. A menu
   Open is navigation and still replaces the view. A plain click is selection.
   Anatomy is a rendering of ONE node drawn inside that node's own footprint: it
   adds no board node, no board edge, no second structural level and no crumb
   trail, so it re-enables none of the nesting that was cut. The measurements
   document works this through in §8 and reaches the same resolution.

   ── DETERMINISM IS A LAW (MADR amendment A4) ──────────────────────────────

   Same graph in, same rectangles out. The treemap is squarified with ties
   broken on this file's own stated order (size descending, then node id
   ascending). There is no seed, no jitter, no `Math.random`, and no `Date.now`
   anywhere in the layout — a picture that moves when nothing changed cannot be
   read as a measurement.

   ── SHADE: DECLINED, AND HERE IS WHY, SO NOBODY ADDS ONE ──────────────────

   CHURN IS DECLINED AND THE RULING ALREADY SAID SO. There is no churn in the
   graph. Getting it means a `git log` per file, which is a SCANNER change and
   not this change; a renderer that shells out to git to paint a rectangle is a
   new data source arriving through the paint layer. Do not add one here.

   PAGE RANK IS DECLINED TOO, and that one is a judgement, so it is written
   down rather than left to be rediscovered:

     1. `meta.pageRank` exists on 969/969 FILE nodes and on NO container node.
        A cell in this treemap is a module, a datastore or a file, mixed in one
        picture. Rolling a container's shade up out of its files (sum, max or
        mean) is a number the engine never computed — Graphite law 4, never
        invent a number — and shading only the file cells would paint every
        module blank, which reads as "modules are cold". That is a lie about
        the one thing this view exists to tell the truth about.
     2. Even file-only, the distribution refuses a ramp: min 0.0011, p50 0.0015,
        p95 0.0575, max 0.5745, and 133 distinct values across 969 files. A
        LINEAR ramp paints ~95% of cells the identical floor shade and reads as
        a bug. Rank or quantile banding fixes the ramp and not (1).
     3. THE SUBSTRATE HAS ALREADY REFUSED THIS EXACT THING. tokens/graphite.css
        carries a deleted five-step sequential ramp with the deletion recorded
        as the point: "An ungoverned five-step hue ramp sitting in the substrate
        is the exact hole through which kind-by-hue comes back … If a real heat
        surface is ever specified, it arrives WITH the surface that justifies it
        and with a written meaning for each step — not before."

   SO CELLS ARE NEUTRAL AND AREA CARRIES THE READING, which the ruling
   explicitly permits. The tones they take are the substrate's own NESTING
   greys (--nest-1/2/3), which already mean depth and mean nothing else. If a
   heat surface is ever specified, it arrives with a sheet.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ArchEdge, ArchGraph, ArchNode, NodeKind } from '@sequence/schema';

/** A rectangle in the panel's own coordinate space, origin top-left. */
export interface AnatomyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a container holds, counted over its whole subtree. */
export interface AnatomySize {
  files: number;
  loc: number;
}

const ZERO: AnatomySize = { files: 0, loc: 0 };

/**
 * THE ROLLUP, AND THE ONE MISTAKE IT EXISTS TO REFUSE.
 *
 * ROLL UP RECURSIVELY, NEVER BY DIRECT CHILDREN. This single error produced
 * three separate wrong answers before any code was written, and
 * docs/research/anatomy-view-measurements.md §6 is the worked example: counting
 * DIRECT file children reported the fully-scanned `api-types` package and the
 * REPO ROOT ITSELF as empty. The repo root has 0 direct file children, 10
 * service children and 969 file descendants — a "no direct file children"
 * predicate would have shipped a blank board as the top-level view of the whole
 * product. A CONTAINER'S SIZE IS ITS DESCENDANTS' SIZE.
 *
 * DUPLICATES ARE COUNTED, NOT ASSUMED AWAY. A walk that visits one file twice
 * and misses another lands on a plausible line total, and a lock that pinned
 * only the total would call that green. So the walk records how many nodes it
 * reached a second time, and the lock pins that at zero alongside both axes.
 * The visited set also makes a malformed `parentId` cycle terminate instead of
 * hanging the board — a hang is worse than a failure (CANON §6).
 *
 * WHAT IS PINNED IS THE INVARIANT, NOT THE FIGURE. §6's cross-check is three
 * independent paths agreeing on BOTH axes — the flat sum of every file node's
 * `meta.loc`, the repo node's own `meta.languages` totals, and this recursive
 * walk. The document recorded 969 files / 247,227 loc on its own scan; the same
 * three paths agreed on 969 / 248,456 three hours later, because this
 * repository is its own test corpus and agents were writing files (CANON:
 * "never pin a number that moves"). The AGREEMENT is the claim. The figure is
 * a timestamp.
 */
export interface AnatomyIndex {
  /** Direct children of a node, in graph order. Modules and files, mixed. */
  childrenOf: (id: string) => readonly ArchNode[];
  /** The node's whole subtree, files and lines. Absent node ⇒ zero. */
  sizeOf: (id: string) => AnatomySize;
  /** Nodes the walk reached more than once. MUST be 0 on a well-formed graph. */
  duplicates: number;
  /** Every file node under every root, by the same recursive walk. */
  total: AnatomySize;
  /** A file node by repo-relative path, separators normalised. */
  fileByPath: (path: string) => ArchNode | undefined;
  node: (id: string) => ArchNode | undefined;
}

/** The scanner writes Windows separators on Windows; evidence and `path` must
 *  be compared in one spelling or a leader line silently falls to the border.
 *  (CANON records `scanRepo` emitting `file:gateway\src\index.ts` as a real
 *  cross-platform identity bug — this is the same hazard, one layer up.) */
function slash(path: string): string {
  return path.replace(/\\/g, '/');
}

export function indexAnatomy(graph: ArchGraph): AnatomyIndex {
  const byId = new Map<string, ArchNode>();
  const children = new Map<string, ArchNode[]>();
  const files = new Map<string, ArchNode>();

  for (const node of graph.nodes) {
    byId.set(node.id, node);
    if (node.kind === 'file' && node.path) files.set(slash(node.path), node);
  }
  for (const node of graph.nodes) {
    if (!node.parentId) continue;
    /* A parentId naming a node that is not in the graph is a broken edge of the
       containment tree, not a new root. Dropping it here keeps `total` equal to
       the flat sum; hoisting it to a root would double-count it under both. */
    if (!byId.has(node.parentId)) continue;
    const list = children.get(node.parentId);
    if (list) list.push(node);
    else children.set(node.parentId, [node]);
  }

  /* A ROOT IS A NODE WITH NOWHERE TO BE. That is a node with no `parentId` AND
     a node whose `parentId` names something the graph does not contain — the
     second is an orphan, and treating it as a root is what keeps `total` equal
     to the flat sum instead of quietly losing it. */
  const roots = graph.nodes.filter((node) => !node.parentId || !byId.has(node.parentId));

  /* ONE WALK, ITERATIVE. Recursion here is a stack the browser owns and this
     module does not, and a `parentId` cycle would ride it into a hang — CANON:
     "a hang is worse than a failure", because CI reads it as infrastructure. */
  const order: string[] = [];
  const visited = new Set<string>();
  let duplicates = 0;
  const stack: string[] = roots.map((node) => node.id).reverse();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) {
      /* Reached a second time. On a well-formed containment tree this never
         happens, and the lock pins it at zero — because a walk that visits one
         file twice and misses another lands on a plausible line total, and a
         lock on the total alone would call that green. */
      duplicates += 1;
      continue;
    }
    visited.add(id);
    order.push(id);
    for (const child of children.get(id) ?? []) stack.push(child.id);
  }
  /* Anything a cycle kept out of the walk still exists. It gets a size of its
     own so `sizeOf` never answers zero for a node that has children; it is not
     added to `total`, which is a claim about the containment TREE. */
  for (const node of graph.nodes) if (!visited.has(node.id)) order.push(node.id);

  /* Deepest first: `order` is a pre-order push list, so reversing it settles
     every child before its parent. */
  const sizes = new Map<string, AnatomySize>();
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const id = order[i]!;
    const self = byId.get(id);
    let fileCount = self?.kind === 'file' ? 1 : 0;
    let loc = self?.kind === 'file' ? (self.meta?.loc ?? 0) : 0;
    for (const child of children.get(id) ?? []) {
      const size = sizes.get(child.id) ?? ZERO;
      fileCount += size.files;
      loc += size.loc;
    }
    sizes.set(id, { files: fileCount, loc });
  }

  /* Every root, not just `repo`: a graph with two roots would otherwise report
     a total that silently excludes one of them. */
  let total = ZERO;
  for (const root of roots) {
    const size = sizes.get(root.id) ?? ZERO;
    total = { files: total.files + size.files, loc: total.loc + size.loc };
  }

  return {
    childrenOf: (id) => children.get(id) ?? [],
    sizeOf: (id) => sizes.get(id) ?? ZERO,
    duplicates,
    total,
    fileByPath: (path) => files.get(slash(path)),
    node: (id) => byId.get(id),
  };
}

/**
 * THE FLAT SUM — path A of §6's three-way cross-check, computed independently
 * of any walk so that the lock has something to disagree with.
 */
export function flatFileTotal(graph: ArchGraph): AnatomySize {
  let files = 0;
  let loc = 0;
  for (const node of graph.nodes) {
    if (node.kind !== 'file') continue;
    files += 1;
    loc += node.meta?.loc ?? 0;
  }
  return { files, loc };
}

/**
 * THE EMPTY PREDICATE IS "NO CHILDREN AT ALL". It is not "no file children" and
 * it is not "no file descendants", and the difference is not academic:
 *
 *   A  no children at all       -> 1 of 42   ds:analyzer-db, a datastore
 *   B  no DIRECT file children  -> 3 of 42   the repo root, api-types, and it
 *   C  no file DESCENDANTS      -> 1 of 42   it again
 *
 * B is the trap and it has now been fallen into three times. Under B the REPO
 * ROOT reports empty — and opening the repo root is the top-level view of the
 * entire product, so B ships the worst possible false empty. It draws ten
 * cells.
 *
 * A and C AGREE ON ALL 42 NODES OF THIS REPOSITORY and diverge the moment a
 * container holds only empty containers. A is the rule: a container may hold a
 * child that is itself empty, the view draws that child as a cell, and the
 * honest empty belongs one level down when the reader drills into it. C would
 * swallow the parent whole. No container here holds only empty containers, so
 * that divergence CANNOT be exercised against this repo — the lock for it is
 * synthetic, and says so in the test file.
 */
export function anatomyIsEmpty(index: AnatomyIndex, nodeId: string): boolean {
  return index.childrenOf(nodeId).length === 0;
}

export interface AnatomyCell {
  /**
   * THE NODE ID, AND IT IS NEVER THE PATH.
   *
   * Modules are Louvain community clusters, not directories: six modules
   * legitimately share `packages/analyzer/src`, and four other services have
   * two or three apiece. Keying a cell by `path` collides six sibling cells
   * into one and silently loses five of them. Where a breadcrumb or a URL has
   * to name a level it uses the LABEL WITH THE ID, never the path.
   */
  id: string;
  label: string;
  kind: NodeKind;
  /** Repo-relative, forward-slashed, or null. For display and for nothing else
   *  — see the identity note on `id`. */
  path: string | null;
  files: number;
  loc: number;
  /** Has children of its own, so the drill-down is genuinely recursive. */
  container: boolean;
  rect: AnatomyRect;
  /**
   * FALSE means this cell is in the zero band and its rectangle is NOT its
   * area. See `anatomyPanel` — a child that rolls up to zero lines cannot take
   * area in a map whose whole contract is that area is lines, and dropping it
   * would be a silent omission of a real child.
   */
  toScale: boolean;
}

/**
 * ONE STROKE PER ORIGIN CELL, however many edges leave it.
 *
 * 64 edges leave `repoServer.ts` alone (34 App.tsx, 33 scan.ts). Sixty-four
 * separate strokes into one small cell is a legibility failure, so the edges
 * are BUNDLED at the origin: one leader, carrying its count, per cell. The
 * count is the honest thing to draw — a bundle that did not say how many it
 * carried would be a thinner lie than the sixty-four strokes.
 */
export interface AnatomyLeader {
  /** The cell the edges leave from, or NULL for the border fallback. */
  cellId: string | null;
  count: number;
  /** The edges in this bundle, in graph order. */
  edgeIds: readonly string[];
}

export interface AnatomyPanel {
  nodeId: string;
  label: string;
  /** The container's own recursive size — what the cells sum to. */
  size: AnatomySize;
  cells: readonly AnatomyCell[];
  /** `anatomyIsEmpty`. When true, `cells` is empty and the panel says what a
   *  node with nothing inside IS, rather than apologising for a missing scan. */
  empty: boolean;
  leaders: readonly AnatomyLeader[];
  /** How many children rolled up to zero lines and went to the zero band. */
  zeroCount: number;
  /**
   * THE AGGREGATE IS ON SCREEN AND ITS NAME IS NOT.
   *
   * The loose-file bucket is the only cell whose subject does not exist in the
   * scan — it stands for N real children. It is built with `kind: 'file'`, so
   * when its rectangle is too small to carry "284 loose files" a reader meets a
   * plain unnamed cell and reads it as ONE file. That is not a withheld label
   * (every cell keeps its name in a `<title>`); it is a structure the repository
   * does not have. Measured on this monorepo: analyzer's bucket is 61.7 x 115.0
   * against a 96px name — short by 34.29px.
   *
   * TRUE means the panel owes the reader a written declaration, and the card
   * owes it a row. False when there is no bucket, or when its name renders and
   * the cell already says what it is (§3 — content that names itself is not
   * labelled again).
   */
  bucketUnnamed: boolean;
}

/* ── GEOMETRY — SHEET 07's WALL, NOT A NEW OBJECT ─────────────────────────
   docs/brand/graphite/pages/07-modules-and-containment.html §07.2: "A module
   with drawn members is not a card. It is a .nest — a wall with a header and
   its members laid out inside it." Anatomy is that wall, drawn inside the card
   it belongs to, so it inherits the sheet's arithmetic rather than inventing a
   second containment look:

     wall radius   --r-18            wall inset  --nest-inset (--sp-4)
     wall border   --w-struct dashed --edge      header      --nest-hd-h (24px)

   §07.3 supplies the rest of the behaviour verbatim: "The disclosure control is
   the header itself, not a button parked on it" — so the header strip closes
   the panel, and no 26px icon button is minted for it. Numbers are named after
   the tokens they are, and `anatomy.test.ts` reads the live values.

   THE MEMBERS TAKE NO RADIUS, WHICH IS THE ONE PLACE THIS DEPARTS FROM §07.2's
   "member radius --r-14 · 18 − 4, by arithmetic". That arithmetic is for
   members separated by a --sp-8 gap. A treemap has NO gutters — its whole claim
   is that the rectangles tile the container exactly — so a rounded member would
   either overlap its neighbour or open a gap that misrepresents the area. The
   radius therefore lives on the wall, which clips them. */
const SP_4 = 4; // --sp-4
const SP_10 = 10; // --sp-10
const T_10 = 10; // --t-10 at line-height 1
const LH_10 = 14; // --lh-10
const W_STRUCT = 1.5; // --w-struct — the module wall's own DECLARED weight
const NEST_INSET = SP_4; // --nest-inset
const NEST_HD_H = 24; // --nest-hd-h

/**
 * WHAT THE WALL'S BORDER PAINTS, WHICH IS NOT WHAT IT DECLARES.
 *
 * A border is rasterised in whole device pixels. Probed in the running app
 * (Chrome, devicePixelRatio 1, 2026-09-02): an element carrying
 * `border: 1.5px solid` computes `border-top-width: 1px` and its box comes back
 * one unit shorter per side than the declaration. The wall was measured whole
 * at the same time — `svc:analyzer` opened, panel box 213 = two borders + two
 * --nest-inset + two --sp-4 row gaps + the 24 header + the 129 map + the 42
 * note — and 213 only balances with ONE unit per side.
 *
 * THIS IS THE ONE PART OF A CARD'S HEIGHT THE DISPLAY DECIDES, so it is named
 * here rather than left inside an arithmetic that looks token-clean. On a 2x
 * display the same border resolves to 1.5 per side and the wall paints one unit
 * taller than this reserves. `cardBox.ts` already made the same choice for the
 * CHASSIS — `--arch-weight-store` and `--arch-weight-agent` are --w-struct too,
 * and the card model has always counted them as one hairline per side, which
 * `cardBox.test.ts`'s kind-parity lock has been asserting all along.
 */
const WALL_BORDER = 1;

/** --arch-card-w. Restated rather than imported so this module stays free of
 *  `cardBox`'s React-adjacent types; `anatomy.test.ts` asserts they agree. */
const CARD_W = 160;

/**
 * THE MAP IS A SQUARE AS WIDE AS THE WALL'S CONTENT BOX.
 *
 * `cardBox.ts`: "HEIGHT IS CONTENT. Width is fixed at --arch-card-w because a
 * board reads as a board when its columns line up; height is not fixed and must
 * not be." Anatomy obeys that rather than arguing with it — the footprint grows
 * DOWNWARD only, so opening one node never breaks the column rhythm.
 *
 * 160 card − two --sp-10 pads − two --w-struct wall borders − two --nest-inset
 * = 160 − 20 − 3 − 8 = 129.
 */
export const ANATOMY_MAP = CARD_W - SP_10 * 2 - W_STRUCT * 2 - NEST_INSET * 2;

/** A --t-10 row at the bottom of the map for children that hold nothing. */
export const ANATOMY_ZERO_BAND = T_10 + SP_4;

/**
 * The extra card height an open anatomy costs, derived the way `VISUAL_STRIP_H`
 * is — from the sheet's own parts, so no new number enters the ramp: the card's
 * column gap, the wall's two borders, its inset above and below, its 24px
 * header, THE WALL'S OWN ROW GAP under that header, and the map.
 *
 * THE ROW GAP WAS MISSING AND IT IS WHY THE WALL NEVER CAME OUT EXACT. `.ana`
 * is `display: flex; flex-direction: column; gap: var(--sp-4)`, so every pair
 * of its children is separated by four units the same way the card separates
 * the body from the wall. The panel has two children at minimum (header, map)
 * and three when the zero-band note renders. This constant carries the first
 * gap; `ANATOMY_NOTE_H` carries the second, which is why the note's own --sp-4
 * lives there and not here.
 */
export const ANATOMY_EXTRA_H =
  SP_4 + WALL_BORDER * 2 + NEST_INSET * 2 + NEST_HD_H + SP_4 + ANATOMY_MAP;

/**
 * THE ZERO-BAND NOTE IS A THIRD ROW, AND IT WAS NOT RESERVED.
 *
 * MEASURED IN THE RUNNING APP, which is the only place it was visible. The
 * panel has three children, not two: `.ana-hd` (24), `.ana-map` (129) and
 * `.ana-note` (42) — the sentence that says the bottom band is not to scale.
 * `ANATOMY_EXTRA_H` above is derived from the sheet's parts and accounts for
 * the first two, so a node WITH zero-area children painted 262 board units
 * against a declared 190 and hung 72 outside the box its neighbours are
 * positioned from. No collision on this repository's board; the first denser
 * repo would have found one, and no test could have caught it because every
 * test asserts the declared box.
 *
 * THREE LINES, AND THAT IS ARITHMETIC RATHER THAN A GUESS. The note sets
 * `--t-10`/`--lh-10` (10px on 14px) and wraps inside `ANATOMY_MAP`'s 129; the
 * longer of its two sentences takes three of those lines, which is the 42 that
 * was measured. The shorter one takes two, so a node with a single empty child
 * reserves fourteen units it does not paint — deliberately, because
 * over-reserving leaves a gap and under-reserving overlaps a neighbour.
 *
 * THE --sp-4 IS THE WALL'S SECOND ROW GAP, not the note's own padding: `.ana`
 * has no vertical padding of its own beyond --nest-inset (already in
 * `ANATOMY_EXTRA_H`) and `.ana-note` sets `padding: 0 var(--sp-6)`. A third
 * child costs one more gap; that is the whole of the difference.
 */
export const ANATOMY_NOTE_H = SP_4 + LH_10 * 3;

/**
 * The extra card height THIS panel costs, note included when it has one.
 *
 * A constant cannot answer this: the note renders only when the container has
 * children that roll up to zero lines, which is a fact about the graph rather
 * than about the sheet. `cardBox` therefore takes the panel, not a boolean.
 */
export function anatomyExtraHeight(
  panel: Pick<AnatomyPanel, 'zeroCount' | 'bucketUnnamed'> | null,
): number {
  if (!panel) return 0;
  /* ONE ROW PER NOTE THAT WILL ACTUALLY RENDER. Two notes reserved as one is the
     42-unit under-reservation `cardBox` records, and one note reserved as two is
     dead ground under the map — the sheet's own complaint. So each note is
     counted, and each is counted only when its condition holds. */
  const notes = (panel.zeroCount > 0 ? 1 : 0) + (panel.bucketUnnamed ? 1 : 0);
  return ANATOMY_EXTRA_H + ANATOMY_NOTE_H * notes;
}

/* ── THE LABEL PREDICATE LIVES HERE, WITH THE GEOMETRY ────────────────────
   A cell carries its name only where the WHOLE name fits: the alternative is an
   ellipsis that claims room while saying nothing, or a name that runs past its
   rectangle onto the neighbour and reads as the neighbour's.

   IT MOVED OUT OF THE RENDERER, and the reason is the note below it. Whether the
   bucket needs a written declaration depends on whether its name renders, and
   whether the CARD needs a row reserved for that declaration depends on the same
   fact — so the height model has to be able to ask. A predicate only the painter
   could evaluate forced the reservation to guess, and a reservation that guesses
   is either dead ground or a paint over the border.

   THE ADVANCE IS MEASURED, NOT ESTIMATED. JetBrains Mono at --t-10 advances
   EXACTLY 6.0px per character, read off the running board: "server" 36.0 over 6,
   "explain" 42.0 over 7, "detectors" 54.0 over 9, "Database" 48.0 over 8. A
   monospace face is the only reason a width can be known before layout — the
   `.ana-label` rule is locked to `var(--font-mono)` at `var(--t-10)` by
   `anatomyLabelFont.test.ts` for exactly this reason. If that face ever stops
   being mono this has to become a real measurement. */
const MONO_ADVANCE = 6;
/** The label's inset from its cell's edges, and the height its line box needs.
    Exported because the painter positions the text with the same two numbers the
    predicate decides with — two copies would drift. */
export const ANATOMY_LABEL_INSET = 3;
export const ANATOMY_LABEL_MIN_H = 12;
const LABEL_INSET = ANATOMY_LABEL_INSET;
const LABEL_MIN_H = ANATOMY_LABEL_MIN_H;

export function anatomyLabelFits(rect: AnatomyRect, label: string): boolean {
  return rect.h >= LABEL_MIN_H && rect.w >= label.length * MONO_ADVANCE + LABEL_INSET * 2;
}

/**
 * SQUARIFIED TREEMAP — Bruls, Huizing and van Kreveld, unmodified.
 *
 * Deterministic by construction: it consumes the values in the order it is
 * given and makes every row decision on an aspect-ratio comparison. The caller
 * owns the order and states it (`anatomyPanel`: size descending, then id
 * ascending). No seed, no jitter, no clock.
 *
 * AREA IS EXACT AND IS NOT CLAMPED. A minimum cell size would make a small
 * child look bigger than it is, which on a view whose entire claim is
 * "area = lines" is the one lie that cannot be permitted. A cell that comes out
 * thin IS thin; the panel's header carries the container's true totals so the
 * reader always has the number even when a rectangle is too small to read.
 */
export function squarifyAnatomy(values: readonly number[], frame: AnatomyRect): AnatomyRect[] {
  const out: AnatomyRect[] = values.map(() => ({ x: frame.x, y: frame.y, w: 0, h: 0 }));
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0 || frame.w <= 0 || frame.h <= 0) return out;

  const areas = values.map((value) => (Math.max(0, value) / total) * frame.w * frame.h);

  /** The worst aspect ratio in a row laid along a side of length `side`. */
  function worst(row: readonly number[], side: number): number {
    if (row.length === 0 || side <= 0) return Number.POSITIVE_INFINITY;
    let sum = 0;
    let max = -Infinity;
    let min = Infinity;
    for (const area of row) {
      sum += area;
      if (area > max) max = area;
      if (area < min) min = area;
    }
    if (sum <= 0 || min <= 0) return Number.POSITIVE_INFINITY;
    const s2 = sum * sum;
    const side2 = side * side;
    return Math.max((side2 * max) / s2, s2 / (side2 * min));
  }

  let free: AnatomyRect = { ...frame };
  let i = 0;
  while (i < areas.length) {
    if (free.w <= 0 || free.h <= 0) break;
    const side = Math.min(free.w, free.h);
    const row: number[] = [];
    let j = i;
    while (j < areas.length) {
      const candidate = [...row, areas[j]!];
      if (row.length > 0 && worst(candidate, side) > worst(row, side)) break;
      row.push(areas[j]!);
      j += 1;
    }
    const rowSum = row.reduce((sum, area) => sum + area, 0);
    if (rowSum <= 0) break;

    if (free.w <= free.h) {
      // A horizontal band across the top of what is left.
      const h = Math.min(rowSum / free.w, free.h);
      let x = free.x;
      for (let k = 0; k < row.length; k += 1) {
        const w = h > 0 ? row[k]! / h : 0;
        out[i + k] = { x, y: free.y, w, h };
        x += w;
      }
      free = { x: free.x, y: free.y + h, w: free.w, h: free.h - h };
    } else {
      // A vertical band down the left of what is left.
      const w = Math.min(rowSum / free.h, free.w);
      let y = free.y;
      for (let k = 0; k < row.length; k += 1) {
        const h = w > 0 ? row[k]! / w : 0;
        out[i + k] = { x: free.x, y, w, h };
        y += h;
      }
      free = { x: free.x + w, y: free.y, w: free.w - w, h: free.h };
    }
    i = j;
  }
  return out;
}

/** Which DIRECT child of `containerId` owns this node, or null when the node is
 *  not under the container at all. */
function cellOwnerOf(index: AnatomyIndex, containerId: string, startId: string): string | null {
  let current = index.node(startId);
  let guard = 0;
  while (current && guard < 4096) {
    if (current.parentId === containerId) return current.id;
    current = current.parentId ? index.node(current.parentId) : undefined;
    guard += 1;
  }
  return null;
}

/**
 * WHERE AN EDGE LEAVES FROM — `evidence[0].file`, resolved to one of this
 * container's own cells.
 *
 * WHERE EVIDENCE NAMES A FILE THAT IS NOT IN THE OPENED NODE, THE ANSWER IS THE
 * BORDER AND NEVER AN INVENTED CELL. On this repository that fallback never
 * fires: for every one of the top six containers, 100% of outgoing edges
 * resolve to a cell and 0 fall to the border. A branch no real input reaches is
 * a branch that rots green, so it is locked by a test that feeds SYNTHETIC
 * evidence naming a foreign file — not by opening a container and observing
 * that nothing broke.
 */
export function leaderOriginFor(
  index: AnatomyIndex,
  containerId: string,
  edge: ArchEdge,
): string | null {
  const file = edge.evidence?.[0]?.file;
  if (!file) return null;
  const node = index.fileByPath(file);
  if (!node) return null;
  return cellOwnerOf(index, containerId, node.id);
}

/** Every edge whose source is inside this container and whose target is not. */
function edgesLeaving(index: AnatomyIndex, graph: ArchGraph, containerId: string): ArchEdge[] {
  const inside = new Set<string>([containerId]);
  const stack = [...index.childrenOf(containerId)];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (inside.has(node.id)) continue;
    inside.add(node.id);
    for (const child of index.childrenOf(node.id)) stack.push(child);
  }
  return graph.edges.filter((edge) => inside.has(edge.srcId) && !inside.has(edge.dstId));
}

/**
 * THE PANEL — one node's children, packed, with its leader bundles.
 *
 * CHILDREN ARE MODULES AND FILES, MIXED, AND A CELL MAY ITSELF BE A CONTAINER.
 * That is what makes this recursive rather than one flat level, and it is also
 * the correction §2 of the measurements exists for: a service's DIRECT file
 * children are its TEST OVERFLOW — 237 of 237 under `analyzer`, 181 of 181
 * under `web2`, with no production file parented directly to either. Drawing
 * those blended into the package's shape would label the test bucket as the
 * package. They are drawn as what they are: their own cells, at their true
 * size, beside the six real modules.
 */
/** Synthetic id for a container's loose-file bucket. Never a real node id. */
export function anatomyBucketId(containerId: string): string {
  return `anatomy:files:${containerId}`;
}

/** True for the synthetic bucket above. It holds files, so it IS a container —
    `index.childrenOf` cannot know that, because the id is not in the graph. */
export function isAnatomyBucket(id: string): boolean {
  return id.startsWith('anatomy:files:');
}

/**
 * A MIXED CONTAINER'S LOOSE FILES ARE ONE BUCKET; A PURE-FILE ONE'S ARE NOT.
 *
 * MEASURED FROM THE RUNNING APP, not argued. Drawing `svc:analyzer`'s 237 loose
 * files as 237 cells produced a 138x213-unit wall in which **235 of 244 cells
 * were under 10 units** and the smallest was 1.3 — needing 3x board zoom just to
 * reach 4 CSS px — with exactly TWO labels drawn. That is a texture, not a map:
 * nothing in the haze can be read, named or clicked, and the six real modules it
 * is supposed to sit beside are crowded by it.
 *
 * §2 of the measurements asked for these to be drawn "honestly as a bucket at its
 * true size, never blended into the package's shape". Both halves are kept here.
 * NOT BLENDED: the bucket is its own cell whose area is exactly the sum of those
 * files, so no module's rectangle absorbs a single test line. A BUCKET: one
 * labelled rectangle rather than 237 slivers. It is marked `container`, so the
 * files inside it remain reachable by the same drill-down every other container
 * cell will use.
 *
 * THE GUARD IS WHAT MAKES IT HONEST RATHER THAN CONVENIENT. Grouping applies
 * ONLY when the container also has container children. A module such as `server`
 * has nothing BUT files, and its whole demonstration is that `repoServer.ts` is
 * 30.8% of it — bucketing there would delete the finding the view exists to show.
 * So `server` still draws its 48 file cells and `analyzer` draws 6 modules, one
 * bucket and a datastore.
 */
function groupLooseFiles(
  index: AnatomyIndex,
  containerId: string,
  children: readonly ArchNode[],
): Array<{ child: ArchNode; size: AnatomySize }> {
  const entries = children.map((child) => ({ child, size: index.sizeOf(child.id) }));
  const loose = entries.filter((e) => e.child.kind === 'file');
  const containers = entries.filter((e) => e.child.kind !== 'file');
  /* Nothing to group, or a pure-file container: leave it exactly as it was. */
  if (containers.length === 0 || loose.length < 2) return entries;

  const files = loose.reduce((n, e) => n + e.size.files, 0);
  const loc = loose.reduce((n, e) => n + e.size.loc, 0);
  const bucket: ArchNode = {
    id: anatomyBucketId(containerId),
    kind: 'file',
    label: `${loose.length} loose files`,
  } as ArchNode;
  return [...containers, { child: bucket, size: { files, loc } }];
}

export function anatomyPanel(
  graph: ArchGraph,
  nodeId: string,
  index: AnatomyIndex = indexAnatomy(graph),
): AnatomyPanel {
  const node = index.node(nodeId);
  const children = index.childrenOf(nodeId);
  const size = index.sizeOf(nodeId);

  /* ONE PREDICATE, ASKED ONCE. A second `children.length === 0` written inline
     here would be a second answer to "is this node empty", and the pair would
     be free to drift — which is exactly how three different empty rules got
     proposed for this view in the first place. */
  if (anatomyIsEmpty(index, nodeId)) {
    return {
      nodeId,
      label: node?.label ?? nodeId,
      size,
      cells: [],
      empty: true,
      leaders: [],
      zeroCount: 0,
      /* Nothing inside, so nothing was gathered. */
      bucketUnnamed: false,
    };
  }

  /* THE STATED ORDER, AND IT IS THE WHOLE OF THE DETERMINISM CLAIM. Size
     descending is what a squarified treemap wants; node id ascending breaks
     every tie. `Array.prototype.sort` is stable in every engine this ships to,
     but a stable sort over an unstated input order is still an unstated
     order — so the tie-break is explicit and does not lean on it. */
  const ranked = groupLooseFiles(index, nodeId, children)
    .sort((a, b) => (b.size.loc - a.size.loc) || (a.child.id < b.child.id ? -1 : a.child.id > b.child.id ? 1 : 0));

  const sized = ranked.filter((entry) => entry.size.loc > 0);
  const zeros = ranked.filter((entry) => entry.size.loc <= 0);

  /* THE ZERO BAND, AND WHY IT IS NOT AN OMISSION AND NOT A FAKE AREA.
     `ds:analyzer-db` is a real child of `svc:analyzer` and rolls up to zero
     lines — a datastore holds no files. Area = lines gives it no rectangle at
     all, so a pure treemap would silently drop a child the scan found. Giving
     it a minimum area would say it has lines it does not have. So it gets a
     row of its own, OUTSIDE the scaled map, flagged `toScale: false`, and the
     panel says the band is not to scale. Every child is drawn; no child lies
     about its size. */
  const bandH = zeros.length > 0 ? ANATOMY_ZERO_BAND : 0;
  const mapFrame: AnatomyRect = { x: 0, y: 0, w: ANATOMY_MAP, h: ANATOMY_MAP - bandH };
  const rects = squarifyAnatomy(sized.map((entry) => entry.size.loc), mapFrame);

  const cells: AnatomyCell[] = sized.map((entry, i) => ({
    id: entry.child.id,
    label: entry.child.label,
    kind: entry.child.kind,
    path: entry.child.path ? slash(entry.child.path) : null,
    files: entry.size.files,
    loc: entry.size.loc,
    container: isAnatomyBucket(entry.child.id) || index.childrenOf(entry.child.id).length > 0,
    rect: rects[i]!,
    toScale: true,
  }));

  const bandW = zeros.length > 0 ? ANATOMY_MAP / zeros.length : 0;
  zeros.forEach((entry, i) => {
    cells.push({
      id: entry.child.id,
      label: entry.child.label,
      kind: entry.child.kind,
      path: entry.child.path ? slash(entry.child.path) : null,
      files: entry.size.files,
      loc: entry.size.loc,
      container: isAnatomyBucket(entry.child.id) || index.childrenOf(entry.child.id).length > 0,
      rect: { x: i * bandW, y: ANATOMY_MAP - bandH, w: bandW, h: bandH },
      toScale: false,
    });
  });

  /* THE BUNDLES. Grouped by origin cell, insertion-ordered so the same graph
     produces the same list; the border bundle is last because it is the
     exception and reads as one. */
  const byCell = new Map<string | null, string[]>();
  for (const edge of edgesLeaving(index, graph, nodeId)) {
    const origin = leaderOriginFor(index, nodeId, edge);
    const list = byCell.get(origin);
    if (list) list.push(edge.id);
    else byCell.set(origin, [edge.id]);
  }
  const leaders: AnatomyLeader[] = [];
  for (const [cellId, edgeIds] of byCell) {
    if (cellId === null) continue;
    leaders.push({ cellId, count: edgeIds.length, edgeIds });
  }
  leaders.sort((a, b) => (b.count - a.count) || (a.cellId! < b.cellId! ? -1 : 1));
  const border = byCell.get(null);
  if (border) leaders.push({ cellId: null, count: border.length, edgeIds: border });

  return {
    nodeId,
    label: node?.label ?? nodeId,
    size,
    cells,
    empty: false,
    leaders,
    zeroCount: zeros.length,
    /* The bucket, if there is one, and only when its own cell cannot say so. */
    bucketUnnamed: cells.some(
      (c) => isAnatomyBucket(c.id) && c.toScale && !anatomyLabelFits(c.rect, c.label),
    ),
  };
}

/**
 * WHAT AN EMPTY NODE SAYS, AND IT DOES NOT APOLOGISE FOR THE SCAN.
 *
 * Exactly one node of forty-two qualifies on this repository and it is a
 * DATASTORE — `ds:analyzer-db`. A datastore legitimately contains no files, so
 * "the scan recorded nothing inside" would be a false confession: nothing was
 * missed and nothing is broken. The copy says what a datastore IS.
 *
 * Every other kind gets the honest version of the same sentence, which names
 * the SCAN as the thing that decided it — the wording `BoardMenu`'s disabled
 * Open already uses, so the two controls do not describe the same fact in two
 * voices.
 */
export function anatomyEmptyCopy(kind: NodeKind | undefined): string {
  if (kind === 'datastore') {
    return 'A datastore is something this repository talks to, not something it holds. There are no files inside one to draw.';
  }
  if (kind === 'topic') {
    return 'A topic is a channel messages travel on. It holds no files, so there is nothing inside it to draw.';
  }
  return 'The scan recorded nothing inside this node, so there is nothing to draw.';
}

/**
 * HOW HEAVY A BUNDLE'S STROKE IS — three steps off the existing edge ladder,
 * and no fourth.
 *
 * `--w-hair` · `--w-edge` · `--w-flow` already mean "a resting border", "a
 * connector the reader is not being asked to follow" and "a connector on the
 * flow being read". A bundle of 64 and a bundle of 1 leaving the same map must
 * not be the same stroke, and inventing a continuous weight ramp would be a
 * fourth vocabulary for a thing the substrate has already spelled three ways.
 * Two thresholds, stated: more than one edge, and more than eight.
 */
export function leaderWeightStep(count: number): 1 | 2 | 3 {
  if (count > 8) return 3;
  if (count > 1) return 2;
  return 1;
}
