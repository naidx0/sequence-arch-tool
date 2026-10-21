// Scoring helpers for on-pc/run.mjs. Pure; tested in lib.test.mjs.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { contentTokens } = await import(pathToFileURL(path.resolve(here, '../../../../packages/analyzer/dist/harness/refineText.js')).href);

/** Words only the note carries: the case's reason words that are not in the ask the person typed. */
export function reasonWords(c, askText) {
  const have = new Set(contentTokens(askText));
  return contentTokens(c.reason).filter((w) => !have.has(w));
}
/** Deterministic check, no judge: the reply uses at least 2 of those words. */
export function mentionsReason(reply, words) {
  const got = new Set(contentTokens(reply));
  return words.filter((w) => got.has(w)).length >= Math.min(2, words.length);
}
/** Exact McNemar: two-sided binomial on the discordant pairs. */
export function mcnemarP(b, c) {
  const n = b + c; if (!n) return 1;
  const k = Math.min(b, c); let p = 0;
  const logC = (n, r) => { let s = 0; for (let i = 1; i <= r; i++) s += Math.log((n - r + i) / i); return s; };
  for (let i = 0; i <= k; i++) p += Math.exp(logC(n, i) - n * Math.LN2);
  return Math.min(1, 2 * p);
}

