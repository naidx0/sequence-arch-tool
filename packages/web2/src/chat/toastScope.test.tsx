import { describe, expect, it } from 'vitest';

import type { AgentRun, AgentRunsState } from '../agents/agentRuns';
import { toastsFor } from './AgentToasts';

/*
 * Owner: switching chats showed "Claude run failed, authentication required"
 * though nothing had failed in the chat he opened. The toast list was derived
 * from EVERY run in the store, so a failed run of another chat (or one read
 * back from disk when a chat is hydrated) toasted on every switch.
 */
function run(over: Partial<AgentRun>): AgentRun {
  return {
    id: 'r1', sessionId: 'chat-a', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'hi',
    status: 'failed', startedAt: 1, endedAt: 2, error: 'authentication required',
    approvals: [], questions: [], items: [],
    ...over,
  } as unknown as AgentRun;
}
const state = (runs: AgentRun[]): AgentRunsState => ({ runs, dismissed: new Set() }) as AgentRunsState;

describe('toasts are scoped to the chat being read', () => {
  it('a failed signIn run in chat A raises no toast once chat B is open', () => {
    const s = state([run({})]);
    expect(toastsFor(s, () => false, 3, 'chat-a').map((t) => t.kind)).toEqual(['error']);
    expect(toastsFor(s, () => false, 3, 'chat-b')).toEqual([]);
  });
  it('a failure read back from disk never toasts, even in its own chat', () => {
    expect(toastsFor(state([run({ restored: true })]), () => false, 3, 'chat-a')).toEqual([]);
  });
  it('a pending approval still toasts from any chat (nothing may be silently stuck)', () => {
    const r = run({ status: 'running', error: undefined, approvals: [{ requestId: 'q', decision: null }] as never });
    expect(toastsFor(state([r]), () => false, 3, 'chat-b').map((t) => t.kind)).toEqual(['approval']);
  });
});
