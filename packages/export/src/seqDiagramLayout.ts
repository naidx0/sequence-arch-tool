/**
 * Shared SeqDiagram layout geometry — single source for SVG render + board camera.
 */
import type { SeqDiagramEdge, SeqDiagramNode, SeqDiagramGroup, SeqDiagramV1 } from '@sequence/schema';

export const SEQ_NODE_W = 150;
export const SEQ_NODE_H = 44;
export const SEQ_TOP = 20;
export const SEQ_HEADER = 68;
export const SEQ_MSG_H = 40;
export const SEQ_MIN_MSG_SLOTS = 6;
export const SEQ_PAD_X = 40;
export const SEQ_PAD_Y = 24;
export const SEQ_LANE_GAP = 40;
export const SEQ_TITLE_BLOCK_H = 52;

export const SEQ_CARD_W = 110;
/** Title + optional subtitle — keep boardViewModel hit rects in sync via this module. */
export const SEQ_CARD_H = 64;
export const SEQ_ROLLUP_ID = '__rollup__';
export const SEQ_ROLLUP_W = 60;
export const SEQ_GAP_X = 48;
export const SEQ_GAP_Y = 40;
export const SEQ_FLOW_PAD = 32;
export const SEQ_LANE_LABEL_H = 18;
export const SEQ_MIN_VIEW_W = 480;
export const SEQ_MIN_VIEW_H = 200;
/** Usable virtual canvas when the board has no diagram nodes yet. */
export const SEQ_EMPTY_MIN_W = 640;
export const SEQ_EMPTY_MIN_H = 400;

export const SEQ_MAX_PRIMARY = 20;

/** Strip scan prefixes for display when native English is missing. */
export function humanizeNodeLabel(raw: string): string {
  const s = raw.trim();
  const colon = s.match(/^(?:svc|ds|topic|module|pkg):(.+)$/);
  if (colon) return colon[1]!.replace(/[-_.]/g, ' ');
  return s.replace(/[-_]/g, ' ');
}

/** Card title — prefer grounded `whatItIs`, else humanized label. */
export function nodeCardTitle(node: SeqDiagramNode): string {
  const what = node.detail?.whatItIs?.trim();
  if (what) return what;
  const label = node.label?.trim();
  if (label) return humanizeNodeLabel(label);
  return humanizeNodeLabel(node.id);
}

/** Card subtitle — `whatItDoes` when present. */
export function nodeCardSubtitle(node: SeqDiagramNode): string | undefined {
  const sub = node.detail?.whatItDoes?.trim();
  return sub || undefined;
}

/** True when non-primary nodes are collapsed behind a rollup chip. */
export function seqDiagramHasRollup(doc: SeqDiagramV1): boolean {
  return doc.nodes.length > resolvePrimaryNodes(doc).length;
}

/** Expand rollup — all nodes become primary for layout/render. */
export function docWithExpandedRollup(doc: SeqDiagramV1): SeqDiagramV1 {
  return { ...doc, primaryNodeIds: doc.nodes.map((n) => n.id) };
}

/** Board display doc — expanded rollup shows every node instead of +N. */
export function boardDisplayDoc(doc: SeqDiagramV1, rollupExpanded: boolean): SeqDiagramV1 {
  if (!rollupExpanded || !seqDiagramHasRollup(doc)) return doc;
  return docWithExpandedRollup(doc);
}

/** Count of nodes hidden behind the rollup chip. */
export function rollupHiddenCount(doc: SeqDiagramV1): number {
  return Math.max(0, doc.nodes.length - resolvePrimaryNodes(doc).length);
}

export interface SeqDiagramSheetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SeqDiagramNodeRect {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Product-side node position overrides — keyed by node id (e.g. design:draw-*). */
export type SeqDiagramPositionOverrides = Record<string, { x: number; y: number }>;

function applyPositionOverride(
  rect: SeqDiagramNodeRect,
  overrides: SeqDiagramPositionOverrides,
): SeqDiagramNodeRect {
  const pos = overrides[rect.nodeId];
  if (!pos) return rect;
  return { ...rect, x: pos.x, y: pos.y };
}

export function isSequenceLayout(doc: SeqDiagramV1): boolean {
  return doc.kind === 'service-sequence' || doc.layout?.engine === 'sequence';
}

export function showTitleBlock(doc: SeqDiagramV1): boolean {
  return doc.layout?.showTitleBlock !== false;
}

export function sequenceMessageSlots(edgeCount: number): number {
  return Math.max(edgeCount, SEQ_MIN_MSG_SLOTS);
}

function nodeDegree(edges: SeqDiagramEdge[], id: string): number {
  let d = 0;
  for (const e of edges) {
    if (e.from === id) d++;
    if (e.to === id) d++;
  }
  return d;
}

/** Resolve ≤20 primary nodes — explicit ids, primary flags, else top-N by degree. */
export function resolvePrimaryNodes(doc: SeqDiagramV1): SeqDiagramNode[] {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  if (doc.primaryNodeIds?.length) {
    const resolved = doc.primaryNodeIds
      .map((id) => byId.get(id))
      .filter((n): n is SeqDiagramNode => n !== undefined);
    // Expanded rollup — explicit full primary set shows every node.
    if (resolved.length === doc.nodes.length) return resolved;
    return resolved.slice(0, SEQ_MAX_PRIMARY);
  }
  const flagged = doc.nodes.filter((n) => n.primary);
  if (flagged.length) return flagged.slice(0, SEQ_MAX_PRIMARY);
  return [...doc.nodes]
    .sort(
      (a, b) =>
        nodeDegree(doc.edges, b.id) - nodeDegree(doc.edges, a.id) ||
        a.label.localeCompare(b.label),
    )
    .slice(0, SEQ_MAX_PRIMARY);
}

function groupMembers(
  groups: SeqDiagramGroup[] | undefined,
  primaryIds: Set<string>,
): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const g of groups ?? []) {
    const members = g.memberIds.filter((id) => !primaryIds.has(id));
    if (members.length) m.set(g.id, members);
  }
  return m;
}

/** Layer assignment via longest-path from entry nodes — minimizes backward edges. */
export function assignLayers(nodeIds: string[], edges: SeqDiagramEdge[]): Map<string, number> {
  const idSet = new Set(nodeIds);
  const inbound = new Map<string, Set<string>>();
  const outbound = new Map<string, Set<string>>();
  for (const id of nodeIds) {
    inbound.set(id, new Set());
    outbound.set(id, new Set());
  }
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
    inbound.get(e.to)!.add(e.from);
    outbound.get(e.from)!.add(e.to);
  }
  const layer = new Map<string, number>();
  const entries = nodeIds.filter((id) => inbound.get(id)!.size === 0);
  const seeds = entries.length ? entries : [nodeIds[0]!];
  for (const id of nodeIds) layer.set(id, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of edges) {
      if (!idSet.has(e.from) || !idSet.has(e.to)) continue;
      const next = (layer.get(e.from) ?? 0) + 1;
      if (next > (layer.get(e.to) ?? 0)) {
        layer.set(e.to, next);
        changed = true;
      }
    }
  }
  const maxL = Math.max(0, ...layer.values());
  for (const id of nodeIds) {
    if (!seeds.includes(id) && inbound.get(id)!.size === 0 && outbound.get(id)!.size === 0) {
      layer.set(id, maxL);
    }
  }
  return layer;
}

function orderWithinLayers(
  nodeIds: string[],
  edges: SeqDiagramEdge[],
  layers: Map<string, number>,
): Map<string, number> {
  const byLayer = new Map<number, string[]>();
  for (const id of nodeIds) {
    const l = layers.get(id) ?? 0;
    const list = byLayer.get(l) ?? [];
    list.push(id);
    byLayer.set(l, list);
  }
  const row = new Map<string, number>();
  const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b);
  for (const l of sortedLayers) {
    const ids = byLayer.get(l)!;
    if (l === 0) {
      ids.sort();
      ids.forEach((id, i) => row.set(id, i));
      continue;
    }
    const prev = byLayer.get(l - 1) ?? [];
    const prevRow = new Map(prev.map((id, i) => [id, i]));
    const bary = (id: string): number => {
      const preds = edges.filter((e) => e.to === id && prevRow.has(e.from));
      if (!preds.length) return ids.indexOf(id);
      return preds.reduce((s, e) => s + (prevRow.get(e.from) ?? 0), 0) / preds.length;
    };
    ids.sort((a, b) => bary(a) - bary(b) || a.localeCompare(b));
    ids.forEach((id, i) => row.set(id, i));
  }
  return row;
}

/** Prefer doc.flows[0].nodeIds; else topological layer order left→right. */
export function resolveFlowNodeOrder(doc: SeqDiagramV1, primaryIds: string[]): string[] {
  const idSet = new Set(primaryIds);
  const flow = doc.flows?.[0];
  if (flow?.nodeIds?.length) {
    const ordered = flow.nodeIds.filter((id) => idSet.has(id));
    const rest = primaryIds.filter((id) => !ordered.includes(id));
    return [...ordered, ...rest];
  }
  const edges = doc.edges.filter((e) => idSet.has(e.from) && idSet.has(e.to));
  const layers = assignLayers(primaryIds, edges);
  const rows = orderWithinLayers(primaryIds, edges, layers);
  return [...primaryIds].sort(
    (a, b) =>
      (layers.get(a) ?? 0) - (layers.get(b) ?? 0) ||
      (rows.get(a) ?? 0) - (rows.get(b) ?? 0) ||
      a.localeCompare(b),
  );
}

interface LayeredNode {
  id: string;
  node: SeqDiagramNode;
  layer: number;
  row: number;
  rollup?: { count: number; label: string };
}

export function buildLayeredLayout(doc: SeqDiagramV1): LayeredNode[] {
  const primary = resolvePrimaryNodes(doc);
  const primaryIds = new Set(primary.map((n) => n.id));
  const grouped = groupMembers(doc.groups, primaryIds);
  const nonPrimary = doc.nodes.filter((n) => !primaryIds.has(n.id));
  const order = resolveFlowNodeOrder(doc, [...primaryIds]);
  const edges = doc.edges.filter((e) => primaryIds.has(e.from) && primaryIds.has(e.to));
  const layers = assignLayers(order, edges);
  const rows = orderWithinLayers(order, edges, layers);

  const layout: LayeredNode[] = order.map((id) => {
    const node = primary.find((n) => n.id === id)!;
    return { id, node, layer: layers.get(id) ?? 0, row: rows.get(id) ?? 0 };
  });

  const hiddenCount = nonPrimary.length;
  if (hiddenCount > 0) {
    const maxLayer = Math.max(0, ...layout.map((n) => n.layer));
    layout.push({
      id: SEQ_ROLLUP_ID,
      node: { id: SEQ_ROLLUP_ID, label: `+${hiddenCount}`, kind: 'service' },
      layer: maxLayer + 1,
      row: 0,
      rollup: {
        count: hiddenCount,
        label: grouped.size
          ? [...grouped.values()].flat().length
            ? `+${hiddenCount}`
            : `+${hiddenCount}`
          : `+${hiddenCount}`,
      },
    });
  }
  return layout;
}

/** Sequence diagram height in SVG coordinates. */
export function sequenceDiagramHeight(doc: SeqDiagramV1): number {
  const titleOffset = showTitleBlock(doc) ? SEQ_TITLE_BLOCK_H : 0;
  return (
    titleOffset +
    SEQ_PAD_Y * 2 +
    SEQ_HEADER +
    sequenceMessageSlots(doc.edges.length) * SEQ_MSG_H +
    40
  );
}

function sequenceSheetSize(doc: SeqDiagramV1): { width: number; height: number } {
  const n = doc.nodes.length;
  const laneW = SEQ_NODE_W + SEQ_LANE_GAP;
  const width = SEQ_PAD_X * 2 + (n - 1) * laneW + SEQ_NODE_W;
  const height = sequenceDiagramHeight(doc);
  return { width, height };
}

function layeredFlowSheetSize(doc: SeqDiagramV1): { width: number; height: number } {
  const layout = buildLayeredLayout(doc);
  const showTitle = showTitleBlock(doc);
  const titleOffset = showTitle ? SEQ_TITLE_BLOCK_H : 0;
  const maxLayer = Math.max(...layout.map((n) => n.layer));
  const maxRow = Math.max(...layout.map((n) => n.row));
  const td = doc.layout?.direction === 'TD';
  const colCount = (td ? maxRow : maxLayer) + 1;
  const rowCount = (td ? maxLayer : maxRow) + 1;
  const contentW = colCount * SEQ_CARD_W + (colCount - 1) * SEQ_GAP_X + SEQ_ROLLUP_W;
  const contentH = rowCount * SEQ_CARD_H + (rowCount - 1) * SEQ_GAP_Y;
  const width = Math.max(SEQ_MIN_VIEW_W, SEQ_FLOW_PAD * 2 + contentW);
  const height = Math.max(
    SEQ_MIN_VIEW_H,
    titleOffset + SEQ_FLOW_PAD * 2 + SEQ_LANE_LABEL_H + contentH + 24,
  );
  return { width, height };
}

function unionAxisAligned(
  rects: readonly { x: number; y: number; width: number; height: number }[],
): SeqDiagramSheetBounds | null {
  if (!rects.length) return null;
  let x0 = rects[0]!.x;
  let y0 = rects[0]!.y;
  let x1 = rects[0]!.x + rects[0]!.width;
  let y1 = rects[0]!.y + rects[0]!.height;
  for (let i = 1; i < rects.length; i++) {
    const r = rects[i]!;
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/**
 * Tight content AABB — union of node rects plus title block when shown.
 * Excludes MIN_VIEW sheet padding used only for SVG canvas size.
 */
export function seqDiagramContentBounds(doc: SeqDiagramV1): SeqDiagramSheetBounds {
  if (!doc.nodes.length) {
    return { x: 0, y: 0, width: SEQ_EMPTY_MIN_W, height: SEQ_EMPTY_MIN_H };
  }

  const nodeRects = seqDiagramNodeRects(doc);
  let bounds = unionAxisAligned(nodeRects);
  if (!bounds) {
    return seqDiagramSheetBounds(doc);
  }

  if (showTitleBlock(doc)) {
    const titleRect = {
      x: bounds.x,
      y: 0,
      width: bounds.width,
      height: SEQ_TITLE_BLOCK_H,
    };
    bounds = unionAxisAligned([bounds, titleRect])!;
  }

  return bounds;
}

/** Bounding box of the rendered diagram sheet — matches SVG viewBox. */
export function seqDiagramSheetBounds(doc: SeqDiagramV1): SeqDiagramSheetBounds {
  if (!doc.nodes.length) {
    return { x: 0, y: 0, width: SEQ_EMPTY_MIN_W, height: SEQ_EMPTY_MIN_H };
  }
  if (isSequenceLayout(doc)) {
    const { width, height } = sequenceSheetSize(doc);
    return { x: 0, y: 0, width, height };
  }
  const { width, height } = layeredFlowSheetSize(doc);
  return { x: 0, y: 0, width, height };
}

/** Parse viewBox width/height from rendered SVG — for locking tests. */
export function viewBoxFromSvg(svg: string): { width: number; height: number } | null {
  const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** Node rectangles in SVG coordinates — same geometry as the Structural SVG renderer. */
export function seqDiagramNodeRects(
  doc: SeqDiagramV1,
  positionOverrides: SeqDiagramPositionOverrides = {},
): SeqDiagramNodeRect[] {
  if (!doc.nodes.length) return [];

  const titleOffset = showTitleBlock(doc) ? SEQ_TITLE_BLOCK_H : 0;
  const regions: SeqDiagramNodeRect[] = [];

  if (isSequenceLayout(doc)) {
    const laneW = SEQ_NODE_W + SEQ_LANE_GAP;
    const topY = SEQ_TOP + titleOffset;
    doc.nodes.forEach((p, i) => {
      const cx = SEQ_PAD_X + i * laneW + SEQ_NODE_W / 2;
      regions.push(
        applyPositionOverride(
          {
            nodeId: p.id,
            x: cx - SEQ_NODE_W / 2,
            y: topY,
            width: SEQ_NODE_W,
            height: SEQ_NODE_H,
          },
          positionOverrides,
        ),
      );
    });
    return regions;
  }

  const layout = buildLayeredLayout(doc);
  const laneY = titleOffset + SEQ_FLOW_PAD;
  const td = doc.layout?.direction === 'TD';
  for (const item of layout) {
    const w = item.rollup ? SEQ_ROLLUP_W : SEQ_CARD_W;
    const x = SEQ_FLOW_PAD + (td ? item.row : item.layer) * (SEQ_CARD_W + SEQ_GAP_X);
    const y = laneY + SEQ_LANE_LABEL_H + (td ? item.layer : item.row) * (SEQ_CARD_H + SEQ_GAP_Y);
    regions.push(
      applyPositionOverride(
        {
          nodeId: item.id,
          x,
          y,
          width: w,
          height: SEQ_CARD_H,
        },
        positionOverrides,
      ),
    );
  }
  return regions;
}
