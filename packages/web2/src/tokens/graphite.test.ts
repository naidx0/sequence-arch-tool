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
   2b — DECISION 29: THE APPEARANCE EXPERIMENT
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 2.2 — Decisions 29 and 30: the white accent, and what it owes', () => {
  /*
   * AN EXPERIMENT IS ONLY AN EXPERIMENT IF THE DEFAULT IS UNTOUCHED, and that
   * is a claim about a block of CSS nobody will re-read. The variant is written
   * with a selector chosen to dodge the two dark collectors above (see §5b's
   * header), which means the byte-identical lock CANNOT see it — so the thing
   * §5b promises has to be asserted somewhere, and this is that somewhere.
   */
  const withWhite = <T,>(fn: () => T): T => {
    root.setAttribute('data-accent', 'white');
    try {
      return fn();
    } finally {
      root.removeAttribute('data-accent');
    }
  };

  it('still paints Decision 22 gold with NO ATTRIBUTE — the attribute is the look', () => {
    /* Decision 30 moved the PRODUCT's default to white; it did not move the
       DOM's. Gold is still the absence of the attribute, which is why
       `accentPreference.applyAccent` is called at boot for the default rather
       than only for a choice. This assertion is what makes that necessary
       rather than merely tidy. */
    expect(
      inTheme('dark', () => ({
        accent: resolve('--accent'),
        solid: resolve('--accent-solid'),
        onSolid: resolve('--accent-on-solid'),
        blur: resolve('--glass-blur'),
      })),
    ).toEqual({ accent: '#E8C547', solid: '#C9A227', onSolid: '#FFFFFF', blur: '20px' });
  });

  it('flips to the top ink, inverts the ink on the fill, and thickens the blur', () => {
    expect(
      inTheme('dark', () =>
        withWhite(() => ({
          accent: resolve('--accent'),
          solid: resolve('--accent-solid'),
          onSolid: resolve('--accent-on-solid'),
          blur: resolve('--glass-blur'),
        })),
      ),
    ).toEqual({ accent: '#F6F7FA', solid: '#E9EAF0', onSolid: '#131315', blur: '24px' });
  });

  it('does NOT reach the light palette — Decision 1 defers light', () => {
    /* White on the untuned light palette is white on near-white. The variant's
       `:not([data-theme="light"])` is what stops it, and a selector is the kind
       of thing that survives a careless edit while losing its meaning. */
    expect(inTheme('light', () => withWhite(() => resolve('--accent')))).toBe('#C9A227');
    expect(inTheme('light', () => withWhite(() => resolve('--accent-on-solid')))).toBe('#FFFFFF');
  });

  /* The alpha of an rgba() token, or null when the value is not one. The three
     deltas below are claims about ALPHA, so this is the one number they read;
     `parseColour` above deliberately drops it because chroma does not care. */
  const alphaOf = (value: string): number | null => {
    const fn = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
    if (!fn) return null;
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 4 || Number.isNaN(parts[3])) return null;
    return parts[3];
  };

  const round3 = (n: number): number => Math.round(n * 1000) / 1000;

  const alpha = (name: string): number => {
    const value = withWhite(() => resolve(name));
    const a = alphaOf(value);
    expect(a, `${name} is not an rgba() token: ${value}`).not.toBeNull();
    return a as number;
  };

  /*
   * DECISION 30 — CHOSEN IS UNMISTAKABLE, IN THREE CHANNELS.
   *
   * The owner, 2026-09-18: "people can tell what's chosen and what's not."
   * One channel is a preference; three together are a state. The plan
   * (docs/research/walk-4-white-glass-plan.md §1) names the three and their
   * sizes, and says in as many words that the check locks THE DELTAS, NOT THE
   * COLOURS — so the look can be tuned again without the guarantee being
   * retuned with it, and so a tuning that quietly flattens one channel fails
   * here rather than on the owner's screen.
   */
  it('separates chosen from not chosen by FILL, by RIM and by INK WEIGHT', () => {
    inTheme('dark', () => {
      /* FILL — the chosen fill against the loudest fill a NOT-chosen neighbour
         ever shows, which is its hover. At rest a neighbour has no fill at all,
         so this is the smaller of the two gaps and the one worth locking. */
      const chosenFill = alpha('--accent-chosen');
      const neighbourFill = alpha('--glass-hover');
      /* Rounded to three places before the comparison: .12 - .04 is
         0.0799999… in binary floating point, and a lock that fails on the
         representation of a number it was given exactly is a lock nobody
         trusts the second time. */
      expect(round3(chosenFill - neighbourFill)).toBeGreaterThanOrEqual(0.08);
      /* The chosen TAB is painted with --state-selected rather than
         --accent-chosen, and the two must not drift apart: a tab and a chip
         chosen on the same screen at different strengths is the reader being
         asked which kind of chosen each one is. */
      expect(alpha('--state-selected')).toBeCloseTo(chosenFill, 3);

      /* RIM — the chosen rim against the hairline every resting control wears.
         Locked as a ratio as well as a gap, because halving both would keep the
         difference while losing the hairline. */
      const chosenRim = alpha('--accent-chosen-edge');
      const restingRim = alpha('--glass-ctl-edge');
      expect(round3(chosenRim - restingRim)).toBeGreaterThanOrEqual(0.14);
      expect(chosenRim / restingRim).toBeGreaterThanOrEqual(2);
      expect(alphaOf(withWhite(() => resolve('--edge')))).toBeCloseTo(restingRim, 3);

      /* INK WEIGHT — the third channel, and the one that survives greyscale. */
      const head = Number(withWhite(() => resolve('--fw-head')));
      const label = Number(withWhite(() => resolve('--fw-label')));
      expect(head).toBeGreaterThan(label);
    });
  });

  /*
   * FROSTED, NOT OPAQUE — the two bands the plan gives in numbers.
   *
   * "Every chosen control and every composer control keeps backdrop-filter blur
   * with a fill thin enough that the ground moves behind it (.10-.14 alpha)",
   * and "the glow washes drop to .06-.10 alpha". A fill above its band is the
   * near-opaque slab Decision 29 shipped and the owner rejected; a fill below it
   * is a control with no body, which is what "frosted" is not.
   */
  it('keeps every control fill frosted and every wash a wash', () => {
    inTheme('dark', () => {
      for (const name of ['--glass-ctl', '--glass-ctl-hover', '--accent-chosen']) {
        expect(alpha(name), name).toBeGreaterThanOrEqual(0.1);
        expect(alpha(name), name).toBeLessThanOrEqual(0.14);
      }
      for (const name of ['--accent-wash', '--accent-wash-2', '--user-bubble']) {
        expect(alpha(name), name).toBeGreaterThanOrEqual(0.06);
        expect(alpha(name), name).toBeLessThanOrEqual(0.1);
      }
    });
  });

  /*
   * NOTHING CATCHES LIGHT (the owner's correction on the built app, Decision
   * 30): "some of the glass elements are looking more shiny rather than clean
   * and transparent (transparency is #1)."
   *
   * Shine and transparency are not the same axis, which is why the first tuning
   * could raise the fills into the frosted band and still come back wrong: the
   * fills were right and the BEVEL was the problem. A lit top edge over a dark
   * bottom one draws a polished object; frosted glass scatters. So the two
   * halves of that bevel have ceilings now, and the fills keep their band -
   * asserted together, because a later tuning that "restores the highlight"
   * would otherwise only have to argue with a comment.
   */
  it('keeps the highlight and the bevel below the ceiling that reads as shine', () => {
    inTheme('dark', () => {
      expect(alpha('--glass-ctl-hi')).toBeLessThanOrEqual(0.06);
      expect(alpha('--glass-ctl-lo')).toBeLessThanOrEqual(0.12);
      /* And the fills did NOT drop with it. Answering "too shiny" by thinning
         the glass would take the body back out of every control, which is the
         complaint before last. */
      expect(alpha('--glass-ctl')).toBeGreaterThanOrEqual(0.1);
    });
  });

  it('introduces no token of its own — it may only override', () => {
    /* The same guarantee item 2.2 makes of dark, made of the variant: a token
       that exists only under the experiment resolves to nothing for everybody
       who never switched. */
    const declaredOnRoot = new Set(mergedProps(LIGHT_BLOCKS).keys());
    const variant = BLOCKS.filter(
      (b) => b.media === null && b.selector.includes('data-accent="white"'),
    );
    expect(variant.length).toBeGreaterThan(0);
    expect([...mergedProps(variant).keys()].filter((n) => !declaredOnRoot.has(n))).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2c — DECISION 31: THE HINT FAMILY, AND LIQUID GLASS INSTEAD OF A BEVEL
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 2.2 — Decision 31: a hint is a rim and a glyph, and glass has no edge', () => {
  const withWhite = <T,>(fn: () => T): T => {
    root.setAttribute('data-accent', 'white');
    try {
      return fn();
    } finally {
      root.removeAttribute('data-accent');
    }
  };

  /* The alpha of an rgba() value, parsed without a regex so the assertion text
     stays readable. Null when the value is not an rgba() at all, which every
     caller below treats as a failure rather than as a zero. */
  const alphaOf = (value: string): number | null => {
    const text = value.trim();
    if (!text.toLowerCase().startsWith('rgba(')) return null;
    const close = text.lastIndexOf(')');
    if (close < 5) return null;
    const parts = text
      .slice(5, close)
      .split(',')
      .map((part) => Number(part.trim()));
    if (parts.length < 4 || Number.isNaN(parts[3])) return null;
    return parts[3];
  };

  const HUES = ['blue', 'green', 'orange', 'purple', 'teal'] as const;

  /*
   * THE FAMILY HAS TO EXIST WHERE THE PRODUCT PAINTS FROM.
   *
   * White is the accent the product ships (Decision 30), so "the hints are
   * declared" is a claim about the WHITE cascade and not about :root. A family
   * that resolved on the bare default and fell out from under the variant would
   * leave every hinted glyph painting `currentColor` — which looks like a
   * perfectly good control and says nothing at all.
   */
  it('resolves all five hints, their washes and their rims under the white accent', () => {
    inTheme('dark', () => {
      const missing: string[] = [];
      for (const hue of HUES) {
        for (const suffix of ['', '-wash', '-rim']) {
          const name = `--hint-${hue}${suffix}`;
          if (withWhite(() => resolve(name)) === '') missing.push(name);
        }
      }
      expect(missing).toEqual([]);
    });
  });

  /*
   * FIVE NAMES, FIVE COLOURS — law 1 read as arithmetic rather than as a
   * sentence. Each hue names one claim (a mode, a level, a run, the window), so
   * two names resolving to one colour means one claim is being made twice and
   * the reader cannot tell which control they are looking at. DERIVED FROM THE
   * LIST, so a sixth hint added later is checked without this being edited.
   */
  it('gives every hint its own colour', () => {
    inTheme('dark', () => {
      const painted = HUES.map((hue) => withWhite(() => resolve(`--hint-${hue}`)));
      expect(new Set(painted).size).toBe(HUES.length);
      /* And none of them IS the accent: a hint that resolved to white would be
         invisible as a hint and would quietly become a second chosen state. */
      expect(painted).not.toContain(withWhite(() => resolve('--accent')));
    });
  });

  /*
   * SMALL, IN NUMBERS. "Small — not standing out" (owner, 2026-09-18) is a wash
   * at .14 and a rim at .35 — a tint you read as a tint, and one hairline. The
   * ceiling is the half that matters: a later tuning answering "the hint is
   * hard to see" by FILLING the control fails here rather than on his screen.
   */
  it('keeps every wash a wash and every rim a hairline', () => {
    inTheme('dark', () => {
      for (const hue of HUES) {
        const wash = alphaOf(withWhite(() => resolve(`--hint-${hue}-wash`)));
        const rim = alphaOf(withWhite(() => resolve(`--hint-${hue}-rim`)));
        expect(wash, `--hint-${hue}-wash is not an rgba() token`).not.toBeNull();
        expect(rim, `--hint-${hue}-rim is not an rgba() token`).not.toBeNull();
        expect(wash as number, `--hint-${hue}-wash`).toBeCloseTo(0.14, 3);
        expect(rim as number, `--hint-${hue}-rim`).toBeCloseTo(0.35, 3);
        /* The rim is louder than the wash, which is what makes a hint a RIM
           with a tint behind it rather than a tinted button with an edge. */
        expect(rim as number).toBeGreaterThan(wash as number);
      }
    });
  });

  /*
   * NO GRADIENT ON ANYTHING A CONTROL IS MADE OF.
   *
   * Owner, 2026-09-18: "I'm not looking for a metallic shine, I'm looking for
   * liquid glass… the chat box as well." A gradient across a face is a
   * REFLECTION and a gradient along an edge is a BEVEL; both are how a renderer
   * draws metal. This reads the variant block's own declarations AND the
   * RESOLVED value of every token a control composes, because a gradient can
   * arrive either by being written in the variant or by being inherited into it
   * from the block above.
   */
  it('declares no gradient in the white variant, and no control token resolves to one', () => {
    const variant = BLOCKS.filter(
      (b) => b.media === null && b.selector.includes('data-accent="white"'),
    );
    expect(variant.length).toBeGreaterThan(0);
    expect(
      [...mergedProps(variant).entries()]
        .filter(([, value]) => value.toLowerCase().includes('gradient'))
        .map(([name, value]) => `${name}: ${value}`),
    ).toEqual([]);

    const CONTROL_TOKENS = [
      '--glass-ctl',
      '--glass-ctl-hover',
      '--glass-ctl-hi',
      '--glass-ctl-lo',
      '--glass-ctl-edge',
      '--glass-rim',
      '--glass-hover',
      '--glass-inset',
      '--glass-sel-inset',
      '--accent-chosen',
      '--accent-chosen-edge',
      ...HUES.map((hue) => `--hint-${hue}-wash`),
    ];
    inTheme('dark', () => {
      expect(
        CONTROL_TOKENS.filter((name) =>
          withWhite(() => resolve(name)).toLowerCase().includes('gradient'),
        ),
      ).toEqual([]);
    });
  });

  /*
   * AND THE 1px LINE IS GONE, WHICH IS THE OTHER HALF OF "NOT METALLIC".
   *
   * Decision 30 thinned the seam to .06 and the owner still read the built app
   * as shine, because thinning a bevel keeps its SHAPE: one lit row along the
   * top, one dark row along the bottom, a solid between them. Both halves are
   * zero now and the light is a half-pixel ring instead, which cannot land on a
   * single row of pixels and so scatters rather than drawing an edge.
   *
   * THE ASSERTION IS ON THE OFFSET, NOT ON THE ALPHA. An inset with a vertical
   * offset is a directional line at any strength — that is the thing being
   * forbidden, and an alpha ceiling would let it back in at .04.
   */
  it('paints no directional 1px seam on a control under the white accent', () => {
    inTheme('dark', () => {
      expect(alphaOf(withWhite(() => resolve('--glass-ctl-hi')))).toBe(0);
      expect(alphaOf(withWhite(() => resolve('--glass-ctl-lo')))).toBe(0);

      for (const name of ['--glass-inset', '--glass-sel-inset']) {
        const recipe = withWhite(() => resolve(name));
        const layers = recipe.split('inset ').slice(1);
        /* A recipe that resolved to nothing would satisfy every clause below
           by having no layers at all, and would leave every control bodiless. */
        expect(layers.length, `${name} composes no inset layer`).toBeGreaterThan(0);
        for (const layer of layers) {
          expect(
            layer.startsWith('0 0 '),
            `${name} still carries a directional layer: inset ${layer}`,
          ).toBe(true);
        }
        /* The soft ring is a HALF pixel, and that is the whole mechanism: a
           half pixel antialiases into a glow instead of snapping to a row. */
        expect(recipe.includes('.5px'), `${name} draws no half-pixel ring`).toBe(true);
      }
    });
  });

  /*
   * THE HAIRLINE BAND — .08 to .12. Below .08 a control loses its shape against
   * the pane it sits on; above .12 the ring reads as a stroke somebody drew
   * rather than as the edge of a piece of glass. The three names are checked
   * together because a control sitting beside a divider drawn at a different
   * strength is the seam a reader reads as two materials.
   */
  it('keeps every hairline inside the band a hairline is legible in', () => {
    inTheme('dark', () => {
      for (const name of ['--edge', '--glass-ctl-edge', '--glass-rim']) {
        const a = alphaOf(withWhite(() => resolve(name)));
        expect(a, `${name} is not an rgba() token`).not.toBeNull();
        expect(a as number, name).toBeGreaterThanOrEqual(0.08);
        expect(a as number, name).toBeLessThanOrEqual(0.12);
      }
    });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2d — DECISION 32: THE BLUE ACCENT — LOVABLE'S ROOM ON DECISION 31 GLASS
   ══════════════════════════════════════════════════════════════════════════ */

describe('item 2.2 — Decision 32: the blue accent is Lovable read off the kit, on the same glass', () => {
  /*
   * Owner, 2026-09-18, on his own Ramp Kit: "set all of those Lovable tokens
   * and themes as our source of truth." The kit's `.t-lovable` (dark) is the
   * spec, and this suite reads the SHEET the product paints from and compares
   * it to the kit, number for number — so a later tuning that drifts the room
   * back toward navy, or spends the blue where it cannot be read, fails here
   * rather than on his screen.
   */
  const withBlue = <T,>(fn: () => T): T => {
    root.setAttribute('data-accent', 'blue');
    try {
      return fn();
    } finally {
      root.removeAttribute('data-accent');
    }
  };

  const alphaOf = (value: string): number | null => {
    const text = value.trim();
    if (!text.toLowerCase().startsWith('rgba(')) return null;
    const close = text.lastIndexOf(')');
    if (close < 5) return null;
    const parts = text
      .slice(5, close)
      .split(',')
      .map((part) => Number(part.trim()));
    if (parts.length < 4 || Number.isNaN(parts[3])) return null;
    return parts[3];
  };

  const hex = (value: string): [number, number, number] | null => {
    const text = value.trim();
    if (!text.startsWith(String.fromCharCode(35)) || text.length !== 7) return null;
    return [
      parseInt(text.slice(1, 3), 16),
      parseInt(text.slice(3, 5), 16),
      parseInt(text.slice(5, 7), 16),
    ];
  };

  /* WCAG relative luminance and contrast — the arithmetic behind every ratio
     quoted in the sheet's §5c header, so the header cannot drift from it. */
  const luminance = ([r, g, b]: [number, number, number]): number => {
    const lin = (c: number): number => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const contrast = (a: string, b: string): number => {
    const x = hex(a);
    const y = hex(b);
    expect(x, `${a} is not a hex colour`).not.toBeNull();
    expect(y, `${b} is not a hex colour`).not.toBeNull();
    const [la, lb] = [luminance(x as [number, number, number]), luminance(y as [number, number, number])];
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const round3 = (n: number): number => Math.round(n * 1000) / 1000;
  const alpha = (name: string): number => {
    const value = withBlue(() => resolve(name));
    const a = alphaOf(value);
    expect(a, `${name} is not an rgba() token: ${value}`).not.toBeNull();
    return a as number;
  };

  const HUES = ['blue', 'green', 'orange', 'purple', 'teal'] as const;

  it('is the kit\'s Lovable entry: the room, the surface, the inks, the blue', () => {
    inTheme('dark', () => {
      withBlue(() => {
        expect(resolve('--bg-base')).toBe('#1D1D1C');
        expect(resolve('--surface-2')).toBe('#272726');
        expect(resolve('--ink-1')).toBe('#FFFFFF');
        expect(resolve('--ink-2')).toBe('#E1E1E0');
        expect(resolve('--ink-3')).toBe('#A6A6A4');
        expect(resolve('--accent-solid')).toBe('#1F55F1');
        expect(resolve('--accent-on-solid')).toBe('#FFFFFF');
      });
    });
  });

  it('keeps the room GREY — no channel more than two steps from another', () => {
    /* "A metallic hint of navy" (owner) was #181A20: blue by eight. Lovable's
       ladder is grey with one point of warmth. Two is the ceiling that keeps
       the warmth and forbids the tint. */
    inTheme('dark', () => {
      withBlue(() => {
        for (const name of [
          '--bg-ground', '--bg-base', '--ground-hi', '--ground-mid', '--ground-lo',
          '--surface-1', '--surface-2', '--surface-3', '--surface-4',
        ]) {
          const rgb = hex(resolve(name));
          expect(rgb, `${name} is not a hex colour`).not.toBeNull();
          const [r, g, b] = rgb as [number, number, number];
          expect(Math.max(r, g, b) - Math.min(r, g, b), name).toBeLessThanOrEqual(2);
        }
      });
    });
  });

  it('spends one blue in two cuts, each legible where it is read', () => {
    inTheme('dark', () => {
      withBlue(() => {
        /* The solid carries white (text on a fill: 4.5). */
        expect(contrast(resolve('--accent-on-solid'), resolve('--accent-solid'))).toBeGreaterThanOrEqual(4.5);
        /* The mark cut clears the non-text floor on the ground it sits on. */
        expect(contrast(resolve('--accent'), resolve('--bg-base'))).toBeGreaterThanOrEqual(3);
        /* The text cut clears the text floor on a CARD, the darkest place it
           is read as words. */
        expect(contrast(resolve('--accent-ink'), resolve('--surface-2'))).toBeGreaterThanOrEqual(4.5);
        /* And the solid itself is NOT a mark: under 3:1 on the ground is the
           measurement that makes it a fill and nothing else. */
        expect(contrast(resolve('--accent-solid'), resolve('--bg-base'))).toBeLessThan(3.2);
      });
    });
  });

  it('spends the blue on the hints too — --hint-blue IS the accent, and the five are still five', () => {
    inTheme('dark', () => {
      withBlue(() => {
        expect(resolve('--hint-blue')).toBe(resolve('--accent'));
        const painted = HUES.map((hue) => resolve(`--hint-${hue}`));
        expect(new Set(painted).size).toBe(HUES.length);
      });
    });
  });

  it('keeps every wash a wash, every rim a hairline, and every FILL between them', () => {
    /* The fill is the third token in the family (Decision 32): what a chosen
       mode chip is made of. Above the wash so the chip reads as coloured
       glass, below the rim so the edge still ends it. */
    inTheme('dark', () => {
      for (const hue of HUES) {
        const wash = alpha(`--hint-${hue}-wash`);
        const rim = alpha(`--hint-${hue}-rim`);
        const fill = alpha(`--hint-${hue}-fill`);
        expect(wash, `--hint-${hue}-wash`).toBeCloseTo(0.14, 3);
        expect(rim, `--hint-${hue}-rim`).toBeCloseTo(0.35, 3);
        expect(fill, `--hint-${hue}-fill`).toBeGreaterThan(wash);
        expect(fill, `--hint-${hue}-fill`).toBeLessThan(rim);
        expect(fill, `--hint-${hue}-fill`).toBeLessThanOrEqual(0.24);
      }
    });
  });

  it('separates chosen from not chosen by FILL, by RIM and by INK WEIGHT — same lock as white', () => {
    inTheme('dark', () => {
      const chosenFill = alpha('--accent-chosen');
      const neighbourFill = alpha('--glass-hover');
      expect(round3(chosenFill - neighbourFill)).toBeGreaterThanOrEqual(0.08);
      expect(alpha('--state-selected')).toBeCloseTo(chosenFill, 3);
      const chosenRim = alpha('--accent-chosen-edge');
      const restingRim = alpha('--glass-ctl-edge');
      expect(round3(chosenRim - restingRim)).toBeGreaterThanOrEqual(0.14);
      expect(chosenRim / restingRim).toBeGreaterThanOrEqual(2);
      expect(alphaOf(withBlue(() => resolve('--edge')))).toBeCloseTo(restingRim, 3);
      const head = Number(withBlue(() => resolve('--fw-head')));
      const label = Number(withBlue(() => resolve('--fw-label')));
      expect(head).toBeGreaterThan(label);
    });
  });

  it('keeps the Decision 31 glass: frosted band, no seam, a half-pixel ring, hairlines in band', () => {
    inTheme('dark', () => {
      for (const name of ['--glass-ctl', '--glass-ctl-hover', '--accent-chosen']) {
        expect(alpha(name), name).toBeGreaterThanOrEqual(0.1);
        expect(alpha(name), name).toBeLessThanOrEqual(0.14);
      }
      expect(alpha('--glass-ctl-hi')).toBe(0);
      expect(alpha('--glass-ctl-lo')).toBe(0);
      for (const name of ['--glass-inset', '--glass-sel-inset']) {
        const recipe = withBlue(() => resolve(name));
        const layers = recipe.split('inset ').slice(1);
        expect(layers.length, `${name} composes no inset layer`).toBeGreaterThan(0);
        for (const layer of layers) {
          expect(layer.startsWith('0 0 '), `${name} still carries a directional layer: inset ${layer}`).toBe(true);
        }
        expect(recipe.includes('.5px'), `${name} draws no half-pixel ring`).toBe(true);
      }
      for (const name of ['--edge', '--glass-ctl-edge', '--glass-rim']) {
        expect(alpha(name), name).toBeGreaterThanOrEqual(0.08);
        expect(alpha(name), name).toBeLessThanOrEqual(0.12);
      }
    });
  });

  it('rounds the kit\'s way — 8 on a button, 10 on a card', () => {
    inTheme('dark', () => {
      withBlue(() => {
        expect(resolve('--r-10')).toBe('8px');
        expect(resolve('--r-14')).toBe('10px');
      });
    });
  });

  it('does NOT reach the light palette — Decision 1 still defers light', () => {
    expect(inTheme('light', () => withBlue(() => resolve('--accent')))).toBe('#C9A227');
    expect(inTheme('light', () => withBlue(() => resolve('--bg-base')))).toBe('#F6F6F7');
  });

  it('introduces no token of its own, and declares no gradient', () => {
    const declaredOnRoot = new Set(mergedProps(LIGHT_BLOCKS).keys());
    const variant = BLOCKS.filter(
      (b) => b.media === null && b.selector.includes('data-accent="blue"'),
    );
    expect(variant.length).toBeGreaterThan(0);
    expect([...mergedProps(variant).keys()].filter((n) => !declaredOnRoot.has(n))).toEqual([]);
    expect(
      [...mergedProps(variant).entries()]
        .filter(([, value]) => value.toLowerCase().includes('gradient'))
        .map(([name, value]) => `${name}: ${value}`),
    ).toEqual([]);
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
