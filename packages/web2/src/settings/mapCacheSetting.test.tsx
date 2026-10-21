import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatBytes, MapCacheSetting } from './MapCacheSetting';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const MB = 1024 * 1024;

describe('Map cache setting (APP-15)', () => {
  it('formats sizes the way a person reads them', () => {
    expect([0, 900, 12 * 1024, 46 * MB, 1.5 * 1024 * MB].map(formatBytes)).toEqual(['0 B', '900 B', '12 KB', '46 MB', '1.5 GB']);
  });

  it('shows "Map cache: 46 MB", and Clear posts to /api/cache/clear and shows the new size', async () => {
    const calls: { url: string; method: string }[] = [];
    let cleared = false;
    render(
      <MapCacheSetting
        fetchImpl={(async (url: string, init?: RequestInit) => {
          calls.push({ url, method: init?.method ?? 'GET' });
          if (url === '/api/cache/clear') cleared = true;
          return json(cleared ? { attached: true, bytes: 2 * MB, clearableBytes: 0 } : { attached: true, bytes: 48 * MB, clearableBytes: 46 * MB });
        }) as typeof fetch}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('settings-map-cache-size').textContent).toBe('Map cache: 46 MB'));
    fireEvent.click(screen.getByTestId('settings-map-cache-clear'));
    await waitFor(() => expect(screen.getByTestId('settings-map-cache-size').textContent).toBe('Map cache: 0 B'));
    expect(calls).toEqual([
      { url: '/api/cache-size', method: 'GET' },
      { url: '/api/cache/clear', method: 'POST' },
    ]);
    expect((screen.getByTestId('settings-map-cache-clear') as HTMLButtonElement).disabled).toBe(true);
  });

  it('says why when the server refuses (a scan is running) and keeps the size', async () => {
    let n = 0;
    render(
      <MapCacheSetting
        fetchImpl={(async () => (n++ === 0 ? json({ attached: true, bytes: 5 * MB, clearableBytes: 4 * MB }) : json({ error: 'Sequence is reading the project right now. Try again when it finishes.' }, 409))) as typeof fetch}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('settings-map-cache-size').textContent).toBe('Map cache: 4.0 MB'));
    fireEvent.click(screen.getByTestId('settings-map-cache-clear'));
    await waitFor(() => expect(screen.getByTestId('settings-map-cache-error').textContent).toContain('reading the project'));
    expect(screen.getByTestId('settings-map-cache-size').textContent).toBe('Map cache: 4.0 MB');
  });

  it('with no project open there is nothing to clear', async () => {
    render(<MapCacheSetting fetchImpl={(async () => json({ attached: false, bytes: 0, clearableBytes: 0 })) as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId('settings-map-cache-size').textContent).toBe('Map cache: no project open'));
    expect((screen.getByTestId('settings-map-cache-clear') as HTMLButtonElement).disabled).toBe(true);
  });
});
