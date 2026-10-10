import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../state';
import { StoreProvider } from '../state/connect';
import { V3OverlayHost } from './V3OverlayHost';

/* S3 + S1: after an agent turn is reverted in the Rewind overlay, the board
   is told which files changed (repo/stale, file-written), as after any write. */

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('Rewind overlay', () => {
  it('a reverted agent turn marks the repo stale with the paths it put back', async () => {
    const session = { version: 1, sessionId: 'chat-1', turns: [{ seq: 1, at: 1, tree: 'x', files: ['NOTES.md', 'a.ts'] }] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.startsWith('/api/snapshots/sessions')) return json({ sessions: [{ sessionId: 'chat-1', turns: 1, lastAt: 1, reverted: false }] });
        if (url.startsWith('/api/snapshots/revert')) return json({ seq: 1, files: ['NOTES.md', 'a.ts'] });
        if (url.startsWith('/api/snapshots/files')) return json({ files: [] });
        if (url.startsWith('/api/snapshots')) return json(session);
        if (url.startsWith('/api/checkpoints')) return json({ checkpoints: [], tracked: [] });
        return json({});
      }),
    );
    const store = createStore({});
    store.dispatch({ type: 'shell/overlay', overlay: { kind: 'rewind' } } as never);
    const dispatch = vi.spyOn(store, 'dispatch');
    render(
      <StoreProvider store={store}>
        <V3OverlayHost />
      </StoreProvider>,
    );
    const row = await screen.findByTestId('agent-turn', undefined, { timeout: 5000 });
    fireEvent.click(within(row).getByTestId('agent-turn-revert'));
    await waitFor(() => expect(dispatch.mock.calls.some(([a]) => (a as { type: string }).type === 'repo/stale')).toBe(true));
    const stale = dispatch.mock.calls.map(([a]) => a as { type: string; reason?: string; changedPaths?: string[] }).find((a) => a.type === 'repo/stale')!;
    expect(stale.reason).toBe('file-written');
    expect(stale.changedPaths).toEqual(['NOTES.md', 'a.ts']);
  });
});
