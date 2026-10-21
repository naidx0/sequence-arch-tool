import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AllowedFoldersSetting } from './AllowedFoldersSetting';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Folders you allowed (APP-13)', () => {
  it('lists the allowed folders and Remove sends DELETE { path } and shows the list the server answers', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    let folders = ['/mnt/data/app', '/tmp/proj'];
    render(
      <AllowedFoldersSetting
        fetchImpl={(async (url: string, init?: RequestInit) => {
          const method = init?.method ?? 'GET';
          calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
          if (method === 'DELETE') folders = folders.filter((f) => f !== (JSON.parse(String(init?.body)) as { path: string }).path);
          return json({ folders });
        }) as typeof fetch}
      />,
    );
    await waitFor(() => expect(screen.getAllByTestId('settings-allowed-folder')).toHaveLength(2));
    expect(screen.getAllByTestId('settings-allowed-folder-path').map((e) => e.textContent)).toEqual(['/mnt/data/app', '/tmp/proj']);

    fireEvent.click(screen.getByLabelText('Remove /mnt/data/app'));
    await waitFor(() => expect(screen.getAllByTestId('settings-allowed-folder')).toHaveLength(1));
    expect(screen.getByTestId('settings-allowed-folder-path').textContent).toBe('/tmp/proj');
    expect(calls).toEqual([
      { url: '/api/allowed-folders', method: 'GET', body: null },
      { url: '/api/allowed-folders', method: 'DELETE', body: { path: '/mnt/data/app' } },
    ]);
  });

  it('says so when nothing is allowed yet', async () => {
    render(<AllowedFoldersSetting fetchImpl={(async () => json({ folders: [] })) as typeof fetch} />);
    await waitFor(() => expect(screen.getByTestId('settings-allowed-folders-empty')).toBeTruthy());
    expect(screen.queryByTestId('settings-allowed-folder')).toBeNull();
  });

  it('shows a failure note when the server fails, and keeps the list when a remove fails', async () => {
    let n = 0;
    render(
      <AllowedFoldersSetting
        fetchImpl={(async () => (n++ === 0 ? json({ folders: ['/mnt/x'] }) : json({ error: 'no' }, 500))) as typeof fetch}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('settings-allowed-folder')).toBeTruthy());
    fireEvent.click(screen.getByTestId('settings-allowed-folder-remove'));
    await waitFor(() => expect(screen.getByTestId('settings-allowed-folders-error')).toBeTruthy());
    expect(screen.getByTestId('settings-allowed-folder')).toBeTruthy();
  });
});
