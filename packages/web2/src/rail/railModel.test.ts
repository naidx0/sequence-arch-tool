import { describe, expect, it } from 'vitest';

import type { GetArchGraphResponse, GetFunctionsResponse } from '@sequence/api-types';

import type { RailRow } from '../state/types';
import { NO_EVIDENCE_ON_HOP, RAIL_ROW_CAP, buildFunctionIndex, buildRailRows, componentEdgeCounts, coverageBadgeText, coverageByPath, evidenceRef, filterRailRows, flowForFunction, nodeDetailViewFor, toRepoPath } from './railModel';

/* ══════════════════════════════════════════════════════════════════════════
   THE RAIL'S PURE MODEL — item 4.1–4.4
   packages/web2/src/rail/railModel.test.ts

   FIXTURE SCALE PROVES LOGIC. Every graph below is four to eight nodes,
   because a rule ("a hop exists when a call crosses a file") is provable at
   that scale and a result ("a minority of this repo's functions produce a
   hop") is not. The result half lives in `railGrounded.test.ts`, which reads
   the REAL engine's output for this repository and never invents a node.
   CLAUDE.md states the split in one line: "Fixture scale proves logic; only a
   REAL repo proves the result."

   PATHS ARE WRITTEN WITH BACKSLASHES ON PURPOSE in several cases below. That
   is not a Windows accident in the test — it is what the engine actually
   sends. Measured on this machine, 2026-08-20, straight off `/archgraph.json`:

       {"id":"file:packages\\acp\\src\\client.ts", … "path":"packages\\acp\\src\\client.ts"}

   while `state/types.ts` declares `RepoPath` as "Repo-relative, forward
   slashes. Native separators never reach the store." Both are true; the
   normalisation is this module's job, and a test that only ever fed it POSIX
   paths would pass while the rail rendered `packages\acp\src\client.ts` and
   matched nothing when the user typed `packages/acp`.
   ══════════════════════════════════════════════════════════════════════════ */

const B = String.fromCharCode(92);

/** `packages/acp/src/client.ts` → `packages\acp\src\client.ts`. */
function native(p: string): string {
  return p.split('/').join(B);
}

type Graph = GetArchGraphResponse;

function graph(partial: Partial<Graph>): Graph {
  return {
    version: 1,
    scannedAt: '2026-08-20T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'repo',
    nodes: [],
    edges: [],
    warnings: [],
    nodeDetail: {},
    ...partial,
  } as Graph;
}

/**
 * Two packages, two files each, one import edge inside `alpha` and one that
 * crosses from `alpha` into `beta`. Small enough to reason about; shaped
 * exactly like the real thing, backslashes included.
 */
function twoPackages(): Graph {
  return graph({
    nodes: [
      { id: 'repo', kind: 'repo', label: 'repo' },
      { id: 'svc:alpha', kind: 'service', label: 'alpha', parentId: 'repo', path: native('packages/alpha') },
      { id: 'svc:beta', kind: 'service', label: 'beta', parentId: 'repo', path: native('packages/beta') },
      {
        id: 'file:a1',
        kind: 'file',
        label: 'one.ts',
        parentId: 'svc:alpha',
        path: native('packages/alpha/src/one.ts'),
      },
      {
        id: 'file:a2',
        kind: 'file',
        label: 'two.ts',
        parentId: 'svc:alpha',
        path: native('packages/alpha/src/two.ts'),
      },
      {
        id: 'file:b1',
        kind: 'file',
        label: 'gate.ts',
        parentId: 'svc:beta',
        path: native('packages/beta/src/gate.ts'),
      },
      { id: 'store:pg', kind: 'datastore', label: 'postgres', parentId: 'repo' },
    ],
    edges: [
      {
        id: 'imp:a1-a2',
        srcId: 'file:a1',
        dstId: 'file:a2',
        kind: 'import',
        confidence: 1,
        origin: 'deterministic',
        evidence: [{ file: native('packages/alpha/src/one.ts'), line: 3, snippet: "import './two.js';" }],
      },
      {
        id: 'imp:a1-b1',
        srcId: 'file:a1',
        dstId: 'file:b1',
        kind: 'import',
        confidence: 1,
        origin: 'deterministic',
        evidence: [
          { file: native('packages/alpha/src/one.ts'), line: 4, snippet: "import { gate } from 'beta';" },
        ],
      },
    ],
    nodeDetail: {
      'svc:alpha': {
        whatItIs: 'Alpha',
        whatItDoes: 'packages alpha src',
        parts: [native('packages/alpha/src')],
      },
    },
  });
}

function functions(): GetFunctionsResponse {
  return {
    functionGraph: {
      nodes: [
        {
          id: 'fn:one',
          name: 'openGate',
          file: native('packages/alpha/src/one.ts'),
          startLine: 12,
          endLine: 20,
          lang: 'ts',
        },
        {
          id: 'fn:two',
          name: 'helper',
          file: native('packages/alpha/src/one.ts'),
          startLine: 30,
          endLine: 34,
          lang: 'ts',
        },
        {
          id: 'fn:three',
          name: 'store',
          file: native('packages/alpha/src/two.ts'),
          startLine: 5,
          endLine: 9,
          lang: 'ts',
        },
        {
          id: 'fn:four',
          name: 'gate',
          file: native('packages/beta/src/gate.ts'),
          startLine: 7,
          endLine: 11,
          lang: 'ts',
        },
      ],
      edges: [
        /* same file — never a hop. */
        { id: 'c1', srcId: 'fn:one', dstId: 'fn:two', kind: 'call' },
        /* crosses a file inside one package — a file-to-file hop, backed by imp:a1-a2. */
        { id: 'c2', srcId: 'fn:one', dstId: 'fn:three', kind: 'call' },
        /* crosses a package — a service-to-service hop, backed by imp:a1-b1. */
        { id: 'c3', srcId: 'fn:one', dstId: 'fn:four', kind: 'call' },
      ],
    },
    warnings: ['one route handler could not be attributed'],
  };
}

/* ============================================================== paths === */

describe('toRepoPath', () => {
  it('turns the engine native separator into the store forward slash', () => {
    expect(toRepoPath(native('packages/alpha/src/one.ts'))).toBe('packages/alpha/src/one.ts');
  });

  it('is total — an absent path is the empty path, never "undefined"', () => {
    expect(toRepoPath(undefined)).toBe('');
    expect(toRepoPath(null)).toBe('');
  });
});

/* ====================================================== the three rungs === */

describe('buildRailRows — three rungs and no fourth (sheet 11.2)', () => {
  const rows = buildRailRows(twoPackages(), buildFunctionIndex(functions()));

  it('emits only card, file and function rungs', () => {
    expect([...new Set(rows.map((r) => r.rung))].sort()).toEqual(['card', 'file', 'function']);
  });

  it('draws a card for every node the board draws, and for nothing else', () => {
    const cards = rows.filter((r) => r.rung === 'card').map((r) => r.id);
    expect(cards).toEqual(['svc:alpha', 'svc:beta', 'store:pg']);
  });

  it('never draws a module as a card — a module would double-count its files', () => {
    const withModule = twoPackages();
    withModule.nodes.push({ id: 'mod:alpha/0', kind: 'module', label: 'src', parentId: 'svc:alpha' });
    const ids = buildRailRows(withModule, null)
      .filter((r) => r.rung === 'card')
      .map((r) => r.id);
    expect(ids).not.toContain('mod:alpha/0');
  });

  it('hangs each file off its nearest board card, in repo order', () => {
    const order = rows.map((r) => `${r.rung}:${r.rung === 'file' ? r.path : r.id}`);
    expect(order.slice(0, 3)).toEqual([
      'card:svc:alpha',
      'file:packages/alpha/src/one.ts',
      'function:fn:one',
    ]);
  });

  it('carries the function count on the card and on the file', () => {
    const alpha = rows.find((r) => r.rung === 'card' && r.id === 'svc:alpha');
    const one = rows.find((r) => r.rung === 'file' && r.path === 'packages/alpha/src/one.ts');
    expect(alpha).toMatchObject({ count: 3 });
    expect(one).toMatchObject({ functionCount: 2 });
  });

  it('says zero rather than nothing for a card the scan could not name a file in', () => {
    const pg = rows.find((r) => r.rung === 'card' && r.id === 'store:pg');
    expect(pg).toMatchObject({ count: 0 });
  });

  it('carries the function line, because :line is the row (item 4.1)', () => {
    const fn = rows.find((r) => r.rung === 'function' && r.id === 'fn:one');
    expect(fn).toMatchObject({ line: 12, file: 'packages/alpha/src/one.ts', label: 'openGate' });
  });

  it('draws file rows with no function rows when the function graph has not loaded', () => {
    const bare = buildRailRows(twoPackages(), null);
    expect(bare.some((r) => r.rung === 'function')).toBe(false);
    expect(bare.filter((r) => r.rung === 'file')).toHaveLength(3);
  });
});

/* ============================================================= the filter === */

describe('filterRailRows — sheet 11.5', () => {
  const rows = buildRailRows(twoPackages(), buildFunctionIndex(functions()));

  it('reveals the ancestors of a hit so a match is never hidden', () => {
    const out = filterRailRows(rows, 'openGate');
    expect(out.rows.map((r) => r.id)).toEqual([
      'svc:alpha',
      'file:a1',
      'fn:one',
    ]);
  });

  it('counts hits, not scaffolding — the revealed ancestors are not matches', () => {
    expect(filterRailRows(rows, 'openGate').matches).toBe(1);
  });

  it('matches a file on its repo-relative path as well as on its name', () => {
    const out = filterRailRows(rows, 'alpha/src/two');
    expect(out.matches).toBe(1);
    expect(out.rows.map((r) => r.id)).toEqual(['svc:alpha', 'file:a2']);
  });

  it('returns everything, and no match count, for an empty query', () => {
    const out = filterRailRows(rows, '   ');
    expect(out.rows).toHaveLength(rows.length);
    expect(out.matches).toBeNull();
  });

  it('keeps repo order, so the result reads as the project and not as a dump', () => {
    const out = filterRailRows(rows, 'e');
    const positions = out.rows.map((r) => rows.findIndex((x) => x.id === r.id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

/* =========================================================== coverage === */

describe('coverage — item 4.4, the strongest thing Sequence has', () => {
  const g = twoPackages();

  it('counts every edge that touches a component, deduped', () => {
    /* imp:a1-a2 touches alpha only. imp:a1-b1 touches alpha and beta. */
    expect(componentEdgeCounts(g)).toEqual({
      'packages/alpha': 2,
      'packages/beta': 1,
    });
  });

  it('is ABSENT, never zeroed, when no answer has been given yet', () => {
    expect(coverageByPath(g, null)).toEqual({});
  });

  it('marks a component the last answer did not read', () => {
    const cov = coverageByPath(g, {
      edgesSeen: 1,
      edgesTotal: 2,
      packagesSeen: ['packages/alpha'],
      packagesMissed: ['packages/beta'],
    });
    expect(cov['packages/alpha']).toEqual({ edges: 2, inLastAnswer: true });
    expect(cov['packages/beta']).toEqual({ edges: 1, inLastAnswer: false });
  });

  it('makes no claim about a component the engine did not name', () => {
    const cov = coverageByPath(g, {
      edgesSeen: 2,
      edgesTotal: 2,
      packagesSeen: ['packages/alpha'],
      packagesMissed: [],
    });
    expect(Object.keys(cov)).toEqual(['packages/alpha']);
  });

  it('writes the badge the plan writes, thousands separator and all', () => {
    expect(coverageBadgeText('packages/web', { edges: 1545, inLastAnswer: false })).toBe(
      'packages/web · 1,545 edges · not in the last answer',
    );
  });

  it('does not write "1 edges"', () => {
    expect(coverageBadgeText('packages/ink', { edges: 1, inLastAnswer: false })).toBe(
      'packages/ink · 1 edge · not in the last answer',
    );
  });

  it('writes nothing for a component that WAS in the answer', () => {
    expect(coverageBadgeText('packages/web', { edges: 1545, inLastAnswer: true })).toBeNull();
  });
});

/* ================================================================ flow === */

describe('flowForFunction — item 4.2', () => {
  const g = twoPackages();
  const index = buildFunctionIndex(functions());

  it('produces a hop for every call that leaves the file, and none for one that does not', () => {
    const trace = flowForFunction('fn:one', index, g);
    expect(trace.hops).toHaveLength(2);
    expect(trace.hops.map((h) => `${h.from}->${h.to}`)).toEqual([
      'file:a1->file:a2',
      'svc:alpha->svc:beta',
    ]);
  });

  it('rides the real arch edge and carries its real file:line', () => {
    const [inside, across] = flowForFunction('fn:one', index, g).hops;
    expect(inside.via).toBe('imp:a1-a2');
    expect(evidenceRef(inside.evidence)).toBe('packages/alpha/src/one.ts:3');

    /*
     * THE CROSS-COMPONENT HOP HAS NO BOARD EDGE AND STILL HAS PROOF, and this
     * assertion is the one that caught the first version of the model.
     *
     * `svc:alpha → svc:beta` is a real hop: `openGate` really does call into
     * the other package. But this scan drew no edge between the two SERVICE
     * nodes — measured on the real repository, 0 of 997 arch edges cross a
     * component — so there is nothing for the canvas to light and `via` is
     * honestly null. The proof is one level down, on the import that made the
     * call possible, and the rail shows THAT rather than reporting a hop it
     * can prove as a hop it cannot.
     */
    expect(across.via).toBeNull();
    expect(evidenceRef(across.evidence)).toBe('packages/alpha/src/one.ts:4');
  });

  it('reports the honest empty case VERBATIM for a hop no edge backs', () => {
    /*
     * MEASURED, 2026-08-20, on this repository: 861 hops, every one of them
     * backed by a real import edge, so this state has ZERO occurrences here
     * today. It is nonetheless a declared and reachable state of the contract
     * — `state/types.ts` types `FlowHop.evidence` as `Evidence | null` and
     * says why: "It is null and not an omitted field so that a hop without
     * proof is impossible to skip past silently: every consumer must handle
     * it." A dynamic import, a barrel re-export or a Go package-scope call
     * produces exactly this. So the sentence is proven against the state, not
     * against a repository that happens not to contain it.
     */
    const noEdge = twoPackages();
    noEdge.edges = [];
    const trace = flowForFunction('fn:one', buildFunctionIndex(functions()), noEdge);
    expect(trace.hops).toHaveLength(2);
    for (const hop of trace.hops) {
      expect(hop.via).toBeNull();
      expect(hop.evidence).toBeNull();
      expect(evidenceRef(hop.evidence)).toBe('shape unknown — no evidence on this hop');
    }
    expect(NO_EVIDENCE_ON_HOP).toBe('shape unknown — no evidence on this hop');
  });

  it('does not play a function the scan could not put on the board', () => {
    const trace = flowForFunction('fn:four', index, g);
    expect(trace.originNodeId).toBe('svc:beta');
    expect(trace.hops).toEqual([]);
    expect(trace.traced).toBe(false);
  });

  it('is total on an id the function graph does not have', () => {
    const trace = flowForFunction('fn:nope', index, g);
    expect(trace).toMatchObject({ originNodeId: null, hops: [], traced: false });
  });
});

/* ========================================================= node detail === */

describe('nodeDetailViewFor — item 4.3', () => {
  const g = twoPackages();

  it('carries what it is, its parts, its files and its own edges', () => {
    const view = nodeDetailViewFor(g, 'svc:alpha');
    expect(view?.detail?.whatItIs).toBe('Alpha');
    expect(view?.detail?.parts).toEqual(['packages/alpha/src']);
    expect(view?.files).toEqual(['packages/alpha/src/one.ts', 'packages/alpha/src/two.ts']);
    expect(view?.edges).toEqual([]);
  });

  it('says the detail is absent rather than inventing one', () => {
    const view = nodeDetailViewFor(g, 'svc:beta');
    expect(view?.detail).toBeNull();
    expect(view?.node.label).toBe('beta');
  });

  it('resolves a file node to its own row, with the edges that touch it', () => {
    const view = nodeDetailViewFor(g, 'file:a1');
    expect(view?.edges.map((e) => e.id)).toEqual(['imp:a1-a2', 'imp:a1-b1']);
  });

  it('is null for an id the graph does not have', () => {
    expect(nodeDetailViewFor(g, 'svc:nope')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE FILTER'S CAP.

   Typing one or two characters — the exact gesture the filter exists for —
   matched thousands of rows on this repository and mounted a DOM button for
   every one, stalling the whole shell. The index carries 647 files and over
   three thousand functions.
   ══════════════════════════════════════════════════════════════════════════ */
describe('the filter does not mount an unbounded list', () => {
  function manyFiles(n: number): RailRow[] {
    return Array.from({ length: n }, (_, i) => ({
      rung: 'file' as const,
      id: `f${i}`,
      label: `match${i}.ts`,
      path: `src/match${i}.ts`,
      depth: 0,
      functionCount: 0,
    })) as unknown as RailRow[];
  }

  it('caps the rendered rows', () => {
    const out = filterRailRows(manyFiles(1000), 'match');
    expect(out.rows).toHaveLength(RAIL_ROW_CAP);
  });

  it('COUNTS EVERY HIT, not just the ones it rendered', () => {
    /* The number a reader needs is how many exist. Reporting the capped count
       would tell them their repository contains 300 matches. */
    const out = filterRailRows(manyFiles(1000), 'match');
    expect(out.matches).toBe(1000);
    expect(out.omitted).toBe(1000 - RAIL_ROW_CAP);
  });

  it('says nothing was withheld when everything fits', () => {
    const out = filterRailRows(manyFiles(10), 'match');
    expect(out.omitted).toBe(0);
    expect(out.rows).toHaveLength(10);
  });

  it('DOES NOT CAP THE UNFILTERED TREE', () => {
    /*
     * With no query this is the tree the reader opened, already bounded by
     * what they expanded. Truncating it would hide their own repository from
     * them — the cap exists for the filter, which is where the unbounded match
     * count comes from.
     */
    const out = filterRailRows(manyFiles(1000), '');
    expect(out.rows).toHaveLength(1000);
    expect(out.omitted).toBe(0);
    expect(out.matches).toBeNull();
  });

  it('a query that matches nothing reports zero, not null', () => {
    /* "No hits" and "no query" are different facts and read differently. */
    const out = filterRailRows(manyFiles(10), 'zzzz');
    expect(out.matches).toBe(0);
    expect(out.omitted).toBe(0);
  });
});
