/**
 * The two helpers edit_file's result is built from (docs/research/pi-and-opencode-study.md, change 5):
 *
 *   unifiedDiff   what the edit changed, as a unified diff the model (and a person) can read.
 *   nearestLines  where in the file the model's `oldString` was probably aiming, for a refusal.
 *
 * Pure and dependency-free. Lines are compared without their carriage returns, so a CRLF file diffs on
 * its lines and `\r` never appears as an edit.
 */

const CONTEXT = 3;
/** DP cells the line diff may use before it falls back to one replace hunk (an edit is small; a rewrite is not). */
const MAX_LCS_CELLS = 4_000_000;
/** Lines of diff body returned before the rest is summarised. */
export const DIFF_MAX_LINES = 300;

type Op = { t: ' ' | '-' | '+'; text: string; a: number; b: number };

const splitLines = (s: string): string[] => {
  if (s === '') return [];
  const body = s.endsWith('\n') ? s.slice(0, -1) : s;
  return body.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
};

/** Line-level edit script between two line arrays (common prefix/suffix trimmed, LCS on the middle). */
function lineOps(a: string[], b: string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  const ops: Op[] = [];
  for (let i = 0; i < pre; i++) ops.push({ t: ' ', text: a[i]!, a: i + 1, b: i + 1 });
  let ai = pre;
  let bi = pre;
  const del = (s: string): void => void ops.push({ t: '-', text: s, a: ++ai, b: bi });
  const add = (s: string): void => void ops.push({ t: '+', text: s, a: ai, b: ++bi });
  const same = (s: string): void => void ops.push({ t: ' ', text: s, a: ++ai, b: ++bi });
  if ((am.length + 1) * (bm.length + 1) > MAX_LCS_CELLS) {
    am.forEach(del);
    bm.forEach(add);
  } else {
    const w = bm.length + 1;
    const L = new Int32Array((am.length + 1) * w);
    for (let i = am.length - 1; i >= 0; i--) {
      for (let j = bm.length - 1; j >= 0; j--) {
        L[i * w + j] = am[i] === bm[j] ? L[(i + 1) * w + j + 1]! + 1 : Math.max(L[(i + 1) * w + j]!, L[i * w + j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    while (i < am.length && j < bm.length) {
      if (am[i] === bm[j]) {
        same(am[i]!);
        i++;
        j++;
      } else if (L[(i + 1) * w + j]! >= L[i * w + j + 1]!) {
        del(am[i++]!);
      } else {
        add(bm[j++]!);
      }
    }
    while (i < am.length) del(am[i++]!);
    while (j < bm.length) add(bm[j++]!);
  }
  for (let k = 0; k < suf; k++) same(a[a.length - suf + k]!);
  return ops;
}

const eolStyle = (s: string): 'CRLF' | 'LF' | 'mixed' | null => {
  const crlf = (s.match(/\r\n/g) ?? []).length;
  const lf = (s.match(/\n/g) ?? []).length - crlf;
  if (crlf === 0 && lf === 0) return null;
  return lf === 0 ? 'CRLF' : crlf === 0 ? 'LF' : 'mixed';
};

/** Changes the line diff cannot show because lines compare without their carriage returns / final newline. */
function invisibleChangeNotes(before: string, after: string): string[] {
  const notes: string[] = [];
  const a = eolStyle(before);
  const b = eolStyle(after);
  if (a && b && a !== b) notes.push(`[line endings changed: ${a} to ${b}]`);
  if (before !== '' && after !== '') {
    if (!before.endsWith('\n') && after.endsWith('\n')) notes.push('[final newline added]');
    if (before.endsWith('\n') && !after.endsWith('\n')) notes.push('[final newline removed]');
  }
  return notes;
}

/**
 * A unified diff (`--- a/path`, `+++ b/path`, hunks with 3 lines of context); '' when nothing changed. A change the
 * line diff cannot show (CRLF to LF, a final newline added) is reported in a note, never as an empty diff.
 */
export function unifiedDiff(filePath: string, before: string, after: string): string {
  if (before === after) return '';
  const ops = lineOps(splitLines(before), splitLines(after));
  const changed = ops.map((o, i) => (o.t === ' ' ? -1 : i)).filter((i) => i >= 0);
  const notes = invisibleChangeNotes(before, after);
  if (changed.length === 0) return notes.length ? [`--- a/${filePath}`, `+++ b/${filePath}`, ...notes].join('\n') : '';
  /* Group changes whose context windows touch into one hunk. */
  const groups: Array<[number, number]> = [];
  for (const idx of changed) {
    const last = groups[groups.length - 1];
    if (last && idx - last[1] <= CONTEXT * 2) last[1] = idx;
    else groups.push([idx, idx]);
  }
  const out: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  for (const [first, lastIdx] of groups) {
    const from = Math.max(0, first - CONTEXT);
    const to = Math.min(ops.length - 1, lastIdx + CONTEXT);
    const slice = ops.slice(from, to + 1);
    const oldCount = slice.filter((o) => o.t !== '+').length;
    const newCount = slice.filter((o) => o.t !== '-').length;
    const firstOp = slice[0]!;
    const oldStart = firstOp.t === '+' ? firstOp.a + 1 : firstOp.a;
    const newStart = firstOp.t === '-' ? firstOp.b + 1 : firstOp.b;
    out.push(`@@ -${oldCount === 0 ? oldStart - 1 : oldStart},${oldCount} +${newCount === 0 ? newStart - 1 : newStart},${newCount} @@`);
    for (const o of slice) out.push(`${o.t}${o.text}`);
  }
  if (out.length > DIFF_MAX_LINES) {
    const extra = out.length - DIFF_MAX_LINES;
    return [...out.slice(0, DIFF_MAX_LINES), `[diff truncated: ${extra} more lines]`, ...notes].join('\n');
  }
  return [...out, ...notes].join('\n');
}

/* ───────────────────────────── nearest lines ───────────────────────────── */

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen-Dice over character bigrams, 0..1. */
function dice(a: Map<string, number>, b: Map<string, number>, na: number, nb: number): number {
  if (na === 0 || nb === 0) return 0;
  let hit = 0;
  for (const [g, c] of a) hit += Math.min(c, b.get(g) ?? 0);
  return (2 * hit) / (na + nb);
}

const total = (m: Map<string, number>): number => [...m.values()].reduce((s, x) => s + x, 0);
const similarity = (x: string, y: string): number => {
  const bx = bigrams(x);
  const by = bigrams(y);
  return dice(bx, by, total(bx), total(by));
};

export interface NearestLines {
  /** 1-based first line of the best window. */
  startLine: number;
  /** The file's own lines (no carriage returns), as many as the needle has, at most 8. */
  lines: string[];
  /** 0..1 */
  similarity: number;
}

const NEAREST_MIN = 0.55;
const NEAREST_MAX_FILE_LINES = 20_000;

/**
 * The window of `content` most like `needle`, or null when nothing is close enough to be worth showing.
 * A candidate window is anchored on any file line that resembles any needle line, so a first line that
 * drifted does not hide a second line that did not.
 */
export function nearestLines(content: string, needle: string): NearestLines | null {
  const file = splitLines(content);
  const want = splitLines(needle).filter((l) => norm(l) !== '');
  if (want.length === 0 || file.length === 0 || file.length > NEAREST_MAX_FILE_LINES) return null;
  const wantNorm = want.map(norm);
  const window = Math.min(want.length, 8);
  const joinedWant = wantNorm.slice(0, window).join('\n');
  const starts = new Set<number>();
  const fileNorm = file.map(norm);
  for (let i = 0; i < file.length; i++) {
    if (fileNorm[i] === '') continue;
    for (let j = 0; j < window; j++) {
      if (similarity(fileNorm[i]!, wantNorm[j]!) >= 0.6) starts.add(Math.max(0, Math.min(i - j, file.length - 1)));
    }
  }
  let best: NearestLines | null = null;
  for (const s of starts) {
    const lines = file.slice(s, s + window);
    const score = similarity(lines.map(norm).join('\n'), joinedWant);
    if (score >= NEAREST_MIN && (best === null || score > best.similarity)) best = { startLine: s + 1, lines, similarity: score };
  }
  return best;
}
