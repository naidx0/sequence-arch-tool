import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadChatLazies } from '../../test/preloadChat';

import { agentRuns } from '../agents/agentRuns';
import { createStore, StoreProvider } from '../state';
import { V3Chat } from '../v3/V3Chat';
import { askPanelLine, Whiteboard } from '../whiteboard/Whiteboard';
import { NOT_RUN_NO_MODEL } from './transcriptModel';

/* P0-4: A BLOCKED ASK IS KEPT AND RUNS AFTER CONNECT.
   Driven through the real send path (composer, connect, askClient) against a
   server that refuses the first ask with 400 `fix: 'provider'` and, once a
   model is saved, answers. The person types once. */

const REFUSAL = 'AI provider not configured — connect your AI key in Settings to chat';

interface Server {
  asks: string[];
  saved: unknown[];
}

function server(opts: { providers: unknown[]; ollama: boolean }): Server {
  const s: Server = { asks: [], saved: [] };
  let configured = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('/api/ask/stream')) {
        s.asks.push((JSON.parse(String(init?.body)) as { question: string }).question);
        if (!configured) return json({ error: REFUSAL, fix: 'provider' }, 400);
        return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      if (url.startsWith('/api/onboarding/providers')) return json({ providers: opts.providers });
      if (url === '/api/ai-config' && method === 'GET') {
        return json({
          profiles: configured ? [{ id: 'saved-1', name: 'Qwen3', provider: 'openai-compatible', model: 'qwen3:8b', baseUrl: 'http://127.0.0.1:11434/v1' }] : [],
          ...(configured ? { model: 'qwen3:8b', activeProfileId: 'saved-1' } : {}),
          localProviders: opts.ollama ? [{ name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen3:8b'] }] : [],
        });
      }
      if (url === '/api/ai-config' && method === 'PUT') {
        s.saved.push(JSON.parse(String(init?.body)));
        configured = true;
        return json({ ok: true });
      }
      if (url === '/api/acp/agents' && method === 'GET') return json({ agents: [] });
      if (url === '/api/acp/agents/connect') return json({ ok: true });
      return json({}, 404);
    }),
  );
  return s;
}

async function typeAndSend(text: string) {
  const field = screen.getByTestId('composer-field');
  fireEvent.change(field, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(field, { key: 'Enter' });
  });
}

function mount() {
  const store = createStore({});
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat />
      </div>
    </StoreProvider>,
  );
  return store;
}

beforeAll(preloadChatLazies, 120_000);

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Connect a model to run this', () => {
  it('type a question, connect a model from the card, and the same question runs without retyping', async () => {
    const s = server({ providers: [{ id: 'claude', label: 'Claude Code', installed: false, version: null, state: 'install', signInCommand: 'claude auth login', installHint: 'npm i -g x' }], ollama: true });
    mount();
    await typeAndSend('what does the gateway call?');
    expect(s.asks).toEqual(['what does the gateway call?']);

    /* ONE card, no dead-end banner: the old notice and the raw server sentence are gone from the chat. */
    const card = await screen.findByTestId('connect-to-run');
    expect(screen.getAllByTestId('connect-to-run')).toHaveLength(1);
    expect(screen.getByTestId('connect-to-run-text').textContent).toContain('Connect a model to run this');
    expect(screen.queryByTestId('s2-failure')).toBeNull();
    expect(document.body.textContent).not.toContain('AI provider not configured');

    /* The connect flow opens in place, inside the card. */
    fireEvent.click(screen.getByTestId('connect-to-run-open'));
    const use = await screen.findByTestId('first-run-use-ready');
    expect(card.contains(use)).toBe(true);
    expect(use.textContent).toBe('Use qwen3:8b');
    expect((screen.getByTestId('composer-field') as HTMLTextAreaElement).value).toBe('');
    await act(async () => {
      fireEvent.click(use);
    });

    /* The kept question went out again by itself, and the card is gone. */
    await waitFor(() => expect(s.asks).toEqual(['what does the gateway call?', 'what does the gateway call?']));
    expect(JSON.stringify(s.saved)).toContain('qwen3:8b');
    await waitFor(() => expect(screen.queryByTestId('connect-to-run')).toBeNull());
  });

  it('connecting a ready agent from the card gives the chat that agent and runs the kept question on it', async () => {
    server({ providers: [{ id: 'claude', label: 'Claude Code', installed: true, version: '2.1.4', state: 'ready', signInCommand: 'claude auth login', installHint: 'x' }], ollama: false });
    const started: { agentRef?: string; question?: string }[] = [];
    vi.spyOn(agentRuns, 'start').mockImplementation(async (o) => {
      started.push({ agentRef: o.agentRef, question: o.question });
      return {} as never;
    });
    const store = mount();
    await typeAndSend('explain the queue');
    fireEvent.click(await screen.findByTestId('connect-to-run-open'));
    const use = await screen.findByTestId('first-run-use-ready');
    expect(use.textContent).toBe('Use Claude Code');
    await act(async () => {
      fireEvent.click(use);
    });
    await waitFor(() => expect(started).toEqual([{ agentRef: 'claude', question: 'explain the queue' }]));
    expect(agentRuns.get().agents?.[store.getState().session.activeId ?? '']).toBe('claude');
    expect(screen.queryByTestId('connect-to-run')).toBeNull();
  });

  it('the pending ask stays with its own chat: away it is hidden and never replayed, back there it runs (with the agent on that chat)', async () => {
    server({ providers: [{ id: 'claude', label: 'Claude Code', installed: true, version: '2.1.4', state: 'ready', signInCommand: 'claude auth login', installHint: 'x' }], ollama: false });
    const started: { agentRef?: string; question?: string; sessionId?: string | null }[] = [];
    vi.spyOn(agentRuns, 'start').mockImplementation(async (o) => {
      started.push({ agentRef: o.agentRef, question: o.question, sessionId: o.sessionId ?? null });
      return {} as never;
    });
    const store = mount();
    act(() => {
      store.dispatch({ type: 'session/browse', activeId: 'chat-a', turns: [] } as never);
    });
    await typeAndSend('question in chat A');
    await screen.findByTestId('connect-to-run');
    const aTurns = store.getState().session.turns;
    act(() => {
      store.dispatch({ type: 'session/browse', activeId: 'chat-b', turns: [{ id: 'b1', role: 'user', text: 'old question in chat B', intents: [], chips: [], contextLines: [], surface: null, memoryTrim: null, at: 1 }] } as never);
    });
    expect(screen.queryByTestId('connect-to-run')).toBeNull();
    act(() => {
      store.dispatch({ type: 'session/browse', activeId: 'chat-a', turns: aTurns } as never);
    });
    fireEvent.click(await screen.findByTestId('connect-to-run-open'));
    const use = await screen.findByTestId('first-run-use-ready', {}, { timeout: 4000 });
    await act(async () => {
      fireEvent.click(use);
    });
    await waitFor(() => expect(started).toEqual([{ agentRef: 'claude', question: 'question in chat A', sessionId: 'chat-a' }]));
    expect(agentRuns.get().agents?.['chat-a']).toBe('claude');
  });

  it('the failed turn in the record reads as not run yet, never the server banner', () => {
    expect(NOT_RUN_NO_MODEL).not.toMatch(/not configured|Settings/);
  });
});

describe('whiteboard Ask copy (P2-4)', () => {
  it('is one sentence that says what Send does, and names what is missing only when nothing can answer', () => {
    for (const can of [true, false]) {
      const line = askPanelLine(can);
      expect(line.match(/[.!?](\s|$)/g), line).toHaveLength(1);
      expect(line).toMatch(/chat box/);
    }
    expect(askPanelLine(true)).not.toMatch(/no model/);
    expect(askPanelLine(false)).toMatch(/no model is connected/);
  });

  it('the panel shows that sentence', () => {
    const storage = { getItem: () => null, setItem: () => undefined } as unknown as Storage;
    render(<Whiteboard repoRoot="r" storage={storage} onAsk={() => {}} canAnswer={false} />);
    fireEvent.click(screen.getByTestId('wb-ask'));
    expect(screen.getByTestId('wb-ask-panel').textContent).toContain(askPanelLine(false));
    expect(screen.getByTestId('wb-ask-panel').textContent).not.toMatch(/either way/);
  });
});
