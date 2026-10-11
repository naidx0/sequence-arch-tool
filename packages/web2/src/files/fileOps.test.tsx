import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createStore, StoreProvider } from '../state';
import { ConnectedFilesPanel } from './ConnectedFilesPanel';
import { twoPackages } from '../rail/fixtures';
import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas';

function mount(tracked = false, worktree = false) {
  const tree = { name: '', path: '', type: 'dir', children: [
    { name: 'a.txt', path: 'a.txt', type: 'file' },
    { name: 'folder', path: 'folder', type: 'dir', children: [{ name: 'keep.txt', path: 'folder/keep.txt', type: 'file' }] },
  ] };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/file/op') return new Response(JSON.stringify({ ok: true }));
    if (String(input).startsWith('/api/git/status')) return new Response(JSON.stringify({ branch: 'main', files: [] }));
    if (String(input) === '/api/tree') return new Response(JSON.stringify(tree));
    if (String(input).startsWith('/api/file?')) return new Response('source');
    return new Response('{}', { status: 404 });
  });
  const store = createStore({ project: graph => seqdFromGraph(graph, graph.nodeDetail) });
  if (tracked) {
    const graph = twoPackages();
    store.dispatch({ type: 'repo/loaded', draft: { root: '/test/project', repoName: 'project', graph, summary: summarizeGraph(graph), scannedAt: graph.scannedAt ?? '' }, at: Date.now() });
  }
  if (worktree) {
    const entry = { id: 'tree-chat', title: 'Tree chat', createdAt: '', updatedAt: '', worktree: { branch: 'seq/tree', path: '/test/worktree' } };
    store.dispatch({ type: 'session/index', sessions: [entry], activeId: entry.id });
  }
  render(<StoreProvider store={store}><ConnectedFilesPanel fetchImpl={fetchImpl} /></StoreProvider>);
  return fetchImpl;
}
it('labels attached-project scope and removes mutation affordances for a worktree chat', async () => {
  const fetchImpl = mount(true, true);
  await screen.findByTitle('a.txt');
  expect(await screen.findByText(/Files show the attached project.*project/)).toBeTruthy();
  expect(screen.getByText(/disabled in a worktree chat/i)).toBeTruthy();
  const file = document.querySelector<HTMLElement>('[data-path="a.txt"]')!;
  expect(file.draggable).toBe(false);
  fireEvent.contextMenu(file);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(file);
  fireEvent.keyDown(screen.getByRole('tree'), { key: 'F2' });
  expect(screen.queryByRole('textbox', { name: 'New name' })).toBeNull();
  expect(fetchImpl.mock.calls.some(([p]) => String(p) === '/api/file/op')).toBe(false);
});
