import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import '../agents/agentRunFold';
import { createStore } from '../state';
import { V3App } from './V3App';

afterEach(() => vi.unstubAllGlobals());

describe('the composer chip and the chat\'s agent', () => {
  it('"Codex · <mode>" on the chip once Codex has run in the open chat, never "Connect agent"; it stays: the chat talks to Codex now', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 'chip-chat', title: 'Chip', pinned: false, updatedAt: '2026-01-01' }], activeId: 'chip-chat' } as never);
    render(<V3App appStore={store} />);
    const chip = screen.getByTestId('v3-model-trigger');
    const name = () => chip.querySelector('.s2-pill-l')?.textContent;
    expect(name()).toBe('Connect agent');
    /* A run in another chat does not take this chat's chip. */
    await act(async () => {
      void agentRuns.start({ agentRef: 'claude', question: 'q', access: 'ask', sessionId: 'other-chat' }, () => new Promise<Response>(() => {}));
    });
    expect(name()).toBe('Connect agent');
    await act(async () => {
      void agentRuns.start({ agentRef: 'codex', question: 'q', access: 'ask', sessionId: 'chip-chat' }, () => new Promise<Response>(() => {}));
    });
    /* Round 7 (A3): the pill names the agent's MODEL (the agent's mark is its icon), and
       "Default model" until codex has said which (modelMenu.test.tsx covers the naming). */
    expect(name()).toBe('Default model');
    /* Round 10: the mode is the chip's first icon (its word is for screen readers) and is set in the
       one popup; the chip names the agent. */
    expect(['Ask', 'Auto-edit', 'Full access', 'Plan', 'Teach']).toContain(screen.getByTestId('v3-mode-label').textContent);
    expect(chip.getAttribute('data-action')).toBe('agent');
    expect(chip.getAttribute('aria-label')).toMatch(/Agent: codex, model: Default model, reasoning /);
    const id = agentRuns.get().runs.find((r) => r.sessionId === 'chip-chat')!.id;
    act(() => agentRuns.apply(id, { type: 'acp:result', stopReason: 'end_turn', text: 'Done.' }));
    /* S2b: the run ended, the chat still talks to Codex (its composer sends there) until a model is picked. */
    expect(name()).toBe('Default model');
    expect(chip.getAttribute('data-action')).toBe('agent');
    act(() => agentRuns.patch((s) => ({ ...s, agents: { ...s.agents, 'chip-chat': '' } })));
    expect(name()).toBe('Connect agent');
    expect(chip.getAttribute('data-action')).toBe('connect');
  });
});
