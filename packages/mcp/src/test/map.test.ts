/**
 * The agent map over MCP (overhaul-formats-v2 §3.3): the `map(budget, focus?)`
 * tool and the `sequence://map?budget=<n>` resource return the same grammar as
 * `.sequence/map.md`, within budget.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { parseAgentMap } from '@sequence/analyzer';
import { createServer } from '../index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(HERE, '../../../..', 'packages/analyzer/test/fixtures/shopfront');

async function connect(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createServer();
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'map-test', version: '0.0.0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('map tool: the budgeted map, parseable, focus first', async () => {
  const { client, close } = await connect();
  try {
    const r = await client.callTool({ name: 'map', arguments: { repoPath: SHOPFRONT, budget: 400, focus: 'svc:payments' } });
    const text = (r.content as { type: string; text: string }[])[0].text;
    assert.ok(Math.ceil(text.length / 4) <= 400, `${text.length} chars`);
    const m = parseAgentMap(text);
    assert.equal(m.budget, 400);
    assert.equal(m.entries[0].label, 'payments');
    assert.match(text.trimEnd().split('\n').at(-1)!, /^omitted: /);
  } finally {
    await close();
  }
});

test('sequence://map?budget=… resource: the map of SEQUENCE_REPO', async () => {
  const prev = process.env.SEQUENCE_REPO;
  process.env.SEQUENCE_REPO = SHOPFRONT;
  const { client, close } = await connect();
  try {
    const { resourceTemplates } = await client.listResourceTemplates();
    assert.ok(resourceTemplates.some((t) => t.uriTemplate === 'sequence://map{?budget}'));
    const r = await client.readResource({ uri: 'sequence://map?budget=1000' });
    const text = (r.contents[0] as { text: string }).text;
    assert.equal(parseAgentMap(text).budget, 1000);
    const d = await client.readResource({ uri: 'sequence://map' });
    assert.equal(parseAgentMap((d.contents[0] as { text: string }).text).budget, 4000);
  } finally {
    await close();
    if (prev === undefined) delete process.env.SEQUENCE_REPO;
    else process.env.SEQUENCE_REPO = prev;
  }
});
