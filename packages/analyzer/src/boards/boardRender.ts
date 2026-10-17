/* ══════════════════════════════════════════════════════════════════════════
   BOARD RENDER — board items to one themed SVG, on the server
   packages/analyzer/src/boards/boardRender.ts

   The source of truth is the board. The chat shows a little diagram INLINE by
   asking for `GET /api/boards/:board/render.svg?group=<id>|items=<ids>`, and the
   person opens the same items on the Space to see them bigger and edit them.

   THEME-FIRST, like the board itself: a palette NAME becomes `var(--ink-1)` etc.
   (boardPalette.ts), the font is `var(--font-sans)`, so the SVG follows light and
   dark when it is inlined in the page. A raw #hex appears only for an item that
   says `ownTheme: true`. Deterministic: the same items give the same bytes (no
   clock, no random; the marker ids hang off a hash of the item ids).

   Not drawn: strokes' pen timing, anchored items (their coordinates are offsets
   from a graph node this renderer does not place), and a video/scene's playback.
   A video renders as a poster box with its label; a scene as its stage frame.
   ══════════════════════════════════════════════════════════════════════════ */

import { BOARD_PALETTE, FILL_EXTRA_TOKENS, FONT_SIZE_PX, type BoardFontSize } from './boardPalette.js';
import type { BNodeRef, BScene, BShape, BText, BVideo, BoardItem, BPoint } from './boardStore.js';
import { edgePoint } from './compose.js';

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
  /** Items drawn. */
  drawn: number;
  /** Items left out (anchored to a graph node). */
  skipped: number;
}

const PAD = 16;
const num = (n: number): string => String(Math.round(n * 100) / 100);
const esc = (s: string): string =>
  s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** A stroke/ink colour: palette name -> its custom property; a #hex only with ownTheme. */
function ink(name: string | undefined, own: boolean | undefined, dflt: string): string {
  if (!name) return dflt;
  if (name in BOARD_PALETTE) return `var(${BOARD_PALETTE[name as keyof typeof BOARD_PALETTE]})`;
  if (own && name.startsWith('#')) return esc(name);
  return dflt;
}

function fillOf(name: string | undefined, own: boolean | undefined, dflt: string): { fill: string; opacity?: number } {
  if (!name) return { fill: dflt };
  if (name === 'none') return { fill: 'none' };
  if (name === 'surface') return { fill: `var(${FILL_EXTRA_TOKENS.surface})` };
  if (name in BOARD_PALETTE) return { fill: `var(${BOARD_PALETTE[name as keyof typeof BOARD_PALETTE]})`, opacity: 0.16 };
  if (own && name.startsWith('#')) return { fill: esc(name) };
  return { fill: dflt };
}

/** Greedy word wrap by an average glyph width; the last line gets an ellipsis when it must be cut. */
function wrap(text: string, maxW: number, px: number, maxLines: number): string[] {
  const per = px * 0.56;
  const cols = Math.max(4, Math.floor(maxW / per));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > cols) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(w.slice(0, cols));
        w = w.slice(cols);
      }
      if (!line) line = w;
      else if ((line + ' ' + w).length <= cols) line += ' ' + w;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    const last = cut[maxLines - 1]!;
    cut[maxLines - 1] = (last.length >= cols ? last.slice(0, cols - 1) : last) + '…';
    return cut;
  }
  return out;
}

/** The text of a label: centred tspans in a box (or at a point). */
function textBlock(lines: string[], cx: number, top: number, px: number, anchor: 'middle' | 'start', fill: string, weight?: number): string {
  const lh = px * 1.3;
  const tsp = lines.map((l, i) => `<tspan x="${num(cx)}" y="${num(top + px + i * lh)}">${esc(l)}</tspan>`).join('');
  return `<text text-anchor="${anchor}" font-size="${px}"${weight ? ` font-weight="${weight}"` : ''} fill="${fill}">${tsp}</text>`;
}

function boxOf(it: BoardItem): Box | null {
  switch (it.kind) {
    case 'shape': {
      if (it.shape === 'path' && it.points) {
        const xs = it.points.map((p) => p.x);
        const ys = it.points.map((p) => p.y);
        return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      }
      return { x: Math.min(it.from.x, it.to.x), y: Math.min(it.from.y, it.to.y), w: Math.abs(it.to.x - it.from.x), h: Math.abs(it.to.y - it.from.y) };
    }
    case 'stroke': {
      const xs = it.points.map((p) => p.x);
      const ys = it.points.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    case 'text': {
      const px = FONT_SIZE_PX[it.fontSize ?? 'md'];
      if (it.sticky) return { x: it.at.x, y: it.at.y, w: it.w ?? 180, h: it.h ?? 110 };
      const lines = it.text.split('\n');
      return { x: it.at.x, y: it.at.y, w: Math.max(...lines.map((l) => l.length)) * px * 0.56, h: lines.length * px * 1.3 };
    }
    case 'noderef':
      return { x: it.at.x, y: it.at.y, w: 160, h: 72 };
    case 'svg':
    case 'video':
    case 'scene':
      return { x: it.at.x, y: it.at.y, w: it.w, h: it.h };
  }
}

const dashOf = (d: string | undefined, sw: number): string => (d === 'dashed' ? ` stroke-dasharray="${num(sw * 4)} ${num(sw * 3)}"` : d === 'dotted' ? ` stroke-dasharray="${num(sw)} ${num(sw * 2.5)}"` : '');

function shapeSvg(it: BShape, boxes: Map<string, Box>, markerId: (kind: string) => string): string {
  const sw = it.strokeWidth ?? 2;
  const stroke = ink(it.stroke, it.ownTheme, 'var(--ink-2)');
  const px = FONT_SIZE_PX[(it.fontSize ?? 'md') as BoardFontSize];
  const dash = dashOf(it.dash, sw);
  const own = it.ownTheme;
  if (it.shape === 'arrow' || it.shape === 'line' || it.shape === 'path') {
    let pts: BPoint[];
    if (it.shape === 'path' && it.points) pts = it.points;
    else {
      let a = it.from;
      let b = it.to;
      const fb = it.fromId ? boxes.get(it.fromId) : undefined;
      const tb = it.toId ? boxes.get(it.toId) : undefined;
      if (fb && tb) {
        const ca = { x: fb.x + fb.w / 2, y: fb.y + fb.h / 2 };
        const cb = { x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 };
        a = edgePoint(fb, cb);
        b = edgePoint(tb, ca);
      }
      pts = [a, b];
    }
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p.x)} ${num(p.y)}`).join(' ');
    const end = it.arrowEnd ?? (it.shape === 'arrow' ? 'arrow' : 'none');
    const start = it.arrowStart ?? 'none';
    const mk = (end !== 'none' ? ` marker-end="url(#${markerId(end)})"` : '') + (start !== 'none' ? ` marker-start="url(#${markerId(start)})"` : '');
    let out = `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dash}${mk}/>`;
    if (it.label) {
      const mid = pts[Math.floor((pts.length - 1) / 2)]!;
      const nxt = pts[Math.floor((pts.length - 1) / 2) + 1] ?? mid;
      out += textBlock([it.label], (mid.x + nxt.x) / 2, (mid.y + nxt.y) / 2 - px - 4, px, 'middle', 'var(--ink-2)');
    }
    return out;
  }
  const x = Math.min(it.from.x, it.to.x);
  const y = Math.min(it.from.y, it.to.y);
  const w = Math.abs(it.to.x - it.from.x);
  const h = Math.abs(it.to.y - it.from.y);
  if (it.shape === 'frame') {
    const f = fillOf(it.fill, own, 'none');
    const rect = `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="14" fill="${f.fill}"${f.opacity ? ` fill-opacity="${f.opacity}"` : ''} stroke="${ink(it.stroke, own, 'var(--ink-4)')}" stroke-width="${Math.min(sw, 2)}"${dash || ' stroke-dasharray="6 4"'}/>`;
    const title = it.label ? textBlock([wrap(it.label, w - 24, 13, 1)[0]!], x + 14, y + 6, 13, 'start', 'var(--ink-3)', 600) : '';
    return rect + title;
  }
  const f = fillOf(it.fill, own, 'var(--surface-2)');
  const fo = f.opacity ? ` fill-opacity="${f.opacity}"` : '';
  let body: string;
  if (it.shape === 'ellipse') {
    body = `<ellipse cx="${num(x + w / 2)}" cy="${num(y + h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}" fill="${f.fill}"${fo} stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
  } else if (it.shape === 'diamond') {
    const pts = `${num(x + w / 2)},${num(y)} ${num(x + w)},${num(y + h / 2)} ${num(x + w / 2)},${num(y + h)} ${num(x)},${num(y + h / 2)}`;
    body = `<polygon points="${pts}" fill="${f.fill}"${fo} stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"${dash}/>`;
  } else {
    body = `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="10" fill="${f.fill}"${fo} stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
  }
  if (!it.label) return body;
  const pos = it.labelPos ?? 'center';
  const inner = it.shape === 'diamond' ? w * 0.55 : w - 16;
  const lines = wrap(it.label, pos === 'left' || pos === 'right' ? 160 : inner, px, Math.max(1, Math.floor((h - 8) / (px * 1.3))));
  const th = lines.length * px * 1.3;
  const ink1 = 'var(--ink-1)';
  if (pos === 'top') return body + textBlock(lines, x + w / 2, y - th - 4, px, 'middle', ink1);
  if (pos === 'bottom') return body + textBlock(lines, x + w / 2, y + h + 2, px, 'middle', ink1);
  if (pos === 'left') return body + textBlock(lines, x - 8, y + (h - th) / 2, px, 'start', ink1).replace('text-anchor="start"', 'text-anchor="end"');
  if (pos === 'right') return body + textBlock(lines, x + w + 8, y + (h - th) / 2, px, 'start', ink1);
  return body + textBlock(lines, x + w / 2, y + (h - th) / 2, px, 'middle', ink1);
}

function textSvg(it: BText): string {
  const px = FONT_SIZE_PX[it.fontSize ?? 'md'];
  const color = ink(it.color, it.ownTheme, 'var(--ink-1)');
  if (it.sticky) {
    const w = it.w ?? 180;
    const h = it.h ?? 110;
    const lines = wrap(it.text, w - 20, px, Math.max(1, Math.floor((h - 16) / (px * 1.3))));
    return `<rect x="${num(it.at.x)}" y="${num(it.at.y)}" width="${num(w)}" height="${num(h)}" rx="8" fill="var(--surface-3)" stroke="var(--ink-4)" stroke-width="1"/>` + textBlock(lines, it.at.x + 10, it.at.y + 8, px, 'start', color);
  }
  return textBlock(it.text.split('\n'), it.at.x, it.at.y, px, 'start', color);
}

function noderefSvg(it: BNodeRef): string {
  const lines = wrap(it.label, 140, 14, 2);
  return (
    `<rect x="${num(it.at.x)}" y="${num(it.at.y)}" width="160" height="72" rx="14" fill="var(--surface-2)" stroke="var(--ink-3)" stroke-width="1.5"/>` +
    textBlock(lines, it.at.x + 80, it.at.y + 12, 14, 'middle', 'var(--ink-1)') +
    (it.path ? textBlock(wrap(it.path, 140, 11, 1), it.at.x + 80, it.at.y + 50, 11, 'middle', 'var(--ink-3)') : '')
  );
}

function svgItem(it: BoardItem & { kind: 'svg' }): string {
  const m = /^<svg\b([^>]*)>/.exec(it.svg);
  if (!m) return '';
  const attrs = m[1]!;
  const ow = /\swidth="([\d.]+)(?:px)?"/.exec(attrs)?.[1];
  const oh = /\sheight="([\d.]+)(?:px)?"/.exec(attrs)?.[1];
  let rest = attrs.replace(/\s(?:x|y|width|height)="[^"]*"/g, '');
  if (!/\sviewBox=/.test(rest) && ow && oh) rest += ` viewBox="0 0 ${ow} ${oh}"`;
  return `<svg${rest} x="${num(it.at.x)}" y="${num(it.at.y)}" width="${num(it.w)}" height="${num(it.h)}">${it.svg.slice(m[0].length)}`;
}

function mediaUrl(src: string): string {
  return `/api/media?path=${encodeURIComponent(src).replace(/'/g, '%27')}`;
}

function videoSvg(it: BVideo, uid: string): string {
  const x = it.at.x;
  const y = it.at.y;
  const clip = `${uid}-clip-${hash(it.id)}`;
  let out = '';
  if (it.poster) {
    out += `<clipPath id="${clip}"><rect x="${num(x)}" y="${num(y)}" width="${num(it.w)}" height="${num(it.h)}" rx="10"/></clipPath>`;
    out += `<image href="${mediaUrl(it.poster)}" x="${num(x)}" y="${num(y)}" width="${num(it.w)}" height="${num(it.h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})"/>`;
  }
  out += `<rect x="${num(x)}" y="${num(y)}" width="${num(it.w)}" height="${num(it.h)}" rx="10" fill="${it.poster ? 'none' : 'var(--surface-3)'}" stroke="var(--ink-3)" stroke-width="1.5"/>`;
  const cx = x + it.w / 2;
  const cy = y + it.h / 2 - 8;
  const r = Math.min(22, it.h / 5);
  out += `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="var(--surface-2)" stroke="var(--ink-3)" stroke-width="1.5"/>`;
  out += `<polygon points="${num(cx - r * 0.3)},${num(cy - r * 0.5)} ${num(cx + r * 0.55)},${num(cy)} ${num(cx - r * 0.3)},${num(cy + r * 0.5)}" fill="var(--ink-2)"/>`;
  const name = it.src.split('/').pop() ?? it.src;
  const label = it.label ?? name;
  out += textBlock(wrap(label, it.w - 20, 13, 1), cx, y + it.h - 30, 13, 'middle', 'var(--ink-1)', 600);
  if (it.label) out += textBlock(wrap(name, it.w - 20, 11, 1), cx, y + it.h - 15, 11, 'middle', 'var(--ink-3)');
  return out;
}

function sceneSvg(it: BScene): string {
  const secs = it.duration >= 10_000 ? Math.round(it.duration / 1000) : Math.round(it.duration / 100) / 10;
  const n = it.keyframes.length;
  const caption = `${secs} s · ${n} keyframe${n === 1 ? '' : 's'}`;
  const cx = it.at.x + it.w / 2;
  const cy = it.at.y + it.h / 2 - 8;
  return (
    `<rect x="${num(it.at.x)}" y="${num(it.at.y)}" width="${num(it.w)}" height="${num(it.h)}" rx="10" fill="var(--surface-1)" stroke="var(--ink-3)" stroke-width="1.5" stroke-dasharray="6 4"/>` +
    `<polygon points="${num(cx - 9)},${num(cy - 14)} ${num(cx + 14)},${num(cy)} ${num(cx - 9)},${num(cy + 14)}" fill="var(--ink-3)"/>` +
    textBlock(wrap(it.title ?? 'Scene', it.w - 24, 14, 1), it.at.x + it.w / 2, it.at.y + it.h - 38, 14, 'middle', 'var(--ink-1)', 600) +
    textBlock([caption], it.at.x + it.w / 2, it.at.y + it.h - 20, 11, 'middle', 'var(--ink-3)')
  );
}

/** Render items (in board order) to one SVG with a tight viewBox. Anchored items are skipped. */
export function renderItemsSvg(all: readonly BoardItem[], opts: { title?: string; note?: string } = {}): RenderResult {
  const items = all.filter((i) => !i.anchor);
  const skipped = all.length - items.length;
  const uid = `sq-${hash(items.map((i) => i.id).join('|'))}`;
  const boxes = new Map<string, Box>();
  for (const it of items) {
    const b = boxOf(it);
    if (b) boxes.set(it.id, b);
  }
  const used = new Set<string>();
  const markerId = (kind: string): string => {
    used.add(kind);
    return `${uid}-${kind}`;
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (b: Box, slack: number): void => {
    minX = Math.min(minX, b.x - slack);
    minY = Math.min(minY, b.y - slack);
    maxX = Math.max(maxX, b.x + b.w + slack);
    maxY = Math.max(maxY, b.y + b.h + slack);
  };
  let body = '';
  for (const it of items) {
    const b = boxes.get(it.id);
    if (!b) continue;
    switch (it.kind) {
      case 'shape':
        body += shapeSvg(it, boxes, markerId);
        /* Labels placed outside, and arrow labels, stretch past the box. */
        grow(b, (it.strokeWidth ?? 2) + (it.label ? 24 : 4));
        break;
      case 'stroke':
        body += `<path d="${it.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${num(p.x)} ${num(p.y)}`).join(' ')}" fill="none" stroke="${ink(it.stroke, it.ownTheme, 'var(--ink-1)')}" stroke-width="${num(it.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
        grow(b, it.width);
        break;
      case 'text':
        body += textSvg(it);
        grow(b, 4);
        break;
      case 'noderef':
        body += noderefSvg(it);
        grow(b, 2);
        break;
      case 'svg':
        body += svgItem(it);
        grow(b, 0);
        break;
      case 'video':
        body += videoSvg(it, uid);
        grow(b, 2);
        break;
      case 'scene':
        body += sceneSvg(it);
        grow(b, 2);
        break;
    }
  }
  if (opts.note && Number.isFinite(minX)) {
    body += textBlock([opts.note], minX, maxY + 8, 11, 'start', 'var(--ink-3)');
    maxY += 26;
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 120;
    maxY = 40;
  }
  const x0 = minX - PAD;
  const y0 = minY - PAD;
  const w = Math.max(40, maxX - minX + PAD * 2);
  const h = Math.max(24, maxY - minY + PAD * 2);
  const defs = [...used]
    .sort()
    .map((k) => {
      const shape =
        k === 'dot'
          ? '<circle cx="5" cy="5" r="3.5" fill="context-stroke"/>'
          : k === 'bar'
            ? '<path d="M5 0v10" stroke="context-stroke" stroke-width="2" fill="none"/>'
            : '<path d="M1 1L9 5L1 9z" fill="context-stroke"/>';
      return `<marker id="${uid}-${k}" viewBox="0 0 10 10" refX="${k === 'arrow' ? 8 : 5}" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto-start-reverse">${shape}</marker>`;
    })
    .join('');
  const title = esc(opts.title ?? 'Board drawing');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x0)} ${num(y0)} ${num(w)} ${num(h)}" width="${num(w)}" height="${num(h)}" role="img" aria-label="${title}" style="font-family:var(--font-sans);max-width:100%;height:auto">` +
    `<title>${title}</title>${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
  return { svg, width: Math.round(w), height: Math.round(h), drawn: items.length, skipped };
}

/** Pick the items a render request names: a group, or a list of ids (board order kept). */
export function selectItems(items: readonly BoardItem[], q: { group?: string | null; items?: string | null }): BoardItem[] {
  if (q.group) return items.filter((i) => i.group === q.group);
  if (q.items) {
    const want = new Set(q.items.split(',').map((s) => s.trim()).filter(Boolean));
    return items.filter((i) => want.has(i.id));
  }
  return [];
}
