/*
 * A RUN WITH NO AGENT CONNECTED SAYS SO IN PLAIN WORDS AND OFFERS THE WAY OUT
 * (agentRunner NO_AGENT_TEXT). The card has no CLI command in it, and its two
 * actions are Connect an agent (Settings on the agents pane) and Set up in chat
 * (drafts the setup prompt into the composer, sends nothing).
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import { agentSetupPrompt } from '../onboarding/agentSetupPrompt';
import { StoreProvider, createStore } from '../state';
import { RecoveryCard } from './RecoveryCard';

afterEach(() => cleanup());

async function noAgentRun() {
  const store = createAgentRunStore({ fetch: async () => new Response(JSON.stringify({ agents: [] })) });
  return store.start({ question: 'hi' });
}

describe('a run with no agent connected', () => {
  it('shows no CLI command, in the card or in its details', async () => {
    const run = await noAgentRun();
    const app = createStore({});
    render(
      <StoreProvider store={app}>
        <RecoveryCard run={run} />
      </StoreProvider>,
    );
    const card = screen.getByTestId('agent-recovery');
    expect(card.textContent).toContain('No agent is connected yet.');
    expect(card.textContent).not.toMatch(/sequence agent/);
    expect(card.textContent).not.toMatch(/--command/);
    expect(run.error).not.toMatch(/sequence agent|--command/);
  });

  it('offers Connect an agent, which opens Settings on the agents pane', async () => {
    const run = await noAgentRun();
    const app = createStore({});
    const dispatch = vi.spyOn(app, 'dispatch');
    render(
      <StoreProvider store={app}>
        <RecoveryCard run={run} />
      </StoreProvider>,
    );
    const card = screen.getByTestId('agent-recovery');
    fireEvent.click(within(card).getByTestId('agent-recovery-connect'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'agents' } });
  });

  it('offers Set up in chat, which drafts the setup prompt into the composer and sends nothing', async () => {
    const run = await noAgentRun();
    const app = createStore({});
    app.dispatch({ type: 'composer/model', model: { model: 'm', origin: 'api-key' } });
    render(
      <StoreProvider store={app}>
        <RecoveryCard run={run} />
      </StoreProvider>,
    );
    const card = screen.getByTestId('agent-recovery');
    fireEvent.click(within(card).getByTestId('agent-recovery-chat'));
    expect(app.getState().composer.draft).toBe(agentSetupPrompt({ need: 'none' }));
    expect(screen.queryByTestId('agent-recovery-retry')).toBeNull();
  });

  it('with no model connected either, nothing can answer a draft: Copy setup prompt and Connect a model replace Set up in chat', async () => {
    const run = await noAgentRun();
    const app = createStore({});
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void written.push(t) } });
    render(
      <StoreProvider store={app}>
        <RecoveryCard run={run} />
      </StoreProvider>,
    );
    const card = screen.getByTestId('agent-recovery');
    expect(within(card).queryByTestId('agent-recovery-chat')).toBeNull();
    fireEvent.click(within(card).getByTestId('agent-recovery-copy'));
    await waitFor(() => expect(within(card).getByTestId('agent-recovery-copy').textContent).toBe('Copied'));
    expect(written[0]).toBe(agentSetupPrompt({ need: 'none' }));
    expect(app.getState().composer.draft ?? '').toBe('');
    fireEvent.click(within(card).getByTestId('agent-recovery-model'));
    expect(app.getState().shell.overlay).toEqual({ kind: 'settings', pane: 'models' });
  });
});
