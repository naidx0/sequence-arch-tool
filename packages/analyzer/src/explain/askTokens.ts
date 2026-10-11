/**
 * The ask index's tokenizer (a port of harness-study ftf3 `toks`): identifier
 * parts (camelCase / snake / kebab split, stopwords dropped, light stem), plus
 * the whole identifier as `~ident` when it had parts.
 */

export const ASK_STOPWORDS: ReadonlySet<string> = new Set(
  'the a an and or of to in on for with from by at as is are was be it its this that these those not no now when than then into out up off over under one two all any each every so but if via per new old get set use uses used make makes made add adds added fix fixes fixed only also more less same own after before still back first last'.split(
    ' ',
  ),
);

const stem = (w: string): string => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w);

const ID_CACHE = new Map<string, readonly string[]>();

function idTokens(id: string): readonly string[] {
  const hit = ID_CACHE.get(id);
  if (hit) return hit;
  const parts = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(' ');
  const out: string[] = [];
  for (const p of parts) if (p.length > 2 && !ASK_STOPWORDS.has(p)) out.push(stem(p));
  if (parts.length > 1 && id.length > 3) out.push(`~${id.toLowerCase()}`);
  /* Bounded memo: identifiers repeat heavily across a corpus. */
  if (ID_CACHE.size < 50_000) ID_CACHE.set(id, out);
  return out;
}

/**
 * Identifier-aware tokens: camelCase / snake / kebab parts (stopwords dropped,
 * light stem), plus the whole identifier as `~ident` when it had parts.
 */
export function askTokens(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9]*|[0-9]+/g)) for (const t of idTokens(m[0])) out.push(t);
  return out;
}

/** Drop the identifier memo (the background build calls this when it finishes, so the memo is not retained between builds). */
export function clearAskTokenCache(): void {
  ID_CACHE.clear();
}
