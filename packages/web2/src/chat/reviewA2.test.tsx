import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore, StoreProvider } from '../state';
import { V3Chat } from '../v3/V3Chat';

/* Reviewer cases for wave A (A2: replay goes to its own chat, keeps its reference, does not steal focus). */

const REFUSAL = 'AI provider not configured';

interface Server {
  bodies: { question: string; raw: string }[];
}

function server(opts: { providers: unknown[]; ollama: boolean }): Server {
  const s: Server = { bodies: [] };
  let configured = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('/api/ask/stream')) {
        s.bodies.push({ question: (JSON.parse(String(init?.body)) as { question: string }).question, raw: String(init?.body) });
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
        configured = true;
        return json({ ok: true });
      }
      if (url === '/api/acp/agents' && method === 'GET') return json({ agents: [] });
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

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('R1 replay goes to the chat that was blocked', () => {
  it('switching to another chat does not carry the card there, nor replay that chat\'s last question', async () => {
    const s = server({ providers: [], ollama: true });
    const store = mount();
    await typeAndSend('question in chat A');
    await screen.findByTestId('connect-to-run');
    /* Move to chat B, whose last user turn is an older, answered question. */
    act(() => {
      store.dispatch({
        type: 'session/browse',
        activeId: 'chat-b',
        turns: [{ id: 'u1', role: 'user', text: 'old question in chat B', intents: [], chips: [], contextLines: [], surface: null, memoryTrim: null, at: 1 } as never],
      } as never);
    });
    const card = screen.queryByTestId('connect-to-run');
    if (card) {
      fireEvent.click(screen.getByTestId('connect-to-run-open'));
      const use = await screen.findByTestId('first-run-use-ready');
      await act(async () => {
        fireEvent.click(use);
      });
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(s.bodies.map((b) => b.question), 'replayed chat B question').not.toContain('old question in chat B');
    expect(card, 'the blocked-ask card followed the user into chat B').toBeNull();
  });
});

describe('R2 Ask about this keeps its reference on replay', () => {
  it('the replayed ask carries the board-ref chip the original ask carried', async () => {
    const s = server({ providers: [], ollama: true });
    const store = mount();
    act(() => {
      store.dispatch({ type: 'composer/chip-add', chip: { id: 'board-ref:wb:n1', kind: 'board-ref', ref: 'board-ref:wb:n1', label: 'Gateway', nodeKind: null, detail: 'GATEWAY-BOX-DETAIL' } } as never);
    });
    await typeAndSend('what is this?');
    expect(s.bodies[0]!.raw).toContain('GATEWAY-BOX-DETAIL');
    fireEvent.click(await screen.findByTestId('connect-to-run-open'));
    const use = await screen.findByTestId('first-run-use-ready');
    await act(async () => {
      fireEvent.click(use);
    });
    await waitFor(() => expect(s.bodies).toHaveLength(2));
    expect(s.bodies[1]!.raw, 'the replay dropped the selection the person asked about').toContain('GATEWAY-BOX-DETAIL');
  });
});

describe('R2b a pasted attachment rides the replay too', () => {
  it('the replayed ask carries the attachment id the original ask carried', async () => {
    const s = server({ providers: [], ollama: true });
    const store = mount();
    act(() => {
      store.dispatch({ type: 'composer/attachment-add', attachment: { id: 'ATTACH-SHA-1', name: 'log.txt', bytes: 12 } } as never);
    });
    await typeAndSend('why does this fail?');
    expect(s.bodies[0]!.raw).toContain('ATTACH-SHA-1');
    expect(store.getState().composer.attachments).toEqual([]);
    fireEvent.click(await screen.findByTestId('connect-to-run-open'));
    const use = await screen.findByTestId('first-run-use-ready');
    await act(async () => {
      fireEvent.click(use);
    });
    await waitFor(() => expect(s.bodies).toHaveLength(2));
    expect(s.bodies[1]!.raw, 'the replay dropped the attachment').toContain('ATTACH-SHA-1');
  });
});

describe('R3 inline connect flow does not steal focus from the composer', () => {
  it('a re-probe while the card is open leaves focus where the person put it', async () => {
    /* A provider fetching its bridge makes FirstRun re-probe every second. */
    server({ providers: [{ id: 'claude', label: 'Claude Code', installed: true, version: '2', state: 'preparing', setupBytes: 10, signInCommand: 'x', installHint: 'x' }], ollama: false });
    mount();
    await typeAndSend('hello');
    fireEvent.click(await screen.findByTestId('connect-to-run-open'));
    await screen.findByTestId('connect-in-place');
    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    act(() => field.focus());
    expect(document.activeElement).toBe(field);
    await new Promise((r) => setTimeout(r, 2500));
    expect(document.activeElement, 'focus was pulled out of the composer into the inline card').toBe(field);
  }, 10000);
});

