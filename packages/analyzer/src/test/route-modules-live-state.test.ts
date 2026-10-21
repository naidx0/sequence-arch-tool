import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A ROUTE MODULE READS THE SERVER'S MUTABLE STATE WHERE THE OLD CODE DID, NOT ONCE AT ENTRY.
 *
 * `repoRoot` and `currentGraph` are `let`s in createRepoServer: the repository can be attached, detached or swapped
 * while a request awaits its body, a hook or a provider call. The monolithic handler read the live variable at every
 * use, so a read AFTER an `await` saw the new value. The first cut of fileRoutes/gitRoutes took one snapshot at
 * entry (`const repoRoot = ctx.getRoot()`), which quietly changes what a request that straddles an attach does.
 *
 * Source-shape test, like the other split guards: the property is "no snapshot of live state", which no
 * request-level assertion states as plainly. The file list is derived from the directory, so a route module added
 * later is covered without anyone listing it.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '..', '..', 'src', 'server');
const MODULES = fs
  .readdirSync(SERVER)
  .filter((f) => /Routes\.ts$/.test(f) || f === 'askTurnCore.ts')
  .sort();

/** `const x = ctx.getRoot();` — a value taken from a live getter and held. */
const SNAPSHOT = /\b(?:const|let)\s+\w+\s*=\s*(?:ctx|env)\.(?:getRoot|getGraph)\(\)/;

test('the route modules are found, and the check can see a snapshot (positive control)', () => {
  assert.ok(MODULES.length >= 8, `only ${MODULES.length} route modules found`);
  assert.ok(SNAPSHOT.test('  const repoRoot = ctx.getRoot();'));
  assert.ok(SNAPSHOT.test('const g = env.getGraph();'));
  assert.ok(!SNAPSHOT.test('  const { getRoot, getGraph } = ctx;'), 'taking the getters themselves is the right shape');
  assert.ok(!SNAPSHOT.test('  if (getRoot() !== null) {'), 'calling the getter at the use is the right shape');
});

test('no route module holds a snapshot of the live repo root or graph', () => {
  const offenders: string[] = [];
  for (const f of MODULES) {
    const lines = fs.readFileSync(path.join(SERVER, f), 'utf8').split(/\r?\n/);
    lines.forEach((l, i) => {
      if (SNAPSHOT.test(l)) offenders.push(`${f}:${i + 1}: ${l.trim()}`);
    });
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'read getRoot()/getGraph() at each use, as the old handler read the variable:\n' + offenders.join('\n'),
  );
});
