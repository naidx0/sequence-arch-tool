import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArchGraph } from '@sequence/schema';
import { serviceLevelEdgeKeys } from '@sequence/export';
import { projectToServiceLevel } from '../score.js';
import { scanRepo } from '../scan.js';

/**
 * THE ANTI-DRIFT LOCK (see packages/export/src/project.ts header).
 *
 * @sequence/export re-implements the service-level projection over the schema
 * types so the browser can use it without importing the Node-only analyzer.
 * That is a deliberate duplicate; this test is what forbids it from drifting.
 * It asserts the export package's `serviceLevelEdgeKeys` produces the EXACT same
 * edge-key set as the analyzer's locked `projectToServiceLevel`, on both a
 * hand-authored design spec and a live scan of the shopfront fixture. If either
 * projection changes independently, this fails — fix them together.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SPEC = path.resolve(here, '..', '..', '..', '..', 'examples', 'ticketing.spec.json');
const FIXTURE = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');

function sorted(s: Set<string>): string[] {
  return [...s].sort();
}

test('parity: export projection == analyzer projectToServiceLevel (ticketing design spec)', () => {
  const g = JSON.parse(fs.readFileSync(SPEC, 'utf8')) as ArchGraph;
  assert.deepStrictEqual(sorted(serviceLevelEdgeKeys(g)), sorted(projectToServiceLevel(g)));
});

test('parity: export projection == analyzer projectToServiceLevel (shopfront scan)', async () => {
  const g = await scanRepo(FIXTURE);
  const a = sorted(projectToServiceLevel(g));
  const b = sorted(serviceLevelEdgeKeys(g));
  assert.deepStrictEqual(b, a);
  assert.ok(a.length >= 15, `shopfront projects to a non-trivial edge set (got ${a.length})`);
});
