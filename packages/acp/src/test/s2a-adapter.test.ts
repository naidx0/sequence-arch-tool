/**
 * S2a IN THE ADAPTERS: THE AGENT SEES THE BOARD (all not run live).
 *
 * The replay matches the client's messages by method; these tests also check
 * the FIELDS: what the real AcpClient / CodexAppServerClient sent, with the
 * live paths put back to the fixture's placeholders, equals the recorded
 * client frame.
 *
 *   claude-board-session  session/new carries the stdio server "sequence"
 *                         and allows mcp__sequence__*; the prompt carries an
 *                         image block and an embedded node slice
 *   board-mcp-map         thread/start carries mcp_servers.sequence.*; the
 *                         agent's sequence.map call becomes a read row with
 *                         the map as its output
 *   plan-mode             Plan sends collaborationMode plan (read-only kept);
 *                         codex's plan item is the CLI plan
 *   image-turn            a localImage path, never base64
 *   resume                thread/resume carries the server too
 *   no server configured  nothing is added: mcpServers [], no config
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { AcpClient } from '../client.js';
import { DRAW_INSTRUCTION } from '../accessMode.js';
import { CodexAppServerClient, resetCodexExperimentalCache } from '../codexAppServer.js';
import { acpPromptBlocks, codexInputItems, type AgentMcpServer } from '../promptContent.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn, type ReplayHandle } from '../replay/codexReplay.js';
import { readFixture, substitute, type Fixture, type Json } from '../replay/fixture.js';
import { S2A_MAP_TEXT, S2A_PLAN_TEXT } from '../replay/s2aFixtures.js';
import type { AgentMode } from '../planMode.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', 'src', 'test', 'fixtures', 'replay');

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

interface Rig {
  dir: string;
  cwd: string;
  mcp: string;
  server: AgentMcpServer;
  values: Record<string, string>;
  done: () => void;
}

/** A temp repo and a server entry path outside it (so the two placeholders never overlap). */
function rig(): Rig {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s2a-'));
  const cwd = path.join(dir, 'repo');
  fs.mkdirSync(cwd);
  const mcp = path.join(dir, 'mcp-entry', 'server.js');
  return {
    dir,
    cwd,
    mcp,
    server: { name: 'sequence', command: 'node', args: [mcp], env: { SEQUENCE_REPO: cwd, SEQUENCE_MCP_TOOLS: 'core' } },
    values: { '<CWD>': cwd, '<HOME>': os.homedir(), '<MCP>': mcp },
    done: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** What the client sent for `method`, with live paths back to placeholders (longest first). */
function sentAsRecorded(h: ReplayHandle, r: Rig, method: string): Json {
  const msg = h.replay.received.find((m) => m.method === method);
  assert.ok(msg, `the client sent ${method}`);
  return substitute(msg.params as Json, [[r.mcp, '<MCP>'], [r.cwd, '<CWD>']]);
}
/**
 * The recordings are the wire as it was before the drawing line (lane visual) existed. The
 * expectation is the recording PLUS that line, so the test still compares everything and a change
 * to the line itself (or its loss) fails here.
 */
function withDrawLine(params: Json, method: string): Json {
  if (method === 'thread/start' || method === 'thread/resume') return { ...params, developerInstructions: DRAW_INSTRUCTION };
  if (method === 'session/new') return { ...params, _meta: { ...((params._meta as Json | undefined) ?? {}), systemPrompt: { append: DRAW_INSTRUCTION } } };
  return params;
}
const recorded = (f: Fixture, method: string): Json => withDrawLine(f.frames.find((x) => x.dir === 'c2s' && x.msg.method === method)!.msg.params as Json, method);

const fixture = (dir: string, name: string) => readFixture(path.join(ROOT, dir, `${name}.jsonl`));

/** A tiny real PNG (1x1), so the image block's base64 is of real bytes. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000000200015e2b1c370000000049454e44ae426082', 'hex');

test('claude-board-session (not run live): session/new carries the stdio server "sequence" and allows mcp__sequence__*; the prompt carries an image block and the node slice embedded; the map call is answered', async () => {
  const r = rig();
  const f = fixture('claude', 'claude-board-session');
  const h = replaySpawn(f, { clock: new ManualClock(), values: r.values });
  const updates: Json[] = [];
  const client = new AcpClient({ command: 'claude-agent-acp', cwd: r.cwd, accessMode: 'propose', mcpServers: [r.server], spawn: h.spawn, onUpdate: (n) => updates.push(n.update as unknown as Json) });
  const image = path.join(r.cwd, 'board.png');
  fs.writeFileSync(image, PNG);
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(r.cwd));
    assert.deepEqual(sentAsRecorded(h, r, 'session/new'), recorded(f, 'session/new'));
    const res = await driven(
      () => h.drain(),
      client.prompt('What does orders call?', {
        attachments: [
          { kind: 'image', path: image, mimeType: 'image/png' },
          { kind: 'context', name: 'orders', uri: 'sequence://map?focus=svc:orders', text: S2A_MAP_TEXT },
        ],
      }),
    );
    assert.equal(res.stopReason, 'end_turn');
    assert.deepEqual(h.replay.divergences, []);
    const blocks = (h.replay.received.find((m) => m.method === 'session/prompt')!.params as Json).prompt as Json[];
    assert.deepEqual(blocks.map((b) => b.type), ['text', 'image', 'resource']);
    assert.equal(blocks[1]!.data, PNG.toString('base64'));
    assert.deepEqual(blocks[2]!.resource, { uri: 'sequence://map?focus=svc:orders', mimeType: 'text/markdown', text: S2A_MAP_TEXT });
    const call = updates.find((u) => u.sessionUpdate === 'tool_call')!;
    assert.equal(call.title, 'mcp__sequence__map');
  } finally {
    await client.dispose();
    r.done();
  }
});

test('ACP prompt blocks follow promptCapabilities: no image cap is a resource_link to the file; no embeddedContext is a resource_link plus the slice inline', () => {
  const ctx = { kind: 'context' as const, name: 'orders', uri: 'sequence://map?focus=svc:orders', text: 'slice' };
  const img = { kind: 'image' as const, path: path.resolve('board.png'), mimeType: 'image/png' };
  const file = { kind: 'file' as const, path: path.resolve('orders/app/main.py') };
  const none = acpPromptBlocks('q', [img, file, ctx], { image: false, embeddedContext: false }, () => assert.fail('no bytes are read without the image capability'));
  assert.deepEqual(none.map((b) => b.type), ['text', 'resource_link', 'resource_link', 'resource_link', 'text']);
  assert.match(String(none[1]!.uri), /^file:\/\/.*board\.png$/);
  assert.match(String(none[2]!.uri), /^file:\/\/.*orders\/app\/main\.py$/);
  assert.equal(none[4]!.text, 'slice');
});

test('board-mcp-map (not run live): thread/start carries mcp_servers.sequence.* as a per-thread override; sequence.map is a read row whose output is the map', async () => {
  const r = rig();
  const f = fixture('codex-s2a', 'board-mcp-map');
  const h = replaySpawn(f, { clock: new ManualClock(), values: r.values });
  const updates: Json[] = [];
  const client = new CodexAppServerClient({ command: 'codex', cwd: r.cwd, accessMode: 'propose', mcpServers: [r.server], spawn: h.spawn, onUpdate: (n) => updates.push(n.update as unknown as Json) });
  try {
    await driven(() => h.drain(), client.start());
    assert.deepEqual(sentAsRecorded(h, r, 'initialize'), recorded(f, 'initialize'));
    await driven(() => h.drain(), client.newSession(r.cwd));
    assert.deepEqual(sentAsRecorded(h, r, 'thread/start'), recorded(f, 'thread/start'));
    const res = await driven(() => h.drain(), client.prompt('What does orders call?'));
    assert.deepEqual(h.replay.divergences, []);
    assert.equal(h.replay.state.finished, true);
    assert.match(res.text, /orders calls payments/);
    const call = updates.find((u) => u.sessionUpdate === 'tool_call')!;
    assert.deepEqual([call.title, call.kind], ['sequence.map', 'read']);
    const done = updates.find((u) => u.sessionUpdate === 'tool_call_update')!;
    assert.equal(done.status, 'completed');
    assert.equal((((done.content as Json[])[0]!.content as Json).text), S2A_MAP_TEXT);
  } finally {
    await client.dispose();
    r.done();
  }
});

/** Play a codex fixture to the end of one turn; answers the replay, the client and what it streamed. */
async function playCodex(name: string, accessMode: AgentMode, prompt: string, r: Rig): Promise<{ h: ReplayHandle; updates: Json[]; text: string }> {
  const h = replaySpawn(fixture('codex-s2a', name), { clock: new ManualClock(), values: r.values });
  const updates: Json[] = [];
  const client = new CodexAppServerClient({ command: 'codex', cwd: r.cwd, accessMode, mcpServers: [r.server], spawn: h.spawn, onUpdate: (n) => updates.push(n.update as unknown as Json) });
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(r.cwd));
    const res = await driven(() => h.drain(), client.prompt(prompt));
    return { h, updates, text: res.text };
  } finally {
    await client.dispose();
  }
}

test('plan-mode-unsupported (not run live): a codex without the experimental API gets the read-only plan, and the next connection does not opt in', async () => {
  resetCodexExperimentalCache();
  const r = rig();
  try {
    const { h, text } = await playCodex('plan-mode-unsupported', 'plan', 'Plan adding a ping endpoint.', r);
    assert.deepEqual(h.replay.divergences, []);
    assert.equal(h.replay.state.finished, true);
    assert.equal(text, S2A_PLAN_TEXT);
    const starts = h.replay.received.filter((m) => m.method === 'turn/start').map((m) => m.params as Json);
    assert.equal(starts.length, 1);
    assert.equal(starts[0]!.collaborationMode, undefined, 'no plan mode on a codex without it');
    assert.deepEqual([starts[0]!.approvalPolicy, (starts[0]!.sandboxPolicy as Json).type], ['on-request', 'readOnly']);
    assert.equal(((h.replay.received.find((m) => m.method === 'initialize')!.params as Json).capabilities as Json).experimentalApi, true, 'the first connection asks');
    /* Learned once: the next connection to this codex does not opt in, and a Plan turn does not probe again. */
    const again = await playCodex('board-mcp-map', 'propose', 'What does orders call?', r);
    assert.equal(((again.h.replay.received.find((m) => m.method === 'initialize')!.params as Json).capabilities as Json).experimentalApi, false);
  } finally {
    resetCodexExperimentalCache();
    r.done();
  }
});

test('plan-mode-refused-turn (not run live): a codex that refuses collaborationMode on the turn gets the same turn again without it; the chat goes on', async () => {
  resetCodexExperimentalCache();
  const r = rig();
  try {
    const { h, text } = await playCodex('plan-mode-refused-turn', 'plan', 'Plan adding a ping endpoint.', r);
    assert.deepEqual(h.replay.divergences, []);
    assert.equal(text, S2A_PLAN_TEXT);
    const starts = h.replay.received.filter((m) => m.method === 'turn/start').map((m) => m.params as Json);
    assert.deepEqual(starts.map((s) => s.collaborationMode === undefined), [false, true], 'first with plan mode, then without');
    assert.deepEqual((starts[1]!.sandboxPolicy as Json).type, 'readOnly');
  } finally {
    resetCodexExperimentalCache();
    r.done();
  }
});

test('board-elicitation (not run live): codex asking before a board tool runs is accepted for "sequence" (the map runs); another server\'s question is declined', async () => {
  const r = rig();
  try {
    const { h, updates } = await playCodex('board-elicitation', 'propose', 'What does orders call?', r);
    assert.deepEqual(h.replay.divergences, []);
    assert.equal(h.replay.state.finished, true);
    const answers = h.replay.received.filter((m) => m.id === 10 || m.id === 11).map((m) => (m.result as Json).action);
    assert.deepEqual(answers, ['accept', 'decline']);
    assert.ok(updates.some((u) => u.sessionUpdate === 'tool_call_update' && u.status === 'completed'), 'the board tool ran');
  } finally {
    r.done();
  }
});

test("plan-mode (not run live): Plan sends codex's own plan mode on turn/start, the read-only sandbox kept; the plan item is the CLI's plan", async () => {
  resetCodexExperimentalCache();
  const r = rig();
  const f = fixture('codex-s2a', 'plan-mode');
  const h = replaySpawn(f, { clock: new ManualClock(), values: r.values });
  const updates: Json[] = [];
  const client = new CodexAppServerClient({ command: 'codex', cwd: r.cwd, accessMode: 'plan', mcpServers: [r.server], spawn: h.spawn, onUpdate: (n) => updates.push(n.update as unknown as Json) });
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(r.cwd));
    await driven(() => h.drain(), client.prompt('Plan adding a ping endpoint.'));
    assert.deepEqual(h.replay.divergences, []);
    /* Asked once, with the experimental API opted into: does this codex offer a plan preset? */
    assert.equal(((h.replay.received.find((m) => m.method === 'initialize')!.params as Json).capabilities as Json).experimentalApi, true);
    assert.equal(h.replay.received.filter((m) => m.method === 'collaborationMode/list').length, 1);
    const start = h.replay.received.find((m) => m.method === 'turn/start')!.params as Json;
    assert.deepEqual(start.collaborationMode, { mode: 'plan', settings: { model: 'gpt-5-codex', reasoning_effort: null, developer_instructions: null } });
    assert.deepEqual([start.approvalPolicy, (start.sandboxPolicy as Json).type], ['on-request', 'readOnly']);
    const plan = updates.find((u) => u.sessionUpdate === 'plan_update')!;
    assert.deepEqual(plan.plan, { type: 'markdown', planId: 'plan:plan-1', content: S2A_PLAN_TEXT });
  } finally {
    await client.dispose();
    r.done();
  }
});

test('image-turn (not run live): a pasted image goes as a localImage path, never base64 in the JSON', async () => {
  const r = rig();
  const f = fixture('codex-s2a', 'image-turn');
  const h = replaySpawn(f, { clock: new ManualClock(), values: r.values });
  const client = new CodexAppServerClient({ command: 'codex', cwd: r.cwd, accessMode: 'propose', mcpServers: [r.server], spawn: h.spawn });
  const image = path.join(r.cwd, 'paste.png');
  fs.writeFileSync(image, PNG);
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(r.cwd));
    await driven(() => h.drain(), client.prompt('What is wrong in this screenshot?', { attachments: [{ kind: 'image', path: image, mimeType: 'image/png' }] }));
    assert.deepEqual(h.replay.divergences, []);
    const start = h.replay.received.find((m) => m.method === 'turn/start')!.params as Json;
    assert.deepEqual(start.input, [
      { type: 'text', text: 'What is wrong in this screenshot?', text_elements: [] },
      { type: 'localImage', path: image },
    ]);
    assert.ok(!JSON.stringify(start).includes(PNG.toString('base64')), 'no base64 in the JSON');
    assert.equal(start.collaborationMode, undefined, 'not in Plan: no plan mode');
  } finally {
    await client.dispose();
    r.done();
  }
});

test('codex input: files are mentions, a node slice is inline text', () => {
  const items = codexInputItems('q', [
    { kind: 'file', path: path.resolve('orders/app/main.py') },
    { kind: 'context', name: 'orders', uri: 'sequence://map?focus=svc:orders', text: 'slice' },
  ]);
  assert.deepEqual(items.slice(1), [
    { type: 'mention', name: 'main.py', path: path.resolve('orders/app/main.py') },
    { type: 'text', text: 'slice', text_elements: [] },
  ]);
});

test('resume (codex-s1 resume-after-restart): thread/resume carries the server too', async () => {
  const r = rig();
  const f = fixture('codex-s1', 'resume-after-restart');
  const h = replaySpawn(f, { clock: new ManualClock(), values: r.values });
  const client = new CodexAppServerClient({ command: 'codex', cwd: r.cwd, accessMode: (f.header.accessMode ?? 'propose') as AgentMode, mcpServers: [r.server], spawn: h.spawn });
  try {
    await driven(() => h.drain(), client.start());
    const threadId = String(((f.frames.find((x) => x.dir === 'c2s' && x.msg.method === 'thread/resume')!.msg.params as Json).threadId));
    await driven(() => h.drain(), client.resumeSession(threadId, r.cwd));
    const sent = sentAsRecorded(h, r, 'thread/resume');
    assert.deepEqual(sent.config, recorded(fixture('codex-s2a', 'board-mcp-map'), 'thread/start').config);
  } finally {
    await client.dispose();
    r.done();
  }
});

test('no server configured: nothing is added (mcpServers [], no config, no allowedTools)', async () => {
  const r = rig();
  const f = fixture('codex-s2b', 'model-effort-turn');
  const h = replaySpawn(f, { clock: new ManualClock(), values: r.values });
  const client = new CodexAppServerClient({ command: 'codex', cwd: r.cwd, accessMode: 'propose', spawn: h.spawn });
  try {
    await driven(() => h.drain(), client.start());
    await driven(() => h.drain(), client.newSession(r.cwd));
    assert.equal(sentAsRecorded(h, r, 'thread/start').config, undefined);
  } finally {
    await client.dispose();
    r.done();
  }
  const r2 = rig();
  const c = fixture('claude', 'claude-plan-mode');
  const h2 = replaySpawn(c, { clock: new ManualClock(), values: r2.values });
  const acp = new AcpClient({ command: 'claude-agent-acp', cwd: r2.cwd, accessMode: 'plan', spawn: h2.spawn });
  try {
    await driven(() => h2.drain(), acp.start());
    await driven(() => h2.drain(), acp.newSession(r2.cwd));
    const sent = sentAsRecorded(h2, r2, 'session/new');
    assert.deepEqual(sent.mcpServers, []);
    assert.deepEqual(sent._meta, { claudeCode: { options: { permissionMode: 'plan' } }, systemPrompt: { append: DRAW_INSTRUCTION } }, 'claude is told it can draw');
  } finally {
    await acp.dispose();
    r2.done();
  }
});
