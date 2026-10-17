/**
 * The `components` MCP tool (componentTools.ts): listing cost, search, load, and the manual/off switch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CORE_TOOLS, TOOLS, createServer, type CreateServerOptions } from '../index.js';
import { optionsFromEnv } from '../server.js';

function put(root: string, id: string, status: string, triggers: string[], body: string): void {
  const dir = path.join(root, ...id.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'component.json'), JSON.stringify({ id, label: id.split('/')[1], summary: `sum of ${id}`, triggers, status }));
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: n\ndescription: d\n---\n${body}\n`);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-components-'));
put(root, 'design/charts', 'ready', ['bar chart'], 'CHART BODY');
put(root, 'security/rea', 'review', ['decompile'], 'REA BODY');
process.env.SEQUENCE_COMPONENTS_ROOT = root;

async function connect(opts: CreateServerOptions) {
  const server = createServer(opts);
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const tokens = (v: unknown): number => Math.ceil(JSON.stringify(v).length / 4);
const textOf = (r: unknown): string => ((r as { content: { text: string }[] }).content[0]!).text;

test('listing: the tool is in TOOLS and CORE_TOOLS, read-only, and lists in 150 tokens or fewer', async () => {
  assert.ok(TOOLS.some((t) => t.name === 'components'));
  assert.ok(CORE_TOOLS.includes('components'));
  const { client, close } = await connect({ tools: 'core' });
  try {
    const mine = (await client.listTools()).tools.filter((t) => t.name === 'components');
    assert.equal(mine.length, 1);
    assert.ok(tokens(mine) <= 150, `lists at ${tokens(mine)} tokens`);
    assert.equal(mine[0]!.annotations?.readOnlyHint, true);
  } finally {
    await close();
  }
});

test('search finds a pack by trigger; load returns the SKILL.md body; a review pack asks instead of loading', async () => {
  const { client, close } = await connect({ tools: 'core' });
  try {
    const s = textOf(await client.callTool({ name: 'components', arguments: { op: 'search', query: 'make a bar chart' } }));
    assert.match(s, /^design\/charts \[ready\]/);
    assert.equal(textOf(await client.callTool({ name: 'components', arguments: { op: 'search', query: 'zzzz nothing' } })), 'No component fits.');
    assert.equal(textOf(await client.callTool({ name: 'components', arguments: { op: 'load', id: 'design/charts' } })), 'COMPONENT: charts\nCHART BODY');
    assert.match(textOf(await client.callTool({ name: 'components', arguments: { op: 'load', id: 'security/rea' } })), /needs the person's approval/);
    const bad = await client.callTool({ name: 'components', arguments: { op: 'load', id: 'nope/x' } });
    assert.equal(bad.isError, true);
  } finally {
    await close();
  }
});

test('a session in manual mode or with components off starts without the tool (SEQUENCE_MCP_COMPONENTS=off)', async () => {
  assert.deepEqual(optionsFromEnv({ SEQUENCE_MCP_TOOLS: 'core', SEQUENCE_MCP_COMPONENTS: 'off' }), { tools: 'core', components: false });
  assert.deepEqual(optionsFromEnv({ SEQUENCE_MCP_TOOLS: 'core' }), { tools: 'core' });
  const { client, close } = await connect(optionsFromEnv({ SEQUENCE_MCP_TOOLS: 'core', SEQUENCE_MCP_COMPONENTS: 'off' }));
  try {
    assert.ok(!(await client.listTools()).tools.some((t) => t.name === 'components'));
  } finally {
    await close();
  }
});

test('load puts the preamble in front of the body, whole', async () => {
  put(root, 'security/pre', 'ready', ['x'], 'BODY');
  fs.writeFileSync(path.join(root, 'security/pre/SEQUENCE.md'), 'RULES FIRST\n');
  const f = path.join(root, 'security/pre/component.json');
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), preamble: 'SEQUENCE.md' }));
  const { client, close } = await connect({ tools: 'core' });
  try {
    assert.equal(textOf(await client.callTool({ name: 'components', arguments: { op: 'load', id: 'security/pre' } })), 'COMPONENT: pre\nRULES FIRST\n\nBODY');
  } finally {
    await close();
  }
});
