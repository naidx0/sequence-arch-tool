import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TreeNode } from '@sequence/api-types';

import '../tokens/graphite.css';
import './files.css';

import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { seqdFromGraph } from '../canvas';
import { twoPackages } from '../rail/fixtures';
import { summarizeGraph } from '../boot';

import { FILES } from './anchors';
import { ConnectedFilesPanel } from './ConnectedFilesPanel';
import { branchRenames, branchStatusMap, buildFileTree, flattenFileTree, toRepoPath } from './filesModel';
import type { FileStatus, RepoPath } from './filesModel';

/* ══════════════════════════════════════════════════════════════════════════
   FILES SHOWS WHAT THIS BRANCH CHANGED — E1/E2
   Jaden: "files should show the status symbols according to it on that
   particular branch".
   ══════════════════════════════════════════════════════════════════════════ */

afterEach(() => window.localStorage.clear());

describe('branchStatusMap', () => {
  const files = [
    { path: 'src/a.ts', status: 'A' as const, added: 3, removed: 0 },
    { path: 'src/b.ts', status: 'M' as const, added: 1, removed: 1 },
    { path: 'docs/old.md', status: 'D' as const, added: 0, removed: 9 },
    { path: 'src/c.ts', oldPath: 'src/z.ts', status: 'R' as const, added: 0, removed: 0 },
  ];

  it('maps A/M/D/R to the words the tree already draws', () => {
    const map = branchStatusMap(files, null);
    expect(map.get(toRepoPath('src/a.ts'))).toBe('added');
    expect(map.get(toRepoPath('src/b.ts'))).toBe('modified');
    expect(map.get(toRepoPath('docs/old.md'))).toBe('deleted');
    expect(map.get(toRepoPath('src/c.ts'))).toBe('renamed');
  });

  it('keeps working-tree marks for files the branch did not change, and branch wins elsewhere', () => {
    const working = new Map<RepoPath, FileStatus>([
      [toRepoPath('notes.txt'), 'untracked'],
      [toRepoPath('src/b.ts'), 'untracked'],
    ]);
    const map = branchStatusMap(files, working);
    expect(map.get(toRepoPath('notes.txt'))).toBe('untracked');
    expect(map.get(toRepoPath('src/b.ts'))).toBe('modified');
  });

  it('never loses a conflict to a branch mark', () => {
    const working = new Map<RepoPath, FileStatus>([[toRepoPath('src/b.ts'), 'conflicted']]);
    expect(branchStatusMap(files, working).get(toRepoPath('src/b.ts'))).toBe('conflicted');
  });
});

describe('renames keep where they came from', () => {
  it('branchRenames maps a renamed path to its old path and nothing else', () => {
    const map = branchRenames([
      { path: 'src/c.ts', oldPath: 'src/z.ts', status: 'R', added: 0, removed: 0 },
      { path: 'src/a.ts', status: 'A', added: 1, removed: 0 },
    ]);
    expect([...map.entries()]).toEqual([['src/c.ts', 'src/z.ts']]);
  });
});

describe('a folder rolls up how many files under it changed', () => {
  it('counts changed files beneath a directory and none on a file', () => {
    const tree = buildFileTree(['src/a.ts', 'src/b.ts', 'src/c.ts', 'docs/x.md']);
    const status = new Map<RepoPath, FileStatus>([
      [toRepoPath('src/a.ts'), 'added'],
      [toRepoPath('src/b.ts'), 'modified'],
    ]);
    const { rows } = flattenFileTree(tree, { expanded: 'all', status });
    const src = rows.find((r) => r.path === 'src')!;
    const docs = rows.find((r) => r.path === 'docs')!;
    expect(src.changedCount).toBe(2);
    expect(docs.changedCount).toBe(0);
    expect(rows.find((r) => r.path === 'src/a.ts')!.changedCount).toBe(0);
  });
});

/* ── the wired toggle ─────────────────────────────────────────────────── */

const TREE: TreeNode = {
  name: 'repo',
  path: '',
  type: 'dir',
  children: [
    {
      name: 'src',
      path: 'src',
      type: 'dir',
      children: [
        { name: 'a.ts', path: 'src/a.ts', type: 'file' },
        { name: 'b.ts', path: 'src/b.ts', type: 'file' },
      ],
    },
    { name: 'notes.txt', path: 'notes.txt', type: 'file' },
  ],
};

function mount(branchChanges: 'served' | 'missing', branches: 'served' | 'missing' = 'missing') {
  const calls: string[] = [];
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(url.pathname + url.search);
    if (url.pathname === '/api/tree') return json(TREE);
    if (url.pathname === '/api/git/status')
      return json({ branch: 'feature/x', files: [{ path: 'notes.txt', status: 'untracked' }] });
    if (url.pathname === '/api/git/branch-changes') {
      if (branchChanges === 'missing') return json({ error: 'not found' }, 404);
      return json({
        branch: 'feature/x',
        base: 'main',
        mergeBase: 'abc',
        head: 'def',
        files: [
          { path: 'src/a.ts', status: 'A', added: 3, removed: 0 },
          { path: 'src/b.ts', status: 'M', added: 1, removed: 2 },
          { path: 'old.md', status: 'D', added: 0, removed: 4 },
          { path: 'moved.txt', oldPath: 'notes-old.txt', status: 'R', added: 0, removed: 0 },
        ],
      });
    }
    if (url.pathname === '/api/git/branches')
      return branches === 'missing'
        ? json({ error: 'nf' }, 404)
        : json({ current: 'feature/x', detached: false, sha: 'abc', dirty: false, branches: [{ name: 'feature/x', ahead: 0, behind: 0, lastCommit: null }], remoteBranches: [] });
    if (url.pathname === '/api/status') return json({ attached: false });
    return json({ error: 'no route' }, 404);
  }) as unknown as typeof fetch;
  const graph = twoPackages();
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/repo',
      repoName: 'repo',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: graph.scannedAt ?? new Date().toISOString(),
    },
    at: Date.now(),
  });
  render(
    <StoreProvider store={store}>
      <ConnectedFilesPanel fetchImpl={fetchImpl} />
    </StoreProvider>,
  );
  return { calls };
}

const rowFor = async (path: string) =>
  await waitFor(() => {
    const el = screen.getAllByTestId(FILES.row).find((e) => e.getAttribute('data-path') === path);
    if (!el) throw new Error(`no row ${path}`);
    return el;
  });

describe('Working tree | This branch', () => {
  it('shows branch marks and a folder count after switching to This branch', async () => {
    mount('served');
    const toggle = await screen.findByTestId('files-scope');
    fireEvent.click(await rowFor('src'));
    fireEvent.click(within(toggle).getByRole('button', { name: /this branch/i }));
    await waitFor(async () => {
      expect(within(await rowFor('src/a.ts')).getByText('A')).toBeTruthy();
    });
    expect(within(await rowFor('src/b.ts')).getByText('M')).toBeTruthy();
    expect(within(await rowFor('src')).getByText('2')).toBeTruthy();
    /* A file the branch deleted is no longer on disk, and still listed with its D. */
    expect(within(await rowFor('old.md')).getByText('D')).toBeTruthy();
    /* A rename says where it came from. */
    expect((await rowFor('moved.txt')).getAttribute('title')).toContain('renamed from notes-old.txt');
  });

  it('hides the toggle quietly when the engine has no branch-changes route', async () => {
    const { calls } = mount('missing');
    await rowFor('notes.txt');
    await waitFor(() => expect(calls.some((c) => c.startsWith('/api/git/branch-changes'))).toBe(true));
    expect(screen.queryByTestId('files-scope')).toBeNull();
  });
});

describe('the branch in the Files header', () => {
  it('is the switcher when the engine serves branches', async () => {
    mount('served', 'served');
    expect(await screen.findByTestId('branch-switcher-trigger')).toBeTruthy();
    expect(screen.queryByTestId(FILES.branch)).toBeNull();
  });

  it('keeps the static branch name when it does not', async () => {
    mount('served', 'missing');
    expect(await screen.findByTestId(FILES.branch)).toBeTruthy();
    expect(screen.queryByTestId('branch-switcher-trigger')).toBeNull();
  });
});
