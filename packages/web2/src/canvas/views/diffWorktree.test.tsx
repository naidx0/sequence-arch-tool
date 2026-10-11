/* S7 on the board: when the active chat is bound to a worktree, the Diff view
   reads the worktree against its recorded base commit and names the branch in
   its header. Stubbed API only. */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ArchGraph } from '@sequence/schema';

import { DiffView } from './DiffView';
import type { ViewBox } from './viewModel';

const graph = {
  nodes: [
    { id: 'svc:orders', kind: 'service', label: 'orders', path: 'orders' },
    { id: 'svc:pay', kind: 'service', label: 'payments', path: 'payments' },
  ],
  edges: [],
} as unknown as ArchGraph;
const boxes: ViewBox[] = [
  { id: 'svc:orders', label: 'orders' },
  { id: 'svc:pay', label: 'payments' },
];
const WT = {
  id: 'aaaaaaaa',
  path: '/data/wt/aaaaaaaa',
  branch: 'sequence/add-ping-3c4d',
  baseCommit: '0123456789abcdef0123456789abcdef01234567',
  baseBranch: 'main',
  createdAt: '2026-10-06T00:00:00.000Z',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function api(worktree: unknown) {
  return vi.fn(async (url: string) => {
    if (url === '/api/sessions/chat-1/worktree') return json({ worktree });
    if (url === '/api/sessions/chat-1/worktree/changes') return json({ worktree, files: [{ path: 'orders/app/main.py', status: 'modified' }, { path: 'NOTES.md', status: 'added' }], dirty: true });
    if (url.startsWith('/api/git/branch-files')) return json({ files: [{ path: 'payments/c.ts', status: 'modified' }] });
    return json({ error: 'unexpected' }, 404);
  });
}

describe('the Diff view of a worktree chat', () => {
  it('reads the worktree against its base commit and names the branch in the header', async () => {
    const f = api(WT);
    render(<DiffView boxes={boxes} lines={[]} graph={graph} fetchImpl={f} sessionId="chat-1" />);
    const head = await screen.findByTestId('diff-worktree');
    expect(head.textContent).toBe('Worktree add-ping-3c4d against 0123456');
    await waitFor(() => expect(screen.getByTestId('diff-summary').textContent).toMatch(/1 box changes against commit 0123456, where this chat began/));
    expect(f.mock.calls.map((c) => c[0])).toContain('/api/sessions/chat-1/worktree/changes');
    /* The user's branch base is not the question here. */
    expect((screen.getByTestId('diff-base').closest('form') as HTMLFormElement).hidden).toBe(true);
  });

  it('control: an unbound chat (or a merged worktree) diffs the branch as before, with no worktree header', async () => {
    for (const wt of [null, { ...WT, merged: { at: 'x', mode: 'merge', into: 'main', commit: 'c' } }]) {
      const f = api(wt);
      const view = render(<DiffView boxes={boxes} lines={[]} graph={graph} fetchImpl={f} sessionId="chat-1" />);
      await waitFor(() => expect(screen.getByTestId('diff-summary').textContent).toMatch(/against main/));
      expect(screen.queryByTestId('diff-worktree')).toBeNull();
      expect(f.mock.calls.map((c) => c[0])).not.toContain('/api/sessions/chat-1/worktree/changes');
      view.unmount();
    }
  });
});
