/* ══════════════════════════════════════════════════════════════════════════
   BOUNDED STRUCTURE IN AN ANSWER — fences and inline code, and nothing else
   packages/web2/src/chat/proseBlocks.ts

   The transcript is the surface that displays every answer this product
   exists to give, and it rendered a fenced code block as literal backticks in
   an unindented paragraph. Grounded answers are full of paths, snippets and
   diffs; the renderer could not format a path.

   ── WHAT THIS DELIBERATELY DOES NOT DO, AND WHY ──────────────────────────

   `paragraphs()` carried a guard that is exactly right and is the reason this
   file has the shape it does:

     "This is NOT a markdown renderer and must not become one by accident:
      paragraph breaks are the only structure the transcript promises today,
      and a half-implemented markdown pass is how a diff, a path or a `**` in a
      filename starts rendering as emphasis in the one surface whose job is to
      reproduce what the engine said."

   So the line is drawn at DELIMITED structure — constructs with an explicit
   opening and closing marker, which cannot be produced by accident:

     ✓ fenced code blocks      ``` … ```      opened and closed explicitly
     ✓ inline code             `…`            only when the backtick is PAIRED

   And everything ambiguous is refused:

     ✗ EMPHASIS RENDER. `**` appears in globs, in diffs and in shell. Rendering
       it as bold is the guard's own example of the failure. Decorative
       `**word**` markers ARE stripped from prose (asterisk soup → words) when
       the inner span has no `/` or `*` — path globs with nested stars stay intact.
     ✗ LISTS. A markdown bullet is "- " and a diff removal line is "- " just as
       often. This product's answers are full of diffs, so a list pass would
       turn deleted code into bullets — silently, and in the one surface whose
       job is fidelity.
     ✗ HEADINGS, QUOTES, TABLES. Same test, same answer: `#` is a comment in
       shell and Python, `>` is a redirect, and `|` is a pipe.

   The rule those four share: if a marker can occur in code the model is
   quoting, it does not become formatting. Inside a fence everything is
   literal, which is what makes the fence itself safe.

   PURE. Text in, blocks out. No React, no DOM.
   ══════════════════════════════════════════════════════════════════════════ */

/** A run of text with a marker saying whether it is code. */
export interface ProseSpan {
  text: string;
  code: boolean;
}

export type ProseBlock =
  /** A paragraph, already split into literal and inline-code spans. */
  | { kind: 'para'; spans: ProseSpan[] }
  /**
   * A fenced code block, kept verbatim.
   *
   * `language` is the fence's info-string, lowercased, or null when it had
   * none. It is passed through rather than guessed: a fence tagged nothing is
   * not a fence tagged `text`, and highlighting it as one language or another
   * on a guess is a claim about code the model did not make.
   */
  | { kind: 'code'; text: string; language: string | null };

const FENCE = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9+#._-]*)\s*$/;

/**
 * Split an answer into blocks.
 *
 * FENCES WIN OVER EVERYTHING. Scanning is line-based and stateful: once a
 * fence opens, every following line is literal until a matching close, so a
 * blank line inside a code block does not split it into paragraphs and a
 * backtick inside it is not inline code.
 *
 * AN UNCLOSED FENCE IS STILL A CODE BLOCK. A streaming answer is unclosed for
 * as long as it is arriving, and re-flowing half of it as prose and then
 * snapping it into a block when the closing fence lands is a visible jump on
 * every answer that contains code.
 */
export function proseBlocks(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  const lines = text.split(/\r?\n/);

  let para: string[] = [];
  let fence: { marker: string; language: string | null; body: string[] } | null = null;

  const flushPara = (): void => {
    const joined = para.join('\n').trim();
    para = [];
    if (joined !== '') {
      /* Strip decorative **emphasis** in prose only — fences stay literal.
         Path globs with nested stars are preserved (inner may not contain `/` or `*`). */
      blocks.push({ kind: 'para', spans: inlineSpans(stripDecorativeEmphasis(joined)) });
    }
  };

  for (const line of lines) {
    const match = FENCE.exec(line);

    if (fence) {
      /* Closed only by the same marker character. A ``` inside a ~~~ block is
         content, which is how a fenced example of markdown survives. */
      if (match && match[1]!.startsWith(fence.marker[0]!) && match[1]!.length >= fence.marker.length) {
        blocks.push({ kind: 'code', text: fence.body.join('\n'), language: fence.language });
        fence = null;
      } else {
        fence.body.push(line);
      }
      continue;
    }

    if (match) {
      flushPara();
      fence = {
        marker: match[1]!,
        language: match[2] ? match[2].toLowerCase() : null,
        body: [],
      };
      continue;
    }

    if (line.trim() === '') flushPara();
    else para.push(line);
  }

  if (fence) {
    /* Still open. See above: this is a streaming answer mid-block, and it is
       drawn as the code block it is going to be. */
    blocks.push({ kind: 'code', text: fence.body.join('\n'), language: fence.language });
  }
  flushPara();

  return blocks;
}

/**
 * Remove paired `**…**` emphasis markers from prose.
 *
 * Owner seat (2026-08-26): answers arrived as asterisk soup (`**Hermes**`,
 * `**Memory**`) because the transcript deliberately does not render markdown
 * bold. Stripping the markers recovers readable prose WITHOUT becoming a
 * markdown renderer — path globs with nested stars stay untouched because
 * the inner span may not contain `/` or `*`.
 */
export function stripDecorativeEmphasis(text: string): string {
  return text.replace(/\*\*([^*\n/]+)\*\*/g, '$1');
}

/**
 * Split a paragraph into literal and inline-code spans.
 *
 * ONLY PAIRED BACKTICKS. An unmatched backtick stays a backtick: a lone one in
 * prose is far more likely to be punctuation the model typed than the start of
 * a code span it forgot to close, and swallowing the rest of the paragraph
 * into a code style would be a much louder error than showing the character.
 */
export function inlineSpans(text: string): ProseSpan[] {
  const spans: ProseSpan[] = [];
  let rest = text;

  while (rest.length > 0) {
    const open = rest.indexOf('`');
    if (open === -1) break;

    const close = rest.indexOf('`', open + 1);
    if (close === -1) break; // unpaired — the remainder is literal

    if (open > 0) spans.push({ text: rest.slice(0, open), code: false });
    const inner = rest.slice(open + 1, close);
    /* An empty span (``) is two literal backticks, not a code span of
       nothing — rendering a zero-width chip is a mark with no content. */
    if (inner === '') spans.push({ text: '``', code: false });
    else spans.push({ text: inner, code: true });
    rest = rest.slice(close + 1);
  }

  if (rest.length > 0) spans.push({ text: rest, code: false });
  return spans.length > 0 ? spans : [{ text, code: false }];
}
