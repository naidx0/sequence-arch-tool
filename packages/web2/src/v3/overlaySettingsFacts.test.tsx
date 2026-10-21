import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { StoreProvider } from '../state/connect';
import { V3OverlayHost } from './V3OverlayHost';

/* Recovery 2026-10-20: the overlay host mounted SettingsPanel without `facts`, so Settings > Workspace lost This workspace,
   Open a folder and Default workspace. These render the real host, open the Workspace pane and read what it draws. */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function answers() {
  return vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    const body = u.startsWith('/api/sessions') ? { index: { version: 1, activeId: null, sessions: [{ id: 's1' }, { id: 's2' }] }, scope: 'workspace', repos: [] } : u.startsWith('/api/recent') ? { recent: [] } : u.startsWith('/api/hooks') ? { events: [], blocking: [], declared: {}, trusted: false } : u.startsWith('/api/mcp') ? { document: { servers: {} } } : u.startsWith('/api/plugins') ? { ok: true, plugins: [], askWired: false } : u.startsWith('/api/ai-config') ? { configured: false } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('the overlay Settings has its workspace facts', () => {
  it('Workspace shows Open a folder, Default workspace and This workspace', async () => {
    vi.stubGlobal('fetch', answers());
    const store = createStore({});
    store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'workspace' } } as never);
    render(
      <StoreProvider store={store}>
        <V3OverlayHost />
      </StoreProvider>,
    );
    await act(async () => {
      await import('../settings/ConnectedSettings');
    });
    expect(await screen.findByTestId('settings-open-folder')).toBeTruthy();
    expect(screen.getByTestId('settings-default-workspace')).toBeTruthy();
    expect(screen.getByTestId('settings-sections')).toBeTruthy();
    /* The counts the server owns arrive: two sessions answered, so history is not "waiting". */
    await waitFor(() => expect(screen.getByTestId('settings-row-session-history').textContent ?? '').toMatch(/2 sessions recorded/));
  });
});
