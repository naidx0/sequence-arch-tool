import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VersionSection } from './VersionSection';
import { createVersionClient } from './versionClient';

/* Owner: "the in-app update must show everything properly." Every state of the Version panel, driven through the
   real client against a fake server (/api/app/*): nothing here talks to GitHub or runs an installer. */

afterEach(() => cleanup());

const MB = 1024 * 1024;
const IDLE = { state: 'idle', version: null, received: 0, total: 0, error: null, howto: null, file: null };
const CHECK = {
  current: '0.1.4',
  latest: {
    version: '0.1.5',
    tag: 'v0.1.5',
    name: 'Sequence 0.1.5',
    htmlUrl: 'https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.5',
    publishedAt: null,
    notes: '## Fixed\n\n- Models list refreshes\n- **Updater** shows progress',
  },
  newer: true,
  asset: { name: 'Sequence.Setup.0.1.5.exe', size: 180 * MB },
  installable: true,
  desktop: true,
  checkedAt: 1_700_000_000_000,
  offline: false,
};

interface Server {
  check: Record<string, unknown> | null;
  install: Record<string, unknown>;
  posts: unknown[];
  postStatus: number;
}

function serve(over: Partial<Server> = {}) {
  const st: Server = { check: CHECK, install: IDLE, posts: [], postStatus: 202, ...over };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url === '/api/app/version') return json({ version: '0.1.4', commit: 'abc1234', platform: 'win32', arch: 'x64', desktop: true });
    if (url === '/api/app/releases') return json({ notes: [] });
    if (url.startsWith('/api/app/update/install')) {
      st.posts.push(JSON.parse(String(init?.body)));
      return json({ install: st.install }, st.postStatus);
    }
    if (url.startsWith('/api/app/update')) return st.check === null ? json({ error: 'down' }, 500) : json({ check: st.check, install: st.install });
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { st, client: createVersionClient(fetchImpl) };
}

const text = (id: string) => screen.getByTestId(id).textContent ?? '';

describe('Version panel states', () => {
  it('up to date: the current version, the latest, and the up-to-date title', async () => {
    const { client } = serve({ check: { ...CHECK, newer: false, installable: false, latest: { ...CHECK.latest, version: '0.1.4' } } });
    render(<VersionSection client={client} />);
    await waitFor(() => expect(text('settings-update-title')).toBe("You're up to date"));
    expect(text('settings-version-number')).toBe('Sequence 0.1.4');
    expect(text('settings-update-sub')).toContain('v0.1.4 is the latest version');
    expect(screen.queryByTestId('settings-update-notes')).toBeNull();
  });

  it('update available: current and latest versions, the release notes rendered in a scroll box, and the button', async () => {
    const { client } = serve();
    render(<VersionSection client={client} />);
    expect((await screen.findByTestId('settings-update-go')).textContent).toBe('Update to v0.1.5');
    expect(text('settings-update-sub')).toContain('You have v0.1.4');
    const notes = screen.getByTestId('settings-update-notes');
    expect(notes.textContent).toContain('In v0.1.5');
    expect(notes.textContent).not.toContain('Updater shows progress');
    fireEvent.click(screen.getByTestId('settings-update-notes-toggle'));
    expect(notes.textContent).toContain('Models list refreshes');
    expect(notes.textContent).toContain('Updater shows progress');
    expect(notes.textContent).not.toContain('**');
    expect(notes.querySelector('h5')?.textContent).toBe('Fixed');
    expect(notes.querySelector('.sb-news-body')).not.toBeNull();
  });

  it('downloading: a percent, bytes and a determinate bar', async () => {
    const { client } = serve({ install: { ...IDLE, state: 'downloading', version: '0.1.5', received: 45 * MB, total: 180 * MB } });
    render(<VersionSection client={client} />);
    await waitFor(() => expect(text('settings-update-sub')).toContain('Downloading 25%'));
    expect(text('settings-update-sub')).toContain('45.0 MB of 180 MB');
    expect(screen.getByTestId('settings-update-progress').getAttribute('value')).toBe('0.25');
    expect(screen.queryByTestId('settings-update-go')).toBeNull();
  });

  it('download of unknown size, verifying and launching each say the step and show a bar', async () => {
    for (const [state, words] of [
      ['downloading', 'Downloading'],
      ['verifying', 'Checking the download'],
      ['launching', 'Starting the installer'],
    ] as const) {
      const { client } = serve({ install: { ...IDLE, state, version: '0.1.5' } });
      const { unmount } = render(<VersionSection client={client} />);
      await waitFor(() => expect(text('settings-update-sub')).toContain(words));
      expect(screen.getByTestId('settings-update-progress').getAttribute('data-indeterminate')).toBe('yes');
      unmount();
    }
  });

  it('installer running: the title and the what-to-do line', async () => {
    const { client } = serve({ install: { ...IDLE, state: 'launched', version: '0.1.5', howto: 'Finish the setup window, then reopen Sequence.' } });
    render(<VersionSection client={client} />);
    await waitFor(() => expect(text('settings-update-title')).toBe('The installer for v0.1.5 is running'));
    expect(text('settings-update-sub')).toBe('Finish the setup window, then reopen Sequence.');
  });

  it('failed: the reason and a Retry that posts the same version again', async () => {
    const { client, st } = serve({ install: { ...IDLE, state: 'failed', version: '0.1.5', error: 'The download did not match its published checksum' } });
    render(<VersionSection client={client} />);
    expect((await screen.findByTestId('settings-update-error')).textContent).toContain('did not match its published checksum');
    const retry = screen.getByTestId('settings-update-go');
    expect(retry.textContent).toBe('Retry');
    fireEvent.click(retry);
    await waitFor(() => expect(st.posts).toEqual([{ version: '0.1.5' }]));
  });

  it('a failure with no reason still says something', async () => {
    const { client } = serve({ install: { ...IDLE, state: 'failed', version: '0.1.5', error: null } });
    render(<VersionSection client={client} />);
    expect((await screen.findByTestId('settings-update-error')).textContent).toMatch(/gave no reason/);
  });

  it('the app not answering the check is a line with Retry, not a forever "Checking"', async () => {
    const { client, st } = serve({ check: null });
    render(<VersionSection client={client} />);
    expect((await screen.findByTestId('settings-update-error')).textContent).toMatch(/did not answer the update check/);
    expect(text('settings-update-sub')).toBe('Could not check for updates.');
    st.check = { ...CHECK, newer: false, installable: false };
    fireEvent.click(screen.getByTestId('settings-update-check'));
    await waitFor(() => expect(text('settings-update-title')).toBe("You're up to date"));
  });

  it('GitHub unreachable: the last answer is labelled as such, with Retry', async () => {
    const { client } = serve({ check: { ...CHECK, newer: false, installable: false, offline: true } });
    render(<VersionSection client={client} />);
    await waitFor(() => expect(text('settings-update-sub')).toMatch(/Could not reach GitHub just now, so this is the last answer/));
    expect(text('settings-update-check')).toBe('Retry');
  });

  it('a refused Update click says so and offers Retry', async () => {
    const { client, st } = serve({ postStatus: 500 });
    render(<VersionSection client={client} />);
    fireEvent.click(await screen.findByTestId('settings-update-go'));
    expect((await screen.findByTestId('settings-update-error')).textContent).toMatch(/could not start/i);
    expect(text('settings-update-go')).toBe('Retry');
    expect(st.posts.length).toBe(1);
  });
});

describe('the update installs when Sequence quits (I11/G1)', () => {
  afterEach(() => {
    delete (window as unknown as { sequence?: unknown }).sequence;
  });
  const READY = { ...IDLE, state: 'launched' as const, version: '0.1.5', installMode: 'in-place' as const, mode: 'differential' as const, downloaded: 12 * MB, fullSize: 180 * MB, reused: 168 * MB };

  it('says it installs on quit, shows the differential numbers, and Restart now calls the quit shell action', async () => {
    const shell = vi.fn(async () => null);
    (window as unknown as { sequence: unknown }).sequence = { openRepo: async () => null, shell };
    const { client } = serve({ install: READY });
    render(<VersionSection client={client} />);
    await waitFor(() => expect(text('settings-update-title')).toBe('Version 0.1.5 is ready'));
    expect(text('settings-update-sub')).toMatch(/installs when Sequence quits/);
    expect(document.body.textContent).not.toMatch(/installer for .* is running/);
    expect(text('settings-update-detail')).toBe('Differential update: 12.0 MB downloaded of 180 MB, reused 168 MB');
    fireEvent.click(screen.getByTestId('settings-update-restart'));
    expect(shell).toHaveBeenCalledWith('restart-for-update');
  });

  it('a full download says so and why; in a browser tab there is no Restart now', async () => {
    const { client } = serve({ install: { ...READY, mode: 'full', fallbackReason: 'no earlier copy to compare' } });
    render(<VersionSection client={client} />);
    await waitFor(() => expect(text('settings-update-detail')).toBe('Full download (no earlier copy to compare)'));
    expect(screen.queryByTestId('settings-update-restart')).toBeNull();
  });

  it('while downloading it shows the differential progress line', async () => {
    const { client } = serve({ install: { ...IDLE, state: 'downloading', version: '0.1.5', received: 6 * MB, total: 12 * MB, mode: 'differential', downloaded: 6 * MB, fullSize: 180 * MB, reused: 168 * MB } });
    render(<VersionSection client={client} />);
    await waitFor(() => expect(text('settings-update-detail')).toMatch(/^Differential update: 6\.0 MB downloaded of 180 MB, reused 168 MB$/));
  });
});

describe('copy matches the buttons, and the automatic check switch', () => {
  it('without a desktop bridge the ready copy does not tell the reader to press Restart now', async () => {
    const { client } = serve({ install: { ...IDLE, state: 'launched', version: '0.1.5', installMode: 'in-place' } });
    render(<VersionSection client={client} />);
    await waitFor(() => expect(text('settings-update-sub')).toMatch(/installs when Sequence quits/));
    expect(text('settings-update-sub')).not.toMatch(/Restart now/);
    expect(screen.queryByTestId('settings-update-restart')).toBeNull();
  });
  it('Check for updates is a switch that PUTs updates.check; off shows the cached notice', async () => {
    const puts: unknown[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url === '/api/agent-settings') {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)));
          return json({ updates: { check: false } });
        }
        return json({ updates: { check: true } });
      }
      if (url === '/api/app/version') return json({ version: '0.1.4', commit: 'abc', platform: 'win32', arch: 'x64', desktop: true });
      if (url === '/api/app/releases') return json({ notes: [] });
      return json({ check: { ...CHECK, newer: false, installable: false, checkDisabled: puts.length > 0, latest: { ...CHECK.latest, version: '0.1.4' } }, install: IDLE });
    }) as unknown as typeof fetch;
    render(<VersionSection client={createVersionClient(fetchImpl)} />);
    const box = (await screen.findByTestId('settings-update-auto')) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(puts).toEqual([{ updates: { check: false } }]));
    await waitFor(() => expect(text('settings-update-sub')).toMatch(/Automatic checks are off/));
    expect(screen.getByTestId('settings-update-check').textContent).toBe('Check now');
  });
});
