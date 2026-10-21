import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ManualClock } from '@sequence/acp/dist/replay/clock.js';
import { replaySpawn, type ReplayHandle } from '@sequence/acp/dist/replay/codexReplay.js';
import type { Json } from '@sequence/acp/dist/replay/fixture.js';

import { IMAGE_MAX_EDGE } from '../server/attachmentStore.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated, writeSessionWorktree } from '../server/sessionsStore.js';
import { agentSpecimen, replayFixture, streamTurn, updatesOf } from './support/agentServer.js';

/**
 * S2a THROUGH THE REAL SERVER, a shopfront copy attached, codex replayed
 * from the codex-s2a fixtures (not run live):
 *
 *   - every turn's codex thread carries Sequence's board server as a
 *     per-thread override (thread/start config mcp_servers.sequence.*): this
 *     node, packages/mcp's stdio entry, SEQUENCE_REPO the turn's repository,
 *     the core tools unless the "all board tools" setting is on
 *   - the agent's sequence.map call reaches the stream as a read row with the
 *     map as its output
 *   - a stored image goes as a localImage of its file; a board node as its
 *     map slice; a file of the repo as a mention; nothing outside the repo
 *   - images are checked on the way in: type by their bytes, size, long edge
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOPFRONT = path.resolve(HERE, '..', '..', 'test', 'fixtures', 'shopfront');
const CODEX = { id: 'codex', command: 'codex' };

function repoCopy(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s2a-repo-')));
  fs.cpSync(SHOPFRONT, dir, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git|\.sequence)([\\/]|$)/.test(p.slice(SHOPFRONT.length)) });
  return dir;
}

/** A PNG header (8-byte signature + IHDR) of the given size: enough for the store's checks. */
function pngOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(b, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

async function serve(repo: string, store: string, h: ReplayHandle, clock: ManualClock) {
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir: store, acpTurn: { clock, spawn: h.spawn, killGraceMs: 0 } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

/** Remove the repo copy; on Windows a handle the closed server let go of can take a moment to be released. */
async function removeWhenFree(dir: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i >= 50 || (e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

async function rig(fixture: string) {
  const s = agentSpecimen(CODEX);
  const repo = repoCopy();
  const clock = new ManualClock();
  const h = replaySpawn(replayFixture('codex-s2a', fixture), { clock, values: { '<CWD>': repo, '<HOME>': os.homedir(), '<MCP>': path.resolve(HERE, '..', '..', '..', 'mcp', 'dist', 'server.js') } });
  /* A chat of this repository (images belong to one). */
  const chat = ensureSessionsMigrated(repo).activeId;
  const srv = await serve(repo, s.store, h, clock);
  return {
    s,
    repo,
    chat,
    h,
    srv,
    done: async () => {
      await srv.close();
      fs.rmSync(s.dir, { recursive: true, force: true });
      await removeWhenFree(repo);
    },
  };
}

const configOf = (h: ReplayHandle): Json => (h.replay.received.find((m) => m.method === 'thread/start')!.params as Json).config as Json;

test('board-mcp-map (not run live): the turn\'s thread carries Sequence\'s board server for this repository (core tools); sequence.map is a read row with the map as its output', async () => {
  const r = await rig('board-mcp-map');
  try {
    const events = await streamTurn(r.srv.base, { agentRef: 'codex', prompt: 'What does orders call?', permissionMode: 'propose', chatId: r.s.chatId }, r.h);
    assert.deepStrictEqual(r.h.replay.state.divergences, []);
    const config = configOf(r.h);
    assert.strictEqual(config['mcp_servers.sequence.command'], process.execPath);
    const args = config['mcp_servers.sequence.args'] as string[];
    assert.strictEqual(args.length, 1);
    assert.match(args[0]!.split(path.sep).join('/'), /packages\/mcp\/dist\/server\.js$/);
    assert.ok(fs.existsSync(args[0]!), 'the entry exists');
    /* Lane components: the visual tool saves drawings in the project, under this chat. */
    /* The app's address and this chat's thread key are how `components load` asks the app (approve mode raises a card there). */
    const { SEQUENCE_COMPONENTS_URL: appUrl, SEQUENCE_COMPONENTS_KEY: threadKey, SEQUENCE_COMPONENTS_MODE: mode, SEQUENCE_GENUI_URL: genuiUrl, ...baseEnv } = config['mcp_servers.sequence.env'] as Record<string, string>;
    assert.match(appUrl!, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(threadKey, `chat::${r.s.chatId}::codex`);
    assert.equal(mode, 'approve', 'the mode the person set travels with the session');
    assert.equal(mode, 'approve', 'the mode the person set travels with the session');
    /* Contract change: a chat's agent also carries the address surfaces are drawn to, keyed for this chat alone (genuiRoutes.ts keyFor). */
    assert.match(genuiUrl!, /^http:\/\/127\.0\.0\.1:\d+\/api\/genui\/ingest\?session=[^&]+&key=[0-9a-f]{32}$/);
    assert.strictEqual(new URL(genuiUrl!).searchParams.get('session'), r.s.chatId);
    assert.deepStrictEqual(baseEnv, { SEQUENCE_REPO: r.repo, SEQUENCE_MCP_TOOLS: 'core', SEQUENCE_DRAWINGS_ROOT: r.repo, SEQUENCE_CHAT: r.s.chatId });
    const call = updatesOf(events, 'tool_call')[0]!;
    assert.deepStrictEqual([call.title, call.kind], ['sequence.map', 'read']);
    const done = updatesOf(events, 'tool_call_update')[0]!;
    assert.match(String(((done.content as Json[])[0]!.content as Json).text), /^# map shopfront/);
  } finally {
    await r.done();
  }
});

test('the "all board tools" setting gives the session every tool', async () => {
  const r = await rig('board-mcp-map');
  try {
    const put = await fetch(`${r.srv.base}/api/agent-settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allBoardTools: true }) });
    assert.strictEqual(put.status, 200);
    const got = (await put.json()) as { allBoardTools: boolean; includeArchitectureMap: boolean };
    assert.deepStrictEqual([got.allBoardTools, got.includeArchitectureMap], [true, true], 'one field changes, the other keeps its value');
    await streamTurn(r.srv.base, { agentRef: 'codex', prompt: 'What does orders call?', permissionMode: 'propose', chatId: r.s.chatId }, r.h);
    assert.strictEqual((configOf(r.h)['mcp_servers.sequence.env'] as Json).SEQUENCE_MCP_TOOLS, 'all');
  } finally {
    await r.done();
  }
});

test('image-turn (not run live): a stored image goes as a localImage of its file; a board node as its map slice; a repo file as a mention', async () => {
  const r = await rig('image-turn');
  try {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000000200015e2b1c370000000049454e44ae426082', 'hex');
    const up = await fetch(`${r.srv.base}/api/attachment/image?session=${r.chat}&name=paste.png`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    assert.strictEqual(up.status, 200);
    const { attachment } = (await up.json()) as { attachment: { id: string; kind: string; width: number; height: number } };
    assert.deepStrictEqual([attachment.kind, attachment.width, attachment.height], ['image', 1, 1]);
    const file = fs.readdirSync(r.repo, { recursive: true }).map(String).find((f) => f.endsWith('main.py'))!;
    await streamTurn(
      r.srv.base,
      {
        agentRef: 'codex',
        prompt: 'What is wrong in this screenshot?',
        permissionMode: 'propose',
        chatId: r.chat,
        attachments: [{ kind: 'image', id: attachment.id }, { kind: 'node', nodeId: 'svc:orders' }, { kind: 'file', path: file }],
      },
      r.h,
    );
    assert.deepStrictEqual(r.h.replay.state.divergences, []);
    const input = (r.h.replay.received.find((m) => m.method === 'turn/start')!.params as Json).input as Json[];
    assert.deepStrictEqual(input.map((i) => i.type), ['text', 'localImage', 'text', 'mention']);
    const local = String(input[1]!.path);
    assert.ok(local.startsWith(path.join(r.repo, '.sequence', 'sessions', r.chat, 'attachments')) && fs.readFileSync(local).equals(png), "the chat's stored file, not base64");
    assert.match(String(input[2]!.text), /^# map .*\n[\s\S]*orders/);
    assert.ok(Math.ceil(String(input[2]!.text).length / 4) <= 1000, 'the 1k slice');
    assert.deepStrictEqual(input[3], { type: 'mention', name: file.split(path.sep).join('/'), path: path.join(r.repo, file) });
  } finally {
    await r.done();
  }
});

test('attachments are resolved by the server: nothing outside the repo, no unknown image, no unknown node', async () => {
  const r = await rig('image-turn');
  try {
    const run = (attachments: unknown) =>
      fetch(`${r.srv.base}/api/acp/run-node?stream=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentRef: 'codex', prompt: 'x', chatId: r.s.chatId, interactivePermissions: true, attachments }) });
    for (const bad of [[{ kind: 'file', path: '../outside.txt' }], [{ kind: 'image', id: 'f'.repeat(64) }], [{ kind: 'node', nodeId: 'svc:nope' }], [{ kind: 'url', href: 'x' }], 'nope']) {
      const res = await run(bad);
      assert.strictEqual(res.status, 400, JSON.stringify(bad));
    }
    assert.strictEqual(r.h.spawned.length, 0, 'a refused turn never starts the agent');
  } finally {
    await r.done();
  }
});

test(`images are checked on the way in: the bytes' own type, and a long edge of at most ${IMAGE_MAX_EDGE} px`, async () => {
  const r = await rig('image-turn');
  try {
    const post = (body: Buffer, type: string) => fetch(`${r.srv.base}/api/attachment/image?session=${r.chat}`, { method: 'POST', headers: { 'content-type': type }, body });
    assert.strictEqual((await post(pngOf(IMAGE_MAX_EDGE, 1000), 'image/png')).status, 200);
    const wide = await post(pngOf(2058, 2144), 'image/png');
    assert.strictEqual(wide.status, 422);
    assert.match(((await wide.json()) as { error: string }).error, /2058x2144; scale its long edge to 1568 px first/);
    assert.strictEqual((await post(pngOf(10, 10), 'image/jpeg')).status, 422, 'sent as JPEG, the bytes are PNG');
    assert.strictEqual((await post(Buffer.from('not an image'), 'image/png')).status, 422);
    assert.strictEqual((await post(pngOf(10, 10), 'text/plain')).status, 415);
  } finally {
    await r.done();
  }
});

test("an image lives with its chat: resume finds it under the chat's folder, an upload names a chat of this repo, and a deleted chat leaves no image files", async () => {
  const r = await rig('image-turn');
  try {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000000200015e2b1c370000000049454e44ae426082', 'hex');
    const nowhere = await fetch(`${r.srv.base}/api/attachment/image?session=no-such-chat`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    assert.strictEqual(nowhere.status, 400);
    const up = await fetch(`${r.srv.base}/api/attachment/image?session=${r.chat}&name=paste.png`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: png });
    const { attachment } = (await up.json()) as { attachment: { id: string } };
    const stored = path.join(r.repo, '.sequence', 'sessions', r.chat, 'attachments', `${attachment.id}.png`);
    assert.ok(fs.existsSync(stored));
    /* Nothing in the shared store: the image goes where the chat goes. */
    assert.strictEqual(fs.existsSync(path.join(r.repo, '.sequence', 'attachments', `${attachment.id}.png`)), false);
    const del = await fetch(`${r.srv.base}/api/sessions/${encodeURIComponent(r.chat)}`, { method: 'DELETE' });
    assert.strictEqual(del.status, 200, await del.text());
    const left: string[] = [];
    (function walk(dir: string) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.startsWith(attachment.id)) left.push(p);
      }
    })(path.join(r.repo, '.sequence'));
    assert.deepStrictEqual(left, [], 'no image file (or its record) is left anywhere under .sequence');
  } finally {
    await r.done();
  }
});

test('the Agents panel\'s Claude gets the board too: --mcp-config names the server, the per-session settings allow mcp__sequence__*', async () => {
  const r = await rig('image-turn');
  let dir = '';
  try {
    const res = await fetch(`${r.srv.base}/api/agent-hooks/claude`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { settingsFile: string; mcpConfigFile: string; command: string };
    dir = path.dirname(body.settingsFile);
    assert.strictEqual(body.command, `claude --settings "${body.settingsFile}" --mcp-config "${body.mcpConfigFile}"`);
    assert.deepStrictEqual((JSON.parse(fs.readFileSync(body.settingsFile, 'utf8')) as Json).permissions, { allow: ['mcp__sequence__*'] });
    const mcp = (JSON.parse(fs.readFileSync(body.mcpConfigFile, 'utf8')) as { mcpServers: { sequence: Json } }).mcpServers.sequence;
    /* The Claude terminal launch asks this app about components and carries the person's mode. */
    const { SEQUENCE_COMPONENTS_URL: claudeAppUrl, SEQUENCE_COMPONENTS_MODE: claudeMode, ...claudeEnv } = mcp.env as Record<string, string>;
    assert.match(claudeAppUrl!, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(claudeMode, 'approve');
    assert.deepStrictEqual(claudeEnv, { SEQUENCE_REPO: r.repo, SEQUENCE_MCP_TOOLS: 'core' });
    assert.notStrictEqual(path.resolve(body.settingsFile), path.resolve(os.homedir(), '.claude', 'settings.json'));
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    await r.done();
  }
});

/** The agent-event store as /api/agent-events replays it to a new subscriber, up to the first event `until` accepts. */
async function agentEventsUntil(base: string, until: (e: Json) => boolean): Promise<Json[]> {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/agent-events`, { signal: ac.signal });
  const reader = res.body!.getReader();
  const out: Json[] = [];
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return out;
      buf += Buffer.from(value).toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!frame.startsWith('data: ')) continue;
        const ev = JSON.parse(frame.slice(6)) as Json;
        out.push(ev);
        if (until(ev)) return out;
      }
    }
  } finally {
    ac.abort();
  }
}

test('board-mcp-map in a chat bound to a worktree (not run live): the run-node turn feeds the Agents tree under the chat id', async () => {
  const r = await rig('board-mcp-map');
  const wt = repoCopy();
  try {
    assert.ok(
      writeSessionWorktree(r.repo, r.chat, { id: 'abcd1234', path: wt, branch: 'sequence/fix-orders-3fa2', baseCommit: '0'.repeat(40), baseBranch: 'main', createdAt: new Date(0).toISOString() }),
    );
    await streamTurn(r.srv.base, { agentRef: 'codex', prompt: 'What does orders call?', permissionMode: 'propose', chatId: r.chat }, r.h);
    assert.deepStrictEqual(r.h.replay.state.divergences, []);
    assert.strictEqual((configOf(r.h)['mcp_servers.sequence.env'] as Json).SEQUENCE_REPO, wt, 'the turn ran in the worktree');
    /* ...but drawings are saved where the app reads them: the project, under the chat (lane components). */
    assert.strictEqual((configOf(r.h)['mcp_servers.sequence.env'] as Json).SEQUENCE_DRAWINGS_ROOT, r.repo);
    assert.strictEqual((configOf(r.h)['mcp_servers.sequence.env'] as Json).SEQUENCE_CHAT, r.chat);
    const events = await agentEventsUntil(r.srv.base, (e) => e.kind === 'stop');
    const mine = events.filter((e) => e.sessionId === r.chat);
    assert.deepStrictEqual(
      mine.map((e) => [e.source, e.kind, e.status, e.tool ?? null, e.title ?? null]),
      [
        ['codex', 'session_start', 'running', null, 'What does orders call?'],
        ['codex', 'tool_start', 'running', 'Read', 'sequence.map'],
        ['codex', 'tool_end', 'done', 'Read', 'sequence.map'],
        ['codex', 'stop', 'done', null, null],
      ],
    );
    assert.strictEqual(mine[1]!.toolUseId, mine[2]!.toolUseId, 'start and end pair up');
    assert.strictEqual(events.length, mine.length, 'nothing under another session');
  } finally {
    await r.done();
    await removeWhenFree(wt);
  }
});
