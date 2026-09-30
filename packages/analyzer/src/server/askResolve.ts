/**
 * RESOLVE, DON'T REFUSE — the loose matchers behind wave A2 of
 * docs/research/carrying-harness-plan.md.
 *
 * A small model names things the way a person does: `askPipeline` for
 * `packages/analyzer/src/server/askPipeline.ts`, `orders` for `svc:orders`,
 * `main.py` for the one `main.py` the scan holds. The strict resolvers
 * (`resolveGraphTargets`, `digestServiceKeys`, the jail) are right to refuse an
 * invented name; they were wrong to refuse a name that has exactly one honest
 * reading. These helpers rank the readings and return them with a verdict:
 *
 *   one    — exactly one candidate stands clearly above the rest; the caller
 *            runs the tool on it and says `resolved "X" to Y`
 *   several — up to LOOSE_MAX candidates; the caller returns them as evidence
 *            (ok: true) so the model can pick, which is new information and
 *            not a dead end
 *   none   — nothing matched; the caller refuses as before
 *
 * Nothing here invents: every candidate is a real path, node or service the
 * scan produced. A score is a rank among real things, never a fabrication.
 */

export const LOOSE_MAX = 8;

export type LooseResolution<T> =
  | { kind: 'one'; hit: T; how: string }
  | { kind: 'several'; hits: T[]; how: string }
  | { kind: 'none' };

function normalisePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? name : name.slice(0, i);
}

/**
 * Rank candidate paths against what the model wrote. Higher is better; zero
 * means no relation. The ladder, from strongest: whole-path suffix match;
 * basename equal; basename equal without extension; the written text is a
 * path segment; the written text is contained in a segment. Shorter paths win
 * ties, because `src/index.ts` is a better reading of `index` than
 * `src/vendor/legacy/index.ts`.
 */
export function scorePathCandidate(written: string, candidatePath: string): number {
  const w = normalisePath(written);
  const p = normalisePath(candidatePath);
  if (w === '' || p === '') return 0;
  if (p === w) return 100;
  /* A suffix is a PATH suffix: a bare basename is the basename tier below. */
  if (w.includes('/') && p.endsWith(`/${w}`)) return 90;
  const wb = basenameOf(w);
  const pb = basenameOf(p);
  if (pb === wb) return 80;
  if (stripExt(pb) === stripExt(wb)) return 70;
  const segments = p.split('/');
  const wStem = stripExt(wb);
  if (segments.some((s) => stripExt(s) === wStem)) return 50;
  if (wStem.length >= 4 && segments.some((s) => s.includes(wStem))) return 30;
  return 0;
}

/** Rank a set of candidates and decide one / several / none. */
export function decide<T>(
  scored: ReadonlyArray<{ item: T; score: number; tiebreak: number }>,
  how: (score: number) => string,
): LooseResolution<T> {
  const live = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.tiebreak - b.tiebreak);
  if (live.length === 0) return { kind: 'none' };
  const best = live[0]!;
  const rivals = live.filter((s) => s.score === best.score);
  if (rivals.length === 1 && best.score >= 50) {
    return { kind: 'one', hit: best.item, how: how(best.score) };
  }
  return { kind: 'several', hits: live.slice(0, LOOSE_MAX).map((s) => s.item), how: how(best.score) };
}

const HOW_PATH = (score: number): string =>
  score >= 90
    ? 'path suffix'
    : score >= 80
      ? 'basename'
      : score >= 70
        ? 'basename without extension'
        : score >= 50
          ? 'path segment'
          : 'partial name';

/** Loose match over graph nodes by path, then by label. */
export function resolveGraphTargetsLoose(
  graph: { nodes: ReadonlyArray<{ id: string; path?: string; label: string }> },
  target: string,
): LooseResolution<string> {
  const t = target.trim();
  if (t === '') return { kind: 'none' };
  const scored = graph.nodes.map((n) => {
    const p = n.path ?? '';
    let score = p ? scorePathCandidate(t, p) : 0;
    const label = n.label.toLowerCase();
    const tl = t.toLowerCase();
    if (score < 60 && label === tl) score = 60;
    else if (score < 30 && tl.length >= 4 && label.includes(tl)) score = 30;
    return { item: n.id, score, tiebreak: (p || n.id).length };
  });
  return decide(scored, HOW_PATH);
}

/** Loose match over digest services by id tail, name, dir and containment. */
export function resolveServiceLoose(
  services: ReadonlyArray<{ id: string; name: string; dir?: string }>,
  wanted: string,
): LooseResolution<string> {
  const w = normalisePath(wanted);
  if (w === '') return { kind: 'none' };
  const scored = services.map((s) => {
    const tail = s.id.includes(':') ? s.id.slice(s.id.indexOf(':') + 1) : s.id;
    const keys = [s.id, tail, s.name, s.dir ?? ''].map(normalisePath).filter((k) => k !== '');
    let score = 0;
    for (const k of keys) {
      if (k === w) score = Math.max(score, 100);
      else if (k.endsWith(`/${w}`) || basenameOf(k) === w) score = Math.max(score, 80);
      else if (w.length >= 3 && k.includes(w)) score = Math.max(score, 40);
      else if (k.length >= 3 && w.includes(k)) score = Math.max(score, 35);
    }
    return { item: s.id, score, tiebreak: s.id.length };
  });
  return decide(scored, (score) => (score >= 80 ? 'service name' : 'partial service name'));
}

/**
 * Loose match of a written path against the repository's files. `eachFile`
 * visits repo-relative paths and stops when its callback returns false; the
 * scan is bounded by the caller's own walk cap. Only files whose path ends in
 * the written basename are candidates, so a bare `index` still ranks every
 * `index.*` rather than every file.
 */
export function resolveRepoFileLoose(
  written: string,
  eachFile: (visit: (rel: string) => boolean) => void,
): LooseResolution<string> {
  const w = normalisePath(written);
  const stem = stripExt(basenameOf(w));
  if (stem === '') return { kind: 'none' };
  const scored: { item: string; score: number; tiebreak: number }[] = [];
  eachFile((rel) => {
    const score = scorePathCandidate(w, rel);
    if (score >= 50) scored.push({ item: rel.replace(/\\/g, '/'), score, tiebreak: rel.length });
    return scored.length < 200;
  });
  return decide(scored, HOW_PATH);
}

/** The one-line evidence prefix a resolved call carries. */
export function resolvedNote(written: string, to: string, how: string): string {
  return `resolved "${written}" to ${to} (${how})`;
}

/** The evidence a call with several honest readings returns instead of a refusal. */
export function severalNote(tool: string, written: string, hits: readonly string[], how: string): string {
  return (
    `${tool} "${written}" matched ${hits.length} things by ${how} — call again with exactly one of: ` +
    hits.join(', ')
  );
}
