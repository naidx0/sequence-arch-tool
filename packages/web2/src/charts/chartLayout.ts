/* ══════════════════════════════════════════════════════════════════════════
   SEQ-CHART — THE PURE LAYOUT LAYER
   packages/web2/src/charts/chartLayout.ts

   Every number a chart draws is computed HERE, from the spec alone, with no
   clock, no randomness, no measurement of the DOM and no iteration count that
   depends on the machine. That is not tidiness — it is the third reason
   packages/schema/src/chart.ts gives for the whole contract existing:

     "DETERMINISM. Same spec renders the same pixels: diffable, cacheable,
      replayable inside a lesson, screenshot-testable in the legibility gate."

   A layout that consulted getBBox(), a font metric or a container width would
   give a different picture in jsdom, in Chromium and in the export renderer,
   and the screenshot test would then be asserting against whichever one it
   happened to run in. So text is measured by an ESTIMATE that is a pure
   function of the string, and the estimate is deliberately conservative: it is
   better to truncate a label one character early everywhere than to overflow a
   box in one engine only.

   NOTHING IN THIS FILE DECLARES A COLOUR OR A TYPE SIZE. It computes geometry
   and hands back class names; the paint is in charts.css, against the tokens
   in tokens/graphite.css. Geometry is the one thing SVG cannot read from a
   custom property, so geometry is what lives in TypeScript.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChartItem, ChartLink } from '@sequence/schema';

/**
 * Estimated advance width of one character.
 *
 * Instrument Sans at the 12px working size averages a shade under 6.4px per
 * character across mixed-case prose. This is used ONLY to decide where to
 * truncate, never to position anything, so an error of a few percent moves a
 * hyphen and nothing else.
 */
export const CH = 6.4;

/** Frame padding inside the SVG viewport. Mirrors --sp-16. */
export const PAD = 16;
/** The default drawn box. Half a board card wide, so a chart beside the board
 *  does not read as a second board. */
export const NODE_W = 152;
export const NODE_H = 46;
export const GAP_X = 64;
export const GAP_Y = 18;

/** Row height for list-shaped families (comparison columns, cards). */
export const ROW_H = 34;

export type Orientation = 'horizontal' | 'vertical';

/** Truncate to what actually fits `widthPx`, with the ellipsis inside the box. */
export function fitText(text: string, widthPx: number): string {
  const max = Math.max(3, Math.floor((widthPx - 14) / CH));
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

/** Semantic tone → the class charts.css resolves to a token. Never decoration. */
export function toneClass(tone?: ChartItem['tone']): string {
  return `t-${tone ?? 'neutral'}`;
}

/**
 * The attribute bundle every drawn item carries.
 *
 * `data-dim` is the spotlight, and it is an ATTRIBUTE rather than a computed
 * opacity for the reason docs/brand/graphite/pages/06-selection-focus-and-dimming.html
 * gives: dimming is a state of the document, so it has to be readable as one —
 * by CSS, by a test, and by the export renderer — not inferred from a paint.
 */
export interface ItemAttrs {
  className: string;
  'data-item': string;
  'data-dim': string;
  'data-focused': string;
  'data-node-id'?: string;
}

export function itemAttrs(item: ChartItem, focusItemId?: string): ItemAttrs {
  const attrs: ItemAttrs = {
    className: `ci ${toneClass(item.tone)}`,
    'data-item': item.id,
    'data-dim': String(focusItemId !== undefined && focusItemId !== item.id),
    'data-focused': String(focusItemId === item.id),
  };
  /* The grounding hook, carried into the DOM so a chart can be cross-highlighted
     against the board without re-deriving which item stood for which node. */
  if (item.nodeId) attrs['data-node-id'] = item.nodeId;
  return attrs;
}

/* ────────────────────────────────────────────────────────── layered sweep ── */

export interface LaidNode {
  item: ChartItem;
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidEdge {
  link: ChartLink;
  from: LaidNode;
  to: LaidNode;
  /** True when the edge runs against the layering — a cycle's closing edge. */
  back: boolean;
}

export interface Placement {
  nodes: LaidNode[];
  byId: Map<string, LaidNode>;
  width: number;
  height: number;
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Longest-path layering — cycles broken first — then four barycentre sweeps.
 *
 * THE CYCLE IS BROKEN, NOT RELAXED, AND THIS IS THE FIX FOR A REAL DEFECT. The
 * first cut relaxed over EVERY edge `items.length` times, and on a cycle a→b→c→a
 * each pass raised somebody by one: after n passes a three-node loop reached
 * depth six-to-nine, the layer array grew to match, and the chart painted
 * several empty columns wide. "No depth can exceed the item count" was true and
 * useless — the item count is already too many columns for a triangle.
 *
 * So the feedback edges are found once by a DFS in item order (an edge to a node
 * currently on the recursion stack is a back edge) and REMOVED from the set the
 * layering sees. What is left is a DAG, longest-path on a DAG is bounded by
 * n − 1 with no interior gaps, and the removed edge still draws as a back edge
 * because `laidEdges` reads `to.layer <= from.layer` off the placement — the
 * reader still sees the loop close. The DFS order is the spec's item order, so
 * which edge is chosen as the one that closes the loop is deterministic.
 *
 * The sweep is a FIXED four passes with a stable tiebreak on the original
 * index. An "until it stops improving" loop would be one more thing that can
 * differ between two runs; four passes is enough to unpick the crossings a
 * teaching chart of at most forty items produces, and it is the same four every
 * time.
 */
export function assignLayers(
  items: readonly ChartItem[],
  links: readonly ChartLink[] = [],
): ChartItem[][] {
  const known = new Set(items.map((it) => it.id));
  const edges = links.filter((l) => known.has(l.from) && known.has(l.to) && l.from !== l.to);

  /* Feedback-arc set by DFS: an edge whose target is on the current recursion
     stack points back at an ancestor and would create a cycle in the layering.
     Removing exactly those leaves a DAG. Adjacency is walked in spec order so
     the choice of which edge closes a given loop never changes between runs. */
  const succOf = new Map<string, string[]>();
  for (const e of edges) push(succOf, e.from, e.to);
  const back = new Set<string>();
  const seen = new Set<string>();
  const onStack = new Set<string>();
  const key = (from: string, to: string): string => `${from}\u0000${to}`;
  const classify = (id: string): void => {
    seen.add(id);
    onStack.add(id);
    for (const to of succOf.get(id) ?? []) {
      if (onStack.has(to)) back.add(key(id, to));
      else if (!seen.has(to)) classify(to);
    }
    onStack.delete(id);
  };
  for (const it of items) if (!seen.has(it.id)) classify(it.id);
  const forward = edges.filter((e) => !back.has(key(e.from, e.to)));

  /* Longest path over the DAG. On a DAG this converges within n − 1 relaxations
     and no node can exceed depth n − 1, so the layer count is bounded and every
     layer between the ends is populated. */
  const depth = new Map<string, number>();
  for (const it of items) depth.set(it.id, 0);
  for (let pass = 0; pass < items.length; pass += 1) {
    let moved = false;
    for (const e of forward) {
      const want = (depth.get(e.from) as number) + 1;
      if ((depth.get(e.to) as number) < want) {
        depth.set(e.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }

  let deepest = 0;
  for (const it of items) deepest = Math.max(deepest, depth.get(it.id) as number);
  const layers: ChartItem[][] = Array.from({ length: deepest + 1 }, () => []);
  for (const it of items) layers[depth.get(it.id) as number].push(it);

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of edges) {
    push(preds, e.to, e.from);
    push(succs, e.from, e.to);
  }

  const order = new Map<string, number>();
  const reindex = () => {
    for (const layer of layers) layer.forEach((it, i) => order.set(it.id, i));
  };
  reindex();

  for (let sweep = 0; sweep < 4; sweep += 1) {
    const forward = sweep % 2 === 0;
    const neighbours = forward ? preds : succs;
    const indices = layers.map((_, i) => (forward ? i : layers.length - 1 - i));
    for (const k of indices) {
      const home = new Map(layers[k].map((it, i) => [it.id, i]));
      const bary = (id: string): number => {
        const near = neighbours.get(id);
        if (!near || near.length === 0) return home.get(id) as number;
        let total = 0;
        for (const n of near) total += order.get(n) ?? 0;
        return total / near.length;
      };
      layers[k] = [...layers[k]].sort((a, b) => {
        const diff = bary(a.id) - bary(b.id);
        if (diff !== 0) return diff;
        return (home.get(a.id) as number) - (home.get(b.id) as number);
      });
      reindex();
    }
  }

  return layers;
}

export interface PlaceOptions {
  orientation?: Orientation;
  nodeW?: number;
  nodeH?: number;
  gapX?: number;
  gapY?: number;
  /** Extra room reserved at the top — a lane header strip, an axis caption. */
  padTop?: number;
  padLeft?: number;
}

/** Turn ordered layers into boxes. Layers are centred against the tallest. */
export function placeLayered(layers: ChartItem[][], opts: PlaceOptions = {}): Placement {
  const orientation = opts.orientation ?? 'horizontal';
  const w = opts.nodeW ?? NODE_W;
  const h = opts.nodeH ?? NODE_H;
  const gx = opts.gapX ?? GAP_X;
  const gy = opts.gapY ?? GAP_Y;
  const padTop = opts.padTop ?? PAD;
  const padLeft = opts.padLeft ?? PAD;

  const nodes: LaidNode[] = [];
  const byId = new Map<string, LaidNode>();

  /* The cross-axis extent of the fullest layer; every other layer is centred
     inside it, which is what makes a two-node layer read as a pair rather than
     as two orphans hugging the top edge. */
  let widest = 0;
  for (const layer of layers) {
    const span =
      orientation === 'horizontal'
        ? layer.length * h + Math.max(0, layer.length - 1) * gy
        : layer.length * w + Math.max(0, layer.length - 1) * gx;
    widest = Math.max(widest, span);
  }

  layers.forEach((layer, k) => {
    const span =
      orientation === 'horizontal'
        ? layer.length * h + Math.max(0, layer.length - 1) * gy
        : layer.length * w + Math.max(0, layer.length - 1) * gx;
    const offset = (widest - span) / 2;
    layer.forEach((item, i) => {
      const node: LaidNode =
        orientation === 'horizontal'
          ? {
              item,
              layer: k,
              x: padLeft + k * (w + gx),
              y: padTop + offset + i * (h + gy),
              w,
              h,
            }
          : {
              item,
              layer: k,
              x: padLeft + offset + i * (w + gx),
              y: padTop + k * (h + gy),
              w,
              h,
            };
      nodes.push(node);
      byId.set(item.id, node);
    });
  });

  const depth = layers.length;
  const width =
    orientation === 'horizontal'
      ? padLeft + depth * w + Math.max(0, depth - 1) * gx + PAD
      : padLeft + widest + PAD;
  const height =
    orientation === 'horizontal'
      ? padTop + widest + PAD
      : padTop + depth * h + Math.max(0, depth - 1) * gy + PAD;

  return { nodes, byId, width: Math.max(width, PAD * 2), height: Math.max(height, PAD * 2) };
}

/** Resolve links against a placement, marking the ones that close a cycle. */
export function laidEdges(
  links: readonly ChartLink[] | undefined,
  byId: Map<string, LaidNode>,
): LaidEdge[] {
  const out: LaidEdge[] = [];
  for (const link of links ?? []) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) continue;
    out.push({ link, from, to, back: to.layer <= from.layer });
  }
  return out;
}

/* ───────────────────────────────────────────────────────────────── paths ── */

/**
 * A connector between two boxes.
 *
 * Forward edges leave the right (or bottom) face and enter the opposite face,
 * bowed with a cubic whose control points sit on the axis of travel — so a
 * straight run between two aligned boxes paints as an actual straight line
 * rather than an s-curve that suggests a detour nothing took.
 *
 * A BACK EDGE IS ROUTED AROUND, NOT THROUGH. A cycle drawn as a straight line
 * back across four layers crosses every box between, and the reader cannot
 * tell a loop from a shortcut. It leaves the same face it would have left and
 * swings clear of the band before returning.
 */
export function edgePath(edge: LaidEdge, orientation: Orientation = 'horizontal'): string {
  const { from, to, back } = edge;
  if (orientation === 'horizontal') {
    const x1 = back ? from.x : from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = back ? to.x + to.w : to.x;
    const y2 = to.y + to.h / 2;
    if (back) {
      const bow = Math.max(from.h, to.h) * 0.9 + 8;
      const mid = (x1 + x2) / 2;
      return `M ${r(x1)} ${r(y1)} C ${r(mid)} ${r(y1 + bow)}, ${r(mid)} ${r(y2 + bow)}, ${r(x2)} ${r(y2)}`;
    }
    const grip = Math.max(16, (x2 - x1) / 2);
    return `M ${r(x1)} ${r(y1)} C ${r(x1 + grip)} ${r(y1)}, ${r(x2 - grip)} ${r(y2)}, ${r(x2)} ${r(y2)}`;
  }
  const x1 = from.x + from.w / 2;
  const y1 = back ? from.y : from.y + from.h;
  const x2 = to.x + to.w / 2;
  const y2 = back ? to.y + to.h : to.y;
  if (back) {
    const bow = Math.max(from.w, to.w) * 0.5 + 8;
    const mid = (y1 + y2) / 2;
    return `M ${r(x1)} ${r(y1)} C ${r(x1 + bow)} ${r(mid)}, ${r(x2 + bow)} ${r(mid)}, ${r(x2)} ${r(y2)}`;
  }
  const grip = Math.max(12, (y2 - y1) / 2);
  return `M ${r(x1)} ${r(y1)} C ${r(x1)} ${r(y1 + grip)}, ${r(x2)} ${r(y2 - grip)}, ${r(x2)} ${r(y2)}`;
}

/** Midpoint of a connector, for its label. Cheap and exact enough for a tag. */
export function edgeMid(edge: LaidEdge, orientation: Orientation = 'horizontal'): [number, number] {
  const { from, to } = edge;
  if (orientation === 'horizontal') {
    return [(from.x + from.w + to.x) / 2, (from.y + from.h / 2 + to.y + to.h / 2) / 2];
  }
  return [(from.x + from.w / 2 + to.x + to.w / 2) / 2, (from.y + from.h + to.y) / 2];
}

/** The triangle at the head of a directed connector, as a points string. */
export function arrowHead(x: number, y: number, dx: number, dy: number, size = 6): string {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x - ux * size;
  const by = y - uy * size;
  const px = -uy * (size * 0.5);
  const py = ux * (size * 0.5);
  return `${r(x)},${r(y)} ${r(bx + px)},${r(by + py)} ${r(bx - px)},${r(by - py)}`;
}

/** Round to a tenth. Two runs of the same spec must produce the same STRING. */
export function r(n: number): number {
  return Math.round(n * 10) / 10;
}

/* ──────────────────────────────────────────────────────────────── scales ── */

/**
 * A quantitative scale that always includes zero for bars.
 *
 * Not a preference: a bar chart whose baseline is not zero exaggerates every
 * difference on it, and "grounded, not guessed" does not survive an axis that
 * lies about a ratio. Line and scatter may float, because they are read as
 * shapes rather than as areas.
 */
export function extent(values: readonly number[], includeZero: boolean): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return [0, 1];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (includeZero) {
    lo = Math.min(lo, 0);
    hi = Math.max(hi, 0);
  }
  if (lo === hi) {
    if (hi === 0) return [0, 1];
    return hi > 0 ? [0, hi] : [lo, 0];
  }
  return [lo, hi];
}

/**
 * Round an extent outward to a 1/2/5 step so the ticks are numbers a human
 * reads.
 *
 * Not cosmetic. An axis labelled 0 · 460.25 · 920.5 · 1.4k · 1.8k costs the
 * reader a subtraction at every gridline, and the whole point of a chart is
 * that it is read faster than the table it replaces. Rounding OUTWARD is the
 * honest direction: the axis then covers more than the data, never less, so no
 * bar is ever clipped by its own scale.
 */
export function niceExtent(lo: number, hi: number, count = 4): [number, number] {
  const span = hi - lo;
  if (!Number.isFinite(span) || span <= 0) return [lo, lo + 1];
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/** Evenly spaced tick values across an extent, count inclusive of both ends. */
export function ticks(lo: number, hi: number, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push(lo + ((hi - lo) * i) / count);
  return out;
}

/** A number a human reads, without a locale (a locale is machine state). */
export function formatValue(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${r(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${r(n / 1_000)}k`;
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

/* ─────────────────────────────────────────────────────────────── grouping ── */

/**
 * Distinct group keys IN FIRST-APPEARANCE ORDER, optionally seeded by the
 * spec's own column or lane list.
 *
 * Sorting them would be the obvious move and it is the wrong one: `axes.lanes`
 * is an authored order ("browser, gateway, worker"), and re-sorting it
 * alphabetically silently rewrites the author's sequence into one nobody chose.
 */
export function groupKeys(items: readonly ChartItem[], declared?: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of declared ?? []) {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  for (const item of items) {
    const key = item.group;
    if (key === undefined || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  if (out.length === 0) out.push('');
  return out;
}

/** Items belonging to a group key; the '' key collects the ungrouped. */
export function inGroup(items: readonly ChartItem[], key: string): ChartItem[] {
  return items.filter((it) => (it.group ?? '') === key);
}

/** Series class for the viz namespace — six hues, cycled, never a verdict. */
export function seriesClass(index: number): string {
  return `s-${(index % 6) + 1}`;
}
