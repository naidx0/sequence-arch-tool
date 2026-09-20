import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import {
  groundedInTestsOnly,
  instrumentOfEvidence,
  instrumentOfPath,
} from '../join/instrument.js';

/**
 * "HONESTLY PRODUCED, AND STILL WRONG ABOUT THE WORLD."
 *
 * CANON records the incident this closes: `svc:gateway`'s only two inbound
 * edges were nginx confs inside TEST FIXTURES, and both carried
 * `origin: 'deterministic'`. The word was true — a parser really did read a
 * real file — and useless, because to `origin` a fixture and a production
 * config are the same thing.
 *
 * `actor` says which detector produced an edge. `instrument` says what class of
 * artifact it read. `test` is the value that matters, and it is why this is not
 * merely `actor`: an edge whose every citation sits in a fixture is a claim
 * about a test suite wearing the costume of a claim about the system.
 *
 * NEITHER FIELD JUDGES. A `test` instrument is not an error — a test really
 * does call that endpoint — and nothing drops such an edge. What changed is
 * that the difference is now SAYABLE.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');

/* ═══ the classifier ══════════════════════════════════════════════════════ */

test('a fixture is a TEST artifact even when it is a perfect production config', () => {
  /*
   * THE GATEWAY INCIDENT, as a unit. `test/fixtures/nginx.conf` is a real nginx
   * config in every respect a parser can see; the only thing that makes it not
   * evidence about the system is where it lives.
   */
  assert.strictEqual(instrumentOfPath('packages/analyzer/test/fixtures/shop/nginx.conf'), 'test');
  assert.strictEqual(instrumentOfPath('src/__tests__/docker-compose.yml'), 'test');
  assert.strictEqual(instrumentOfPath('gateway/src/app.test.ts'), 'test');
});

test('the real ones keep their own classes', () => {
  assert.strictEqual(instrumentOfPath('deploy/nginx.conf'), 'config');
  assert.strictEqual(instrumentOfPath('docker-compose.yml'), 'manifest');
  assert.strictEqual(instrumentOfPath('gateway/src/app.ts'), 'source');
  assert.strictEqual(instrumentOfPath('services/orders/package.json'), 'manifest');
});

test('a windows path classifies the same as a posix one', () => {
  /* `core.autocrlf=true` is not the only place separators bite. A provenance
     that depended on which OS scanned would be worse than none. */
  assert.strictEqual(instrumentOfPath('packages\\analyzer\\test\\fixtures\\a.conf'), 'test');
});

test('disagreeing citations are MIXED, not whichever came first', () => {
  const mixed = instrumentOfEvidence([
    { file: 'gateway/src/app.ts', line: 1, snippet: '' },
    { file: 'test/fixtures/nginx.conf', line: 2, snippet: '' },
  ] as never);
  /*
   * One fixture citation and one real one is a genuinely different situation
   * from either, and collapsing it would hide the half that matters: this edge
   * IS grounded in the system, and also happens to be exercised by a test.
   */
  assert.strictEqual(mixed, 'mixed');
  assert.strictEqual(groundedInTestsOnly([
    { file: 'gateway/src/app.ts', line: 1, snippet: '' },
    { file: 'test/fixtures/nginx.conf', line: 2, snippet: '' },
  ] as never), false);
});

test('every citation in a fixture IS the incident, and is reported as such', () => {
  assert.strictEqual(
    groundedInTestsOnly([
      { file: 'test/fixtures/a/nginx.conf', line: 1, snippet: '' },
      { file: 'test/fixtures/b/nginx.conf', line: 2, snippet: '' },
    ] as never),
    true,
  );
});

test('no evidence yields NO instrument — never an invented one', () => {
  /* Claiming an artifact class for a reading that never happened would be the
     same failure one level down. */
  assert.strictEqual(instrumentOfEvidence([]), undefined);
});

/* ═══ on a real scan ══════════════════════════════════════════════════════ */

test('every scanned edge carries an actor, and it names a real detector', async () => {
  const g = await scanRepo(SHOPFRONT, {});
  assert.ok(g.edges.length > 0);
  for (const e of g.edges) {
    assert.ok(e.actor, `edge ${e.id} (${e.kind}) has no actor`);
    /* The actor is a module path, so a reader can go and look at the thing that
       made the claim rather than take a one-word label on trust. */
    assert.match(e.actor!, /^(detectors|scan|join)\b|\//);
  }
});

test('an edge with evidence carries an instrument, and it is one of the known classes', async () => {
  const g = await scanRepo(SHOPFRONT, {});
  const known = new Set(['source', 'config', 'manifest', 'test', 'mixed']);
  let withEvidence = 0;
  for (const e of g.edges) {
    if ((e.evidence ?? []).length === 0) continue;
    withEvidence += 1;
    assert.ok(e.instrument, `edge ${e.id} has evidence but no instrument`);
    assert.ok(known.has(e.instrument!), `unknown instrument ${e.instrument}`);
  }
  assert.ok(withEvidence > 0, 'the fixture produces edges with evidence');
});

test('the actor matches the edge kind — a db edge is not attributed to the http detector', async () => {
  const g = await scanRepo(SHOPFRONT, {});
  for (const e of g.edges) {
    if (e.kind.startsWith('db_')) assert.strictEqual(e.actor, 'detectors/db');
    if (e.kind === 'http') assert.strictEqual(e.actor, 'detectors/http');
    if (e.kind === 'import') assert.strictEqual(e.actor, 'scan/imports');
  }
});
