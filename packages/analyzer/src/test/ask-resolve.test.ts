/**
 * WAVE A2 — RESOLVE, DON'T REFUSE (docs/research/carrying-harness-plan.md).
 *
 * A small model names things the way a person does. The strict resolvers are
 * right to refuse an invented name and were wrong to refuse a name with one
 * honest reading. Built on the shopfront fixture, whose scan is real.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import { executeAskTool, type AskToolContext } from '../server/askTools.js';
import {
  resolveGraphTargetsLoose,
  resolveRepoFileLoose,
  resolveServiceLoose,
  scorePathCandidate,
} from '../server/askResolve.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-resolve-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return fs.realpathSync(repo);
}

async function attachedCtx(root: string): Promise<AskToolContext> {
  const graph = await scanRepo(root, { cluster: true });
  const digest = buildDigest(graph);
  return {
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    designMode: false,
    graph,
    digest,
  } as AskToolContext;
}

test('the path ladder: suffix beats basename beats stem beats segment, and shorter wins ties', () => {
  assert.strictEqual(scorePathCandidate('src/index.ts', 'gateway/src/index.ts'), 90);
  assert.strictEqual(scorePathCandidate('index.ts', 'gateway/src/index.ts'), 80);
  assert.strictEqual(scorePathCandidate('index', 'gateway/src/index.ts'), 70);
  assert.strictEqual(scorePathCandidate('routes', 'gateway/src/routes/orders.ts'), 50);
  assert.strictEqual(scorePathCandidate('nothing-here', 'gateway/src/index.ts'), 0);
  assert.strictEqual(scorePathCandidate('./Gateway\\src\\index.ts', 'gateway/src/index.ts'), 100);
});

test('who_calls on a basename with one reading runs, and says what it resolved', async () => {
  const root = shopfrontRepo();
  const ctx = await attachedCtx(root);
  /* `orders.ts` the strict resolver already takes as a path suffix, and any
     path ending in a service name it takes as that service; `payments_client`
     is a bare stem with no extension, which is the shape a person types. */
  const r = await executeAskTool('who_calls', { target: 'payments_client' }, ctx);
  assert.ok(r.ok, r.evidence);
  assert.match(
    r.evidence,
    /^resolved "payments_client" to file:orders\/app\/payments_client\.py \(basename without extension\) — who_calls /,
  );
});

test('who_calls on a name with several readings returns them as evidence, never a refusal', async () => {
  const root = shopfrontRepo();
  const ctx = await attachedCtx(root);
  /* `index` is a stem shared by gateway/src/index.ts and payments/src/index.js. */
  const loose = resolveGraphTargetsLoose(ctx.graph!, 'index');
  assert.strictEqual(loose.kind, 'several');
  const r = await executeAskTool('who_calls', { target: 'index' }, ctx);
  assert.ok(r.ok, r.evidence);
  assert.match(r.evidence, /who_calls "index" matched \d+ things by basename without extension — call again with exactly one of: /);
  assert.match(r.evidence, /gateway\/src\/index\.ts/);
});

test('who_calls on an invented name is still refused', async () => {
  const root = shopfrontRepo();
  const ctx = await attachedCtx(root);
  const r = await executeAskTool('who_calls', { target: 'zzz-not-a-file-anywhere' }, ctx);
  assert.strictEqual(r.ok, false);
  assert.match(r.evidence, /^refused: who_calls found no node matching/);
});

test('read_topology resolves a partial service name and lists rivals otherwise', async () => {
  const root = shopfrontRepo();
  const ctx = await attachedCtx(root);
  const ids = ctx.digest!.services.map((s) => s.id);
  assert.ok(ids.length >= 3, `fixture has services: ${ids.join(', ')}`);
  const one = resolveServiceLoose(ctx.digest!.services, 'orders');
  assert.strictEqual(one.kind, 'one', JSON.stringify(one));
  const r = await executeAskTool('read_topology', { service: 'orders' }, ctx);
  assert.ok(r.ok, r.evidence);
  /* Either the strict keys already accepted it (no note) or it was resolved (note). */
  assert.ok(/read_topology/.test(r.evidence));
  const bad = await executeAskTool('read_topology', { service: 'zzz-no-such-service' }, ctx);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.evidence, /^refused: read_topology unknown service/);
});

test('read_file on a basename reads the one file of that name and names the resolution', async () => {
  const root = shopfrontRepo();
  const ctx = await attachedCtx(root);
  const r = await executeAskTool('read_file', { path: 'invoices.ts' }, ctx);
  assert.ok(r.ok, r.evidence);
  assert.match(r.evidence, /^resolved "invoices\.ts" to gateway\/src\/routes\/invoices\.ts \(basename\) — /);
  assert.ok(r.content && r.content.length > 0);
});

test('read_file on a basename shared by several files lists them, and on a path that is nowhere refuses', async () => {
  const root = shopfrontRepo();
  const ctx = await attachedCtx(root);
  const several = await executeAskTool('read_file', { path: 'requirements.txt' }, ctx);
  assert.ok(several.ok, several.evidence);
  assert.match(several.evidence, /read_file "requirements\.txt" matched 3 things by basename/);
  const none = await executeAskTool('read_file', { path: 'zzz/never/here.ts' }, ctx);
  assert.strictEqual(none.ok, false);
  assert.match(none.evidence, /not found$/);
  const walked: string[] = [];
  const loose = resolveRepoFileLoose('models.py', (visit) => {
    for (const rel of ['orders/app/models.py', 'orders/app/main.py']) {
      walked.push(rel);
      if (!visit(rel)) break;
    }
  });
  assert.deepStrictEqual(loose, { kind: 'one', hit: 'orders/app/models.py', how: 'basename' });
});

test('locate_symbol pulls the identifier out of a phrase and refuses pure prose', async () => {
  const root = shopfrontRepo();
  const ctx = await attachedCtx(root);
  const r = await executeAskTool('locate_symbol', { name: 'the ordersRouter export' }, ctx);
  assert.ok(r.ok, r.evidence);
  assert.match(r.evidence, /^resolved "the ordersRouter export" to ordersRouter \(identifier in the phrase\) — /);
  const prose = await executeAskTool('locate_symbol', { name: 'where is it defined' }, ctx);
  assert.strictEqual(prose.ok, false);
  assert.match(prose.evidence, /^refused: locate_symbol takes one identifier/);
});
