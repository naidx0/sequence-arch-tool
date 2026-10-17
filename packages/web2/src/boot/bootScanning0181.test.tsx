import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStore, StoreProvider } from '../state';
import { ConnectedBootHydrate } from '../state/connect';
import { runBoot, scanningLine, scanningOf, type BootTransport } from './bootSequence';

/*
 * 0.1.8.1 B1, ui. While the startup --repo is read, GET /api/status answers
 * `{ attached: false, scanning: { done, total, path } }` (total 0 until known). A tab opened then shows
 * "Reading N of M files…" and polls until `scanning` is gone, instead of landing on the no-project home.
 */

afterEach(cleanup);

const GRAPH = { nodes: [], edges: [], warnings: [], repoName: 'shop', repoRoot: '/home/me/shop', scannedAt: '2026-10-14T00:00:00Z', nodeDetail: {} };
const ok = <T,>(body: T) => ({ outcome: 'ok' as const, status: 200, body });

function transport(statuses: unknown[]): BootTransport & { calls: () => number } {
  let n = 0;
  return {
    status: vi.fn(async () => ok(statuses[Math.min(n++, statuses.length - 1)] as never)),
    archGraph: vi.fn(async () => ok(GRAPH)),
    recent: vi.fn(),
    browse: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    calls: () => n,
  } as unknown as BootTransport & { calls: () => number };
}

describe('the startup read, on the client (B1 ui)', () => {
  it('reads the exact body: scanning is an outcome of its own, not "unattached"', async () => {
    const t = transport([{ attached: false, scanning: { done: 40, total: 120, path: '/home/me/shop' } }]);
    const out = await runBoot(t);
    expect(out.kind).toBe('scanning');
    if (out.kind === 'scanning') expect(out.scanning).toEqual({ done: 40, total: 120, path: '/home/me/shop' });
    expect((await runBoot(transport([{ attached: false }]))).kind).toBe('unattached');
  });

  it('says the count, and "Counting files" while the total is still 0', () => {
    expect(scanningLine({ done: 1204, total: 3010, path: '/r' })).toBe('Reading 1,204 of 3,010 files…');
    expect(scanningLine({ done: 0, total: 0, path: '/r' })).toBe('Counting files…');
    expect(scanningOf({ attached: true })).toBeNull();
  });

  it('a tab opened mid-read shows the read, follows the count, and lands attached when it is done', async () => {
    const t = transport([
      { attached: false, scanning: { done: 0, total: 0, path: '/home/me/shop' } },
      { attached: false, scanning: { done: 40, total: 120, path: '/home/me/shop' } },
      { attached: true, repoName: 'shop', root: '/home/me/shop' },
    ]);
    const store = createStore({});
    const settled: string[] = [];
    const dispatch = store.dispatch.bind(store);
    store.dispatch = ((a: { type: string; outcome?: { kind: string } }) => {
      if (a.type === 'boot/settled') settled.push(a.outcome!.kind);
      return dispatch(a as never);
    }) as typeof store.dispatch;
    render(
      <StoreProvider store={store}>
        <ConnectedBootHydrate transport={t} />
      </StoreProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('boot-scanning-line').textContent).toBe('Counting files…'));
    await waitFor(() => expect(screen.getByTestId('boot-scanning-line').textContent).toBe('Reading 40 of 120 files…'), { timeout: 3000 });
    await waitFor(() => expect(screen.queryByTestId('boot-scanning')).toBeNull(), { timeout: 3000 });
    /* The store never heard "unattached" (the no-project home) while the read ran: the first word it got was attached. */
    await waitFor(() => expect(settled).toEqual(['attached']));
  });
});
