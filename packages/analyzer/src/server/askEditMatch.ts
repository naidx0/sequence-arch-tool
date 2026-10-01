/**
 * WHAT `edit_file` DOES INSTEAD OF REFUSING (carrying-harness plan, wave A8).
 *
 * Two refusals the plan turns into work, and one it keeps.
 *
 * ── "oldString appears N times" KEEPS ITS REFUSAL AND GAINS THE LINES ───────
 *
 * Replacing one of N identical spans without being told which is a coin toss
 * on the user's repository, so the refusal stays. What it lacked was the one
 * fact that makes it recoverable in the same turn: WHERE the N are. A model
 * told "3 times" reads the file again; a model told "lines 40, 96 and 212"
 * widens its `oldString` around the one it meant.
 *
 * ── "oldString does not appear" TRIES ONCE MORE, FAIL-CLOSED ────────────────
 *
 * The commonest way a correct edit is refused is a difference nobody can see:
 * a smart quote where the model typed a straight one, an em dash for a hyphen,
 * a non-breaking space, a CRLF file read as LF, trailing whitespace the model
 * dropped when it copied. The text IS there; the bytes differ.
 *
 * So one bounded pass: normalise both sides, look again, and — this is the
 * part that makes it safe — map the match back to the ORIGINAL bytes and
 * re-normalise that exact span. If the span does not normalise to the same
 * thing the needle did, the match is refused and the ordinary refusal stands.
 * The edit is then applied to the original bytes, so a file's real quotes and
 * line endings survive an edit that was typed with the wrong ones.
 *
 * FAIL-CLOSED IS THE WHOLE DESIGN. A fuzzy matcher that guesses writes the
 * wrong span into somebody's source file, and a wrong edit is far worse than a
 * refused one. Every relaxation here is a character-for-character substitution
 * or a deletion of whitespace that a compiler and a reader both ignore; none
 * of them can slide a match onto different code.
 */

/** Past this the needle is not an edit target, it is a paste. */
export const EDIT_FUZZY_MAX_NEEDLE = 8_000;

/** How many occurrences a refusal will name before it stops listing. */
export const EDIT_LINES_LISTED = 12;

/** How many spans a `replaceAll` fuzzy match will touch. */
export const EDIT_FUZZY_MAX_SPANS = 50;

/**
 * The normalised text, and where each of its characters came from.
 *
 * `map[i]` is the index in the ORIGINAL string of normalised character `i`,
 * and `map[normalised.length]` is the original length — so a normalised span
 * `[i, j)` is the original span `[map[i], map[j])`. Without this a fuzzy match
 * could only be reported, never applied.
 */
export interface NormalisedText {
  text: string;
  map: number[];
}

/** Characters a person or a model substitutes without meaning to. */
const SUBSTITUTIONS = new Map<string, string>([
  ['‘', "'"],
  ['’', "'"],
  ['‚', "'"],
  ['‛', "'"],
  ['“', '"'],
  ['”', '"'],
  ['„', '"'],
  ['′', "'"],
  ['″', '"'],
  ['–', '-'],
  ['—', '-'],
  ['―', '-'],
  ['−', '-'],
  [' ', ' '],
  [' ', ' '],
  [' ', ' '],
  ['​', ''],
  ['﻿', ''],
]);

/**
 * Normalise for matching only. Never for writing: the result of a match is a
 * span of the ORIGINAL text, and that is what gets replaced.
 *
 * Three relaxations, each of which a compiler and a reader ignore:
 * carriage returns, the substitutions above, and whitespace at the end of a
 * line. Indentation is NOT touched — in Python it is the program, and in every
 * language it is what makes one span different from another.
 */
export function normaliseForMatch(text: string): NormalisedText {
  const out: string[] = [];
  const map: number[] = [];
  /* Where the current run of trailing-candidate whitespace began in `out`. */
  let spaceRunStart = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '\r') continue;
    if (ch === '\n') {
      if (spaceRunStart >= 0) {
        out.length = spaceRunStart;
        map.length = spaceRunStart;
      }
      spaceRunStart = -1;
      out.push(ch);
      map.push(i);
      continue;
    }
    const sub = SUBSTITUTIONS.get(ch);
    const put = sub === undefined ? ch : sub;
    if (put === '') continue;
    if (put === ' ' || put === '\t') {
      if (spaceRunStart < 0) spaceRunStart = out.length;
    } else {
      spaceRunStart = -1;
    }
    out.push(put);
    map.push(i);
  }
  if (spaceRunStart >= 0) {
    out.length = spaceRunStart;
    map.length = spaceRunStart;
  }
  map.push(text.length);
  return { text: out.join(''), map };
}

/** Every index in `haystack` where `needle` starts. */
function allIndexesOf(haystack: string, needle: string, limit: number): number[] {
  const out: number[] = [];
  if (needle === '') return out;
  let i = haystack.indexOf(needle);
  while (i >= 0 && out.length < limit) {
    out.push(i);
    i = haystack.indexOf(needle, i + needle.length);
  }
  return out;
}

/**
 * The 1-based line numbers an exact needle starts on. What the ambiguous-edit
 * refusal names so the model can widen its `oldString` without reading the
 * file again.
 */
export function occurrenceLines(content: string, needle: string, limit = EDIT_LINES_LISTED): number[] {
  const lines: number[] = [];
  for (const at of allIndexesOf(content, needle, limit)) {
    let n = 1;
    for (let i = 0; i < at; i += 1) if (content[i] === '\n') n += 1;
    lines.push(n);
  }
  return lines;
}

/** One span of the ORIGINAL content that a normalised match resolved to. */
export interface EditSpan {
  from: number;
  to: number;
}

export type FuzzyMatch =
  | { kind: 'one'; span: EditSpan; spans: EditSpan[] }
  | { kind: 'several'; spans: EditSpan[]; lines: number[] }
  | { kind: 'none' };

/**
 * Find `needle` in `content` past the differences above, or say it is not
 * there. Every returned span is verified: re-normalising the original bytes
 * must reproduce the normalised needle exactly, or the span is dropped.
 */
export function fuzzyFindEdit(content: string, needle: string): FuzzyMatch {
  if (needle === '' || needle.length > EDIT_FUZZY_MAX_NEEDLE) return { kind: 'none' };
  const hay = normaliseForMatch(content);
  const want = normaliseForMatch(needle).text;
  if (want === '') return { kind: 'none' };
  const hits = allIndexesOf(hay.text, want, EDIT_FUZZY_MAX_SPANS);
  const spans: EditSpan[] = [];
  for (const at of hits) {
    const from = hay.map[at];
    /*
     * ONE PAST THE LAST MATCHED CHARACTER, not the start of the next one.
     *
     * `map[at + len]` is where the FOLLOWING normalised character came from,
     * and anything the normaliser deleted sits in between — so on a CRLF file
     * that end bound swallowed the `\r`, and the edit rewrote the line ending
     * of the one line it touched. Every substitution here is one character for
     * one character, so the last matched character's own index plus one is the
     * exact end of the span.
     */
    const last = hay.map[at + want.length - 1];
    const to = last === undefined ? undefined : last + 1;
    if (from === undefined || to === undefined || to <= from) continue;
    /* FAIL-CLOSED: the original bytes must say the same thing the match did. */
    if (normaliseForMatch(content.slice(from, to)).text !== want) continue;
    spans.push({ from, to });
  }
  if (spans.length === 0) return { kind: 'none' };
  if (spans.length === 1) return { kind: 'one', span: spans[0]!, spans };
  const lines = spans.slice(0, EDIT_LINES_LISTED).map((s) => {
    let n = 1;
    for (let i = 0; i < s.from; i += 1) if (content[i] === '\n') n += 1;
    return n;
  });
  return { kind: 'several', spans, lines };
}

/** Replace the given spans, right to left so earlier offsets stay valid. */
export function replaceSpans(content: string, spans: readonly EditSpan[], replacement: string): string {
  let out = content;
  for (const span of [...spans].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, span.from) + replacement + out.slice(span.to);
  }
  return out;
}

/** What the evidence says a fuzzy match forgave, so the transcript is honest. */
export function fuzzyNote(original: string, matched: string): string {
  const diffs: string[] = [];
  if (original.includes('\r') !== matched.includes('\r')) diffs.push('line endings');
  let quotes = false;
  let dashes = false;
  let spaces = false;
  for (const ch of matched) {
    const sub = SUBSTITUTIONS.get(ch);
    if (sub === undefined) continue;
    if (sub === "'" || sub === '"') quotes = true;
    else if (sub === '-') dashes = true;
    else spaces = true;
  }
  for (const ch of original) {
    const sub = SUBSTITUTIONS.get(ch);
    if (sub === undefined) continue;
    if (sub === "'" || sub === '"') quotes = true;
    else if (sub === '-') dashes = true;
    else spaces = true;
  }
  if (quotes) diffs.push('quote characters');
  if (dashes) diffs.push('dashes');
  if (spaces) diffs.push('space characters');
  if (normaliseForMatch(original).text !== original.replace(/\r/g, '')) diffs.push('trailing whitespace');
  return diffs.length === 0 ? 'whitespace' : diffs.join(' and ');
}
