/* T2: the architecture map reaches Claude/Codex once per thread, through /api/acp/run-node with a stub ACP agent. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { addAgent } from '../server/agentsStore.js';
import { AGENT_MAP_HEADER, agentMapSection, writeAgentSettings } from '../server/askAgentMap.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';
import { DEFAULT_MAP_BUDGET } from '../agentMap.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.resolve(here, '..', '..', 'src', 'test', 'components-e2e', 'stub-acp-agent.mjs');

type Json = Record<string, unknown>;

const MAP = (extra: string) => `# map shop · scanned 2026-10-01T00:00:00Z · 3 services\n\nservices: web, api, db\n${extra}\n`;

async function rig(toAgents = true) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acp-map-')));
  const root = path.join(dir, 'user');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'index.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, '.sequence', 'map.md'), MAP('web -> api'));
  const store = path.join(root, '.sequence');
  fs.mkdirSync(store, { recursive: true });
  const chatId = ensureSessionsMigrated(repo).activeId;
  if (toAgents) writeAgentSettings(store, { mapToAgents: true });
  const log = path.join(dir, 'agent.log');
  addAgent(store, { id: 'stub', command: process.execPath, args: [STUB, log] });
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const prompts = (): string[] =>
    fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Json).filter((l) => l.kind === 'prompt').map((l) => String(l.text)) : [];
  return {
    base, chatId, repo, store, prompts,
    close: () => new Promise<void>((r) => { server.close(() => r()); (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.(); }),
  };
}

async function turn(base: string, chatId: string, prompt: string): Promise<Json[]> {
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ agentRef: 'stub', prompt, chatId, sessionKey: `chat::${chatId}::stub` }),
  });
  assert.equal(res.status, 200);
  const out: Json[] = [];
  for (const line of (await res.text()).split('\n')) if (line.startsWith('data: ')) out.push(JSON.parse(line.slice(6)) as Json);
  return out;
}
const count = (h: string, n: string) => h.split(n).length - 1;

test('first prompt to a new thread starts with the map; the second does not; a rescan sends it again; off sends nothing', async () => {
  const s = await rig();
  try {
    await turn(s.base, s.chatId, 'hello one');
    await turn(s.base, s.chatId, 'hello two');
    const [p1, p2] = s.prompts();
    assert.ok(p1!.startsWith('[Added by Sequence'), p1!.slice(0, 120));
    assert.equal(count(p1!, AGENT_MAP_HEADER), 1);
    assert.ok(p1!.includes('web -> api'));
    assert.ok(!/do not mention/i.test(p1!.slice(0, 400)), 'labelled, not hidden');
    assert.ok(p1!.endsWith('hello one'));
    assert.ok(!p2!.includes(AGENT_MAP_HEADER), 'byte-stable: once per thread');
    assert.equal(p2, 'hello two');

    fs.writeFileSync(path.join(s.repo, '.sequence', 'map.md'), MAP('web -> api\napi -> db'));
    await turn(s.base, s.chatId, 'hello three');
    const p3 = s.prompts()[2]!;
    assert.equal(count(p3, AGENT_MAP_HEADER), 1, 'a changed map is sent again');
    assert.ok(p3.includes('api -> db'));
    await turn(s.base, s.chatId, 'hello four');
    assert.equal(s.prompts()[3], 'hello four');
  } finally {
    await s.close();
  }
});

test('by default nothing is sent (the built-in model setting does not reach agents); the block stays within the map budget', async () => {
  const s = await rig(false);
  try {
    await turn(s.base, s.chatId, 'plain');
    assert.equal(s.prompts()[0], 'plain');
    writeAgentSettings(s.store, { includeArchitectureMap: true, mapToAgents: false });
    await turn(s.base, s.chatId, 'plain2');
    assert.equal(s.prompts()[1], 'plain2');
    assert.ok(agentMapSection(s.repo)!.tokens <= DEFAULT_MAP_BUDGET);
  } finally {
    await s.close();
  }
});
