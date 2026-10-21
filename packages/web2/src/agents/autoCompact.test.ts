import { describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from './agentRuns';
import { fromSavedRun } from './savedRuns';

/* Auto compact for agent chats: one compaction in flight, one offer when the window is full, no loop, an honest failure. */

function sse(events: unknown[], keepOpen = false): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      if (!keepOpen) c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const usage = (used: number, size = 1000) => ({ type: 'acp:update', update: { sessionId: 's', update: { sessionUpdate: 'usage_update', used, size } } });
const answer = (text = 'ok') => [{ type: 'acp:result', stopReason: 'end_turn', text }];

/** A server that answers prompts with the next scripted usage and compactions with the scripted outcome. */
function server(script: { prompts: number[]; compact?: 'ok' | 'fail' | 'hang' }) {
  const bodies: { compact?: boolean }[] = [];
  let p = 0;
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { compact?: boolean };
    bodies.push(body);
    if (body.compact) {
      if (script.compact === 'hang') return sse([], true);
      if (script.compact === 'fail') return sse([{ type: 'acp:error', error: 'agent exited' }]);
      return sse(answer(''));
    }
    const used = script.prompts[Math.min(p++, script.prompts.length - 1)]!;
    return sse([usage(used), ...answer()]);
  });
  return { f, compactions: () => bodies.filter((b) => b.compact).length };
}

const send = (store: ReturnType<typeof createAgentRunStore>, q = 'q') => store.start({ agentRef: 'claude', sessionId: 's', question: q });
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('one compaction at a time', () => {
  it('a second Compact while one is running starts nothing and hands back the one in flight', async () => {
    const s = server({ prompts: [100], compact: 'hang' });
    const store = createAgentRunStore({ fetch: s.f });
    void store.start({ agentRef: 'claude', sessionId: 's', compact: true, question: 'Compact the conversation' });
    await vi.waitFor(() => expect(s.compactions()).toBe(1));
    const again = await store.start({ agentRef: 'claude', sessionId: 's', compact: true, question: 'Compact the conversation' });
    expect(s.compactions()).toBe(1);
    expect(again).toMatchObject({ operation: 'compact', status: 'running' });
    expect(store.get().runs).toHaveLength(1);
  });
});

describe('a full window', () => {
  it('starts one compaction after the turn that filled it, and says why', async () => {
    const s = server({ prompts: [960] });
    const store = createAgentRunStore({ fetch: s.f });
    await send(store);
    await vi.waitFor(() => expect(s.compactions()).toBe(1));
    await settle();
    const compact = store.get().runs.find((r) => r.operation === 'compact')!;
    expect(compact.items.some((i) => i.kind === 'note' && /96% full/.test(i.text))).toBe(true);
  });

  it('leaves a window under the line alone', async () => {
    const s = server({ prompts: [900] });
    const store = createAgentRunStore({ fetch: s.f });
    await send(store);
    await settle();
    expect(s.compactions()).toBe(0);
  });

  it('does not loop: a compaction that did not bring the window down is not repeated', async () => {
    const s = server({ prompts: [960, 970, 980] });
    const store = createAgentRunStore({ fetch: s.f });
    await send(store);
    await vi.waitFor(() => expect(s.compactions()).toBe(1));
    await settle();
    await send(store);
    await send(store);
    await settle();
    expect(s.compactions()).toBe(1);
  });

  it('compacts again later, once a turn showed the window had room', async () => {
    const s = server({ prompts: [960, 300, 960] });
    const store = createAgentRunStore({ fetch: s.f });
    await send(store);
    await vi.waitFor(() => expect(s.compactions()).toBe(1));
    await settle();
    await send(store);
    await settle();
    await send(store);
    await vi.waitFor(() => expect(s.compactions()).toBe(2));
  });

  it('a failed compaction says the conversation is unchanged, and is not retried by itself', async () => {
    const s = server({ prompts: [960, 965], compact: 'fail' });
    const store = createAgentRunStore({ fetch: s.f });
    await send(store);
    await vi.waitFor(() => expect(store.get().runs.find((r) => r.operation === 'compact')?.status).toBe('failed'));
    const failed = store.get().runs.find((r) => r.operation === 'compact')!;
    expect(failed.error).toMatch(/agent exited/);
    expect(failed.error).toMatch(/conversation is unchanged/i);
    await send(store);
    await settle();
    expect(s.compactions()).toBe(1);
  });
});

describe('a saved compaction', () => {
  it('comes back as a compact run with how many turns it covered and its summary', () => {
    const run = fromSavedRun({ id: 'c1', prompt: '', text: 'Earlier: the API moved to v2.', status: 'done', agentRef: 'claude', startedAt: 5, endedAt: 9, compact: true, summarizedTurns: 7, tools: [] }, 's');
    expect(run).toMatchObject({ operation: 'compact', summarizedTurns: 7, status: 'done' });
    expect(run!.items.some((i) => i.kind === 'message' && /moved to v2/.test(i.text))).toBe(true);
  });
});

describe('review fixes', () => {
  it('a start that has not landed yet blocks the auto offer (holdStart)', async () => {
    const s = server({ prompts: [960] });
    const store = createAgentRunStore({ fetch: s.f });
    const release = store.holdStart('s');
    await send(store);
    await settle();
    expect(s.compactions()).toBe(0);
    release();
    await send(store);
    await vi.waitFor(() => expect(s.compactions()).toBe(1));
  });

  it('a follow-up whose start lands a tick after the turn ended is not run alongside a compaction', async () => {
    const s = server({ prompts: [960, 300] });
    const store = createAgentRunStore({ fetch: s.f });
    let fired = false;
    /* the composer's queue drain: an effect that sends the next prompt when the turn settles */
    store.subscribe(() => {
      if (!fired && store.get().runs.some((r) => r.status === 'done')) {
        fired = true;
        setTimeout(() => void send(store, 'queued follow-up'), 0);
      }
    });
    await send(store);
    await settle();
    await settle();
    expect(s.compactions()).toBe(0);
    const overlap = store.get().runs.filter((r) => r.status === 'running');
    expect(overlap.length).toBeLessThanOrEqual(1);
    expect(store.get().runs.filter((r) => !r.operation || r.operation === 'prompt')).toHaveLength(2);
  });
});
