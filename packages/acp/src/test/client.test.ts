import assert from 'node:assert';
import { test } from 'node:test';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpClient } from '../client.js';
import type { SessionNotification } from '@agentclientprotocol/sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/test -> dist -> <package root>; the fixture lives in the source tree
// (a standalone .mjs that tsc does not compile), run directly by node.
const PKG_ROOT = path.resolve(here, '..', '..');
const MOCK_AGENT = path.join(PKG_ROOT, 'src', 'test', 'fixtures', 'mock-agent.mjs');

/** Build a real AcpClient wired to the mock agent subprocess; capture its child. */
function makeClient(overrides: {
  onUpdate?: (n: SessionNotification) => void;
  onPermission?: (req: unknown) => 'allow' | 'deny';
} = {}): { client: AcpClient; getChild: () => childProcess.ChildProcess | undefined } {
  let child: childProcess.ChildProcess | undefined;
  const client = new AcpClient({
    command: process.execPath, // node
    args: [MOCK_AGENT],
    killGraceMs: 500,
    spawn: ((cmd: string, args: readonly string[], opts: object) => {
      child = childProcess.spawn(cmd, args as string[], opts);
      return child;
    }) as unknown as typeof childProcess.spawn,
    ...(overrides.onUpdate ? { onUpdate: overrides.onUpdate } : {}),
    ...(overrides.onPermission
      ? { onPermission: overrides.onPermission as never }
      : {}),
  });
  return { client, getChild: () => child };
}

test('initialize + newSession + prompt round-trips real text and stopReason', async () => {
  const { client } = makeClient();
  try {
    await client.start();
    const sid = await client.newSession();
    assert.match(sid, /mock-session-/);
    const res = await client.prompt('hello world');
    assert.strictEqual(res.stopReason, 'end_turn');
    assert.ok(res.text.includes('echo:'), `expected echo in text, got: ${res.text}`);
    assert.ok(res.text.includes('hello world'), `expected prompt echoed, got: ${res.text}`);
  } finally {
    await client.dispose();
  }
});

test('streaming session/update notifications are observed', async () => {
  const updates: SessionNotification[] = [];
  const { client } = makeClient({ onUpdate: (n) => updates.push(n) });
  try {
    await client.start();
    await client.prompt('stream me');
    const chunks = updates.filter(
      (u) => u.update.sessionUpdate === 'agent_message_chunk'
    );
    assert.ok(chunks.length >= 2, `expected >=2 streamed chunks, got ${chunks.length}`);
  } finally {
    await client.dispose();
  }
});

test('a second prompt reuses the same ACP session', async () => {
  const { client } = makeClient();
  try {
    await client.start();
    const sid = await client.newSession();
    const first = await client.prompt('one');
    const second = await client.prompt('two');
    // The session id is stable across turns...
    assert.strictEqual(client.currentSessionId, sid);
    // ...and the agent handled BOTH turns on that same session (sid=... in text).
    assert.ok(first.text.includes(`sid=${sid}`), `1st turn wrong session: ${first.text}`);
    assert.ok(second.text.includes(`sid=${sid}`), `2nd turn wrong session: ${second.text}`);
  } finally {
    await client.dispose();
  }
});

test('abort mid-turn cancels the turn AND kills the child with no further billed output', async () => {
  const seen: string[] = [];
  const { client, getChild } = makeClient({
    onUpdate: (n) => {
      const u = n.update;
      if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text') {
        seen.push(u.content.text);
      }
    },
  });
  const ac = new AbortController();
  try {
    await client.start();
    await client.newSession();
    // Kick off a SLOW turn; abort as soon as the first chunk lands.
    const firstChunk = new Promise<void>((resolve) => {
      const iv = setInterval(() => {
        if (seen.some((t) => t.includes('working...'))) {
          clearInterval(iv);
          resolve();
        }
      }, 20);
    });
    const turn = client.prompt('please be SLOW', { signal: ac.signal });
    await firstChunk;
    ac.abort();
    const res = await turn;
    assert.strictEqual(res.stopReason, 'cancelled', 'aborted turn must report cancelled');
    // The would-be second, billed chunk must NEVER have arrived.
    assert.ok(
      !seen.some((t) => t.includes('MORE_BILLED')),
      `cancel must stop further output, saw: ${JSON.stringify(seen)}`
    );

    await client.dispose();
    const child = getChild();
    assert.ok(child, 'child should have been spawned');
    assert.ok(
      child!.exitCode !== null || child!.signalCode !== null,
      'the agent subprocess must be dead after dispose (no orphan)'
    );
  } finally {
    await client.dispose();
  }
});

test('concurrent prompt() calls on one client SERIALIZE — no interleave / no state corruption', async () => {
  const { client } = makeClient();
  try {
    await client.start();
    await client.newSession();
    // Fire two turns WITHOUT awaiting the first: without the per-client turn queue
    // these would share `turnText`/`sessionId` and corrupt each other.
    const [r1, r2] = await Promise.all([client.prompt('one'), client.prompt('two')]);
    assert.strictEqual(r1.stopReason, 'end_turn');
    assert.strictEqual(r2.stopReason, 'end_turn');
    // Each turn captured ONLY its own echoed text — proof there was no interleave.
    assert.ok(r1.text.includes('one'), `turn 1 kept its own text: ${r1.text}`);
    assert.ok(!r1.text.includes('two'), `turn 1 was NOT contaminated by turn 2: ${r1.text}`);
    assert.ok(r2.text.includes('two'), `turn 2 kept its own text: ${r2.text}`);
    assert.ok(!r2.text.includes('one'), `turn 2 was NOT contaminated by turn 1: ${r2.text}`);
  } finally {
    await client.dispose();
  }
});

test('a turn QUEUED behind another and aborted before it starts reports cancelled (no fabricated done)', async () => {
  const { client } = makeClient();
  try {
    await client.start();
    await client.newSession();
    const ac = new AbortController();
    const p1 = client.prompt('first'); // runs immediately (front of the queue)
    const p2 = client.prompt('second', { signal: ac.signal }); // queued behind p1
    ac.abort(); // abort BEFORE p2's turn starts
    const [r1, r2] = await Promise.all([p1, p2]);
    // p1 completed honestly and was not disturbed by the aborted successor.
    assert.strictEqual(r1.stopReason, 'end_turn');
    assert.ok(r1.text.includes('first'), `turn 1 completed cleanly: ${r1.text}`);
    // p2 was cancelled while still queued — a real cancelled, never a fabricated done.
    assert.strictEqual(r2.stopReason, 'cancelled', 'the queued, aborted turn is honestly cancelled');
    assert.ok(!r2.text.includes('echo:'), `the queued turn never produced an answer: ${r2.text}`);
  } finally {
    await client.dispose();
  }
});

test('a refused turn surfaces its real stopReason (not a fabricated done)', async () => {
  const { client } = makeClient();
  try {
    await client.start();
    const res = await client.prompt('please REFUSE this');
    assert.strictEqual(res.stopReason, 'refusal');
  } finally {
    await client.dispose();
  }
});

test('the conservative default permission policy DENIES a write tool call', async () => {
  const { client } = makeClient(); // no onPermission -> conservative default
  try {
    await client.start();
    const res = await client.prompt('do a PERMISSION write');
    assert.strictEqual(res.stopReason, 'end_turn');
    assert.ok(
      res.text.includes('permission=reject-1'),
      `default policy should deny the edit, got: ${res.text}`
    );
  } finally {
    await client.dispose();
  }
});

test('an explicit allow policy permits the write tool call', async () => {
  const { client } = makeClient({ onPermission: () => 'allow' });
  try {
    await client.start();
    const res = await client.prompt('do a PERMISSION write');
    assert.ok(
      res.text.includes('permission=allow-1'),
      `explicit allow should select allow option, got: ${res.text}`
    );
  } finally {
    await client.dispose();
  }
});

test('injected fake spawn: dispose escalates SIGTERM -> SIGKILL (no real process)', async () => {
  const signals: string[] = [];
  const fakeChild = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    exitCode: number | null;
    signalCode: string | null;
    kill: (sig?: string) => boolean;
  };
  fakeChild.stdin = new PassThrough();
  fakeChild.stdout = new PassThrough();
  fakeChild.exitCode = null;
  fakeChild.signalCode = null;
  fakeChild.kill = (sig?: string): boolean => {
    signals.push(sig ?? 'SIGTERM');
    // Ignore SIGTERM (simulate a wedged agent); die only on SIGKILL.
    if (sig === 'SIGKILL') {
      fakeChild.signalCode = 'SIGKILL';
      fakeChild.emit('exit', null, 'SIGKILL');
    }
    return true;
  };

  const client = new AcpClient({
    command: 'fake-agent',
    args: ['--x'],
    killGraceMs: 30,
    spawn: (() => fakeChild) as unknown as typeof childProcess.spawn,
  });

  // start() spawns synchronously (child captured) then hangs on initialize since
  // the fake never answers — don't await it.
  const starting = client.start();
  starting.catch(() => {});
  // Let the microtasks settle so start() reaches the initialize await.
  await new Promise((r) => setTimeout(r, 10));

  await client.dispose();
  assert.deepStrictEqual(signals, ['SIGTERM', 'SIGKILL'], 'must escalate SIGTERM then SIGKILL');
});
