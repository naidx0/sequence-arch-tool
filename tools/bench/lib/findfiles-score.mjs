/* Pure scoring and filtering helpers for bench:findfiles and bench:closure. No I/O, no git, no clock:
 * everything here is covered by tools/bench/test/findfiles-score.test.mjs. */

/* ---- seeded randomness (mulberry32); the seed is printed by every bench that uses it ---- */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Stable 32-bit hash of a string, so each repo gets its own stream from one printed seed. */
export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** k distinct items of `items`, seeded (partial Fisher-Yates); the input is not mutated. */
export function sample(items, k, rand) {
  const a = [...items];
  const n = Math.min(k, a.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/* ---- per-query metrics ---- */
export const hitAtK = (got, truth, k) => (got.slice(0, k).some((f) => truth.includes(f)) ? 1 : 0);
export function recallAtK(got, truth, k) {
  if (truth.length === 0) return 0;
  const top = new Set(got.slice(0, k));
  return truth.filter((f) => top.has(f)).length / truth.length;
}
/** Fraction of `truth` found in `got` (any length): the closure recall. Empty truth -> 1 (nothing to miss). */
export function recallOf(got, truth) {
  if (truth.length === 0) return 1;
  const s = new Set(got);
  return truth.filter((f) => s.has(f)).length / truth.length;
}
export function precisionOf(got, truth) {
  if (got.length === 0) return 1;
  const t = new Set(truth);
  return got.filter((f) => t.has(f)).length / got.length;
}

/* ---- statistics ---- */
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export function sd(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
export const se = (xs) => sd(xs) / Math.sqrt(xs.length);
export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
/** Percentile bootstrap CI of the mean, resampling observations with a seeded rng. Returns {mean, lo, hi, n}. */
export function bootstrapCI(xs, { reps = 2000, level = 0.95, seed = 1 } = {}) {
  const n = xs.length;
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
  const rand = rng(seed);
  const means = new Array(reps);
  for (let r = 0; r < reps; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += xs[Math.floor(rand() * n)];
    means[r] = s / n;
  }
  means.sort((a, b) => a - b);
  const a = (1 - level) / 2;
  return { mean: mean(xs), lo: quantile(means, a), hi: quantile(means, 1 - a), n };
}
/** Paired difference a_i - b_i: mean, SE (sd/sqrt n), z = mean/SE and a bootstrap CI. */
export function pairedDiff(a, b, opts = {}) {
  if (a.length !== b.length) throw new Error('pairedDiff: unequal lengths');
  const d = a.map((x, i) => x - b[i]);
  const ci = bootstrapCI(d, opts);
  const s = se(d);
  return { mean: ci.mean, se: s, z: s > 0 ? ci.mean / s : ci.mean === 0 ? 0 : Infinity, lo: ci.lo, hi: ci.hi, n: d.length };
}

/* ---- the commit filters (question = commit subject, answer = files the commit modified) ---- */
const LOCKFILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Pipfile\.lock|uv\.lock|Cargo\.lock|go\.sum|composer\.lock|Gemfile\.lock|bun\.lockb?|[^/]+\.lock)$/i;
const GENERATED = /(^|\/)(node_modules|dist|build|vendor|__snapshots__|\.next|coverage)\/|\.min\.(js|css)$|\.map$|\.snap$|\.pb\.go$|_pb2(_grpc)?\.py$|\.generated\.|\.gen\.[a-z]+$|(^|\/)generated\//i;
export const isLockfile = (p) => LOCKFILE.test(p);
export const isGenerated = (p) => GENERATED.test(p);
export const CODE_EXT = /\.(m?[jt]sx?|cjs|py|go|rs|java|kt|rb|php|cs|swift|dart|c|cc|cpp|h|hpp|vue|svelte|css|html|sh|ps1|toml|ya?ml|json)$/i;
/** An indexable answer file: source/config extension, not a lockfile, not generated. */
export const isAnswerFile = (p) => CODE_EXT.test(p) && !isLockfile(p) && !isGenerated(p);
/** Dependency-bot and release-bookkeeping subjects carry no description of the change. */
export const BOT_SUBJECT = /^(merge\b|revert "?merge|bump\b|build\(deps|chore\(deps|\[pre-commit|pre-commit autoupdate|update (dependency|dependencies|requirements?)\b|release\b|version\b|v?\d+\.\d+(\.\d+)?\b)/i;

/** The subject names a file path literally when it contains a changed file's full path or its basename WITH extension
 *  (a question that already says `app.py` is not a retrieval question). Comparison is case-insensitive. */
export function subjectNamesPath(subject, files) {
  const s = subject.toLowerCase();
  return files.some((f) => {
    const full = f.toLowerCase();
    const base = full.slice(full.lastIndexOf('/') + 1);
    if (s.includes(full)) return true;
    return /\.[a-z0-9]+$/.test(base) && base.length >= 4 && new RegExp(`(^|[^a-z0-9_./-])${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9_-])`).test(s);
  });
}

/**
 * Decide whether a commit becomes a question. `c` = { subject, parents (count), changed: [{status, path}] (every path the
 * commit touched), existsAtParent(path) }. Returns { ok, answer, reason }.
 * Filters, in order: merge; bot/release subject; > maxFiles files touched in total (default 20); fewer than 3 query words
 * after `wordsOf`; answer = status-M, indexable, non-lockfile, non-generated files that exist at the parent
 * (none -> drop); more than 8 answer files -> drop; subject names an answer path literally -> drop.
 */
export function judgeCommit(c, { maxFiles = 20, maxAnswer = 8, minWords = 3, wordsOf = (s) => s.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [] } = {}) {
  if (c.parents !== 1) return { ok: false, reason: 'merge' };
  if (BOT_SUBJECT.test(c.subject.trim())) return { ok: false, reason: 'bot-or-release-subject' };
  if (c.changed.length > maxFiles) return { ok: false, reason: `touches>${maxFiles}-files` };
  if (wordsOf(c.subject).length < minWords) return { ok: false, reason: `subject<${minWords}-words` };
  const answer = c.changed.filter((x) => x.status === 'M' && isAnswerFile(x.path) && c.existsAtParent(x.path)).map((x) => x.path);
  if (answer.length === 0) return { ok: false, reason: 'no-indexable-modified-file' };
  if (answer.length > maxAnswer) return { ok: false, reason: `answer>${maxAnswer}-files` };
  if (subjectNamesPath(c.subject, answer)) return { ok: false, reason: 'subject-names-a-path' };
  return { ok: true, answer };
}

/* ---- tokens ---- */
/** The repo's convention: chars / 4, rounded up. Labelled an estimate everywhere it is printed. */
export const tokensOfChars = (n) => Math.ceil(n / 4);

/* ---- review corrections (F6, F7, F8, F10, F13) ---- */
/** Wilson score interval for k successes in n trials (never the degenerate [100,100] a bootstrap gives at k = n). */
export function wilsonCI(k, n, z = 1.959964) {
  if (n === 0) return { mean: NaN, lo: NaN, hi: NaN, n: 0 };
  const p = k / n, z2 = z * z, den = 1 + z2 / n;
  const c = (p + z2 / (2 * n)) / den;
  const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / den;
  return { mean: p, lo: Math.max(0, c - h), hi: Math.min(1, c + h), n };
}
/** Wilson interval over a 0/1 array. */
export const wilsonOf = (xs) => wilsonCI(xs.reduce((a, b) => a + b, 0), xs.length);
/** Cluster-robust (CR1) SE of the mean of `vals`, clusters given by `ids` (e.g. the repo of each query).
 *  SE = sqrt(G/(G-1) * sum_g (sum_{i in g} (v_i - mean))^2) / n. NaN with fewer than 2 clusters. */
export function clusteredSE(vals, ids) {
  const n = vals.length;
  const m = mean(vals);
  const s = new Map();
  vals.forEach((v, i) => s.set(ids[i], (s.get(ids[i]) ?? 0) + (v - m)));
  const G = s.size;
  if (G < 2) return NaN;
  let ss = 0;
  for (const v of s.values()) ss += v * v;
  return Math.sqrt((G / (G - 1)) * ss) / n;
}
/** '' when |mean| / se >= 2, else 'n.s.' (not significant). */
export const sigMark = (m, s) => (Number.isFinite(s) && s > 0 && Math.abs(m) / s >= 2 ? '' : 'n.s.');
/** Subset runs (--limit, --repos) never overwrite the dated full run. */
export const outName = (base, date, ext, partial) => `${base}-${date}${partial ? '-partial' : ''}.${ext}`;
/** A checkpoint is reusable only under the same sealed set and the same analyzer build. */
export const checkpointValid = (ckpt, stamp) => Boolean(ckpt) && ckpt.stamp?.questions === stamp.questions && ckpt.stamp?.build === stamp.build && Array.isArray(ckpt.rows);
/** Throw when a spawned tool failed to run or exited >= 2 (rg and the grep tools exit 1 for "no match", which is fine). */
export function assertSpawnOk(r, what) {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  if (r.status === null || r.status >= 2) throw new Error(`${what}: exit ${r.status}${r.signal ? ` (${r.signal})` : ''}: ${String(r.stderr ?? '').slice(0, 300)}`);
}
/** --build-questions must not silently replace a seal. */
export function sealGuard(exists, force) {
  if (exists && !force) throw new Error('questions.json already exists and is sealed; pass --force to replace it');
}

/** rg prints `.\src\a.py` on Windows; every comparison in the benches is against forward-slash repo paths. */
export function posixRgPath(line) {
  return String(line).replaceAll('\\', '/').replace(/^\.\//, '');
}
