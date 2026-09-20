/**
 * Pure SVG renderers for macOS-native architecture diagrams.
 */
import type { DiagramTheme, SequenceDiagramModel } from './diagramModel.js';

const NODE_W = 150;
const NODE_H = 44;
const TOP = 20;
const HEADER = 68;
const MSG_H = 40;
const PAD_X = 40;
const PAD_Y = 24;
const LANE_GAP = 40;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function edgeColor(theme: DiagramTheme, family: string): string {
  return theme.edge[family] ?? theme.muted;
}

function isDashed(family: string): boolean {
  return family === 'queue_publish' || family === 'queue_consume';
}

function labelWidth(text: string): number {
  return Math.max(48, Math.min(text.length * 5.6 + 14, 220));
}

/**
 * Render a service-level sequence diagram as responsive SVG using macOS theme tokens.
 */
export function renderSequenceSvg(
  model: SequenceDiagramModel,
  theme: DiagramTheme,
  opts?: { animate?: boolean }
): string {
  const n = model.participants.length;
  if (n === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80" width="100%"><rect width="100%" height="100%" fill="${theme.canvas}"/><text x="160" y="44" text-anchor="middle" fill="${theme.muted}" font-family="${theme.fontSans}" font-size="12">No participants</text></svg>`;
  }

  const laneW = NODE_W + LANE_GAP;
  const width = PAD_X * 2 + (n - 1) * laneW + NODE_W;
  const height = PAD_Y * 2 + HEADER + model.messages.length * MSG_H + 40;

  const xOf = (id: string): number => {
    const i = model.participants.findIndex((p) => p.id === id);
    return PAD_X + i * laneW + NODE_W / 2;
  };

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%">`
  );
  parts.push('<defs>');
  parts.push(
    `<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">`
  );
  parts.push(`<path d="M 0 0 L 10 5 L 0 10 z" fill="${theme.arrowhead}"/></marker>`);
  parts.push('<linearGradient id="nodeGrad" x1="0" y1="0" x2="0" y2="1">');
  parts.push('<stop offset="0%" stop-color="#2e2e31"/><stop offset="100%" stop-color="#29292c"/>');
  parts.push('</linearGradient></defs>');

  parts.push(`<rect width="100%" height="100%" fill="${theme.canvas}"/>`);

  model.participants.forEach((p, i) => {
    const cx = PAD_X + i * laneW + NODE_W / 2;
    const x = cx - NODE_W / 2;
    const y = TOP;
    parts.push(
      `<rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="11" fill="url(#nodeGrad)" stroke="${theme.nodeBorder}" stroke-width="1"/>`
    );
    parts.push(
      `<text x="${cx}" y="${y + 26}" text-anchor="middle" fill="${theme.text}" font-family="${theme.fontSans}" font-size="13" font-weight="600">${escapeXml(p.label)}</text>`
    );
    const lineY = y + NODE_H + 8;
    const lineEnd = height - PAD_Y;
    parts.push(
      `<line x1="${cx}" y1="${lineY}" x2="${cx}" y2="${lineEnd}" stroke="${theme.nodeBorder}" stroke-width="1" stroke-dasharray="4 4" opacity="0.6"/>`
    );
  });

  model.messages.forEach((m, idx) => {
    const y = TOP + HEADER + idx * MSG_H;
    const x1 = xOf(m.from);
    const x2 = xOf(m.to);
    const color = edgeColor(theme, m.family);
    const dash = isDashed(m.family) ? ' stroke-dasharray="6 4"' : '';
    const midY = y + 12;
    const isJourney = opts?.animate && idx === model.messages.length - 1;
    const pathId = isJourney ? `journey-path-${idx}` : undefined;
    if (isJourney) {
      parts.push(
        `<path id="${pathId}" d="M ${x1} ${midY} L ${x2} ${midY}" fill="none" stroke="none"/>`
      );
    }
    parts.push(
      `<line x1="${x1}" y1="${midY}" x2="${x2}" y2="${midY}" stroke="${color}" stroke-width="1.6"${dash} marker-end="url(#arrow)"/>`
    );

    const label = escapeXml(m.label);
    const w = labelWidth(m.label);
    const lx = (x1 + x2) / 2;
    parts.push(
      `<rect x="${lx - w / 2}" y="${midY - 16}" width="${w}" height="16" rx="4" fill="${theme.canvas}"/>`
    );
    parts.push(
      `<text x="${lx}" y="${midY - 5}" text-anchor="middle" fill="${theme.text}" font-family="${theme.fontMono}" font-size="9.5" font-weight="600">${label}</text>`
    );
    // Caller must gate animate behind prefers-reduced-motion — static SVG cannot.
    if (isJourney && pathId) {
      parts.push(
        `<circle r="3.5" fill="${theme.arrowhead}"><animateMotion dur="1.8s" repeatCount="indefinite"><mpath href="#${pathId}"/></animateMotion></circle>`
      );
    }
  });

  parts.push('</svg>');
  return parts.join('');
}
