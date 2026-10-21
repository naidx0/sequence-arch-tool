import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VersionSection } from './VersionSection';
import { createVersionClient, type InstallJob, type UpdateCheck, type UpdateSnapshot, type VersionClient, type VersionInfo } from './versionClient';
import { copyText, describeUpdate, formatBytes, noteBlocks, noteHighlight } from './versionModel';

/* G7: Settings shows the running version with a copy button, offers "Update to vX" only when a newer
   installable release exists, shows progress and failure, lists the bundled release notes, and says nothing
   worse than "could not reach GitHub" offline. The server is faked; no network. */

const IDLE: InstallJob = { state: 'idle', version: null, received: 0, total: 0, error: null, howto: null, file: null };
const CHECK: UpdateCheck = {
  current: '0.1.4',
  latest: { version: '0.1.5', tag: 'v0.1.5', name: 'Sequence 0.1.5', htmlUrl: 'https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.5', publishedAt: null },
  newer: true,
  asset: { name: 'Sequence.Setup.0.1.5.exe', size: 180 * 1024 * 1024 },
  installable: true,
  checkedAt: 1_700_000_000_000,
  offline: false,
};
const snap = (check: Partial<UpdateCheck> = {}, install: Partial<InstallJob> = {}): UpdateSnapshot => ({ check: { ...CHECK, ...check }, install: { ...IDLE, ...install } });

function fakeClient(over: Partial<VersionClient> = {}): VersionClient {
  return {
    version: async () => ({ version: '0.1.4', commit: '55cc7596', platform: 'win32', arch: 'x64', desktop: true }),
    update: async () => snap(),
    install: async () => ({ ...IDLE, state: 'downloading', version: '0.1.5' }),
    releases: async () => [
      { version: '0.1.5', title: 'Sequence 0.1.5', body: '## New\n\n- Decision cards\n- **Updates** in Settings' },
      { version: '0.1.4', title: 'Sequence 0.1.4', body: '- Older' },
    ],
    ...over,
  };
}

describe('versionModel', () => {
  it('describes each state of the update row', () => {
    expect(describeUpdate(CHECK, IDLE).action).toEqual({ kind: 'update', label: 'Update to v0.1.5' });
    expect(describeUpdate({ ...CHECK, installable: false }, IDLE).action.kind).toBe('release');
    expect(describeUpdate({ ...CHECK, newer: false }, IDLE).action.kind).toBe('check');
    expect(describeUpdate({ ...CHECK, newer: false }, IDLE).title).toBe("You're up to date");
    const down = describeUpdate(CHECK, { ...IDLE, state: 'downloading', version: '0.1.5', received: 90 * 1024 * 1024, total: 180 * 1024 * 1024 });
    expect(down.progress).toBe(0.5);
    expect(down.busy).toBe(true);
    expect(down.action.kind).toBe('none');
    expect(describeUpdate(CHECK, { ...IDLE, state: 'failed', error: 'checksum' }).error).toBe('checksum');
    expect(describeUpdate(CHECK, { ...IDLE, state: 'launched', version: '0.1.5', howto: 'Drag it' }).howto).toBe('Drag it');
  });

  it('says nothing alarming offline', () => {
    const v = describeUpdate({ ...CHECK, newer: false, latest: null, offline: true, checkedAt: null }, IDLE);
    expect(v.sub).toMatch(/could not reach GitHub/i);
    expect(v.error).toBeNull();
  });

  it('formats the copy line, bytes and note blocks', () => {
    expect(copyText({ version: '0.1.4', commit: '55cc7596', platform: 'darwin', arch: 'arm64', desktop: true })).toBe('Sequence 0.1.4 (55cc7596), macOS arm64');
    expect(copyText({ version: '0.1.4', commit: null, platform: 'linux', arch: 'x64', desktop: false })).toBe('Sequence 0.1.4, Linux x64');
    expect(formatBytes(180 * 1024 * 1024)).toBe('180 MB');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(noteBlocks('## New\n\n- **A** [b](http://x)\ntext')).toEqual([
      { kind: 'h', text: 'New' },
      { kind: 'li', text: 'A b' },
      { kind: 'p', text: 'text' },
    ]);
  });
});

describe('VersionSection', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the version and build, and copies the line', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<VersionSection client={fakeClient()} />);
    await waitFor(() => expect(screen.getByTestId('settings-version-number').textContent).toBe('Sequence 0.1.4'));
    expect(screen.getByTestId('settings-version-detail').textContent).toBe('Build 55cc7596, Windows x64');
    fireEvent.click(screen.getByTestId('settings-version-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Sequence 0.1.4 (55cc7596), Windows x64'));
    await waitFor(() => expect(screen.getByTestId('settings-version-copy').textContent).toBe('Copied'));
  });

  it('offers Update to vX for a newer release and starts the install on the click, not before', async () => {
    const install = vi.fn(fakeClient().install);
    render(<VersionSection client={fakeClient({ install })} />);
    const go = await screen.findByTestId('settings-update-go');
    expect(go.textContent).toBe('Update to v0.1.5');
    expect(install).not.toHaveBeenCalled();
    fireEvent.click(go);
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('settings-update-go')).toBeNull());
    expect(screen.getByTestId('settings-update-title').textContent).toMatch(/Updating to v0\.1\.5/);
  });

  it('H1: after the click it polls even when the POST answered idle, and shows a failure that came after it', async () => {
    let calls = 0;
    const update = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? snap() : snap({}, { state: 'failed', version: '0.1.5', error: 'Could not update: GitHub answered 503' });
    });
    render(<VersionSection client={fakeClient({ update, install: async () => ({ ...IDLE }) })} />);
    fireEvent.click(await screen.findByTestId('settings-update-go'));
    expect((await screen.findByTestId('settings-update-error', {}, { timeout: 3000 })).textContent).toMatch(/503/);
  });

  it('H1: a POST the server refused is said, not swallowed', async () => {
    render(<VersionSection client={fakeClient({ install: async () => null })} />);
    fireEvent.click(await screen.findByTestId('settings-update-go'));
    expect((await screen.findByTestId('settings-update-error', {}, { timeout: 3000 })).textContent).toMatch(/could not start/i);
  });

  it('L2: the click POSTs the version shown on the button', async () => {
    const install = vi.fn(async (_v?: string) => ({ ...IDLE, state: 'downloading' as const, version: '0.1.5' }));
    render(<VersionSection client={fakeClient({ install })} />);
    fireEvent.click(await screen.findByTestId('settings-update-go'));
    await waitFor(() => expect(install).toHaveBeenCalledWith('0.1.5'));
    const bodies: unknown[] = [];
    const c = createVersionClient((async (_u: string, init?: RequestInit) => {
      bodies.push(init?.body);
      return new Response(JSON.stringify({ install: IDLE }), { status: 202 });
    }) as unknown as typeof fetch);
    await c.install('0.1.5');
    expect(bodies).toEqual([JSON.stringify({ version: '0.1.5' })]);
  });

  it('M5: a copy that is not the installed app gets "Open release page" and says why, never "Update to"', () => {
    const v = describeUpdate({ ...CHECK, installable: false, desktop: false }, IDLE);
    expect(v.action.kind).toBe('release');
    expect(v.sub).toMatch(/not the installed app/i);
  });

  it('M3: the release page link is rendered only when it is this repo on github.com over https', async () => {
    for (const bad of ['javascript:alert(1)', 'https://evil.example.com/naidx0/sequence-arch-tool/releases', 'http://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.5', 'https://github.com/attacker/x/releases/tag/v0.1.5']) {
      const latest = { ...CHECK.latest!, htmlUrl: bad };
      const a = describeUpdate({ ...CHECK, installable: false, latest }, IDLE).action;
      expect(a.kind === 'release' ? a.href : null, bad).toBe('https://github.com/naidx0/sequence-arch-tool/releases');
    }
    const good = describeUpdate({ ...CHECK, installable: false }, IDLE).action;
    expect(good.kind === 'release' ? good.href : null).toBe(CHECK.latest!.htmlUrl);
    const { unmount } = render(<VersionSection client={fakeClient({ update: async () => snap({ installable: false, latest: { ...CHECK.latest!, htmlUrl: 'javascript:alert(1)' } }) })} />);
    expect((await screen.findByTestId('settings-update-release')).getAttribute('href')).toBe('https://github.com/naidx0/sequence-arch-tool/releases');
    unmount();
  });

  it('offers no update when on the latest, and Check now asks again', async () => {
    const update = vi.fn(async (force?: boolean) => snap({ newer: false, installable: false }, {}) as UpdateSnapshot | null);
    render(<VersionSection client={fakeClient({ update })} />);
    const check = await screen.findByTestId('settings-update-check');
    expect(screen.queryByTestId('settings-update-go')).toBeNull();
    expect(update).toHaveBeenLastCalledWith(false);
    fireEvent.click(check);
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(true));
  });

  it('shows a tampered download as the failure it is, with no update button running', async () => {
    const client = fakeClient({ update: async () => snap({}, { state: 'failed', version: '0.1.5', error: 'The download did not match its published checksum' }) });
    render(<VersionSection client={client} />);
    expect((await screen.findByTestId('settings-update-error')).textContent).toMatch(/did not match/);
  });

  it('offline: no error, the build still shows', async () => {
    const client = fakeClient({ update: async () => snap({ newer: false, installable: false, latest: null, offline: true, checkedAt: null }) });
    render(<VersionSection client={client} />);
    expect((await screen.findByTestId('settings-update-sub')).textContent).toMatch(/could not reach GitHub/i);
    expect(screen.queryByTestId('settings-update-error')).toBeNull();
    expect(screen.getByTestId('settings-version-number').textContent).toBe('Sequence 0.1.4');
    /* and a server that does not answer at all */
    const dead = fakeClient({ version: async () => null, update: async () => null, releases: async () => [] });
    render(<VersionSection client={dead} />);
    expect(screen.getAllByTestId('settings-version-copy').at(-1)).toHaveProperty('disabled', true);
  });

  it('the version row does not claim the version is unreported while the request is still in flight', async () => {
    /*
     * "Version not reported" is a CLAIM about the server. Before the server has
     * answered, the panel does not know that — it knows nothing. A row that
     * says "not reported" while the request is in flight is a false statement
     * the reader sees on every open, and it is also the state a server that
     * never answers is left in.
     */
    let answer: ((v: VersionInfo | null) => void) | null = null;
    const client = fakeClient({ version: () => new Promise<VersionInfo | null>((resolve) => { answer = resolve; }) });
    render(<VersionSection client={client} />);
    const detail = screen.getByTestId('settings-version-detail');
    expect(detail.textContent).not.toMatch(/not reported/i);
    expect(detail.textContent).toMatch(/reading/i);
    expect(screen.getByTestId('settings-version-copy')).toHaveProperty('disabled', true);
    /* and once the server has answered null, it says exactly that */
    await act(async () => {
      answer!(null);
      await Promise.resolve();
    });
    expect(screen.getByTestId('settings-version-detail').textContent).toMatch(/not reported/i);
  });

  it('the update switch says which way it is set, and never claims Off while it is On', async () => {
    const client = fakeClient({ updateCheck: async () => true, setUpdateCheck: async () => true });
    render(<VersionSection client={client} />);
    const row = (await screen.findByTestId('settings-update-auto')) as HTMLInputElement;
    const sub = screen.getByTestId('settings-update-auto-sub').textContent ?? '';
    expect(row.checked).toBe(true);
    /* The line under a switch states the switch's own state. A fixed sentence
       that says "Off:" under an On switch is a control that lies about itself. */
    expect(sub).toMatch(/^On:/);
    expect(sub).not.toMatch(/^Off:/);
  });

  it('the update switch says Off when it is off, and names the button that does the looking', async () => {
    const client = fakeClient({ updateCheck: async () => false, setUpdateCheck: async () => false });
    render(<VersionSection client={client} />);
    const row = (await screen.findByTestId('settings-update-auto')) as HTMLInputElement;
    expect(row.checked).toBe(false);
    const sub = screen.getByTestId('settings-update-auto-sub').textContent ?? '';
    expect(sub).toMatch(/^Off:/);
  });

  it('lists the bundled release notes newest first, each a two-line highlight that Show all opens in place', async () => {
    render(<VersionSection client={fakeClient()} />);
    const items = await screen.findAllByTestId('settings-whatsnew-item');
    expect(items.map((i) => i.getAttribute('data-version'))).toEqual(['0.1.5', '0.1.4']);
    /* Collapsed on arrival, the newest too: a highlight, not the whole note. */
    for (const i of items) expect(i.querySelector('[data-expanded]')!.getAttribute('data-expanded')).toBe('false');
    expect(items[0]!.querySelectorAll('.sb-news-body > *').length).toBeLessThanOrEqual(2);
    const toggle = items[0]!.querySelector('button')!;
    /* 0.1.8.1 D1 (review N5): "Read more" is the link to the published notes; the in-place expansion is "Show all". */
    expect(toggle.textContent).toBe('Show all');
    const before = items[0]!.textContent!.length;
    fireEvent.click(toggle);
    expect(toggle.textContent).toBe('Show less');
    expect(items[0]!.textContent).toMatch(/Decision cards/);
    expect(items[0]!.textContent).toMatch(/Updates in Settings/);
    expect(items[0]!.textContent!.length).toBeGreaterThan(before);
    fireEvent.click(toggle);
    expect(items[0]!.textContent!.length).toBe(before);
  });

  it('the real client answers null for a dead server instead of throwing', async () => {
    const c = createVersionClient((async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    expect(await c.version()).toBeNull();
    expect(await c.update()).toBeNull();
    expect(await c.install('0.1.5')).toBeNull();
    expect(await c.releases()).toEqual([]);
    await act(async () => {});
  });
});

describe('noteBlocks links', () => {
  it('a link target with parentheses leaves no stray bracket', () => {
    expect(noteBlocks('- see [the page](https://en.wikipedia.org/wiki/Foo_(bar)) now')).toEqual([{ kind: 'li', text: 'see the page now' }]);
  });
});

describe('noteHighlight', () => {
  it('a heading shows with the line under it; without one, the first two bullets; it never invents lines', () => {
    expect(noteHighlight(noteBlocks('## Fixed\n\n- one\n- two\n\n## Changed\n\n- three'))).toEqual([
      { kind: 'h', text: 'Fixed' },
      { kind: 'li', text: 'one' },
    ]);
    expect(noteHighlight(noteBlocks('- a\n- b\n- c'))).toEqual([{ kind: 'li', text: 'a' }, { kind: 'li', text: 'b' }]);
    expect(noteHighlight(noteBlocks('## Only a heading'))).toEqual([{ kind: 'h', text: 'Only a heading' }]);
    expect(noteHighlight([])).toEqual([]);
  });
});
