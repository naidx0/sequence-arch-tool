import type { Coverage } from '../state/types';

/**
 * THE CUT, IN WORDS, BESIDE THE ANSWER.
 *
 * CANON: coverage is "the single strongest thing we have and nothing else on the
 * list is close" — Codex and Claude Code structurally CANNOT say what they did
 * not read, because neither holds a complete model of the repository to subtract
 * a read-set from. We can.
 *
 * And we were not saying it. The engine computed it, the wire carried it, the
 * store kept it, and the rail used it to tint per-file badges — while
 * `packagesMissed`, which IS the cut, appeared in exactly one place outside
 * tests: a specimen fixture. The strongest claim in the product was never put in
 * front of the person reading the answer.
 *
 * Pure and string-returning so the sentence is testable without a renderer, and
 * so the wording lives in one place rather than being re-derived by every
 * surface that wants to say it.
 */

/** How many missed components to name before counting the rest. */
const NAMED_LIMIT = 3;

/** `2326` → `2,326`. The denominator is the point; it should be readable. */
function group(n: number): string {
  return n.toLocaleString('en-US');
}

export function coverageSentence(coverage: Coverage | null): string | null {
  if (!coverage) return null;

  /*
   * NO DENOMINATOR, NO CLAIM. A graph with no edges makes "0 of 0", which reads
   * as a failure to look rather than as nothing to look at — and coverage is the
   * one number in this product that must never be able to mislead downward.
   * Withheld entirely; the answer simply carries no line.
   */
  if (coverage.edgesTotal <= 0) return null;

  const head = `answered from ${group(coverage.edgesSeen)} of ${group(coverage.edgesTotal)} edges`;
  const missed = coverage.packagesMissed;

  /*
   * EMPTY IS A FINDING. For a whole-system ask, ranked selection reaches every
   * component and the loss shows up as depth rather than absence — so silence
   * here would be read as "we did not check", which is the opposite of true.
   */
  if (missed.length === 0) return `${head} — every component contributed`;

  const named = missed.slice(0, NAMED_LIMIT);
  const rest = missed.length - named.length;
  /* A truncated list carries its own remainder. A list that simply stops is a
   * lie about how much was cut, and this is the sentence that must not lie. */
  const list = rest > 0 ? `${named.join(', ')}, and ${rest} more` : named.join(', ');
  const noun = missed.length === 1 ? 'component' : 'components';

  return `${head} — ${missed.length} ${noun} contributed nothing: ${list}`;
}

/** What the coverage line of an agent run needs from the scanned repo: its root and its services. */
export interface GraphFacts {
  repoRoot?: string | null;
  services: { id: string; label: string; path: string }[];
}

/** The services of an attached (or stale) repo, or null when there is none. */
export function graphFactsOf(repo: { phase: string; repo?: { root?: string; graph?: { nodes?: readonly unknown[] } } }): GraphFacts | null {
  if (repo.phase !== 'attached' && repo.phase !== 'stale') return null;
  const nodes = (repo.repo?.graph?.nodes ?? []) as { id?: string; kind?: string; label?: string; path?: string }[];
  const services = nodes
    .filter((n) => n.kind === 'service' && typeof n.id === 'string' && typeof n.path === 'string' && n.path !== '' && n.path !== '.')
    .map((n) => ({ id: n.id as string, label: n.label || (n.id as string), path: n.path as string }));
  return { repoRoot: repo.repo?.root ?? null, services };
}

const slash = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

/**
 * THE COVERAGE LINE OF AN AGENT RUN: which services the run's Read, search and map calls touched. Computed from what the
 * agent actually opened (the run's `readPaths`), against the scanned services. Nothing for a run that is not finished, read
 * nothing (an old record has no paths), or has no graph to count against.
 */
export function coverageFromRun(run: { status: string; readPaths?: readonly string[] }, graph: GraphFacts | null): string | null {
  if (run.status !== 'done' || !run.readPaths?.length || !graph || graph.services.length === 0) return null;
  const root = graph.repoRoot ? slash(graph.repoRoot).toLowerCase() : null;
  const seen = new Set<string>();
  for (const raw of run.readPaths) {
    if (raw.startsWith('svc:')) {
      if (graph.services.some((s) => s.id === raw)) seen.add(raw);
      continue;
    }
    let p = slash(raw);
    if (root && p.toLowerCase().startsWith(`${root}/`)) p = p.slice(root.length + 1);
    let best: { id: string; len: number } | null = null;
    for (const s of graph.services) {
      const sp = slash(s.path);
      if ((p === sp || p.startsWith(`${sp}/`)) && (!best || sp.length > best.len)) best = { id: s.id, len: sp.length };
    }
    if (best) seen.add(best.id);
  }
  const read = graph.services.filter((s) => seen.has(s.id));
  const missed = graph.services.filter((s) => !seen.has(s.id));
  if (read.length === 0) return null;
  if (missed.length === 0) return `drew on all ${graph.services.length} services`;
  const names = (xs: typeof read, limit: number): string => (xs.length > limit ? `${xs.slice(0, limit).map((x) => x.label).join(', ')}, and ${xs.length - limit} more` : xs.map((x) => x.label).join(', '));
  return `drew on ${read.length} of ${graph.services.length} services (${names(read, NAMED_LIMIT)}), did not read ${names(missed, NAMED_LIMIT)}`;
}
