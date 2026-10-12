import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { ManualClock } from '@sequence/acp/dist/replay/clock.js';
import { replaySpawn, type ReplayHandle } from '@sequence/acp/dist/replay/codexReplay.js';
import { readFixture, type Json } from '@sequence/acp/dist/replay/fixture.js';
import { SILENT_TOOL_THREAD } from '@sequence/acp/dist/replay/codexS1Fixtures.js';

import { addAgent } from '../server/agentsStore.js';
import { createRepoServer } from '../server/repoServer.js';
import { ensureSessionsMigrated, readAgentThread } from '../server/sessionsStore.js';
import { readSession } from '../server/snapshot.js';
import { execFileSync } from 'node:child_process';
import { REPLAY_FIXTURES, normalizeEvents } from './support/replayRunNode.js';

/**
 * S1 — AGENTS THAT DON'T FORGET, THROUGH THE REAL SERVER, ON A FAKE CLOCK.
 *
 * The agent is a replay of a recorded codex session, spawned in-process on a
 * ManualClock that the server's idle watchdog shares (`acpTurn.clock`), so a
 * 20-second silence or an hour-long approval costs the test nothing and is
 * still that long to the watchdog. Four cases, as the S1 brief names them:
 *   silent tool       live long-silent-tool: 20 s with no output is not a hang
 *   approval wait     live command-approval: ten idle periods waiting on a
 *                     person is not a hang
 *   hung child        hung-after-start (not run live): no progress for idleMs
 *                     is a hang, the turn is stopped and Retry is offered
 *   restart, resume   long-silent-tool on one server, then a NEW server (an
 *                     app restart) reopens the same codex thread with
 *                     thread/resume (resume-after-restart, not run live)
 * Nothing sleeps: the replay is drained, the clock is moved.
 */

const IDLE = 60_000;

interface S1Server {
  base: string;
  close: () => Promise<void>;
}

function specimen(): { dir: string; store: string; root: string; work: string; chatId: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s1-')));
  /* The workspace session store is the user store's parent: keep both inside this test's own directory. */
  const root = path.join(dir, 'user');
  const store = path.join(root, '.sequence');
  const work = path.join(dir, 'work');
  fs.mkdirSync(store, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const chatId = ensureSessionsMigrated(root).activeId;
  addAgent(store, { id: 'codex', command: 'codex', cwd: work });
  return { dir, store, root, work, chatId };
}

async function serve(store: string, h: ReplayHandle, clock: ManualClock, extra: { acpApprovalTimeoutMs?: number } = {}, repo: string | null = null): Promise<S1Server> {
  const server = await createRepoServer(repo, {
    webDist: undefined,
    userConfigDir: store,
    acpTurn: { clock, idleMs: IDLE, spawn: h.spawn, killGraceMs: 0 },
    ...extra,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

/**
 * One streamed turn. The replay is drained while the stream is read; `onEvent`
 * may act on an event (answer an approval, move the clock).
 */
async function turn(base: string, body: Json, h: ReplayHandle, onEvent: (e: Json) => Promise<void> | void = () => {}): Promise<Json[]> {
  const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ agentRef: 'codex', interactivePermissions: true, ...body }),
  });
  assert.strictEqual(res.status, 200);
  const events: Json[] = [];
  let done = false;
  const pump = (async () => {
    while (!done) {
      await h.drain();
      await new Promise((r) => setImmediate(r));
    }
  })();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const e = JSON.parse(line.slice(6)) as Json;
          events.push(e);
          await onEvent(e);
        }
      }
    }
  } finally {
    done = true;
    await pump;
  }
  return events;
}

const states = (events: Json[]): unknown[] => events.filter((e) => e.type === 'acp:turn').map((e) => e.state);

/** Keep the stream as a golden (sse-s1/) for web2's recovery tests; SEQUENCE_UPDATE_REPLAY=1 rewrites it. */
function golden(name: string, events: Json[], work: string): void {
  const dir = path.join(REPLAY_FIXTURES, 'sse-s1');
  const file = path.join(dir, `${name}.sse.jsonl`);
  const now = normalizeEvents(events, work).map((e) => JSON.stringify(e)).join('\n') + '\n';
  if (process.env.SEQUENCE_UPDATE_REPLAY === '1' || !fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, now);
  }
  assert.strictEqual(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), now, `the stream matches ${name}.sse.jsonl`);
}
const fixture = (dir: string, name: string) => readFixture(path.join(REPLAY_FIXTURES, dir, `${name}.jsonl`));

test('silent tool (live long-silent-tool): 20 s without output is not a hang; the turn ends when codex says so', async () => {
  const s = specimen();
  const clock = new ManualClock();
  const h = replaySpawn(fixture('codex', 'long-silent-tool'), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serve(s.store, h, clock);
  try {
    const events = await turn(srv.base, { prompt: 'run it', permissionMode: 'autoEdit', sessionKey: `chat::${s.chatId}::codex`, chatId: s.chatId }, h);
    assert.deepStrictEqual(h.replay.state.divergences, []);
    assert.deepStrictEqual(states(events), ['ended', 'settled'], 'ended by the agent, then settled; never hung');
    assert.ok(clock.now() >= 33_000, `the turn ran ${clock.now()} ms on the clock, with a 20 s silence inside it`);
    assert.match(String((events.find((e) => e.type === 'acp:result') as Json).text), /done waiting$/);
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('approval wait (live command-approval): ten idle periods waiting on a person is not a hang', async () => {
  const s = specimen();
  const clock = new ManualClock();
  const h = replaySpawn(fixture('codex', 'command-approval'), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serve(s.store, h, clock, { acpApprovalTimeoutMs: 24 * 60 * 60_000 });
  try {
    let waited = 0;
    const events = await turn(srv.base, { prompt: 'run it', permissionMode: 'propose', sessionKey: `chat::${s.chatId}::codex`, chatId: s.chatId }, h, async (e) => {
      if (e.type !== 'acp:permission' || e.pending !== true) return;
      const t0 = clock.now();
      clock.advance(10 * IDLE);
      waited = clock.now() - t0;
      const r = await fetch(`${srv.base}/api/acp/permission`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: e.requestId, decision: 'allow' }),
      });
      assert.strictEqual(r.status, 200);
    });
    assert.strictEqual(waited, 10 * IDLE);
    assert.deepStrictEqual(h.replay.state.divergences, []);
    assert.deepStrictEqual(states(events), ['ended', 'settled']);
    const settled = events.find((e) => e.type === 'acp:permission' && e.pending === false && e.requestId);
    assert.strictEqual(settled?.answeredBy, 'person', 'the person answered, not a timeout');
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('hung child (hung-after-start, not run live): no progress for idleMs is a hang; the turn stops and offers Retry', async () => {
  const s = specimen();
  const clock = new ManualClock();
  const h = replaySpawn(fixture('codex-s1', 'hung-after-start'), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serve(s.store, h, clock);
  try {
    let lastProgressAt = 0;
    const seen: Json[] = [];
    const events = await turn(srv.base, { prompt: 'Run the tests.', permissionMode: 'autoEdit', sessionKey: `chat::${s.chatId}::codex`, chatId: s.chatId }, h, async (e) => {
      seen.push(e);
      if (e.type === 'acp:update') {
        const kind = ((e.update as Json).update as Json).sessionUpdate;
        if (kind === 'tool_call') {
          lastProgressAt = clock.now();
          /* Let every recorded frame play (the heartbeat 2.5 s later too), then let time pass. */
          for (let i = 0; i < 50 && !h.replay.state.finished; i++) await h.drain();
          assert.strictEqual(h.replay.state.finished, true);
          clock.advanceTo(lastProgressAt + IDLE - 1);
          await new Promise((r) => setImmediate(r));
          assert.ok(!seen.some((x) => x.type === 'acp:turn'), 'not hung a millisecond early');
          clock.advanceTo(lastProgressAt + IDLE);
        }
      }
    });
    assert.deepStrictEqual(states(events), ['hung']);
    const hung = events.find((e) => e.type === 'acp:turn') as Json;
    assert.strictEqual(hung.idleMs, IDLE);
    const err = events.find((e) => e.type === 'acp:error') as Json;
    assert.ok(err, 'the turn failed');
    assert.deepStrictEqual(err.recovery, { kind: 'retry', cause: 'timeout' });
    assert.match(String(err.error), /no progress for 60 s/);
    assert.ok(!events.some((e) => e.type === 'acp:result'), 'no result was made up');
    golden('hung-after-start', events, s.work);
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('restart, then resume: a new server reopens the chat\'s codex thread with thread/resume (resume-after-restart, not run live)', async () => {
  const s = specimen();
  /* Before: the live long-silent-tool session, in this chat. */
  const clock1 = new ManualClock();
  const h1 = replaySpawn(fixture('codex', 'long-silent-tool'), { clock: clock1, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv1 = await serve(s.store, h1, clock1);
  const key = `chat::${s.chatId}::codex`;
  let first: Json[];
  try {
    first = await turn(srv1.base, { prompt: 'run it', permissionMode: 'autoEdit', sessionKey: key, chatId: s.chatId }, h1);
  } finally {
    await srv1.close();
  }
  assert.deepStrictEqual(first.find((e) => e.type === 'acp:session'), { type: 'acp:session', resumed: false, threadId: SILENT_TOOL_THREAD });
  assert.strictEqual(readAgentThread(s.root, s.chatId, 'codex')?.id, SILENT_TOOL_THREAD, 'the thread is on the chat');

  /* The app restarts: a new server, a new codex process, the same chat. */
  const clock2 = new ManualClock();
  const h2 = replaySpawn(fixture('codex-s1', 'resume-after-restart'), { clock: clock2, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv2 = await serve(s.store, h2, clock2);
  try {
    const events = await turn(srv2.base, { prompt: 'What did the command print?', permissionMode: 'autoEdit', sessionKey: key, chatId: s.chatId }, h2);
    assert.deepStrictEqual(h2.replay.state.divergences, [], 'thread/resume, not thread/start');
    const resume = h2.replay.received.find((m) => m.method === 'thread/resume') as Json;
    assert.strictEqual((resume.params as Json).threadId, SILENT_TOOL_THREAD);
    assert.deepStrictEqual(events.find((e) => e.type === 'acp:session'), { type: 'acp:session', resumed: true, threadId: SILENT_TOOL_THREAD });
    assert.strictEqual((events.find((e) => e.type === 'acp:result') as Json).text, 'It printed "done waiting".');
    assert.deepStrictEqual(states(events), ['ended', 'settled']);
    golden('resume-after-restart', events, s.work);
  } finally {
    await srv2.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('signed out (not run live): codex fails the turn as unauthorized, and the stream offers Sign in again for codex', async () => {
  const s = specimen();
  const clock = new ManualClock();
  const h = replaySpawn(fixture('codex-s1', 'signed-out'), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serve(s.store, h, clock);
  try {
    const events = await turn(srv.base, { prompt: 'Summarise the repo.', permissionMode: 'autoEdit', sessionKey: `chat::${s.chatId}::codex`, chatId: s.chatId }, h);
    assert.deepStrictEqual(h.replay.state.divergences, []);
    const err = events.find((e) => e.type === 'acp:error') as Json;
    assert.deepStrictEqual(err.recovery, { kind: 'signIn', cause: 'signedOut', provider: 'codex' });
    assert.match(String(err.error), /401 Unauthorized/);
    assert.deepStrictEqual(states(events), [], 'a failed turn neither ended nor settled');
    golden('signed-out', events, s.work);
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

/* ── S3 in the codex bridge: turn snapshots, in-process ──────────────────── */

const SHOPFRONT = path.resolve(REPLAY_FIXTURES, '..', '..', '..', '..', '..', 'analyzer', 'test', 'fixtures', 'shopfront');

/** The recordings were made against a CRLF checkout (Windows autocrlf): codex's diff names the pre-image blob
    88ae924, which is main.py with CRLF endings. A Linux checkout has LF (blob b37cf10), so the patch would not
    apply. Pin the bytes the recording started from, on every platform. */
function pinRecordedLineEndings(root: string): void {
  const main = path.join(root, 'orders', 'app', 'main.py');
  fs.writeFileSync(main, Buffer.from(fs.readFileSync(main, 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8'));
}

/** A temp git repository (shopfront, one commit) attached to the server, and a user store beside it. */
function attachedSpecimen(): { dir: string; store: string; repo: string; chatId: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s3b-')));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  pinRecordedLineEndings(repo);
  const id = ['-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false'];
  const run = (args: string[]) => execFileSync('git', args, { cwd: repo, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  run(['init', '-q', '-b', 'main']);
  run([...id, 'add', '-A']);
  run([...id, 'commit', '-q', '-m', 'user history']);
  const store = path.join(dir, 'user', '.sequence');
  fs.mkdirSync(store, { recursive: true });
  addAgent(store, { id: 'codex', command: 'codex', cwd: repo });
  const chatId = ensureSessionsMigrated(repo).activeId;
  return { dir, store, repo, chatId };
}

/** The codex recordings were made on Windows: a changed file is `<CWD>\\orders\\app\\main.py` in them. Replayed on POSIX that is one file name
    with backslashes in it, beside the repository rather than inside it, and the change is never tracked. Spell the
    recorded paths with this platform's separator; a no-op on Windows. */
function withNativePaths<T>(recorded: T): T {
  if (path.sep === '\\') return recorded;
  return JSON.parse(JSON.stringify(recorded), (_k, v) => (typeof v === 'string' && v.startsWith('<CWD>\\') ? v.replace(/\\/g, '/') : v)) as T;
}

const recordedTurnId = (name: string): string =>
  String(((fixture('codex', name).frames.find((f) => f.msg.method === 'turn/started')!.msg.params as Json).turn as Json).id);

test('S3 bridge (live edit-with-plan): turn/started snapshots the tree, the file change and the turn diff are tracked on this chat, in-process', async () => {
  const s = attachedSpecimen();
  const clock = new ManualClock();
  const h = replaySpawn(withNativePaths(fixture('codex', 'edit-with-plan')), { clock, values: { '<CWD>': s.repo, '<HOME>': os.homedir() } });
  const srv = await serve(s.store, h, clock, {}, s.repo);
  try {
    const events = await turn(srv.base, { prompt: 'edit', permissionMode: 'autoEdit', sessionKey: `chat::${s.chatId}::codex`, chatId: s.chatId }, h);
    assert.deepStrictEqual(h.replay.state.divergences, []);
    assert.deepStrictEqual(states(events), ['ended', 'settled']);
    const snaps = readSession(s.repo, s.chatId);
    assert.strictEqual(snaps.turns.length, 1, 'one turn, begun at turn/started');
    assert.strictEqual(snaps.turns[0]!.turnId, recordedTurnId('edit-with-plan'));
    assert.match(snaps.turns[0]!.tree, /^[0-9a-f]{40}$/);
    assert.ok(snaps.turns[0]!.files.includes('NOTES.md'), `the file change was tracked: ${JSON.stringify(snaps.turns[0]!.files)}`);
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('S3 bridge (live file-approval-denied): the file change is tracked before the person is asked', async () => {
  const s = attachedSpecimen();
  const clock = new ManualClock();
  const h = replaySpawn(withNativePaths(fixture('codex', 'file-approval-denied')), { clock, values: { '<CWD>': s.repo, '<HOME>': os.homedir() } });
  const srv = await serve(s.store, h, clock, {}, s.repo);
  try {
    let trackedWhenAsked: string[] | null = null;
    await turn(srv.base, { prompt: 'write', permissionMode: 'propose', sessionKey: `chat::${s.chatId}::codex`, chatId: s.chatId }, h, async (e) => {
      if (e.type !== 'acp:permission' || e.pending !== true) return;
      trackedWhenAsked = readSession(s.repo, s.chatId).turns.at(-1)?.files ?? [];
      await fetch(`${srv.base}/api/acp/permission`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: e.requestId, decision: 'deny' }) });
    });
    assert.deepStrictEqual(h.replay.state.divergences, []);
    assert.deepStrictEqual(trackedWhenAsked, ['hello.txt']);
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});
