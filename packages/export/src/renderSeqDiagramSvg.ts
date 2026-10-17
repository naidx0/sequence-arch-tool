/**
 * Structural SVG renderer for SeqDiagram v1 IR — sequence + layered-flow layouts.
 */
import type { SeqDiagramV1 } from '@sequence/schema';
import { structuralTheme, type StructuralTheme } from './structuralTheme.js';
import {
  SEQ_CARD_H as CARD_H,
  SEQ_CARD_W as CARD_W,
  SEQ_FLOW_PAD as FLOW_PAD,
  SEQ_GAP_X as GAP_X,
  SEQ_GAP_Y as GAP_Y,
  SEQ_HEADER as HEADER,
  SEQ_LANE_GAP as LANE_GAP,
  SEQ_LANE_LABEL_H as LANE_LABEL_H,
  SEQ_MAX_PRIMARY as MAX_PRIMARY,
  SEQ_MIN_MSG_SLOTS as MIN_MSG_SLOTS,
  SEQ_MIN_VIEW_H as MIN_VIEW_H,
  SEQ_MIN_VIEW_W as MIN_VIEW_W,
  SEQ_MSG_H as MSG_H,
  SEQ_NODE_H as NODE_H,
  SEQ_NODE_W as NODE_W,
  SEQ_PAD_X as PAD_X,
  SEQ_PAD_Y as PAD_Y,
  SEQ_ROLLUP_ID as ROLLUP_ID,
  SEQ_ROLLUP_W as ROLLUP_W,
  SEQ_TITLE_BLOCK_H as TITLE_BLOCK_H,
  SEQ_TOP as TOP,
  assignLayers,
  buildLayeredLayout,
  isSequenceLayout,
  nodeCardSubtitle,
  nodeCardTitle,
  resolveFlowNodeOrder,
  resolvePrimaryNodes,
  seqDiagramNodeRects,
  showTitleBlock,
  type SeqDiagramPositionOverrides,
} from './seqDiagramLayout.js';
import type { SeqDiagramNode } from '@sequence/schema';

const NODE_HEADER_H = 20;
const CARD_HEADER_H = 22;
const CARD_TITLE_MAX_CHARS = 20;
const CARD_SUBTITLE_MAX_CHARS = 32;

function truncateLabel(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function cardTextAttrs(text: string, maxChars: number, availableWidth: number): string {
  if (text.length <= maxChars) return '';
  return ` textLength="${availableWidth}" lengthAdjust="spacingAndGlyphs"`;
}

function cardTitleText(
  x: number,
  y: number,
  text: string,
  maxChars: number,
  availableWidth: number,
  theme: StructuralTheme,
  fontSize: number,
  fontWeight: number | string,
  fill: string,
): string {
  const display = truncateLabel(text, maxChars);
  const fit = cardTextAttrs(text, maxChars, availableWidth);
  return `<text x="${x}" y="${y}" text-anchor="middle" fill="${fill}" font-family="${theme.fontSans}" font-size="${fontSize}" font-weight="${fontWeight}"${fit}>${escapeXml(display)}</text>`;
}

function kindAccentColor(theme: StructuralTheme, kind: SeqDiagramNode['kind']): string {
  switch (kind) {
    case 'datastore':
      return edgeColor(theme, 'db');
    case 'topic':
      return edgeColor(theme, 'queue');
    default:
      return theme.nodeBorder;
  }
}

function layeredFlowCardParts(
  theme: StructuralTheme,
  item: { rollup?: { label: string }; node: SeqDiagramNode },
  pos: { x: number; y: number; w: number },
): string[] {
  const parts: string[] = [];
  const { x, y, w } = pos;
  const stroke = item.rollup
    ? theme.nodeBorder
    : item.node.kind === 'datastore'
      ? edgeColor(theme, 'db')
      : theme.nodeBorder;

  parts.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${CARD_H}" rx="4" fill="${theme.nodeFill}" stroke="${stroke}" stroke-width="1"${item.rollup ? ` data-rollup="true" data-node-id="${ROLLUP_ID}"` : ''}/>`,
  );

  if (item.rollup) {
    parts.push(
      `<text x="${x + w / 2}" y="${y + CARD_H / 2 + 4}" text-anchor="middle" fill="${theme.text}" font-family="${theme.fontSans}" font-size="9" font-weight="600">${escapeXml(item.rollup.label)}</text>`,
    );
    return parts;
  }

  const accent = kindAccentColor(theme, item.node.kind);
  const title = nodeCardTitle(item.node);
  const subtitle = nodeCardSubtitle(item.node);
  const subtitleText = subtitle ? subtitle : null;
  const innerW = w - 14;

  parts.push(`<rect x="${x}" y="${y}" width="3" height="${CARD_H}" rx="1" fill="${accent}"/>`);
  parts.push(
    `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${CARD_HEADER_H}" rx="3" fill="${theme.panelFill}"/>`,
  );
  parts.push(
    `<line x1="${x}" y1="${y + CARD_HEADER_H}" x2="${x + w}" y2="${y + CARD_HEADER_H}" stroke="${theme.lineSoft}" stroke-width="1"/>`,
  );
  parts.push(
    cardTitleText(
      x + w / 2,
      y + CARD_HEADER_H - 8,
      title,
      CARD_TITLE_MAX_CHARS,
      innerW,
      theme,
      11,
      600,
      theme.text,
    ),
  );
  if (subtitleText) {
    parts.push(
      cardTitleText(
        x + w / 2,
        y + CARD_H - 8,
        subtitleText,
        CARD_SUBTITLE_MAX_CHARS,
        innerW,
        theme,
        9,
        400,
        theme.muted,
      ),
    );
  }
  parts.push(
    `<text x="${x + 8}" y="${y + 12}" fill="${theme.lineDim}" font-family="${theme.fontMono}" font-size="7" font-weight="600">${kindCueLetter(item.node.kind)}</text>`,
  );
  return parts;
}

function kindCueLetter(kind: SeqDiagramNode['kind']): string {
  switch (kind) {
    case 'datastore':
      return 'D';
    case 'topic':
      return 'T';
    case 'service':
      return 'S';
    default:
      return kind?.[0]?.toUpperCase() ?? '?';
  }
}

const SIGNAL = '#F25C05';

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function edgeColor(theme: StructuralTheme, family: string): string {
  return theme.edge[family] ?? theme.muted;
}

function isDashedQueue(family: string): boolean {
  return family === 'queue' || family === 'queue_publish' || family === 'queue_consume';
}

function labelWidth(text: string): number {
  return Math.max(52, Math.min(text.length * 6 + 18, 240));
}

function emptySvg(theme: StructuralTheme, title?: string): string {
  const label = escapeXml(title?.trim() || 'No diagram content');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="320" height="80"><rect width="320" height="80" fill="${theme.canvas}"/><text x="160" y="44" text-anchor="middle" fill="${theme.muted}" font-family="${theme.fontSans}" font-size="12">${label}</text></svg>`;
}

function svgDefs(theme: StructuralTheme): string {
  return [
    '<defs>',
    `<marker id="seq-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.arrowhead}"/></marker>`,
    `<marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`,
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.arrowhead}"/></marker>`,
    '<filter id="grit" x="0" y="0" width="100%" height="100%">',
    '<feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" stitchTiles="stitch" result="n"/>',
    '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.028 0"/>',
    '</filter>',
    '</defs>',
  ].join('');
}

function sheetFrame(_theme: StructuralTheme, _width: number, _height: number): string {
  return '';
}

function gritOverlay(width: number, height: number): string {
  return `<rect width="${width}" height="${height}" fill="transparent" filter="url(#grit)" pointer-events="none"/>`;
}

function titleBlockParts(
  theme: StructuralTheme,
  title: string,
  width: number,
  y0: number
): string[] {
  const parts: string[] = [];
  parts.push(
    `<rect x="0" y="${y0}" width="${width}" height="${TITLE_BLOCK_H}" fill="${theme.panelFill}"/>`
  );
  parts.push(`<rect x="0" y="${y0}" width="${width}" height="3" fill="${theme.accent}"/>`);
  parts.push(
    `<line x1="0" y1="${y0 + TITLE_BLOCK_H}" x2="${width}" y2="${y0 + TITLE_BLOCK_H}" stroke="${theme.frameStroke}" stroke-width="1"/>`
  );
  parts.push(
    `<text x="${PAD_X}" y="${y0 + 30}" fill="${theme.accentText}" font-family="${theme.fontMono}" font-size="10" font-weight="600" letter-spacing="0.12em">01</text>`
  );
  parts.push(
    `<text x="${PAD_X + 28}" y="${y0 + 30}" fill="${theme.text}" font-family="${theme.fontSans}" font-size="14" font-weight="600">${escapeXml(title)}</text>`
  );
  return parts;
}

function participantBox(
  theme: StructuralTheme,
  x: number,
  y: number,
  w: number,
  h: number,
  headerH: number,
  label: string,
  stroke: string
): string[] {
  const parts: string[] = [];
  parts.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${theme.nodeFill}" stroke="${stroke}" stroke-width="1"/>`
  );
  parts.push(
    `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${headerH}" rx="2" fill="${theme.panelFill}"/>`
  );
  parts.push(
    `<line x1="${x}" y1="${y + headerH}" x2="${x + w}" y2="${y + headerH}" stroke="${theme.lineSoft}" stroke-width="1"/>`
  );
  parts.push(
    `<text x="${x + w / 2}" y="${y + headerH - 6}" text-anchor="middle" fill="${theme.text}" font-family="${theme.fontSans}" font-size="12" font-weight="600">${escapeXml(label)}</text>`
  );
  return parts;
}

function messageLabel(
  theme: StructuralTheme,
  lx: number,
  midY: number,
  label: string
): string[] {
  const w = labelWidth(label);
  const h = 18;
  const parts: string[] = [];
  parts.push(
    `<rect x="${lx - w / 2}" y="${midY - 17}" width="${w}" height="${h}" rx="3" fill="${theme.panelFill}" stroke="${theme.lineSoft}" stroke-width="1"/>`
  );
  parts.push(
    `<text x="${lx}" y="${midY - 4}" text-anchor="middle" fill="${theme.text}" font-family="${theme.fontSans}" font-size="10" font-weight="500">${escapeXml(label)}</text>`
  );
  return parts;
}

function renderSequenceSvg(
  doc: SeqDiagramV1,
  theme: StructuralTheme,
  positionOverrides: SeqDiagramPositionOverrides = {},
): string {
  const participants = doc.nodes;
  const n = participants.length;
  if (n === 0) return emptySvg(theme, doc.title);

  const showTitle = showTitleBlock(doc);
  const titleOffset = showTitle ? TITLE_BLOCK_H : 0;

  const laneW = NODE_W + LANE_GAP;
  const width = PAD_X * 2 + (n - 1) * laneW + NODE_W;
  const msgSlots = Math.max(doc.edges.length, MIN_MSG_SLOTS);
  const height = titleOffset + PAD_Y * 2 + HEADER + msgSlots * MSG_H + 40;

  const nodeRects = new Map(
    seqDiagramNodeRects(doc, positionOverrides).map((r) => [r.nodeId, r]),
  );

  const xOf = (id: string): number => {
    const rect = nodeRects.get(id);
    if (rect) return rect.x + rect.width / 2;
    const i = participants.findIndex((p) => p.id === id);
    return PAD_X + i * laneW + NODE_W / 2;
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  );
  parts.push(svgDefs(theme));
  parts.push(`<rect width="${width}" height="${height}" fill="${theme.canvas}"/>`);

  if (showTitle) {
    parts.push(...titleBlockParts(theme, doc.title, width, 0));
  }

  const topY = TOP + titleOffset;

  participants.forEach((p) => {
    const rect = nodeRects.get(p.id);
    if (!rect) return;
    const x = rect.x;
    const y = rect.y;
    const cx = x + NODE_W / 2;
    const stroke =
      p.kind === 'datastore' ? edgeColor(theme, 'db') : theme.nodeBorder;
    parts.push(...participantBox(theme, x, y, NODE_W, NODE_H, NODE_HEADER_H, p.label, stroke));
    const lineY = y + NODE_H + 8;
    const lineEnd = height - PAD_Y;
    parts.push(
      `<line x1="${cx}" y1="${lineY}" x2="${cx}" y2="${lineEnd}" stroke="${theme.lineDim}" stroke-width="1" stroke-dasharray="3 5" opacity="0.42"/>`
    );
  });

  doc.edges.forEach((m, idx) => {
    const y = topY + HEADER + idx * MSG_H;
    const x1 = xOf(m.from);
    const x2 = xOf(m.to);
    const color = edgeColor(theme, m.family);
    const dash = isDashedQueue(m.family) ? ' stroke-dasharray="6 4"' : '';
    const midY = y + 12;
    parts.push(
      `<line x1="${x1}" y1="${midY}" x2="${x2}" y2="${midY}" stroke="${color}" stroke-width="1.5"${dash} marker-end="url(#seq-arrow)"/>`
    );
    parts.push(...messageLabel(theme, (x1 + x2) / 2, midY, m.label ?? m.family));
  });

  parts.push(sheetFrame(theme, width, height));
  parts.push(gritOverlay(width, height));
  parts.push('</svg>');
  return parts.join('');
}

/** @internal exported for tests */
export const MAX_PRIMARY_NODES = MAX_PRIMARY;

export { assignLayers, resolveFlowNodeOrder, resolvePrimaryNodes } from './seqDiagramLayout.js';

function flowLaneLabel(theme: StructuralTheme, y: number): string {
  return `<text x="${FLOW_PAD}" y="${y}" fill="${theme.lineDim}" font-family="${theme.fontMono}" font-size="8" letter-spacing="0.08em">FLOW · LANE 01</text>`;
}

function renderLayeredFlowSvg(
  doc: SeqDiagramV1,
  theme: StructuralTheme,
  positionOverrides: SeqDiagramPositionOverrides = {},
): string {
  const layout = buildLayeredLayout(doc);
  if (layout.length === 0) return emptySvg(theme, doc.title);

  const showTitle = showTitleBlock(doc);
  const titleOffset = showTitle ? TITLE_BLOCK_H : 0;
  const laneY = titleOffset + FLOW_PAD;

  const maxLayer = Math.max(...layout.map((n) => n.layer));
  const maxRow = Math.max(...layout.map((n) => n.row));
  const colCount = maxLayer + 1;
  const rowCount = maxRow + 1;

  const contentW = colCount * CARD_W + (colCount - 1) * GAP_X + ROLLUP_W;
  const contentH = rowCount * CARD_H + (rowCount - 1) * GAP_Y;
  const width = Math.max(MIN_VIEW_W, FLOW_PAD * 2 + contentW);
  const height = Math.max(
    MIN_VIEW_H,
    titleOffset + FLOW_PAD * 2 + LANE_LABEL_H + contentH + 24
  );

  const rectsById = new Map(
    seqDiagramNodeRects(doc, positionOverrides).map((r) => [r.nodeId, r]),
  );

  const posOf = (id: string): { x: number; y: number; w: number } | undefined => {
    const rect = rectsById.get(id);
    if (!rect) return undefined;
    return { x: rect.x, y: rect.y, w: rect.width };
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
  );
  parts.push(svgDefs(theme));
  parts.push(`<rect width="${width}" height="${height}" fill="${theme.canvas}"/>`);

  if (showTitle) {
    parts.push(...titleBlockParts(theme, doc.title, width, 0));
  }

  parts.push(flowLaneLabel(theme, laneY - 4));

  for (const item of layout) {
    const w = item.rollup ? ROLLUP_W : CARD_W;
    const pos = posOf(item.id)!;
    parts.push(...layeredFlowCardParts(theme, item, { x: pos.x, y: pos.y, w }));
  }

  const primaryIds = new Set(layout.filter((n) => !n.rollup).map((n) => n.id));
  const edges =
    doc.flows?.[0]?.edgeIds?.length
      ? doc.edges.filter((e) => doc.flows![0].edgeIds!.includes(e.id))
      : doc.edges;

  for (const e of edges) {
    if (!primaryIds.has(e.from) || !primaryIds.has(e.to)) continue;
    const src = posOf(e.from);
    const dst = posOf(e.to);
    if (!src || !dst) continue;
    const color = edgeColor(theme, e.family);
    const dash = isDashedQueue(e.family) ? ' stroke-dasharray="6 4"' : '';
    const x1 = src.x + src.w;
    const y1 = src.y + CARD_H / 2;
    const x2 = dst.x;
    const y2 = dst.y + CARD_H / 2;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    parts.push(
      `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.5"${dash} marker-end="url(#flow-arrow)"/>`
    );
    const edgeLabel = e.label ?? e.family;
    parts.push(...messageLabel(theme, midX, midY, edgeLabel));
  }

  parts.push(sheetFrame(theme, width, height));
  parts.push(gritOverlay(width, height));
  parts.push('</svg>');
  return parts.join('');
}

export interface RenderSeqDiagramSvgOptions {
  positionOverrides?: SeqDiagramPositionOverrides;
}

/**
 * Render a grounded SeqDiagram v1 document as brand-faithful Structural SVG.
 */
export function renderSeqDiagramSvg(
  doc: SeqDiagramV1,
  options: RenderSeqDiagramSvgOptions = {},
): string {
  const theme = structuralTheme();
  const positionOverrides = options.positionOverrides ?? {};

  if (!doc.nodes || doc.nodes.length === 0) {
    return emptySvg(theme, doc.title);
  }

  if (isSequenceLayout(doc)) {
    return renderSequenceSvg(doc, theme, positionOverrides);
  }
  return renderLayeredFlowSvg(doc, theme, positionOverrides);
}

/** @internal exported for tests */
export function _edgeStrokeUsesSignal(svg: string): boolean {
  const lines = svg.match(/<line[^>]*stroke="[^"]*"[^>]*>/g) ?? [];
  return lines.some((l) => l.includes(SIGNAL));
}

/** @internal exported for tests */
export function _hasSignalTitleRule(svg: string): boolean {
  const rules = svg.match(/<rect[^>]*height="3"[^>]*fill="[^"]*"[^>]*\/>/g) ?? [];
  return rules.some((r) => r.includes(SIGNAL));
}
