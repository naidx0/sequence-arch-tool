/**
 * MATHS ON THE AI CANVAS — `$…$` and `$$…$$`, typeset by KaTeX.
 *
 * Owner, 2026-09-09, on what this surface should hold: "really cool boards,
 * math equations, and a lot of different language in that sense." Boards were
 * there (mermaid), languages arrived with the fence label; equations were the
 * one noun with nothing behind it. Design of record:
 * `docs/AI-CANVAS-IS-A-DOCUMENT.md` §5 item 1, which also rules the dependency.
 *
 * ── WHY A DEPENDENCY IS ALLOWED HERE ─────────────────────────────────────
 *
 * Local-first forbids fetching over the WIRE, not depending on a package.
 * KaTeX is bundled — its CSS and fonts land in `dist` like every other asset,
 * so the app still boots with no network. A hand-rolled typesetter would have
 * been the alternative and it would have been a lie about capability: partial
 * maths that silently mis-renders is worse than no maths, because the reader
 * cannot tell which case they are looking at.
 *
 * ── WHAT IT REFUSES TO DO ────────────────────────────────────────────────
 *
 * A LONE `$` IS NOT MATHS. Prose here is full of costs and shell snippets —
 * "it cost $5" and "$PATH" — and a renderer that treated the first `$` as an
 * opening delimiter would swallow the rest of the sentence into a formula. So
 * a span only counts when it OPENS and CLOSES on the same logical run and is
 * non-empty; anything else stays literal text.
 *
 * AND IT NEVER THROWS. KaTeX rejects malformed input, and a canvas that blanks
 * or crashes on one bad formula loses the whole document the model wrote. A
 * rejected span renders as its own SOURCE, verbatim, so the reader sees exactly
 * what the model asked for and can judge it — the honest-errors rule applied to
 * a renderer.
 *
 * PURE. A string in, a list of segments out; no React, no DOM.
 */

export type MathSegment =
  | { kind: 'text'; text: string }
  | { kind: 'math'; tex: string; display: boolean };

/**
 * Split a paragraph into text and maths runs.
 *
 * `$$…$$` is checked before `$…$` because the two-character delimiter is a
 * prefix of the one-character one; the other order would read the first `$` of
 * a display block as an inline open and never see the block at all.
 */
export function splitMath(source: string): MathSegment[] {
  const out: MathSegment[] = [];
  let text = '';
  let i = 0;

  const flush = () => {
    if (text !== '') out.push({ kind: 'text', text });
    text = '';
  };

  while (i < source.length) {
    const two = source.startsWith('$$', i);
    const one = source[i] === '$';
    if (!one && !two) {
      text += source[i];
      i += 1;
      continue;
    }

    const delim = two ? '$$' : '$';
    const close = source.indexOf(delim, i + delim.length);
    const tex = close === -1 ? '' : source.slice(i + delim.length, close);

    /*
     * THE TIGHT RULE, AND IT IS ONLY FOR THE ONE-CHARACTER DELIMITER.
     *
     * "it cost $5 to run and $PATH was set" has TWO dollars, and the first
     * version of this function opened at `$5`, found the next `$` at `$PATH`,
     * and swallowed the sentence between them into a formula — the exact
     * failure its own comment claimed to refuse. The unit tests missed it
     * because every prose case they tried had a SINGLE dollar in it.
     *
     * So an inline span must OPEN on a non-space and CLOSE on a non-space,
     * which is the rule every markdown-maths extension converges on: `$E=mc^2$`
     * qualifies, `$5 ... $PATH` does not, because the `$` before PATH is
     * preceded by a space and is therefore not a closing delimiter.
     *
     * `$$` keeps the permissive reading. Two characters are effectively
     * unambiguous in prose, and display maths is commonly written `$$ x $$`.
     */
    const opensTight = two || /\S/.test(source[i + 1] ?? '');
    const closesTight = two || (close > 0 && /\S/.test(source[close - 1] ?? ''));

    /* Unclosed, empty (`$$`, `$ $`), or a loose single `$` — not a formula.
       Kept as literal text so a price or a shell variable survives untouched. */
    if (close === -1 || tex.trim() === '' || !opensTight || !closesTight) {
      text += source[i];
      i += 1;
      continue;
    }

    flush();
    out.push({ kind: 'math', tex: tex.trim(), display: two });
    i = close + delim.length;
  }

  flush();
  return out;
}

/** True when a paragraph carries any maths at all — lets callers skip the work. */
export function hasMath(source: string): boolean {
  return splitMath(source).some((s) => s.kind === 'math');
}
