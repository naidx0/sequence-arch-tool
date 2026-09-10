/**
 * A test fixture is not the system. Nothing under a fixtures directory may become a
 * fact about the repository that contains it.
 *
 * `CLAUDE.md` states the non-negotiable: "Grounded, not guessed (every edge/claim
 * traces to real evidence)." An edge whose evidence is somebody's test fixture is a
 * guess wearing a citation, and it is the worst kind because it arrives with a
 * `file:line` and `origin: 'deterministic'`.
 *
 * MEASURED on this monorepo before the fix. `svc:gateway` — the node standing for the
 * real `packages/gateway` — had exactly two inbound edges, and BOTH were fixtures:
 *
 *   file:packages\analyzer\test\fixtures\shopfront\edge\default.conf         -> svc:gateway
 *   file:packages\analyzer\test\fixtures\shopfront-mutated\edge\default.conf -> svc:gateway
 *
 * Both `origin=deterministic`. So 100% of what the graph knew about that service was
 * false, and `who_calls gateway` reported it with citations. The research doc flags
 * this as the blocker on B3, the claim that Sequence's diagrams are derived rather
 * than written: "a grounding tool asserting a false edge is worse than no tool."
 *
 * WHY EXCLUDING BY DIRECTORY NAME IS SAFE, and why it does not break the suites that
 * scan fixtures on purpose: `walkFiles` tests the name of each child directory as it
 * descends. A test that scans `test/fixtures/shopfront` AS ITS ROOT never presents a
 * child named `fixtures`, so nothing is skipped. Only a fixtures directory NESTED
 * inside a larger scan disappears — which is exactly the case that was lying.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepo } from '../scan.js';

/** Build a throwaway repo from a {relativePath: contents} map. */
function repo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-fixture-excl-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

const NGINX = 'server {\n  listen 80;\n  location /api/ {\n    proxy_pass http://ghostsvc:3000/api/;\n  }\n}\n';
const COMPOSE = 'services:\n  ghostsvc:\n    build: .\n    ports:\n      - "3000:3000"\n';

test('a nested fixtures directory contributes no nodes and no edges', async () => {
  const dir = repo({
    'package.json': '{"name":"host","version":"1.0.0"}\n',
    'src/index.ts': "export const real = 1;\n",
    // The lie: a fixture repo, complete with its own compose file and nginx conf,
    // sitting inside a real repository the way every analyzer fixture does.
    'test/fixtures/sample/docker-compose.yml': COMPOSE,
    'test/fixtures/sample/edge/default.conf': NGINX,
    'test/fixtures/sample/src/app.ts': "export const fake = 1;\n",
  });
  try {
    const graph = await scanRepo(dir);

    const fromFixtures = (s: string) => /(^|[/\\])(__)?fixtures(__)?[/\\]/i.test(s);

    const leakedNodes = graph.nodes.filter((n) => fromFixtures(String(n.id)));
    assert.deepEqual(
      leakedNodes.map((n) => n.id),
      [],
      'nodes were created from files inside a test fixture',
    );

    const leakedEdges = graph.edges.filter(
      (e) => fromFixtures(String(e.srcId)) || fromFixtures(String(e.dstId)),
    );
    assert.deepEqual(
      leakedEdges.map((e) => `${e.srcId} -> ${e.dstId}`),
      [],
      'edges were derived from files inside a test fixture',
    );

    // The sharpest form of the bug: a service that exists ONLY in the fixture must not
    // be reported as a service of the host repository at all.
    const ghost = graph.nodes.filter((n) => /ghostsvc/i.test(String(n.id) + String(n.label)));
    assert.deepEqual(
      ghost.map((n) => n.id),
      [],
      'a service that exists only inside a fixture was reported as real',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a fixture scanned AS THE ROOT still works — the exclusion is not global', async () => {
  // The regression this fix could plausibly cause. Every analyzer suite points scanRepo
  // straight at a fixture directory; if the exclusion matched an ancestor path rather
  // than a child directory name, all of them would return an empty graph and the
  // exclusion would have been "fixed" by breaking the test corpus.
  const dir = repo({
    'fixtures/inner/package.json': '{"name":"inner","version":"1.0.0"}\n',
    'fixtures/inner/docker-compose.yml': COMPOSE,
    'fixtures/inner/src/app.ts': "export const app = 1;\n",
  });
  try {
    const graph = await scanRepo(path.join(dir, 'fixtures', 'inner'));
    assert.ok(
      graph.nodes.length > 0,
      'scanning a fixture directly must still produce a graph — the whole test corpus depends on it',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * THE MOMENT PACKAGING STARTED WORKING, THE GRAPH STARTED LYING.
 *
 * `pnpm desktop:dist` writes a self-contained copy of the analyzer — real
 * source, real `package.json`, real everything — into two places:
 *
 *   packages/desktop/server-bundle/packages/analyzer/…
 *   packages/desktop/release/win-unpacked/resources/server/packages/analyzer/…
 *
 * Neither name was in `IGNORE_DIRS`, so the scanner walked both. MEASURED on
 * this monorepo immediately after the first successful package:
 *
 *   352  packages/schema/src/index.ts          <- was 78
 *    69  packages/analyzer/src/scan.ts
 *    69  …/release/win-unpacked/resources/server/packages/analyzer/src/scan.ts
 *    69  …/server-bundle/packages/analyzer/src/scan.ts
 *
 * Every analyzer file appeared three times, each copy importing schema, and the
 * board would have drawn three of every service. It also broke `who_calls`:
 * `graphQueryRepo.test.ts` went red because the busiest target no longer fit
 * under the cap — 152 callers omitted, and 2/3 of the ones returned were
 * duplicates of the other 1/3.
 *
 * `.gitignore` already listed both directories. THE SCANNER DOES NOT READ IT,
 * and that is a separate, larger question (a scan is not a checkout, and some
 * repositories gitignore things a reader still wants drawn). What is not in
 * question is that build output is not architecture.
 */
test('a packaged copy of the repository contributes no nodes', async () => {
  const APP = 'export const thing = 1;\n';
  const USE = "import { thing } from './lib.js';\nexport const real = thing;\n";
  const dir = repo({
    'package.json': '{"name":"host","version":"1.0.0"}\n',
    'src/lib.ts': APP,
    'src/index.ts': USE,
    /* What `prepare-server.mjs` assembles… */
    'packages/desktop/server-bundle/packages/analyzer/package.json': '{"name":"copy","version":"1.0.0"}\n',
    'packages/desktop/server-bundle/packages/analyzer/src/lib.ts': APP,
    'packages/desktop/server-bundle/packages/analyzer/src/index.ts': USE,
    /* …and what electron-builder copies it into. */
    'packages/desktop/release/win-unpacked/resources/server/packages/analyzer/src/lib.ts': APP,
    'packages/desktop/release/win-unpacked/resources/server/packages/analyzer/src/index.ts': USE,
  });
  try {
    const graph = await scanRepo(dir);
    /* A separator written without a literal escape: this file is edited
       through tooling that has eaten a doubled backslash more than once, and
       a regex that lost one silently stops normalising anything. */
    const BACKSLASH = String.fromCharCode(92);
    const paths = graph.nodes.map((n) =>
      String((n as { path?: unknown }).path ?? '').split(BACKSLASH).join('/'),
    );

    assert.ok(
      paths.some((p) => p.endsWith('src/lib.ts')),
      'the real source is still scanned — this must exclude output, not everything',
    );
    for (const banned of ['server-bundle', 'release/win-unpacked']) {
      assert.ok(
        !paths.some((p) => p.includes(banned)),
        `${banned} is build output and must contribute nothing (saw: ${paths.filter((p) => p.includes(banned)).slice(0, 3).join(', ')})`,
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
