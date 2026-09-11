import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { substituteVars } from '../../test/support/css';

import './graphite.css';

/**
 * ITEM 2.2 — THE LOCK ON THE TOKEN LAYER.
 *
 * Asserted against the RENDERED CASCADE, not against the source of a
 * stylesheet. §4.6 of docs/research/v2-architecture-and-gaps.md bans the
 * readFileSync-and-grep tier outright, and item 0.1's test states the reason in
 * one line: a grep for a value in a .css file passes whether or not the rule
 * ever reaches an element. Everything below reads `document.styleSheets` (the
 * parsed CSSOM, i.e. what the browser built) or `getComputedStyle` (what the
 * cascade resolved). One assertion — and exactly one — opens the file, and it
 * says why at its own site.
 *
 * FOUR THINGS ARE LOCKED HERE.
 *
 *   1. THREE-STATE THEMING (GRAPHITE-DECISIONS.md Decision 1). Every token
 *      resolves on bare `:root`, and every token resolves under
 *      `[data-theme="dark"]`. The two dark blocks — the media query and the
 *      attribute selector — are written twice by necessity, and the header of
 *      graphite.css says they are "edited together or not at all". That
 *      sentence is enforced here as a property-by-property equality, because a
 *      promise in a comment is not a mechanism.
 *
 *   2. DECISION 2 — KINDS WITHOUT HUE. No colour token in the `--arch-*`
 *      namespace. Checked twice, structurally and by measurement: an `--arch-*`
 *      value may not contain a literal colour and may only reference the
 *      neutral allowlist, AND every colour it resolves to must measure below 8%
 *      saturation in BOTH themes. The second check is the one that cannot be
 *      gamed by a name.
 *
 *   3. THE GREYSCALE INVARIANT, FROM THE RADII THAT ACTUALLY PAINT.
 *      docs/brand/graphite/pages/03-node-kinds-without-hue.html §03.4:
 *      "Every architecture node kind must remain distinguishable with all
 *      colour removed, at every size the silhouette is drawn, from the radii
 *      that actually paint."
 *
 *      THE LAST CLAUSE IS THE WHOLE TEST. CSS computes ONE scale factor for the
 *      box — f = min over the four sides of (side length / sum of the radii on
 *      that side) — and multiplies every corner by it. So a token list can
 *      declare six silhouettes while the renderer paints four. The book's own
 *      first draft proved this invariant against DECLARED values and passed
 *      while being wrong: on the 26x18 legend chip it used to draw,
 *      `--r-14`, `--r-18` and `--r-full` all land on 9px, and service, module
 *      and topic rendered as one shape.
 *
 *      So `paintedRadii()` below reimplements the scale factor, is itself
 *      pinned against the seven rows of §03.4's printed table before it is
 *      trusted, and the invariant is then evaluated at the two sizes the design
 *      actually draws a silhouette: the card (--arch-card-w x
 *      --arch-card-min-h) and the legend swatch (half a card, §03.3).
 *
 *   4. THE EXTENSIONS PAY FOR THEMSELVES. §5.6 lists eleven surfaces the book
 *      does not cover. Their tokens may introduce geometry, and may alias
 *      something that already resolves — they may NOT introduce a hue. Every
 *      colour in an extension namespace is a var() reference and never a
 *      literal.
 */

/* ────────────────────────────────────────────────────────────────────────────
   THE CSSOM — the parsed sheet, as the browser built it.
   ──────────────────────────────────────────────────────────────────────────── */

interface Block {
  /** The selector, or `@media <condition> :root…` for a nested rule. */
  label: string;
  selector: string;
  media: string | null;
  /** Declared custom properties, in source order. */
  props: Map<string, string>;
}

/**
 * The declared custom properties of one rule.
 *
 * Indexed access rather than `style.item(i)`: jsdom's cssstyle exposes the
 * property names as numeric keys but does not implement `item()` on every
 * declaration object it builds — a `CSSFontFaceRule`'s style throws
 * "style.item is not a function" — and this sheet begins with fourteen
 * @font-face rules.
 */
function customProps(style: CSSStyleDeclaration): Map<string, string> {
  const out = new Map<string, string>();
  const indexed = style as unknown as Record<number, string | undefined>;
  for (let i = 0; i < style.length; i += 1) {
    const name = indexed[i];
    if (name && name.startsWith('--')) out.set(name, style.getPropertyValue(name).trim());
  }
  return out;
}

function collectBlocks(): Block[] {
  const blocks: Block[] = [];

  const walk = (rules: CSSRuleList, media: string | null): void => {
    for (const rule of Array.from(rules)) {
      const asGroup = rule as CSSMediaRule;
      if (asGroup.cssRules) {
        walk(asGroup.cssRules, asGroup.conditionText ?? String(asGroup.media ?? ''));
        continue;
      }
      const asStyle = rule as CSSStyleRule;
      if (!asStyle.selectorText || !asStyle.style) continue;
      const props = customProps(asStyle.style);
      if (props.size === 0) continue;
      blocks.push({
        label: media ? `@media ${media} { ${asStyle.selectorText} }` : asStyle.selectorText,
        selector: asStyle.selectorText,
        media,
        props,
      });
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules, null);
    } catch {
      /* a sheet we cannot read is a sheet that declares nothing here */
    }
  }
  return blocks;
}

const BLOCKS = collectBlocks();

const LIGHT_BLOCKS = BLOCKS.filter((b) => b.media === null && b.selector.trim() === ':root');
const MEDIA_DARK = BLOCKS.filter((b) => b.media !== null && /prefers-color-scheme/.test(b.media));
const ATTR_DARK = BLOCKS.filter((b) => b.media === null && b.selector.includes('data-theme="dark"'));

/** Every custom property declared anywhere in the sheet. */
const ALL_NAMES = [...new Set(BLOCKS.flatMap((b) => [...b.props.keys()]))].sort();

function mergedProps(blocks: Block[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const block of blocks) for (const [k, v] of block.props) out.set(k, v);
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
   RESOLUTION — the cascade, in each of the two states jsdom can host.
   jsdom evaluates `prefers-color-scheme` as light, so the media block is
   unreachable by computed style. It is checked structurally instead, against
   the attribute block that IS reachable.
   ──────────────────────────────────────────────────────────────────────────── */

const root = document.documentElement;

function inTheme<T>(theme: 'light' | 'dark', fn: () => T): T {
  if (theme === 'dark') root.setAttribute('data-theme', 'dark');
  else root.setAttribute('data-theme', 'light');
  try {
    return fn();
  } finally {
    root.removeAttribute('data-theme');
  }
}

/** The declared value of a token in the live cascade — jsdom returns it
 *  un-substituted, which is what `substituteVars` exists to finish. */
const declared = (name: string): string =>
  getComputedStyle(root).getPropertyValue(name).trim();

const resolve = (name: string): string => substituteVars(declared(name), root);

/* ────────────────────────────────────────────────────────────────────────────
   COLOUR — parse enough to measure saturation. Nothing here compares against a
   literal; the firewall forbids a hex outside the token sheet, and a test that
   restates an expected colour is a second source of truth anyway.
   ──────────────────────────────────────────────────────────────────────────── */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseColour(value: string): Rgb | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text);
  if (hex) {
    const digits = hex[1];
    const wide = digits.length >= 6;
    const step = wide ? 2 : 1;
    const at = (i: number): number => {
      const slice = digits.slice(i * step, i * step + step);
      const n = parseInt(wide ? slice : slice + slice, 16);
      return Number.isNaN(n) ? 0 : n;
    };
    return { r: at(0), g: at(1), b: at(2) };
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => !Number.isNaN(n))) {
      return { r: parts[0], g: parts[1], b: parts[2] };
    }
  }
  return null;
}

/**
 * CHROMA — (max - min) / 255. How far from grey, on an absolute scale.
 *
 * NOT HSL saturation, and the difference decides whether this test works at
 * all. HSL saturation divides by lightness, so it blows up near white and near
 * black: Graphite's `--surface-1` in light is one unit off pure grey and
 * measures 0.004 chroma, but 0.14 HSL saturation — high enough to fail a
 * threshold that every real hue also fails, which would leave the ceiling with
 * nowhere to sit. Chroma separates cleanly: every neutral in this sheet
 * measures at or below 0.035, and every hue in the budget measures at or above
 * 0.40. The ceiling sits in a gap an order of magnitude wide and is not a
 * number anyone has to tune.
 */
function chroma({ r, g, b }: Rgb): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

const GREY_CEILING = 0.06;

/* ────────────────────────────────────────────────────────────────────────────
   THE PAINT FUNCTION — f = min(side / sum of radii on that side), over four
   sides, capped at 1. Sheet 03 §03.4.
   ──────────────────────────────────────────────────────────────────────────── */

type Corners = [number, number, number, number]; // tl tr br bl

interface Painted {
  h: Corners;
  v: Corners;
}

/** Expand a 1-4 value CSS corner list to [tl, tr, br, bl]. */
function expand(values: number[]): Corners {
  const [a, b = a, c = a, d = b] = values;
  return [a, b, c, d];
}

function lengths(list: string, basis: number): number[] {
  return list
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      if (token.endsWith('%')) return (parseFloat(token) / 100) * basis;
      return parseFloat(token) || 0;
    });
}

/**
 * The radii a box of `w` x `h` ACTUALLY PAINTS for a `border-radius` value.
 *
 * `value` is the fully substituted shorthand — `999px 0 0 999px`, `14px`,
 * `50% / 14px`. Percentages resolve against the width horizontally and the
 * height vertically, which is why the two axes are carried separately rather
 * than collapsed to one number per corner.
 */
function paintedRadii(value: string, w: number, h: number): Painted {
  const [horizontal, vertical] = value.split('/');
  const hs = expand(lengths(horizontal, w));
  const vs = expand(lengths(vertical ?? horizontal, h));

  const ratio = (side: number, sum: number): number => (sum > 0 ? side / sum : Infinity);
  const f = Math.min(
    1,
    ratio(w, hs[0] + hs[1]), // top
    ratio(w, hs[3] + hs[2]), // bottom
    ratio(h, vs[0] + vs[3]), // left
    ratio(h, vs[1] + vs[2]), // right
  );

  const scale = (c: Corners): Corners => [c[0] * f, c[1] * f, c[2] * f, c[3] * f];
  return { h: scale(hs), v: scale(vs) };
}

/** Painted geometry as a comparable string, to 0.5px — finer than that is
 *  below what any display resolves and would make two identical shapes read as
 *  two. */
function signature(p: Painted): string {
  const round = (n: number): string => (Math.round(n * 2) / 2).toFixed(1);
  return `${p.h.map(round).join(',')}/${p.v.map(round).join(',')}`;
}

const px = (value: string): number => parseFloat(value) || 0;

/* ────────────────────────────────────────────────────────────────────────────
   THE SIX KINDS.
   Icons transcribed from the legend of
   docs/brand/graphite/pages/03-node-kinds-without-hue.html §03.3. The glyph
   is the fifth channel and it is not a CSS token, so it is stated here — the
   test would otherwise credit each kind with one fewer separator than the
   design actually gives it.
   ──────────────────────────────────────────────────────────────────────────── */

const KINDS = [
  { kind: 'entry', icon: 'ic-entry', drawn: 'none' },
  { kind: 'service', icon: 'ic-service', drawn: 'none' },
  { kind: 'module', icon: 'ic-module', drawn: 'tab' },
  { kind: 'store', icon: 'ic-database', drawn: 'none' },
  { kind: 'topic', icon: 'ic-topic', drawn: 'none' },
  { kind: 'agent', icon: 'ic-agent', drawn: 'chamfer' },
] as const;

/**
 * SIX CHANNELS, NOT THE FIVE OF §03.2's TABLE, AND THE SPLIT IS A CORRECTION
 * RATHER THAN A CONCESSION.
 *
 * That table lists "silhouette — --arch-sil-* + two drawn outlines" on one row
 * because it is describing READING DISTANCE, not counting separators. The two
 * drawn outlines are not radii: the module's tab is an added bordered element
 * and the agent's chamfer is cut out of a two-layer plate, and §03.3 says they
 * behave differently under the camera from every radius — "the radii are scaled
 * by the renderer, but the tab, the chamfer and the seam are token sizes and
 * stay where they are". A corner radius can be destroyed by the scale factor;
 * a drawn outline cannot. Counting a channel that survives f together with one
 * that does not understates the separation on exactly the pairs where the
 * robust half is doing the work.
 *
 * The split is paid for in full by the cross-theme rule below, which is
 * strictly stronger than the per-theme count it replaces.
 */
interface Channels {
  silhouette: string;
  drawn: string;
  style: string;
  weight: string;
  tone: string;
  icon: string;
}

function channelsAt(w: number, h: number, theme: 'light' | 'dark'): Map<string, Channels> {
  return inTheme(theme, () => {
    const out = new Map<string, Channels>();
    for (const { kind, icon, drawn } of KINDS) {
      out.set(kind, {
        silhouette: signature(paintedRadii(resolve(`--arch-sil-${kind}`), w, h)),
        drawn,
        style: resolve(`--arch-style-${kind}`),
        weight: resolve(`--arch-weight-${kind}`),
        tone: resolve(`--arch-tone-${kind}`),
        icon,
      });
    }
    return out;
  });
}

const CHANNEL_NAMES = ['silhouette', 'drawn', 'style', 'weight', 'tone', 'icon'] as const;

/**
 * The channels on which two kinds differ IN BOTH THEMES.
 *
 * THE "IN BOTH THEMES" IS THE POINT, and it is a rule the book does not have.
 * `--arch-tone-*` is an alias, so it looks theme-invariant in the token list and
 * is not: _core.html:218 sets --surface-2, --surface-3 and --surface-4 to the
 * same white in light, "because light separates by shadow + hairline ring,
 * never by tone". So a pair separated by surface-2 against surface-3 is
 * separated in dark and not separated at all in light, while the token list
 * shows two different names and looks like it holds.
 *
 * This is the same class of defect as §03.4's declared-vs-painted radius, one
 * channel over: a declared tone is not a rendered tone. Counting only the
 * channels that survive BOTH themes is what makes the invariant mean what it
 * says — and it caught a live instance, recorded in this item's report.
 */
/**
 * The smallest per-channel RGB gap that counts as a VISIBLE difference in tone.
 *
 * Measured reason, not a taste: in LIGHT, `--surface-1` and `--surface-2` differ
 * by four values of red, four of green and three of blue — two string values and
 * ONE perceptual value. A scorer comparing resolved strings credits that as a
 * live channel no human can see. (The literals are not written here: this file
 * is behind the hex firewall, and the tests below read the real palette instead,
 * which also means they follow it if it moves.)
 *
 * 12 is deliberately above any anti-aliasing or rounding artefact and still far
 * below a step a designer would call a tone change. It is a floor on "somebody
 * could tell", not a target.
 */
const TONE_VISIBLE_DELTA = 12;

/** `#rrggbb` (or `#rgb`) to a triple; null for anything else, e.g. a gradient. */
function rgbOf(value: string): [number, number, number] | null {
  const v = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return [0, 1, 2].map((i) => parseInt(short[i + 1]!.repeat(2), 16)) as [number, number, number];
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v);
  if (full) return [0, 1, 2].map((i) => parseInt(full[i + 1]!, 16)) as [number, number, number];
  return null;
}

/**
 * DIFFERENT IS NOT DISTINGUISHABLE — the second defect in this invariant.
 *
 * Decision 2 already records the first: *declared values are not rendered
 * values*, learned when three of six kinds collapsed once the radii were
 * re-derived from what actually paints. This is its sibling, and it was NOT
 * learned until 2026-09-04: two values that RESOLVE differently can still be one
 * colour to a reader, and a scorer comparing strings credits the difference
 * anyway.
 *
 * So `tone` — the only channel carrying a colour rather than a geometry — must
 * clear a perceptual floor before it counts. Every other channel is categorical
 * (a shape, a border style, an icon) and a string comparison is the right test
 * for those: `dashed` and `dotted` are not nearly-the-same-dash.
 *
 * Without this, "give the light theme real surfaces" can be satisfied by a change
 * that passes the test and not the eye, and someone will make it in good faith.
 */
export function toneDiffers(x: string, y: string): boolean {
  if (x === y) return false;
  const a = rgbOf(x);
  const b = rgbOf(y);
  /* Not a flat colour on one side — a gradient or a var() that did not resolve.
     Fall back to the string comparison rather than inventing a distance. */
  if (!a || !b) return true;
  return Math.max(...[0, 1, 2].map((i) => Math.abs(a[i]! - b[i]!))) >= TONE_VISIBLE_DELTA;
}

function differingInBothThemes(
  light: Map<string, Channels>,
  dark: Map<string, Channels>,
  a: string,
  b: string,
): string[] {
  const separates = (theme: Map<string, Channels>, name: (typeof CHANNEL_NAMES)[number]): boolean =>
    name === 'tone'
      ? toneDiffers(theme.get(a)![name], theme.get(b)![name])
      : theme.get(a)![name] !== theme.get(b)![name];
  return CHANNEL_NAMES.filter((name) => separates(light, name) && separates(dark, name));
}

/* ────────────────────────────────────────────────────────────────────────────
   THE HUE BUDGET, and the namespaces that may not spend it.
   ──────────────────────────────────────────────────────────────────────────── */

/** Tokens an `--arch-*` value is permitted to reference. Neutral, or geometry.
 *  Anything else is a hue arriving through a name. */
const ARCH_ALLOWED = /^--(surface-\d|bg-(ground|base)|ink-\d|edge(-strong|-faint)?|sp-\d+|r-(\d+|full|bar)|w-(hair|edge|flow|struct|rule)|arch-)/;

/** The eleven §5.6 surfaces. Extension namespaces may hold geometry and
 *  aliases; a literal colour in one of them is a new hue that no theme moves. */
const EXTENSION_NAMESPACES = [
  '--shell-',
  '--attach-',
  '--settings-',
  '--cov-',
  '--ghost-',
  '--gate-',
  '--session-',
  '--row-h-two',
  '--export-',
  '--diffx-',
  '--stale-',
  '--toast-',
  '--perm-',
];

const isExtension = (name: string): boolean =>
  EXTENSION_NAMESPACES.some((ns) => name.startsWith(ns));

const HEX = new RegExp(String.fromCharCode(35) + '[0-9a-fA-F]{3,8}\\b');
const COLOUR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/i;

/* ══════════════════════════════════════════════════════════════════════════
   1 — NON-VACUITY
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 2.2 — the sheet is loaded and non-empty', () => {
  it('parses the token sheet out of the live CSSOM', () => {
    /*
     * Every rule below is "for each token, assert something", and all of them
     * pass vacuously against an empty list. `css: true` in vitest.config.ts is
     * what makes the import a real stylesheet rather than a no-op, and this is
     * the test that says so instead of a screen of green ticks that mean
     * nothing.
     */
    expect(BLOCKS.length).toBeGreaterThan(0);
    expect(LIGHT_BLOCKS.length).toBeGreaterThan(0);
    expect(MEDIA_DARK.length).toBe(1);
    expect(ATTR_DARK.length).toBe(1);
    /* 174 is the book's own count — docs/brand/graphite/_core.html declares
       that many across §1, §2 and §3. This sheet transcribes all of them and
       then extends, so it can never legitimately hold fewer. */
    expect(ALL_NAMES.length).toBeGreaterThan(174);
  });

  it('declares the four families the item names', () => {
    const count = (prefix: string): number =>
      ALL_NAMES.filter((n) => n.startsWith(prefix)).length;

    // §1 the palette, §2 the ramps, §3 the board, §6 the unsheeted surfaces.
    expect(count('--surface-')).toBeGreaterThanOrEqual(4);
    expect(count('--t-')).toBeGreaterThanOrEqual(9);
    expect(count('--arch-')).toBeGreaterThanOrEqual(24);
    expect(ALL_NAMES.filter(isExtension).length).toBeGreaterThanOrEqual(40);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 — THREE-STATE THEMING (Decision 1)
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 2.2 — every token resolves in every theme state', () => {
  it('resolves every token on the bare :root default', () => {
    const empty = inTheme('light', () => ALL_NAMES.filter((n) => resolve(n) === ''));
    expect(empty).toEqual([]);
  });

  it('resolves every token under [data-theme="dark"]', () => {
    const empty = inTheme('dark', () => ALL_NAMES.filter((n) => resolve(n) === ''));
    expect(empty).toEqual([]);
  });

  it('references no token it does not declare', () => {
    /*
     * A dangling var() is silent: it resolves to nothing and the property is
     * dropped, so the element keeps whatever it inherited and the surface looks
     * plausible. This is the failure mode of renaming one token and missing one
     * caller.
     */
    const known = new Set(ALL_NAMES);
    const dangling: string[] = [];
    for (const block of BLOCKS) {
      for (const [name, value] of block.props) {
        for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
          if (!known.has(match[1])) dangling.push(`${block.label} ${name}: ${match[1]}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it('keeps the two dark lists byte-identical', () => {
    /*
     * graphite.css's header: "The dark declaration list is written twice on
     * purpose… both blocks are edited together or not at all." Plain CSS cannot
     * share one list between a media query and an attribute selector, so the
     * duplication is real and unavoidable — which makes it the single most
     * likely thing in this file to drift. A token fixed in one block and missed
     * in the other produces an app that is correct on a machine set to dark and
     * wrong on a machine that CHOSE dark, or the reverse, and nobody tests both.
     */
    const media = mergedProps(MEDIA_DARK);
    const attr = mergedProps(ATTR_DARK);

    expect([...media.keys()].sort()).toEqual([...attr.keys()].sort());

    const drift = [...media.entries()]
      .filter(([name, value]) => attr.get(name) !== value)
      .map(([name, value]) => `${name}: ${value} vs ${attr.get(name)}`);
    expect(drift).toEqual([]);
  });

  it('lets dark override tokens and never introduce them', () => {
    /*
     * A token that exists only in dark resolves to nothing in light, and light
     * is the bare :root default that ships to every machine not set to dark.
     * Decision 1 defers TUNING light; it does not waive its existence.
     */
    const light = new Set(mergedProps(LIGHT_BLOCKS).keys());
    const darkOnly = [...mergedProps(ATTR_DARK).keys()].filter((n) => !light.has(n));
    expect(darkOnly).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 — DECISION 2: NO HUE IN THE --arch-* NAMESPACE
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 2.2 — Decision 2: the kind namespace holds no colour', () => {
  const archNames = ALL_NAMES.filter((n) => n.startsWith('--arch-'));

  it('has an --arch-* namespace to check', () => {
    expect(archNames.length).toBeGreaterThanOrEqual(24);
  });

  it('declares no literal colour anywhere in --arch-*', () => {
    const violations: string[] = [];
    for (const block of BLOCKS) {
      for (const [name, value] of block.props) {
        if (!name.startsWith('--arch-')) continue;
        if (HEX.test(value) || COLOUR_FN.test(value)) violations.push(`${name}: ${value}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('references only neutral or geometric tokens from --arch-*', () => {
    const violations: string[] = [];
    for (const block of BLOCKS) {
      for (const [name, value] of block.props) {
        if (!name.startsWith('--arch-')) continue;
        for (const match of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
          if (!ARCH_ALLOWED.test(match[1])) violations.push(`${name} -> ${match[1]}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('measures every colour an --arch-* token resolves to as grey, in both themes', () => {
    /*
     * The check that cannot be gamed by a name. The two rules above are
     * structural and would both pass if `--surface-2` itself were reddened;
     * this one reads the number that actually paints.
     */
    const violations: string[] = [];
    for (const theme of ['light', 'dark'] as const) {
      inTheme(theme, () => {
        for (const name of archNames) {
          const rgb = parseColour(resolve(name));
          if (!rgb) continue; // a radius, a clip-path, a border-style
          const c = chroma(rgb);
          if (c > GREY_CEILING) violations.push(`${theme} ${name} chroma ${c.toFixed(3)}`);
        }
      });
    }
    expect(violations).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4 — THE PAINT FUNCTION, PINNED TO THE BOOK BEFORE IT IS TRUSTED
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 2.2 — f = min(side / sum of radii on that side)', () => {
  it('reproduces every row of sheet 03 §03.4', () => {
    /*
     * docs/brand/graphite/pages/03-node-kinds-without-hue.html §03.4 prints
     * a seven-row table of token x f. If paintedRadii() cannot reproduce it,
     * every assertion built on top of it is measuring the wrong picture — so
     * the table is checked first, against tokens read out of the sheet rather
     * than against numbers typed here.
     *
     * The bottom three rows are the defect made arithmetic: on a 26x18 chip
     * --r-14, --r-18 and --r-full all land on 9px.
     */
    const r14 = declared('--r-14');
    const r18 = declared('--r-18');
    const rFull = declared('--r-full');
    const paint = (value: string, w: number, h: number): number =>
      paintedRadii(value, w, h).v[0];

    expect(paint(r14, 160, 96)).toBeCloseTo(14, 5);
    expect(paint(rFull, 160, 96)).toBeCloseTo(48, 5);
    expect(paint(r14, 80, 48)).toBeCloseTo(14, 5);
    expect(paint(rFull, 80, 48)).toBeCloseTo(24, 5);
    expect(paint(r14, 26, 18)).toBeCloseTo(9, 5);
    expect(paint(r18, 26, 18)).toBeCloseTo(9, 5);
    expect(paint(rFull, 26, 18)).toBeCloseTo(9, 5);
  });

  it('paints the entry capsule as a half-height end cap, not 999px', () => {
    const painted = paintedRadii(resolve('--arch-sil-entry'), 160, 96);
    // Left side round, right side square — the way in, against a hard edge.
    expect(painted.v[0]).toBeCloseTo(48, 5);
    expect(painted.v[3]).toBeCloseTo(48, 5);
    expect(painted.v[1]).toBe(0);
    expect(painted.v[2]).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5 — THE GREYSCALE INVARIANT
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 2.2 — the greyscale invariant, at the sizes that are drawn', () => {
  const cardW = px(resolve('--arch-card-w'));
  const cardH = px(resolve('--arch-card-min-h'));

  /* The two sizes the design draws a silhouette at. §03.3: each legend
     silhouette is drawn at "--arch-card-w / 2 by --arch-card-min-h / 2 — card
     aspect, half a card", and §03.4 explains why nothing shorter is allowed:
     "A swatch shorter than twice its largest radius is a lie about the shape." */
  const SIZES = [
    { name: 'card', w: cardW, h: cardH },
    { name: 'legend swatch (half a card)', w: cardW / 2, h: cardH / 2 },
  ];

  it('reads the card geometry out of the sheet', () => {
    expect(cardW).toBeGreaterThan(0);
    expect(cardH).toBeGreaterThan(0);
  });

  const pairs = (): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    for (let i = 0; i < KINDS.length; i += 1) {
      for (let j = i + 1; j < KINDS.length; j += 1) out.push([KINDS[i].kind, KINDS[j].kind]);
    }
    return out;
  };

  for (const size of SIZES) {
    it(`separates every pair of kinds by three channels in both themes — ${size.name}`, () => {
      /*
       * Sheet 03 §03.2: kind is carried by silhouette, border style, border
       * weight, neutral tone and an icon, and "every pair of kinds differs in
       * at least three of them". Three rather than two because border weight is
       * the weakest of the set — a 1.5px border snaps to 1px on a 1x display —
       * so a pair separated by only two channels is a pair that can go to one
       * on real hardware.
       *
       * Colour is not in the list, and that IS the invariant: the greyscale
       * render and the colour render carry exactly the same kind information,
       * and the difference between them is precisely the set of claims the
       * board is making.
       */
      const light = channelsAt(size.w, size.h, 'light');
      const dark = channelsAt(size.w, size.h, 'dark');
      const weak: string[] = [];

      for (const [a, b] of pairs()) {
        const diff = differingInBothThemes(light, dark, a, b);
        if (diff.length < 3) weak.push(`${a} vs ${b} differ only in [${diff.join(', ')}]`);
      }

      expect(weak).toEqual([]);
    });

    it(`never lets border weight be the only separator — ${size.name}`, () => {
      /*
       * Stated separately from the rule above even though it is implied by it,
       * because it is the clause that survives if anyone ever argues the three
       * down to two. _core.html §3: "weight is the WEAKEST channel in the set
       * and no pair of kinds may ever rely on it alone".
       */
      const light = channelsAt(size.w, size.h, 'light');
      const dark = channelsAt(size.w, size.h, 'dark');
      const weak: string[] = [];

      for (const [a, b] of pairs()) {
        const diff = differingInBothThemes(light, dark, a, b).filter((c) => c !== 'weight');
        if (diff.length < 2) weak.push(`${a} vs ${b}: [${diff.join(', ')}] once weight is discounted`);
      }

      expect(weak).toEqual([]);
    });

    it(`paints as many distinct silhouettes as it declares — ${size.name}`, () => {
      /*
       * The declared-vs-rendered check, kept separate because it fails EARLIER
       * and says something different: it catches a size at which the renderer
       * has collapsed two tokens into one arc, before anyone asks whether the
       * remaining channels can carry the difference. This is the assertion that
       * would have failed on the 26x18 legend chip the book used to draw, where
       * --r-14, --r-18 and --r-full all land on 9px.
       */
      const declaredSils = new Set(KINDS.map(({ kind }) => resolve(`--arch-sil-${kind}`)));
      const paintedSils = new Set(
        KINDS.map(({ kind }) =>
          signature(paintedRadii(resolve(`--arch-sil-${kind}`), size.w, size.h)),
        ),
      );

      expect(paintedSils.size).toBe(declaredSils.size);
    });
  }

  it('never counts a tone difference that only one theme can see', () => {
    /*
     * THE RULE THAT PAYS FOR SPLITTING `drawn` OUT OF `silhouette`, and the one
     * that found a live defect.
     *
     * _core.html:490 states that the agent kind is "separated by icon,
     * silhouette and tone" from the datastore. It is not: --arch-tone-store is
     * --surface-2 and --arch-tone-agent is --surface-3, and _core.html:218 sets
     * surfaces 2, 3 and 4 to the same white in light. In light the pair is
     * separated by two channels, not three, and the token list gives no sign of
     * it because both sides read as different names.
     *
     * This test names every tone pair that exists in one theme and not the
     * other, so the next kind added cannot lean on a channel that is missing
     * half the time. It is allowed to be non-empty here ONLY because the
     * three-channel rule above passes WITHOUT counting those pairs' tone.
     */
    const light = channelsAt(160, 96, 'light');
    const dark = channelsAt(160, 96, 'dark');
    const oneEyed: string[] = [];

    for (const [a, b] of pairs()) {
      const inLight = light.get(a)!.tone !== light.get(b)!.tone;
      const inDark = dark.get(a)!.tone !== dark.get(b)!.tone;
      if (inLight !== inDark) oneEyed.push(`${a} vs ${b}`);
    }

    /*
     * Recorded rather than asserted empty, because emptying it means tuning a
     * light value and GRAPHITE-DECISIONS.md Decision 1 defers light. The pairs
     * are pinned so the set cannot grow silently; growing it is the failure.
     */
    expect(oneEyed).toEqual(['entry vs agent', 'service vs agent', 'store vs agent', 'topic vs agent']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6 — THE RAMPS
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 2.2 — the ramps', () => {
  it('pairs every type size with a line height, and never inverts them', () => {
    const sizes = ALL_NAMES.filter((n) => /^--t-\d+$/.test(n));
    expect(sizes.length).toBe(9);
    for (const name of sizes) {
      const lh = name.replace('--t-', '--lh-');
      expect(ALL_NAMES).toContain(lh);
      expect(px(resolve(lh))).toBeGreaterThanOrEqual(px(resolve(name)));
    }
  });

  it('holds the compact ceiling and floor', () => {
    // "There is no size above 26px and no size below 10px."
    const sizes = ALL_NAMES.filter((n) => /^--t-\d+$/.test(n)).map((n) => px(resolve(n)));
    expect(Math.min(...sizes)).toBe(10);
    expect(Math.max(...sizes)).toBe(26);
  });

  it('declares only weights the shipped font files actually carry', () => {
    /*
     * THE HANDBACK FROM ITEM 0.1, WHICH THIS ITEM OWNS.
     *
     * Graphite's ladder asks for 450 body and 550 labels. @fontsource/
     * instrument-sans ships the static cuts 400/500/600/700, and CSS Fonts 4
     * font-matching does NOT round to the nearest: for a desired weight in
     * [400,500] it searches upward to 500 FIRST, and for a weight above 500 it
     * searches upward first. So a declared 450 paints 500 and a declared 550
     * paints 600 — which puts labels and headings on the same 600 and erases
     * the distinction the ladder exists to draw.
     *
     * So the ramp is declared at what ACTUALLY PAINTS, exactly as sheet 03 does
     * for the entry silhouette: "It now says square, because square is what
     * ships." A token that names a weight no file carries is a token that lies
     * about the render.
     */
    const cuts = new Set([400, 500, 600, 700]);
    const weights = ALL_NAMES.filter((n) => n.startsWith('--fw-'));
    expect(weights.length).toBeGreaterThanOrEqual(5);
    const off = weights.filter((n) => !cuts.has(Number(resolve(n))));
    expect(off).toEqual([]);
  });

  it('keeps the body, label and heading weights three distinct steps apart', () => {
    const body = Number(resolve('--fw-body'));
    const label = Number(resolve('--fw-label'));
    const head = Number(resolve('--fw-head'));
    expect(body).toBeLessThan(label);
    expect(label).toBeLessThan(head);
  });

  it('declares six radius steps and the four that do not exist', () => {
    // "--r-6, --r-12, --r-16 and --r-20 DO NOT EXIST; writing one yields an
    // invalid border-radius and a square corner, deliberately."
    for (const step of ['--r-4', '--r-8', '--r-10', '--r-14', '--r-18', '--r-full', '--r-bar']) {
      expect(ALL_NAMES).toContain(step);
    }
    for (const absent of ['--r-6', '--r-12', '--r-16', '--r-20']) {
      expect(ALL_NAMES).not.toContain(absent);
    }
  });

  it('skips the spacing values the ramp says it skips', () => {
    // "The scale SKIPS 14, 18, 28, 36 and 48 — a 14px gap is an invented number."
    for (const absent of ['--sp-14', '--sp-18', '--sp-28', '--sp-36', '--sp-48']) {
      expect(ALL_NAMES).not.toContain(absent);
    }
  });

  it('holds Graphite law 3 — compact is the only density', () => {
    expect(px(resolve('--control-h'))).toBe(28);
    expect(px(resolve('--icon-btn'))).toBe(26);
    expect(px(resolve('--row-h-thread'))).toBe(28);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7 — THE EXTENSIONS FOR THE ELEVEN UNSHEETED SURFACES (§5.6)
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 2.2 — the unsheeted surfaces cost geometry, never a hue', () => {
  const extensionNames = ALL_NAMES.filter(isExtension);

  it('covers all eleven surfaces §5.6 lists', () => {
    for (const namespace of EXTENSION_NAMESPACES) {
      expect(
        extensionNames.some((n) => n.startsWith(namespace)),
        `no token declared for the ${namespace} surface`,
      ).toBe(true);
    }
  });

  it('declares no literal colour in any extension namespace', () => {
    /*
     * §3 of _core.html states the standard an extension is held to: "It is NOT
     * a licence for a new colour, radius, type size or spacing value." A
     * geometry value the book has no slot for is allowed; a hue is not, because
     * a hue declared here is outside the budget in the header, outside the
     * three-state switch, and unmovable by either.
     */
    const violations: string[] = [];
    for (const block of BLOCKS) {
      for (const [name, value] of block.props) {
        if (!isExtension(name)) continue;
        if (HEX.test(value) || COLOUR_FN.test(value.replace(/\bcolor-mix\s*\(/gi, 'mix('))) {
          violations.push(`${name}: ${value}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('resolves every extension token in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const empty = inTheme(theme, () => extensionNames.filter((n) => resolve(n) === ''));
      expect(empty, `unresolved in ${theme}`).toEqual([]);
    }
  });

  it('states at each extension why it cannot be inherited', () => {
    /*
     * THE ONE ASSERTION THAT OPENS THE FILE, AND WHY IT IS NOT THE BANNED TIER.
     *
     * §4.6 bans readFileSync-and-grep because a grep for a VALUE proves nothing
     * about what the cascade did — the rule may never reach an element. Every
     * behavioural claim above is therefore made against the CSSOM or the
     * computed style. This assertion makes no behavioural claim: it checks that
     * each extension group carries its justification, and a comment is erased
     * by the parser, so there is no cascade to read it out of.
     *
     * It is worth enforcing because the extension block is where this file will
     * grow, and an undocumented token is how "Graphite has no slot for this"
     * quietly becomes "I preferred a different number".
     */
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, 'graphite.css'), 'utf8').replace(/\r\n/g, '\n');

    const missing = EXTENSION_NAMESPACES.filter((namespace) => {
      const at = source.indexOf(namespace + (namespace.endsWith('-') ? '' : ':'));
      if (at === -1) return true;
      // The justification is the comment block immediately above the group.
      const preceding = source.slice(Math.max(0, at - 2400), at);
      const last = preceding.lastIndexOf('/*');
      if (last === -1) return true;
      return !/CANNOT BE INHERITED/.test(preceding.slice(last));
    });

    expect(missing, 'these extension groups declare no reason they cannot be inherited').toEqual([]);
  });
});

describe('item 2.2 — different is not distinguishable (the tone floor)', () => {
  /*
   * THE FLOOR IS INERT TODAY, AND THAT IS THE POINT OF TESTING IT DIRECTLY.
   *
   * Measured: setting TONE_VISIBLE_DELTA to 200 — so tone can separate nothing —
   * leaves the greyscale invariant at 32/32. With six silhouettes no pair depends
   * on tone at all, which is an argument FOR keeping six rather than a reason to
   * skip the guard.
   *
   * But a guard that cannot be observed failing is the first law's own defect, so
   * the mechanism is tested here rather than only through a scenario that does
   * not currently arise. It arises the moment the shape channel is reduced or the
   * light theme gains real surfaces, and both have been proposed.
   *
   * READ FROM THE PALETTE, NEVER WRITTEN DOWN. No hex literal appears in this
   * file — it is behind the firewall — and the values would go stale anyway. A
   * test that hardcodes a colour is a measurement quoted after its denominator
   * moved.
   */
  it('refuses a light-theme difference no reader can see', () => {
    const [s1, s2] = inTheme('light', () => [resolve('--surface-1'), resolve('--surface-2')]);
    expect(s1).not.toBe(s2);
    expect(toneDiffers(s1, s2)).toBe(false);
  });

  it('credits a dark-theme difference a reader can see', () => {
    const [s1, s3] = inTheme('dark', () => [resolve('--surface-1'), resolve('--surface-3')]);
    expect(toneDiffers(s1, s3)).toBe(true);
  });

  it('falls back to the string comparison when a value is not a flat colour', () => {
    /* A gradient or an unresolved var() has no RGB distance, and inventing one
       would be worse than the string test it replaces. */
    expect(toneDiffers('linear-gradient(black, white)', 'black')).toBe(true);
    expect(toneDiffers('var(--nope)', 'var(--nope)')).toBe(false);
  });
});
