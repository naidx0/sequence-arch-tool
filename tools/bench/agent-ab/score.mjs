/*
 * Scoring for the agent A/B. Pure functions, so they are tested without an agent.
 */

const clean = (p) =>
  String(p)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/:\d+(:\d+)?$/, '')
    .toLowerCase();

/** The last {"files": [...]} object in the reply; [] when there is none. */
export function parseAnswer(text) {
  const matches = [...String(text ?? '').matchAll(/\{[^{}]*"files"\s*:\s*\[[^\]]*\][^{}]*\}/g)];
  for (const m of matches.reverse()) {
    try {
      const j = JSON.parse(m[0]);
      if (Array.isArray(j.files)) return [...new Set(j.files.map(String))];
    } catch {}
  }
  return [];
}

/**
 * Precision, recall and F1 of the returned files against the labelled set.
 * An absolute path that ends with a labelled relative path counts as that path.
 */
export function scoreAnswer(q, files) {
  const truth = new Set(q.answer.map(clean));
  const got = new Set();
  for (const f of files) {
    const c = clean(f);
    const hit = [...truth].find((t) => c === t || c.endsWith('/' + t));
    got.add(hit ?? c);
  }
  const tp = [...got].filter((f) => truth.has(f)).length;
  const precision = got.size ? tp / got.size : 0;
  const recall = truth.size ? tp / truth.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, returned: got.size, expected: truth.size, precision, recall, f1, exact: tp === truth.size && got.size === truth.size };
}
