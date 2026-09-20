/* ══════════════════════════════════════════════════════════════════════════
   THE ANSWER, IN THE LANGUAGE IT WAS WRITTEN IN
   packages/web2/src/chat/proseBlocks.ts

   The transcript is the surface that displays every answer this product
   exists to give. For a long time it rendered a fenced code block as literal
   backticks in an unindented paragraph, and after that was fixed it drew the
   line at DELIMITED structure only — fences and paired backticks — and refused
   headings, lists, emphasis and everything else, on this argument:

     "if a marker can occur in code the model is quoting, it does not become
      formatting."

   That argument was right about the failure it named and wrong about where
   the failure lives. `#` IS a comment in shell and `- ` IS a diff removal —
   and a model quoting shell or a diff puts it in a fence, where everything
   has always been literal. What the refusal actually produced, measured on
   the owner's screen on 2026-09-13, was a lesson whose title read
   "## Design Proposal" and whose steps read "1. User input is parsed" with
   the markers painted as text: the seat saw the model's syntax instead of
   the model's answer. The owner: "the chat isn't native to the model's
   output language and it prints the direct output in code as well as the
   titles and stuff ('#', '<')". Decision 12 moved the line.

   ── WHERE THE LINE IS NOW ────────────────────────────────────────────────

     ✓ fenced code blocks      ``` … ```      literal inside, always
     ✓ inline code             `…`            only when the backtick is PAIRED
     ✓ headings                # … ###### …   at the start of a line, outside a fence
     ✓ lists                   - · * · 1.     a paragraph whose EVERY line is an item
     ✓ emphasis                **word**       a `<strong>`, never stripped to nothing
     ✓ disclosure              <details><summary>…</summary>…</details>

   And the guard survives in the two places it was ever true:

     FENCES WIN OVER EVERYTHING. A `#` inside a fence is a comment. A `- ` inside
     a fence is a removal. Nothing below is consulted until the fence closes.

     A LIST IS ALL-OR-NOTHING. A markdown list is a run of lines that ALL start
     with a bullet; a diff hunk is a run of lines where SOME start with `-` and
     others with `+` or with context. So a paragraph is a list only when every
     line in it is an item, and a hunk that mixes removal and addition stays a
     paragraph. The accepted cost, named so nobody rediscovers it: a hunk of
     ONLY removals, pasted outside a fence, reads as a bulleted list. A model
     that pastes a diff outside a fence has already made the larger mistake.

   What is still refused: `>` quotes (a redirect, and nobody asked), `|` tables
   (a pipe, and a half-drawn table is worse than a row of pipes), raw HTML other
   than the one disclosure element above. Each of those is a change to this
   header, not a quiet addition.

   PURE. Text in, blocks out. No React, no DOM.
   ══════════════════════════════════════════════════════════════════════════ */

/** A run of text with markers saying whether it is code, and whether it is strong. */
export interface ProseSpan {
  text: string;
  code: boolean;
  strong?: boolean;
}

export type ProseBlock =
  /** A paragraph, already split into literal, code and strong spans. */
  | { kind: 'para'; spans: ProseSpan[] }
  /**
   * A fenced code block, kept verbatim.
   *
   * `language` is the fence's info-string, lowercased, or null when it had
   * none. It is passed through rather than guessed: a fence tagged nothing is
   * not a fence tagged `text`, and highlighting it as one language or another
   * on a guess is a claim about code the model did not make.
   */
  | { kind: 'code'; text: string; language: string | null }
  /** `#`…`######` at the start of a line, outside a fence. */
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; spans: ProseSpan[] }
  /** A paragraph whose every line was an item. */
  | { kind: 'list'; ordered: boolean; items: ProseSpan[][] }
  /**
   * `<details>` … `</details>`, with the `<summary>` as its label and the body
   * parsed by the same rules as the top level. Unclosed while streaming is
   * still a details block, for the reason an unclosed fence is still code.
   */
  | { kind: 'details'; summary: ProseSpan[]; blocks: ProseBlock[] };

const FENCE = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9+#._-]*)\s*$/;
const HEADING = /^(#{1,6})[ \t]+(\S.*?)[ \t]*#*[ \t]*$/;
/* `+` is deliberately not a bullet: it is an addition line in every diff. */
const BULLET = /^[ \t]*[-*•][ \t]+(\S.*)$/;
const ORDERED = /^[ \t]*\d{1,3}[.)][ \t]+(\S.*)$/;
const DETAILS_OPEN = /^[ \t]*<details(?:\s[^>]*)?>[ \t]*(?:<summary>(.*?)<\/summary>)?[ \t]*(.*)$/i;
const DETAILS_CLOSE = /^[ \t]*<\/details>[ \t]*$/i;
const SUMMARY = /^[ \t]*<summary>(.*?)<\/summary>[ \t]*$/i;

/**
 * Split an answer into blocks.
 *
 * FENCES WIN OVER EVERYTHING. Scanning is line-based and stateful: once a
 * fence opens, every following line is literal until a matching close, so a
 * blank line inside a code block does not split it into paragraphs, a
 * backtick inside it is not inline code, and a `#` inside it is a comment.
 *
 * AN UNCLOSED FENCE IS STILL A CODE BLOCK. A streaming answer is unclosed for
 * as long as it is arriving, and re-flowing half of it as prose and then
 * snapping it into a block when the closing fence lands is a visible jump on
 * every answer that contains code. The same holds for an unclosed `<details>`.
 */
export function proseBlocks(text: string): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  const lines = text.split(/\r?\n/);

  let para: string[] = [];
  let fence: { marker: string; language: string | null; body: string[] } | null = null;
  let details: { summary: string | null; body: string[]; depth: number } | null = null;

  const flushPara = (): void => {
    const group = para;
    para = [];
    const joined = group.join('\n').trim();
    if (joined === '') return;
    blocks.push(classifyParagraph(group));
  };

  const closeDetails = (): void => {
    if (!details) return;
    blocks.push({
      kind: 'details',
      summary: inlineSpans(details.summary ?? 'Details'),
      blocks: proseBlocks(details.body.join('\n')),
    });
    details = null;
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

    if (details) {
      /* Nested disclosures are counted so the OUTER close is the one that
         closes. The body is parsed recursively, which is where a fence inside
         the disclosure gets its literal treatment. */
      if (DETAILS_OPEN.test(line)) {
        details.depth += 1;
        details.body.push(line);
        continue;
      }
      if (DETAILS_CLOSE.test(line)) {
        details.depth -= 1;
        if (details.depth === 0) closeDetails();
        else details.body.push(line);
        continue;
      }
      const summary = details.depth === 1 && details.summary === null ? SUMMARY.exec(line) : null;
      if (summary) {
        details.summary = summary[1]!.trim();
        continue;
      }
      details.body.push(line);
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

    const open = DETAILS_OPEN.exec(line);
    if (open) {
      flushPara();
      const summary = open[1] !== undefined ? open[1].trim() : null;
      const rest = open[2]!.trim();
      details = { summary, body: [], depth: 1 };
      /* `<details><summary>x</summary>body…</details>` on ONE line. */
      if (DETAILS_CLOSE.test(rest)) {
        closeDetails();
      } else if (rest !== '') {
        if (/<\/details>\s*$/i.test(rest)) {
          details.body.push(rest.replace(/<\/details>\s*$/i, ''));
          closeDetails();
        } else {
          details.body.push(rest);
        }
      }
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushPara();
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        spans: inlineSpans(heading[2]!),
      });
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
  if (details) closeDetails();

  return blocks;
}

/**
 * A paragraph is a list only when EVERY line is an item. See the header for
 * why: a diff hunk mixes `-` with `+` and context, and stays a paragraph.
 */
function classifyParagraph(group: string[]): ProseBlock {
  const lines = group.filter((l) => l.trim() !== '');
  const bullets = lines.map((l) => BULLET.exec(l));
  if (lines.length > 0 && bullets.every((m) => m !== null)) {
    return { kind: 'list', ordered: false, items: bullets.map((m) => inlineSpans(m![1]!)) };
  }
  const ordered = lines.map((l) => ORDERED.exec(l));
  if (lines.length > 0 && ordered.every((m) => m !== null)) {
    return { kind: 'list', ordered: true, items: ordered.map((m) => inlineSpans(m![1]!)) };
  }
  return { kind: 'para', spans: inlineSpans(group.join('\n').trim()) };
}

/*
 * WHAT SEPARATES EMPHASIS FROM A GLOB, AND IT IS NOT THE SLASH.
 *
 * This guard used to ban `/` inside the pair, to stop `src/**` being read as
 * emphasis. Measured on the owner's screen 2026-09-13, in a lesson this
 * product had just generated: `**Input/Request Stage**` and `**Read/Write
 * Mix**` painted their asterisks, in a list where every neighbour WITHOUT a
 * slash rendered bold. The guard was catching ordinary English — a slash
 * between two words is a pair, not a path — and it failed in the one surface
 * whose whole job is fidelity.
 *
 * TWO RULES REPLACE IT, and together they refuse strictly less than the slash
 * ban did while still refusing every glob:
 *
 *   `[^*\n]` — the inner span holds no star. A glob's stars come in a run, so
 *   the character after an opening pair is itself a star and the match dies
 *   there. Probed on the real strings: `src/**` + `/*.ts` never matched even
 *   with slashes allowed, so the slash ban was never the thing doing this work.
 *
 *   NO EDGE WHITESPACE — markdown's own rule, and the one that actually
 *   separates emphasis from two globs in one sentence. `src/** and dist/**`
 *   opens on the first pair and its inner span would begin with a space, so it
 *   is refused; `**Read/Write Mix**` has no edge space, so it is emphasis.
 *
 * The accepted cost, named here rather than rediscovered: `**a**b**c**` —
 * emphasis abutting emphasis with no space between — takes the outer pair.
 * Markdown's own parsers disagree with each other about that case.
 */
const STRONG = /\*\*(?!\s)([^*\n]+)(?<!\s)\*\*/g;

/**
 * Remove paired `**…**` emphasis markers from prose.
 *
 * Kept for callers that want plain text (a title, a notification). The
 * transcript itself no longer strips emphasis — it renders it — and both
 * read the ONE pattern above, so a caller stripping markers can never disagree
 * with the surface rendering them about what a marker is.
 */
export function stripDecorativeEmphasis(text: string): string {
  return text.replace(new RegExp(STRONG.source, 'g'), '$1');
}

/**
 * Split a paragraph into literal, inline-code and strong spans.
 *
 * ONLY PAIRED BACKTICKS. An unmatched backtick stays a backtick: a lone one in
 * prose is far more likely to be punctuation the model typed than the start of
 * a code span it forgot to close, and swallowing the rest of the paragraph
 * into a code style would be a much louder error than showing the character.
 *
 * Emphasis is found only in the literal spans — never inside a code span, so
 * `src/**` in backticks is code and not the start of anything.
 */
export function inlineSpans(text: string): ProseSpan[] {
  const spans: ProseSpan[] = [];
  let rest = text;

  const pushLiteral = (literal: string): void => {
    let last = 0;
    /* A fresh regex per call: STRONG is a module-level /g pattern and a
       shared lastIndex would skip matches between paragraphs. */
    for (const m of literal.matchAll(new RegExp(STRONG.source, 'g'))) {
      const at = m.index ?? 0;
      if (at > last) spans.push({ text: literal.slice(last, at), code: false });
      spans.push({ text: m[1]!, code: false, strong: true });
      last = at + m[0].length;
    }
    if (last < literal.length) spans.push({ text: literal.slice(last), code: false });
  };

  while (rest.length > 0) {
    const open = rest.indexOf('`');
    if (open === -1) break;

    const close = rest.indexOf('`', open + 1);
    if (close === -1) break; // unpaired — the remainder is literal

    if (open > 0) pushLiteral(rest.slice(0, open));
    const inner = rest.slice(open + 1, close);
    /* An empty span (``) is two literal backticks, not a code span of
       nothing — rendering a zero-width chip is a mark with no content. */
    if (inner === '') spans.push({ text: '``', code: false });
    else spans.push({ text: inner, code: true });
    rest = rest.slice(close + 1);
  }

  if (rest.length > 0) pushLiteral(rest);
  return spans.length > 0 ? spans : [{ text, code: false }];
}
