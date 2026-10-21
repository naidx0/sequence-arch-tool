import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCallbacks } from '../chat/AgentRunsPane';
import { RecoveryCard } from '../chat/RecoveryCard';
import { createStore } from '../state';
import { createAgentRunStore, type AgentRun } from './agentRuns';

/* A turn that ended on a usage limit continues by itself when the limit resets: once, for the newest turn, never at once. */

const NOW = Date.parse('2026-10-09T12:00:00Z');
const limited = (resetsAt: number, over: Partial<AgentRun> = {}): AgentRun =>
  ({ id: 'r1', sessionId: 's', agentRef: 'codex', nodeId: null, nodeLabel: null, prompt: 'build it', status: 'failed', startedAt: 1, endedAt: 2, items: [], approvals: [], error: 'limit', recovery: { kind: 'wait', resetsAt, provider: 'codex' }, retry: { question: 'build it', agentRef: 'codex', sessionId: 's' }, ...over }) as AgentRun;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('the card', () => {
  it('says it continues, and asks to rerun only at the reset (plus 5 s)', async () => {
    const onRetry = vi.fn(async () => true);
    render(<RecoveryCard run={limited(NOW + 60_000)} onRetry={onRetry} />);
    expect(screen.getByTestId('agent-recovery').textContent).toMatch(/^Usage limit, resets .*Continues then/);
    await act(async () => void (await vi.advanceTimersByTimeAsync(64_000)));
    expect(onRetry).not.toHaveBeenCalled();
    await act(async () => void (await vi.advanceTimersByTimeAsync(2_000)));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), { auto: true });
    expect(screen.getByTestId('agent-recovery-retried').textContent).toBe('Continuing below');
    await act(async () => void (await vi.advanceTimersByTimeAsync(600_000)));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('when nothing was sent (another window sent it, or not the newest turn) it stops saying it will', async () => {
    const onRetry = vi.fn(async () => false);
    render(<RecoveryCard run={limited(NOW + 10_000)} onRetry={onRetry} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(16_000)));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('agent-recovery-auto')).toBeNull();
    expect(screen.queryByTestId('agent-recovery-retried')).toBeNull();
  });

  it('a reset that is already past, or a stale one, schedules nothing: no instant fire, no loop', async () => {
    const onRetry = vi.fn(async () => true);
    render(<RecoveryCard run={limited(NOW - 1_000)} onRetry={onRetry} />);
    render(<RecoveryCard run={limited(NOW + 60_000, { endedAt: NOW + 120_000 })} onRetry={onRetry} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(600_000)));
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("Don't tells the store and cancels; a run already declined schedules nothing", async () => {
    const onRetry = vi.fn(async () => true);
    render(<RecoveryCard run={limited(NOW + 60_000)} onRetry={onRetry} />);
    fireEvent.click(screen.getByTestId('agent-recovery-auto-cancel'));
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), { declineAuto: true });
    expect(screen.getByTestId('agent-recovery-declined').textContent).toBe("Won't continue by itself");
    onRetry.mockClear();
    await act(async () => void (await vi.advanceTimersByTimeAsync(120_000)));
    expect(onRetry).not.toHaveBeenCalled();
    render(<RecoveryCard run={limited(NOW + 60_000, { id: 'r2', autoDeclined: true })} onRetry={onRetry} />);
    expect(screen.queryAllByTestId('agent-recovery-auto')).toHaveLength(0);
  });

  it('a spent primary with a ready backup switches now, and does not wait for the vendor reset', async () => {
    const onRetry = vi.fn(async () => true);
    render(
      <RecoveryCard
        run={limited(NOW + 60_000, { agentRef: 'claude', recovery: { kind: 'wait', resetsAt: NOW + 60_000, provider: 'claude' } })}
        onRetry={onRetry}
        failover={{ state: { format: { primary: 'claude', backup: 'codex' }, off: null }, readyAgents: ['codex'] }}
      />,
    );
    expect(screen.getByTestId('agent-recovery-failover').textContent).toBe('Using Codex. Claude is tried again every 5 hours.');
    expect(screen.queryByTestId('agent-recovery-auto')).toBeNull();
    await act(async () => void (await Promise.resolve()));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), { failoverTo: 'codex' });
    await act(async () => void (await vi.advanceTimersByTimeAsync(70_000)));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('the callbacks (what sends)', () => {
  function setup(claims: boolean[]) {
    const bodies: unknown[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/acp/auto-resume') {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ claimed: claims.shift() ?? false, declined: true }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', f);
    const store = createAgentRunStore({ clock: () => 1000, fetch: f as never });
    const start = vi.spyOn(store, 'start').mockResolvedValue(undefined as never);
    return { store, start, bodies, cb: runCallbacks(store, createStore({})) };
  }

  it('only the newest limited turn reruns, and only when the server hands this page the claim', async () => {
    const { store, start, bodies, cb } = setup([true, false]);
    const older = limited(NOW + 1000, { id: 'old' });
    const newest = limited(NOW + 1000, { id: 'new', startedAt: 3 });
    store.hydrate('s', [older, newest]);
    expect(await cb.onRetry(older, { auto: true })).toBe(false);
    expect(bodies).toEqual([]);
    expect(await cb.onRetry(newest, { auto: true })).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(bodies).toEqual([{ chatId: 's', resetsAt: NOW + 1000 }]);
    /* The same limit asked for again (a second window, a remount) is refused by the server. */
    const again = limited(NOW + 1000, { id: 'new2', startedAt: 4 });
    store.patch((st) => ({ ...st, runs: [...st.runs, again] }));
    expect(store.get().runs.at(-1)?.id).toBe('new2');
    expect(await cb.onRetry(again, { auto: true })).toBe(false);
    expect(bodies).toHaveLength(2);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('a spent primary with a backup starts the backup now, not at the vendor reset', async () => {
    const { store, start, bodies, cb } = setup([]);
    const run = limited(NOW + 60_000, { agentRef: 'claude', recovery: { kind: 'wait', resetsAt: NOW + 60_000, provider: 'claude' }, retry: { question: 'build it', agentRef: 'claude', sessionId: 's' } });
    store.hydrate('s', [run]);
    expect(await cb.onRetry(run, { failoverTo: 'codex' })).toBe(true);
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ agentRef: 'codex', question: 'build it', sessionId: 's' }));
    expect(store.get().agents?.s).toBe('codex');
    expect(bodies).toEqual([]);
  });

  it("Don't is kept in the run and told to the server", async () => {
    const { store, bodies, cb } = setup([]);
    const run = limited(NOW + 1000);
    store.hydrate('s', [run]);
    await cb.onRetry(run, { declineAuto: true });
    expect(store.get().runs.find((r) => r.id === 'r1')?.autoDeclined).toBe(true);
    expect(bodies).toEqual([{ chatId: 's', resetsAt: NOW + 1000, decline: true }]);
    expect(await cb.onRetry(store.get().runs[0]!, { auto: true })).toBe(false);
  });
});
