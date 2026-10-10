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

   Round 9 (Jaden, 2026-10-06: "allow for bold headers to be used", "the
   overall chat interface is just hard to read") moves the line again, each
   with the guard that keeps it honest:

     ✓ quotes                  > …            a paragraph whose EVERY line starts `> `
     ✓ tables                  | a | b |      a header row, then a `|---|` separator
                                              row; without the separator it is text,
                                              so `a | b` in a sentence stays a pipe
     ✓ italics                 *word* _word_  single markers hugging a word; never
                                              inside code, never a glob's `*`
     ✓ rules                   --- *** ___    a line of only that, outside a fence

   What is still refused: raw HTML other than the one disclosure element above.
   That is a change to this header, not a quiet addition.

   PURE. Text in, blocks out. No React, no DOM.
   ══════════════════════════════════════════════════════════════════════════ */

/** A run of text with markers saying whether it is code, and whether it is strong. */
export interface ProseSpan {
  text: string;
  code: boolean;
  strong?: boolean;
  /** `*word*` or `_word_` (round 9). */
  em?: boolean;
  /** A markdown link's target: the text is its label (UX audit: codex cites files as `[main.py](C:\...\main.py)`). */
  link?: string;
}

/** `[label](target)`; a Windows target keeps its backslashes and may hold spaces. */
const LINK = /\[([^\]\n]+)\]\(([^)\n]+)\)/g;

/** Is this link target a file on this machine (an absolute path), not a web address? */
export const isLocalPath = (target: string): boolean => /^[A-Za-z]:[\\/]/.test(target) || target.startsWith('/') || target.startsWith('file:');

/** Split the literal spans on markdown links; code spans are never links. */
function withLinks(spans: ProseSpan[]): ProseSpan[] {
  const out: ProseSpan[] = [];
  for (const span of spans) {
    if (span.code || !span.text.includes('](')) {
      out.push(span);
      continue;
    }
    let last = 0;
    for (const m of span.text.matchAll(LINK)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ ...span, text: span.text.slice(last, at) });
      out.push({ ...span, text: m[1]!, link: m[2]!.trim() });
      last = at + m[0].length;
    }
    if (last < span.text.length) out.push({ ...span, text: span.text.slice(last) });
  }
  return out;
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
  | { kind: 'code'; text: string; language: string | null; open?: true; /** ```svg id=d3: redraws drawing d3 as a new version. */ drawingId?: string }
  /** `#`…`######` at the start of a line, outside a fence. */
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; spans: ProseSpan[] }
  /** A paragraph whose every line was an item. */
  | { kind: 'list'; ordered: boolean; items: ProseSpan[][]; /** Round 12: per item, the indented list under it (null when none). */ nested?: (ProseBlock | null)[]; /** Round 12: the first number of an ordered list that a fence or paragraph split. */ start?: number }
  /**
   * `<details>` … `</details>`, with the `<summary>` as its label and the body
   * parsed by the same rules as the top level. Unclosed while streaming is
   * still a details block, for the reason an unclosed fence is still code.
   */
  | { kind: 'details'; summary: ProseSpan[]; blocks: ProseBlock[] }
  /** A paragraph whose every line started `> `, its body parsed by the same rules (round 9). */
  | { kind: 'quote'; blocks: ProseBlock[] }
  /** A pipe table with its separator row (round 9). */
  | { kind: 'table'; align: ('left' | 'center' | 'right' | null)[]; head: ProseSpan[][]; rows: ProseSpan[][][] }
  /** `---` on a line of its own (round 9). */
  | { kind: 'rule' };

/* ```svg id=d3 is an update of drawing d3 (a new version), not a new drawing (lane visual). */
const FENCE = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9+#._-]*)(?:[ \t]+id=(d[0-9]{1,6}))?\s*$/;
/* ```visual {json}``` on one line, or ```visual {json} with the closing fence on the next line (or none): the
   form the visual tool tells agents to write. The info string carries a JSON object, so FENCE never matches it. */
const VISUAL_INLINE = /^\s*(`{3,})[ \t]*visual[ \t]+(\{.*?)[ \t]*(?:`{3,})?[ \t]*$/;
const LONE_FENCE = /^\s*`{3,}[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(\S.*?)[ \t]*#*[ \t]*$/;
/* `+` is deliberately not a bullet: it is an addition line in every diff. */
const BULLET = /^[ \t]*[-*•][ \t]+(\S.*)$/;
const ORDERED = /^[ \t]*\d{1,3}[.)][ \t]+(\S.*)$/;
const DETAILS_OPEN = /^[ \t]*<details(?:\s[^>]*)?>[ \t]*(?:<summary>(.*?)<\/summary>)?[ \t]*(.*)$/i;
const DETAILS_CLOSE = /^[ \t]*<\/details>[ \t]*$/i;
const SUMMARY = /^[ \t]*<summary>(.*?)<\/summary>[ \t]*$/i;
/* `> ` at the start of a line (a shell redirect never starts one). */
const QUOTE = /^[ \t]{0,3}>(?:[ \t]|$)(.*)$/;
const RULE = /^[ \t]{0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const TABLE_SEP = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/;

/** A one-line visual fence that is whole (its JSON object closed): while streaming, a half-typed one waits. */
const closesInline = (line: string): boolean => {
  const m = VISUAL_INLINE.exec(line);
  if (!m) return false;
  try {
    JSON.parse(m[2]!);
    return true;
  } catch {
    return false;
  }
};

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
export function proseBlocks(text: string, streaming = false): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  const lines = text.split(/\r?\n/);

  let para: string[] = [];
  let fence: { marker: string; language: string | null; body: string[]; drawingId?: string } | null = null;
  let details: { summary: string | null; body: string[]; depth: number } | null = null;

  const flushPara = (): void => {
    const group = para;
    para = [];
    const joined = group.join('\n').trim();
    if (joined === '') return;
    for (const piece of splitAtTable(group)) blocks.push(classifyParagraph(piece));
  };

  const closeDetails = (): void => {
    if (!details) return;
    blocks.push({
      kind: 'details',
      summary: inlineSpans(details.summary ?? 'Details'),
      blocks: proseBlocks(details.body.join('\n'), streaming),
    });
    details = null;
  };

  /* A raw <svg> … </svg> in the prose is drawn as an svg block (lines kept verbatim). */
  let rawSvg: string[] | null = null;
  let skipTo = -1;
  for (const [li, line] of lines.entries()) {
    if (li <= skipTo) continue;
    if (rawSvg) {
      /* Final text, no </svg> anywhere ahead: the drawing ends at its first blank line, so the prose
         and headings after it still render. (While streaming the closing tag may simply not have come yet.) */
      if (!streaming && line.trim() === '' && !closesBeforeNextOpen(lines, li + 1)) {
        blocks.push({ kind: 'code', text: rawSvg.join('\n'), language: 'svg' });
        rawSvg = null;
        continue;
      }
      rawSvg.push(line);
      if (/<\/svg>\s*$/i.test(line)) {
        blocks.push({ kind: 'code', text: rawSvg.join('\n'), language: 'svg' });
        rawSvg = null;
      }
      continue;
    }
    const match = FENCE.exec(line);

    if (fence) {
      /* Closed only by the same marker character. A ``` inside a ~~~ block is
         content, which is how a fenced example of markdown survives. */
      if (match && match[1]!.startsWith(fence.marker[0]!) && match[1]!.length >= fence.marker.length) {
        blocks.push({ kind: 'code', text: fence.body.join('\n'), language: fence.language, ...(fence.drawingId ? { drawingId: fence.drawingId } : {}) });
        fence = null;
      } else {
        fence.body.push(line);
      }
      continue;
    }

    if (!details && !rawSvg) {
      const inline = VISUAL_INLINE.exec(line);
      if (inline && !(streaming && li === lines.length - 1 && !closesInline(line))) {
        /* The one-line form is a complete block: take a lone closing fence after it too, so it cannot open an empty block that swallows the answer. */
        flushPara();
        blocks.push({ kind: 'code', text: inline[2]!, language: 'visual' });
        if (li + 1 < lines.length && LONE_FENCE.test(lines[li + 1]!)) skipTo = li + 1;
        continue;
      }
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

    if (!fence && !details && /^\s*<svg[\s>]/i.test(line)) {
      flushPara();
      if (/<\/svg>\s*$/i.test(line)) blocks.push({ kind: 'code', text: line, language: 'svg' });
      else rawSvg = [line];
      continue;
    }

    if (match) {
      flushPara();
      fence = {
        marker: match[1]!,
        language: match[2] ? match[2].toLowerCase() : null,
        body: [],
        ...(match[3] ? { drawingId: match[3] } : {}),
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

    if (RULE.test(line) && para.length === 0) {
      blocks.push({ kind: 'rule' });
      continue;
    }

    if (line.trim() === '') flushPara();
    else para.push(line);
  }

  if (fence) {
    /* Still open. See above: this is a streaming answer mid-block, and it is
       drawn as the code block it is going to be. */
    blocks.push({ kind: 'code', text: fence.body.join('\n'), language: fence.language, ...(fence.drawingId ? { drawingId: fence.drawingId } : {}), open: true });
  }
  if (rawSvg) blocks.push({ kind: 'code', text: rawSvg.join('\n'), language: 'svg', ...(streaming ? { open: true } : {}) });
  flushPara();
  if (details) closeDetails();

  return blocks;
}

/**
 * Cut an answer into pieces that parse independently: at blank lines that sit
 * at the top level, outside any fence and any `<details>`. At such a line the
 * parser above holds no state (no open paragraph, fence or disclosure), so
 * `proseBlocks(whole)` equals the blocks of each piece in order.
 *
 * WHY: a streamed answer only ever grows at its end. Every piece but the last
 * is finished and its blocks never change, so a renderer can parse and draw
 * each piece once and keep it, and a new chunk costs only the open piece. The
 * same fence and disclosure rules as `proseBlocks` decide what "inside" means.
 */
export function proseSegments(text: string): string[] {
  return scanSegments(text).segments;
}

/**
 * The pieces, plus `closedAt`: the character offset where the text after the
 * last finished piece begins. Everything before it is final.
 */
export function scanSegments(text: string): { segments: string[]; closedAt: number; closed: number } {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  /* Character offset of each line's start, so `closedAt` can be reported. */
  const offsets: number[] = [];
  {
    let at = 0;
    for (const l of lines) {
      offsets.push(at);
      at += l.length;
      if (text[at] === '\r') at += 1;
      at += 1;
    }
  }
  let start = 0;
  let fence: string | null = null;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const match = FENCE.exec(line);
    if (fence) {
      if (match && match[1]!.startsWith(fence[0]!) && match[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (depth > 0) {
      if (DETAILS_OPEN.test(line)) depth += 1;
      else if (DETAILS_CLOSE.test(line)) depth -= 1;
      continue;
    }
    if (match) {
      fence = match[1]!;
      continue;
    }
    const open = DETAILS_OPEN.exec(line);
    if (open) {
      if (!/<\/details>\s*$/i.test(open[2]!.trim())) depth = 1;
      continue;
    }
    /* The last line has no newline after it yet: in a stream it may still
       grow, so it is never taken for a blank line that closes a piece. */
    if (i === lines.length - 1) continue;
    if (line.trim() === '' && i > start) {
      out.push(lines.slice(start, i).join('\n'));
      start = i + 1;
    } else if (line.trim() === '') {
      start = i + 1;
    }
  }
  const closed = out.length;
  const closedAt = start < lines.length ? offsets[start]! : text.length;
  if (start < lines.length) out.push(lines.slice(start).join('\n'));
  return { segments: out, closedAt, closed };
}

/**
 * `scanSegments` for a text that grew from `prev.text`: the finished pieces
 * are kept and only the text after them is scanned again. Anything that is
 * not a pure append is scanned whole.
 */
export function growSegments(
  prev: { text: string; segments: string[]; closedAt: number; closed: number } | null,
  text: string,
): { text: string; segments: string[]; closedAt: number; closed: number } {
  if (!prev || prev.closed === 0 || !text.startsWith(prev.text)) return { text, ...scanSegments(text) };
  const tail = scanSegments(text.slice(prev.closedAt));
  return {
    text,
    segments: [...prev.segments.slice(0, prev.closed), ...tail.segments],
    closedAt: prev.closedAt + tail.closedAt,
    closed: prev.closed + tail.closed,
  };
}

/**
 * A paragraph is a list only when EVERY line is an item. See the header for
 * why: a diff hunk mixes `-` with `+` and context, and stays a paragraph.
 */
/** One table row's cells: the pipes at the edges are optional; `\|` is a literal pipe. */
function tableCells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  return body.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

/**
 * A TABLE ONLY WITH ITS SEPARATOR. The second line must be `|---|---|`
 * (colons for alignment), and every line must hold a pipe. Without the
 * separator it is a sentence with a pipe in it, and stays one.
 */
function classifyTable(lines: string[]): ProseBlock | null {
  if (lines.length < 2 || !TABLE_SEP.test(lines[1]!) || !lines[1]!.includes('-')) return null;
  if (!lines.every((l) => l.includes('|'))) return null;
  const head = tableCells(lines[0]!);
  const align = tableCells(lines[1]!).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null));
  if (head.length < 2 && align.length < 2 && !lines[0]!.trim().startsWith('|')) return null;
  if (align.length !== head.length) return null;
  const width = head.length;
  const rows = lines.slice(2).map((l) => {
    const cells = tableCells(l);
    while (cells.length < width) cells.push('');
    return cells.slice(0, width).map(inlineSpans);
  });
  return { kind: 'table', align: align.slice(0, width), head: head.map(inlineSpans), rows };
}

/**
 * A list: every line an item. Items indented deeper than the first belong to
 * the item above them and are read as a list of their own (round 12: an agent's
 * numbered steps with bullets under them used to fall to a paragraph with raw
 * markers). The top level must be all bullets or all numbers.
 */
function classifyList(lines: string[]): ProseBlock | null {
  if (lines.length === 0) return null;
  type Row = { indent: number; ordered: boolean; text: string; raw: string; cont: boolean; n: number | null };
  const parsed = lines.map((l): Row | null => {
    const indent = /^[ \t]*/.exec(l)![0].replace(/\t/g, '    ').length;
    const b = BULLET.exec(l);
    const o = b ? null : ORDERED.exec(l);
    const m = b ?? o;
    if (m) return { indent, ordered: o !== null, text: m[1]!, raw: l, cont: false, n: o ? Number(/\d+/.exec(l)![0]) : null };
    /* An indented line that is not an item continues the item above it. */
    if (indent > 0 && l.trim() !== '') return { indent, ordered: false, text: l.trim(), raw: l, cont: true, n: null };
    return null;
  });
  if (parsed.some((p) => p === null)) return null;
  const rows = parsed as Row[];
  const items = rows.filter((r) => !r.cont);
  if (items.length === 0 || rows[0]!.cont) return null;
  const base = Math.min(...items.map((i) => i.indent));
  const top = items.filter((i) => i.indent === base);
  if (!top.every((i) => i.ordered === top[0]!.ordered)) return null;
  if (rows[0]!.indent !== base) return null;
  const texts: string[] = [];
  const nested: (ProseBlock | null)[] = [];
  let subs: string[] = [];
  let failed = false;
  const flush = () => {
    if (texts.length === 0) return;
    const sub = subs.length ? classifyList(subs) : null;
    if (subs.length && !sub) failed = true;
    nested[texts.length - 1] = sub;
    subs = [];
  };
  for (const r of rows) {
    if (!r.cont && r.indent === base) {
      flush();
      texts.push(r.text);
    } else if (r.cont && subs.length === 0) texts[texts.length - 1] += ` ${r.text}`;
    else subs.push(r.raw);
  }
  flush();
  if (failed) return null;
  const out: Extract<ProseBlock, { kind: 'list' }> = { kind: 'list', ordered: top[0]!.ordered, items: texts.map(inlineSpans) };
  if (nested.some((n) => n !== null)) out.nested = nested;
  /* A numbered list that starts past 1 (a fence split it) keeps its number. */
  if (out.ordered && top[0]!.n !== null && top[0]!.n !== 1) out.start = top[0]!.n;
  return out;
}

/**
 * A TABLE NEEDS NO BLANK LINE AROUND IT (GitHub's own rule): "Results:" on one line and the header on the next
 * is a sentence and a table, not one paragraph with pipes in it. Cut a paragraph group at an embedded
 * header-plus-separator pair, where the table runs while its lines hold a pipe. A group that is quoted, or that
 * is already a table from its first line to its last, is left whole.
 */
function splitAtTable(group: string[]): string[][] {
  const lines = group.filter((l) => l.trim() !== '');
  if (lines.some((l) => QUOTE.test(l))) return [group];
  for (let i = 0; i + 1 < lines.length; i += 1) {
    if (!lines[i]!.includes('|') || !TABLE_SEP.test(lines[i + 1]!) || !lines[i + 1]!.includes('-')) continue;
    /* GitHub: the separator must have exactly as many columns as the header, or it is not a table. */
    if (tableCells(lines[i + 1]!).length !== tableCells(lines[i]!).length) continue;
    let j = i + 2;
    while (j < lines.length && lines[j]!.includes('|')) j += 1;
    if (i === 0 && j === lines.length) return [group];
    const out: string[][] = [];
    if (i > 0) out.push(lines.slice(0, i));
    out.push(lines.slice(i, j));
    if (j < lines.length) out.push(...splitAtTable(lines.slice(j)));
    return out;
  }
  return [group];
}

function classifyParagraph(group: string[]): ProseBlock {
  const lines = group.filter((l) => l.trim() !== '');
  const quoted = lines.map((l) => QUOTE.exec(l));
  if (lines.length > 0 && quoted.every((m) => m !== null)) {
    return { kind: 'quote', blocks: proseBlocks(quoted.map((m) => m![1]!).join('\n')) };
  }
  const table = classifyTable(lines);
  if (table) return table;
  const list = classifyList(lines);
  if (list) return list;
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
/* A soft line break inside a pair is still inside it: a paragraph never holds a blank line, so `[^*]` cannot span paragraphs. */
const STRONG = /\*\*(?!\s)([^*]+)(?<!\s)\*\*/g;

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
/*
 * ── BOLD THAT CONTAINS CODE (photo 3, 2026-09-22) ─────────────────────────
 *
 * The model wrote `**Proposing a new `svc:local-harness` service with a
 * `db_read` edge.**` and the reader saw the asterisks. Code spans were split
 * out FIRST, which left the opening `**` in one literal and the closing `**`
 * in another, so no pair was ever seen. A small model writing about
 * identifiers does this in nearly every emphasised sentence.
 *
 * So the code spans are MASKED, not split: each becomes one private-use
 * placeholder with no whitespace and no asterisk in it, STRONG runs over the
 * masked line with every one of its rules unchanged, and the placeholders are
 * expanded back inside whichever span they landed in. A code span inside a
 * strong pair is strong code; one outside is plain code, as before.
 */
const CODE_OPEN = '\uE000';
const CODE_CLOSE = '\uE001';
const CODE_MARK = new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, 'g');

export function inlineSpans(text: string): ProseSpan[] {
  const codes: string[] = [];
  let masked = '';
  let rest = text;

  while (rest.length > 0) {
    const open = rest.indexOf('`');
    if (open === -1) break;

    const close = rest.indexOf('`', open + 1);
    if (close === -1) break; // unpaired — the remainder is literal

    masked += rest.slice(0, open);
    const inner = rest.slice(open + 1, close);
    /* An empty span (``) is two literal backticks, not a code span of
       nothing — rendering a zero-width chip is a mark with no content. */
    if (inner === '') masked += '``';
    else {
      masked += `${CODE_OPEN}${codes.length}${CODE_CLOSE}`;
      codes.push(inner);
    }
    rest = rest.slice(close + 1);
  }
  masked += rest;

  const spans: ProseSpan[] = [];
  const expand = (segment: string, strong: boolean): void => {
    let last = 0;
    for (const m of segment.matchAll(CODE_MARK)) {
      const at = m.index ?? 0;
      if (at > last) {
        spans.push({ text: segment.slice(last, at), code: false, ...(strong ? { strong: true } : {}) });
      }
      spans.push({ text: codes[Number(m[1])]!, code: true, ...(strong ? { strong: true } : {}) });
      last = at + m[0].length;
    }
    if (last < segment.length) {
      spans.push({ text: segment.slice(last), code: false, ...(strong ? { strong: true } : {}) });
    }
  };

  let last = 0;
  /* A fresh regex per call: STRONG is a module-level /g pattern and a shared
     lastIndex would skip matches between paragraphs. */
  for (const m of masked.matchAll(new RegExp(STRONG.source, 'g'))) {
    const at = m.index ?? 0;
    if (at > last) expand(masked.slice(last, at), false);
    expand(m[1]!, true);
    last = at + m[0].length;
  }
  if (last < masked.length) expand(masked.slice(last), false);
  return withLinks(withEmphasis(spans.length > 0 ? spans : [{ text, code: false }]));
}

/*
 * ITALICS HUG A WORD. `*word*` / `_word_`: the marker is not doubled, the
 * inner text has no edge space, and the outer side is not a word character,
 * so `snake_case_name`, `a * b * c` and a glob's `*.ts` are left alone. Code
 * spans are never searched.
 */
const EM = /(?<![\w*\\/])\*(?![\s*.])([^*]+?)(?<![\s\\])\*(?![\w*])|(?<![\w\\])_(?![\s_])([^_]+?)(?<!\s)_(?!\w)/g;

function withEmphasis(spans: ProseSpan[]): ProseSpan[] {
  const out: ProseSpan[] = [];
  for (const span of spans) {
    if (span.code || (!span.text.includes('*') && !span.text.includes('_'))) {
      out.push(span);
      continue;
    }
    let last = 0;
    for (const m of span.text.matchAll(new RegExp(EM.source, 'g'))) {
      const at = m.index ?? 0;
      if (at > last) out.push({ ...span, text: span.text.slice(last, at) });
      out.push({ ...span, text: (m[1] ?? m[2])!, em: true });
      last = at + m[0].length;
    }
    if (last < span.text.length) out.push({ ...span, text: span.text.slice(last) });
  }
  return out;
}

/** True when the next `</svg>` line comes before another line that opens a fresh <svg>: the open drawing has blank lines inside it. */
function closesBeforeNextOpen(lines: string[], from: number): boolean {
  for (let i = from; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (/<\/svg>\s*$/i.test(l)) return true;
    if (/^\s*<svg[\s>]/i.test(l)) return false;
  }
  return false;
}
