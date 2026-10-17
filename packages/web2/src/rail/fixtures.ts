/* ══════════════════════════════════════════════════════════════════════════
   TEST SHAPES FOR THE RAIL — never imported by a product file
   packages/web2/src/rail/fixtures.ts

   ONE DEFINITION, TWO TEST FILES. `railModel.test.ts` proves the rules against
   these and `IndexRail.test.tsx` proves the renders against the same objects,
   so a change to the shape cannot make one of them silently describe a
   different world. CANON: "One agent per file" has a smaller sibling — one
   definition per fact.

   THEY ARE SMALL ON PURPOSE, AND THAT IS ALL THEY ARE FOR. CLAUDE.md: "Fixture
   scale proves logic; only a REAL repo proves the result." Every claim about
   counts, truncation, density or coverage AT SCALE is made in
   `railGrounded.test.ts`, which reads the real engine's caches for this
   repository and never touches this file.

   PATHS CARRY THE ENGINE'S NATIVE SEPARATOR. Measured off `/archgraph.json`
   on this machine: `"path":"packages\\acp\\src\\client.ts"`. A fixture that
   used forward slashes would let a missing normalisation pass every test and
   fail in the product.
   ══════════════════════════════════════════════════════════════════════════ */

import type { GetArchGraphResponse, GetFunctionsResponse } from '@sequence/api-types';

import type { Coverage } from '../state/types';

const BACKSLASH = String.fromCharCode(92);

/** `packages/alpha/src/one.ts` → the separator the scanner actually writes. */
export function native(path: string): string {
  return path.split('/').join(BACKSLASH);
}

export type TestGraph = GetArchGraphResponse;

export function emptyGraph(partial: Partial<TestGraph> = {}): TestGraph {
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
  } as TestGraph;
}

/**
 * Two components, three files, one datastore with nothing under it.
 *
 *   svc:alpha  packages/alpha
 *     file:a1  src/one.ts    openGate@12, helper@30
 *     file:a2  src/two.ts    store@5
 *   svc:beta   packages/beta
 *     file:b1  src/gate.ts   gate@7
 *   store:pg   (no files — the "Nothing the scan could name" card)
 *
 * `openGate` calls `helper` (same file — no hop), `store` (another file in the
 * same component — a file hop) and `gate` (another component — a service hop).
 */
export function twoPackages(): TestGraph {
  return emptyGraph({
    nodes: [
      { id: 'repo', kind: 'repo', label: 'repo' },
      {
        id: 'svc:alpha',
        kind: 'service',
        label: 'alpha',
        parentId: 'repo',
        path: native('packages/alpha'),
      },
      {
        id: 'svc:beta',
        kind: 'service',
        label: 'beta',
        parentId: 'repo',
        path: native('packages/beta'),
      },
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
        evidence: [
          { file: native('packages/alpha/src/one.ts'), line: 3, snippet: "import './two.js';" },
        ],
      },
      {
        id: 'imp:a1-b1',
        srcId: 'file:a1',
        dstId: 'file:b1',
        kind: 'import',
        confidence: 1,
        origin: 'deterministic',
        evidence: [
          {
            file: native('packages/alpha/src/one.ts'),
            line: 4,
            snippet: "import { gate } from 'beta';",
          },
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

export function twoPackageFunctions(): GetFunctionsResponse {
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
        { id: 'c1', srcId: 'fn:one', dstId: 'fn:two', kind: 'call' },
        { id: 'c2', srcId: 'fn:one', dstId: 'fn:three', kind: 'call' },
        { id: 'c3', srcId: 'fn:one', dstId: 'fn:four', kind: 'call' },
      ],
    },
    warnings: ['one route handler could not be attributed'],
  };
}

/**
 * An answer that read `packages/alpha` and never looked at `packages/beta`.
 *
 * This is the shape `computeAskCoverage` returns
 * (`packages/analyzer/src/explain/explain.ts:1291`) and it is the ONE thing
 * item 4.4 is about: the engine can name the components its answer did not
 * read, and no terminal agent can.
 */
export function coverageMissingBeta(): Coverage {
  return {
    edgesSeen: 1,
    edgesTotal: 2,
    packagesSeen: ['packages/alpha'],
    packagesMissed: ['packages/beta'],
  };
}
