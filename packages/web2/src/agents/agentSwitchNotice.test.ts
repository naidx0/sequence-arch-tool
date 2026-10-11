import { describe, expect, it } from 'vitest';

import { createAgentRunStore } from './agentRuns';
import { fromSavedRun } from './savedRuns';

/* A prompt that carried the chat to an agent says so in the transcript, once, in the existing note style, and says so again after a reload. */

function sse(events: unknown[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const notes = (r: { items: { kind: string; text?: string }[] }): string[] => r.items.filter((i) => i.kind === 'note').map((i) => i.text ?? '');
const stream = (agentRef: string, kind?: 'full' | 'delta') => [...(kind ? [{ type: 'acp:handoff', agentRef, chars: 420, kind }] : []), { type: 'acp:result', stopReason: 'end_turn', text: 'ok' }];

describe('the handoff notice', () => {
  it('names the agent as the status bar does and says it was given this chat so far', async () => {
    const store = createAgentRunStore({ fetch: async () => sse(stream('codex', 'full')) });
    const run = await store.start({ agentRef: 'codex', sessionId: 's', question: 'continue' });
    expect(notes(run)).toEqual(['OpenAI was given this chat so far.']);
    expect(run.handoff).toEqual({ chars: 420, kind: 'full' });
  });
  it('says a returning agent was caught up, and labels an unknown agent by its own name', async () => {
    const claude = createAgentRunStore({ fetch: async () => sse(stream('claude', 'delta')) });
    expect(notes(await claude.start({ agentRef: 'claude', sessionId: 's', question: 'back' }))).toEqual(['Claude was caught up on what happened since it last spoke.']);
    const other = createAgentRunStore({ fetch: async () => sse(stream('mystery', 'full')) });
    expect(notes(await other.start({ agentRef: 'mystery', sessionId: 's', question: 'hi' }))).toEqual(['Mystery was given this chat so far.']);
  });
  it('says nothing when nothing was handed over (a new chat, a resumed thread) and never claims a summary', async () => {
    const none = createAgentRunStore({ fetch: async () => sse(stream('gpt')) });
    const run = await none.start({ agentRef: 'gpt', sessionId: 's', question: 'hi' });
    expect(notes(run)).toEqual([]);
    expect(run.handoff).toBeUndefined();
    const full = createAgentRunStore({ fetch: async () => sse(stream('codex', 'full')) });
    expect(notes(await full.start({ agentRef: 'codex', sessionId: 's', question: 'x' })).join(' ')).not.toMatch(/summary/i);
  });
  it('survives a reload: the saved turn carries it and the restored run shows the same note first', () => {
    const saved = { id: 't1', agentRef: 'codex', prompt: 'q', text: 'answer', status: 'done', startedAt: 1, endedAt: 2, tools: [], handoff: { chars: 420, kind: 'full' } };
    const run = fromSavedRun(saved, 's')!;
    expect(run.handoff).toEqual({ chars: 420, kind: 'full' });
    expect(run.items[0]).toMatchObject({ kind: 'note', text: 'OpenAI was given this chat so far.' });
    expect(notes(fromSavedRun({ ...saved, handoff: undefined }, 's')!)).toEqual([]);
  });
});
