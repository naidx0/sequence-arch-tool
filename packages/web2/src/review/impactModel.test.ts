import { describe, expect, it } from 'vitest';
import type { ArchGraph } from '@sequence/schema';
import type { FunctionGraph } from '@sequence/schema';

import { computeReviewImpact, nodeForPath } from './impactModel';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 5.5 / B2 — THE IMPACT PANEL BESIDE THE DIFF.

   "Codex reviews the change; nothing reviews the change's CONSEQUENCES on the
   system." This module is the whole of that claim, and it is a wiring job over
   engines that already exist — `computeImpact`, `computeRisks`, `computeCycles`
   in @sequence/schema, and the FunctionGraph — rather than any new analysis.
   Nothing here computes a graph fact itself; if it did, this surface would be a
   second, unowned implementation of blast radius.

   THE FOUR CLAIMS THIS PANEL IS ALLOWED TO MAKE, and no fifth:

     1. Which scanned nodes the changed files are inside (node.path prefix).
     2. What breaks if one of those nodes fails — `computeImpact(...).impactedBy`,
        the r11 blast radius, over the REAL edge list.
     3. Which edges were grounded on a line inside a changed file — that is an
        `Evidence {file,line}` lookup, and it is the one thing a diff viewer
        structurally cannot say: *the proof for this edge is in the code you
        just changed.*
     4. Which functions the changed LINE RANGES fall inside, and who calls them
        — `FunctionNode {file,startLine,endLine}` against `changedRanges`.

   WHAT IT MUST REFUSE TO SAY. "Cycles created" and "edges broken" require the
   graph AFTER the change, and PUT /api/file clears the graph cache WITHOUT
   rescanning (the `PUT /api/file` handler in `server/repoServer.ts`, gap G5).
   There is no post-change graph to
   diff against, so a "created" count would be a number nobody measured. The
   panel names the cycles the change is INSIDE, and lists the absence as a gap.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * A four-node graph with one real cycle and evidence that lands in a file the
 * diff touches. Hand-built rather than scanned, on purpose: this file is
 * testing the MAPPING, and a scanned graph would make the expected answers
 * something to look up rather than something to reason about. The board's own
 * grounding lock (e2e/board-grounded.mjs) is where a real scan is asserted.
 */
const GRAPH: ArchGraph = {
  version: 1,
  scannedAt: '2026-08-20T00:00:00.000Z',
  repoRoot: '/repo',
  repoName: 'repo',
  warnings: [],
  nodes: [
    { id: 'svc:api', kind: 'service', label: 'api', path: 'packages/api' },
    { id: 'svc:worker', kind: 'service', label: 'worker', path: 'packages/worker' },
    { id: 'svc:web', kind: 'service', label: 'web', path: 'packages/web' },
    { id: 'db:main', kind: 'datastore', label: 'main', path: 'packages/api/db' },
  ],
  edges: [
    {
      id: 'e1',
      srcId: 'svc:web',
      dstId: 'svc:api',
      kind: 'http',
      confidence: 0.9,
      origin: 'deterministic',
      evidence: [{ file: 'packages/web/src/client.ts', line: 12, snippet: "fetch('/api')" }],
    },
    {
      id: 'e2',
      srcId: 'svc:api',
      dstId: 'db:main',
      kind: 'db_write',
      confidence: 0.9,
      origin: 'deterministic',
      evidence: [{ file: 'packages/api/src/repo.ts', line: 40, snippet: 'pg.query(' }],
    },
    {
      id: 'e3',
      srcId: 'svc:api',
      dstId: 'svc:worker',
      kind: 'queue_publish',
      confidence: 0.8,
      origin: 'deterministic',
      evidence: [{ file: 'packages/api/src/queue.ts', line: 7, snippet: 'publish(' }],
    },
    {
      id: 'e4',
      srcId: 'svc:worker',
      dstId: 'svc:api',
      kind: 'http',
      confidence: 0.8,
      origin: 'deterministic',
      evidence: [{ file: 'packages/worker/src/callback.ts', line: 3, snippet: "fetch('/api')" }],
    },
  ],
};

const FUNCTIONS: FunctionGraph = {
  nodes: [
    { id: 'fn:a', name: 'handleAuth', file: 'packages/api/src/repo.ts', startLine: 30, endLine: 55, lang: 'ts' },
    { id: 'fn:b', name: 'listOrders', file: 'packages/api/src/repo.ts', startLine: 60, endLine: 80, lang: 'ts' },
    { id: 'fn:c', name: 'route', file: 'packages/api/src/http.ts', startLine: 1, endLine: 20, lang: 'ts' },
    { id: 'fn:d', name: 'boot', file: 'packages/api/src/main.ts', startLine: 1, endLine: 9, lang: 'ts' },
  ],
  edges: [
    { id: 'c1', srcId: 'fn:c', dstId: 'fn:a', kind: 'call' },
    { id: 'c2', srcId: 'fn:d', dstId: 'fn:a', kind: 'call' },
    { id: 'c3', srcId: 'fn:c', dstId: 'fn:b', kind: 'call' },
  ],
};

describe('item 5.5 — mapping a changed path onto a scanned node', () => {
  it('picks the DEEPEST node whose path contains the file', () => {
    /* `packages/api` and `packages/api/db` both contain the file. Answering
       with the shallower one would attribute a datastore change to the service
       and understate the blast radius of the thing that actually changed. */
    expect(nodeForPath(GRAPH, 'packages/api/db/schema.sql')?.id).toBe('db:main');
    expect(nodeForPath(GRAPH, 'packages/api/src/repo.ts')?.id).toBe('svc:api');
  });

  it('answers null rather than guessing when no node owns the file', () => {
    expect(nodeForPath(GRAPH, 'docs/CANON.md')).toBe(null);
  });

  it('does not match a sibling directory that shares a prefix', () => {
    /* 'packages/web' must not swallow 'packages/web2'. A naive startsWith
       does exactly that, and this repository has both. */
    expect(nodeForPath(GRAPH, 'packages/web2/src/main.tsx')).toBe(null);
  });
});

describe('item 5.5 — the four claims', () => {
  const impact = computeReviewImpact({
    graph: GRAPH,
    functions: FUNCTIONS,
    changes: [
      { path: 'packages/api/src/repo.ts', ranges: [{ start: 40, end: 44 }] },
      { path: 'docs/CANON.md', ranges: [{ start: 1, end: 1 }] },
    ],
  });

  it('names the node the change is inside, with its blast radius from the real edges', () => {
    expect(impact.nodes.map((n) => n.nodeId)).toEqual(['svc:api']);
    const api = impact.nodes[0];
    expect(api.paths).toEqual(['packages/api/src/repo.ts']);
    /* svc:web -> svc:api and svc:worker -> svc:api, and svc:worker is reached
       transitively from svc:web too. `impactedBy` is computeImpact's own
       answer, not a count this file re-derives. */
    expect(api.impactedBy).toEqual(['svc:web', 'svc:worker']);
    expect(api.impactedByDirect).toEqual(['svc:web', 'svc:worker']);
  });

  it('names the edges whose EVIDENCE sits in a changed file, with file:line', () => {
    /* This is the claim no diff viewer can make. e2's proof is at
       packages/api/src/repo.ts:40, which is inside the changed range. */
    expect(impact.edges.map((e) => [e.edgeId, e.file, e.line])).toEqual([
      ['e2', 'packages/api/src/repo.ts', 40],
    ]);
  });

  it('names the functions the changed LINES fall inside, and who calls them', () => {
    expect(impact.functions.map((f) => f.name)).toEqual(['handleAuth']);
    /* listOrders is in the same file and is NOT touched — the range test is
       against startLine..endLine, not against the file. A panel that listed
       every function in a changed file would report 5,990 of them on this
       repository and say nothing. */
    expect(impact.functions[0].callers.map((c) => c.name).sort()).toEqual(['boot', 'route']);
  });

  it('names the cycle the change is inside, and never claims to have created one', () => {
    expect(impact.cycles.map((c) => c.nodes.sort())).toEqual([['svc:api', 'svc:worker']]);

    /* THE INVARIANT, NOT THE EXPRESSION. The first draft of this assertion was
       `JSON.stringify(impact)` must not match /created/, and it went red
       against the GAP SENTENCE — the line whose whole job is to say that
       created cycles cannot be reported. A word ban over the serialized result
       forbids the honest disclosure along with the dishonest claim, which is
       the same defect CANON names: "a fix asserted code !== 'ENOENT' and passed
       while running nothing". What must be true is narrower and checkable —
       no CYCLE ROW carries a creation claim, and the absence is disclosed. */
    for (const cycle of impact.cycles) {
      expect(cycle.reason).not.toMatch(/created|introduced|new cycle/i);
      expect(Object.keys(cycle)).toEqual(['nodes', 'labels', 'size', 'reason']);
    }
    expect(impact.gaps.join(' ')).toMatch(/cycles created or closed .* cannot be reported/i);
  });

  it('lists the changed files no scanned node owns, rather than dropping them', () => {
    /* Dropping them is how a panel quietly reports on two of your three files
       and looks complete while doing it. Coverage is the product's own claim
       (B1); silently under-reporting it here would be the worst possible place
       to break it. */
    expect(impact.unmapped).toEqual(['docs/CANON.md']);
  });
});

describe('item 5.5 — the gaps are rendered, not swallowed', () => {
  it('says the post-change graph does not exist, and names the route', () => {
    const impact = computeReviewImpact({ graph: GRAPH, functions: FUNCTIONS, changes: [] });
    expect(impact.gaps.join(' ')).toMatch(/\/api\/file/);
  });

  it('says function callers are unavailable when the function graph is not loaded', () => {
    const impact = computeReviewImpact({
      graph: GRAPH,
      functions: null,
      changes: [{ path: 'packages/api/src/repo.ts', ranges: [{ start: 40, end: 44 }] }],
    });
    expect(impact.functions).toEqual([]);
    expect(impact.gaps.join(' ')).toMatch(/\/api\/functions/);
  });

  it('computes nothing at all with no graph, and says that instead of showing zeros', () => {
    /* Zeros are a claim: "nothing breaks". With no graph attached the honest
       answer is that nothing was measured. */
    const impact = computeReviewImpact({
      graph: null,
      functions: null,
      changes: [{ path: 'a.ts', ranges: [{ start: 1, end: 1 }] }],
    });
    expect(impact.nodes).toEqual([]);
    expect(impact.edges).toEqual([]);
    expect(impact.risks).toEqual([]);
    expect(impact.unmapped).toEqual([]);
    expect(impact.gaps.join(' ')).toMatch(/no graph/i);
  });

  it('surfaces a risk only when a touched node actually carries one', () => {
    const impact = computeReviewImpact({
      graph: GRAPH,
      functions: FUNCTIONS,
      changes: [{ path: 'packages/api/src/repo.ts', ranges: [{ start: 40, end: 44 }] }],
    });
    /* computeRisks' own floor is MIN_BLAST=2 and its own severity thresholds.
       This file asserts the FILTER — a risk about a node the change did not
       touch has no business on this panel — and never the ranking. */
    for (const risk of impact.risks) {
      expect(impact.nodes.map((n) => n.nodeId)).toContain(risk.nodeId);
    }
  });
});
