import { describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from './agentRuns';

function sse(events: unknown[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}

`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('compaction failure copy', () => {
  it('a failed compaction keeps the last letter s of the reason: "Too many requests"', async () => {
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { compact?: boolean };
      if (body.compact) return sse([{ type: 'acp:error', error: 'Too many requests.' }]);
      return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'ok' }]);
    });
    const store = createAgentRunStore({ fetch: f });
    void store.start({ agentRef: 'claude', sessionId: 's', compact: true, question: 'Compact the conversation' });
    await vi.waitFor(() => expect(store.get().runs.find((r) => r.operation === 'compact')?.status).toBe('failed'));
    await vi.waitFor(() => expect(store.get().runs[0]!.error).toMatch(/conversation is unchanged/i));
    expect(store.get().runs[0]!.error).toBe('Compaction failed: Too many requests. The conversation is unchanged.');
  });
});
