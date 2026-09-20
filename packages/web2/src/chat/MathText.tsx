import katex from 'katex';
import 'katex/dist/katex.min.css';

import { splitMath } from '../app/canvasMath';

/**
 * MATHS, TYPESET, IN BOTH PLACES THAT HAVE PROSE.
 *
 * Owner, 2026-09-19: "fix also the embed in the chat output — math functions
 * should be output properly as if they were in Obsidian."
 *
 * The AI Canvas has typeset `$…$` and `$$…$$` since the maths wave. The chat
 * transcript — the surface a person actually reads most turns — did not: it
 * printed the dollars. So the product typeset maths in the document it writes
 * and not in the sentence it says, which is the same renderer answering one
 * question two ways.
 *
 * ── WHY THIS FILE EXISTS RATHER THAN A SECOND COPY ────────────────────────
 *
 * `canvasMath.splitMath` already holds the hard part and the argument for it —
 * a lone `$` is not maths, because prose here is full of "it cost $5" and
 * "$PATH", so a span only counts when it opens and closes. That rule must not
 * be re-derived: two parsers of one syntax become one reader's bug report
 * about a sentence that renders differently in two panes.
 *
 * `family` is the only thing the two callers disagree about, and they disagree
 * about it for a good reason: the canvas's stylesheet and its locks name
 * `ai-canvas-math`, and the chat's name `prose-math`. One component, two
 * vocabularies, no second implementation.
 */

/**
 * One maths run, typeset — or its own source when KaTeX will not have it.
 *
 * NEVER THROWS. KaTeX rejects malformed input, and a surface that blanks or
 * crashes on one bad formula loses the whole answer the model wrote. A
 * rejected span renders as the SOURCE the model asked for, verbatim, so the
 * reader can see and judge it. That is the honest-errors rule applied to a
 * renderer: the one outcome a reader cannot act on is silence.
 *
 * `dangerouslySetInnerHTML` is safe here in the one way that matters: the HTML
 * is produced by KaTeX from the tex, not taken from the payload, and KaTeX's
 * own output is escaped. The raw payload never reaches the DOM as markup.
 */
export function MathRun({
  tex,
  display,
  family,
}: {
  tex: string;
  display: boolean;
  family: string;
}) {
  let html: string | null = null;
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: true });
  } catch {
    html = null;
  }
  if (html === null) {
    return (
      <code className={`${family}-math-raw`} data-testid={`${family}-math-raw`}>
        {display ? `$$${tex}$$` : `$${tex}$`}
      </code>
    );
  }
  return (
    <span
      className={display ? `${family}-math ${family}-math-display` : `${family}-math`}
      data-testid={`${family}-math`}
      data-display={display ? 'true' : undefined}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** A run of text with any maths in it typeset in place. */
export function withMath(text: string, key: string, family: string): JSX.Element[] {
  return splitMath(text).map((seg, i) =>
    seg.kind === 'text' ? (
      <span key={`${key}-t${i}`}>{seg.text}</span>
    ) : (
      <MathRun key={`${key}-m${i}`} tex={seg.tex} display={seg.display} family={family} />
    ),
  );
}
