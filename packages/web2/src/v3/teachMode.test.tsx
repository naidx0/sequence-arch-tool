import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import '../agents/agentRunFold';
import { createStore } from '../state';
import { V3App } from './V3App';

/*
 * I3: Teach is reachable without knowing the phrase. It is a row of the composer's mode popup and a
 * `/teach` command, and either one turns the teach flag on so the next ask carries `teach: true`.
 * On an agent (ACP) chat Teach is not offered as a mode that works: the notice says so and no flag is set.
 */

type Json = Record<string, unknown>;
let asks: Json[] = [];
let agentPosts: Json[] = [];

beforeEach(() => {
  asks = [];
  agentPosts = [];
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/ask')) {
        asks.push(JSON.parse(String(init?.body)) as Json);
        return new Promise<Response>(() => {});
      }
      if (url.startsWith('/api/acp/run-node')) {
        agentPosts.push(JSON.parse(String(init?.body)) as Json);
        return new Promise<Response>(() => {});
      }
      return new Promise<Response>(() => {});
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  agentRuns.patch((s) => ({ ...s, agents: {}, caps: {}, config: {} }));
});

function app(chat: string) {
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [{ id: chat, title: 'Chat', pinned: false, updatedAt: '2026-01-01' }], activeId: chat } as never);
  render(<V3App appStore={store} />);
  return store;
}

const sendText = async (text: string) => {
  const field = screen.getByTestId('composer-field');
  fireEvent.change(field, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(field, { key: 'Enter' });
    await Promise.resolve();
  });
};

describe('Teach is reachable from the mode popup and /teach', () => {
  it('the mode popup has a Teach row; picking it sets the teach flag and the chip says Teach', async () => {
    const store = app('teach-pop');
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    const menu = screen.getByTestId('s2-quickmode-menu');
    expect(Array.from(menu.querySelectorAll('[role="menuitemradio"]')).map((r) => r.getAttribute('data-testid'))).toContain('s2-quickmode-teach');
    fireEvent.click(screen.getByTestId('s2-quickmode-teach'));
    await waitFor(() => expect(store.getState().composer.teach).toBe(true));
    expect(store.getState().composer.permission.mode).toBe('plan');
    expect(screen.getByTestId('v3-mode-label').textContent).toBe('Teach');
  });

  it('picking Teach then asking sends teach:true in the ask body', async () => {
    app('teach-ask');
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    fireEvent.click(screen.getByTestId('s2-quickmode-teach'));
    await sendText('how does the router work');
    await waitFor(() => expect(asks.length).toBeGreaterThan(0));
    expect(asks.at(-1)!.teach).toBe(true);
  });

  it('picking another mode afterwards turns Teach off again', async () => {
    const store = app('teach-off');
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    fireEvent.click(screen.getByTestId('s2-quickmode-teach'));
    await waitFor(() => expect(store.getState().composer.teach).toBe(true));
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    fireEvent.click(screen.getByTestId('s2-quickmode-smart'));
    await waitFor(() => expect(store.getState().composer.teach).toBe(false));
  });

  it('/teach does the same as the popup row', async () => {
    const store = app('teach-slash');
    const field = screen.getByTestId('composer-field');
    fireEvent.change(field, { target: { value: '/teach' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
      await Promise.resolve();
    });
    await waitFor(() => expect(store.getState().composer.teach).toBe(true));
    await sendText('explain the store');
    await waitFor(() => expect(asks.length).toBeGreaterThan(0));
    expect(asks.at(-1)!.teach).toBe(true);
  });

  it('on an agent chat Teach says it runs on the built-in model and sets no flag', async () => {
    const store = app('teach-acp');
    await act(async () => {
      void agentRuns.start({ agentRef: 'codex', question: 'first', access: 'ask', sessionId: 'teach-acp' }, () => new Promise<Response>(() => {}));
    });
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    fireEvent.click(screen.getByTestId('s2-quickmode-teach'));
    const note = await screen.findByTestId('s2-mode-note');
    expect(note.textContent).toContain('Teach runs on the built-in model');
    expect(store.getState().composer.teach).toBe(false);
    expect(asks).toHaveLength(0);
    expect(JSON.stringify(agentPosts)).not.toContain('"teach"');
  });
});
