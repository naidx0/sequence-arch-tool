/**
 * RECORDED SESSIONS, REPLAYED THROUGH THE REAL ADAPTERS, ON A FAKE CLOCK.
 *
 * Only the agent process is replaced (src/replay/codexReplay.ts). The
 * CodexAppServerClient and AcpClient under test are the shipping ones; the
 * frames they read are what a real codex-cli 0.153.4 sent (fixtures/replay/
 * codex, recorded once), or, for Claude and for codex's todo list, frames
 * built from the protocol's own types (labelled "not run live").
 *
 * A faithful replay is one with no divergences: the adapter sent every
 * message the recording has, in order, and answered every approval the way
 * the recording did. Tests drain the replay; none of them sleeps.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AcpClient } from '../client.js';
import { CodexAppServerClient } from '../codexAppServer.js';
import { CODEX_TRANSLATED } from '../codexUpdates.js';
import type { AgentMode } from '../planMode.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn } from '../replay/codexReplay.js';
import { formatFixture, readFixture, substitute, substituteDeltas, type Fixture, type Json } from '../replay/fixture.js';
import { syntheticFiles } from '../replay/bin/make-synthetic-fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', 'src', 'test', 'fixtures', 'replay');
const CODEX = path.join(ROOT, 'codex');
const CLAUDE = path.join(ROOT, 'claude');
const fixturesIn = (dir: string): string[] => fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();

interface Played {
  fixture: Fixture;
  result: { stopReason: string; text: string };
  updates: { at: number; update: Json }[];
  permissions: Json[];
  divergences: string[];
  finished: boolean;
  wallMs: number;
  /** The directory the replay ran in (<CWD>). */
  cwd: string;
}

/** Drive `step` while draining the replay, until `step` settles. */
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

async function playCodex(file: string): Promise<Played> {
  const fixture = readFixture(file);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-replay-'));
  const clock = new ManualClock();
  const h = replaySpawn(fixture, { clock, values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  const updates: Played['updates'] = [];
  const permissions: Json[] = [];
  const answers = [...(fixture.header.answers ?? [])];
  const client = new CodexAppServerClient({
    command: 'codex',
    args: [],
    cwd,
    accessMode: (fixture.header.accessMode ?? 'propose') as AgentMode,
    spawn: h.spawn,
    onUpdate: (n) => updates.push({ at: clock.now(), update: n.update as unknown as Json }),
    onPermission: async (r) => {
      permissions.push(r as unknown as Json);
      return answers.shift() ?? 'deny';
    },
  });
  const t0 = Date.now();
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(cwd));
    const result = await driven(() => h.drain(), client.prompt(fixture.header.prompt ?? 'replay'));
    await h.drain();
    const s = h.replay.state;
    return { fixture, result, updates, permissions, divergences: s.divergences, finished: s.finished, wallMs: Date.now() - t0, cwd };
  } finally {
    await client.dispose();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

/** The answer text the frames carry, read independently of the adapter. */
function recordedText(f: Fixture): string {
  let text = '';
  const streamed = new Set<string>();
  for (const fr of f.frames) {
    if (fr.dir !== 's2c') continue;
    const p = (fr.msg.params ?? {}) as Json;
    if (fr.msg.method === 'item/agentMessage/delta') {
      text += String(p.delta ?? '');
      streamed.add(String(p.itemId));
    }
    const item = p.item as Json | undefined;
    if (fr.msg.method === 'item/completed' && item?.type === 'agentMessage' && !streamed.has(String(item.id))) text += String(item.text ?? '');
  }
  return text;
}

const itemsOf = (f: Fixture, method: string, types: string[]): Json[] =>
  f.frames.filter((fr) => fr.dir === 's2c' && fr.msg.method === method && types.includes(String(((fr.msg.params as Json)?.item as Json)?.type))).map((fr) => fr.msg);

/* ── the engine, on a recording of the fake codex (the control) ─────────── */

test('control: the fake codex recording replays faithfully through the real adapter', async () => {
  const p = await playCodex(path.join(ROOT, 'fake', 'fake-file-approval.jsonl'));
  assert.deepEqual(p.divergences, []);
  assert.equal(p.finished, true);
  assert.equal(p.result.text, 'The edit was declined, so hello.txt was not created.');
  assert.equal(p.permissions.length, 1);
});

test('control: an answer the recording did not give is a divergence, and the replay stops', async () => {
  const fixture = readFixture(path.join(ROOT, 'fake', 'fake-file-approval.jsonl'));
  const flipped: Fixture = { ...fixture, header: { ...fixture.header, answers: ['allow'] } };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-replay-flip-'));
  const file = path.join(dir, 'flipped.jsonl');
  fs.writeFileSync(file, formatFixture(flipped));
  const again = readFixture(file);
  const clock = new ManualClock();
  const h = replaySpawn(again, { clock, values: { '<CWD>': dir } });
  const client = new CodexAppServerClient({ command: 'codex', cwd: dir, accessMode: 'propose', spawn: h.spawn, onPermission: async () => 'allow' as const });
  await driven(() => h.drain(), client.start());
  await driven(() => h.drain(), client.newSession(dir));
  void client.prompt('x').catch(() => {});
  await h.drain();
  await h.drain();
  assert.match(h.replay.divergences.join('\n'), /the recording answered request \d+ with decline, the client answered accept/);
  assert.equal(h.replay.state.finished, false);
  await client.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ── every recorded codex session ───────────────────────────────────────── */

for (const name of fixturesIn(CODEX)) {
  const live = readFixture(path.join(CODEX, name)).header.live;
  test(`codex ${name.replace('.jsonl', '')}${live ? '' : ' (not run live)'}: replays faithfully; text, tool calls and approvals reach the adapter's caller`, async () => {
    const p = await playCodex(path.join(CODEX, name));
    assert.deepEqual(p.divergences, [], 'the adapter spoke as it did against the agent');
    assert.equal(p.finished, true, 'every recorded frame played');
    assert.equal(p.result.stopReason, 'end_turn');
    assert.equal(p.result.text, substitute(recordedText(p.fixture), [['<CWD>', p.cwd]]));
    const approvals = p.fixture.frames.filter((f) => f.dir === 's2c' && /requestApproval$/.test(String(f.msg.method)));
    assert.equal(p.permissions.length, approvals.length, 'one permission request per recorded approval');
    const tools = itemsOf(p.fixture, 'item/started', ['fileChange', 'commandExecution']);
    const toolCalls = p.updates.filter((u) => u.update.sessionUpdate === 'tool_call');
    assert.equal(toolCalls.length, tools.length, 'one tool_call per file change or command');
    const done = p.updates.filter((u) => u.update.sessionUpdate === 'tool_call_update');
    assert.equal(done.length, itemsOf(p.fixture, 'item/completed', ['fileChange', 'commandExecution']).length);
  });
}

test('codex long-silent-tool: the 20 s silence is kept on the fake clock and costs the test no wall time', async () => {
  const p = await playCodex(path.join(CODEX, 'long-silent-tool.jsonl'));
  const started = p.updates.find((u) => u.update.sessionUpdate === 'tool_call');
  const ended = p.updates.find((u) => u.update.sessionUpdate === 'tool_call_update');
  assert.ok(started && ended);
  const silence = ended.at - started.at;
  assert.ok(silence >= 19_000, `fake-clock silence ${silence} ms`);
  /* Nothing from the agent in between: the gap is a real silence. */
  const between = p.updates.filter((u) => u.at > started.at && u.at < ended.at);
  assert.deepEqual(between, []);
  assert.ok(p.wallMs < 5_000, `the replay took ${p.wallMs} ms of wall time`);
});

test('codex command-approval: the command waits for the answer, and runs after it', async () => {
  const p = await playCodex(path.join(CODEX, 'command-approval.jsonl'));
  assert.equal(p.permissions.length, 1);
  assert.equal(((p.permissions[0]!.toolCall as Json).kind), 'execute');
  assert.match(p.result.text, /wrote approved\.txt/);
});

test('codex file-approval-denied: a denied file change is reported as declined', async () => {
  const p = await playCodex(path.join(CODEX, 'file-approval-denied.jsonl'));
  assert.equal(((p.permissions[0]!.toolCall as Json).kind), 'edit');
  const update = p.updates.find((u) => u.update.sessionUpdate === 'tool_call_update');
  assert.equal(update?.update.status, 'failed');
});

/*
 * WHAT THE ADAPTER DROPS TODAY, held as a list so the slices that wire these
 * (S1: usage and rate limits, plan; S2: output deltas, diffs) change it on
 * purpose. Computed from the fixtures: every server notification method minus
 * those CodexAppServerClient handles.
 */
test('codex: the notifications the adapter does not pass on yet, from the recordings', () => {
  /* Consumed on purpose, each with its reason:
       turn/started, turn/diff/updated   S3 turn snapshots (turnHooks)
       CODEX_TRANSLATED                  S2b: plan, goal, usage, rate limits as ACP updates */
  const handled = new Set(['item/agentMessage/delta', 'item/started', 'item/completed', 'turn/completed', 'turn/started', 'turn/diff/updated', ...CODEX_TRANSLATED]);
  const seen = new Set<string>();
  for (const name of fixturesIn(CODEX)) {
    for (const f of readFixture(path.join(CODEX, name)).frames) {
      if (f.dir === 's2c' && typeof f.msg.method === 'string' && f.msg.id === undefined && !handled.has(f.msg.method)) seen.add(f.msg.method);
    }
  }
  assert.deepEqual([...seen].sort(), [
    'item/commandExecution/outputDelta',
    'mcpServer/startupStatus/updated',
    'remoteControl/status/changed',
    'serverRequest/resolved',
    'thread/started',
    'thread/status/changed',
    'warning',
  ]);
});

/* ── the Claude fixtures (not run live) through the real AcpClient ───────── */

for (const name of fixturesIn(CLAUDE)) {
  test(`claude ${name.replace('.jsonl', '')} (not run live): replays faithfully through AcpClient`, async () => {
    const fixture = readFixture(path.join(CLAUDE, name));
    assert.equal(fixture.header.live, false);
    assert.match(fixture.header.notRunLive ?? '', /signed out/);
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-replay-acp-'));
    const clock = new ManualClock();
    const h = replaySpawn(fixture, { clock, values: { '<CWD>': cwd } });
    const updates: Json[] = [];
    const answers = [...(fixture.header.answers ?? [])];
    const client = new AcpClient({
      command: 'claude-agent-acp',
      cwd,
      accessMode: (fixture.header.accessMode ?? 'propose') as AgentMode,
      spawn: h.spawn,
      onUpdate: (n) => updates.push(n.update as unknown as Json),
      onPermission: async () => answers.shift() ?? 'deny',
    });
    try {
      await driven(() => h.drain(), client.start());
      await driven(() => h.drain(), client.newSession(cwd));
      const r = await driven(() => h.drain(), client.prompt('replay'));
      assert.deepEqual(h.replay.divergences, []);
      assert.equal(r.stopReason, 'end_turn');
      const kinds = updates.map((u) => u.sessionUpdate);
      assert.ok(kinds.includes('tool_call') && kinds.includes('tool_call_update'), kinds.join(','));
    } finally {
      await client.dispose();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
}

/* ── the fixtures themselves ───────────────────────────────────────────── */

test('the recordings cover what S0 asked for', () => {
  const all = [...fixturesIn(CODEX).map((n) => readFixture(path.join(CODEX, n))), ...fixturesIn(CLAUDE).map((n) => readFixture(path.join(CLAUDE, n)))];
  const live = all.filter((f) => f.header.live);
  const has = (fs_: Fixture[], test_: (m: Json) => boolean) => fs_.some((f) => f.frames.some((fr) => fr.dir === 's2c' && test_(fr.msg)));
  const item = (type: string) => (m: Json) => m.method === 'item/started' && ((m.params as Json)?.item as Json)?.type === type;
  assert.ok(has(live, item('fileChange')), 'file edits, live');
  assert.ok(has(live, (m) => m.method === 'item/commandExecution/requestApproval'), 'a command approval, live');
  assert.ok(has(live, (m) => m.method === 'item/fileChange/requestApproval'), 'a file approval, live');
  assert.ok(has(live, (m) => m.method === 'thread/goal/updated'), 'a plan (codex 0.153.4 sends it as a goal), live');
  assert.ok(has(live, (m) => m.method === 'thread/tokenUsage/updated'), 'usage updates, live');
  assert.ok(has(live, (m) => m.method === 'account/rateLimits/updated'), 'rate-limit updates, live');
  assert.ok(has(all.filter((f) => !f.header.live), (m) => m.method === 'turn/plan/updated'), 'todos, from the protocol types (not run live)');
  /* A long silent tool: a running command with no agent frame for 15 s or more. */
  const silent = live.some((f) => {
    const s2c = f.frames.filter((fr) => fr.dir === 's2c');
    return s2c.some((fr, i) => i > 0 && fr.t - s2c[i - 1]!.t >= 15_000);
  });
  assert.ok(silent, 'a long silent tool, live');
  assert.ok(live.length <= 5, 'at most five live sessions');
});

test('substituteDeltas replaces a path split across streamed chunks, keeping the frames', () => {
  const frames = ['See C:\\Us', 'ers\\dev\\shop\\a.py', ' now'].map((delta, i) => ({
    t: i,
    dir: 's2c' as const,
    msg: { method: 'item/agentMessage/delta', params: { itemId: 'm1', delta } },
  }));
  const out = substituteDeltas(frames, [['C:\\Users\\dev\\shop', '<CWD>']]);
  assert.deepEqual(
    out.map((f) => (f.msg.params as Json).delta),
    ['See <CWD>', '\\a.py', ' now'],
  );
  /* A plain substitute cannot see it: no single chunk holds the path. */
  assert.deepEqual(substitute(frames, [['C:\\Users\\dev\\shop', '<CWD>']]), frames);
});

test('no recording carries the machine or the account', () => {
  const user = os.userInfo().username;
  const host = os.hostname();
  /* A 1-2 character name ("vm") is a substring of ordinary fixture text, so it proves nothing: the same floor for both. */
  const forbidden = [os.homedir(), ...(host.length >= 3 ? [host] : []), ...(user.length >= 3 ? [user] : [])];
  for (const dir of [CODEX, CLAUDE, path.join(ROOT, 'fake')]) {
    for (const n of fixturesIn(dir)) {
      /* The file, and each message's streamed text joined (a path can be split across chunks). */
      const joined = readFixture(path.join(dir, n))
        .frames.map((f) => String(((f.msg.params ?? {}) as Json).delta ?? ''))
        .join('');
      const text = fs.readFileSync(path.join(dir, n), 'utf8') + joined;
      for (const s of forbidden) {
        for (const spelling of [s, s.replace(/\\/g, '\\\\'), s.replace(/\\/g, '/')]) assert.ok(!text.includes(spelling), `${n} contains ${spelling}`);
      }
      assert.doesNotMatch(text, /"(installationId|accountId|email)":"(?!<REDACTED>)/, n);
    }
  }
});

test('the not-run-live fixtures are exactly what their generators write', () => {
  for (const { file, fixture } of syntheticFiles()) {
    assert.equal(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), formatFixture(fixture), path.basename(file));
  }
});

test('replay tests wait on drains, never on sleeps', () => {
  const src = fs.readFileSync(path.resolve(here, '..', '..', 'src', 'test', 'replay.test.ts'), 'utf8');
  /* This test's own pattern is not a sleep: read the file up to it. */
  const code = src
    .slice(0, src.indexOf("test('replay tests wait on drains"))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /setTimeout\s*\(|\bsleep\s*\(|waitForTimeout/);
});
