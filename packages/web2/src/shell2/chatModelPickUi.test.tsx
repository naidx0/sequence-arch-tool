import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { chatPick } from '../agents/chatConfig';
import { resetSignInState } from '../onboarding/signInState';
import { StoreProvider, createStore } from '../state';
import { ModelMenu } from './ModelMenu';

/* The real menu, clicked: a pick made in chat B is B's own, even when chat A already holds the same pick.
   (The store-level cases are in agents/chatModelPersistence.test.ts; this one is the UI lock.) */

const MODELS = [
  { id: 'opus', name: 'Opus', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
  { id: 'sonnet', name: 'Sonnet', efforts: ['low', 'medium', 'high'], defaultEffort: 'low' },
];

beforeEach(() => {
  resetSignInState();
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      const json = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
      if (url === '/api/acp/agents') return json({ agents: [{ id: 'claude', label: 'claude' }] });
      if (url.startsWith('/api/onboarding/providers')) return json({ providers: [{ id: 'claude', label: 'Claude', installed: true, version: '1', state: 'ready', plan: 'Max', signInCommand: 'claude login', installHint: '' }] });
      if (url.startsWith('/api/acp/capabilities')) return json({ agentRef: 'claude', models: MODELS, efforts: [], commands: [], skills: [] });
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
  agentRuns.patch((s) => ({ ...s, runs: [], agents: { A: 'claude', B: 'claude' }, caps: {}, config: {}, chatConfig: { A: { model: 'sonnet', effort: 'high' } }, capsError: {}, registered: undefined }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const menu = (sessionId: string) => (
  <StoreProvider store={createStore({})}>
    <ModelMenu
      wrapRef={createRef<HTMLDivElement>()}
      open={true}
      onTrigger={() => {}}
      onClose={() => {}}
      sessionId={sessionId}
      agentRun="claude"
      profiles={[]}
      pickModel={() => {}}
      modelErr={null}
      effort="medium"
      effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
      pickEffort={() => {}}
      modelChip="Claude"
      modelChipShort="Claude"
      modelChipTitle="Claude"
      effortLabel="Medium"
      modes={[]}
      currentMode="plan"
      onMode={() => {}}
    />
  </StoreProvider>
);

const on = () => screen.getAllByTestId('agent-effort').find((e) => e.getAttribute('data-on') === 'true')?.getAttribute('data-effort');
const effortDot = (key: string) => screen.getAllByTestId('agent-effort').find((e) => e.getAttribute('data-effort') === key)!;
async function pickModel(id: string) {
  fireEvent.click(await screen.findByTestId('s2-agent-row'));
  const flyout = await screen.findByTestId('s2-agent-flyout');
  fireEvent.click(within(flyout).getAllByTestId('agent-model').find((m) => m.getAttribute('data-model') === id)!);
}

describe('the model menu writes and reads each chat\'s own pick', () => {
  it('B picks Sonnet and High through the menu while A holds the same: B keeps them, and the effort rows follow the chat', async () => {
    const view = render(menu('B'));
    await screen.findAllByTestId('agent-effort');
    /* B has no pick: its effort is the default model's, not A's High */
    await waitFor(() => expect(on()).toBe('medium'));
    await pickModel('sonnet');
    await waitFor(() => expect(agentRuns.get().chatConfig?.B?.model).toBe('sonnet'));
    expect(on()).toBe('low');
    fireEvent.click(effortDot('high'));
    await waitFor(() => expect(agentRuns.get().chatConfig?.B).toEqual({ model: 'sonnet', effort: 'high' }));
    expect(chatPick(agentRuns.get(), 'claude', 'A')).toEqual({ model: 'sonnet', effort: 'high' });

    /* A moves to Low; the rows show the open chat's effort as the chats swap */
    view.rerender(menu('A'));
    await waitFor(() => expect(on()).toBe('high'));
    fireEvent.click(effortDot('low'));
    await waitFor(() => expect(agentRuns.get().chatConfig?.A?.effort).toBe('low'));
    expect(agentRuns.get().chatConfig?.B?.effort).toBe('high');
    view.rerender(menu('B'));
    await waitFor(() => expect(on()).toBe('high'));
    view.rerender(menu('A'));
    await waitFor(() => expect(on()).toBe('low'));
  });
});

describe('effort rows with a dead model, and with no chat', () => {
  it('picking an effort clears a saved model the agent no longer offers, and the pill lights', async () => {
    agentRuns.patch((s) => ({ ...s, chatConfig: { B: { model: 'retired', effort: 'high' } } }));
    render(menu('B'));
    await screen.findAllByTestId('agent-effort');
    await waitFor(() => expect(Object.keys(agentRuns.get().caps ?? {})).toContain('claude'));
    await waitFor(() => expect(on()).toBe('medium'));
    fireEvent.click(effortDot('low'));
    await waitFor(() => expect(agentRuns.get().chatConfig?.B?.model).toBeUndefined());
    expect(agentRuns.get().chatConfig?.B?.effort).toBe('low');
    await waitFor(() => expect(on()).toBe('low'));
  });

  it('with no chat open the rows follow the agent\'s own config, like the chip', async () => {
    agentRuns.patch((s) => ({ ...s, config: { claude: { model: 'sonnet', effort: 'high' } } }));
    render(menu(''));
    await screen.findAllByTestId('agent-effort');
    await waitFor(() => expect(on()).toBe('high'));
    expect(agentRuns.get().chatConfig?.['']).toBeUndefined();
  });
});
