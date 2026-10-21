import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadChatLazies } from '../../test/preloadChat';
import { createStore, StoreProvider } from '../state';
import { V3Chat } from './V3Chat';

/*
 * The composer's "Rewrite with be-ambitious": it needs a draft, runs the skill through the server route, puts the rewritten
 * prompt back in the field, and sends nothing. The server is a stub; no model is reached.
 */

beforeAll(preloadChatLazies, 120_000);

const calls: Array<{ url: string; method: string; body: string }> = [];
let runStatus = 200;

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  runStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? '') });
      if (String(url).includes('/api/skills/be-ambitious/run')) {
        return new Response(JSON.stringify(runStatus === 200 ? { slug: 'be-ambitious', prompt: 'Start from the raw logs; reproduce; measure p95.' } : { error: 'no model configured' }), { status: runStatus, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function draw(draft: string) {
  const store = createStore({});
  store.dispatch({ type: 'composer/draft', text: draft });
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat componentsClient={{ list: async () => ({ enabled: true, mode: 'approve', groups: [] }), setSettings: async () => true, setWorkspace: async () => true, answerOffer: async () => true }} />
      </div>
    </StoreProvider>,
  );
  return store;
}

/* be-ambitious is a prompt tool in the Components picker (contract change: it was a top-level + row). */
async function openRewrite() {
  fireEvent.click(screen.getByTestId('v3-tools-trigger'));
  fireEvent.click(await screen.findByTestId('v3-tools-components'));
  return screen.findByTestId('v3-tools-rewrite');
}

describe('Rewrite with be-ambitious in the + menu', () => {
  it('is disabled until there is a draft', async () => {
    draw('');
    const row = await openRewrite();
    expect((row as HTMLButtonElement).disabled).toBe(true);
    expect(row.textContent).toContain('Rewrite with be-ambitious');
  });

  it('puts the rewritten prompt back in the field, says nothing was sent, and sends nothing', async () => {
    const store = draw('find out why checkout got slower');
    fireEvent.click(await openRewrite());
    await waitFor(() => expect(store.getState().composer.draft).toBe('Start from the raw logs; reproduce; measure p95.'));
    expect(screen.getByTestId('s2-mode-note').textContent).toContain('Nothing was sent');
    const run = calls.filter((c) => c.url.includes('/run'));
    expect(run).toHaveLength(1);
    expect(JSON.parse(run[0]!.body)).toEqual({ input: 'find out why checkout got slower' });
    /* no ask, no agent run: the only POST is the skill run */
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.url)).toEqual(['/api/skills/be-ambitious/run']);
    expect(store.getState().session.inFlight).toBeNull();
  });

  it('on a refusal the draft is untouched and the reason is shown', async () => {
    runStatus = 502;
    const store = draw('my draft');
    fireEvent.click(await openRewrite());

    await waitFor(() => expect(screen.getByTestId('s2-mode-note').textContent).toContain('no model configured'));
    expect(store.getState().composer.draft).toBe('my draft');
  });
});

describe('the / palette lists the built-in skill', () => {
  it('shows /be-ambitious beside the repo skills once /api/skills answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url) === '/api/skills'
          ? new Response(JSON.stringify({ dir: '.sequence/skills', skills: [{ slug: 'be-ambitious', name: 'be-ambitious', description: 'Turn a task or prompt into a deeper version of itself, not a bigger one.', builtin: true }], warnings: [], trusted: true, instructions: null }), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response('{}', { status: 404 }),
      ),
    );
    const store = draw('/');
    await waitFor(() => expect(screen.getAllByTestId('v3-slash-item').some((i) => i.textContent?.includes('be-ambitious'))).toBe(true));
    expect(store.getState().composer.draft).toBe('/');
  });
});
