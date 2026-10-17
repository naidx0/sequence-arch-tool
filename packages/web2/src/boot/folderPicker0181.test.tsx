import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ATTACH_FAILURE_KINDS, attachFailureCopy, classifyAttachFailure, OUTSIDE_HOME_SENTENCE } from './attachFailure';
import { AttachDialog } from './AttachDialog';
import { BOOT_ROUTES, type BootTransport } from './bootSequence';
import { createBootTransport } from './bootClient';
import type { AttachFailure } from '../state/types';

/*
 * 0.1.8.1 C5, client half (audit P1-8: "The folder picker is limited and its error is jargon"). The desktop app opens
 * the OS folder dialog by default; a folder outside home says "Sequence can only open folders inside your home
 * folder." with [Choose another] [Allow this folder]; no internal term (jail, boundary, browseRoot) is in the UI.
 */

const JARGON = () => /jail|boundar|browse[ _-]?root|browseroot/i;

afterEach(() => {
  cleanup();
  delete (window as unknown as { sequence?: unknown }).sequence;
});

/** Every string a reader can see or hear in a subtree: text, labels, titles, placeholders. */
function uiStrings(root: Element): string[] {
  const out = [root.textContent ?? ''];
  for (const el of root.querySelectorAll('*')) {
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a);
      if (v) out.push(v);
    }
  }
  return out;
}

function fakeTransport(over: Partial<BootTransport> = {}): BootTransport {
  return {
    status: vi.fn(),
    archGraph: vi.fn(async () => ({ outcome: 'error' as const, status: 500, body: null })),
    recent: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { recent: [] } })),
    browse: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { root: 'C:/Users/user', path: 'C:/Users/user', parent: null, entries: [] } })),
    attach: vi.fn(async (path: string) => ({ outcome: 'error' as const, status: 403, body: { error: 'Sequence can only open folders inside your home folder.', action: 'allow-folder', path } })),
    detach: vi.fn(),
    ...over,
  } as unknown as BootTransport;
}

describe('the outside-home refusal, in plain words (C5)', () => {
  it('says the sentence and offers Choose another and Allow this folder', () => {
    const copy = attachFailureCopy({ kind: 'outside-browse-root', message: 'path escapes the browse root' });
    expect(copy.body).toBe('Sequence can only open folders inside your home folder.');
    expect(OUTSIDE_HOME_SENTENCE).toBe(copy.body);
    expect(copy.action.label).toBe('Choose another');
    expect(copy.secondary?.label).toBe('Allow this folder');
  });

  it('no failure copy carries an internal term, even when the server sentence does', () => {
    for (const kind of ATTACH_FAILURE_KINDS) {
      const message = 'path escapes the browse root (jail boundary, browseRoot)';
      const failure = (kind === 'no-manifests' ? { kind, repoName: 'x', message } : kind === 'transport' ? { kind, message, status: 400, said: true } : { kind, message }) as AttachFailure;
      const copy = attachFailureCopy(failure);
      const words = [copy.title, copy.body, copy.detail ?? '', copy.action.label, copy.secondary?.label ?? ''].join(' ');
      expect(words, kind).not.toMatch(JARGON());
    }
  });

  it('the rendered dialog, refusal showing, has no internal term in any text, label, title or placeholder', async () => {
    render(<AttachDialog transport={fakeTransport()} onAttached={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByTestId('attach-path'), { target: { value: 'D:/work/app' } });
    fireEvent.click(screen.getByTestId('attach-path-open'));
    await waitFor(() => expect(screen.getByTestId('attach-failure')).toBeTruthy());
    fireEvent.click(screen.getByTestId('attach-clone-toggle'));
    const strings = uiStrings(screen.getByTestId('attach'));
    expect(strings.join('\n')).toContain('Sequence can only open folders inside your home folder.');
    for (const s of strings) expect(s).not.toMatch(JARGON());
  });

  it('Allow this folder posts { path } to /api/allowed-folders and opens the folder again', async () => {
    const calls: { url: string; body: unknown }[] = [];
    let allowed = false;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null });
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (u.startsWith('/api/recent')) return json(200, { recent: [] });
      if (u.startsWith('/api/allowed-folders')) {
        allowed = true;
        return json(200, { folders: ['D:\work\app'] });
      }
      if (u.startsWith('/api/browse')) return json(200, { root: 'C:/Users/user', path: 'C:/Users/user', parent: null, entries: [] });
      if (u.startsWith('/api/attach')) return allowed ? json(500, { error: 'scan failed' }) : json(403, { error: 'Sequence can only open folders inside your home folder.', action: 'allow-folder', path: 'D:/work/app' });
      return json(404, { error: 'no' });
    }) as unknown as typeof fetch;
    expect(BOOT_ROUTES).toContain('/api/allowed-folders');
    render(<AttachDialog transport={createBootTransport(fetchImpl)} onAttached={() => {}} />);
    fireEvent.change(screen.getByTestId('attach-path'), { target: { value: 'D:/work/app' } });
    fireEvent.click(screen.getByTestId('attach-path-open'));
    await waitFor(() => expect(screen.getByTestId('attach-failure-secondary').textContent).toBe('Allow this folder'));
    fireEvent.click(screen.getByTestId('attach-failure-secondary'));
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/attach'))).toHaveLength(2));
    expect(calls.find((c) => c.url === '/api/allowed-folders')?.body).toEqual({ path: 'D:/work/app' });
  });
});

describe('the desktop app opens the OS folder dialog by default (C5)', () => {
  it('Open folder is the native picker, the in-app browser stays folded, and Choose another opens the picker again', async () => {
    const openRepo = vi.fn(async () => null);
    (window as unknown as { sequence: unknown }).sequence = { openRepo };
    render(<AttachDialog transport={fakeTransport()} onAttached={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('attach-native')).toBeTruthy());
    expect(screen.getByTestId('attach-browse').hasAttribute('hidden')).toBe(true);
    fireEvent.click(screen.getByTestId('attach-browse-here'));
    expect(screen.getByTestId('attach-browse').hasAttribute('hidden')).toBe(false);
    fireEvent.change(screen.getByTestId('attach-path'), { target: { value: 'D:/work/app' } });
    fireEvent.click(screen.getByTestId('attach-path-open'));
    await waitFor(() => expect(screen.getByTestId('attach-failure-action').textContent).toBe('Choose another'));
    fireEvent.click(screen.getByTestId('attach-failure-action'));
    await waitFor(() => expect(openRepo).toHaveBeenCalledTimes(1));
  });
});

describe('the outside-home refusal as the server sends it (C5, the server as merged)', () => {
  const BODY = { error: 'Sequence can only open folders inside your home folder.', action: 'allow-folder', path: 'E:\data\proj' };
  it('POST /api/attach and GET /api/browse 403 { error, action: allow-folder, path } read as the refusal, with its path', () => {
    const failure = classifyAttachFailure(403, BODY);
    expect(failure).toEqual({ kind: 'outside-browse-root', message: BODY.error, path: BODY.path });
    const copy = attachFailureCopy(failure);
    expect(copy.body).toBe(BODY.error);
    expect(copy.detail).toBeNull();
    expect(copy.secondary?.label).toBe('Allow this folder');
  });
  it('a browse refused outside home allows the path the refusal names, then browses there again', async () => {
    const browse = vi.fn(async (path: string | null) =>
      path === null || allowedNow
        ? { outcome: 'ok' as const, status: 200, body: { root: 'C:/Users/user', path: path ?? 'C:/Users/user', parent: null, entries: [] } }
        : { outcome: 'error' as const, status: 403, body: BODY },
    );
    let allowedNow = false;
    const allowFolder = vi.fn(async () => {
      allowedNow = true;
      return { outcome: 'ok' as const, status: 200, body: { folders: [BODY.path] } };
    });
    render(<AttachDialog transport={fakeTransport({ browse, allowFolder } as never)} onAttached={() => {}} />);
    await waitFor(() => expect(browse).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByTestId('attach-crumb')[0]!);
    await waitFor(() => expect(screen.queryByTestId('attach-failure-secondary')).toBeTruthy());
    browse.mockClear();
    await waitFor(() => expect(screen.getByTestId('attach-failure-secondary').textContent).toBe('Allow this folder'));
    fireEvent.click(screen.getByTestId('attach-failure-secondary'));
    await waitFor(() => expect(allowFolder).toHaveBeenCalledWith(BODY.path));
    await waitFor(() => expect(browse).toHaveBeenCalled());
  });
  it('a clone refused outside home allows the clone destination and clones again (not the last attach)', async () => {
    const DEST = 'E:\data\proj\app';
    let n = 0;
    const clone = vi.fn(async () => (n++ === 0 ? { outcome: 'error' as const, status: 403, body: { error: BODY.error, action: 'allow-folder' } } : { outcome: 'error' as const, status: 400, body: { error: 'later', action: 'check-url' } }));
    const allowFolder = vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { folders: [DEST] } }));
    render(<AttachDialog transport={fakeTransport({ clone, allowFolder } as never)} onAttached={() => {}} />);
    fireEvent.change(screen.getByTestId('attach-path'), { target: { value: 'C:/Users/user/other' } });
    fireEvent.click(screen.getByTestId('attach-path-open'));
    await waitFor(() => expect(screen.getByTestId('attach-failure')).toBeTruthy());
    fireEvent.click(screen.getByTestId('attach-clone-toggle'));
    fireEvent.change(screen.getByTestId('attach-clone-url'), { target: { value: 'https://github.com/o/app' } });
    fireEvent.change(screen.getByTestId('attach-clone-dest'), { target: { value: DEST } });
    fireEvent.click(screen.getByTestId('attach-clone-go'));
    await waitFor(() => expect(screen.getByTestId('attach-failure-secondary').textContent).toBe('Allow this folder'));
    fireEvent.click(screen.getByTestId('attach-failure-secondary'));
    await waitFor(() => expect(allowFolder).toHaveBeenCalledWith(DEST));
    await waitFor(() => expect(clone).toHaveBeenCalledTimes(2));
  });
});
