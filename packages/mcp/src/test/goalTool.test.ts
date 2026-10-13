/**
 * The `goal` MCP tool (goalTools.ts): absent from every default listing, present only in a goal run's session,
 * lists in 120 tokens or fewer, and ticks the chat's plan through the analyzer's own plan checks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { goalToolCall } from '@sequence/analyzer/dist/server/goalAgentTools.js';
import { createSession, readSessionGoal, updateSession } from '@sequence/analyzer/dist/server/sessionsStore.js';
import { CORE_TOOLS, TOOLS, createServer, type CreateServerOptions } from '../index.js';
import { optionsFromEnv } from '../server.js';

async function connect(opts: CreateServerOptions) {
  const server = createServer(opts);
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 't', version: '0' });
  await Promise.all([server.connect(s), client.connect(c)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const tokens = (v: unknown): number => Math.ceil(JSON.stringify(v).length / 4);
const textOf = (r: unknown): string => ((r as { content: { text: string }[] }).content[0]!).text;

const KEY = 'run-key';
const servers: http.Server[] = [];

/** A stand-in for the app's POST /api/goal-tick: the same executor, the same key check. */
async function goalChat(running: boolean, opts: { dead?: boolean } = {}): Promise<{ root: string; chat: string; url: string; key: string }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-goal-'));
  const chat = createSession(root).id;
  updateSession(root, chat, { goal: 'ship it', plan: [{ id: 's1', text: 'Edit a.ts to add the guard', status: 'open' }, { id: 's2', text: 'Edit b.ts to use the guard', status: 'open' }] });
  if (running) {
    const dir = path.join(root, '.sequence', 'sessions', chat);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'goal-run.json'), JSON.stringify({ version: 1, sessionId: chat, pid: process.pid, running: true, turns: 0, cap: 24 }));
  }
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      const b = JSON.parse(raw) as { key?: string; chat?: string; op?: string; step?: string; steps?: string[] };
      if (b.key !== KEY || b.chat !== chat) {
        res.writeHead(403).end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(goalToolCall(root, chat, b)));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  if (opts.dead) await new Promise<void>((r) => server.close(() => r()));
  else servers.push(server);
  return { root, chat, url: `http://127.0.0.1:${port}`, key: KEY };
}

test.after(() => {
  for (const s of servers) s.close();
});

test('no default listing carries the goal tool: it is not in TOOLS or CORE_TOOLS, and core and all lack it', async () => {
  assert.ok(!TOOLS.some((t) => (t.name as string) === 'goal'));
  assert.ok(!CORE_TOOLS.includes('goal'));
  for (const opts of [{ tools: 'core' as const }, {}]) {
    const { client, close } = await connect(opts);
    try {
      assert.ok(!(await client.listTools()).tools.some((t) => t.name === 'goal'));
    } finally {
      await close();
    }
  }
});

test('a goal run session lists goal in 120 tokens or fewer, and is not read-only', async () => {
  const g = await goalChat(true);
  const { client, close } = await connect({ tools: 'core', goal: { url: g.url, key: g.key, chat: g.chat } });
  try {
    const mine = (await client.listTools()).tools.filter((t) => t.name === 'goal');
    assert.equal(mine.length, 1);
    assert.ok(tokens(mine) <= 120, `goal lists at ${tokens(mine)} tokens`);
    assert.notEqual(mine[0]!.annotations?.readOnlyHint, true, 'a write: never declared read-only');
  } finally {
    await close();
  }
});

test('the environment a goal run sets selects the tool; without it there is none', () => {
  assert.deepEqual(optionsFromEnv({ SEQUENCE_MCP_TOOLS: 'core', SEQUENCE_GOAL_URL: 'http://127.0.0.1:1', SEQUENCE_GOAL_KEY: 'k', SEQUENCE_GOAL_CHAT: 'c1' }).goal, { url: 'http://127.0.0.1:1', key: 'k', chat: 'c1' });
  assert.equal(optionsFromEnv({ SEQUENCE_MCP_TOOLS: 'core', SEQUENCE_GOAL_URL: 'http://127.0.0.1:1', SEQUENCE_GOAL_CHAT: 'c1' }).goal, undefined);
});

test('mark_step_done ticks the plan on disk; an ambiguous or unknown step is refused and changes nothing', async () => {
  const g = await goalChat(true);
  const { client, close } = await connect({ tools: 'core', goal: { url: g.url, key: g.key, chat: g.chat } });
  try {
    const bad = await client.callTool({ name: 'goal', arguments: { op: 'mark_step_done', step: 'the guard' } });
    assert.equal(bad.isError, true);
    assert.match(textOf(bad), /more than one open step/);
    const ok = await client.callTool({ name: 'goal', arguments: { op: 'mark_step_done', step: 'a.ts' } });
    assert.ok(!ok.isError, textOf(ok));
    assert.deepEqual((readSessionGoal(g.root, g.chat).plan ?? []).map((s) => s.status), ['done', 'open']);
    assert.match(textOf(ok), /Next open step: Edit b\.ts/);
  } finally {
    await close();
  }
});

test('with no live run for the chat the tool changes nothing', async () => {
  const g = await goalChat(false);
  const { client, close } = await connect({ tools: 'core', goal: { url: g.url, key: g.key, chat: g.chat } });
  try {
    const r = await client.callTool({ name: 'goal', arguments: { op: 'mark_step_done', step: 'a.ts' } });
    assert.equal(r.isError, true);
    assert.deepEqual((readSessionGoal(g.root, g.chat).plan ?? []).map((s) => s.status), ['open', 'open']);
  } finally {
    await close();
  }
});

test('when the app cannot be reached, the tool says nothing was ticked and the plan is untouched', async () => {
  const g = await goalChat(true, { dead: true });
  const { client, close } = await connect({ tools: 'core', goal: { url: g.url, key: g.key, chat: g.chat } });
  try {
    const r = await client.callTool({ name: 'goal', arguments: { op: 'mark_step_done', step: 'a.ts' } });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /Nothing was ticked/);
  } finally {
    await close();
  }
});

test('a wrong key is refused by the app and reported, not as a tick', async () => {
  const g = await goalChat(true);
  const { client, close } = await connect({ tools: 'core', goal: { url: g.url, key: 'forged', chat: g.chat } });
  try {
    const r = await client.callTool({ name: 'goal', arguments: { op: 'mark_step_done', step: 'a.ts' } });
    assert.equal(r.isError, true);
    assert.match(textOf(r), /refused the tick \(403\)/);
    assert.deepEqual((readSessionGoal(g.root, g.chat).plan ?? []).map((s) => s.status), ['open', 'open']);
  } finally {
    await close();
  }
});
