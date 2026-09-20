/**
 * Grouped service-map SVG — macOS-dark cards + projected edges (export menu).
 */
import type { ArchGraph } from '@sequence/schema';
import { macOsTheme } from './diagramModel.js';
import { buildLift, projectEdges } from './project.js';

const CARD_W = 168;
const CARD_H = 52;
const GAP_X = 48;
const GAP_Y = 56;
const PAD = 32;
const COLS = 4;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cardTitle(graph: ArchGraph, id: string): string {
  const n = graph.nodes.find((x) => x.id === id);
  return n?.label?.replace(/[-_]/g, ' ') ?? id;
}

/**
 * Render a compact grouped service map SVG from an ArchGraph (≤12 service-level nodes).
 */
export function renderServiceMapSvg(graph: ArchGraph): string {
  const theme = macOsTheme();
  const lift = buildLift(graph);
  const seen = new Map<string, { id: string; label: string; kind: string }>();
  for (const n of graph.nodes) {
    if (n.kind !== 'service' && n.kind !== 'datastore' && n.kind !== 'topic') continue;
    const L = lift(n.id);
    if (!L || seen.has(n.id)) continue;
    seen.set(n.id, { id: n.id, label: cardTitle(graph, n.id), kind: n.kind });
    if (seen.size >= 12) break;
  }
  const cards = [...seen.values()];
  if (cards.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="100%"><rect width="100%" height="100%" fill="${theme.canvas}"/><text x="160" y="44" text-anchor="middle" fill="${theme.muted}" font-family="${theme.fontSans}" font-size="12">No services to map</text></svg>`;
  }

  const rows = Math.ceil(cards.length / COLS);
  const width = PAD * 2 + COLS * CARD_W + (COLS - 1) * GAP_X;
  const height = PAD * 2 + rows * CARD_H + (rows - 1) * GAP_Y;

  const posOf = (id: string): { cx: number; cy: number } | undefined => {
    const i = cards.findIndex((c) => c.id === id);
    if (i < 0) return undefined;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (CARD_W + GAP_X) + CARD_W / 2;
    const y = PAD + row * (CARD_H + GAP_Y) + CARD_H / 2;
    return { cx: x, cy: y };
  };

  const posOfLabel = (label: string): { cx: number; cy: number } | undefined => {
    const norm = label.toLowerCase();
    const i = cards.findIndex((c) => c.label.toLowerCase() === norm);
    if (i < 0) return undefined;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (CARD_W + GAP_X) + CARD_W / 2;
    const y = PAD + row * (CARD_H + GAP_Y) + CARD_H / 2;
    return { cx: x, cy: y };
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%">`,
  );
  parts.push(`<rect width="100%" height="100%" fill="${theme.canvas}"/>`);
  parts.push(
    `<defs><marker id="sm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.arrowhead}"/></marker></defs>`,
  );

  cards.forEach((c, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = PAD + col * (CARD_W + GAP_X);
    const y = PAD + row * (CARD_H + GAP_Y);
    const stroke = c.kind === 'datastore' ? theme.edge.db_access : theme.nodeBorder;
    parts.push(
      `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="10" fill="#29292c" stroke="${stroke}" stroke-width="1"/>`,
    );
    parts.push(
      `<text x="${x + CARD_W / 2}" y="${y + 30}" text-anchor="middle" fill="${theme.text}" font-family="${theme.fontSans}" font-size="12" font-weight="600">${escapeXml(c.label)}</text>`,
    );
  });

  for (const e of projectEdges(graph)) {
    const src = posOfLabel(e.src);
    const dst = posOfLabel(e.dst);
    if (!src || !dst) continue;
    const color = theme.edge[e.family] ?? theme.muted;
    parts.push(
      `<line x1="${src.cx + CARD_W / 2 - 8}" y1="${src.cy}" x2="${dst.cx - CARD_W / 2 + 8}" y2="${dst.cy}" stroke="${color}" stroke-width="1.5" marker-end="url(#sm-arrow)"/>`,
    );
  }

  parts.push('</svg>');
  return parts.join('');
}
