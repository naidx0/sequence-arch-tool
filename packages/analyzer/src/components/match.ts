/**
 * Which components a prompt calls for. Deterministic and cheap, no dependency:
 *
 *   - a trigger is a phrase; its words are compared by STEM, so "engineer" matches engineering,
 *     engineered and engineers, and "polish" matches polishing (simple suffix rules, below);
 *   - the words of a multi-word trigger must appear in order, each within 4 words of the one before
 *     ("reverse engineer", "reverse that engineering effort"), so a phrase still means a phrase;
 *   - case-insensitive, whole words only (a stem is never found inside a longer unrelated word).
 *
 * Link-only components are never matched.
 */
import type { Catalog, ComponentEntry } from './catalog.js';

export interface ComponentMatch {
  id: string;
  score: number;
  why: string;
}

export interface MatchOptions {
  /** Cap on results (default 3). */
  max?: number;
  /** Ids the person switched on; each gets a small boost so they win ties. */
  enabled?: readonly string[];
}

/** How far apart (in words) consecutive words of a trigger may sit. */
export const TRIGGER_WINDOW = 4;

const WORD = /[\p{L}\p{N}]+(?:[+#]+)?/gu;

/** The lower-case words of a text. */
export function words(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).slice(0, 2000);
}

/**
 * A word's stem by plain suffix rules: -ing, -ed, -es, -s, then a trailing -e and a doubled final
 * consonant ("running" -> "run"). Short words are left alone. It only has to be consistent:
 * two forms match when their stems are equal.
 */
export function stem(word: string): string {
  let w = word;
  if (w.length <= 3 || !/^[\p{L}]+$/u.test(w)) return w;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && /([^aeiou])\1$/.test(w) && !/(ll|ss|ff)$/.test(w)) w = w.slice(0, -1);
  return w;
}

const stems = (text: string): string[] => words(text).map(stem);

/** Do the trigger's words appear in the prompt's, in order, each within the window of the last? */
export function phraseMatches(prompt: string, phrase: string): boolean {
  const want = stems(phrase);
  if (want.length === 0) return false;
  const have = stems(prompt);
  /* ok[p]: the trigger's words so far can end at prompt word p. One pass per trigger word, each position looked at
     once per step, so the cost is words x prompt length (x the window), never exponential. */
  let ok = have.map((h) => h === want[0]);
  for (let k = 1; k < want.length; k++) {
    const next = new Array<boolean>(have.length).fill(false);
    for (let q = 0; q < have.length; q++) {
      if (have[q] !== want[k]) continue;
      for (let p = Math.max(0, q - TRIGGER_WINDOW); p < q; p++) if (ok[p]) { next[q] = true; break; }
    }
    ok = next;
  }
  return ok.some(Boolean);
}

function scoreOne(prompt: string, c: ComponentEntry): { score: number; hits: string[] } {
  const hits = c.triggers.filter((t) => phraseMatches(prompt, t));
  /* More phrases, and longer phrases, are stronger evidence. */
  const score = hits.reduce((s, t) => s + 1 + 0.1 * t.trim().split(/\s+/).length, 0);
  return { score, hits };
}

export function matchComponents(prompt: string, catalog: Pick<Catalog, 'components'>, opts: MatchOptions = {}): ComponentMatch[] {
  const enabled = new Set(opts.enabled ?? []);
  const out: ComponentMatch[] = [];
  for (const c of catalog.components) {
    if (c.status === 'link-only') continue;
    const { score, hits } = scoreOne(prompt, c);
    if (score === 0) continue;
    out.push({ id: c.id, score: Math.round((score + (enabled.has(c.id) ? 0.5 : 0)) * 100) / 100, why: `matched ${hits.map((h) => `"${h}"`).join(', ')}` });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, opts.max ?? 3);
}
