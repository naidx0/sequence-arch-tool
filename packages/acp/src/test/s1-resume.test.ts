/**
 * S1 IN THE ADAPTERS: THE IDLE WATCHDOG, RESUMING A SESSION, AND WHAT A
 * FAILED TURN OFFERS.
 *
 * The watchdog runs on a ManualClock. Codex resume and the hung child are
 * replays of fixtures built from codex's own protocol types (not run live,
 * codex-s1/); ACP resume and load run against the conformant mock agent.
 * Nothing here sleeps.
 */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { SessionNotification } from '@agentclientprotocol/sdk';

import { AcpClient, ResumeUnavailableError } from '../client.js';
import { CodexAppServerClient } from '../codexAppServer.js';
import { AgentTurnError, TurnHungError, recoveryFor } from '../recovery.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn } from '../replay/codexReplay.js';
import { readFixture, type Json } from '../replay/fixture.js';
import { SILENT_TOOL_THREAD } from '../replay/codexS1Fixtures.js';
import { TurnWatchdog, isAcpProgress, isCodexProgress } from '../turnWatchdog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, '..', '..');
const S1 = path.join(PKG_ROOT, 'src', 'test', 'fixtures', 'replay', 'codex-s1');
const MOCK_AGENT = path.join(PKG_ROOT, 'src', 'test', 'fixtures', 'mock-agent.mjs');

async function driven<T>(drain: () => Promise<void>, step: Promise<T>): Promise<T> {
  let done = false;
  let value: T | undefined;
  let error: unknown;
  step.then(
    (v) => ((done = true), (value = v)),
    (e) => ((done = true), (error = e)),
  );
  for (let i = 0; i < 1000 && !done; i++) await drain();
  if (!done) throw new Error('the adapter did not settle while the replay drained');
  if (error) throw error;
  return value as T;
}

/* ── the watchdog ───────────────────────────────────────────────────────── */

test('watchdog: a silence shorter than idleMs is not a hang, however long the turn runs', () => {
  const clock = new ManualClock();
  const hung: number[] = [];
  const w = new TurnWatchdog({ idleMs: 60_000, clock, onHung: (ms) => hung.push(ms) });
  /* An hour of work, progress every 59 s: no wall-clock cap. */
  for (let i = 0; i < 61; i++) {
    clock.advance(59_000);
    w.progress();
  }
  assert.deepEqual(hung, []);
  assert.equal(w.state, 'running');
  w.stop();
  clock.advance(10 * 60_000);
  assert.deepEqual(hung, [], 'a stopped watchdog never fires');
});

test('watchdog: no progress for idleMs is a hang, reported once', () => {
  const clock = new ManualClock();
  const hung: number[] = [];
  const w = new TurnWatchdog({ idleMs: 60_000, clock, onHung: (ms) => hung.push(ms) });
  clock.advance(59_999);
  assert.deepEqual(hung, []);
  clock.advance(1);
  assert.deepEqual(hung, [60_000]);
  assert.equal(w.state, 'hung');
  w.progress();
  clock.advance(120_000);
  assert.deepEqual(hung, [60_000], 'progress after a hang does not re-arm it');
});

test('watchdog: paused while a person is asked, however long; the countdown restarts when the last answer comes', () => {
  const clock = new ManualClock();
  const hung: number[] = [];
  const w = new TurnWatchdog({ idleMs: 60_000, clock, onHung: (ms) => hung.push(ms) });
  clock.advance(50_000);
  const a = w.pause();
  const b = w.pause();
  assert.equal(w.state, 'paused');
  clock.advance(10 * 60 * 60_000);
  a();
  a();
  clock.advance(10 * 60_000);
  assert.deepEqual(hung, [], 'one approval still open: still paused');
  b();
  assert.equal(w.state, 'running');
  clock.advance(59_999);
  assert.deepEqual(hung, [], 'a fresh countdown, not the 50 s spent before the question');
  clock.advance(1);
  assert.deepEqual(hung, [60_000]);
});

test('progress and heartbeats: what counts', () => {
  for (const k of ['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan']) assert.equal(isAcpProgress(k), true, k);
  for (const k of ['available_commands_update', 'current_mode_update', 'usage_update', 'config_option_update', 'session_info_update']) assert.equal(isAcpProgress(k), false, k);
  for (const m of ['item/agentMessage/delta', 'item/started', 'item/commandExecution/outputDelta', 'turn/plan/updated', 'turn/completed']) assert.equal(isCodexProgress(m), true, m);
  for (const m of ['thread/tokenUsage/updated', 'account/rateLimits/updated', 'thread/status/changed', 'mcpServer/startupStatus/updated', 'warning']) assert.equal(isCodexProgress(m), false, m);
});

/* ── recovery ───────────────────────────────────────────────────────────── */

test('recovery: signed out, not installed, and everything else is a retry', () => {
  assert.equal(recoveryFor(new AgentTurnError('codex turn failed: 401', 'unauthorized')), 'signIn');
  assert.equal(recoveryFor(Object.assign(new Error('Authentication required'), { code: -32000 })), 'signIn');
  assert.equal(recoveryFor(new Error('Not logged in. Run codex login.')), 'signIn');
  assert.equal(recoveryFor(Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' })), 'install');
  assert.equal(recoveryFor(new TurnHungError(60_000)), 'retry');
  assert.equal(recoveryFor(new AgentTurnError('codex turn failed: slow down', 'rateLimitExceeded')), 'retry');
  assert.equal(recoveryFor(new Error('codex app-server exited (code=1 signal=null)')), 'retry');
});

/* ── codex: thread/resume, and a child that hangs (not run live) ─────────── */

test('codex resume-after-restart (not run live): a new process rejoins the thread with thread/resume, history excluded, and the turn runs on it', async () => {
  const fixture = readFixture(path.join(S1, 'resume-after-restart.jsonl'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s1-resume-'));
  const clock = new ManualClock();
  const h = replaySpawn(fixture, { clock, values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  let progress = 0;
  const client = new CodexAppServerClient({ command: 'codex', cwd, accessMode: 'autoEdit', spawn: h.spawn, onProgress: () => (progress += 1) });
  try {
    await driven(() => h.drain(), client.start());
    const id = await driven(() => h.drain(), client.resumeSession(SILENT_TOOL_THREAD, cwd));
    assert.equal(id, SILENT_TOOL_THREAD);
    const sent = h.replay.received.find((m) => m.method === 'thread/resume') as Json;
    assert.deepEqual((sent.params as Json).threadId, SILENT_TOOL_THREAD);
    assert.equal((sent.params as Json).excludeTurns, true);
    assert.equal(h.replay.received.some((m) => m.method === 'thread/start'), false, 'no new thread');
    const r = await driven(() => h.drain(), client.prompt('What did the command print?'));
    assert.equal(r.stopReason, 'end_turn');
    assert.equal(r.text, 'It printed "done waiting".');
    assert.equal(((h.replay.received.find((m) => m.method === 'turn/start') as Json).params as Json).threadId, SILENT_TOOL_THREAD);
    assert.deepEqual(h.replay.state.divergences, []);
    assert.ok(progress >= 2, 'the turn events fed the watchdog');
  } finally {
    await client.dispose();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('codex hung-after-start (not run live): after the last progress only a heartbeat comes, and the turn never ends on its own', async () => {
  const fixture = readFixture(path.join(S1, 'hung-after-start.jsonl'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s1-hung-'));
  const clock = new ManualClock();
  const h = replaySpawn(fixture, { clock, values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  const hung: number[] = [];
  let w: TurnWatchdog | null = null;
  let lastProgressAt = -1;
  const client = new CodexAppServerClient({
    command: 'codex',
    cwd,
    accessMode: 'autoEdit',
    spawn: h.spawn,
    killGraceMs: 0,
    onProgress: () => {
      lastProgressAt = clock.now();
      w?.progress();
    },
  });
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(cwd));
    w = new TurnWatchdog({ idleMs: 60_000, clock, onHung: (ms) => hung.push(ms) });
    let settled = false;
    const turn = client.prompt('Run the tests.').then(
      () => (settled = true),
      () => (settled = true),
    );
    await h.drain();
    assert.equal(h.replay.state.finished, true, 'every recorded frame played');
    assert.equal(settled, false, 'the agent never ended the turn');
    /* The last progress was the command starting; the heartbeat 2.5 s later did not reset the countdown. */
    assert.ok(lastProgressAt > 0 && clock.now() - lastProgressAt === 2500, `heartbeat ${clock.now()} after progress ${lastProgressAt}`);
    clock.advanceTo(lastProgressAt + 60_000 - 1);
    assert.deepEqual(hung, []);
    clock.advanceTo(lastProgressAt + 60_000);
    assert.deepEqual(hung, [60_000]);
    await client.dispose();
    await turn;
    assert.equal(settled, true, 'disposing the hung child ends the turn');
  } finally {
    await client.dispose();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

/* ── ACP: session/resume, session/load behind the replay gate ───────────── */

function mockClient(env: Record<string, string>, updates: SessionNotification[]): AcpClient {
  return new AcpClient({
    command: process.execPath,
    args: [MOCK_AGENT],
    killGraceMs: 500,
    env: { ...process.env, ...env },
    spawn: childProcess.spawn,
    onUpdate: (n) => updates.push(n),
  });
}

test('ACP session/load: the replayed history is held back, never shown as this turn, and the turn runs on the old session', async () => {
  const updates: SessionNotification[] = [];
  const client = mockClient({ MOCK_AGENT_LOAD: '1' }, updates);
  try {
    await client.start();
    const id = await client.resumeSession('mock-session-old');
    assert.equal(id, 'mock-session-old');
    assert.equal(client.heldReplay, 2, 'both history notifications were held');
    assert.equal(updates.length, 0);
    const r = await client.prompt('hello again');
    assert.match(r.text, /^sid=mock-session-old;/);
    assert.doesNotMatch(r.text, /history/);
  } finally {
    await client.dispose();
  }
});

test('ACP session/resume: preferred over load, nothing replayed', async () => {
  const updates: SessionNotification[] = [];
  const client = mockClient({ MOCK_AGENT_LOAD: '1', MOCK_AGENT_RESUME: '1' }, updates);
  try {
    await client.start();
    await client.resumeSession('mock-session-old');
    assert.equal(client.heldReplay, 0);
    const r = await client.prompt('hi');
    assert.match(r.text, /^sid=mock-session-old;/);
  } finally {
    await client.dispose();
  }
});

test('ACP without resume or load: ResumeUnavailableError, so the caller opens a new session and says so', async () => {
  const client = mockClient({}, []);
  try {
    await client.start();
    await assert.rejects(client.resumeSession('mock-session-old'), ResumeUnavailableError);
  } finally {
    await client.dispose();
  }
});
