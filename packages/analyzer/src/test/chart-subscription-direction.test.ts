import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { resolveInRepo } from '../server/jail.js';
import { executeAskTool } from '../server/askTools.js';

/**
 * A SUBSCRIPTION IS DRAWN THE WAY DATA MOVES (cloud patch 0016).
 *
 * The scan stores `worker -> topic` for a queue consumer; a reader draws
 * `topic -> worker`. propose_chart accepts a queue_consume edge either way round,
 * and only that kind: a publish drawn backwards is still refused.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.join(here, '..', '..', 'test', 'fixtures', 'shopfront');

async function ctx() {
  const root = fs.realpathSync(SHOPFRONT);
  const graph = await scanRepo(SHOPFRONT, { cluster: true });
  return {
    graph,
    resolveReadable: (rel: string) => resolveInRepo(root, rel),
    repoRoot: root,
    designMode: false,
    question: 'who hears about a new order?',
    canvasToolsEnabled: true,
  } as unknown as Parameters<typeof executeAskTool>[2];
}

const chart = (from: string, to: string) => ({
  kind: 'data-flow',
  title: 'A new order',
  items: [
    { id: 'a', label: 'a', nodeId: from },
    { id: 'b', label: 'b', nodeId: to },
  ],
  links: [{ from: 'a', to: 'b', label: 'the event' }],
});

test('topic -> subscriber is accepted: the direction the data moves', async () => {
  const r = await executeAskTool('propose_chart', chart('topic:order.created', 'file:notifications/worker.py'), await ctx());
  assert.equal(r.ok, true, r.evidence);
});

test('the stored direction still grounds', async () => {
  const r = await executeAskTool('propose_chart', chart('file:notifications/worker.py', 'topic:order.created'), await ctx());
  assert.equal(r.ok, true, r.evidence);
});

test('a publish drawn backwards is still refused', async () => {
  const r = await executeAskTool('propose_chart', chart('topic:order.created', 'file:orders/app/events.py'), await ctx());
  assert.equal(r.ok, false);
  assert.match(r.evidence, /no edge topic:order\.created -> file:orders\/app\/events\.py/);
});
