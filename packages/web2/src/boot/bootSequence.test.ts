import { describe, expect, it } from 'vitest';

import type { GetArchGraphResponse } from '@sequence/api-types';

import {
  BOOT_ROUTES,
  readScannedGraph,
  runBoot,
  summarizeGraph,
} from './bootSequence';
import type { BootTransport, WireResult } from './bootSequence';

/**
 * ITEM 2.4 — THE BOOT LADDER, PROVED WITHOUT A NETWORK.
 *
 * The ladder is `platform probe -> attached hydrate -> static-graph fallback`,
 * and every rung of it is a decision about what the app is allowed to CLAIM.
 * Those decisions are pure: they are a function of what came back, so they are
 * tested against injected answers rather than against a server. The transport
 * that turns those answers into HTTP is tested separately, in boot.test.tsx,
 * where the assertion is about which hosts it may talk to.
 *
 * The property under test throughout is the local-first non-negotiable stated
 * in CLAUDE.md: the app boots and delivers its core with NO network and NO key.
 * So the interesting cases here are the ones where nothing answers, where
 * something answers that is not the platform, and where the platform answers
 * with a refusal — and in each of them the assertion is that the outcome names
 * what is true and never invents a graph.
 */

/* -------------------------------------------------------------------------- *
 * Fixtures. A graph small enough to read, real enough to count.
 * -------------------------------------------------------------------------- */

function graphFixture(): GetArchGraphResponse {
  return {
    version: 1,
    scannedAt: '2026-08-20T10:00:00.000Z',
    repoRoot: '/home/max/projects/shopfront',
    repoName: 'shopfront',
    nodes: [
      { id: 'svc:web', kind: 'service', label: 'Web' },
      { id: 'svc:api', kind: 'service', label: 'Api' },
      { id: 'db:orders', kind: 'datastore', label: 'Orders' },
      { id: 'topic:events', kind: 'topic', label: 'Events' },
      { id: 'mod:util', kind: 'module', label: 'Util' },
    ],
    edges: [
      {
        id: 'e1',
        srcId: 'svc:web',
        dstId: 'svc:api',
        kind: 'http',
        confidence: 1,
        origin: 'deterministic',
        evidence: [{ file: 'web/src/api.ts', line: 12, snippet: 'fetch("/api")' }],
      },
    ],
    warnings: [],
    nodeDetail: {},
  };
}

/** A transport whose every route is a hole; each test fills in only the rungs
 *  its own case reaches. A rung that is reached but not filled throws, so a
 *  test can never pass because the ladder silently skipped a step. */
function transport(parts: Partial<BootTransport>): BootTransport {
  const missing = (route: string) => async (): Promise<never> => {
    throw new Error(`the boot ladder reached ${route}, which this case did not expect`);
  };
  return {
    status: parts.status ?? missing('GET /api/status'),
    archGraph: parts.archGraph ?? missing('GET /archgraph.json'),
    recent: parts.recent ?? missing('GET /api/recent'),
    detach: parts.detach ?? missing('POST /api/detach'),
    browse: parts.browse ?? missing('GET /api/browse'),
    attach: parts.attach ?? missing('POST /api/attach'),
  };
}

const ok = <T,>(body: T, status = 200): WireResult<T> => ({ outcome: 'ok', status, body });
const failed = (status: number, body: unknown): WireResult<never> => ({
  outcome: 'error',
  status,
  body,
});
const unreachable = (message = 'fetch failed'): WireResult<never> => ({
  outcome: 'unreachable',
  message,
});
const notJson = (status = 200): WireResult<never> => ({ outcome: 'not-json', status });

/* -------------------------------------------------------------------------- *
 * The ladder
 * -------------------------------------------------------------------------- */

describe('item 2.4 — the boot ladder', () => {
  it('names the three routes it may call, and they are same-origin paths', () => {
    // Non-vacuity for the whole file, and the one place the route list is
    // written down. A relative path is the entire mechanism by which boot
    // cannot reach a third-party host, so it is asserted rather than assumed.
    expect(BOOT_ROUTES.length).toBeGreaterThan(0);
    for (const route of BOOT_ROUTES) {
      expect(route.startsWith('/')).toBe(true);
      expect(route.startsWith('//')).toBe(false);
    }
  });

  it('hydrates an attached repo from the graph the platform already holds', async () => {
    const graph = graphFixture();
    const outcome = await runBoot(
      transport({
        status: async () =>
          ok({ attached: true, repoName: 'shopfront', root: '/home/max/projects/shopfront' }),
        archGraph: async () => ok<unknown>(graph),
      }),
    );

    expect(outcome.kind).toBe('attached');
    if (outcome.kind !== 'attached') return;
    expect(outcome.platform.reachable).toBe(true);
    expect(outcome.repo.repoName).toBe('shopfront');
    expect(outcome.repo.scannedAt).toBe('2026-08-20T10:00:00.000Z');
    expect(outcome.repo.graph.nodes).toHaveLength(5);
    // The detail map came with the graph and is not re-fetched: one object, so
    // the nodes and their MADR slots cannot refresh out of step.
    expect(outcome.repo.graph.nodeDetail).toEqual({});
  });

  it('goes to S0 when the platform is up and nothing is attached', async () => {
    const outcome = await runBoot(transport({ status: async () => ok({ attached: false }) }));

    expect(outcome.kind).toBe('unattached');
    expect(outcome.platform.reachable).toBe(true);
  });

  it('does not claim a repo it cannot read — an attached foreign repo is its own outcome', async () => {
    // GET /api/status answers `{attached:true}` with no name and no root to an
    // authenticated NON-owner; /archgraph.json would then 403. Rendering that
    // as "attached" would put a repo name the shell does not have on screen.
    const outcome = await runBoot(transport({ status: async () => ok({ attached: true }) }));

    expect(outcome.kind).toBe('foreign-repo');
    expect(outcome.platform.reachable).toBe(true);
  });

  it('says sign-in rather than offline when the platform answers 401', async () => {
    const outcome = await runBoot(
      transport({ status: async () => failed(401, { error: 'sign in required' }) }),
    );

    expect(outcome.kind).toBe('sign-in-required');
    // It ANSWERED. Reporting an authenticated server as unreachable would send
    // the user to check their network for a login problem.
    expect(outcome.platform.reachable).toBe(true);
  });

  it('falls back to a static graph when there is no platform but a graph is served', async () => {
    const graph = graphFixture();
    const outcome = await runBoot(
      transport({
        status: async () => unreachable(),
        archGraph: async () => ok<unknown>(graph),
      }),
    );

    expect(outcome.kind).toBe('static-graph');
    if (outcome.kind !== 'static-graph') return;
    expect(outcome.platform.reachable).toBe(false);
    expect(outcome.repo.repoName).toBe('shopfront');
    expect(outcome.repo.root).toBe('/home/max/projects/shopfront');
  });

  it('ends at no-engine when nothing answers at all', async () => {
    const outcome = await runBoot(
      transport({ status: async () => unreachable(), archGraph: async () => unreachable() }),
    );

    expect(outcome.kind).toBe('no-engine');
    expect(outcome.platform.reachable).toBe(false);
  });

  it('treats a 200 that is not JSON as "there is no platform here", never as an answer', async () => {
    // A plain static file server answers every unknown path with index.html and
    // a 200. Parsing that as a status body is how an app decides it is attached
    // to a repo that does not exist.
    const outcome = await runBoot(
      transport({ status: async () => notJson(), archGraph: async () => notJson() }),
    );

    expect(outcome.kind).toBe('no-engine');
    expect(outcome.platform.reachable).toBe(false);
  });

  it('refuses a static payload that is not a graph rather than painting it', async () => {
    const outcome = await runBoot(
      transport({
        status: async () => unreachable(),
        archGraph: async () => ok<unknown>({ hello: 'world' }),
      }),
    );

    expect(outcome.kind).toBe('no-engine');
  });

  it('reports an attached repo whose graph route refuses, as a failure with the reason', async () => {
    const outcome = await runBoot(
      transport({
        status: async () => ok({ attached: true, repoName: 'shopfront', root: '/r' }),
        archGraph: async () => failed(500, { error: 'scan failed: boom' }),
      }),
    );

    expect(outcome.kind).toBe('hydrate-failed');
    if (outcome.kind !== 'hydrate-failed') return;
    expect(outcome.failure.kind).toBe('scan-threw');
    expect(outcome.failure.message).toContain('boom');
  });
});

/* -------------------------------------------------------------------------- *
 * Reading a payload, and counting what is in it
 * -------------------------------------------------------------------------- */

describe('item 2.4 — a payload is a graph only when it proves it', () => {
  it('accepts the shape the route actually returns', () => {
    expect(readScannedGraph(graphFixture())).not.toBeNull();
  });

  it('supplies the empty detail map a raw archgraph.json file has no room for', () => {
    const raw = { ...graphFixture() } as Record<string, unknown>;
    delete raw.nodeDetail;

    const read = readScannedGraph(raw);
    expect(read).not.toBeNull();
    // `{}` is what the platform itself sends when there is no detail, so this
    // is the route's own "none", not an invention.
    expect(read?.nodeDetail).toEqual({});
  });

  it.each([
    ['null', null],
    ['a string', 'not a graph'],
    ['an html document', '<!doctype html><html></html>'],
    ['an object with no nodes', { version: 1, edges: [], repoName: 'x' }],
    ['an object whose nodes are not a list', { version: 1, nodes: {}, edges: [], repoName: 'x' }],
    ['an error envelope', { error: 'no repo attached' }],
  ])('refuses %s', (_label, payload) => {
    expect(readScannedGraph(payload)).toBeNull();
  });

  it('counts the five summary members off the graph', () => {
    // Arithmetic on data the analyzer produced, never a ranking or an
    // inference — the client may count what it was given and may decide
    // nothing. The five members mirror the platform's own graphSummary().
    expect(summarizeGraph(graphFixture())).toEqual({
      nodes: 5,
      edges: 1,
      services: 2,
      datastores: 1,
      topics: 1,
    });
  });

  it('counts zero as zero on an empty graph', () => {
    const empty = { ...graphFixture(), nodes: [], edges: [] };
    expect(summarizeGraph(empty)).toEqual({
      nodes: 0,
      edges: 0,
      services: 0,
      datastores: 0,
      topics: 0,
    });
  });
});
