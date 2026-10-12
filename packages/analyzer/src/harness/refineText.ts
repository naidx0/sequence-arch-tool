/**
 * Refine text helpers: the one tokenizer and overlap rule the whole refine
 * loop shares (signals, clusters, note retrieval, recurrence). NO LLM.
 *
 * One rule in one place matters: the detector that says "this ask was typed
 * again", the retrieval that says "this note applies to this ask" and the
 * recurrence counter that says "this ask is the same kind of ask as the one the
 * note came from" must agree about what "the same" means, or a note could be
 * retrieved for an ask the tracker never counts.
 */

const STOP = new Set(
  (
    'the and for with that this from have has had was were are not but you your our its into onto than then them they their there here ' +
    'what when where which who why how can could would should will just also too very more most some any all out off over under about ' +
    'please thanks thank okay now still again already said asked ask want need make sure let get got did does doesnt dont didnt isnt ' +
    'wont cant like one two thing things way use using used see look show tell give take put add'
  ).split(' '),
);

/** Lower-cased content words of `text`: no stopwords, light stemming, deduped, in first-seen order. */
export function contentTokens(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text).toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    let w = raw;
    if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (w.length < 3 || STOP.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/** Jaccard overlap of two token lists (0 when either is empty). */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sb = new Set(b);
  let inter = 0;
  for (const t of new Set(a)) if (sb.has(t)) inter += 1;
  return inter / (new Set(a).size + sb.size - inter);
}

/** Share of the smaller list found in the larger: forgiving when one side is a short restatement of a long ask. */
export function containment(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / Math.min(sa.size, sb.size);
}

/** One line, at most `n` characters, ending in an ellipsis when cut. */
export function clip(text: string, n: number): string {
  const t = String(text).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, Math.max(1, n - 1)).trimEnd()}…` : t;
}

/** Words that say the person is repeating themselves (they lower the overlap a repeat needs). */
export const REPEAT_CUES = /\b(again|still|already|i (?:asked|said|told|wanted)|as i said|you (?:didn'?t|never|forgot|skipped|missed)|not yet|never (?:did|got|happened)|doesn'?t|isn'?t|aren'?t|haven'?t)\b/i;

/**
 * Words that say the earlier answer fell short ("still", "you didn't", "is not"):
 * the person's own complaint. Plain "again" is not one: "run the tests again" is
 * a legitimate re-run, and those were the repeat detector's false positives.
 */
export const COMPLAINT_CUES = /\b(still|already|i (?:asked|said|told|wanted)|as i said|you (?:didn'?t|never|forgot|skipped|missed|said)|not yet|never (?:did|got|happened)|doesn'?t|don'?t see|isn'?t|aren'?t|haven'?t|wasn'?t|weren'?t|(?:is|are|was|were) not|no longer|nothing changed|same (?:bug|problem|error|issue))\b/i;

/**
 * Strip what could forge structure in NOTES.md or a prompt from text that did not
 * come from the person (an agent's restated request or its not-done reason):
 * HTML comment marks (a forged `<!--n:id-->` marker would make Undo of another
 * note remove this line), the evidence braces, the trigger brackets, backticks
 * and angle brackets, and control characters. One line, words kept.
 */
export function plainNoteText(text: string): string {
  return String(text)
    .replace(/<!--|-->/g, ' ')
    .replace(/[<>{}\[\]`]/g, ' ')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
