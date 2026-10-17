import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readGolden, replayFetch } from '../../test/support/replaySse';
import { activeAgentModel } from '../agents/activeModel';
import { agentRuns, type AgentCaps } from '../agents/agentRuns';
import '../agents/agentRunFold';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';

/*
 * ROUND 7, A3: "In terms of Codex, it doesn't tell you which model you're
 * using." The model pill and the status bar name the model the agent said it
 * runs on (codex thread/start's `model`, carried as acp:model), the person's
 * pick when there is one, the agent's listed default otherwise, and "Default
 * model" before any of these is known. Never an invented name.
 */

const CHAT = 'model-chat';
const caps = (models: AgentCaps['models']): AgentCaps => ({ models, efforts: [], commands: [], skills: [], slash: [] });

beforeEach(() => {
  localStorage.clear();
  agentRuns.patch((s) => ({ ...s, runs: [], agents: {}, caps: {}, config: {}, capsError: {} }));
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  /* Capabilities answer (an error) so no ask is left in flight for the next test; everything else waits. */
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      String(input).startsWith('/api/acp/capabilities') ? Promise.resolve(new Response('{}', { status: 404 })) : new Promise<Response>(() => {}),
    ),
  );
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [{ id: CHAT, title: 'Model', pinned: false, updatedAt: '2026-01-01' }], activeId: CHAT } as never);
  render(<V3App appStore={store} />);
  return () => screen.getByTestId('v3-model-trigger').querySelector('.s2-pill-l')?.textContent;
}

describe('the agent model pill and status bar', () => {
  /* 0.1.5 review: "Default model" read as a model of its own; until codex says which, the pill and the bar say whose default it is. */
  it('says "Codex default" until codex says which model, then names it in the pill and the status bar', async () => {
    const label = mount();
    const { fetch } = replayFetch(readGolden('edit-with-plan'));
    let started!: Promise<unknown>;
    act(() => {
      agentRuns.patch((s) => ({ ...s, agents: { ...s.agents, [CHAT]: 'codex' } }));
    });
    expect(label()).toBe('Codex default');
    expect(screen.getByTestId('s2-status-model').textContent).toBe('Default model');
    await act(async () => {
      started = agentRuns.start({ agentRef: 'codex', question: 'go', access: 'ask', sessionId: CHAT }, fetch);
      await started;
    });
    /* The model codex's thread/start answered with, as recorded live. */
    expect(label()).toBe('GPT-5.6 Terra');
    expect(screen.getByTestId('v3-model-trigger').getAttribute('data-model-source')).toBe('session');
    expect(screen.getByTestId('s2-status-model').textContent).toBe('GPT-5.6 Terra');

    /* With codex's model list, the display name it gives. */
    act(() => agentRuns.patch((s) => ({ ...s, caps: { codex: caps([{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', efforts: [] }, { id: 'gpt-5', name: 'GPT-5', efforts: [] }]) } })));
    expect(label()).toBe('GPT-5.6 Terra');

    /* The person's pick wins: it goes on every turn. */
    act(() => agentRuns.patch((s) => ({ ...s, chatConfig: { [CHAT]: { model: 'gpt-5' } } })));
    expect(label()).toBe('GPT-5');
    expect(screen.getByTestId('v3-model-trigger').getAttribute('data-model-source')).toBe('chosen');
  });
});

describe('activeAgentModel', () => {
  const run = (over: Record<string, unknown>) => ({ id: 'r', agentRef: 'codex', sessionId: CHAT, model: null, ...over }) as never;
  it('chosen, then the session\'s, then the listed default, then "<Agent> default"', () => {
    const base = { runs: [] as never[], caps: {}, config: {} };
    expect(activeAgentModel(base, 'codex', CHAT)).toEqual({ id: null, label: 'Codex default', source: 'unknown' });
    const withDefault = { ...base, caps: { codex: caps([{ id: 'a', name: 'A', efforts: [] }, { id: 'b', name: 'B', efforts: [], isDefault: true }, { id: 'zz', name: 'zz', efforts: [] }]) } };
    expect(activeAgentModel(withDefault, 'codex', CHAT)).toEqual({ id: 'b', label: 'B', source: 'default' });
    const said = { ...withDefault, runs: [run({ model: 'a' }), run({ model: 'x', sessionId: 'other' })] };
    expect(activeAgentModel(said, 'codex', CHAT)).toEqual({ id: 'a', label: 'A', source: 'session' });
    expect(activeAgentModel({ ...said, chatConfig: { [CHAT]: { model: 'zz' } } }, 'codex', CHAT)).toEqual({ id: 'zz', label: 'zz', source: 'chosen' });
    /* another chat's pick, and the agent's last pick, are not this chat's */
    expect(activeAgentModel({ ...said, chatConfig: { other: { model: 'zz' } }, config: { codex: { model: 'zz' } } }, 'codex', CHAT)).toEqual({ id: 'a', label: 'A', source: 'session' });
    expect(activeAgentModel(said, 'claude', CHAT).label).toBe('Claude default');
  });
});

describe('an agent that cannot list its models', () => {
  it('the menu says why once and offers Retry; reopening does not ask again', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.startsWith('/api/acp/capabilities')) return new Response(JSON.stringify({ error: 'the agent could not say what it offers: codex exited (code 1)' }), { status: 502 });
        return new Promise<Response>(() => {});
      }),
    );
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: CHAT, title: 'Model', pinned: false, updatedAt: '2026-01-01' }], activeId: CHAT } as never);
    agentRuns.patch((s) => ({ ...s, agents: { [CHAT]: 'codex' } }));
    render(<V3App appStore={store} />);
    await act(async () => {
      screen.getByTestId('v3-model-trigger').click();
      await new Promise((r) => setTimeout(r, 20));
    });
    /* The agent's row opens its models (and, where they could not be read, the reason) to its right. */
    const agentRow = await screen.findByTestId('s2-agent-row');
    await act(async () => {
      agentRow.click();
    });
    const err = await screen.findByTestId("s2-model-caps-error");
    expect(err.querySelector('.failure-note-say')?.textContent).toBe("This agent's models could not be loaded.");
    expect(err.textContent).toContain('codex exited (code 1)');
    const asked = () => calls.filter((c) => c.startsWith('/api/acp/capabilities')).length;
    const before = asked();
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        screen.getByTestId('v3-model-trigger').click();
        await new Promise((r) => setTimeout(r, 5));
      });
    }
    expect(asked()).toBe(before);
    await act(async () => {
      if (!screen.queryByTestId('s2-model-caps-retry')) screen.getByTestId('v3-model-trigger').click();
      await new Promise((r) => setTimeout(r, 5));
    });
    await act(async () => {
      const row = screen.getByTestId('s2-agent-row');
      if (row.getAttribute('aria-expanded') !== 'true') row.click();
    });
    await act(async () => {
      screen.getByTestId('s2-model-caps-retry').click();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(asked()).toBe(before + 1);
    expect(calls.filter((c) => c.includes('refresh=1'))).toHaveLength(1);
  });
});

describe('the model label is marked by the observer, not by a forced layout at mount', () => {
  it('mounting reads no width off the label until its ResizeObserver reports', () => {
    const made: ((entries?: never[]) => void)[] = [];
    class RO {
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(cb: (entries?: never[]) => void) {
        made.push(cb);
      }
    }
    vi.stubGlobal('ResizeObserver', RO);
    const reads = vi.spyOn(Element.prototype, 'scrollWidth', 'get');
    try {
      mount();
      const onLabel = () => reads.mock.contexts.filter((el) => (el as Element).closest?.('[data-testid="v3-model-label"]')).length;
      expect(onLabel()).toBe(0);
      /* Positive control: the observers' reports do read it. */
      act(() => made.forEach((cb) => cb([])));
      expect(onLabel()).toBeGreaterThan(0);
    } finally {
      reads.mockRestore();
    }
  });
});
