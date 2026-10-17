import { describe, expect, it } from 'vitest';

import { createAgentRunStore, followLiveTurns, type AgentRun } from './agentRuns';
import { setRunFrameClock, stopRun } from './agentRunner';
import type { FrameClock } from '../state/frameQueue';

/*
 * Owner: several chats running agents in the background. A reload (and opening
 * a chat in another workspace, which reloads) used to stop every agent turn;
 * the server now keeps a chat turn going, and the page must follow it again:
 * every running turn, in every chat, streams back into its chat. And since a
 * dropped stream no longer stops a turn, Stop must name the turn to the server.
 */

const sse = (events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const chunk = (text: string) => ({ type: 'acp:update', update: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });

async function settled(get: () => AgentRun | undefined) {
  for (let i = 0; i < 50; i++) {
    const r = get();
    if (r && r.status !== 'running') return r;
    await new Promise((res) => setTimeout(res, 10));
  }
  return get();
}

describe('following chat turns after a reload', () => {
  it('every turn the server is running streams back into its own chat', async () => {
    const calls: string[] = [];
    const f = async (url: string) => {
      calls.push(url);
      if (url === '/api/acp/live')
        return json({ turns: [{ turnId: 't-b', chatId: 'chat-b', agentRef: 'codex', prompt: 'fix it', startedAt: 5 }, { turnId: 't-c', chatId: 'chat-c', agentRef: 'claude', prompt: 'plan it', startedAt: 6 }] });
      if (url === '/api/acp/attach?turnId=t-b') return sse([{ type: 'acp:turn-id', turnId: 't-b' }, chunk('codex says B1'), chunk(' B2'), { type: 'acp:turn', state: 'ended', stopReason: 'end_turn' }, { type: 'acp:result', stopReason: 'end_turn', text: 'codex says B1 B2' }, { type: 'acp:turn', state: 'settled' }]);
      if (url === '/api/acp/attach?turnId=t-c') return sse([{ type: 'acp:turn-id', turnId: 't-c' }, chunk('claude says C1'), { type: 'acp:turn', state: 'ended', stopReason: 'end_turn' }, { type: 'acp:result', stopReason: 'end_turn', text: 'claude says C1' }, { type: 'acp:turn', state: 'settled' }]);
      return json({}, 404);
    };
    const store = createAgentRunStore({ fetch: f as never });
    expect(await followLiveTurns(store, f as never)).toBe(2);
    const b = await settled(() => store.get().runs.find((r) => r.turnId === 't-b'));
    const c = await settled(() => store.get().runs.find((r) => r.turnId === 't-c'));
    expect([b?.sessionId, b?.status, b?.agentRef, b?.prompt]).toEqual(['chat-b', 'done', 'codex', 'fix it']);
    expect([c?.sessionId, c?.status]).toEqual(['chat-c', 'done']);
    const words = (r?: AgentRun) => (r?.items ?? []).map((i) => (i.kind === 'message' ? i.text : '')).join('');
    expect(words(b)).toContain('codex says B1 B2');
    expect(words(b)).not.toContain('claude');
    expect(words(c)).toContain('claude says C1');
    expect(store.get().agents).toMatchObject({ 'chat-b': 'codex', 'chat-c': 'claude' });
  });

  it('a turn whose start the server no longer kept says so while live, and takes the whole saved record when it ends', async () => {
    /* 0.1.5 review: the server trimmed a long turn's replay and set `truncated`, which no page read: the start of the
       answer was silently missing after a reload. */
    const f = async (url: string) => {
      if (url === '/api/acp/attach?turnId=t-long')
        return sse([{ type: 'acp:replay-truncated', dropped: 412 }, { type: 'acp:turn-id', turnId: 't-long' }, chunk('...the end of it'), { type: 'acp:result', stopReason: 'end_turn', text: '...the end of it' }, { type: 'acp:turn', state: 'settled' }]);
      if (url === '/api/acp/runs?chatId=chat-l') return json({ runs: [{ id: 't-long', prompt: 'go', status: 'done', startedAt: 1, endedAt: 2, agentRef: 'codex', text: 'The start of it ...the end of it' }] });
      return json({}, 404);
    };
    const store = createAgentRunStore({ fetch: f as never });
    const saved = { id: 'saved-t-long', turnId: 't-long', sessionId: 'chat-l', agentRef: 'codex', nodeId: null, nodeLabel: null, prompt: 'go', status: 'running', startedAt: 1, endedAt: null, items: [], approvals: [], error: null } as AgentRun;
    store.hydrate('chat-l', [saved]);
    let sawNote = false;
    const off = store.subscribe(() => {
      const r = store.get().runs.find((x) => x.id === 'saved-t-long');
      if (r?.items.some((i) => i.kind === 'note' && /start of this turn/i.test(i.text))) sawNote = true;
    });
    let r: AgentRun | undefined;
    for (let i = 0; i < 100; i++) {
      r = store.get().runs.find((x) => x.id === 'saved-t-long');
      if (r?.status === 'done' && r.items.some((x) => x.kind === 'message' && x.text.startsWith('The start'))) break;
      await new Promise((res) => setTimeout(res, 10));
    }
    off();
    expect(sawNote).toBe(true);
    expect(r?.status).toBe('done');
    /* The whole answer, from the saved record, not only the tail the server still had. */
    expect(r?.items.filter((i) => i.kind === 'message').map((i) => (i as { text: string }).text).join('')).toBe('The start of it ...the end of it');
  });

  it('a saved record still running when its chat loads is followed live, not left frozen', async () => {
    const f = async (url: string) =>
      url === '/api/acp/attach?turnId=t-1' ? sse([{ type: 'acp:turn-id', turnId: 't-1' }, chunk('done now'), { type: 'acp:result', stopReason: 'end_turn', text: 'done now' }, { type: 'acp:turn', state: 'settled' }]) : json({}, 404);
    const store = createAgentRunStore({ fetch: f as never });
    const saved = { id: 'saved-t-1', turnId: 't-1', sessionId: 'chat-a', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'go', status: 'running', startedAt: 1, endedAt: null, items: [], approvals: [], error: null } as AgentRun;
    store.hydrate('chat-a', [saved]);
    const r = await settled(() => store.get().runs.find((x) => x.id === 'saved-t-1'));
    expect(r?.status).toBe('done');
    expect(r?.restored).toBeFalsy();
  });

  it('Stop names the turn to the server, because dropping the stream no longer stops it', async () => {
    const posted: string[] = [];
    const f = async (url: string, init?: RequestInit) => {
      if (url === '/api/acp/stop') {
        posted.push(String(init?.body));
        return json({ stopped: true });
      }
      if (url.startsWith('/api/acp/run-node')) {
        const body = new ReadableStream({
          start(ctl) {
            ctl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'acp:turn-id', turnId: 't-9' })}

`));
            init?.signal?.addEventListener('abort', () => ctl.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(body, { status: 200 });
      }
      return json({}, 404);
    };
    const store = createAgentRunStore({ fetch: f as never });
    const done = store.start({ question: 'long job', agentRef: 'codex', sessionId: 'chat-a' }, f as never);
    for (let i = 0; i < 50 && !store.get().runs[0]?.turnId; i++) await new Promise((r) => setTimeout(r, 10));
    expect(store.get().runs[0]?.turnId).toBe('t-9');
    stopRun(store.get().runs[0]!.id, f as never);
    await done;
    expect(posted).toEqual([JSON.stringify({ turnId: 't-9' })]);
  });

  it('Stop pressed before the server has named the turn still stops it on the server, as soon as the name lands', async () => {
    /* 0.1.5 review: a Stop before acp:turn-id only dropped the stream, so the server kept the turn for its
       30 s grace while the page said Stopped. */
    const posted: string[] = [];
    let say: ((e: object) => void) | null = null;
    let dropped = false;
    const f = async (url: string, init?: RequestInit) => {
      if (url === '/api/acp/stop') {
        posted.push(String(init?.body));
        return json({ stopped: true });
      }
      if (url.startsWith('/api/acp/run-node')) {
        const body = new ReadableStream({
          start(ctl) {
            say = (e) => {
              if (!dropped) ctl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`));
            };
            init?.signal?.addEventListener('abort', () => {
              dropped = true;
              ctl.error(new DOMException('aborted', 'AbortError'));
            });
          },
        });
        return new Response(body, { status: 200 });
      }
      return json({}, 404);
    };
    const store = createAgentRunStore({ fetch: f as never });
    const done = store.start({ question: 'long job', agentRef: 'codex', sessionId: 'chat-a' }, f as never);
    for (let i = 0; i < 100 && !say; i++) await new Promise((r) => setTimeout(r, 5));
    expect(say).not.toBeNull();
    const id = store.get().runs[0]!.id;
    expect(store.get().runs[0]?.turnId).toBeUndefined();
    stopRun(id, f as never);
    /* The page says Stopped at once. */
    expect(store.get().runs[0]).toMatchObject({ status: 'failed', error: 'Stopped.' });
    say!({ type: 'acp:turn-id', turnId: 't-early' });
    await done;
    expect(posted).toEqual([JSON.stringify({ turnId: 't-early' })]);
    expect(dropped).toBe(true);
    expect(store.get().runs[0]).toMatchObject({ status: 'failed', error: 'Stopped.' });
  });

  it('after an early Stop, the rest of the chunk that named the turn adds nothing to the stopped run', async () => {
    /* 0.1.5 re-review: acp:turn-id, text and a result arriving in ONE chunk after Stop still reached onEvent. */
    let say: ((chunkText: string) => void) | null = null;
    const f = async (url: string, init?: RequestInit) => {
      if (url === '/api/acp/stop') return json({ stopped: true });
      if (url.startsWith('/api/acp/run-node')) {
        const body = new ReadableStream({
          start(ctl) {
            say = (t) => ctl.enqueue(new TextEncoder().encode(t));
            init?.signal?.addEventListener('abort', () => ctl.error(new DOMException('aborted', 'AbortError')));
          },
        });
        return new Response(body, { status: 200 });
      }
      return json({}, 404);
    };
    const store = createAgentRunStore({ fetch: f as never });
    const done = store.start({ question: 'long job', agentRef: 'codex', sessionId: 'chat-a' }, f as never);
    for (let i = 0; i < 100 && !say; i++) await new Promise((r) => setTimeout(r, 5));
    const id = store.get().runs[0]!.id;
    stopRun(id, f as never);
    const frame = (e: object) => `data: ${JSON.stringify(e)}

`;
    say!(frame({ type: 'acp:turn-id', turnId: 't-early' }) + frame(chunk('too late')) + frame({ type: 'acp:result', stopReason: 'end_turn', text: 'too late' }));
    await done;
    const run = store.get().runs[0]!;
    expect(run).toMatchObject({ status: 'failed', error: 'Stopped.' });
    expect(JSON.stringify(run.items)).not.toContain('too late');
  });

  it('Stop pressed after the server named the turn but before the next frame names it too', async () => {
    /* Frames that never come: the store has not folded acp:turn-id yet when Stop is pressed. */
    const clock: FrameClock = { frame: () => 1, cancelFrame: () => {}, timer: () => 2, cancelTimer: () => {}, hidden: () => false, onVisibility: () => () => {} };
    setRunFrameClock(clock);
    try {
      const posted: string[] = [];
      let named = false;
      const f = async (url: string, init?: RequestInit) => {
        if (url === '/api/acp/stop') {
          posted.push(String(init?.body));
          return json({ stopped: true });
        }
        if (url.startsWith('/api/acp/run-node')) {
          const body = new ReadableStream({
            start(ctl) {
              ctl.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'acp:turn-id', turnId: 't-frame' })}\n\n`));
              named = true;
              init?.signal?.addEventListener('abort', () => ctl.error(new DOMException('aborted', 'AbortError')));
            },
          });
          return new Response(body, { status: 200 });
        }
        return json({}, 404);
      };
      const store = createAgentRunStore({ fetch: f as never });
      const done = store.start({ question: 'long job', agentRef: 'codex', sessionId: 'chat-a' }, f as never);
      for (let i = 0; i < 100 && !named; i++) await new Promise((r) => setTimeout(r, 5));
      await new Promise((r) => setTimeout(r, 20));
      expect(store.get().runs[0]?.turnId).toBeUndefined();
      stopRun(store.get().runs[0]!.id, f as never);
      await done;
      expect(posted).toEqual([JSON.stringify({ turnId: 't-frame' })]);
    } finally {
      setRunFrameClock(undefined);
    }
  });
});
