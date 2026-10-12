import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createAgentRunStore, type AgentRun, type AgentRunStore } from '../agents/agentRuns';
import { createStore, StoreProvider } from '../state';
import type { Turn } from '../state/types';
import { ChatTranscript } from './ChatTranscript';
import { orderTurnsAndRuns } from './transcriptOrder';
import { transcriptRows } from './VirtualTranscript';

/* E2: a local-model reply (a Turn) sent after an agent run (an AgentRun) drew above that run. */

const turn = (id: string, role: 'user' | 'assistant', at?: number): Turn => ({ id, role, text: id, ...(at === undefined ? {} : { at }) }) as unknown as Turn;

function runAt(runs: AgentRunStore, startedAt: number, sessionId = 's1'): AgentRun {
  void runs.start({ agentRef: 'codex', question: `q${startedAt}`, access: 'ask', sessionId }, () => new Promise<Response>(() => {}));
  const id = runs.get().runs[runs.get().runs.length - 1]!.id;
  runs.patch((s) => ({ ...s, runs: s.runs.map((r) => (r.id === id ? { ...r, startedAt } : r)) }));
  return runs.get().runs.find((r) => r.id === id)!;
}

const newStore = () => createAgentRunStore({ fetch: async () => new Response('{}') });
const keysOf = (rows: ReturnType<typeof transcriptRows>) => rows.map((r) => r.key);

describe('turns and runs in the order they happened', () => {
  it('puts a run between the local turns sent before and after it', () => {
    const run = runAt(newStore(), 300);
    const turns = [turn('u1', 'user', 100), turn('a1', 'assistant', 200), turn('u2', 'user', 500), turn('a2', 'assistant', 600)];
    const keys = keysOf(transcriptRows(turns, [run], null, []));
    expect(keys.slice(0, 2)).toEqual(['turn:u1', 'turn:a1']);
    expect(keys[2]).toBe(`run:${run.id}:head`);
    expect(keys.slice(-2)).toEqual(['turn:u2', 'turn:a2']);
    expect(keys[keys.length - 3]).toBe(`run:${run.id}:foot`);
  });

  it('a run after the last turn follows the plan card (tail), as before', () => {
    const run = runAt(newStore(), 900);
    const keys = keysOf(transcriptRows([turn('u1', 'user', 100), turn('a1', 'assistant', 200)], [run], null, [{ key: 'plan', node: null }]));
    expect(keys.indexOf('tail:plan')).toBe(2);
    expect(keys[3]).toBe(`run:${run.id}:head`);
  });

  it('legacy turns with no timestamp keep today\'s order: every turn, then every run', () => {
    const runs = newStore();
    const a = runAt(runs, 300);
    const b = runAt(runs, 400);
    for (const legacy of [undefined, 0]) {
      const turns = [turn('u1', 'user', legacy), turn('a1', 'assistant', legacy), turn('u2', 'user', legacy)];
      const items = orderTurnsAndRuns(turns, [a, b]);
      expect(items.map((i) => (i.kind === 'turn' ? i.turn.id : i.run.id))).toEqual(['u1', 'a1', 'u2', a.id, b.id]);
    }
  });

  it('two runs around one local exchange stay in their own order', () => {
    const runs = newStore();
    const a = runAt(runs, 100);
    const b = runAt(runs, 400);
    const items = orderTurnsAndRuns([turn('u1', 'user', 200), turn('a1', 'assistant', 250)], [a, b]);
    expect(items.map((i) => (i.kind === 'turn' ? i.turn.id : i.run.id))).toEqual([a.id, 'u1', 'a1', b.id]);
  });
});

describe('the plain transcript draws that order', () => {
  it('renders local reply, agent run, local reply in time order', async () => {
    const runs = newStore();
    const run = runAt(runs, 300);
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 's1', title: 'Mixed', pinned: false, updatedAt: '2026-10-11' }], activeId: 's1' } as never);
    const turns = [turn('u1', 'user', 100), turn('a1', 'assistant', 200), turn('u2', 'user', 500), turn('a2', 'assistant', 600)];
    const { container } = render(
      <StoreProvider store={store}>
        <ChatTranscript turns={turns} renderTurn={(t) => <p key={t.id} data-turn={t.id} />} tail={[]} empty={false} runStore={runs} />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('agent-run')).toBeTruthy());
    const order = [...container.querySelectorAll('[data-turn],[data-testid="agent-run"]')].map((n) => n.getAttribute('data-turn') ?? 'run');
    expect(order).toEqual(['u1', 'a1', 'run', 'u2', 'a2']);
    expect(run.id).toBeTruthy();
  });
});
