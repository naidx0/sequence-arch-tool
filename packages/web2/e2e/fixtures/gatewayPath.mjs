/* The "Request path through the gateway" drawing as an agent would draw it: four boxes in a row, each edge a
   straight arrow from the middle of one box's right side to the middle of the next box's left side, with an
   arrowhead. Written the way agents write svg: currentColor, no fill on the text, a marker with no fill, no
   stroke width on the lines. The app's card theme (diagramBlock.css) supplies the ink, the 1.5px line and the
   arrowhead colour. Used by e2e/card-shots.mjs and by chat/diagramClarity.test.ts. */

export const GATEWAY_BOXES = ['Client', 'Proxy', 'Limiter', 'Store'].map((label, i) => ({ label, x: 12 + i * 112, y: 56, w: 88, h: 40 }));

export const gatewayEdges = () =>
  GATEWAY_BOXES.slice(0, -1).map((a, i) => {
    const b = GATEWAY_BOXES[i + 1];
    return { x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 };
  });

export function gatewaySvg() {
  const boxes = GATEWAY_BOXES.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 5}" text-anchor="middle" font-size="14">${b.label}</text>`).join('');
  const edges = gatewayEdges().map((e) => `<line x1="${e.x1}" y1="${e.y1}" x2="${e.x2 - 1}" y2="${e.y2}" stroke="currentColor" marker-end="url(#arrow)"/>`).join('');
  const notes = ['key = req.ip', 'window 60 s', 'count in memory'].map((t, i) => `<text x="${GATEWAY_BOXES[i + 1].x + 44}" y="${GATEWAY_BOXES[i + 1].y + 62}" text-anchor="middle" font-size="12" opacity="0.7">${t}</text>`).join('');
  return `<svg viewBox="0 0 460 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Request path through the gateway"><title>request path through the gateway</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9 Z"/></marker></defs>${boxes}${edges}${notes}</svg>`;
}

/** A tall drawing for the capped-card shot: eight steps top to bottom, arrows between. */
export function tallSvg() {
  const steps = ['Request arrives', 'TLS terminates', 'Proxy adds X-Forwarded-For', 'Limiter reads req.ip', 'Window lookup', 'Counter increments', 'Decision', 'Response returned'];
  const h = 44;
  const gap = 36;
  const boxes = steps.map((t, i) => `<rect x="70" y="${12 + i * (h + gap)}" width="220" height="${h}" rx="8" fill="none" stroke="currentColor" stroke-width="1.5"/><text x="180" y="${12 + i * (h + gap) + 27}" text-anchor="middle" font-size="14">${t}</text>`).join('');
  const arrows = steps.slice(0, -1).map((_, i) => `<line x1="180" y1="${12 + i * (h + gap) + h}" x2="180" y2="${12 + (i + 1) * (h + gap) - 1}" stroke="currentColor" marker-end="url(#arrow)"/>`).join('');
  const total = 12 + steps.length * (h + gap);
  return `<svg viewBox="0 0 360 ${total}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Request lifecycle"><title>request lifecycle in eight steps</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M1 1 L9 5 L1 9 Z"/></marker></defs>${boxes}${arrows}</svg>`;
}
