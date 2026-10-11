import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ManualClock } from '@sequence/acp/dist/replay/clock.js';

import { createRepoServer } from '../server/repoServer.js';
import { IdleWarmer, TurnSnapshotGate, type SnapshotOps } from '../server/turnSnapshotGate.js';

/* S2b, first item: the turn-start snapshot never delays a turn.

   The snapshot is replaced by a FAKE SLOW one that resolves 2 s after it is
   called, on a ManualClock (no wall time passes). Claude Code's hooks reach
   the real server: UserPromptSubmit (the turn starts), PreToolUse for an
   Edit (a write) and for a Read. Nothing here sleeps; "answered" means the
   HTTP reply arrived while the fake clock still stood where it was.

   The control is the old synchronous path (`blockTurnStart`): the same
   prompt hook is NOT answered until the clock moves 2 s. */

const SNAPSHOT_MS = 2000;

function slowSnapshots(clock: ManualClock): SnapshotOps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    beginTurn: (_root, sid) => {
      calls.push(`begin ${sid} @${clock.now()}`);
      return new Promise((r) => clock.setTimeout(() => {
        calls.push(`begun ${sid} @${clock.now()}`);
        r(undefined);
      }, SNAPSHOT_MS));
    },
    trackWrites: async (_root, sid, paths) => {
      calls.push(`track ${sid} ${paths.join(',')} @${clock.now()}`);
      return paths;
    },
  };
}

function post(port: number, body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method: 'POST', path: '/api/agent-event', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/** Is the promise settled after the event loop has had a fair chance (no wall-clock wait)? */
async function settledSoon<T>(p: Promise<T>): Promise<boolean> {
  let done = false;
  p.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; i < 200 && !done; i++) await new Promise((r) => setImmediate(r));
  return done;
}

async function server(root: string, ops: SnapshotOps) {
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-gate-cfg-')));
  const srv = await createRepoServer(root, { webDist: undefined, userConfigDir, snapshotOps: ops });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const addr = srv.address();
  return {
    port: typeof addr === 'object' && addr ? addr.port : 0,
    close: () =>
      new Promise<void>((r) => {
        srv.close(() => r());
        (srv as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
        fs.rmSync(userConfigDir, { recursive: true, force: true });
      }),
  };
}

function repo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-gate-')));
  fs.writeFileSync(path.join(root, 'a.ts'), 'a\n');
  fs.writeFileSync(path.join(root, 'b.ts'), 'b\n');
  return root;
}

test('through the server: the prompt is answered at once while a 2 s snapshot runs; the first Edit waits for it, a Read does not', async () => {
  const root = repo();
  const clock = new ManualClock();
  const ops = slowSnapshots(clock);
  const srv = await server(root, ops);
  try {
    const hook = (name: string, extra: Record<string, unknown> = {}) => post(srv.port, { hook_event_name: name, session_id: 'claude-1', cwd: root, ...extra });
    /* Turn start: answered with the clock standing still, the snapshot still running. */
    const started = hook('UserPromptSubmit', { prompt: 'edit a' });
    assert.equal(await settledSoon(started), true, 'the prompt is not held by the snapshot');
    assert.equal(await started, 200);
    assert.deepEqual(ops.calls, ['begin claude-1 @0']);

    /* A read during the snapshot: not held. */
    const read = hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: path.join(root, 'b.ts') }, tool_use_id: 'r1' });
    assert.equal(await settledSoon(read), true, 'a read never waits');

    /* The first write: held until the snapshot is done. */
    const write = hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: path.join(root, 'a.ts') }, tool_use_id: 'w1' });
    assert.equal(await settledSoon(write), false, 'the first write waits for the snapshot');
    clock.advance(SNAPSHOT_MS - 1);
    assert.equal(await settledSoon(write), false, 'still waiting a millisecond before');
    clock.advance(1);
    assert.equal(await settledSoon(write), true);
    assert.deepEqual(ops.calls, ['begin claude-1 @0', `begun claude-1 @${SNAPSHOT_MS}`, `track claude-1 a.ts @${SNAPSHOT_MS}`]);

    /* A later write in the same turn goes straight through. */
    const second = hook('PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'c.ts') }, tool_use_id: 'w2' });
    assert.equal(await settledSoon(second), true, 'later writes are not held');
  } finally {
    await srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('control: the old synchronous path (await the snapshot at turn start) holds the prompt for the whole 2 s', async () => {
  const clock = new ManualClock();
  const ops = slowSnapshots(clock);
  const old = new TurnSnapshotGate(ops, { blockTurnStart: true });
  const now = new TurnSnapshotGate(slowSnapshots(clock));
  const oldStart = old.startTurn('/r', 'claude-1');
  assert.equal(await settledSoon(now.startTurn('/r', 'claude-2')), true, 'the gate: no delay');
  assert.equal(await settledSoon(oldStart), false, 'the old path: the turn waits for the snapshot');
  clock.advance(SNAPSHOT_MS);
  assert.equal(await settledSoon(oldStart), true);
});

test('the idle warm-up: runs after a project opens when nothing is running, and waits while a turn runs', async () => {
  const clock = new ManualClock();
  let busy = true;
  const warmed: string[] = [];
  const w = new IdleWarmer(async (root) => void warmed.push(`${root}@${clock.now()}`), () => busy, { delayMs: 1500, retryMs: 5000, clock });
  w.schedule('/repo');
  w.schedule('/repo');
  clock.advance(1500);
  assert.deepEqual(warmed, [], 'a turn is running: not now');
  busy = false;
  clock.advance(4999);
  assert.deepEqual(warmed, []);
  clock.advance(1);
  assert.deepEqual(warmed, ['/repo@6500'], 'once, when idle');
  w.schedule('/repo');
  clock.advance(60_000);
  assert.deepEqual(warmed, ['/repo@6500'], 'one warm per repository');
});

test('settled() waits for every turn-start snapshot and the shadow work queued for its repo (shutdown waits on it)', async () => {
  let finishSnap!: () => void;
  let finishIdle!: () => void;
  const idled: string[] = [];
  const gate = new TurnSnapshotGate({
    beginTurn: () => new Promise<void>((r) => (finishSnap = r)),
    trackWrites: async () => undefined,
    idle: (root) => {
      idled.push(root);
      return new Promise<void>((r) => (finishIdle = r));
    },
  });
  await gate.startTurn('/repo', 's1');
  let done = false;
  const settled = gate.settled().then(() => (done = true));
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false, 'not while the snapshot runs');
  finishSnap();
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false, 'not while queued shadow work runs');
  finishIdle();
  await settled;
  assert.deepEqual(idled, ['/repo']);
  /* Nothing started: settled at once. */
  await new TurnSnapshotGate({ beginTurn: async () => undefined, trackWrites: async () => undefined }).settled();
});
