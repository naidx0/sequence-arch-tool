/**
 * Strict allow-list sanitizer for an SVG an agent hosts on a board (the `svg`
 * item). The stored markup is the REBUILT output of this function, never the
 * agent's text: every element and attribute must be on a list below or it is
 * dropped (and named in `removed`). No dependency; a tokenizer, not a browser.
 *
 * Refused outright (throws SvgError): over {@link SVG_MAX_BYTES}, no <svg>
 * root, a DOCTYPE/ENTITY declaration, markup that leaves nothing behind.
 * Dropped with their content: script, foreignObject, animate*, set, a, iframe
 * and any other element not listed. Dropped attributes: on* handlers, any
 * href that is not #fragment (or, on <image>, data:image/png|jpeg|webp),
 * any url(...) that is not url(#fragment), javascript:/expression( values.
 * <style> ELEMENTS are always dropped: a stylesheet inside an inline SVG is
 * document-global and would restyle the whole app. Styling is by attributes
 * (and a style attribute that passes cssOk). Every id, and every reference to
 * one (#frag, url(#frag), aria-labelledby), gets a per-item prefix so two
 * hosted SVGs (or the app) can never collide on an id.
 * expression( or behavior.
 *
 * Theme: the stored SVG should use `currentColor` or `var(--ink-1)` style
 * custom properties so the renderer, which inlines it, follows light/dark.
 */

export const SVG_MAX_BYTES = 256 * 1024;

export class SvgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SvgError';
  }
}

const ELEMENTS = [
  'svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath',
  'title', 'desc', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker', 'symbol', 'use',
  'image', 'filter', 'feGaussianBlur', 'feOffset', 'feColorMatrix', 'feBlend', 'feMerge', 'feMergeNode',
  'feFlood', 'feComposite', 'feDropShadow',
];
const ELEMENT_BY_LOWER = new Map(ELEMENTS.map((e) => [e.toLowerCase(), e]));

const ATTRS = [
  'id', 'class', 'style', 'viewBox', 'xmlns', 'xmlns:xlink', 'version', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'd', 'points', 'transform', 'fill', 'stroke', 'stroke-width', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'stroke-miterlimit', 'fill-opacity',
  'fill-rule', 'clip-rule', 'clip-path', 'mask', 'opacity', 'color', 'display', 'visibility', 'vector-effect',
  'marker-start', 'marker-mid', 'marker-end', 'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'orient',
  'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline',
  'letter-spacing', 'text-decoration', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'startOffset', 'offset',
  'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits',
  'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'preserveAspectRatio',
  'href', 'xlink:href', 'filter', 'stdDeviation', 'in', 'in2', 'result', 'values', 'type', 'mode', 'operator',
  'flood-color', 'flood-opacity', 'dx', 'dy', 'role', 'aria-label', 'aria-hidden', 'aria-labelledby', 'xml:space',
  'k1', 'k2', 'k3', 'k4',
];
const ATTR_BY_LOWER = new Map(ATTRS.map((a) => [a.toLowerCase(), a]));

/** Elements whose whole subtree is dropped (their text would otherwise leak into the output). */
const DROP_WITH_CONTENT = new Set(['style', 'script', 'foreignobject', 'iframe', 'object', 'embed', 'animate', 'animatetransform', 'animatemotion', 'set', 'a', 'handler', 'audio', 'video', 'canvas']);

const BACKSLASH = String.fromCharCode(92);

function decode(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&(?:tab|newline);/gi, '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}
function safeChar(n: number): string {
  try {
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  } catch {
    return '';
  }
}
const esc = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escText = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Normalise for scheme checks: no whitespace/control/invisible characters, lower case. */
const INVISIBLE = new RegExp('[' + [[0, 32], [127, 159], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]].map(([x, y]) => String.fromCharCode(x!) + '-' + String.fromCharCode(y!)).join('') + ']+', 'g');
const flat = (v: string): string => v.replace(INVISIBLE, '').toLowerCase();

/** A value with a url(...) is fine only when every url() is a #fragment. */
function urlsAreLocal(v: string): boolean {
  const f = flat(v);
  if (!f.includes('url(')) return true;
  const all = f.match(/url\(/g)?.length ?? 0;
  const local = f.match(/url\((?:["'])?#[a-z0-9_.:~-]+(?:["'])?\)/g)?.length ?? 0;
  return all === local;
}

function valueOk(name: string, value: string): boolean {
  const f = flat(value);
  if (value.includes(BACKSLASH) || f.includes('image-set(') || f.includes('src(')) return false;
  if (f.includes('javascript:') || f.includes('vbscript:') || f.includes('expression(') || f.includes('behavior:') || f.includes('-moz-binding')) return false;
  if (f.includes('@import')) return false;
  if (name === 'href' || name === 'xlink:href') return true; // checked per element by the caller
  return urlsAreLocal(value);
}

function hrefOk(el: string, value: string): boolean {
  const v = value.trim();
  if (v.startsWith('#')) return v.length > 1;
  if (el === 'image') return /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(v) && !/^data:image\/svg/i.test(v);
  return false;
}

function cssOk(css: string): boolean {
  const f = flat(css);
  /* CSS escapes can spell any keyword; image-set() and src() fetch like url(). */
  if (css.includes(BACKSLASH) || f.includes('image-set(') || f.includes('src(') || f.includes('-webkit-image-set(')) return false;
  if (f.includes('@import') || f.includes('expression(') || f.includes('behavior:') || f.includes('-moz-binding') || f.includes('javascript:')) return false;
  return urlsAreLocal(css);
}

export interface SanitizedSvg {
  svg: string;
  /** What was dropped, one short reason each (deduplicated). */
  removed: string[];
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!([a-z]+)[^>]*>|<(\/?)([a-zA-Z][a-zA-Z0-9:._-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</gi;
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export function sanitizeSvg(input: unknown, opts: { idPrefix?: string } = {}): SanitizedSvg {
  const prefix = opts.idPrefix ?? '';
  /* Idempotent: a stored item is validated again on every read, and must not be prefixed twice. */
  const pid = (id: string): string => (prefix && !id.startsWith(prefix) ? prefix + id : id);
  const rewriteRefs = (v: string): string => v.replace(/url\(\s*(["']?)#([a-zA-Z0-9_.:~-]+)\1\s*\)/g, (_m, q: string, id: string) => `url(${q}#${pid(id)}${q})`);
  if (typeof input !== 'string') throw new SvgError('svg must be a string of SVG markup');
  if (Buffer.byteLength(input, 'utf8') > SVG_MAX_BYTES) throw new SvgError(`svg is larger than ${SVG_MAX_BYTES / 1024}KB`);
  if (!/<svg[\s>/]/i.test(input)) throw new SvgError('svg must contain an <svg> root element');
  const removed = new Set<string>();
  const out: string[] = [];
  const stack: string[] = [];
  let dropDepth = 0;
  let dropTag = '';
  let sawRoot = false;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(input))) {
    const tok = m[0];
    if (m[2]) {
      const kind = m[2].toLowerCase();
      if (kind === 'doctype' || kind === 'entity') throw new SvgError('DOCTYPE and ENTITY declarations are not allowed in svg');
      continue;
    }
    const rawName = m[4];
    if (!rawName) {
      if (dropDepth > 0) continue;
      if (m[1] !== undefined) {
        if (stack.length) out.push(escText(m[1]));
        continue;
      }
      if (tok.startsWith('<!--') || tok.startsWith('<?') || tok === '<') continue;
      if (stack.length) out.push(escText(decode(tok)));
      continue;
    }
    const lower = rawName.toLowerCase();
    const closing = m[3] === '/';
    const selfClosing = /\/\s*$/.test(m[5] ?? '');
    if (dropDepth > 0) {
      if (lower === dropTag) {
        if (closing) dropDepth -= 1;
        else if (!selfClosing) dropDepth += 1;
      }
      continue;
    }
    if (DROP_WITH_CONTENT.has(lower)) {
      removed.add(`<${lower}> element`);
      if (!closing && !selfClosing) {
        dropDepth = 1;
        dropTag = lower;
      }
      continue;
    }
    const name = ELEMENT_BY_LOWER.get(lower);
    if (!name) {
      removed.add(`<${lower}> element`);
      continue;
    }
    if (closing) {
      const at = stack.lastIndexOf(name);
      if (at === -1) continue;
      while (stack.length > at + 1) out.push(`</${stack.pop()}>`);
      stack.pop();
      out.push(`</${name}>`);
      continue;
    }
    if (!sawRoot) {
      if (name !== 'svg') continue;
      sawRoot = true;
    } else if (stack.length === 0) {
      continue; // content after the root closed
    }
    const attrs: string[] = [];
    const seen = new Set<string>();
    ATTR_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    const attrText = m[5] ?? '';
    while ((a = ATTR_RE.exec(attrText))) {
      const aname = a[1]!;
      const alow = aname.toLowerCase();
      if (alow === '/') continue;
      const raw = a[2] ?? a[3] ?? a[4] ?? '';
      if (alow.startsWith('on')) {
        removed.add(`${alow} event handler`);
        continue;
      }
      const canon = ATTR_BY_LOWER.get(alow);
      if (!canon) {
        removed.add(`${alow} attribute`);
        continue;
      }
      if (seen.has(canon)) continue;
      const value = decode(raw);
      if (!valueOk(canon, value)) {
        removed.add(`${canon} with a script or external url`);
        continue;
      }
      if ((canon === 'href' || canon === 'xlink:href') && !hrefOk(name, value)) {
        removed.add('external or script href (only #fragment, or data:image png/jpeg/webp on <image>)');
        continue;
      }
      if (canon === 'style' && !cssOk(value)) {
        removed.add('style attribute with url() or script');
        continue;
      }
      seen.add(canon);
      let written = value;
      if (prefix) {
        if (canon === 'id') written = pid(value);
        else if ((canon === 'href' || canon === 'xlink:href') && value.trim().startsWith('#')) written = '#' + pid(value.trim().slice(1));
        else if (canon === 'aria-labelledby') written = value.split(/\s+/).filter(Boolean).map(pid).join(' ');
        else written = rewriteRefs(value);
      }
      attrs.push(` ${canon}="${esc(written)}"`);
    }
    if (name === 'svg' && stack.length === 0 && !seen.has('xmlns')) attrs.unshift(' xmlns="http://www.w3.org/2000/svg"');
    const isSelf = selfClosing;
    out.push(`<${name}${attrs.join('')}${isSelf ? '/>' : '>'}`);
    if (!isSelf) stack.push(name);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  if (!sawRoot) throw new SvgError('svg must contain an <svg> root element');
  const svg = out.join('');
  if (Buffer.byteLength(svg, 'utf8') > SVG_MAX_BYTES) throw new SvgError(`svg is larger than ${SVG_MAX_BYTES / 1024}KB`);
  return { svg, removed: [...removed] };
}
