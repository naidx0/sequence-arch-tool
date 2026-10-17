import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachDialog } from './AttachDialog';
import { attachFailureCopy, classifyAttachFailure } from './attachFailure';
import { createBootTransport } from './bootClient';
import type { BootTransport } from './bootSequence';

/*
 * 0.1.8.1 C4, client half (audit P1-7: 'Error copy "The engine answered 400"; clone ignores the target dir and is
 * GitHub-only'). A 4xx with a body `error` is titled with the server's sentence and offers the action it named;
 * "engine" is said only for a 5xx or no answer. The clone sends the chosen folder and takes any git URL.
 */

afterEach(cleanup);

describe('a refusal reads as the server said it (C4)', () => {
  it('4xx with an error: the sentence is the title, never "engine"', () => {
    const failure = classifyAttachFailure(400, { error: 'that is not a git repository URL' });
    const copy = attachFailureCopy(failure);
    expect(copy.title).toBe('That is not a git repository URL');
    expect(`${copy.title} ${copy.body} ${copy.detail ?? ''}`).not.toMatch(/engine/i);
    expect(copy.action).toEqual({ label: 'Try again', intent: 'retry' });
  });

  it("the body's action becomes the control: 'connect-github' is Connect GitHub", () => {
    const copy = attachFailureCopy(classifyAttachFailure(400, { error: 'connect GitHub in Settings first to clone by name', action: 'connect-github' }));
    expect(copy.title).toBe('Connect GitHub in Settings first to clone by name');
    expect(copy.action).toEqual({ label: 'Connect GitHub', intent: 'connect-github' });
  });

  it('an action this build does not know is not shown as a raw word', () => {
    const copy = attachFailureCopy(classifyAttachFailure(409, { error: 'already cloned there', action: 'frobnicate' }));
    expect(copy.action.label).toBe('Try again');
  });

  it('a 4xx with no words says the status, still not "engine"', () => {
    const copy = attachFailureCopy(classifyAttachFailure(400, null));
    expect(`${copy.title} ${copy.body}`).not.toMatch(/engine/i);
    expect(copy.body).toContain('400');
  });

  it('"engine" is kept for no answer and for a 5xx', () => {
    expect(attachFailureCopy(classifyAttachFailure(null, null, 'fetch failed')).title).toMatch(/engine/i);
    expect(attachFailureCopy({ kind: 'transport', status: 502, message: 'bad gateway' }).title).toMatch(/engine/i);
  });
});

describe('the clone sends where it goes (C4)', () => {
  it('createBootTransport posts { cloneUrl, destination } to the clone route (PostGithubCloneRequest)', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ error: 'x' }), { status: 400, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const t = createBootTransport(fetchImpl);
    await t.clone!('git@gitlab.com:team/app.git', 'C:/Users/user/code');
    await t.clone!('https://example.org/x.git');
    expect(calls).toEqual([
      { url: '/api/github/clone', body: { cloneUrl: 'git@gitlab.com:team/app.git', destination: 'C:/Users/user/code' } },
      { url: '/api/github/clone', body: { cloneUrl: 'https://example.org/x.git' } },
    ]);
  });

  it('the dialog sends <browsed folder>/<repo name> as destination (shown, editable), any git URL, and shows the refusal with its action', async () => {
    const clone = vi.fn(async () => ({ outcome: 'error' as const, status: 400, body: { error: 'connect GitHub in Settings first', action: 'connect-github' } }));
    const onConnectGithub = vi.fn();
    const transport = {
      status: vi.fn(),
      archGraph: vi.fn(),
      recent: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { recent: [] } })),
      browse: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { root: 'C:/Users/user', path: 'C:/Users/user/code', parent: 'C:/Users/user', entries: [] } })),
      attach: vi.fn(),
      detach: vi.fn(),
      clone,
    } as unknown as BootTransport;
    render(<AttachDialog transport={transport} onAttached={() => {}} onConnectGithub={onConnectGithub} />);
    fireEvent.click(screen.getByTestId('attach-clone-toggle'));
    await waitFor(() => expect((screen.getByTestId('attach-clone-dest') as HTMLInputElement).value).toBe('C:/Users/user/code'));
    fireEvent.change(screen.getByTestId('attach-clone-url'), { target: { value: 'ssh://git@host.example/team/app.git' } });
    /* The destination is the checkout itself (new or empty, review B2): the browsed folder plus the repository's name. */
    expect((screen.getByTestId('attach-clone-dest') as HTMLInputElement).value).toBe('C:/Users/user/code/app');
    fireEvent.click(screen.getByTestId('attach-clone-go'));
    await waitFor(() => expect(screen.getByTestId('attach-failure')).toBeTruthy());
    expect(clone).toHaveBeenCalledWith('ssh://git@host.example/team/app.git', 'C:/Users/user/code/app');
    const strip = screen.getByTestId('attach-failure');
    expect(strip.textContent).toContain('Connect GitHub in Settings first');
    expect(strip.textContent).not.toMatch(/engine/i);
    fireEvent.click(screen.getByTestId('attach-failure-action'));
    expect(onConnectGithub).toHaveBeenCalledTimes(1);
  });

  it('an edited destination is sent as typed', async () => {
    const clone = vi.fn(async () => ({ outcome: 'error' as const, status: 409, body: { error: 'That folder is not empty.', action: 'choose-folder' } }));
    render(<AttachDialog transport={dialogTransport(clone)} onAttached={() => {}} />);
    fireEvent.click(screen.getByTestId('attach-clone-toggle'));
    fireEvent.change(screen.getByTestId('attach-clone-url'), { target: { value: 'https://github.com/o/r' } });
    fireEvent.change(screen.getByTestId('attach-clone-dest'), { target: { value: 'C:/Users/user/elsewhere' } });
    fireEvent.click(screen.getByTestId('attach-clone-go'));
    await waitFor(() => expect(clone).toHaveBeenCalledWith('https://github.com/o/r', 'C:/Users/user/elsewhere'));
  });
});

/** The server's clone refusals, exactly as PostGithubCloneRefusal: every 4xx is { error, action }. */
describe('the clone refusals, mapped (C4, the server as merged)', () => {
  const copyOf = (status: number, body: unknown) => attachFailureCopy(classifyAttachFailure(status, body));
  it('connect-github is "Connect GitHub"; check-url is "Check the address"; choose-folder is "Choose a folder"', () => {
    expect(copyOf(400, { error: 'Connect GitHub to clone by name.', action: 'connect-github' }).action).toEqual({ label: 'Connect GitHub', intent: 'connect-github' });
    expect(copyOf(400, { error: 'That address is not a git repository.', action: 'check-url' }).action).toEqual({ label: 'Check the address', intent: 'check-url' });
    expect(copyOf(409, { error: 'That folder is not empty.', action: 'choose-folder' }).action).toEqual({ label: 'Choose a folder', intent: 'choose-folder' });
  });
  it('the sentence is the title whatever the 4xx (a clone 403 or 404 is not a folder refusal)', () => {
    for (const status of [400, 403, 404, 409, 422]) {
      const copy = copyOf(status, { error: 'that repository was not found', action: 'check-url' });
      expect(copy.title, String(status)).toBe('That repository was not found');
      expect(`${copy.title} ${copy.body}`).not.toMatch(/engine|home folder/i);
    }
  });
  it('check-url focuses the address; choose-folder focuses the folder field (no desktop picker)', async () => {
    const answers = [
      { outcome: 'error' as const, status: 400, body: { error: 'That address is not a git repository.', action: 'check-url' } },
      { outcome: 'error' as const, status: 409, body: { error: 'That folder is not empty.', action: 'choose-folder' } },
    ];
    const clone = vi.fn(async () => answers.shift()!);
    render(<AttachDialog transport={dialogTransport(clone)} onAttached={() => {}} />);
    fireEvent.click(screen.getByTestId('attach-clone-toggle'));
    fireEvent.change(screen.getByTestId('attach-clone-url'), { target: { value: 'https://example.org/nope' } });
    fireEvent.click(screen.getByTestId('attach-clone-go'));
    await waitFor(() => expect(screen.getByTestId('attach-failure-action').textContent).toBe('Check the address'));
    fireEvent.click(screen.getByTestId('attach-failure-action'));
    expect(document.activeElement).toBe(screen.getByTestId('attach-clone-url'));
    fireEvent.click(screen.getByTestId('attach-clone-go'));
    await waitFor(() => expect(screen.getByTestId('attach-failure-action').textContent).toBe('Choose a folder'));
    fireEvent.click(screen.getByTestId('attach-failure-action'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('attach-clone-dest')));
  });
  it('choose-folder in the desktop app opens the folder dialog (pickFolder) and uses the folder chosen', async () => {
    const pickFolder = vi.fn(async () => 'D:/code/new-app');
    (window as unknown as { sequence: unknown }).sequence = { openRepo: vi.fn(), pickFolder };
    try {
      const clone = vi.fn(async () => ({ outcome: 'error' as const, status: 409, body: { error: 'That folder is not empty.', action: 'choose-folder' } }));
      render(<AttachDialog transport={dialogTransport(clone)} onAttached={() => {}} />);
      fireEvent.click(screen.getByTestId('attach-clone-toggle'));
      fireEvent.change(screen.getByTestId('attach-clone-url'), { target: { value: 'https://github.com/o/r' } });
      fireEvent.click(screen.getByTestId('attach-clone-go'));
      await waitFor(() => expect(screen.getByTestId('attach-failure-action').textContent).toBe('Choose a folder'));
      fireEvent.click(screen.getByTestId('attach-failure-action'));
      await waitFor(() => expect((screen.getByTestId('attach-clone-dest') as HTMLInputElement).value).toBe('D:/code/new-app'));
      expect(pickFolder).toHaveBeenCalledTimes(1);
    } finally {
      delete (window as unknown as { sequence?: unknown }).sequence;
    }
  });
});

function dialogTransport(clone: unknown): BootTransport {
  return {
    status: vi.fn(),
    archGraph: vi.fn(),
    recent: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { recent: [] } })),
    browse: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { root: 'C:/Users/user', path: 'C:/Users/user/code', parent: 'C:/Users/user', entries: [] } })),
    attach: vi.fn(),
    detach: vi.fn(),
    clone,
  } as unknown as BootTransport;
}
