/* ══════════════════════════════════════════════════════════════════════════
   A HOSTED SVG, MADE SAFE AND FITTED TO ITS FRAME
   packages/web2/src/whiteboard/svgItem.ts

   An agent hosts an svg on a Space (`draw` type `svg`). The markup is the agent's text and is never trusted: it goes
   through the same allowlist the chat's inline drawings use (`chat/svgSanitize.ts`: no script, no `on*`, no external
   reference, no foreignObject), and only the clean tree is serialised. The frame the reader sees (`x`, `y`, `width`,
   `height`) is set HERE, after the sanitiser, from numbers the board owns, so the agent's own size attributes cannot
   place or stretch it; its viewBox scales it to the frame (derived from width/height when it has none).
   ══════════════════════════════════════════════════════════════════════════ */

import { sanitizeSvg } from '../chat/svgSanitize';

export type HostedSvg = { ok: true; html: string } | { ok: false; reason: string };

export function hostedSvg(markup: string, at: { x: number; y: number }, size: { w: number; h: number }): HostedSvg {
  const clean = sanitizeSvg(markup);
  if (!clean.ok) return { ok: false, reason: clean.reason };
  const node = clean.node.cloneNode(true) as SVGElement;
  if (!node.getAttribute('viewBox')) {
    const w = Number.parseFloat(node.getAttribute('width') ?? '');
    const h = Number.parseFloat(node.getAttribute('height') ?? '');
    if (w > 0 && h > 0) node.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  node.setAttribute('x', String(at.x));
  node.setAttribute('y', String(at.y));
  node.setAttribute('width', String(size.w));
  node.setAttribute('height', String(size.h));
  node.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  node.setAttribute('overflow', 'hidden');
  return { ok: true, html: new XMLSerializer().serializeToString(node) };
}
