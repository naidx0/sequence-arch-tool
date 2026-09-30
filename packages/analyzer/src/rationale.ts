/**
 * Rationale & decision-record mining — the *why* the team already wrote down.
 *
 * WHY THIS EXISTS. Developers record their reasoning in comments — `// WHY:`,
 * `// HACK:`, `// GOTCHA:` — and reference decision records (`ADR-0007`,
 * `RFC-0042`, `.sequence/decisions/0003-cache.md`). None of it ever reached the
 * graph, so a module card could say what the code *is* and never what the team
 * *decided*. Mining it costs no model call and no network: it is text that is
 * already on disk, attached to the exact `file:line` it came from.
 *
 * WHAT THIS IS NOT.
 *  - It is NOT an edge source. A comment is prose, not a dependency; drawing a
 *    graph edge from it would violate grounded-not-guessed. Notes are attached
 *    as evidence-carrying data on the node the comment lives in, nothing more.
 *  - It is NOT a summariser. The text is the author's own words, whitespace-
 *    collapsed and length-capped. Nothing is paraphrased, inferred or invented.
 *  - It is NOT an AI path. Pure string scanning over `FileFacts.lines`, which
 *    the parse already holds. Same input, same output, no key, no network.
 *
 * PROVENANCE. Every note carries a `@sequence/schema` {@link Evidence} record —
 * the same `{ file, line, snippet }` shape every edge in the graph uses. There
 * is deliberately no parallel provenance system.
 *
 * BOUNDS (honest, not exhaustive). At most {@link MAX_NOTES_PER_FILE} notes per
 * file and {@link MAX_NOTES_PER_MODULE} per module, text capped at
 * {@link MAX_TEXT_LEN}, deduped by (tag, text). A repo with a thousand `NOTE:`
 * comments produces a readable line, not a wall.
 */
import type { Evidence } from '@sequence/schema';
import type { FileFacts, Lang } from './types.js';

/** What kind of "why" a note is. */
export type RationaleTag =
  | 'WHY'
  | 'NOTE'
  | 'RATIONALE'
  | 'HACK'
  | 'GOTCHA'
  | 'ADR'
  | 'RFC'
  | 'DECISION';

export interface RationaleNote {
  /** Which marker fired, or which kind of decision reference was found. */
  tag: RationaleTag;
  /** The author's own words: whitespace-collapsed, capped, never paraphrased. */
  text: string;
  /**
   * The decision record referenced, verbatim — `ADR-0007`, `RFC-0042`, or a
   * repo-relative `.sequence/decisions/*.md` path. Absent for prose markers.
   */
  ref?: string;
  /** Where it is, in the schema's own evidence shape. */
  evidence: Evidence;
}

/** At most this many notes survive per file. */
export const MAX_NOTES_PER_FILE = 3;
/** At most this many notes survive per module (aggregated across its files). */
export const MAX_NOTES_PER_MODULE = 5;
/** Author text is truncated to this many characters (ellipsis appended). */
export const MAX_TEXT_LEN = 240;
/** A rationale marker may absorb at most this many continuation lines. */
const MAX_CONTINUATION_LINES = 4;

/**
 * The five prose markers, each requiring an explicit colon.
 *
 * The colon is the whole false-positive defence: `// NOTE:` is a deliberate
 * annotation, whereas "note that the caller owns this" is ordinary prose that
 * happens to start with the word. Uppercase-only, for the same reason.
 */
const MARKER_RE = /\b(WHY|NOTE|RATIONALE|HACK|GOTCHA)\s*:\s*(.*)$/;

/** `ADR-1234` / `RFC-0042` — hyphen required, so "RFC 2616 says" is not a ref. */
const RECORD_RE = /\b(ADR|RFC)-(\d{1,6})\b/;

/** A link to a decision record this product already owns. */
const DECISION_PATH_RE = /(?:^|[\s("'`[<])((?:\.\/)?\.sequence\/decisions\/[A-Za-z0-9._-]+\.md)/;

/**
 * Does a comment body look like commented-out CODE rather than prose?
 *
 * A deliberately blunt, documented heuristic — a false negative costs one noisy
 * line, a false positive costs a real rationale, so it errs toward keeping
 * prose. A body is treated as code when ANY of these hold:
 *
 *  1. it ends in `;`, `{`, `}` or `,` — statement punctuation, not a sentence;
 *  2. it starts with a statement keyword shared by our five languages
 *     (`if`, `for`, `return`, `import`, `func`, `def`, `class`, `const`, …);
 *  3. it contains an operator that does not occur in English prose
 *     (`=>`, `->`, `::`, `&&`, `||`, `!==`, `===`, `:=`);
 *  4. it is a bare assignment (`x.y = z`) or a bare call (`doThing(a, b)`);
 *  5. it has no whitespace at all, or fewer than two word-like tokens — a
 *     single identifier is not an explanation.
 */
export function looksLikeCode(body: string): boolean {
  const t = body.trim();
  if (t === '') return true;
  if (!/\s/.test(t)) return true;
  const words = t.split(/\s+/).filter((w) => /[A-Za-z]{2}/.test(w));
  if (words.length < 2) return true;
  if (/[;{},]$/.test(t)) return true;
  if (/^(if|else|for|while|switch|case|return|import|from|export|require|func|def|class|struct|interface|var|let|const|public|private|protected|static|package|type|new|await|async|try|catch|throw|raise|with|print|console)\b/.test(t)) {
    return true;
  }
  if (/(=>|->|::|&&|\|\||!==|===|:=)/.test(t)) return true;
  if (/^[\w.$[\]]+\s*(=|\+=|-=)[^=]/.test(t)) return true;
  if (/^[\w.$]+\s*\([^)]*\)\s*[;{]?$/.test(t)) return true;
  return false;
}

interface CommentLine {
  /** 1-based line number in the file. */
  line: number;
  /** The comment's own text, comment punctuation stripped. */
  body: string;
}

/** Line-comment lead per language. Block comments (`/* … *&#47;`) are C-like only. */
function lineCommentLead(lang: Lang): '//' | '#' {
  return lang === 'py' ? '#' : '//';
}

/**
 * Is the character at `idx` inside a string literal on this line?
 *
 * Cheap and line-local: count unescaped quotes before the index. It exists so a
 * URL in a string (`"https://x/#WHY:"`) is not mined as a comment. It cannot
 * see multi-line strings, and does not try to — a marker inside one is a
 * cosmetic false positive, capped and deduped like everything else.
 */
function insideString(line: string, idx: number): boolean {
  let dq = 0;
  let sq = 0;
  let bt = 0;
  for (let i = 0; i < idx; i++) {
    const c = line[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"') dq++;
    else if (c === "'") sq++;
    else if (c === '`') bt++;
  }
  return dq % 2 === 1 || sq % 2 === 1 || bt % 2 === 1;
}

/**
 * Every comment body in a file, with its real 1-based line number.
 *
 * Handles the two shapes our five parsed languages actually use: line comments
 * (`//` for ts/js/go/java, `#` for py) and C-style block comments, including
 * the leading-`*` continuation of a JSDoc/Javadoc block.
 */
export function commentLines(lines: readonly string[], lang: Lang): CommentLine[] {
  const out: CommentLine[] = [];
  const lead = lineCommentLead(lang);
  const cLike = lang !== 'py';
  let inBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const lineNo = i + 1;

    if (inBlock) {
      const end = raw.indexOf('*/');
      const seg = end >= 0 ? raw.slice(0, end) : raw;
      if (end >= 0) inBlock = false;
      out.push({ line: lineNo, body: seg.replace(/^\s*\*+\s?/, '').trim() });
      continue;
    }

    if (cLike) {
      const open = raw.indexOf('/*');
      const slash = raw.indexOf('//');
      if (open >= 0 && (slash < 0 || open < slash) && !insideString(raw, open)) {
        const rest = raw.slice(open + 2);
        const end = rest.indexOf('*/');
        if (end >= 0) {
          out.push({ line: lineNo, body: rest.slice(0, end).replace(/^\**\s?/, '').trim() });
        } else {
          inBlock = true;
          out.push({ line: lineNo, body: rest.replace(/^\**\s?/, '').trim() });
        }
        continue;
      }
    }

    // `#!` is a shebang, not a comment the author wrote for a reader.
    if (lead === '#' && lineNo === 1 && raw.startsWith('#!')) continue;
    const at = raw.indexOf(lead);
    if (at < 0 || insideString(raw, at)) continue;
    // `///` (Go/TS doc comments) and `##` (Python section banners) are the same
    // comment with a louder lead — strip the repeat, keep the text.
    const stripRepeat = lead === '#' ? /^#+/ : /^\/+/;
    out.push({ line: lineNo, body: raw.slice(at + lead.length).replace(stripRepeat, '').trim() });
  }
  return out;
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function cap(s: string): string {
  return s.length <= MAX_TEXT_LEN ? s : `${s.slice(0, MAX_TEXT_LEN - 1).trimEnd()}…`;
}

/**
 * Mine one parsed file for rationale comments and decision-record references.
 *
 * Returns at most {@link MAX_NOTES_PER_FILE} notes, in file order, each carrying
 * a real `file:line`. Returns `[]` for a file that records nothing — which is
 * most files, and is the point: absent signal must change nothing downstream.
 */
export function extractRationale(facts: Pick<FileFacts, 'file' | 'language' | 'lines'>): RationaleNote[] {
  const lines = Array.isArray(facts.lines) ? facts.lines : [];
  if (lines.length === 0) return [];
  const comments = commentLines(lines, facts.language);
  if (comments.length === 0) return [];

  // Index by line so a marker can absorb the comment lines directly under it.
  const byLine = new Map<number, string>();
  for (const c of comments) byLine.set(c.line, c.body);

  const notes: RationaleNote[] = [];
  const seen = new Set<string>();
  const consumed = new Set<number>();

  const push = (tag: RationaleTag, text: string, line: number, ref?: string): void => {
    if (notes.length >= MAX_NOTES_PER_FILE) return;
    const body = collapse(text);
    if (looksLikeCode(body)) return;
    const key = `${tag}|${body.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    notes.push({
      tag,
      text: cap(body),
      ...(ref ? { ref } : {}),
      evidence: {
        file: facts.file,
        line,
        snippet: cap(collapse(lines[line - 1] ?? body)),
      },
    });
  };

  for (const c of comments) {
    if (notes.length >= MAX_NOTES_PER_FILE) break;
    if (consumed.has(c.line)) continue;

    const marker = MARKER_RE.exec(c.body);
    if (marker) {
      // Absorb the continuation comment lines directly beneath: real rationale
      // is a paragraph, and the first line alone often reads as a fragment.
      let text = marker[2];
      for (let n = 1; n <= MAX_CONTINUATION_LINES; n++) {
        const next = byLine.get(c.line + n);
        if (next === undefined || next === '') break;
        if (MARKER_RE.test(next)) break;
        if (looksLikeCode(next)) break;
        consumed.add(c.line + n);
        text += ` ${next}`;
        if (collapse(text).length >= MAX_TEXT_LEN) break;
      }
      // A marker and a record reference are not exclusive — `// WHY: see
      // ADR-0007` is both, and the reference is the more useful half. Keep the
      // author's tag, but carry the record so the card can cite it.
      const inMarker = DECISION_PATH_RE.exec(text) ?? RECORD_RE.exec(text);
      const markerRef = inMarker
        ? inMarker.length === 2
          ? inMarker[1].replace(/^\.\//, '')
          : `${inMarker[1]}-${inMarker[2]}`
        : undefined;
      push(marker[1] as RationaleTag, text, c.line, markerRef);
      continue;
    }

    const decision = DECISION_PATH_RE.exec(c.body);
    if (decision) {
      push('DECISION', c.body, c.line, decision[1].replace(/^\.\//, ''));
      continue;
    }

    const record = RECORD_RE.exec(c.body);
    if (record) {
      push(record[1] as RationaleTag, c.body, c.line, `${record[1]}-${record[2]}`);
    }
  }

  return notes;
}

/**
 * Roll a module's files up into at most {@link MAX_NOTES_PER_MODULE} notes.
 *
 * Decision references sort first — a cited ADR is a harder fact than a `NOTE:` —
 * then file order, so the output is stable for a given member list.
 */
export function rollUpRationale(
  members: readonly string[],
  byFile: ReadonlyMap<string, readonly RationaleNote[]>,
): RationaleNote[] {
  const all: RationaleNote[] = [];
  for (const m of members) for (const n of byFile.get(m) ?? []) all.push(n);
  const seen = new Set<string>();
  const deduped = all.filter((n) => {
    const key = `${n.tag}|${n.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rank = (n: RationaleNote): number => (n.ref ? 0 : 1);
  return deduped
    .sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (a.evidence.file !== b.evidence.file) return a.evidence.file.localeCompare(b.evidence.file);
      return a.evidence.line - b.evidence.line;
    })
    .slice(0, MAX_NOTES_PER_MODULE);
}

/**
 * ONE grounded sentence saying the team wrote its reasoning down — never a wall.
 *
 * The notes themselves live on the node's `meta.rationale` for a foldable
 * surface; this is the single line that goes into a card's description so a
 * reader knows there is a "why" to open. Returns undefined when there is
 * nothing to say, so a repo with no rationale reads exactly as it does today.
 */
export function rationaleSentence(notes: readonly RationaleNote[]): string | undefined {
  if (notes.length === 0) return undefined;
  const cited = notes.filter((n) => n.ref);
  if (cited.length > 0) {
    // Cite from the note that actually carries the reference, so the file:line
    // in the sentence is where that record is named — not merely the first note.
    const anchor = cited[0];
    const refs = [...new Set(cited.map((n) => n.ref!))];
    const named = refs.slice(0, 2).join(', ');
    const more = refs.length > 2 ? ` +${refs.length - 2} more` : '';
    return `Cites ${named}${more} (${anchor.evidence.file}:${anchor.evidence.line}).`;
  }
  const first = notes[0];
  const extra = notes.length > 1 ? ` (+${notes.length - 1} more)` : '';
  return `Rationale noted at ${first.evidence.file}:${first.evidence.line}${extra}.`;
}
