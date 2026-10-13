/*
 * INLINE ART FOLLOWS THE APP (owner, 2026-10-12): "set guidelines and rules for
 * the inline svg and edit creation to make sure it follows our app theme, our
 * app button theme, our app colors, our app font ... so it doesn't look like a
 * random drawing from nowhere."
 *
 * Runs on the sanitized node (svgSanitize.ts), before it is drawn in the chat.
 * The rules are written out in INLINE-ART-RULES.md and given to the model in
 * the canvas craft section (analyzer askPipeline.ts); this is the net under
 * them for a drawing that ignored them. It only fills what was left unset or
 * named by a theme word; a colour the agent chose on purpose stays.
 *
 *   Font      every label is the app font (`--font-sans`, or `--font-mono` when
 *             the agent asked for a monospace face). Opt out with class
 *             `own-fonts` on the root: a drawing OF a user's project that has
 *             its own fonts.
 *   Colour    theme words (accent, ink, muted, surface, border, success,
 *             warning, danger, info), `black` and `currentColor` become the
 *             app tokens; `white` on a shape becomes the surface. Unset shape
 *             fills become the surface with an edge; unset text becomes ink.
 *   Buttons   a rect with class `btn` is the soft button (surface + edge);
 *             `btn primary` is the solid one, its label on-solid. Existing
 *             button looks only; no new kind.
 *
 * PURE over a DOM node. No React.
 */

const SHAPES = new Set(['rect', 'circle', 'ellipse', 'polygon', 'path']);
const TEXTS = new Set(['text', 'tspan', 'textPath']);
const COLOR_PROPS = ['fill', 'stroke', 'stop-color', 'color'] as const;

/** Theme words the model is told it may use, and the app token each means. */
export const THEME_COLOR_WORDS: Readonly<Record<string, string>> = {
  primary: 'var(--accent)',
  accent: 'var(--accent)',
  ink: 'var(--ink-1)',
  text: 'var(--ink-1)',
  foreground: 'var(--ink-1)',
  muted: 'var(--ink-3)',
  surface: 'var(--surface-1)',
  card: 'var(--surface-1)',
  panel: 'var(--surface-1)',
  background: 'var(--surface-2)',
  bg: 'var(--surface-2)',
  border: 'var(--edge-strong)',
  edge: 'var(--edge-strong)',
  success: 'var(--fits)',
  warning: 'var(--spills)',
  danger: 'var(--wont)',
  error: 'var(--wont)',
  info: 'var(--info)',
};

/* Black and white in any spelling, read off the digits so no colour literal lives outside the tokens. */
function rgbDigits(v: string): string | null {
  const hex = /^#([0-9a-f]+)$/i.exec(v)?.[1];
  if (!hex || ![3, 4, 6, 8].includes(hex.length)) return null;
  return hex.slice(0, hex.length <= 4 ? 3 : 6);
}
function isBlack(v: string): boolean {
  if (/^(?:black|currentcolor)$/i.test(v)) return true;
  if (/^rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)$/i.test(v)) return true;
  const d = rgbDigits(v);
  return d !== null && /^0+$/.test(d);
}
function isWhite(v: string): boolean {
  if (/^white$/i.test(v)) return true;
  if (/^rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)$/i.test(v)) return true;
  const d = rgbDigits(v);
  return d !== null && /^f+$/i.test(d);
}

function readStyle(el: Element): Map<string, string> {
  const out = new Map<string, string>();
  for (const decl of (el.getAttribute('style') ?? '').split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) out.set(decl.slice(0, i).trim().toLowerCase(), decl.slice(i + 1).trim());
  }
  return out;
}

function writeStyle(el: Element, style: Map<string, string>): void {
  const text = Array.from(style, ([k, v]) => `${k}:${v}`).join(';');
  if (text) el.setAttribute('style', text);
  else el.removeAttribute('style');
}

/** The value a property has on this element: its style, else its attribute. */
function own(el: Element, prop: string, style = readStyle(el)): string | null {
  return style.get(prop) ?? el.getAttribute(prop);
}

/** The nearest ancestor (inside the svg) that sets the property, so an inherited colour counts as set. */
function inherited(el: Element, prop: string): string | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const v = own(p, prop);
    if (v !== null) return v;
  }
  return null;
}

function setProp(el: Element, prop: string, value: string): void {
  const style = readStyle(el);
  style.set(prop, value);
  el.removeAttribute(prop);
  writeStyle(el, style);
}

function mapColour(value: string, role: 'text' | 'shape'): string | null {
  const v = value.trim();
  const word = THEME_COLOR_WORDS[v.toLowerCase()];
  if (word) return word;
  if (isBlack(v)) return 'var(--ink-1)';
  if (isWhite(v) && role === 'shape') return 'var(--surface-1)';
  return null;
}

const hasClass = (el: Element, name: string): boolean => (el.getAttribute('class') ?? '').split(/\s+/).includes(name);
const inside = (el: Element, tag: string): boolean => {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.localName === tag) return true;
  return false;
};

export function themeSvg(root: Element): void {
  const ownFonts = hasClass(root, 'own-fonts');
  const all = [root, ...Array.from(root.querySelectorAll('*'))];

  for (const el of all) {
    const tag = el.localName;
    const isText = TEXTS.has(tag);

    /* Colour words and black/white → the app's tokens. */
    for (const prop of COLOR_PROPS) {
      const style = readStyle(el);
      const v = own(el, prop, style);
      if (v === null) continue;
      const mapped = mapColour(v, isText ? 'text' : 'shape');
      if (mapped) setProp(el, prop, mapped);
    }

    /* The app font on every label; a monospace ask keeps being monospace. */
    if (!ownFonts) {
      /* Any element that names a face (a <g> that sets it for its labels too), plus the root and every label. */
      const style = readStyle(el);
      const face = own(el, 'font-family', style);
      if (face !== null || tag === 'svg') {
        const mono = face !== null && /mono|courier|consolas|menlo/i.test(face);
        setProp(el, 'font-family', mono ? 'var(--font-mono)' : 'var(--font-sans)');
      }
    }

    /* Buttons: the soft one and the solid one, nothing else. */
    if (tag === 'rect' && hasClass(el, 'btn')) {
      const primary = hasClass(el, 'primary');
      const style = readStyle(el);
      if (own(el, 'fill', style) === null) style.set('fill', primary ? 'var(--accent-solid)' : 'var(--surface-2)');
      if (own(el, 'stroke', style) === null) style.set('stroke', primary ? 'none' : 'var(--edge-strong)');
      el.removeAttribute('fill');
      el.removeAttribute('stroke');
      writeStyle(el, style);
      if (!el.hasAttribute('rx')) el.setAttribute('rx', '8');
      continue;
    }

    /* Unset fills: text is the ink, a shape is a surface with an edge, an arrowhead follows its line. */
    if (isText) {
      if (own(el, 'fill') === null && inherited(el, 'fill') === null) setProp(el, 'fill', 'var(--ink-1)');
    } else if (SHAPES.has(tag) && inside(el, 'marker')) {
      if (own(el, 'fill') === null) setProp(el, 'fill', 'var(--ink-2)');
    } else if (SHAPES.has(tag) && !inside(el, 'defs') && !inside(el, 'clipPath') && !inside(el, 'mask')) {
      if (own(el, 'fill') === null && inherited(el, 'fill') === null) {
        setProp(el, 'fill', 'var(--surface-1)');
        if (own(el, 'stroke') === null && inherited(el, 'stroke') === null) setProp(el, 'stroke', 'var(--edge-strong)');
      }
    }
  }

  /* A label on a solid button reads on the solid fill. */
  for (const btn of Array.from(root.querySelectorAll('rect.btn.primary'))) {
    const g = btn.parentElement;
    if (!g) continue;
    for (const t of Array.from(g.querySelectorAll('text, tspan'))) {
      const style = readStyle(t);
      if (style.get('fill') === 'var(--ink-1)' && !t.hasAttribute('data-keep')) {
        style.set('fill', 'var(--accent-on-solid)');
        writeStyle(t, style);
      }
    }
  }
}
