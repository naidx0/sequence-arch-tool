import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, createStore } from '../state';
import { VersionSection } from './VersionSection';
import { assetHref, updateHelpPrompt } from './versionModel';
import { createVersionClient, type UpdateCheck } from './versionClient';

/* Owner: "if it gives them an error, just show a prompt for the model: this is the GitHub link, this is the download,
   it's failing, help me." The button only fills the composer and closes Settings; nothing runs. */

afterEach(() => cleanup());

const CHECK: UpdateCheck = {
  current: '0.1.4',
  latest: { version: '0.1.5', tag: 'v0.1.5', name: 'Sequence 0.1.5', htmlUrl: 'https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.5', publishedAt: null },
  newer: true,
  asset: { name: 'Sequence.Setup.0.1.5.exe', size: 180 * 1024 * 1024 },
  installable: true,
  desktop: true,
  checkedAt: 1,
  offline: false,
};
const FAILED = { state: 'failed', version: '0.1.5', received: 0, total: 0, error: 'The download did not match its published checksum.', howto: null, file: null };

function client(snap: unknown) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
    if (url === '/api/app/version') return json({ version: '0.1.4', commit: null, platform: 'win32', arch: 'x64', desktop: true });
    if (url === '/api/app/releases') return json({ notes: [] });
    if (url.startsWith('/api/app/update')) return snap === null ? json({ error: 'down' }, 500) : json(snap);
    return json({}, 404);
  }) as unknown as typeof fetch;
  return { calls, api: createVersionClient(fetchImpl) };
}

describe('Ask the agent to help', () => {
  it('a failed download puts a ready prompt in the composer and closes Settings, and starts nothing', async () => {
    const app = createStore({});
    app.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'app' } });
    const { api, calls } = client({ check: CHECK, install: FAILED });
    render(<StoreProvider store={app}><VersionSection client={api} /></StoreProvider>);
    const btn = await screen.findByTestId('settings-version-help');
    expect(btn.className).toContain('sb-pill-quiet');
    expect(screen.getByTestId('settings-update-error').textContent).toContain('did not match its published checksum');
    const callsBefore = calls.length;
    fireEvent.click(btn);
    const draft = app.getState().composer.draft ?? '';
    expect(draft).toContain('The download did not match its published checksum.');
    expect(draft).toContain('v0.1.4');
    expect(draft).toContain('v0.1.5');
    expect(draft).toContain('https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.5');
    expect(draft).toContain('https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.5/Sequence.Setup.0.1.5.exe');
    expect(draft).toMatch(/help/i);
    expect(app.getState().shell.overlay).toBeNull();
    expect(calls.length).toBe(callsBefore);
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
  });

  it('a check that got no answer offers the same help; no error and no store means no button', async () => {
    const app = createStore({});
    const { api } = client(null);
    render(<StoreProvider store={app}><VersionSection client={api} /></StoreProvider>);
    fireEvent.click(await screen.findByTestId('settings-version-help'));
    expect(app.getState().composer.draft).toContain('did not answer the update check');
    cleanup();
    const ok = client({ check: { ...CHECK, newer: false }, install: { ...FAILED, state: 'idle', error: null } });
    render(<StoreProvider store={app}><VersionSection client={ok.api} /></StoreProvider>);
    await waitFor(() => expect(screen.getByTestId('settings-update-title').textContent).toBe("You're up to date"));
    expect(screen.queryByTestId('settings-version-help')).toBeNull();
    cleanup();
    const bare = client({ check: CHECK, install: FAILED });
    render(<VersionSection client={bare.api} />);
    await screen.findByTestId('settings-update-error');
    expect(screen.queryByTestId('settings-version-help')).toBeNull();
  });

  it('the prompt builder keeps links on this repo only and skips the download when there is no asset', () => {
    expect(assetHref({ latest: CHECK.latest, asset: null })).toBeNull();
    const p = updateHelpPrompt('boom', { ...CHECK, asset: null, latest: { ...CHECK.latest!, htmlUrl: 'https://evil.example/x' } }, null);
    expect(p).toContain('https://github.com/naidx0/sequence-arch-tool/releases');
    expect(p).not.toContain('evil.example');
    expect(p).not.toContain('Download:');
    expect(vi.isMockFunction(updateHelpPrompt)).toBe(false);
  });
});

describe('a server-given asset link stays inside the repo (review B2)', () => {
  it('rejects .. walking out, other hosts, queries; accepts tag/name', async () => {
    const { assetHref } = await import('./versionModel');
    const base = { latest: { tag: 'v0.1.6', version: '0.1.6' }, asset: { name: 'Sequence-Setup.exe', size: 1 } } as never;
    const withUrl = (url: string) => ({ ...(base as object), asset: { name: 'Sequence-Setup.exe', size: 1, url } }) as never;
    const ok = 'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.6/Sequence-Setup.exe';
    expect(assetHref(withUrl(ok))).toBe(ok);
    for (const bad of [
      'https://github.com/naidx0/sequence-arch-tool/releases/download/../../../../evil/x.exe',
      'https://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.6/x.exe?y=1',
      'https://evil.com/naidx0/sequence-arch-tool/releases/download/v0.1.6/x.exe',
      'http://github.com/naidx0/sequence-arch-tool/releases/download/v0.1.6/x.exe',
    ]) expect(assetHref(withUrl(bad))).not.toBe(bad);
  });
});
