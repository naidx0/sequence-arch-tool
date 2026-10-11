import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { formatFixture } from '@sequence/acp/dist/replay/fixture.js';

import { acpTextOf, acpWithText, mergeAdjacentText } from '../server/streamCoalescer.js';
import { REPLAY_FIXTURES, normalizeEvents, replayRunNode } from './support/replayRunNode.js';

/**
 * RECORDED CODEX SESSIONS THROUGH THE REAL SERVER (S0).
 *
 * The replaying codex (a real process playing the recording) is the only
 * agent; everything from CodexAppServerClient up through run-node's SSE
 * stream and the approval route is the shipping server. Each test proves the
 * recording played faithfully (no divergence, every frame) and that what a
 * person would see arrives: the agent's text, a tool call per file change or
 * command, one approval per recorded approval, settled the way it was
 * answered.
 *
 * The normalized events are kept as golden files under
 * packages/acp/src/test/fixtures/replay/sse/, which web2's replay tests feed
 * into its run store. A difference fails here; SEQUENCE_UPDATE_REPLAY=1
 * rewrites them.
 */

const CODEX = path.join(REPLAY_FIXTURES, 'codex');
const SSE = path.join(REPLAY_FIXTURES, 'sse');
const UPDATE = process.env.SEQUENCE_UPDATE_REPLAY === '1';
type Json = Record<string, unknown>;

const updatesOf = (events: Json[], kind: string): Json[] =>
  events.filter((e) => e.type === 'acp:update' && ((e.update as Json)?.update as Json)?.sessionUpdate === kind);

for (const name of fs.readdirSync(CODEX).filter((f) => f.endsWith('.jsonl')).sort()) {
  const scenario = name.replace('.jsonl', '');
  test(`run-node replays codex ${scenario}${scenario.endsWith('-synthetic') ? ' (not run live)' : ''} faithfully, and streams what a person sees`, async () => {
    const run = await replayRunNode(path.join(CODEX, name));
    assert.ok(run.report, 'the replaying codex wrote its report');
    assert.deepStrictEqual(run.report.divergences, [], 'the server drove the agent as the real one was driven');
    /* The server stops the agent when the turn completes; frames recorded
       after turn/completed (late usage updates) may not have played. */
    const endOfTurn = run.fixture.frames.findIndex((f) => f.msg.method === 'turn/completed');
    assert.ok(endOfTurn >= 0 && run.report.cursor > endOfTurn, `played through turn/completed (${run.report.cursor} of ${run.report.total})`);

    const frames = run.fixture.frames.filter((f) => f.dir === 's2c');
    const approvals = frames.filter((f) => /requestApproval$/.test(String(f.msg.method)));
    const pending = run.events.filter((e) => e.type === 'acp:permission' && e.pending === true);
    assert.strictEqual(pending.length, approvals.length, 'one approval question per recorded approval');
    const settled = run.events.filter((e) => e.type === 'acp:permission' && e.pending === false && typeof e.requestId === 'string');
    assert.deepStrictEqual(
      settled.map((e) => e.decision),
      run.fixture.header.answers ?? [],
      'each settled the way it was answered',
    );
    for (const a of run.answered) assert.strictEqual(a.status, 200);

    const tools = frames.filter(
      (f) => f.msg.method === 'item/started' && ['fileChange', 'commandExecution'].includes(String(((f.msg.params as Json)?.item as Json)?.type)),
    );
    assert.strictEqual(updatesOf(run.events, 'tool_call').length, tools.length, 'a tool call per recorded file change or command');

    /* The page cuts Edit from here by this id; a turn that stopped announcing it would make every edit cut nothing. */
    assert.strictEqual(run.events.filter((e) => e.type === 'acp:turn-id').length, 1, 'the turn announces the server\'s id for it, once');
    assert.strictEqual(run.events.findIndex((e) => e.type === 'acp:turn-id') < run.events.findIndex((e) => e.type === 'acp:update'), true, 'before any update');

    const result = run.events.find((e) => e.type === 'acp:result') as Json | undefined;
    assert.ok(result, 'the turn ended with a result');
    assert.strictEqual(result.stopReason, 'end_turn');
    const streamed = updatesOf(run.events, 'agent_message_chunk')
      .map((e) => (((e.update as Json).update as Json).content as Json).text)
      .join('');
    assert.strictEqual(result.text, streamed, 'the result is the text the stream carried');

    const golden = path.join(SSE, `${scenario}.sse.jsonl`);
    const now = normalizeEvents(run.events, run.work).map((e) => JSON.stringify(e)).join('\n') + '\n';
    if (UPDATE || !fs.existsSync(golden)) {
      fs.mkdirSync(SSE, { recursive: true });
      fs.writeFileSync(golden, now);
    }
    /* S6: the server merges text deltas within 50 ms, and this replay plays
       with no gaps, so how many frames the text arrives in is timing. The
       stream is compared with every adjacent text run joined: the same events,
       the same order, the same text byte for byte (streamCoalescer.ts). */
    const canonical = (events: Json[]): Json[] => mergeAdjacentText(events, acpTextOf, acpWithText);
    const goldenEvents = fs
      .readFileSync(golden, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Json);
    assert.deepStrictEqual(canonical(normalizeEvents(run.events, run.work)), canonical(goldenEvents), `the stream matches ${path.basename(golden)}`);
  });
}

test('the golden streams are the recordings they were made from (one per codex fixture)', () => {
  const recorded = fs.readdirSync(CODEX).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace('.jsonl', '')).sort();
  const golden = fs.readdirSync(SSE).filter((f) => f.endsWith('.sse.jsonl')).map((f) => f.replace('.sse.jsonl', '')).sort();
  assert.deepStrictEqual(golden, recorded);
  /* formatFixture is imported so a change to the fixture format shows up here as a type error first. */
  assert.strictEqual(typeof formatFixture, 'function');
});
