import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../agents/agentRunFold';
import { createAgentRunStore } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { AgentRunView } from './AgentRunThread';

/*
 * PLAN MAKES NO CHANGES (owner ruling, 2026-10-06). The server declines a
 * Plan edit at once and says why on the permission event (`note`, no
 * requestId). The chat shows that one quiet line, once per run, and no card.
 */

const NOTE = "Plan mode doesn't make changes. Approve the plan or switch mode to apply it.";
const refused = (n: number): RunNodeEvent => ({ type: 'acp:permission', toolCallId: `item-${n}`, title: 'Edit hello.txt', toolKind: 'edit', decision: 'deny', note: NOTE } as RunNodeEvent);

describe('a Plan edit declined by the mode', () => {
  it('is one quiet line in the chat, said once however many edits were declined, and never a card', async () => {
    const events: RunNodeEvent[] = [refused(1), refused(2), { type: 'acp:result', stopReason: 'end_turn', text: '' }];
    const fetch = async (input: string): Promise<Response> => {
      if (input === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'codex' }] }), { status: 200 });
      const enc = new TextEncoder();
      let i = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          pull(c) {
            if (i >= events.length) return c.close();
            c.enqueue(enc.encode(`data: ${JSON.stringify(events[i++])}\n\n`));
          },
        }),
        { status: 200 },
      );
    };
    const store = createAgentRunStore({ clock: () => 1000, fetch });
    const run = await store.start({ question: 'Plan a ping endpoint', intent: 'plan' }, fetch);
    const v = render(<AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} />);
    const notes = v.getAllByTestId('agent-run-note');
    expect(notes.map((n) => n.textContent)).toEqual([NOTE]);
    expect(run.approvals).toEqual([]);
    expect(v.queryByTestId('agent-card-approval')).toBeNull();
    expect(v.container.querySelector('[data-approval-id]')).toBeNull();
  });
});
