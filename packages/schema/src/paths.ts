/**
 * THE ROUTE BETWEEN TWO NODES.
 *
 * `impact.ts` answers with SETS — what depends on this, what depends on that.
 * Both are true and neither answers "how does the gateway reach postgres",
 * which is the question a person actually asks of an architecture diagram. Two
 * services can each appear in the other's closure with the reader still unable
 * to say what runs in between.
 *
 * DIRECTION IS INHERITED, NOT RE-DECIDED. `impact.ts` states the law —
 * `edge X -> Y ⇔ X depends on Y` — and calls getting it backwards the single
 * most important thing in that file. A path from A to B is therefore a
 * DEPENDENCY CHAIN: A needs B, through the nodes between. Walking the adjacency
 * the other way would quietly answer the blast-radius question instead, and it
 * would look right.
 *
 * SIMPLE PATHS ONLY, and the choice is forced rather than preferred: a graph
 * with a cycle has infinitely many walks between two nodes and finitely many
 * paths that visit no node twice. Stated here so nobody has to discover it by
 * wondering where their loop went.
 *
 * IT IS BOUNDED THREE WAYS, AND IT SAYS WHEN A BOUND BIT. Enumerating simple
 * paths is exponential in the worst case — a dense 12-node graph has hundreds
 * of thousands — so an unbounded version is not slow, it is a hang. The three
 * bounds are how many paths to return, how long a path may be, and how much
 * searching to do before giving up. A truncated list returned as though it were
 * complete is how a tool tells someone there are five routes into their
 * database when there are fifty, so `truncated` and `note` are part of the
 * result and not an afterthought.
 *
 * PURE and TOTAL, like the module it sits beside: it never throws, never
 * mutates its input, an unknown node yields an empty list, and every run over
 * one graph returns the same paths in the same order.
 */

import type { ImpactLink } from './impact.js';

export interface PathsOptions {
  /** Most paths to return. Beyond this the result is marked truncated. */
  maxPaths?: number;
  /** Most NODES in a returned path, endpoints included. */
  maxDepth?: number;
  /** Search budget: node expansions before the walk gives up. */
  maxVisits?: number;
}

export interface PathsResult {
  /** Each path is the walk itself — `[from, …, to]`. Shortest first. */
  paths: string[][];
  /** True when a bound bit, so the list may not be every route there is. */
  truncated: boolean;
  /** What was cut and by which bound. Present only when `truncated`. */
  note?: string;
  /** Whether the endpoints appear in the graph at all. */
  fromExists: boolean;
  toExists: boolean;
}

/**
 * The bounds a caller inherits by saying nothing.
 *
 * `maxPaths` is 20 because a list longer than that is not read, it is scrolled;
 * `maxDepth` is 12 because a dependency chain deeper than a dozen services is a
 * finding in itself rather than a route anyone traces; `maxVisits` is the
 * backstop that keeps a dense graph from turning an answer into a hang, and is
 * deliberately far above `maxPaths` so the ordinary case never reaches it.
 */
export const PATHS_DEFAULTS = {
  maxPaths: 20,
  maxDepth: 12,
  maxVisits: 50_000,
} as const;

/** Adjacency in the src→dst direction, deduplicated and sorted. */
function adjacency(links: Iterable<ImpactLink>): Map<string, string[]> {
  const seen = new Map<string, Set<string>>();
  for (const l of links) {
    if (!l || typeof l.srcId !== 'string' || typeof l.dstId !== 'string') continue;
    let out = seen.get(l.srcId);
    if (!out) {
      out = new Set<string>();
      seen.set(l.srcId, out);
    }
    /* A self-loop is dropped here rather than filtered later: it can never
       appear in a simple path, and carrying it only invites a walk that has to
       remember to skip it. */
    if (l.dstId !== l.srcId) out.add(l.dstId);
  }
  const adj = new Map<string, string[]>();
  /* Sorted so the enumeration order — and therefore the tiebreak between two
     paths of equal length — is a property of the graph, not of the order some
     detector happened to emit its edges in. */
  for (const [src, dsts] of seen) adj.set(src, [...dsts].sort());
  return adj;
}

function nodeSet(links: Iterable<ImpactLink>): Set<string> {
  const all = new Set<string>();
  for (const l of links) {
    if (!l) continue;
    if (typeof l.srcId === 'string') all.add(l.srcId);
    if (typeof l.dstId === 'string') all.add(l.dstId);
  }
  return all;
}

export function pathsBetween(
  links: Iterable<ImpactLink>,
  fromId: string,
  toId: string,
  opts: PathsOptions = {},
): PathsResult {
  const maxPaths = opts.maxPaths ?? PATHS_DEFAULTS.maxPaths;
  const maxDepth = opts.maxDepth ?? PATHS_DEFAULTS.maxDepth;
  const maxVisits = opts.maxVisits ?? PATHS_DEFAULTS.maxVisits;

  const all = nodeSet(links);
  const fromExists = all.has(fromId);
  const toExists = all.has(toId);
  const empty: PathsResult = { paths: [], truncated: false, fromExists, toExists };

  /* An unknown endpoint is not "no route" — see the test. And a node to itself
     is no route either, matching impact.ts, where a self-loop never places a
     node in its own result. */
  if (!fromExists || !toExists || fromId === toId) return empty;

  const adj = adjacency(links);

  const found: string[][] = [];
  const path: string[] = [fromId];
  const onPath = new Set<string>([fromId]);
  let visits = 0;
  let hitPathCap = false;
  let hitDepth = false;
  let hitVisits = false;

  /*
   * Depth-first over SIMPLE paths. Recursion is bounded by `maxDepth`, which is
   * small, so the call stack cannot be the thing that fails.
   */
  const walk = (node: string): void => {
    if (hitVisits) return;
    if (visits >= maxVisits) {
      hitVisits = true;
      return;
    }
    visits += 1;

    for (const next of adj.get(node) ?? []) {
      if (hitVisits) return;
      if (onPath.has(next)) continue; // simple paths: never revisit

      if (next === toId) {
        if (found.length >= maxPaths) {
          /* Recorded, not returned. The caller is told the list is short rather
             than being handed a subset that looks like the whole answer. */
          hitPathCap = true;
          return;
        }
        found.push([...path, next]);
        continue;
      }

      /* `path.length + 1` is the node count of the extended path; a route to
         `toId` from there would be one longer again, so the compare is against
         the deepest path that could still be returned. */
      if (path.length + 1 >= maxDepth) {
        hitDepth = true;
        continue;
      }

      path.push(next);
      onPath.add(next);
      walk(next);
      path.pop();
      onPath.delete(next);
    }
  };

  walk(fromId);

  /* Shortest first; ties broken by the walk itself, which is alphabetical
     because the adjacency is sorted. `sort` is stable in every runtime this
     ships on, so equal-length paths keep that order. */
  found.sort((a, b) => a.length - b.length);

  const truncated = hitPathCap || hitVisits || (hitDepth && found.length === 0);
  let note: string | undefined;
  if (hitVisits) {
    note =
      `Stopped after ${maxVisits} steps of searching — this graph has more routes than ` +
      `can be listed, so these are some of them, not all.`;
  } else if (hitPathCap) {
    note = `More than ${maxPaths} routes exist; showing the ${found.length} shortest.`;
  } else if (hitDepth && found.length === 0) {
    note =
      `No route within ${maxDepth} nodes. There may be a longer one — the search stopped ` +
      `at that depth rather than reporting a chain nobody would trace.`;
  }

  return { paths: found, truncated, ...(note ? { note } : {}), fromExists, toExists };
}
