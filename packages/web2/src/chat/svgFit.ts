/* Text that fits its box, and labels that stay off borders: renderer-side safety for a hand-written svg drawing.
   packages/web2/src/chat/svgFit.ts

   An agent places text by hand, so a label can run past the box it is meant to sit in, or an arrow label can
   land on a box border. After the drawing is in the page this pass:
     - shrinks text that is wider than its box (down to MIN_FONT), then wraps it by words, then cuts the last
       line with an ellipsis (the whole text stays as a tooltip);
     - moves a label that straddles a box border to the nearest clear spot beside it.
   It only looks at a text and a rect in the same coordinate frame (no transform between them), and never
   touches a background (a rect over half the drawing). The width of the text comes from the browser when it
   has layout, else from a character-width estimate (jsdom, tests). */

export const MIN_FONT = 10;
const PAD = 6;
const LINE = 1.2;
const BAND = 3;
const MAX_NUDGE = 24;

export type Measure = (el: SVGTextElement, size: number, bold: boolean, text: string) => number;

/** Estimated width of `s` in px at `size` (sans, mixed case). */
export function estimateWidth(s: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w += c > 0x2e80 ? 1 : /[A-Z]/.test(ch) ? 0.64 : /[0-9]/.test(ch) ? 0.58 : /[ilj.,:;'|!]/.test(ch) ? 0.3 : /[mwMW]/.test(ch) ? 0.88 : 0.54;
  }
  return w * size * (bold ? 1.06 : 1);
}

const browserMeasure: Measure = (el, size, bold, text) => {
  try {
    const n = (el as SVGTextContentElement).getComputedTextLength?.();
    if (typeof n === 'number' && n > 0 && text === (el.textContent ?? '')) return n * (size / fontSize(el));
  } catch {
    /* no layout */
  }
  return estimateWidth(text, size, bold);
};

const num = (el: Element, name: string): number => {
  const v = parseFloat(el.getAttribute(name) ?? '');
  return Number.isFinite(v) ? v : 0;
};

function styleProp(el: Element, name: string): string | null {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(el.getAttribute('style') ?? '');
  return m ? m[1]!.trim() : null;
}

function fontSize(el: Element): number {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const v = parseFloat(styleProp(n, 'font-size') ?? n.getAttribute('font-size') ?? '');
    if (v > 0) return v;
  }
  return 16;
}

const isBold = (el: Element): boolean => /^(bold|[6-9]00)$/i.test((styleProp(el, 'font-weight') ?? el.getAttribute('font-weight') ?? '').trim());

/** text-anchor is inherited: the nearest element (the text, or a group above it) that sets it decides, as with fontSize. */
function anchorOf(el: Element): 'start' | 'middle' | 'end' {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const a = (styleProp(n, 'text-anchor') ?? n.getAttribute('text-anchor') ?? '').trim();
    if (a === 'middle' || a === 'end' || a === 'start') return a;
  }
  return 'start';
}

/** The nearest ancestor that moves its children (a transform), or the svg itself: two things compare only inside one frame. */
function frameOf(el: Element): Element {
  for (let n = el.parentElement; n; n = n.parentElement) if (n.hasAttribute('transform') || n.localName === 'svg') return n;
  return el;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function viewArea(svg: SVGSVGElement): number {
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0) return vb[2]! * vb[3]!;
  return num(svg, 'width') * num(svg, 'height');
}

function extent(x: number, w: number, anchor: string): [number, number] {
  return anchor === 'middle' ? [x - w / 2, x + w / 2] : anchor === 'end' ? [x - w, x] : [x, x + w];
}

/** Break `words` into lines of at most `max` px (a single longer word stays on its own line). */
export function wrapWords(words: string[], max: number, width: (s: string) => number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && width(next) > max) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function ellipsize(s: string, max: number, width: (s: string) => number): string {
  if (width(s) <= max) return s;
  let out = '';
  for (const ch of s) {
    if (width(`${out}${ch}…`) > max) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

function setLines(el: SVGTextElement, lines: string[], x: number, whole: string, cut: boolean): void {
  const ns = el.namespaceURI;
  el.textContent = '';
  lines.forEach((ln, i) => {
    const t = el.ownerDocument.createElementNS(ns, 'tspan');
    t.setAttribute('x', String(x));
    t.setAttribute('dy', i === 0 ? `${(-(lines.length - 1) * LINE) / 2}em` : `${LINE}em`);
    t.textContent = ln;
    el.appendChild(t);
  });
  if (cut) {
    const tip = el.ownerDocument.createElementNS(ns, 'title');
    tip.textContent = whole;
    el.appendChild(tip);
  }
}

/** `source` with the fit pass applied (no layout needed: widths are estimated), for a preview that shows the raw source. The source itself is not changed; a drawing that does not parse comes back as it was. */
export function fittedSvg(source: string): string {
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') return source;
  try {
    const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.localName !== 'svg' || doc.querySelector('parsererror')) return source;
    const r = fitSvgText(svg as unknown as SVGSVGElement, (_el, size, bold, text) => estimateWidth(text, size, bold));
    return r.shrunk + r.wrapped + r.cut + r.moved === 0 ? source : new XMLSerializer().serializeToString(svg);
  } catch {
    return source;
  }
}

export interface FitReport {
  shrunk: number;
  wrapped: number;
  cut: number;
  moved: number;
}

/** Fit every text to its box and move every label off borders. Returns what it changed (all zero for a drawing that was fine). */
export function fitSvgText(svg: SVGSVGElement, measure: Measure = browserMeasure): FitReport {
  const report: FitReport = { shrunk: 0, wrapped: 0, cut: 0, moved: 0 };
  const area = viewArea(svg);
  const rects: { el: Element; box: Box; frame: Element }[] = [];
  for (const r of Array.from(svg.querySelectorAll('rect'))) {
    const box = { x: num(r, 'x'), y: num(r, 'y'), w: num(r, 'width'), h: num(r, 'height') };
    if (!(box.w > 0 && box.h > 0)) continue;
    if (area > 0 && box.w * box.h > area * 0.5) continue; // a background
    if (r.closest('defs, marker, pattern, clipPath, mask')) continue;
    rects.push({ el: r, box, frame: frameOf(r) });
  }
  if (rects.length === 0) return report;

  for (const t of Array.from(svg.querySelectorAll('text'))) {
    if (t.children.length > 0 && Array.from(t.children).some((c) => c.localName !== 'title')) continue; // the author laid its lines out
    const whole = (t.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (whole === '' || t.closest('defs, marker')) continue;
    const text = t as SVGTextElement;
    const fs = fontSize(t);
    const bold = isBold(t);
    const anchor = anchorOf(t);
    const x = num(t, 'x');
    const y = num(t, 'y');
    const frame = frameOf(t);
    const w = measure(text, fs, bold, whole);
    const [x0, x1] = extent(x, w, anchor);
    const midY = y - fs * 0.32;
    const mine = rects.filter((r) => r.frame === frame);
    const holders = mine.filter((r) => x >= r.box.x - 1 && x <= r.box.x + r.box.w + 1 && midY >= r.box.y && midY <= r.box.y + r.box.h);
    const home = holders.sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];

    if (home) {
      const b = home.box;
      const avail = anchor === 'middle' ? 2 * Math.min(x - b.x, b.x + b.w - x) - 2 * PAD : anchor === 'end' ? x - b.x - PAD : b.x + b.w - x - PAD;
      if (w <= avail || avail <= 0) continue;
      let size = Math.max(MIN_FONT, Math.floor(fs * (avail / w) * 2) / 2);
      if (size < fs && measure(text, size, bold, whole) <= avail && size >= Math.min(fs, 11)) {
        t.setAttribute('font-size', String(size));
        if (t.hasAttribute('style')) t.setAttribute('style', (t.getAttribute('style') ?? '').replace(/font-size\s*:[^;]+;?/i, ''));
        report.shrunk += 1;
        continue;
      }
      /* Wrap: words on lines at the smaller of the font and 11px, as many lines as the box is tall. */
      size = Math.max(MIN_FONT, Math.min(fs, 11));
      const wd = (s: string): number => measure(text, size, bold, s);
      let lines = wrapWords(whole.split(' '), avail, wd);
      const room = (s: number): number => Math.max(1, Math.floor((b.h - 4) / (s * LINE)));
      if (lines.length > room(size)) {
        size = MIN_FONT;
        lines = wrapWords(whole.split(' '), avail, wd);
      }
      const maxLines = room(size);
      let cut = false;
      if (lines.length > maxLines) {
        cut = true;
        lines = lines.slice(0, maxLines);
        lines[lines.length - 1] = `${lines[lines.length - 1]!}…`;
      }
      lines = lines.map((ln) => {
        if (wd(ln) <= avail) return ln;
        cut = true;
        return ellipsize(ln, avail, wd);
      });
      if (cut) report.cut += 1;
      else report.wrapped += 1;
      t.setAttribute('font-size', String(size));
      if (t.hasAttribute('style')) t.setAttribute('style', (t.getAttribute('style') ?? '').replace(/font-size\s*:[^;]+;?/i, ''));
      setLines(text, lines, x, whole, cut);
      continue;
    }

    /* A label outside every box that straddles a border: step it to the nearest clear spot. */
    const bx0 = x0;
    const bx1 = x1;
    const by0 = y - fs * 0.85;
    const by1 = y + fs * 0.25;
    for (const r of mine) {
      const b = r.box;
      const overlaps = bx0 < b.x + b.w + 1 && bx1 > b.x - 1 && by0 < b.y + b.h + 1 && by1 > b.y - 1;
      if (!overlaps) continue;
      const moves: { dx: number; dy: number }[] = [
        { dx: 0, dy: -(by1 - b.y + BAND) },
        { dx: 0, dy: b.y + b.h - by0 + BAND },
        { dx: -(bx1 - b.x + BAND), dy: 0 },
        { dx: b.x + b.w - bx0 + BAND, dy: 0 },
      ].filter((m) => Math.abs(m.dx) + Math.abs(m.dy) <= MAX_NUDGE);
      moves.sort((a, c) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(c.dx) + Math.abs(c.dy)));
      const mv = moves[0];
      if (!mv) continue;
      t.setAttribute('x', String(Math.round((x + mv.dx) * 10) / 10));
      t.setAttribute('y', String(Math.round((y + mv.dy) * 10) / 10));
      report.moved += 1;
      break;
    }
  }
  return report;
}
