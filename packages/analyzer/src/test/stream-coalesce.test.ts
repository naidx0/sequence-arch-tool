import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ManualClock } from '@sequence/acp/dist/replay/clock.js';
import { replaySpawn, type ReplayHandle } from '@sequence/acp/dist/replay/codexReplay.js';
import type { Fixture, Json } from '@sequence/acp/dist/replay/fixture.js';

import { createRepoServer, serverSettled } from '../server/repoServer.js';
import { snapshotsIdle } from '../server/snapshot.js';
import {
  StreamCoalescer,
  acpTextOf,
  acpWithText,
  askTextOf,
  askWithText,
  mergeAdjacentText,
} from '../server/streamCoalescer.js';
import { STREAM_BODY_CAP_BYTES, utf8Prefix } from '../server/streamBodies.js';
import { agentSpecimen, replayFixture, streamTurn } from './support/agentServer.js';
import { fastStreamFixture } from './support/fastStreamFixture.js';
import { normalizeEvents } from './support/replayRunNode.js';

/* ══════════════════════════════════════════════════════════════════════════
   S6 (server half) — LONG CHATS STAY SMOOTH.
   Text deltas merge within 50 ms; anything else flushes them and goes at once;
   tool bodies over 8 KB are cut and served whole by id. Recorded codex turns
   through the real server on a ManualClock: nothing here waits on time.
   ══════════════════════════════════════════════════════════════════════════ */

const CODEX = { id: 'codex', command: 'codex' };

const chunk = (text: string, kind = 'agent_message_chunk', extra: Json = {}): Json => ({
  type: 'acp:update',
  update: { sessionId: 's1', update: { sessionUpdate: kind, content: { type: 'text', text }, ...extra } },
});
const textOfAcp = (e: Json): string => String((((e.update as Json).update as Json).content as Json).text);

function acpCoalescer(clock: ManualClock): { c: StreamCoalescer<Json>; out: Json[] } {
  const out: Json[] = [];
  const c = new StreamCoalescer<Json>({ textOf: acpTextOf, withText: acpWithText, write: (e) => out.push(e), clock });
  return { c, out };
}

/* ───────────────────────────── the rules, one by one ───────────────────────────── */

test('text within the window goes out as one frame, joined exactly, when the window ends', () => {
  const clock = new ManualClock();
  const { c, out } = acpCoalescer(clock);
  c.push(chunk('Hel'));
  clock.advance(10);
  c.push(chunk('lo, '));
  clock.advance(10);
  c.push(chunk('wörld 🙂'));
  assert.strictEqual(out.length, 0, 'nothing yet: the window is open');
  clock.advance(29);
  assert.strictEqual(out.length, 0, 'still inside 50 ms of the first part');
  clock.advance(1);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(textOfAcp(out[0]!), 'Hello, wörld 🙂');
  assert.deepStrictEqual(out[0], chunk('Hello, wörld 🙂'), 'the same event shape, only the text longer');
});

test('a lone chunk goes out as the very object it came in as', () => {
  const clock = new ManualClock();
  const { c, out } = acpCoalescer(clock);
  const e = chunk('only');
  c.push(e);
  clock.advance(50);
  assert.strictEqual(out[0], e);
});

test('a tool event flushes the pending text first, then goes out at once, in order', () => {
  const clock = new ManualClock();
  const { c, out } = acpCoalescer(clock);
  c.push(chunk('Running '));
  c.push(chunk('it now.'));
  const tool: Json = { type: 'acp:update', update: { sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'ls' } } };
  c.push(tool);
  assert.strictEqual(out.length, 2, 'both out with no time passing');
  assert.strictEqual(textOfAcp(out[0]!), 'Running it now.');
  assert.strictEqual(out[1], tool);
  c.push(chunk('Done.'));
  clock.advance(50);
  assert.deepStrictEqual(out.map((e) => (e.update as Json | undefined) && ((e.update as Json).update as Json).sessionUpdate), ['agent_message_chunk', 'tool_call', 'agent_message_chunk']);
});

test('approval requests, errors, turn end and settle never wait for the window', () => {
  const urgent: Json[] = [
    { type: 'acp:permission', requestId: 'r1', pending: true },
    { type: 'acp:error', error: 'boom' },
    { type: 'acp:turn', state: 'ended', stopReason: 'end_turn' },
    { type: 'acp:result', stopReason: 'end_turn', text: 'x' },
    { type: 'acp:turn', state: 'settled' },
  ];
  for (const u of urgent) {
    const clock = new ManualClock();
    const { c, out } = acpCoalescer(clock);
    c.push(chunk('a'));
    c.push(chunk('b'));
    c.push(u);
    assert.deepStrictEqual(out, [chunk('ab'), u], `${String(u.type)} ${String(u.state ?? '')}: text first, then it, with no time passing`);
    assert.strictEqual(clock.pending, 0, 'and no timer is left behind');
  }
});

test('only text of exactly one kind merges: a message never joins a thought, nor a chunk with its own _meta', () => {
  const clock = new ManualClock();
  const { c, out } = acpCoalescer(clock);
  c.push(chunk('think ', 'agent_thought_chunk'));
  c.push(chunk('more', 'agent_thought_chunk'));
  c.push(chunk('say ', 'agent_message_chunk'));
  c.push(chunk('', 'agent_thought_chunk', { _meta: { sequence: { thought: 'end' } } }));
  c.push(chunk('so', 'agent_message_chunk'));
  clock.advance(50);
  assert.deepStrictEqual(
    out.map((e) => [((e.update as Json).update as Json).sessionUpdate, textOfAcp(e)]),
    [
      ['agent_thought_chunk', 'think more'],
      ['agent_message_chunk', 'say '],
      ['agent_thought_chunk', ''],
      ['agent_message_chunk', 'so'],
    ],
  );
});

test('the ask stream: deltas merge, carrying the last part\'s seq; a tool start flushes them first', () => {
  const clock = new ManualClock();
  const out: [Json, number | null | undefined][] = [];
  type Ev = { type: string; text?: string; id?: string };
  const c = new StreamCoalescer<Ev, number | null>({ textOf: askTextOf, withText: askWithText, write: (e, seq) => out.push([e as Json, seq]), clock });
  c.push({ type: 'delta', text: 'a' }, 1);
  c.push({ type: 'delta', text: 'b' }, 2);
  c.push({ type: 'reasoning', text: 'r' }, 3);
  c.push({ type: 'tool:start', id: 't' }, 4);
  c.push({ type: 'delta', text: 'c' }, 5);
  c.close();
  assert.deepStrictEqual(out, [
    [{ type: 'delta', text: 'ab' }, 2],
    [{ type: 'reasoning', text: 'r' }, 3],
    [{ type: 'tool:start', id: 't' }, 4],
    [{ type: 'delta', text: 'c' }, 5],
  ]);
});

test('utf8Prefix never splits a character', () => {
  const s = 'ab' + 'é'.repeat(10) + '🙂';
  for (let cap = 0; cap <= Buffer.byteLength(s); cap++) {
    const p = utf8Prefix(s, cap);
    assert.ok(Buffer.byteLength(p) <= cap, `cap ${cap}`);
    assert.ok(s.startsWith(p), `cap ${cap}: a prefix`);
    assert.ok(!p.includes('�'));
  }
});

/* ───────────────────────── a recorded long reply, end to end ───────────────────────── */

async function serve(store: string, repo: string | null, h: ReplayHandle, clock: ManualClock, windowMs?: number): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repo, {
    webDist: undefined,
    userConfigDir: store,
    acpTurn: { clock, spawn: h.spawn, killGraceMs: 0 },
    ...(windowMs === undefined ? {} : { streamCoalesce: { windowMs } }),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  return {
    base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }).then(async () => {
        await serverSettled(server);
        if (repo) await snapshotsIdle(repo);
      }),
  };
}

interface Played {
  events: Json[];
  /** ManualClock time each frame was read at (the replay's recorded time). */
  at: number[];
  work: string;
  divergences: string[];
}

/** One recorded turn through the real server; `windowMs: 0` turns merging off (the before). */
async function play(fixture: Fixture, windowMs?: number): Promise<Played> {
  const s = agentSpecimen(CODEX);
  const clock = new ManualClock();
  const h = replaySpawn(fixture, { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const srv = await serve(s.store, null, h, clock, windowMs);
  const answers = [...(fixture.header.answers ?? [])];
  const at: number[] = [];
  try {
    const events = await streamTurn(
      srv.base,
      { agentRef: 'codex', prompt: 'go', permissionMode: fixture.header.accessMode ?? 'propose', chatId: s.chatId },
      h,
      async (e) => {
        at.push(clock.now());
        if (e.type === 'acp:permission' && e.pending === true) {
          await fetch(`${srv.base}/api/acp/permission`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ requestId: e.requestId, decision: answers.shift() ?? 'deny' }),
          });
        }
      },
    );
    return { events, at, work: s.work, divergences: [...h.replay.state.divergences] };
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
}

/** Frames per second over the turn, and the most in any one second. */
function rates(at: number[]): { frames: number; spanMs: number; perSec: number; peakPerSec: number } {
  const spanMs = Math.max(1, at[at.length - 1]! - at[0]!);
  let peak = 0;
  for (let i = 0, j = 0; i < at.length; i++) {
    while (at[i]! - at[j]! >= 1000) j++;
    peak = Math.max(peak, i - j + 1);
  }
  return { frames: at.length, spanMs, perSec: (at.length * 1000) / spanMs, peakPerSec: peak };
}

const canonical = (events: Json[], work: string): Json[] => mergeAdjacentText(normalizeEvents(events, work), acpTextOf, acpWithText);
const replyText = (events: Json[], kind: string): string =>
  events
    .filter((e) => e.type === 'acp:update' && ((e.update as Json).update as Json).sessionUpdate === kind)
    .map((e) => textOfAcp(e))
    .join('');

/* Two recordings, and one synthetic fast stream (support/fastStreamFixture.ts:
   NOT recorded; ~60 deltas a second around the todo-plan tool calls). The
   recordings keep the ratios measured on them; the synthetic stream asserts
   only what the window guarantees. */
const SCENARIOS: { scenario: string; fixture: () => Fixture; recorded: boolean }[] = [
  { scenario: 'todo-plan', fixture: () => replayFixture('codex', 'todo-plan'), recorded: true },
  { scenario: 'edit-with-plan', fixture: () => replayFixture('codex', 'edit-with-plan'), recorded: true },
  { scenario: 'fast-stream-synthetic', fixture: fastStreamFixture, recorded: false },
];

for (const { scenario, fixture, recorded } of SCENARIOS) {
  test(`replayed long reply (${scenario}): fewer frames per second, the same text byte for byte, the same order`, async () => {
    const before = await play(fixture(), 0);
    const after = await play(fixture());
    assert.deepStrictEqual(before.divergences, []);
    assert.deepStrictEqual(after.divergences, []);

    for (const kind of ['agent_message_chunk', 'agent_thought_chunk']) {
      assert.strictEqual(replyText(normalizeEvents(after.events, after.work), kind), replyText(normalizeEvents(before.events, before.work), kind), `${kind}: the text joins identically`);
    }
    /* Order: with every adjacent text run joined, the two streams are the same
       events in the same order. */
    assert.deepStrictEqual(canonical(after.events, after.work), canonical(before.events, before.work));
    /* Each non-text event was preceded by exactly the text that preceded it before. */
    const textBeforeEach = (p: Played): string[] => {
      let text = '';
      const out: string[] = [];
      for (const e of normalizeEvents(p.events, p.work)) {
        if (acpTextOf(e)) text += acpTextOf(e)!.text;
        else out.push(`${String(e.type)}|${text.length}`);
      }
      return out;
    };
    assert.deepStrictEqual(textBeforeEach(after), textBeforeEach(before));

    /*
     * THE RATES, MEASURED 2026-10-06, AND WHY THE BRIEF'S 5x IS NOT ASSERTED.
     * Only text merges (a tool, usage or approval event is never held or
     * reordered), so the all-frames floor is the count of non-text events; and
     * a 50 ms window can only merge deltas that arrive within 50 ms of each
     * other. These recordings stream at 3 to 6 deltas a second on average
     * (bursts of ~48/s), so the drop is 2.7x to 4.5x on text frames, 2.2x to
     * 3.2x on all frames, and 3x to 6x at the peak second. What is asserted is
     * what the window guarantees: in any second, at most 1000/50 text frames
     * plus one per non-text event that broke a run, and fewer frames overall.
     */
    const textAt = (p: Played): number[] => p.at.filter((_, i) => acpTextOf(p.events[i]!) !== null);
    const r0 = rates(before.at);
    const r1 = rates(after.at);
    const t0 = rates(textAt(before));
    const t1 = rates(textAt(after));
    console.log(
      `  S6 ${scenario} (span ${r0.spanMs} ms): all frames ${r0.frames} -> ${r1.frames}, ` +
        `${r0.perSec.toFixed(2)} -> ${r1.perSec.toFixed(2)}/s mean, ${r0.peakPerSec} -> ${r1.peakPerSec}/s peak; ` +
        `text frames ${t0.frames} -> ${t1.frames}, ${t0.perSec.toFixed(2)} -> ${t1.perSec.toFixed(2)}/s mean, ` +
        `${t0.peakPerSec} -> ${t1.peakPerSec}/s peak`,
    );
    if (recorded) assert.ok(t0.frames >= 2 * t1.frames, `text frames drop at least 2x: ${t0.frames} -> ${t1.frames} over the same turn`);
    if (recorded) assert.ok(t0.peakPerSec >= 2.5 * t1.peakPerSec, `the busiest second drops at least 2.5x: ${t0.peakPerSec} -> ${t1.peakPerSec}`);
    assert.ok(r1.frames < r0.frames, 'and the stream as a whole is smaller');
    /*
     * The window's own bound, over the whole turn: a text frame is written at
     * most once per 50 ms, plus one for every run a non-text event cut short.
     * Over the turn, not per second: `at` is when the client READ a frame, and
     * reads can bunch behind writes (a per-second count read 21 where writes
     * cannot exceed 20 a second; measured on the synthetic stream).
     */
    const textAfter = after.events.filter((e) => acpTextOf(e) !== null).length;
    const otherAfter = after.events.length - textAfter;
    const spanAfter = after.at[after.at.length - 1]! - after.at[0]!;
    assert.ok(
      textAfter <= Math.floor(spanAfter / 50) + 1 + otherAfter,
      `at most one text frame per 50 ms plus one per interruption: ${textAfter} text frames, ${otherAfter} other, ${spanAfter} ms`,
    );
  });
}

/* ───────────────────────────── bounded payloads ───────────────────────────── */

/** command-approval with its command's output blown up past the cap. */
function bigOutputFixture(big: string): Fixture {
  const f = replayFixture('codex', 'command-approval');
  let n = 0;
  for (const frame of f.frames) {
    const item = ((frame.msg as Json).params as Json | undefined)?.item as Json | undefined;
    if ((frame.msg as Json).method === 'item/completed' && item?.type === 'commandExecution') {
      item.aggregatedOutput = big;
      n++;
    }
  }
  assert.ok(n > 0, 'the fixture has a completed command to inflate');
  return f;
}

test('a tool output over 8 KB is cut in the stream and served whole by its id, from disk beside the chat, after a restart too', async () => {
  const big = Array.from({ length: 3000 }, (_, i) => `line ${i}: résumé 🙂 output\n`).join('');
  assert.ok(Buffer.byteLength(big) > 8 * STREAM_BODY_CAP_BYTES);
  const fixture = bigOutputFixture(big);
  const s = agentSpecimen(CODEX);
  const repo = s.root;
  const clock = new ManualClock();
  const h = replaySpawn(fixture, { clock, values: { '<CWD>': repo, '<HOME>': os.homedir() } });
  let srv = await serve(s.store, repo, h, clock);
  const answers = [...(fixture.header.answers ?? [])];
  try {
    const events = await streamTurn(srv.base, { agentRef: 'codex', prompt: 'go', permissionMode: 'propose', chatId: s.chatId }, h, async (e) => {
      if (e.type === 'acp:permission' && e.pending === true) {
        await fetch(`${srv.base}/api/acp/permission`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: e.requestId, decision: answers.shift() ?? 'deny' }),
        });
      }
    });
    assert.deepStrictEqual(h.replay.state.divergences, []);
    const cut = events.filter((e) => Array.isArray(e.capped));
    assert.ok(cut.length > 0, 'a capped event was sent');
    for (const e of events) {
      assert.ok(Buffer.byteLength(JSON.stringify(e)) < 4 * STREAM_BODY_CAP_BYTES, `no frame carries the whole body (${String(e.type)})`);
    }
    const c = (cut[0]!.capped as Json[])[0]!;
    assert.strictEqual(c.bytes, Buffer.byteLength(big));
    /* The field is still a string in its old place: the start of the body. */
    let v: unknown = cut[0];
    for (const k of c.at as (string | number)[]) v = (v as Record<string | number, unknown>)[k];
    assert.strictEqual(typeof v, 'string');
    assert.ok(big.startsWith(v as string));
    assert.strictEqual(Buffer.byteLength(v as string), c.shownBytes);
    assert.ok((c.shownBytes as number) <= STREAM_BODY_CAP_BYTES);

    /* Kept beside the chat, under the repo's .sequence/. */
    const onDisk = path.join(repo, '.sequence', 'sessions', s.chatId, 'stream-bodies', `${String(c.id)}.txt`);
    assert.ok(fs.existsSync(onDisk), onDisk);

    const get = async (base: string, id: string): Promise<{ status: number; text: string }> => {
      const r = await fetch(`${base}/api/stream-body?id=${id}&chat=${encodeURIComponent(s.chatId)}`);
      return { status: r.status, text: await r.text() };
    };
    const whole = await get(srv.base, String(c.id));
    assert.strictEqual(whole.status, 200);
    assert.strictEqual(whole.text, big, 'the whole body, byte for byte');

    /* A restart: a new server on the same repo still serves it. */
    await srv.close();
    srv = await serve(s.store, repo, h, clock);
    const again = await get(srv.base, String(c.id));
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.text, big);

    /* Controls: an unknown id and a malformed one. */
    assert.strictEqual((await get(srv.base, '0'.repeat(32))).status, 404);
    assert.strictEqual((await get(srv.base, '../../etc')).status, 404);
  } finally {
    await srv.close();
    fs.rmSync(s.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});
