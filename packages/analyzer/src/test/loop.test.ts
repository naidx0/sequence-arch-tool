import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { diffGraphs } from '../diff.js';

// The spec-to-system loop, as a deterministic, network-free regression:
//   examples/ticketing.spec.json  (authored design spec)
//     -> examples/ticketing-scaffold  (code scaffolded from the spec's brief)
//        scan -> diff  ==> zero drift (conformance)
//   then break the worker's subscribe call
//        scan -> diff  ==> the queue_consume edge is reported missing.

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const SPEC = path.join(REPO_ROOT, 'examples', 'ticketing.spec.json');
const SCAFFOLD = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');

function writeGraph(dir: string, name: string, graph: unknown): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(graph));
  return p;
}

test('loop: scanning the scaffold conforms to the design spec (zero drift)', async () => {
  const scanned = await scanRepo(SCAFFOLD);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-loop-'));
  const scannedPath = writeGraph(tmp, 'scanned.json', scanned);

  const { added, removed } = diffGraphs(SPEC, scannedPath);

  // Design spec is the base: `removed` = missing from implementation,
  // `added` = not in spec. Conformance means both are empty.
  assert.deepStrictEqual(removed, [], 'no spec edge should be missing from the scaffold');
  assert.deepStrictEqual(added, [], 'the scaffold should introduce no edge absent from the spec');
});

test('loop: breaking the worker subscribe call is caught as a missing queue_consume edge', async () => {
  // Copy the scaffold to a temp dir and delete ONLY the worker's subscribe call,
  // reproducing the deliberate-break step of the loop without touching the tracked example.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-loop-broken-'));
  const broken = path.join(tmp, 'ticketing-scaffold-broken');
  fs.cpSync(SCAFFOLD, broken, { recursive: true });

  const workerFile = path.join(broken, 'worker', 'index.ts');
  const original = fs.readFileSync(workerFile, 'utf8');
  const broke = original.replace(
    /\s*await subscriber\.subscribe\('ticket\.created', \(message\) => \{[\s\S]*?\}\);/,
    ''
  );
  assert.notStrictEqual(broke, original, 'the subscribe call should have been removed');
  assert.ok(!broke.includes('subscribe('), 'no subscribe call should remain');
  fs.writeFileSync(workerFile, broke);

  const scanned = await scanRepo(broken);
  const scannedPath = writeGraph(tmp, 'scanned-broken.json', scanned);

  const { removed } = diffGraphs(SPEC, scannedPath);

  // The break-detection gate: the queue_consume edge MUST be reported missing.
  assert.ok(
    removed.includes('worker -> topic:ticket.created [queue_consume]'),
    `expected the missing queue_consume edge; got: ${JSON.stringify(removed)}`
  );
});
