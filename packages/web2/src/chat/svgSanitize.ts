/* ══════════════════════════════════════════════════════════════════════════
   MAKE AN AGENT'S SVG SAFE TO DRAW INLINE (R10, C5)
   packages/web2/src/chat/svgSanitize.ts

   The agent writes the SVG; the page draws it in the chat. The source is
   parsed as XML and a NEW tree is built from an allowlist:

     - only element nodes (SVG namespace, allowlisted names) and text nodes
       survive. Comments, processing instructions and CDATA are dropped, so
       there is nothing for a serialise-then-HTML-parse round trip to turn
       into live markup;
     - only allowlisted attributes survive. No `on*`, no `style` except a
       declaration-level property allowlist, `href` only as `#local` on
       elements that may reference a sibling;
     - any value with a `url(...)` that is not `url(#id)`, an `image-set`,
       an `@import`, a backslash escape or a `javascript:` scheme is dropped.

   The result is a DOM node, appended by the caller (never innerHTML). The
   `svg` string is a serialisation of the clean tree, for tests and display.
   ══════════════════════════════════════════════════════════════════════════ */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const ELEMENTS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textPath',
  'title', 'desc', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'marker', 'symbol', 'use',
]);

/** SMIL value animation, opt-in (`sanitizeSvg(src, { animate: true })`): never `set`, never `animateMotion`. */
const ANIMATION_ELEMENTS = new Set(['animate', 'animateTransform']);

const ATTRIBUTES = new Set([
  'id', 'class', 'viewBox', 'preserveAspectRatio', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr',
  'd', 'points', 'pathLength', 'transform', 'dx', 'dy', 'rotate', 'textLength', 'lengthAdjust', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'spreadMethod', 'patternUnits', 'patternContentUnits', 'patternTransform', 'clipPathUnits', 'maskUnits', 'maskContentUnits',
  'markerWidth', 'markerHeight', 'markerUnits', 'refX', 'refY', 'orient', 'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'color', 'visibility',
  'display', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift',
  'letter-spacing', 'word-spacing', 'text-decoration', 'writing-mode', 'clip-path', 'mask', 'marker-start', 'marker-mid', 'marker-end', 'vector-effect',
  'shape-rendering', 'text-rendering', 'overflow', 'role', 'aria-label', 'aria-hidden', 'aria-labelledby', 'aria-describedby', 'xml:space', 'startOffset',
  'attributeName', 'attributeType', 'from', 'to', 'by', 'values', 'dur', 'begin', 'end', 'repeatCount', 'repeatDur', 'calcMode', 'keyTimes', 'keySplines', 'additive', 'accumulate', 'type',
]);

const ANIMATION_ONLY = new Set(['attributeName', 'attributeType', 'from', 'to', 'by', 'values', 'dur', 'begin', 'end', 'repeatCount', 'repeatDur', 'calcMode', 'keyTimes', 'keySplines', 'additive', 'accumulate', 'type']);

const STYLE_PROPERTIES = new Set([
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset',
  'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'letter-spacing', 'text-decoration',
  'stop-color', 'stop-opacity', 'display', 'visibility',
]);

export type SvgResult = { ok: true; svg: string; node: SVGElement } | { ok: false; reason: string };

/** A value is clean when every url() points at a local id and nothing scripts or imports. */
export function cleanValue(value: string): boolean {
  if (/[\\\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) return false;
  const squashed = value.replace(/[\s\u0000-\u001f]+/g, '').toLowerCase();
  if (/javascript:|vbscript:|data:|expression\(|@import|image-set|-moz-binding|behavior:|src\(/.test(squashed)) return false;
  if (/(?:https?:)?\/\//.test(squashed)) return false;
  for (const m of value.matchAll(/url\(([^)]*)\)?/gi)) {
    if (!/^\s*(?:'#[\w.:-]+'|"#[\w.:-]+"|#[\w.:-]+)\s*$/.test(m[1] ?? '')) return false;
  }
  return true;
}

/** Keep only allowlisted `property: value` declarations from an inline style. */
export function cleanStyle(style: string): string {
  if (/[\\]|\/\*/.test(style)) return '';
  const out: string[] = [];
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 1) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (STYLE_PROPERTIES.has(prop) && val !== '' && cleanValue(val)) out.push(`${prop}:${val}`);
  }
  return out.join(';');
}

const LOCAL_REF = /^#[A-Za-z_][\w.:-]*$/;

function copyAttributes(from: Element, to: Element): void {
  for (const attr of Array.from(from.attributes)) {
    const local = attr.localName;
    const ns = attr.namespaceURI;
    const value = attr.value;
    if (attr.name === 'xmlns' || attr.prefix === 'xmlns') continue;
    if (local === 'href' && (ns === null || ns === XLINK_NS) && attr.prefix !== 'xml') {
      /* Only <use> and gradient/pattern inheritance, and only to an id in this drawing. */
      if (LOCAL_REF.test(value.trim())) to.setAttribute('href', value.trim());
      continue;
    }
    if (attr.name === 'style') {
      const s = cleanStyle(value);
      if (s) to.setAttribute('style', s);
      continue;
    }
    const name = ns === 'http://www.w3.org/XML/1998/namespace' ? `xml:${local}` : attr.name;
    if (ns !== null && ns !== 'http://www.w3.org/XML/1998/namespace') continue;
    if (!ATTRIBUTES.has(name)) continue;
    if (!cleanValue(value)) continue;
    to.setAttribute(name, value);
  }
}

function rebuild(from: Element, animate: boolean): SVGElement | null {
  const to = document.createElementNS(SVG_NS, from.localName) as SVGElement;
  copyAttributes(from, to);
  if (from.localName === 'use' && !to.hasAttribute('href')) return null;
  /* An animation may only move a drawing attribute: never href, never an event handler or style. */
  if (from.localName.startsWith('animate')) {
    const target = to.getAttribute('attributeName') ?? '';
    if (!ATTRIBUTES.has(target) || ANIMATION_ONLY.has(target)) return null;
  }
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === 3) {
      to.appendChild(document.createTextNode(child.nodeValue ?? ''));
    } else if (child.nodeType === 1) {
      const el = child as Element;
      if (el.namespaceURI === SVG_NS && (ELEMENTS.has(el.localName) || (animate && ANIMATION_ELEMENTS.has(el.localName)))) {
        const kept = rebuild(el, animate);
        if (kept) to.appendChild(kept);
      }
    }
    /* Comments, processing instructions, CDATA and everything else: dropped. */
  }
  return to;
}

/** Parse, rebuild from the allowlist and re-serialise an SVG source. `ok: false` carries a short reason. */
export function sanitizeSvg(source: string, opts: { animate?: boolean } = {}): SvgResult {
  const src = source.trim();
  if (!/^<svg[\s>]/i.test(src)) return { ok: false, reason: 'it does not start with <svg>' };
  if (/<!(?:DOCTYPE|ENTITY)/i.test(src)) return { ok: false, reason: 'it declares a document type' };
  const withNs = /^<svg\b[^>]*\bxmlns\s*=/i.test(src) ? src : src.replace(/^<svg\b/i, `<svg xmlns="${SVG_NS}"`);
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(withNs, 'image/svg+xml');
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'it could not be parsed' };
  }
  const bad = doc.getElementsByTagName('parsererror')[0];
  if (bad) return { ok: false, reason: (bad.textContent ?? 'it could not be parsed').split(/\r?\n/).find((l) => l.trim() && !/^this page contains/i.test(l))?.trim() ?? 'it could not be parsed' };
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) return { ok: false, reason: 'the root is not <svg>' };
  const node = rebuild(root, opts.animate === true)!;
  return { ok: true, node, svg: new XMLSerializer().serializeToString(node) };
}

/* Mermaid's output draws its theme with a <style> and a few filter primitives; the agent's own svg gets neither. */
const MERMAID_ELEMENTS = new Set([
  ...ELEMENTS, 'style', 'filter', 'feDropShadow', 'feGaussianBlur', 'feOffset', 'feColorMatrix', 'feFlood', 'feComposite', 'feMerge', 'feMergeNode', 'feBlend',
]);
const MERMAID_ATTRIBUTES = new Set([
  ...ATTRIBUTES, 'filter', 'stdDeviation', 'in', 'in2', 'result', 'flood-color', 'flood-opacity', 'mode', 'operator', 'values', 'filterUnits', 'type',
  'tabindex', 'focusable', 'xmlns', 'version',
]);

/** A theme stylesheet is kept only when it can fetch nothing: no url() but url(#id), no @import, no escapes. */
export function cleanStyleSheet(css: string): boolean {
  if (/\\|@import|image-set|cross-fade|element\(|expression\(|-moz-binding|behavior\s*:/i.test(css)) return false;
  for (const m of css.matchAll(/url\(\s*([^)]*)\)?/gi)) {
    if (!/^(?:'#[\w.:-]+'|"#[\w.:-]+"|#[\w.:-]+)\s*$/.test((m[1] ?? '').trim())) return false;
  }
  return !/(?:https?:)?\/\/[\w.-]+\.[a-z]/i.test(css.replace(/\/\*[\s\S]*?\*\//g, ''));
}

function rebuildMermaid(from: Element): SVGElement | null {
  const to = document.createElementNS(SVG_NS, from.localName) as SVGElement;
  for (const attr of Array.from(from.attributes)) {
    const name = attr.name;
    const value = attr.value;
    if (/^xmlns/.test(name)) continue;
    if (name === 'href' || name === 'xlink:href') {
      if (LOCAL_REF.test(value.trim())) to.setAttribute('href', value.trim());
      continue;
    }
    if (name === 'style') {
      const st = cleanStyle(value);
      if (st) to.setAttribute('style', st);
      continue;
    }
    if (!(MERMAID_ATTRIBUTES.has(name) || /^(?:data|aria)-[\w-]+$/.test(name))) continue;
    if (!cleanValue(value)) continue;
    to.setAttribute(name, value);
  }
  if (from.localName === 'use' && !to.hasAttribute('href')) return null;
  if (from.localName === 'style') {
    const css = from.textContent ?? '';
    if (!cleanStyleSheet(css)) return null;
    to.appendChild(document.createTextNode(css));
    return to;
  }
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === 3) to.appendChild(document.createTextNode(child.nodeValue ?? ''));
    else if (child.nodeType === 1) {
      const el = child as Element;
      if (el.namespaceURI === SVG_NS && MERMAID_ELEMENTS.has(el.localName)) {
        const kept = rebuildMermaid(el);
        if (kept) to.appendChild(kept);
      }
    }
  }
  return to;
}

/**
 * Mermaid's own output as a node: parsed as HTML, the <svg> taken, and a NEW tree built from
 * an allowlist, like the agent's svg. Its theme <style> survives only when it fetches nothing;
 * image, feImage, foreignObject, a, script and every non-local reference do not survive at all.
 * Mermaid's `securityLevel` is not the boundary: a label or a themeCSS must not cause a request.
 */
export function mermaidNode(markup: string): SVGElement | null {
  const doc = new DOMParser().parseFromString(markup, 'text/html');
  const svg = doc.body.querySelector('svg');
  if (!svg) return null;
  const node = rebuildMermaid(svg);
  return node ? (document.importNode(node, true) as unknown as SVGElement) : null;
}
