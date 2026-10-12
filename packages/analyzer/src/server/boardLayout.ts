/**
 * THE BOARD'S LAYOUT — what turns "five boxes the model scattered" into a
 * diagram.
 *
 * Owner, verbatim: "I asked it to draw the agentic loop and it is mumbo jumbo.
 * It should draw in the same format as a markdown diagram or the architecture
 * board: much cleaner, fewer random boxes, make sure stuff doesn't escape the
 * boxes. Simple rules, simple workflows, pretty first."
 *
 * The board writers (`boardTools.ts`) let the model choose every coordinate,
 * and a model has no ruler: boxes land on top of each other, a long label runs
 * out of its box, an arrow cuts through a third box. So the SERVER decides
 * where things go. The model says WHAT is on the board and WHAT connects to
 * what; this file decides where.
 *
 * ── THE RULES, ALL OF THEM ───────────────────────────────────────────────
 *
 *  1. Every node is a box of one width. Its label is wrapped to that width with
 *     the same measurement the client wraps with, and the box grows downward to
 *     hold every line. A label can therefore never leave its box.
 *  2. Nodes are ranked by their connections (longest path from the sources).
 *     A cycle is broken at its back edge; that edge is drawn as a loop around
 *     the outside of the nodes it spans, never through them.
 *  3. Ranks are rows (top to bottom) for a flow of four or more steps and
 *     columns (left to right) for a shorter one. One gap between ranks, one gap
 *     between siblings.
 *  4. Siblings sit under the node they hang from; a chain is a straight line.
 *  5. Arrows leave a box's edge, run at right angles and end on the next box's
 *     edge. A connector is a run of `line` segments ending in one `arrow`.
 *  6. Nothing is connected and nothing is ranked? Then it is a grid.
 *
 * ── HOW A BOX IS REPRESENTED ─────────────────────────────────────────────
 *
 * The wire carries `text`, `noderef` and `shape` items and nothing else (the
 * client strips every other field), so a box is two items joined by id:
 *
 *   `X:box`  a `rect` shape that is the box itself, and
 *   `X`      the `text` (a note) or `noderef` (a card) that is its label.
 *
 * `X` keeps the model's own id, and carries an `at`, so the model can still
 * connect to it and the pipeline's known-items set still has a position for
 * it. The client draws `X` centred and wrapped inside `X:box`
 * (`whiteboardModel.composeBoxes`).
 *
 * ── PURE ─────────────────────────────────────────────────────────────────
 *
 * Specs in, items out. No fs, no clock, no randomness: the same turn twice
 * gives the same geometry, which is what lets a test assert it exactly.
 */

import type { BoardItem, BoardNodeRefItem, BoardPoint, BoardShapeItem, BoardTextItem } from './boardTools.js';

/* ===================================================== text measurement = */

/*
 * RESTATED from `packages/web2/src/whiteboard/whiteboardModel.ts`, for the same
 * reason `boardTools.ts` restates the item shapes: the server does not import
 * the browser bundle. `board-layout.test.ts` reads the model file and asserts
 * these constants and the advance buckets still match, so a change on one side
 * fails a test instead of putting a label half outside its box.
 */

/** The label size, in board units. The model's `WB_BOX_EM`. */
export const BOX_EM = 13;
/** Line pitch inside a box. The model's `WB_BOX_LINE`. */
export const BOX_LINE = 18;
/** Left and right padding inside a box. The model's `WB_BOX_PAD_X`. */
export const BOX_PAD_X = 14;
/** Top and bottom padding inside a box. The model's `WB_BOX_PAD_Y`. */
export const BOX_PAD_Y = 12;

function advanceEm(character: string): number {
  if (/\s/u.test(character)) return 0.35;
  if (/[ilI1.,'`:;|!]/u.test(character)) return 0.32;
  if (/[MWmw@#%&]/u.test(character)) return 0.9;
  if (/[A-Z0-9]/u.test(character)) return 0.68;
  if (/^[\x00-\x7f]$/u.test(character)) return 0.56;
  return 1;
}

/** Width of a one-line string at `em`, conservatively (a trailing half em of slack). */
export function measureText(value: string, em: number = BOX_EM): number {
  let advance = 0;
  for (const character of value) advance += advanceEm(character);
  return Math.max(em, (advance + 0.5) * em);
}

/**
 * Greedy word wrap to `maxWidth`. Hard newlines are kept; a single word wider
 * than the line is broken by character rather than allowed to overflow.
 */
export function wrapText(value: string, maxWidth: number, em: number = BOX_EM): string[] {
  const out: string[] = [];
  for (const paragraph of value.split('\n')) {
    const words = paragraph.split(/\s+/u).filter((w) => w !== '');
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    const flush = () => {
      if (line !== '') out.push(line);
      line = '';
    };
    for (const word of words) {
      const trial = line === '' ? word : `${line} ${word}`;
      if (measureText(trial, em) <= maxWidth) {
        line = trial;
        continue;
      }
      flush();
      if (measureText(word, em) <= maxWidth) {
        line = word;
        continue;
      }
      /* A word wider than the box: break it by character. */
      let chunk = '';
      for (const ch of word) {
        if (measureText(chunk + ch, em) > maxWidth && chunk !== '') {
          out.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    }
    flush();
  }
  return out.length === 0 ? [''] : out;
}

/* ================================================================ spec = */

export const NODE_W = 156;
export const NODE_MIN_H = 44;
/** Space between two ranks, edge to edge. */
export const RANK_GAP = 64;
/** Space between two siblings in one rank, edge to edge. */
export const SIBLING_GAP = 40;
export const LAYOUT_MARGIN = 40;
/** How far the first loop-back lane sits outside the nodes, and the step between lanes. */
const LANE_FIRST = 32;
const LANE_STEP = 18;
/** Padding a frame leaves round its members, and the headroom for its caption. */
const FRAME_PAD = 24;
const FRAME_HEAD = 24;
/** Connector labels are drawn as plain text at this size (the board's `.wb-text`). */
const LABEL_EM = 12;
/** A flow with more ranks than this runs top to bottom. */
const MAX_LR_RANKS = 3;

export const BOX_ID_SUFFIX = ':box';
export const SEGMENT_ID_SEP = ':s';
export const NODE_LABEL_SUFFIX = ':label';

export interface TurnNode {
  id: string;
  kind: 'note' | 'card';
  /** The label as the model wrote it. */
  text: string;
  /** Present on a card. */
  nodeId?: string;
  /** Where the model asked for it. Used only to place a frame round its members. */
  asked: BoardPoint | null;
}

export interface TurnEdge {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  directed: boolean;
}

export interface TurnFrame {
  id: string;
  label: string;
  from: BoardPoint;
  to: BoardPoint;
}

/** Everything the board writers have drawn so far this turn. */
export interface BoardTurn {
  nodes: TurnNode[];
  edges: TurnEdge[];
  frames: TurnFrame[];
  /** Ids already on the wire from this turn, so the next emission can replace them. */
  emitted: string[];
}

export function newBoardTurn(): BoardTurn {
  return { nodes: [], edges: [], frames: [], emitted: [] };
}

/**
 * A pile of two sticky notes is a pair of notes, not a diagram — and "put a
 * note beside the payments card" must stay beside the payments card. Layout
 * begins once the turn is plainly drawing one: a connector between two of its
 * own boxes, or three boxes.
 */
export function turnIsDiagram(turn: BoardTurn): boolean {
  const ids = new Set(turn.nodes.map((n) => n.id));
  const joined = turn.edges.some((e) => ids.has(e.fromId) && ids.has(e.toId));
  return joined || turn.nodes.length >= 3;
}

/* ============================================================== layout = */

interface Box {
  id: string;
  index: number;
  lines: string[];
  /** Board-space size. */
  w: number;
  h: number;
  /** Size along the flow axis, and across it. */
  sf: number;
  sc: number;
  rank: number;
  /** Centre along the flow axis, and across it. */
  f: number;
  c: number;
}

interface Link {
  edge: TurnEdge;
  from: number;
  to: number;
  back: boolean;
}

interface P {
  f: number;
  c: number;
}

function sizeBox(node: TurnNode, index: number): Box {
  const inner = NODE_W - 2 * BOX_PAD_X;
  const lines = wrapText(node.text, inner);
  const h = Math.max(NODE_MIN_H, lines.length * BOX_LINE + 2 * BOX_PAD_Y);
  return { id: node.id, index, lines, w: NODE_W, h, sf: 0, sc: 0, rank: 0, f: 0, c: 0 };
}

/** Break cycles: the edges that close a loop are marked `back`. */
function markBackEdges(count: number, links: Link[]): void {
  const out: Link[][] = Array.from({ length: count }, () => []);
  const incoming = new Array<number>(count).fill(0);
  for (const l of links) {
    out[l.from]!.push(l);
    incoming[l.to]! += 1;
  }
  const state = new Array<number>(count).fill(0);
  const visit = (u: number): void => {
    state[u] = 1;
    for (const l of out[u]!) {
      if (state[l.to] === 1) l.back = true;
      else if (state[l.to] === 0) visit(l.to);
    }
    state[u] = 2;
  };
  /* Sources first, so a loop is cut at the edge that returns, not at the one
     that enters it. Then whatever is left (a pure cycle). */
  for (let i = 0; i < count; i++) if (incoming[i] === 0 && state[i] === 0) visit(i);
  for (let i = 0; i < count; i++) if (state[i] === 0) visit(i);
}

function assignRanks(boxes: Box[], links: Link[]): number {
  const fwd = links.filter((l) => !l.back);
  const indeg = new Array<number>(boxes.length).fill(0);
  for (const l of fwd) indeg[l.to]! += 1;
  const queue: number[] = [];
  for (let i = 0; i < boxes.length; i++) if (indeg[i] === 0) queue.push(i);
  let max = 0;
  while (queue.length > 0) {
    const u = queue.shift()!;
    for (const l of fwd) {
      if (l.from !== u) continue;
      boxes[l.to]!.rank = Math.max(boxes[l.to]!.rank, boxes[u]!.rank + 1);
      max = Math.max(max, boxes[l.to]!.rank);
      indeg[l.to]! -= 1;
      if (indeg[l.to] === 0) queue.push(l.to);
    }
  }
  return max + 1;
}

/** Least-squares monotone fit (pool adjacent violators): the nearest legal row of centres. */
function spread(desired: number[], sep: number[]): number[] {
  const n = desired.length;
  const offset: number[] = [0];
  for (let i = 1; i < n; i++) offset.push(offset[i - 1]! + sep[i - 1]!);
  const q = desired.map((d, i) => d - offset[i]!);
  const blocks: { sum: number; count: number }[] = [];
  for (const v of q) {
    blocks.push({ sum: v, count: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1]!;
      const a = blocks[blocks.length - 2]!;
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.pop();
      blocks.pop();
      blocks.push({ sum: a.sum + b.sum, count: a.count + b.count });
    }
  }
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.count; k++) out.push(b.sum / b.count);
  return out.map((p, i) => p + offset[i]!);
}

export interface LayoutOptions {
  /** Top-left of the finished drawing. */
  origin: BoardPoint;
  /** Centres of items that are on the board but not part of this turn, for connectors that land on them. */
  external: ReadonlyMap<string, { x: number; y: number; box?: boolean }>;
}

export function layoutTurn(turn: BoardTurn, options: LayoutOptions): BoardItem[] {
  const nodes = turn.nodes;
  if (nodes.length === 0) return [];
  const boxes = nodes.map((n, i) => sizeBox(n, i));
  const byId = new Map(boxes.map((b) => [b.id, b.index]));

  const links: Link[] = [];
  const outside: TurnEdge[] = [];
  for (const edge of turn.edges) {
    const from = byId.get(edge.fromId);
    const to = byId.get(edge.toId);
    if (from === undefined || to === undefined) outside.push(edge);
    else if (from !== to) links.push({ edge, from, to, back: false });
  }
  markBackEdges(boxes.length, links);
  const rankCount = assignRanks(boxes, links);
  const connected = new Set<number>();
  for (const l of links) {
    connected.add(l.from);
    connected.add(l.to);
  }

  /* Nothing joined up: a grid, in the order the model drew them. */
  if (links.length === 0) {
    return emit(turn, boxes, links, outside, options, gridPlace(boxes));
  }

  const leftToRight = rankCount <= MAX_LR_RANKS;
  for (const b of boxes) {
    b.sf = leftToRight ? b.w : b.h;
    b.sc = leftToRight ? b.h : b.w;
  }

  /* Rows of the rank structure, in a stable starting order. */
  const rows: Box[][] = Array.from({ length: rankCount }, () => []);
  for (const b of boxes) rows[b.rank]!.push(b);

  const neighbours = (b: Box, dir: -1 | 1): Box[] => {
    const found: Box[] = [];
    for (const l of links) {
      if (l.back) continue;
      if (dir === -1 && l.to === b.index) found.push(boxes[l.from]!);
      if (dir === 1 && l.from === b.index) found.push(boxes[l.to]!);
    }
    return found;
  };

  /* Crossing reduction: order each rank by the mean position of its neighbours. */
  const position = new Map<number, number>();
  const reindex = () => rows.forEach((row) => row.forEach((b, i) => position.set(b.index, i)));
  reindex();
  for (let pass = 0; pass < 4; pass++) {
    const downward = pass % 2 === 0;
    const order = downward ? rows.map((_, i) => i) : rows.map((_, i) => rows.length - 1 - i);
    for (const r of order) {
      const row = rows[r]!;
      const key = new Map<number, number>();
      for (const b of row) {
        const ns = neighbours(b, downward ? -1 : 1);
        key.set(b.index, ns.length === 0 ? position.get(b.index)! : ns.reduce((s, n) => s + position.get(n.index)!, 0) / ns.length);
      }
      row.sort((a, b) => key.get(a.index)! - key.get(b.index)! || position.get(a.index)! - position.get(b.index)!);
      row.forEach((b, i) => position.set(b.index, i));
    }
  }

  /* Across the flow: start centred, then pull each node toward the nodes it is
     joined to without letting any two touch. */
  for (const row of rows) {
    const total = row.reduce((s, b) => s + b.sc, 0) + SIBLING_GAP * (row.length - 1);
    let at = -total / 2;
    for (const b of row) {
      b.c = at + b.sc / 2;
      at += b.sc + SIBLING_GAP;
    }
  }
  const settle = (row: Box[], dir: -1 | 1) => {
    const desired = row.map((b) => {
      const ns = neighbours(b, dir);
      return ns.length === 0 ? b.c : ns.reduce((s, n) => s + n.c, 0) / ns.length;
    });
    const sep = row.slice(1).map((b, i) => (row[i]!.sc + b.sc) / 2 + SIBLING_GAP);
    const placed = spread(desired, sep);
    row.forEach((b, i) => (b.c = placed[i]!));
  };
  for (let pass = 0; pass < 6; pass++) {
    for (let r = 1; r < rows.length; r++) settle(rows[r]!, -1);
    for (let r = rows.length - 2; r >= 0; r--) settle(rows[r]!, 1);
  }
  for (let r = 1; r < rows.length; r++) settle(rows[r]!, -1);

  /* Along the flow: one thickness per rank, one gap between ranks. */
  let f = 0;
  for (const row of rows) {
    const thick = Math.max(...row.map((b) => b.sf));
    for (const b of row) b.f = f + thick / 2;
    f += thick + rankGap(links, row, rows);
  }

  return emit(turn, boxes, links, outside, options, (b) => (leftToRight ? { x: b.f, y: b.c } : { x: b.c, y: b.f }), {
    leftToRight,
    rows,
  });
}

/** Room between a rank and the next: the gap, widened for a connector label that has to sit in it. */
function rankGap(links: Link[], row: Box[], rows: Box[][]): number {
  const here = new Set(row.map((b) => b.index));
  const next = rows[row[0]!.rank + 1];
  if (!next) return RANK_GAP;
  const nextIds = new Set(next.map((b) => b.index));
  let widest = 0;
  for (const l of links) {
    if (l.back || l.edge.label === '' || !here.has(l.from) || !nextIds.has(l.to)) continue;
    widest = Math.max(widest, measureText(l.edge.label, 11));
  }
  return Math.max(RANK_GAP, widest + 28);
}

function gridPlace(boxes: Box[]): (b: Box) => BoardPoint {
  const columns = boxes.length <= 3 ? boxes.length : boxes.length <= 4 ? 2 : 3;
  const rowH: number[] = [];
  boxes.forEach((b, i) => {
    const r = Math.floor(i / columns);
    rowH[r] = Math.max(rowH[r] ?? 0, b.h);
  });
  const rowTop: number[] = [];
  let y = 0;
  rowH.forEach((h, r) => {
    rowTop[r] = y;
    y += h + RANK_GAP / 2;
  });
  return (b) => {
    const col = b.index % columns;
    const r = Math.floor(b.index / columns);
    return { x: col * (NODE_W + SIBLING_GAP) + NODE_W / 2, y: rowTop[r]! + rowH[r]! / 2 };
  };
}

/* ============================================================== routing = */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function dedupe(points: BoardPoint[]): BoardPoint[] {
  const out: BoardPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    out.push(p);
  }
  /* Drop a point that sits on a straight run between its neighbours. */
  const trimmed: BoardPoint[] = [];
  for (const p of out) {
    while (trimmed.length >= 2) {
      const a = trimmed[trimmed.length - 2]!;
      const b = trimmed[trimmed.length - 1]!;
      const collinear = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - p.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - p.y) < 0.5);
      if (!collinear) break;
      trimmed.pop();
    }
    trimmed.push(p);
  }
  return trimmed;
}

function emit(
  turn: BoardTurn,
  boxes: Box[],
  links: Link[],
  outside: TurnEdge[],
  options: LayoutOptions,
  place: (b: Box) => BoardPoint,
  flow?: { leftToRight: boolean; rows: Box[][] },
): BoardItem[] {
  /* Geometry in board space, relative to the drawing's own top-left. */
  const rect = new Map<number, Rect>();
  for (const b of boxes) {
    const c = place(b);
    rect.set(b.index, { x: c.x - b.w / 2, y: c.y - b.h / 2, w: b.w, h: b.h });
  }

  type Route = { edge: TurnEdge; points: BoardPoint[]; labelLeft?: boolean };
  /* Connectors between the same two boxes would draw on top of one another:
     fan them out, a few units apart. */
  const pairTotal = new Map<string, number>();
  const pairSeen = new Map<string, number>();
  for (const l of links) {
    if (!l.back) pairTotal.set(`${l.from}>${l.to}`, (pairTotal.get(`${l.from}>${l.to}`) ?? 0) + 1);
  }
  const routes: Route[] = [];
  const toXY = (p: P): BoardPoint => (flow && !flow.leftToRight ? { x: p.c, y: p.f } : { x: p.f, y: p.c });

  if (flow) {
    const { leftToRight, rows } = flow;
    const rowOf = (rank: number) => rows[rank]!;
    const faceStart = (b: Box): number => b.f - b.sf / 2;
    const faceEnd = (b: Box): number => b.f + b.sf / 2;
    const rankStart = (rank: number): number => Math.min(...rowOf(rank).map(faceStart));
    const rankEnd = (rank: number): number => Math.max(...rowOf(rank).map(faceEnd));
    const gapMid = (afterRank: number): number => (rankEnd(afterRank) + rankStart(afterRank + 1)) / 2;
    const sideCount = { low: 0, high: 0 };

    for (const l of links) {
      const a = boxes[l.from]!;
      const b = boxes[l.to]!;
      if (!l.back) {
        const pts: P[] = [{ f: faceEnd(a), c: a.c }];
        const m1 = gapMid(a.rank);
        const m2 = gapMid(b.rank - 1);
        let lane = a.c;
        if (b.rank - a.rank > 1) {
          /* A connector that skips ranks must not run through the boxes it skips. */
          const blockers: Box[] = [];
          for (let r = a.rank + 1; r < b.rank; r++) blockers.push(...rowOf(r));
          const free = (x: number) => blockers.every((k) => x < k.c - k.sc / 2 - 14 || x > k.c + k.sc / 2 + 14);
          const candidates = [a.c, b.c, ...blockers.flatMap((k) => [k.c - k.sc / 2 - 24, k.c + k.sc / 2 + 24])];
          const best = candidates.filter(free).sort((x, y) => Math.abs(x - a.c) + Math.abs(x - b.c) - (Math.abs(y - a.c) + Math.abs(y - b.c)) || x - y)[0];
          lane = best ?? a.c;
        } else {
          lane = a.c;
        }
        pts.push({ f: m1, c: a.c });
        if (lane !== a.c) pts.push({ f: m1, c: lane });
        if (lane !== a.c || m2 !== m1) pts.push({ f: m2, c: lane });
        pts.push({ f: m2, c: b.c }, { f: faceStart(b), c: b.c });
        const key = `${l.from}>${l.to}`;
        const k = pairSeen.get(key) ?? 0;
        pairSeen.set(key, k + 1);
        const shift = (k - ((pairTotal.get(key) ?? 1) - 1) / 2) * 16;
        const fanned = shift === 0 ? pts : pts.map((q, i) => ({ f: i === 0 || i === pts.length - 1 ? q.f : q.f + shift, c: q.c + shift }));
        routes.push({ edge: l.edge, points: dedupe(fanned.map(toXY)) });
        continue;
      }

      /* A way back: round the outside of every node between the two ends. */
      const span: Box[] = [];
      for (let r = b.rank; r <= a.rank; r++) span.push(...rowOf(r));
      const low = Math.min(...span.map((k) => k.c - k.sc / 2));
      const high = Math.max(...span.map((k) => k.c + k.sc / 2));
      const blocked = (end: Box, toward: -1 | 1) =>
        rowOf(end.rank).filter((k) => (toward === -1 ? k.c < end.c : k.c > end.c)).length;
      const cost = (toward: -1 | 1) =>
        blocked(a, toward) + blocked(b, toward) + (toward === -1 ? Math.abs(a.c - low) + Math.abs(b.c - low) : Math.abs(high - a.c) + Math.abs(high - b.c)) / 1000;
      const toward: -1 | 1 = cost(-1) <= cost(1) ? -1 : 1;
      const k = toward === -1 ? sideCount.low++ : sideCount.high++;
      const laneC = toward === -1 ? low - LANE_FIRST - k * LANE_STEP : high + LANE_FIRST + k * LANE_STEP;
      const out = (box: Box): number => box.c + toward * (box.sc / 2);
      void leftToRight;
      routes.push({
        edge: l.edge,
        labelLeft: toward === -1,
        points: dedupe(
          [
            { f: a.f, c: out(a) },
            { f: a.f, c: laneC },
            { f: b.f, c: laneC },
            { f: b.f, c: out(b) },
          ].map(toXY),
        ),
      });
    }
  }

  /* A connector to something that is on the board but not in this turn: straight,
     and it starts and ends ON the edge of a box, never at its middle or at the
     baseline of its label. A box from an earlier turn is known only by its label's
     position, so its outline is rebuilt from that (one box width, the minimum
     height: the top and the sides are right whatever its real height). */
  const outline = (id: string, sx: number, sy: number): { rect: Rect | null; centre: BoardPoint } | null => {
    const i = boxes.find((b) => b.id === id)?.index;
    if (i !== undefined) {
      const t = rect.get(i)!;
      const r = { x: t.x + sx, y: t.y + sy, w: t.w, h: t.h };
      return { rect: r, centre: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
    }
    const ext = options.external.get(id);
    if (!ext) return null;
    if (!ext.box) return { rect: null, centre: { x: ext.x, y: ext.y } };
    const r = { x: ext.x - BOX_PAD_X, y: ext.y - BOX_PAD_Y - BOX_EM, w: NODE_W, h: NODE_MIN_H };
    return { rect: r, centre: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
  };
  const clip = (r: Rect | null, from: BoardPoint, toward: BoardPoint): BoardPoint => {
    if (!r) return from;
    const dxx = toward.x - from.x;
    const dyy = toward.y - from.y;
    const tx = dxx === 0 ? Infinity : (dxx > 0 ? r.x + r.w - from.x : r.x - from.x) / dxx;
    const ty = dyy === 0 ? Infinity : (dyy > 0 ? r.y + r.h - from.y : r.y - from.y) / dyy;
    const t = Math.min(tx, ty);
    return Number.isFinite(t) ? { x: from.x + dxx * t, y: from.y + dyy * t } : from;
  };
  /* Built once the slide is known: an earlier turn's box is already in board
     space, so it must not be slid along with this turn's own layout. */
  const outsideRoutes = (sx: number, sy: number): Route[] => {
    const out: Route[] = [];
    for (const edge of outside) {
      const a = outline(edge.fromId, sx, sy);
      const b = outline(edge.toId, sx, sy);
      if (a && b) out.push({ edge, points: [clip(a.rect, a.centre, b.centre), clip(b.rect, b.centre, a.centre)] });
    }
    return out;
  };

  /* Frames: a rectangle round the boxes the model had put inside it. */
  const frameRects: { frame: TurnFrame; rect: Rect }[] = [];
  /* A frame with nothing of this turn's inside it stays exactly where it was asked for. */
  const unplaced: TurnFrame[] = [];
  for (const frame of turn.frames) {
    const x0 = Math.min(frame.from.x, frame.to.x) - 40;
    const x1 = Math.max(frame.from.x, frame.to.x) + 40;
    const y0 = Math.min(frame.from.y, frame.to.y) - 40;
    const y1 = Math.max(frame.from.y, frame.to.y) + 40;
    const members = turn.nodes.filter((n) => n.asked && n.asked.x >= x0 && n.asked.x <= x1 && n.asked.y >= y0 && n.asked.y <= y1);
    const rs = members.map((n) => rect.get(boxes.find((b) => b.id === n.id)!.index)!);
    if (rs.length === 0) {
      unplaced.push(frame);
      continue;
    }
    const left = Math.min(...rs.map((r) => r.x)) - FRAME_PAD;
    const top = Math.min(...rs.map((r) => r.y)) - FRAME_PAD - FRAME_HEAD;
    const right = Math.max(...rs.map((r) => r.x + r.w)) + FRAME_PAD;
    const bottom = Math.max(...rs.map((r) => r.y + r.h)) + FRAME_PAD;
    frameRects.push({ frame, rect: { x: left, y: top, w: right - left, h: bottom - top } });
  }

  /* Everything is now positioned relative to an arbitrary origin; slide the whole
     drawing so its top-left is the requested one. */
  let minX = Infinity;
  let minY = Infinity;
  const see = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
  };
  for (const r of rect.values()) see(r.x, r.y);
  for (const r of routes) for (const p of r.points) see(p.x, p.y);
  for (const f of frameRects) see(f.rect.x, f.rect.y);
  /* Where each connector's label sits (before the slide), so the slide leaves room for it. */
  const labelFor = (route: Route): BoardPoint | null => {
    if (route.edge.label === '' || route.points.length < 2) return null;
    const pts = route.points;
    let best = 0;
    let bestLen = -1;
    for (let i = 0; i + 1 < pts.length; i++) {
      const len = Math.abs(pts[i + 1]!.x - pts[i]!.x) + Math.abs(pts[i + 1]!.y - pts[i]!.y);
      if (len > bestLen) {
        bestLen = len;
        best = i;
      }
    }
    const a = pts[best]!;
    const b = pts[best + 1]!;
    const width = measureText(route.edge.label, LABEL_EM);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    return Math.abs(a.x - b.x) < 1
      ? { x: route.labelLeft ? mx - 8 - width : mx + 8, y: my + 4 }
      : { x: mx - width / 2, y: my - 7 };
  };
  const labelAt = new Map<string, BoardPoint>();
  for (const route of routes) {
    const at = labelFor(route);
    if (!at) continue;
    labelAt.set(route.edge.id, at);
    see(at.x, at.y - LABEL_EM);
  }
  const dx = options.origin.x - minX;
  const dy = options.origin.y - minY;
  const r1 = (n: number) => Math.round(n);

  const items: BoardItem[] = [];

  for (const { frame, rect: fr } of frameRects) {
    const shape: BoardShapeItem = {
      kind: 'shape',
      id: frame.id,
      shape: 'rect',
      from: { x: r1(fr.x + dx), y: r1(fr.y + dy) },
      to: { x: r1(fr.x + fr.w + dx), y: r1(fr.y + fr.h + dy) },
    };
    const caption: BoardTextItem = {
      kind: 'text',
      id: `${frame.id}${NODE_LABEL_SUFFIX}`,
      at: { x: r1(fr.x + dx + 8), y: r1(fr.y + dy + 17) },
      text: frame.label,
    };
    items.push(shape, caption);
  }

  for (const frame of unplaced) {
    items.push(
      { kind: 'shape', id: frame.id, shape: 'rect', from: frame.from, to: frame.to },
      {
        kind: 'text',
        id: `${frame.id}${NODE_LABEL_SUFFIX}`,
        at: { x: Math.min(frame.from.x, frame.to.x) + 4, y: Math.min(frame.from.y, frame.to.y) - 4 },
        text: frame.label,
      },
    );
  }

  /* Boxes under connectors under labels, so an arrow never hides a word. */
  for (const b of boxes) {
    const r = rect.get(b.index)!;
    const node = turn.nodes[b.index]!;
    const box: BoardShapeItem = {
      kind: 'shape',
      id: `${b.id}${BOX_ID_SUFFIX}`,
      shape: 'rect',
      from: { x: r1(r.x + dx), y: r1(r.y + dy) },
      to: { x: r1(r.x + r.w + dx), y: r1(r.y + r.h + dy) },
    };
    items.push(box);
  }

  const absolute = outsideRoutes(dx, dy);
  for (const route of absolute) {
    const at = labelFor(route);
    if (at) labelAt.set(route.edge.id, { x: at.x - dx, y: at.y - dy });
  }
  for (const route of [...routes, ...absolute]) {
    const slide = absolute.includes(route) ? { x: 0, y: 0 } : { x: dx, y: dy };
    const pts = route.points.map((p) => ({ x: r1(p.x + slide.x), y: r1(p.y + slide.y) }));
    for (let i = 0; i + 1 < pts.length; i++) {
      const last = i + 2 === pts.length;
      items.push({
        kind: 'shape',
        id: i === 0 ? route.edge.id : `${route.edge.id}${SEGMENT_ID_SEP}${i}`,
        shape: last && route.edge.directed ? 'arrow' : 'line',
        from: pts[i]!,
        to: pts[i + 1]!,
      });
    }
    const labelPoint = labelAt.get(route.edge.id);
    if (labelPoint) {
      items.push({
        kind: 'text',
        id: `${route.edge.id}${NODE_LABEL_SUFFIX}`,
        at: { x: r1(labelPoint.x + dx), y: r1(labelPoint.y + dy) },
        text: route.edge.label,
      });
    }
  }

  for (const b of boxes) {
    const r = rect.get(b.index)!;
    const node = turn.nodes[b.index]!;
    const at = { x: r1(r.x + dx + BOX_PAD_X), y: r1(r.y + dy + BOX_PAD_Y + BOX_EM) };
    if (node.kind === 'card') {
      const card: BoardNodeRefItem = { kind: 'noderef', id: b.id, at, nodeId: node.nodeId ?? '', label: node.text };
      items.push(card);
    } else {
      items.push({ kind: 'text', id: b.id, at, text: b.lines.join('\n') });
    }
  }

  return items;
}
