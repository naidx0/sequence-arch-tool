/**
 * THE FOUR NEGATIVES — the questions the scan could always answer and never was
 * asked.
 *
 * Everything else this engine computes is a POSITIVE: this calls that, this
 * reads that table, these depend on this. All true, and none of it is the
 * question a person opens an architecture tool with. That question is the other
 * shape — what is in here that nothing uses, and what is missing that should
 * not be. The material for all four was already in the graph or in something
 * the scan built and discarded.
 *
 *   1. `foreignTableReads` — a table read by a service that does not own it.
 *      The coupling nobody declared, and the reason a schema change breaks a
 *      service that was never mentioned in the ticket.
 *   2. `uncalledRoutes` — a route with no caller. This one needed the route
 *      INVENTORY, which the joiner built to match callers and then dropped; a
 *      route nothing calls produces no edge, so it left no trace at all.
 *   3. `unconsumedTopics` — a publisher writing into the void.
 *   4. `untestedFiles` — a product file with no test anywhere in its REVERSE
 *      closure. Not "has no test file named after it", which is a naming
 *      convention; "nothing that tests anything reaches this", which is a graph
 *      question and the one a coverage tool cannot answer.
 *
 * EVERY ONE OF THESE IS A CLAIM ABOUT ABSENCE, and absence is the most
 * dangerous thing to be wrong about: a false positive here tells someone to
 * delete a route that is live. Two rules follow, and they are why this file is
 * longer than the algorithms need to be.
 *
 * FIRST, EVERY FINDING CARRIES THE EVIDENCE THAT LOCATES IT. "You have a dead
 * route" is not actionable; "api/routes.ts:20 is a dead route" is.
 *
 * SECOND, IT REFUSES TO ANSWER FROM ABSENT DATA. A graph with no route
 * inventory is not a graph with no routes, and treating the two the same would
 * report every route in the repository as dead. A repository with no tests is
 * not a repository where every file is untested — the first is one finding a
 * person can act on, the second is three hundred they cannot. Both cases are
 * reported as a STATE (`routeInventory`, `testCoverage`) rather than as an
 * empty list that looks like a clean bill of health.
 */

import type { ArchEdge, ArchGraph, ArchNode } from '@sequence/schema';

import { isTestFile } from '../testFiles.js';
import { liftToTopLevel } from '../explain/serviceGraph.js';

export interface ForeignTableRead {
  table: string;
  /** The service doing the reading. */
  reader: string;
  /** The service that writes it, and therefore owns it. */
  owner: string;
  /** The file the read is in — where to look. */
  file: string;
  line?: number;
}

export interface UncalledRoute {
  service: string;
  method: string;
  path: string;
  file: string;
  line: number;
}

/**
 * WHAT "UNCALLED" CAN AND CANNOT MEAN, said in the result rather than in a
 * doc nobody opens.
 *
 * A single-repo scan sees callers that live in this repo. Measured on the
 * shopfront fixture, 6 of 16 routes came back uncalled and several were
 * `/health` — endpoints a load balancer calls, correctly reported as having no
 * caller IN THIS REPOSITORY and absolutely not dead code.
 *
 * The finding is still worth having; a claim about absence that does not say
 * what it could not see is not. So the caveat rides with the answer, and a
 * reader who is about to delete a route reads it first.
 */
export const UNCALLED_ROUTE_CAVEAT =
  'A caller outside this repository is invisible to a single-repo scan: health checks and ' +
  'readiness probes, webhooks, a public API, a mobile client, another service in another ' +
  'repo. These routes have no caller HERE — that is not the same as unused. Check before ' +
  'deleting.';

export interface UnconsumedTopic {
  topic: string;
  /** Services observed publishing to it — who is writing into the void. */
  publishers: string[];
}

export interface UntestedFile {
  path: string;
  /** The service it belongs to, when it has one. */
  service?: string;
}

export interface Negatives {
  foreignTableReads: ForeignTableRead[];
  uncalledRoutes: UncalledRoute[];
  unconsumedTopics: UnconsumedTopic[];
  untestedFiles: UntestedFile[];
  /**
   * Whether a route inventory was available at all.
   *
   * `absent` means the graph predates the inventory or was authored rather than
   * scanned, and `uncalledRoutes` is empty because nothing could be checked —
   * NOT because every route has a caller. A caller that renders the second for
   * the first is confidently wrong about the whole repository.
   */
  routeInventory: 'absent' | 'empty' | 'present';
  /**
   * Rides with `uncalledRoutes` whenever there are any — see
   * {@link UNCALLED_ROUTE_CAVEAT}. Absent when the list is empty, because a
   * caveat about nothing is noise.
   */
  uncalledRouteCaveat?: string;
  /**
   * `no-tests` when the repository contains no test file at all. `untestedFiles`
   * is then empty on purpose: "all 300 files are untested" is true and useless,
   * and the finding worth reading is this state, said once.
   */
  testCoverage: 'no-tests' | 'measured';
}

const DB_READ_KINDS = new Set(['db_read', 'db_access']);
const DB_WRITE_KINDS = new Set(['db_write', 'db_access']);

function tableOf(e: ArchEdge): string | undefined {
  const t = (e.detail as { table?: unknown } | undefined)?.table;
  return typeof t === 'string' && t.trim() ? t.trim() : undefined;
}

function matchedRouteOf(e: ArchEdge): string | undefined {
  const m = (e.detail as { matchedRoute?: unknown } | undefined)?.matchedRoute;
  return typeof m === 'string' && m.trim() ? m.trim() : undefined;
}

/** `GET /orders` → `/orders`; tolerant of a bare path with no method. */
function pathOfMatched(matched: string): string {
  const parts = matched.split(/\s+/);
  return (parts.length > 1 ? parts.slice(1).join(' ') : parts[0]) ?? '';
}

export function findNegatives(graph: ArchGraph): Negatives {
  const byId = new Map<string, ArchNode>(graph.nodes.map((n) => [n.id, n]));
  const lift = liftToTopLevel(graph);
  const serviceOf = (id: string): string | undefined => {
    const top = lift(id);
    return top && top.kind === 'service' ? top.label : undefined;
  };

  /* ── 1. foreign table reads ─────────────────────────────────────────────
     Ownership is WRITING. A service that only reads a table is a consumer of
     someone else's data by definition, and the finding is exactly that
     asymmetry. */
  const writersByTable = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (!DB_WRITE_KINDS.has(e.kind)) continue;
    const table = tableOf(e);
    const svc = serviceOf(e.srcId);
    if (!table || !svc) continue;
    let set = writersByTable.get(table);
    if (!set) writersByTable.set(table, (set = new Set()));
    set.add(svc);
  }

  const foreignSeen = new Set<string>();
  const foreignTableReads: ForeignTableRead[] = [];
  for (const e of graph.edges) {
    if (!DB_READ_KINDS.has(e.kind)) continue;
    const table = tableOf(e);
    const reader = serviceOf(e.srcId);
    if (!table || !reader) continue;

    const writers = writersByTable.get(table);
    /* No writer ⇒ NO OWNER, so there is no "other than the owner" to report.
       Naming one would accuse a service at random; the honest answer is that
       this finding does not apply. Two writers ⇒ shared ownership, which may be
       a smell but is a DIFFERENT one, and saying it in these words would be
       wrong. */
    if (!writers || writers.size !== 1) continue;
    const owner = [...writers][0]!;
    if (owner === reader) continue;

    const key = `${table}\u0000${reader}`;
    if (foreignSeen.has(key)) continue; // one finding per (table, reader) pair
    foreignSeen.add(key);

    const src = byId.get(e.srcId);
    foreignTableReads.push({
      table,
      reader,
      owner,
      file: src?.path ?? e.srcId,
      ...(e.evidence?.[0]?.line ? { line: e.evidence[0].line } : {}),
    });
  }

  /* ── 2. uncalled routes ─────────────────────────────────────────────────
     A route is "called" when some http edge matched it. The joiner records the
     match on the edge, so this is a set difference between what was registered
     and what was reached. */
  const inventory = graph.routes;
  const routeInventory: Negatives['routeInventory'] =
    inventory === undefined ? 'absent' : inventory.length === 0 ? 'empty' : 'present';

  const matchedPaths = new Set<string>();
  for (const e of graph.edges) {
    const m = matchedRouteOf(e);
    if (m) matchedPaths.add(pathOfMatched(m));
  }

  const uncalledRoutes: UncalledRoute[] = [];
  for (const r of inventory ?? []) {
    if (matchedPaths.has(r.path)) continue;
    /* A PREFIX route is reached by any call beneath it, so an exact-path miss
       does not make it dead — the Go subtree case, where `/shipments/` is
       registered and `/shipments/42` is what gets called. */
    if (r.prefix && [...matchedPaths].some((p) => p.startsWith(r.path))) continue;
    uncalledRoutes.push({
      service: r.service,
      method: r.method,
      path: r.path,
      file: r.file,
      line: r.line,
    });
  }

  /* ── 3. unconsumed topics ───────────────────────────────────────────────── */
  const publishersByTopic = new Map<string, Set<string>>();
  const consumedTopics = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind === 'queue_publish') {
      const svc = serviceOf(e.srcId);
      let set = publishersByTopic.get(e.dstId);
      if (!set) publishersByTopic.set(e.dstId, (set = new Set()));
      if (svc) set.add(svc);
    } else if (e.kind === 'queue_consume') {
      consumedTopics.add(e.dstId);
    }
  }

  const unconsumedTopics: UnconsumedTopic[] = [];
  for (const [topicId, publishers] of publishersByTopic) {
    if (consumedTopics.has(topicId)) continue;
    const node = byId.get(topicId);
    /* Only real topic nodes. The joiner's dynamic-topic fallback draws a publish
       edge at the BROKER datastore when it cannot name the topic, and reporting
       "nobody consumes redis" would be nonsense. */
    if (!node || node.kind !== 'topic') continue;
    unconsumedTopics.push({ topic: node.label, publishers: [...publishers].sort() });
  }

  /* ── 4. product files no test reaches ───────────────────────────────────
     A REVERSE closure from every test file: walk imports forwards from the
     tests and mark everything they reach. What is left over is what no test
     touches, however indirectly — which is the honest reading of "untested",
     and a stricter one than any filename convention gives. */
  const fileNodes = graph.nodes.filter((n) => n.kind === 'file' && typeof n.path === 'string');
  const testNodes = fileNodes.filter((n) => isTestFile(n.path!));
  const testCoverage: Negatives['testCoverage'] = testNodes.length === 0 ? 'no-tests' : 'measured';

  const untestedFiles: UntestedFile[] = [];
  if (testCoverage === 'measured') {
    const out = new Map<string, string[]>();
    for (const e of graph.edges) {
      if (e.kind !== 'import') continue;
      const arr = out.get(e.srcId);
      if (arr) arr.push(e.dstId);
      else out.set(e.srcId, [e.dstId]);
    }

    const reached = new Set<string>();
    const stack = testNodes.map((n) => n.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      for (const next of out.get(id) ?? []) if (!reached.has(next)) stack.push(next);
    }

    for (const n of fileNodes) {
      if (isTestFile(n.path!)) continue; // a test is not an untested file
      if (reached.has(n.id)) continue;
      const svc = serviceOf(n.id);
      untestedFiles.push({ path: n.path!, ...(svc ? { service: svc } : {}) });
    }
  }

  /* Sorted throughout, so two scans of one repository produce byte-identical
     findings and a diff between them means something changed in the code. */
  foreignTableReads.sort(
    (a, b) => a.table.localeCompare(b.table) || a.reader.localeCompare(b.reader),
  );
  uncalledRoutes.sort(
    (a, b) =>
      a.service.localeCompare(b.service) ||
      a.path.localeCompare(b.path) ||
      a.method.localeCompare(b.method),
  );
  unconsumedTopics.sort((a, b) => a.topic.localeCompare(b.topic));
  untestedFiles.sort((a, b) => a.path.localeCompare(b.path));

  return {
    foreignTableReads,
    uncalledRoutes,
    ...(uncalledRoutes.length > 0 ? { uncalledRouteCaveat: UNCALLED_ROUTE_CAVEAT } : {}),
    unconsumedTopics,
    untestedFiles,
    routeInventory,
    testCoverage,
  };
}
