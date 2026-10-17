/* ══════════════════════════════════════════════════════════════════════════
   ONE TITLE SIZE ON THE WHOLE BOARD, TWO LINES, THEN A MIDDLE ELLIPSIS
   packages/web2/src/canvas/titleFit.ts

   Coordinator ruling (round 3, on title sizes): at a given zoom every card
   title on the board is drawn at ONE size, whatever its kind. Cards keep their
   240 px cap. A long name wraps inside its card to at most two lines, at a
   word break, and only then is shortened in the middle. The name is the full
   name, never a shorter label.

   Pure: the measurer is passed in (textFit.measureWithCanvas in the app), so
   the arithmetic is tested without a browser.
   ══════════════════════════════════════════════════════════════════════════ */

/** Width of a string in the title face, in CSS px at scale 1. */
export type Measure = (text: string) => number;

/** The lines a title may take. */
export const TITLE_LINES = 2;

/**
 * Lines `text` takes in `width`, wrapped greedily at spaces. A word wider than
 * the whole line cannot be placed at a word break: Infinity.
 */
export function wordLines(text: string, width: number, measure: Measure): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const space = measure(' ');
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const w = measure(word);
    if (!Number.isFinite(w)) return 1;
    if (w > width) return Number.POSITIVE_INFINITY;
    if (used === 0) used = w;
    else if (used + space + w <= width) used += space + w;
    else {
      lines += 1;
      used = w;
    }
  }
  return lines;
}

/**
 * The largest scale at which `text` still fits `contentW` (the card's content
 * width at scale 1) in at most TITLE_LINES lines at word breaks: the title's
 * fit. Undefined where text cannot be measured.
 */
export function titleFit(text: string, contentW: number, measure: Measure, inset = 0): number | undefined {
  const full = measure(text.trim());
  if (!Number.isFinite(full) || full <= 0 || !(contentW > 0)) return undefined;
  /* `inset`: room inside the scaled row that is not the title's (the icon
     chip and its gap, cardBox.ts CHIP_INSET), in the row's own units. */
  const fits = (s: number) => wordLines(text, contentW / s - inset, measure) <= TITLE_LINES;
  /* No scale passes the widest word filling a line, nor the whole name split
     evenly over the lines (with slack for the spaces a break removes). */
  const widest = Math.max(...text.trim().split(/\s+/).map((w) => measure(w)));
  let lo = 0;
  let hi = Math.min(contentW / (widest + inset), (contentW / (full + inset)) * TITLE_LINES * 1.1);
  if (fits(hi)) return Math.floor(hi * 1000) / 1000;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return Math.floor(lo * 1000) / 1000;
}

/**
 * `text` as drawn in `width`: unchanged when it wraps into TITLE_LINES lines
 * at word breaks, otherwise shortened in the middle until it does
 * ("Order Cre…messages"). Unchanged where it cannot be measured.
 */
export function twoLineText(text: string, width: number, measure: Measure): string {
  const t = text.trim();
  if (!Number.isFinite(measure(t)) || wordLines(t, width, measure) <= TITLE_LINES || t.length <= 4) return t;
  for (let keep = t.length - 1; keep > 2; keep--) {
    const head = Math.ceil(keep / 2);
    const cand = `${t.slice(0, head).trimEnd()}…${t.slice(t.length - (keep - head)).trimStart()}`;
    if (wordLines(cand, width, measure) <= TITLE_LINES) return cand;
  }
  return `${t.slice(0, 1)}…${t.slice(-1)}`;
}

/**
 * The one fit every card on the board shares: the smallest title fit among
 * them, so the longest name sets the size and no name is drawn smaller than
 * another. Undefined when nothing could be measured.
 */
export function boardTitleFit(
  cards: ReadonlyArray<{ text: string; contentW: number }>,
  measure: Measure,
  inset = 0,
): number | undefined {
  let least: number | undefined;
  for (const c of cards) {
    const f = titleFit(c.text, c.contentW, measure, inset);
    if (f !== undefined) least = least === undefined ? f : Math.min(least, f);
  }
  return least;
}
