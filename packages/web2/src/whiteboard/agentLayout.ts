import { arrowEnds, itemBox, type Box } from '../canvas/boards/boardsModel';
import {
  STICKY_H,
  STICKY_W,
  WB_BOX_LINE,
  composeBoxes,
  measureLine,
  wrapLabel,
  type Point,
  type WbBoxLabel,
  type WbItem,
  type WbShape,
  type WbText,
} from './whiteboardModel';

/* ══════════════════════════════════════════════════════════════════════════
   WHAT AN AGENT'S DRAWING LOOKS LIKE WHEN IT LANDS
   packages/web2/src/whiteboard/agentLayout.ts

   0.1.5, from the owner's screenshot of an inline agent diagram: the text of a
   box printed over its neighbour, a box cut off at the right edge, arrow labels
   sitting on box borders, one long note run out as a single tiny line.

   The agent places marks by coordinates and cannot see them. Anything it gets
   wrong in size is put right HERE, at display time, from the marks themselves
   (the stored document is never rewritten):

     1. a box grows to hold its words (composeBoxes); a box that grew pushes
        the boxes it now overlaps down, and the connectors touching them follow;
     2. a free note that would sit on a box is moved clear below it, and a long
        one is wrapped to a readable measure instead of running as one line;
     3. a short word beside a connector is that connector's LABEL: it is taken
        off the line and placed beside it, clear of every box, on a backing, and
        lifted over the boxes when the gap between them is narrower than it;
     4. a sticky note is as tall as its words need.

   PURE. Items in, items out. Measurements are the same conservative advance
   table Fit and the analyzer's own layout use, so what is decided here is
   what the renderer paints.
   ══════════════════════════════════════════════════════════════════════════ */

/** The widest a free note runs before it wraps, in board units. */
export const WB_NOTE_MAX_W = 260;
/** Clear space kept between a pushed box and the one above it. */
export const WB_BOX_GAP = 16;
/** A connector label: font size, height, and padding round its words. */
export const WB_EDGE_EM = 12;
export const WB_EDGE_H = 20;
export const WB_EDGE_PAD = 6;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where one connector's label is drawn: its centre, its backing rectangle's size. */
export interface EdgeLabelPlace {
  text: string;
  /** Centre of the backing rectangle. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AgentLayout {
  items: WbItem[];
  /** The words inside each box (composeBoxes). */
  labels: Map<string, WbBoxLabel>;
  /** Connector id to where its label goes. */
  edgeLabels: Map<string, EdgeLabelPlace>;
  /** Display lines for a free note that was wrapped (id to lines). */
  noteLines: Map<string, string[]>;
}

const isBox = (it: WbItem): it is WbShape => it.kind === 'shape' && (it.shape === 'rect' || it.shape === 'ellipse');
const isLine = (it: WbItem): it is WbShape => it.kind === 'shape' && (it.shape === 'arrow' || it.shape === 'line');

export function rectOf(shape: WbShape): Rect {
  const x = Math.min(shape.from.x, shape.to.x);
  const y = Math.min(shape.from.y, shape.to.y);
  return { x, y, w: Math.abs(shape.to.x - shape.from.x), h: Math.abs(shape.to.y - shape.from.y) };
}

const hits = (a: Rect, b: Rect, pad = 0): boolean =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

function moveShape(shape: WbShape, dy: number): WbShape {
  return { ...shape, from: { x: shape.from.x, y: shape.from.y + dy }, to: { x: shape.to.x, y: shape.to.y + dy } };
}

/** Distance from a point to a segment. */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** A free note's lines and its footprint (the text's `at` is its first baseline). */
function noteFootprint(at: Point, lines: readonly string[], em: number): Rect {
  const w = lines.reduce((m, l) => Math.max(m, measureLine(l, em)), 0);
  return { x: at.x, y: at.y - em, w, h: em + (lines.length - 1) * WB_BOX_LINE + em * 0.4 };
}

/** The height a sticky needs for its words at its own width (12px text, 1.4 line height, 8/12 padding). */
export function stickyHeight(item: WbText): number {
  const w = item.w ?? STICKY_W;
  const lines = wrapLabel(item.text, Math.max(40, w - 24), 12);
  const head = item.by === 'agent' ? 16 + 4 : 0;
  const need = 16 + head + lines.length * 17;
  return Math.max(item.h ?? STICKY_H, need);
}

/**
 * Whose mark it is, from an explicit marker only: `by: 'agent'` (the agent's wire sets it, boardWireToWbItem, and the
 * board keeps it through a reload) or an id this turn's agent items carry. Never guessed from the shape of an id: a
 * person's mark with an older or pasted id must not be pushed or relabelled by the agent's rules.
 */
export function isAgentMark(item: WbItem, agentIds?: ReadonlySet<string>): boolean {
  if (item.by === 'person') return false;
  return item.by === 'agent' || agentIds?.has(item.id) === true;
}

export function layoutAgentBoard(source: readonly WbItem[], agentIds?: ReadonlySet<string>): AgentLayout {
  const agent = (it: WbItem) => isAgentMark(it, agentIds);
  const composed = composeBoxes(source, agent);
  let items = composed.items.slice();
  const labels = composed.labels;

  /* ── 1. Boxes that grew push the boxes they now overlap down. ───────────── */
  const moved = new Map<string, number>();
  const originalBox = new Map<string, Rect>();
  for (const it of source) if (isBox(it)) originalBox.set(it.id, rectOf(it));
  const growers = new Set<string>();
  for (const it of items) {
    if (!isBox(it)) continue;
    const was = originalBox.get(it.id);
    if (was && rectOf(it).h > was.h + 0.5) growers.add(it.id);
  }
  if (growers.size > 0) {
    for (let pass = 0; pass < 8; pass += 1) {
      let changed = false;
      const order = items.filter(isBox).sort((a, b) => rectOf(a).y - rectOf(b).y || rectOf(a).x - rectOf(b).x).map((it) => it.id);
      /* Each pair reads the boxes as they are NOW: a box two growers push is moved from where the first push left it. */
      const now = (id: string) => items.find((it) => it.id === id) as WbShape;
      for (const aId of order) {
        for (const bId of order) {
          if (aId === bId) continue;
          const a = now(aId);
          const b = now(bId);
          if (!agent(b)) continue;
          const ra = rectOf(a);
          const rb = rectOf(b);
          const sideBySide = rb.x >= ra.x + ra.w - 1 || rb.x + rb.w <= ra.x + 1;
          if (sideBySide || rb.y < ra.y - 1) continue;
          const need = ra.y + ra.h + WB_BOX_GAP;
          if (rb.y >= need - 0.5) continue;
          /* Only a box that GREW (or one already pushed by one) displaces another. */
          if (!growers.has(a.id) && !moved.has(a.id)) continue;
          const dy = need - rb.y;
          /* What the box moved in all, from where it started (connectors follow this, not a sum of pushes). */
          moved.set(b.id, rb.y + dy - originalBox.get(b.id)!.y);
          items = items.map((it) => (it.id === b.id ? moveShape(b, dy) : it));
          changed = true;
        }
      }
      if (!changed) break;
    }
    /* Connectors that touched a pushed box follow it. */
    if (moved.size > 0) {
      items = items.map((it) => {
        if (!isLine(it)) return it;
        let shape = it;
        for (const end of ['from', 'to'] as const) {
          for (const [id, dy] of moved) {
            const old = originalBox.get(id);
            if (!old) continue;
            const p = shape[end];
            if (p.x >= old.x - 8 && p.x <= old.x + old.w + 8 && p.y >= old.y - 8 && p.y <= old.y + old.h + 8) {
              shape = { ...shape, [end]: { x: p.x, y: p.y + dy } };
              break;
            }
          }
        }
        return shape;
      });
    }
  }

  /* Bound connectors aim at where their (grown, pushed) targets are now. */
  const footprint = new Map<string, Box>();
  for (const it of items) {
    if (isLine(it)) continue;
    const b = itemBox(it);
    if (b) footprint.set(it.id, b);
  }
  items = items.map((it) => (isLine(it) && (it.fromId || it.toId) ? { ...it, ...arrowEnds(it, (id) => footprint.get(id)) } : it));

  const boxes = () => items.filter(isBox).map(rectOf);

  /* ── 2. A short free word beside a connector is that connector's label. ─── */
  const edgeLabels = new Map<string, EdgeLabelPlace>();
  const lines = items.filter(isLine);
  const claimed = new Map<string, string>();
  for (const it of items) {
    if (it.kind !== 'text' || it.sticky || !agent(it)) continue;
    const text = it.text.trim();
    if (text === '' || text.includes('\n') || text.length > 40) continue;
    const width = measureLine(text, WB_EDGE_EM);
    const mid = { x: it.at.x + width / 2, y: it.at.y - 4 };
    if (boxes().some((b) => mid.x >= b.x && mid.x <= b.x + b.w && it.at.y >= b.y - 2 && it.at.y <= b.y + b.h + 4)) continue;
    let best: WbShape | null = null;
    let bestD = 22;
    for (const l of lines) {
      if (claimed.has(l.id)) continue;
      const d = distToSegment(mid, l.from, l.to);
      if (d < bestD) {
        best = l;
        bestD = d;
      }
    }
    if (best) claimed.set(best.id, it.id);
  }
  const consumedTexts = new Set(claimed.values());
  items = items.filter((it) => !consumedTexts.has(it.id));
  const textOf = (id: string) => {
    const t = source.find((s) => s.id === id);
    return t && t.kind === 'text' ? t.text.trim() : '';
  };
  const labelled: { shape: WbShape; text: string }[] = [];
  for (const l of items.filter(isLine)) {
    const own = claimed.has(l.id) ? textOf(claimed.get(l.id)!) : (l.label ?? '').trim();
    if (own !== '') labelled.push({ shape: l, text: own });
  }
  const taken: Rect[] = [];
  for (const { shape, text } of labelled) {
    const w = Math.ceil(measureLine(text, WB_EDGE_EM)) + 2 * WB_EDGE_PAD;
    const h = WB_EDGE_H;
    const dx = shape.to.x - shape.from.x;
    const dy = shape.to.y - shape.from.y;
    const len = Math.hypot(dx, dy) || 1;
    /* The normal, pointing up when the line is not vertical. */
    let nx = -dy / len;
    let ny = dx / len;
    if (ny > 0 || (ny === 0 && nx < 0)) {
      nx = -nx;
      ny = -ny;
    }
    const clear = (r: Rect) => !boxes().some((b) => hits(r, b, 2)) && !taken.some((t) => hits(r, t, 2));
    let chosen: Rect | null = null;
    const along = [0.5, 0.35, 0.65];
    search: for (let k = 0; k < 10; k += 1) {
      const off = k === 0 ? 0 : h / 2 + 4 + (k - 1) * (h + 2);
      for (const sign of k === 0 ? [1] : [1, -1]) {
        for (const t of along) {
          const cx = shape.from.x + dx * t + nx * off * sign;
          const cy = shape.from.y + dy * t + ny * off * sign;
          const r = { x: cx - w / 2, y: cy - h / 2, w, h };
          if (clear(r)) {
            chosen = r;
            break search;
          }
        }
      }
    }
    if (!chosen) {
      const cx = shape.from.x + dx / 2 + nx * (h / 2 + 4);
      const cy = shape.from.y + dy / 2 + ny * (h / 2 + 4);
      chosen = { x: cx - w / 2, y: cy - h / 2, w, h };
    }
    taken.push(chosen);
    edgeLabels.set(shape.id, { text, x: chosen.x + w / 2, y: chosen.y + h / 2, w, h });
  }

  /* ── 3. Free notes: wrapped to a readable measure, and kept off the boxes. ─ */
  const noteLines = new Map<string, string[]>();
  items = items.map((it) => {
    if (it.kind === 'text' && it.sticky) {
      const h = stickyHeight(it);
      return h > (it.h ?? STICKY_H) ? { ...it, h } : it;
    }
    return it;
  });
  const stickRect = (it: WbText): Rect => ({ x: it.at.x, y: it.at.y, w: it.w ?? STICKY_W, h: it.h ?? STICKY_H });
  items = items.map((it) => {
    if (it.kind !== 'text' || !agent(it)) return it;
    let at = it.at;
    let foot: Rect;
    if (it.sticky) {
      foot = stickRect(it);
    } else {
      const wrapped = it.text.split('\n').flatMap((p) => wrapLabel(p, WB_NOTE_MAX_W, 13));
      if (wrapped.length > it.text.split('\n').length) noteLines.set(it.id, wrapped);
      foot = noteFootprint(at, wrapped, 13);
    }
    for (let guard = 0; guard < 12; guard += 1) {
      const over = boxes().filter((b) => hits(foot, b, 2));
      if (over.length === 0) break;
      const bottom = Math.max(...over.map((b) => b.y + b.h));
      const dy = bottom + 14 - foot.y;
      at = { x: at.x, y: at.y + dy };
      foot = { ...foot, y: foot.y + dy };
    }
    return at === it.at ? it : { ...it, at };
  });
  /* The wrapped note is stored as the display text, so bounds and the painter agree. */
  return { items, labels, edgeLabels, noteLines };
}

/**
 * The document Fit and the clip check measure: what is PAINTED, not what is stored. Wrapped notes carry their wrapped
 * lines and every connector label is a text mark at its placed spot, so a drawing is framed by what the reader sees.
 */
export function paintedDoc(layout: AgentLayout): { version: 1; items: WbItem[] } {
  const items: WbItem[] = layout.items.map((it) => {
    const lines = it.kind === 'text' && !it.sticky ? layout.noteLines.get(it.id) : undefined;
    return lines ? { ...it, text: lines.join('\n') } : it;
  });
  for (const [id, e] of layout.edgeLabels) {
    items.push({ kind: 'text', id: `edge-label:${id}`, at: { x: e.x - e.w / 2, y: e.y + 4 }, text: e.text });
  }
  return { version: 1, items };
}

/** The rectangle of everything the layout paints, labels included: what Fit and the clip check read. */
export function layoutBounds(layout: AgentLayout): Rect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const take = (r: Rect) => {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  };
  for (const it of layout.items) {
    if (it.kind === 'shape') take(rectOf(it));
    else if (it.kind === 'text' && it.sticky) take({ x: it.at.x, y: it.at.y, w: it.w ?? STICKY_W, h: it.h ?? STICKY_H });
    else if (it.kind === 'text') take(noteFootprint(it.at, layout.noteLines.get(it.id) ?? it.text.split('\n'), 13));
    else if (it.kind === 'stroke') for (const p of it.points) take({ x: p.x, y: p.y, w: 0, h: 0 });
    else if (it.kind === 'artifact') take({ x: it.at.x, y: it.at.y, w: it.size.w, h: it.size.h });
    else take({ x: it.at.x, y: it.at.y - 11, w: measureLine(it.label, 11) * 1.1, h: 22 });
  }
  for (const e of layout.edgeLabels.values()) take({ x: e.x - e.w / 2, y: e.y - e.h / 2, w: e.w, h: e.h });
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
