import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FailoverWatch } from './FailoverWatch';
import { FAILOVER_KEY, RETRY_PRIMARY_MS, saveFailover } from './agentFailover';
import { createAgentRunStore } from './agentRuns';

const NOW = Date.parse('2026-10-21T04:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe('FailoverWatch', () => {
  it('five hours after switching off, a ready primary gets the chat back', async () => {
    saveFailover(localStorage, {
      format: { primary: 'claude', backup: 'codex' },
      off: { from: 'claude', at: NOW, chats: ['s1'] },
    });
    const store = createAgentRunStore({ clock: () => NOW });
    store.patch((s) => ({ ...s, agents: { s1: 'codex' } }));
    const f = vi.fn(async (url: string) => {
      if (url === '/api/onboarding/providers') {
        return new Response(JSON.stringify({ providers: [{ id: 'claude', state: 'ready' }, { id: 'codex', state: 'ready' }] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    });
    render(<FailoverWatch store={store} clock={() => Date.now()} fetch={f as typeof fetch} />);
    expect(store.get().agents?.s1).toBe('codex');
    await act(async () => void (await vi.advanceTimersByTimeAsync(RETRY_PRIMARY_MS)));
    expect(f).toHaveBeenCalled();
    expect(store.get().agents?.s1).toBe('claude');
    expect(JSON.parse(String(localStorage.getItem(FAILOVER_KEY))).off).toBeNull();
  });

  it('five hours later a still-spent primary stays on the backup and waits another five hours', async () => {
    saveFailover(localStorage, {
      format: { primary: 'claude', backup: 'codex' },
      off: { from: 'claude', at: NOW, chats: ['s1'] },
    });
    const store = createAgentRunStore({ clock: () => NOW });
    store.patch((s) => ({ ...s, agents: { s1: 'codex' } }));
    const f = vi.fn(async () => new Response(JSON.stringify({ providers: [{ id: 'claude', state: 'limited' }, { id: 'codex', state: 'ready' }] }), { status: 200 }));
    render(<FailoverWatch store={store} clock={() => Date.now()} fetch={f as typeof fetch} />);
    await act(async () => void (await vi.advanceTimersByTimeAsync(RETRY_PRIMARY_MS)));
    expect(store.get().agents?.s1).toBe('codex');
    expect(JSON.parse(String(localStorage.getItem(FAILOVER_KEY))).off.at).toBe(NOW + RETRY_PRIMARY_MS);
  });
});
