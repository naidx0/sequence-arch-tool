/**
 * U23 LOCK — sharing `scanRepo`'s parse output with `buildRepoFunctionGraph`
 * must not change a single byte of the function graph, and must never serve
 * stale facts.
 *
 * The ORACLE is the original implementation, and it is still live: with no
 * shared capture available, `buildRepoFunctionGraph` reads and parses every
 * file itself, exactly as it did before this round. `clearSharedFacts()` puts
 * it back in that state, so each case here builds the SAME graph twice — once
 * cold (oracle) and once warm (shared) — and asserts deep equality.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRepoFunctionGraph } from '../functions/repoFunctionGraph.js';
import { clearSharedFacts, takeSharedFacts } from '../parse/sharedFacts.js';
import { scanRepo } from '../scan.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '..', '..', 'test', 'fixtures');

const FIXTURE_IDS = [
  'shopfront',
  'shopfront-mutated',
  'mixed-lang',
  'plainapp',
  'monorepo-apps',
  'shared-backend',
  'spa-dashboard',
  'cli-tool',
  'gomod-root',
  'prompt-injection',
];

test('LOCK: shared parse output produces a byte-identical function graph', async () => {
  for (const id of FIXTURE_IDS) {
    const dir = path.join(FIXTURES, id);
    if (!fs.existsSync(dir)) continue;

    // ORACLE — no capture available, so every file is read and parsed here.
    clearSharedFacts();
    const oracleGraph = await scanRepo(dir, { cluster: true });
    clearSharedFacts();
    const oracle = await buildRepoFunctionGraph(dir, { cluster: true }, oracleGraph);

    // SHARED — the scan's capture is live, so the parse is reused.
    const graph = await scanRepo(dir, { cluster: true });
    const shared = await buildRepoFunctionGraph(dir, { cluster: true }, graph);

    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(shared)),
      JSON.parse(JSON.stringify(oracle)),
      `${id}: shared-parse function graph diverged from the re-parsing oracle`
    );
  }
});

test('a scan hands its parse over exactly once, and only to its own repo', async () => {
  const dir = path.join(FIXTURES, 'shopfront');
  clearSharedFacts();
  await scanRepo(dir, { cluster: true });

  const rootReal = fs.realpathSync(path.resolve(dir));
  assert.equal(takeSharedFacts('/some/other/repo'), undefined, 'a different root must not match');

  const first = takeSharedFacts(rootReal);
  assert.ok(first && first.size > 0, 'the scan should have captured facts for its own root');
  assert.equal(takeSharedFacts(rootReal), undefined, 'the capture is handed over once, then cleared');
});

test('a file changed after the scan is re-parsed, never served from the capture', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-shared-facts-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'stale-check', version: '1.0.0' })
  );
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    'function helper() { return 1; }\nfunction outer() { helper(); }\n'
  );

  clearSharedFacts();
  const graph = await scanRepo(dir, { cluster: true });

  // Rewrite between the scan and the build, with a distinctly newer mtime.
  fs.writeFileSync(
    path.join(dir, 'index.js'),
    'function renamed() { return 1; }\nfunction outer() { renamed(); }\n'
  );
  const future = new Date(Date.now() + 5_000);
  fs.utimesSync(path.join(dir, 'index.js'), future, future);

  const built = await buildRepoFunctionGraph(dir, { cluster: true }, graph);
  const names = built.nodes.map((n) => n.name).sort();
  assert.deepStrictEqual(
    names,
    ['outer', 'renamed'],
    'the changed file must be re-parsed, not served from the pre-edit capture'
  );

  fs.rmSync(dir, { recursive: true, force: true });
});
