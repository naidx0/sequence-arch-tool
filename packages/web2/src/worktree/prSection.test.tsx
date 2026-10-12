import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PrSection, prPlan, type PrPreview } from './PrSection';

const PREVIEW: PrPreview = {
  commitMessage: 'Add a ping endpoint\n\n- added ping.txt',
  title: 'Add a ping endpoint',
  body: '## Changes\n\n- added `ping.txt`',
  files: [{ path: 'ping.txt', status: 'added' }],
  pending: [
    { path: 'ping.txt', status: 'added', flagged: null },
    { path: '.env', status: 'added', flagged: 'an environment file' },
  ],
  dirty: true,
  remote: 'origin',
  base: 'main',
  branch: 'sequence/add-a-ping-endpoint-ab12',
  pr: null,
};
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });

function server(over: { pr?: unknown; open?: () => Response; preview?: Partial<PrPreview> } = {}) {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) });
    if (url.endsWith('/pr/preview')) return json(200, { ...PREVIEW, ...over.preview });
    if (url.endsWith('/pr') && init?.method === 'POST') return over.open?.() ?? json(200, { pr: { url: 'https://github.com/example/repo/pull/7', number: 7, title: 'x', branch: 'b', base: 'main' }, existing: false });
    return json(200, { pr: over.pr ?? null });
  };
  return { calls, fetchImpl };
}

describe('the pull request section', () => {
  it('says what will happen before it does anything, then one press sends the edited title and body', async () => {
    const s = server();
    render(<PrSection sessionId="chat-1" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await screen.findByTestId('worktree-pr-open'));
    expect((await screen.findByTestId('worktree-pr-plan')).textContent).toBe('Commit 1 file on sequence/add-a-ping-endpoint-ab12, push to origin, and open a pull request into main.');
    expect(s.calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/preview'))).toHaveLength(0);
    fireEvent.change(screen.getByTestId('worktree-pr-title'), { target: { value: 'Ping route' } });
    fireEvent.click(screen.getByTestId('worktree-pr-go'));
    const link = await screen.findByTestId('worktree-pr-linked');
    expect(link.textContent).toMatch(/Pull request #7 into main/);
    expect(link.querySelector('a')!.getAttribute('href')).toBe('https://github.com/example/repo/pull/7');
    const sent = s.calls.find((c) => c.method === 'POST' && c.url === '/api/sessions/chat-1/pr')!;
    expect(sent.body).toMatchObject({ title: 'Ping route', body: PREVIEW.body, commitMessage: PREVIEW.commitMessage });
  });

  it('a chat that already has a pull request shows it and offers to push newer commits instead of opening another', async () => {
    const s = server({ pr: { url: 'https://github.com/example/repo/pull/3', number: 3, title: 't', branch: 'b', base: 'main' } });
    render(<PrSection sessionId="chat-1" fetchImpl={s.fetchImpl} />);
    expect((await screen.findByTestId('worktree-pr-linked')).textContent).toMatch(/#3/);
    expect(screen.getByTestId('worktree-pr-open').textContent).toBe('Push newer commits');
  });

  it('lists every file, holds back anything that looks like a secret, and sends only the ones ticked', async () => {
    const s = server();
    render(<PrSection sessionId="chat-1" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await screen.findByTestId('worktree-pr-open'));
    expect((await screen.findByTestId('worktree-pr-files')).textContent).toMatch(/ping\.txt/);
    const held = screen.getByTestId('worktree-pr-held');
    expect(held.textContent).toMatch(/\.env/);
    expect((screen.getByTestId('worktree-pr-hold') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId('worktree-pr-go'));
    await screen.findByTestId('worktree-pr-linked');
    expect(s.calls.find((c) => c.method === 'POST' && c.url === '/api/sessions/chat-1/pr')!.body).toMatchObject({ includeFlagged: [] });

    fireEvent.click(screen.getByTestId('worktree-pr-open'));
    fireEvent.click(await screen.findByTestId('worktree-pr-hold'));
    expect(screen.getByTestId('worktree-pr-plan').textContent).toMatch(/Commit 2 files/);
    fireEvent.click(screen.getByTestId('worktree-pr-go'));
    await waitFor(() => expect(s.calls.filter((c) => c.method === 'POST' && c.url === '/api/sessions/chat-1/pr')).toHaveLength(2));
    expect(s.calls.filter((c) => c.method === 'POST' && c.url === '/api/sessions/chat-1/pr')[1]!.body).toMatchObject({ includeFlagged: ['.env'] });
  });

  it('a secret the agent committed itself must be ticked before the push can go', async () => {
    const s = server({ preview: { committed: [{ path: 'id_rsa', status: 'added', flagged: 'an SSH key' }], pending: [] } });
    render(<PrSection sessionId="chat-1" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await screen.findByTestId('worktree-pr-open'));
    expect((await screen.findByTestId('worktree-pr-held')).textContent).toMatch(/id_rsa.*already committed/);
    const go = screen.getByTestId('worktree-pr-go') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('worktree-pr-hold'));
    expect(go.disabled).toBe(false);
  });

  it('Push newer commits shows the same file list first instead of pushing at once', async () => {
    const s = server({ pr: { url: 'https://github.com/example/repo/pull/3', number: 3, title: 't', branch: 'b', base: 'main' }, preview: { pr: { url: 'u', number: 3, title: 't', branch: 'b', base: 'main' } } });
    render(<PrSection sessionId="chat-1" fetchImpl={s.fetchImpl} />);
    await screen.findByTestId('worktree-pr-linked');
    fireEvent.click(screen.getByTestId('worktree-pr-open'));
    expect((await screen.findByTestId('worktree-pr-files')).textContent).toMatch(/ping\.txt/);
    expect(s.calls.filter((c) => c.method === 'POST' && !c.url.endsWith('/preview'))).toHaveLength(0);
    expect(screen.getByTestId('worktree-pr-plan').textContent).toMatch(/The pull request updates/);
  });

  it('a failure after the push says so and offers the compare link; nothing is shown as linked', async () => {
    const s = server({ open: () => json(424, { error: 'The branch b was pushed to origin, but the GitHub CLI (gh) was not found.', compareUrl: 'https://github.com/o/r/compare/main...b?expand=1' }) });
    render(<PrSection sessionId="chat-1" fetchImpl={s.fetchImpl} />);
    fireEvent.click(await screen.findByTestId('worktree-pr-open'));
    fireEvent.click(await screen.findByTestId('worktree-pr-go'));
    await waitFor(() => expect(screen.getByTestId('worktree-pr-error').textContent).toMatch(/was pushed/));
    expect(screen.getByText('Open it on GitHub').getAttribute('href')).toBe('https://github.com/o/r/compare/main...b?expand=1');
    expect(screen.queryByTestId('worktree-pr-linked')).toBeNull();
  });

  it('plan wording: nothing to commit just pushes', () => {
    expect(prPlan({ ...PREVIEW, pending: [] })).toBe('Push sequence/add-a-ping-endpoint-ab12 to origin, and open a pull request into main.');
  });
});
