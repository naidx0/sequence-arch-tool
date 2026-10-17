/* T2 review ports (RV1-RV8): the map reaches Claude/Codex only when "Also send it to Claude and Codex" is on, once per thread, through /api/acp/run-node with a stub ACP agent. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { addAgent } from '../server/agentsStore.js';
import { AGENT_MAP_HEADER, AGENT_MAP_BLOCK_OPEN, AGENT_MAP_BLOCK_UPDATED, writeAgentSettings } from '../server/askAgentMap.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated } from '../server/sessionsStore.js';
import { readAgentRuns } from '../server/agentChatStore.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const here = path.dirname(fileURLToPath(import.meta.url));
const A = path.resolve(here, '..', '..');
const STUB = path.join(A, 'src', 'test', 'acp-agent-map', 'stub-acp-agent.mjs');
const REALCAT = path.join(A, 'components');

const MAP = (extra: string) => `# map shop · scanned 2026-10-01T00:00:00Z · 3 services\n\nservices: web, api, db\n${extra}\n`;

async function rig({ notes = false, auto = false, toAgents = true }: { notes?: boolean; auto?: boolean; toAgents?: boolean } = {}): Promise<any> {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-map-')));
  const store = path.join(dir, 'user', '.sequence');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(repo, 'index.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(repo, '.sequence', 'map.md'), MAP('web -> api'));
  if (notes) {
    fs.mkdirSync(path.join(repo, '.sequence', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.sequence', 'memory', 'NOTES.md'), '# Repo memory\n\n- Prefer the orders service for totals. <!--n:n1-->\n');
  }
  const chatId = ensureSessionsMigrated(repo).activeId;
  if (toAgents) writeAgentSettings(store, { mapToAgents: true });
  const log = path.join(dir, 'agent.log');
  addAgent(store, { id: 'stub', command: process.execPath, args: [STUB, log] });
  process.env.SEQUENCE_COMPONENTS_ROOT = REALCAT;
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  if (auto) {
    const r = await fetch(`${base}/api/components/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'auto' }) });
    assert.equal(r.status, 200);
  }
  const lines = (): any[] => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as any) : []);
  return {
    base, chatId, repo, store, dir,
    prompts: () => lines().filter((l: any) => l.kind === 'prompt').map((l: any) => String(l.text)),
    sids: () => lines().filter((l: any) => l.kind === 'prompt').map((l: any) => l.sid),
    close: () => new Promise<void>((r) => { server.close(() => r()); (server as any).closeAllConnections?.(); }),
  };
}
async function turn(base: string, body: any): Promise<any[]> {
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ agentRef: 'stub', ...body }) });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.text()).split('\n').filter((l) => l.startsWith('data: ')).map((l) => JSON.parse(l.slice(6)));
}
const chatTurn = (s: any, prompt: string, extra: any = {}) => turn(s.base, { prompt, chatId: s.chatId, sessionKey: `chat::${s.chatId}::stub`, ...extra });
const count = (h: string, n: string) => h.split(n).length - 1;

test('RV1 first/second/near-identical/rescan/after-rescan through run-node', async () => {
  const s = await rig();
  try {
    await chatTurn(s, 'what does scan do?');
    await chatTurn(s, 'what does scan do');
    await chatTurn(s, 'what does scan do??');
    const [p1, p2, p3] = s.prompts();
    assert.equal(count(p1, AGENT_MAP_HEADER), 1);
    assert.ok(p1.startsWith(AGENT_MAP_BLOCK_OPEN));
    assert.equal(p2, 'what does scan do');
    assert.equal(p3, 'what does scan do??');
    fs.writeFileSync(path.join(s.repo, '.sequence', 'map.md'), MAP('web -> api\napi -> db'));
    await chatTurn(s, 'again');
    const p4 = s.prompts()[3];
    assert.ok(p4.startsWith(AGENT_MAP_BLOCK_UPDATED), p4.slice(0, 200));
    assert.equal(count(p4, AGENT_MAP_HEADER), 1);
    assert.ok(!p4.includes(AGENT_MAP_BLOCK_OPEN));
    await chatTurn(s, 'again2');
    assert.equal(s.prompts()[4], 'again2');
    fs.writeFileSync(path.join(s.repo, '.sequence', 'map.md'), MAP('web -> api\napi -> db').replace('2026-10-01T00:00:00Z', '2026-10-02T11:11:11Z'));
    await chatTurn(s, 'again3');
    assert.equal(s.prompts()[5], 'again3', 'a rescan that changes only the scan time must not resend');
    assert.equal(new Set(s.sids()).size, 1);
  } finally { await s.close(); }
});

test('RV2 design mode (no repo) sends no map', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-dm-')));
  const store = path.join(dir, 'user', '.sequence');
  fs.mkdirSync(store, { recursive: true });
  const chatId = ensureSessionsMigrated(path.join(dir, 'user')).activeId;
  const log = path.join(dir, 'agent.log');
  addAgent(store, { id: 'stub', command: process.execPath, args: [STUB, log] });
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  try {
    await turn(`http://127.0.0.1:${(server.address() as any).port}`, { prompt: 'design hi', chatId, sessionKey: `chat::${chatId}::stub` });
    const p = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as any).filter((l) => l.kind === 'prompt');
    assert.equal(p[0].text, 'design hi');
  } finally { await new Promise<void>((r) => { server.close(() => r()); (server as any).closeAllConnections?.(); }); }
});

test('RV3 setting off then on mid-thread: nothing while off, map once after on', async () => {
  const s = await rig();
  try {
    writeAgentSettings(s.store, { mapToAgents: false });
    await chatTurn(s, 'one');
    writeAgentSettings(s.store, { mapToAgents: true });
    await chatTurn(s, 'two');
    await chatTurn(s, 'three');
    const [p1, p2, p3] = s.prompts();
    assert.equal(p1, 'one');
    assert.equal(count(p2, AGENT_MAP_HEADER), 1);
    assert.equal(p3, 'three');
  } finally { await s.close(); }
});

test('RV4 notes + components + map: stable order; second turn prefix-free', async () => {
  const s = await rig({ notes: true, auto: true });
  try {
    const ev = await chatTurn(s, 'fix typography on this page');
    const p1 = s.prompts()[0];
    const iMap = p1.indexOf(AGENT_MAP_HEADER);
    const iNotes = p1.indexOf('Prefer the orders service');
    const used = ev.filter((e: any) => e.type === 'component:used');
    assert.ok(iMap >= 0 && iNotes > iMap, `map ${iMap} notes ${iNotes}`);
    if (used.length) {
      const iComp = p1.search(/typograph/i);
      console.log('# component used; comp idx', iComp, 'map', iMap, 'notes', iNotes);
      assert.ok(iComp > iMap && iComp < iNotes);
    } else console.log('# no component used in auto mode');
    assert.ok(p1.endsWith('fix typography on this page'));
    await chatTurn(s, 'and again');
    assert.equal(s.prompts()[1], 'and again');
    const rec = JSON.stringify(ev.filter((e: any) => e.type === 'acp:log'));
    console.log('# acp:log notes entry', /"notes"[^}]*}/.exec(rec)?.[0]);
  } finally { await s.close(); }
});

test('RV5 rewind (new provider thread) resends the map', async () => {
  const s = await rig();
  try {
    await chatTurn(s, 'one');
    await chatTurn(s, 'two');
    const r = await fetch(`${s.base}/api/sessions/${s.chatId}/rewind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fromTurnId: null }) });
    console.log('# rewind status', r.status, (await r.text()).slice(0, 200));
    await chatTurn(s, 'three');
    const p = s.prompts();
    console.log('# sids', s.sids());
    assert.equal(count(p[2], AGENT_MAP_HEADER), 1, p[2].slice(0, 300));
  } finally { await s.close(); }
});

test('RV6 server restart (fresh ledger, new thread) resends once', async () => {
  const s = await rig();
  await chatTurn(s, 'one');
  await s.close();
  const server = await createRepoServer(s.repo, { webDist: undefined, userConfigDir: s.store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    await turn(base, { prompt: 'two', chatId: s.chatId, sessionKey: `chat::${s.chatId}::stub` });
    await turn(base, { prompt: 'three', chatId: s.chatId, sessionKey: `chat::${s.chatId}::stub` });
    const p = s.prompts();
    assert.equal(count(p[1], AGENT_MAP_HEADER), 1);
    assert.equal(p[2], 'three');
  } finally { await new Promise<void>((r) => { server.close(() => r()); (server as any).closeAllConnections?.(); }); }
});

test('RV7 chatless reused session (board node ask, sessionKey ask-node::X, no chatId): map once per provider thread', async () => {
  const s = await rig();
  try {
    await turn(s.base, { prompt: 'q1', sessionKey: 'ask-node::svc:web::stub' });
    await turn(s.base, { prompt: 'q2', sessionKey: 'ask-node::svc:web::stub' });
    await turn(s.base, { prompt: 'q3', sessionKey: 'ask-node::svc:web::stub' });
    const p = s.prompts();
    const sids = s.sids();
    console.log('# chatless sids', JSON.stringify(sids), 'map counts', JSON.stringify(p.map((x: string) => count(x, AGENT_MAP_HEADER))));
    assert.equal(new Set(sids).size, 1, 'one reused provider session');
    assert.deepEqual(p.map((x: string) => count(x, AGENT_MAP_HEADER)), [1, 0, 0], 'map once per provider thread');
  } finally { await s.close(); }
});

test('RV8 readPaths through run-node: windows abs, backslash, outside, 1000 reads, repo-wide grep', async () => {
  const s = await rig();
  try {
    const R = s.repo;
    const calls: any[] = [
      { kind: 'read', title: 'Read a', locations: [{ path: path.join(R, 'src', 'a.ts') }], rawInput: { file_path: path.join(R, 'src', 'a.ts') } },
      { kind: 'read', title: 'Read b', rawInput: { file_path: R.replace(/\\/g, '/') + '/src/b.ts' } },
      { kind: 'read', title: 'Read c upper', rawInput: { file_path: R.toUpperCase() + '\\src\\c.ts' } },
      { kind: 'read', title: 'Read outside', rawInput: { file_path: 'D:\\other\\x.ts' } },
      { kind: 'read', title: 'Read outside2', rawInput: { file_path: path.join(path.dirname(R), 'user', 'secret.txt') } },
      { kind: 'read', title: 'Read rel escape', rawInput: { file_path: '..\\..\\etc\\passwd' } },
      { kind: 'search', title: 'Grep foo', rawInput: { pattern: 'foo' } },
      { kind: 'search', title: 'Grep foo root', rawInput: { pattern: 'foo', path: R } },
      { kind: 'search', title: 'Grep dot', rawInput: { pattern: 'foo', path: '.' } },
      { kind: 'edit', title: 'Edit sitemap.map', locations: [{ path: path.join(R, 'z', 'edited.ts') }] },
    ];
    for (let i = 0; i < 1000; i++) calls.push({ kind: 'read', title: `Read f${i}`, rawInput: { file_path: path.join(R, 'many', `f${i}.ts`) } });
    const enc = Buffer.from(JSON.stringify(calls)).toString('base64');
    await chatTurn(s, `read stuff TOOLS:${enc}`);
    const run = readAgentRuns(s.repo, s.chatId).at(-1);
    const rp = run!.readPaths ?? [];
    console.log('# readPaths size', rp.length, 'first 8', JSON.stringify(rp.slice(0, 8)));
    assert.ok(rp.includes('src/a.ts'));
    assert.ok(rp.includes('src/b.ts'));
    assert.ok(!rp.some((p: string) => /other|secret|passwd|etc/.test(p)), JSON.stringify(rp.slice(0, 10)));
    assert.ok(!rp.some((p: string) => p.includes('\\')), 'forward slashes');
    assert.ok(!rp.some((p: string) => /^[A-Za-z]:/.test(p)), 'no drive letters');
    assert.ok(rp.length <= 400);
    console.log('# upper-case root path kept as', rp.find((p: string) => /c\.ts$/i.test(p)));
    assert.ok(!rp.includes('z/edited.ts'), 'an edit is not a read, whatever its title says');
    assert.ok(rp.some((p: string) => /c\.ts$/i.test(p)), 'a differently-cased drive/root still maps');
  } finally { await s.close(); }
});
