import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { diffGraphs } from '../diff.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');
const MUTATED_FIXTURE = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront-mutated');

function writeGraph(dir: string, name: string, graph: unknown): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(graph));
  return p;
}

test('diffGraphs: reports the removed gateway -> payments edge and nothing else', async () => {
  assert.ok(
    fs.existsSync(MUTATED_FIXTURE),
    `mutated fixture missing at ${MUTATED_FIXTURE}; expected it to have been prepared before running this test`
  );

  const [baseGraph, headGraph] = await Promise.all([
    scanRepo(FIXTURE),
    scanRepo(MUTATED_FIXTURE),
  ]);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-diff-'));
  const basePath = writeGraph(tmp, 'base.json', baseGraph);
  const headPath = writeGraph(tmp, 'head.json', headGraph);

  const { added, removed, markdown } = diffGraphs(basePath, headPath);

  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, ['gateway -> payments [http]']);

  assert.match(markdown, /^## sequence drift report/);
  assert.match(markdown, /\*\*0 added \/ 1 removed\*\* service-level interaction edges \(base → head\)/);
  assert.doesNotMatch(markdown, /### Added/);
  assert.match(markdown, /### Removed/);
  assert.match(markdown, /- `gateway → payments` \[http\]/);
});

test('diffGraphs: identical graphs report no drift', async () => {
  const graph = await scanRepo(FIXTURE);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-diff-'));
  const basePath = writeGraph(tmp, 'base.json', graph);
  const headPath = writeGraph(tmp, 'head.json', graph);

  const { added, removed, markdown } = diffGraphs(basePath, headPath);

  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, []);
  assert.strictEqual(markdown, '## sequence drift report\nNo interaction-edge drift.\n');
});
