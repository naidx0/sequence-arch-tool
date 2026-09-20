/* ══════════════════════════════════════════════════════════════════════════
   HOW MANY LINES A CARD'S TEXT ACTUALLY TAKES
   packages/web2/src/canvas/textFit.ts

   `cardBox.ts` reserves ONE line box for the glance line and ONE for the title.
   Both can wrap, and when they do the declared box is short by exactly the rows
   nobody counted: measured in the running app, `svc:web2` declares 68 and paints
   83 because its `.nd-s` — "packages web2 · packages web2 test" — takes two line
   boxes, and 83 − 68 is one --lh-11.

   WHY THIS IS NOT MORE ARITHMETIC. `cardBox` is otherwise pure arithmetic off
   the type ramp, and that is why it is exact for every non-wrapping shape. But
   whether a string wraps is a fact about the FONT and the string, not about the
   ramp: the same 34 characters fit on one line in one face and two in another.
   No amount of derivation answers it. So this module measures, and everything
   that consumes it stays honest about the fact that it did.

   THE TWO ROWS BEHAVE DIFFERENTLY, and the difference is load-bearing:

     `.nd-s`  is `-webkit-line-clamp: 2`, so the answer is BINARY — one line if
              the string fits the content width, otherwise two, never three.
     `.nd-t`  has `overflow-wrap: anywhere` and NO clamp, so it is unbounded and
              needs real wrapping, including the mid-word break that
              `overflow-wrap` licenses when a single word is wider than the box.

   DETERMINISM (MADR amendment A4) IS PRESERVED, and the reading is worth stating
   because "we now measure" sounds like it breaks the law. A4 requires the same
   graph to produce the same picture. Text measurement is a pure function of the
   string, the face and the width — the same three inputs give the same count on
   every render, and the face is the one the browser is already painting with. It
   is no more variable than the card's own text, which was always measured by the
   engine that draws it. What would break A4 is a RANDOM or a time-dependent
   input, and there is neither here.
   ══════════════════════════════════════════════════════════════════════════ */

/** Width of `text` in CSS px when painted in `font` (a CSS `font` shorthand). */
export type TextMeasurer = (text: string, font: string) => number;

/**
 * The default measurer: one offscreen 2D context, created once and reused.
 *
 * A canvas measures with the SAME text shaper the compositor paints with, so a
 * width from here and the width on screen agree — which is the whole point, and
 * the reason this is not a character-count estimate.
 *
 * RETURNS null WHEN THERE IS NO CANVAS, rather than guessing. jsdom has no 2D
 * context, and a fabricated width there would make `cardHeight` disagree with a
 * real browser in a way that a jsdom test could never see — the exact shape of
 * "green but wrong" this file exists to remove. Callers treat null as "assume
 * one line", which is the pre-existing behaviour and therefore no regression.
 */
let cachedCtx: CanvasRenderingContext2D | null | undefined;
function context2d(): CanvasRenderingContext2D | null {
  if (cachedCtx !== undefined) return cachedCtx;
  try {
    const canvas = document.createElement('canvas');
    cachedCtx = canvas.getContext('2d');
  } catch {
    cachedCtx = null;
  }
  return cachedCtx;
}

export const measureWithCanvas: TextMeasurer = (text, font) => {
  const ctx = context2d();
  if (!ctx) return Number.NaN;
  ctx.font = font;
  return ctx.measureText(text).width;
};

/** True when the environment cannot measure — callers fall back to one line. */
export function canMeasureText(): boolean {
  return context2d() !== null;
}

/**
 * The two faces the card's wrapping rows are painted in, READ FROM THE LIVE
 * CASCADE rather than written down here.
 *
 * A literal `'10px Instrument Sans'` in this file would be the same defect the
 * repo has already been bitten by twice today: a TS constant re-deriving a
 * stylesheet value and drifting from it in silence. `CARD_FLOOR` disagreed with
 * `--board-card-floor` by 18 units that way, and a retired skill taught a whole
 * dead token vocabulary that browsers dropped without a word. So the sizes come
 * from the ramp at run time, and `boardRendered.test.ts` asserts that what this
 * composes equals the `font` a real browser computed for a real `.nd-s`.
 *
 * The card body inherits `--font-ui`; `.nd-s` is `--t-10` at book weight and
 * `.nd-t` is `--t-14` at `--fw-head`.
 */
function tokenValue(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw === '' ? fallback : raw;
}

export function glanceFont(): string {
  return `${tokenValue('--t-10', '10px')} ${tokenValue('--font-ui', 'sans-serif')}`;
}

export function titleFont(): string {
  return `${tokenValue('--fw-head', '600')} ${tokenValue('--t-14', '14px')} ${tokenValue('--font-ui', 'sans-serif')}`;
}

/**
 * How many line boxes `text` occupies in `width` px, wrapped the way CSS wraps.
 *
 * GREEDY, WORD-FIRST, WITH A MID-WORD FALLBACK — which is what CSS normal line
 * breaking does, and what `overflow-wrap: anywhere` adds to it. A word that fits
 * goes on the current line; one that does not starts a new line; one that is
 * wider than the whole box is split across as many lines as it needs, because
 * `.nd-t` licenses exactly that and a card whose title is one long identifier is
 * the case this must not under-count.
 *
 * `maxLines` is the clamp. `.nd-s` passes 2 and gets 2 for anything that
 * overflows, because `-webkit-line-clamp` truncates rather than growing — so
 * reserving a third row for a string that would have taken three is reserving
 * dead ground for ink the browser will never paint.
 */
export function wrappedLineCount(
  text: string,
  width: number,
  font: string,
  measure: TextMeasurer = measureWithCanvas,
  maxLines = Number.POSITIVE_INFINITY,
): number {
  const trimmed = text.trim();
  if (trimmed === '' || !(width > 0)) return 1;

  const full = measure(trimmed, font);
  /* Unmeasurable (no canvas): say one line and let the caller keep its old
     behaviour rather than invent a number. */
  if (!Number.isFinite(full)) return 1;
  if (full <= width) return 1;

  let lines = 1;
  let used = 0;
  for (const word of trimmed.split(/\s+/)) {
    const wordWidth = measure(word, font);
    if (!Number.isFinite(wordWidth)) return 1;
    const spaceWidth = used === 0 ? 0 : measure(' ', font);

    if (used + spaceWidth + wordWidth <= width) {
      used += spaceWidth + wordWidth;
      continue;
    }
    /* A word wider than the whole box breaks INSIDE itself — `overflow-wrap:
       anywhere`. Count the rows it fills and leave the remainder on the last
       one, so the next word continues beside it exactly as it would on screen. */
    if (wordWidth > width) {
      if (used > 0) lines += 1;
      const rows = Math.ceil(wordWidth / width);
      lines += rows - 1;
      used = wordWidth - (rows - 1) * width;
    } else {
      lines += 1;
      used = wordWidth;
    }
    if (lines >= maxLines) return maxLines;
  }
  return Math.min(lines, maxLines);
}
