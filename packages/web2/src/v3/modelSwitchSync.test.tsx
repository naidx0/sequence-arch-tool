import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  /* The settings client binds `fetch` when its module loads: the global is a stable forwarder installed before any import. */
  const g = globalThis as unknown as { fetch: unknown; __fetch: (...a: unknown[]) => unknown };
  g.fetch = (...a: unknown[]) => g.__fetch(...a);
});

import { resolvedModel } from '../agents/activeModel';
import { createStore } from '../state';
import { V3App } from './V3App';

/* ROUND 10, FIX 2 (HIGH 1): a model switched OUTSIDE the popup (Settings) used to leave the chip on the old
   model. The server's active model is the composer's: this drives the real Settings panel's switch. */

const PROFILES = [
  { id: 'a', name: 'Sonnet', provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: '••••1111' },
  { id: 'b', name: 'Qwen local', provider: 'openai-compatible', model: 'qwen3:30b-a3b', baseUrl: 'http://localhost:11434/v1' },
];

function server() {
  let active = 'a';
  const delay = { getMs: 0 };
  const puts: unknown[] = [];
  const body = () => {
    const pr = PROFILES.find((p) => p.id === active)!;
    return { configured: true, provider: pr.provider, model: pr.model, ...(pr.apiKey ? { apiKey: pr.apiKey } : {}), ...(pr.baseUrl ? { baseUrl: pr.baseUrl } : {}), profiles: PROFILES, defaultProfileId: active };
  };
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/api/ai-config')) {
      if (init?.method !== 'PUT' && delay.getMs > 0) {
        /* The answer is decided when the request STARTS and delivered late, as a slow probe would. */
        const snapshot = JSON.stringify(body());
        await new Promise((r) => setTimeout(r, delay.getMs));
        return new Response(snapshot, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (init?.method === 'PUT') {
        const sent = JSON.parse(String(init.body)) as { selectProfileId?: string };
        puts.push(sent);
        if (sent.selectProfileId) active = sent.selectProfileId;
      }
      return new Response(JSON.stringify(body()), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('/api/sessions')) return new Response(JSON.stringify({ index: { sessions: [{ id: 'c1', title: 'C', pinned: false, updatedAt: '2026-01-01' }], activeId: 'c1' }, repos: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u.includes('/api/hooks')) return new Response(JSON.stringify({ declared: {}, trusted: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetchMock, puts, delay };
}

afterEach(() => {
  act(() => resolvedModel.set(null));
});

describe('a switch made in Settings reaches the chip, the bar and the composer', () => {
  it('chip and status bar name the new model, and the composer holds it for the next send', async () => {
    const { fetchMock, puts } = server();
    (globalThis as unknown as { __fetch: unknown }).__fetch = fetchMock;
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 'c1', title: 'C', pinned: false, updatedAt: '2026-01-01' }], activeId: 'c1' } as never);
    render(<V3App appStore={store} />);
    await waitFor(() => expect(screen.getByTestId('v3-model-label').textContent).toBe('Sonnet 5.5'));
    expect(store.getState().composer.model.model).toBe('claude-sonnet-5-5');

    act(() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'provider' } } as never));
    const use = await screen.findAllByTestId('settings-profile-use', {}, { timeout: 10000 });
    fireEvent.click(use.find((b) => b.getAttribute('data-profile') === 'b')!);
    await waitFor(() => expect(puts).toContainEqual({ selectProfileId: 'b' }));

    await waitFor(() => expect(store.getState().composer.model.model).toBe('qwen3:30b-a3b'));
    await waitFor(() => expect(screen.getByTestId('v3-model-label').textContent).toBe('Qwen local'));
    /* the chip's icon is the same model's (a local model wears no brand mark), not Sonnet's */
    expect(screen.getByTestId('v3-model-trigger').querySelector('[data-brand="claude"]')).toBeNull();
    /* the bar reads the same resolved model */
    expect(resolvedModel.get()).toMatchObject({ model: 'qwen3:30b-a3b', label: 'Qwen local' });
    expect(store.getState().composer.model).toEqual({ model: 'qwen3:30b-a3b', origin: 'local' });
    expect(screen.getByTestId('v3-model-trigger').getAttribute('aria-label')).toMatch(/Model: Qwen local/);
  }, 30000);

  it('a slow GET that started before a popup pick cannot revert it', async () => {
    const { fetchMock, delay } = server();
    (globalThis as unknown as { __fetch: unknown }).__fetch = fetchMock;
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 'c1', title: 'C', pinned: false, updatedAt: '2026-01-01' }], activeId: 'c1' } as never);
    render(<V3App appStore={store} />);
    await waitFor(() => expect(screen.getByTestId('v3-model-label').textContent).toBe('Sonnet 5.5'));
    delay.getMs = 500;
    const seen: string[] = [];
    store.subscribe(() => {
      const m = store.getState().composer.model.model;
      if (seen[seen.length - 1] !== m) seen.push(m);
    });
    fireEvent.click(screen.getByTestId('v3-model-trigger'));
    const row = await screen.findAllByTestId('v3-model-row');
    fireEvent.click(row.find((r) => r.getAttribute('data-model') === 'b')!);
    await waitFor(() => expect(store.getState().composer.model.model).toBe('qwen3:30b-a3b'));
    /* let every delayed pre-switch answer land, then check nothing put Sonnet back */
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1400));
    });
    expect(store.getState().composer.model.model).toBe('qwen3:30b-a3b');
    /* never flickers back to the pre-switch model */
    expect(seen).toEqual(['qwen3:30b-a3b']);
    expect(screen.getByTestId('v3-model-label').textContent).toBe('Qwen local');
  }, 30000);
});
