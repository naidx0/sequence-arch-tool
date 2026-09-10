/**
 * THE RING READS THE WINDOW, NOT THE BILL — the wire half of B3.4.
 *
 * `turn.usage.inputTokens` is the sum over up to eight provider calls, each of
 * which REBUILT the prompt; `contextBreakdown.totalMeasured` is the
 * provider-reported input of the turn's last call — the only number that is a
 * context-window measurement. A six-round turn used to hand the ring ~150k
 * against a 200k window when no single call cleared 30k, and the composer told
 * the reader to wrap up a conversation that fitted comfortably.
 */
import { describe, expect, it } from 'vitest';

import { composerPropsFrom } from './connect';
import { createStore } from './store';
import type { AppState, AssistantTurn } from './types';

function assistantTurn(overrides: Partial<AssistantTurn>): AssistantTurn {
  return {
    id: 't-a1' as AssistantTurn['id'],
    role: 'assistant',
    replyTo: 't-u1' as AssistantTurn['replyTo'],
    text: 'answer',
    work: [],
    effect: { kind: 'answer' },
    coverage: null,
    evidence: { files: [], boardIds: [] } as unknown as AssistantTurn['evidence'],
    usage: null,
    metrics: null,
    contextBreakdown: null,
    advisor: null,
    diagram: null,
    source: 'provider',
    runId: null,
    failure: null,
    at: 1,
    ...overrides,
  };
}

function withTurns(state: AppState, turns: AssistantTurn[]): AppState {
  return { ...state, session: { ...state.session, turns } };
}

describe('contextUsed — last call, not the bill (B3.4 wire half)', () => {
  it('prefers contextBreakdown.totalMeasured over the summed usage', () => {
    const store = createStore();
    const turn = assistantTurn({
      usage: { inputTokens: 150_000, outputTokens: 900, estimated: false },
      contextBreakdown: {
        sections: [],
        totalApprox: 24_000,
        totalMeasured: 27_640,
      },
    });
    const props = composerPropsFrom(withTurns(store.getState(), [turn]), store);
    expect(props.contextUsed).toBe(27_640);
  });

  it('falls back to usage for turns metered before the breakdown existed', () => {
    const store = createStore();
    const turn = assistantTurn({
      usage: { inputTokens: 9_100, outputTokens: 200, estimated: false },
    });
    const props = composerPropsFrom(withTurns(store.getState(), [turn]), store);
    expect(props.contextUsed).toBe(9_100);
  });

  it('reports null, never zero, when nothing was metered', () => {
    const store = createStore();
    const props = composerPropsFrom(withTurns(store.getState(), []), store);
    expect(props.contextUsed).toBeNull();
  });
});
