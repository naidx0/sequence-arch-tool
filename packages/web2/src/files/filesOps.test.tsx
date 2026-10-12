import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TreeNode } from '@sequence/api-types';

import '../tokens/graphite.css';
import './files.css';
import '../shell2/shell2.css';

import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas';
import { twoPackages } from '../rail/fixtures';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore } from '../state';

import { FILES } from './anchors';
import { ConnectedFilesPanel } from './ConnectedFilesPanel';

/* ══════════════════════════════════════════════════════════════════════════
   FILES RAIL: drag to move, right-click menu (round 9, ask 20)
   The wire is a small in-memory disk that answers /api/tree and
   /api/file/op like the engine does, so what is asserted is the whole loop:
   gesture -> POST -> tree read again -> the row is where the disk says.
   ══════════════════════════════════════════════════════════════════════════ */

function disk(initialFiles: string[], initialDirs: string[] = []) {
  const files = new Set(initialFiles);
  const dirs = new Set(initialDirs);
  const ops: { op: string; path: string; to?: string }[] = [];
  let refuse: string | null = null;

  const tree = (): TreeNode => {
    const root: TreeNode = { name: 'repo', path: '', type: 'dir', children: [] };
    const ensure = (p: string): TreeNode => {
      let node = root;
      let acc = '';
      for (const seg of p.split('/')) {
        acc = acc === '' ? seg : `${acc}/${seg}`;
        let next = node.children!.find((c) => c.path === acc && c.type === 'dir');
        if (!next) {
          next = { name: seg, path: acc, type: 'dir', children: [] };
          node.children!.push(next);
        }
        node = next;
      }
      return node;
    };
    for (const d of dirs) ensure(d);
    for (const f of files) {
      const i = f.lastIndexOf('/');
      const parent = i < 0 ? root : ensure(f.slice(0, i));
      parent.children!.push({ name: f.slice(i + 1), path: f, type: 'file' });
    }
    return root;
  };

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/tree') return json(tree());
    if (url.pathname === '/api/git/status') return json({ branch: 'main', files: [] });
    if (url.pathname === '/api/file/op' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { op: string; path: string; to?: string };
      ops.push(body);
      if (refuse !== null) return json({ error: refuse }, 409);
      const { op, path, to } = body;
      const under = (p: string) => p === path || p.startsWith(`${path}/`);
      if (op === 'move' || op === 'rename') {
        for (const f of [...files]) if (under(f)) { files.delete(f); files.add(to! + f.slice(path.length)); }
        for (const d of [...dirs]) if (under(d)) { dirs.delete(d); dirs.add(to! + d.slice(path.length)); }
      } else if (op === 'delete') {
        for (const f of [...files]) if (under(f)) files.delete(f);
        for (const d of [...dirs]) if (under(d)) dirs.delete(d);
      } else if (op === 'mkdir') dirs.add(path);
      else if (op === 'create') files.add(path);
      else if (op === 'duplicate') {
        const copy = path.replace(/(\.[^./]+)?$/, ' copy$1');
        files.add(copy);
        return json({ ok: true, op, path, to: copy });
      }
      return json({ ok: true, op, path, to });
    }
    if (url.pathname === '/api/file') return new Response('x', { status: 200, headers: { 'content-type': 'text/plain' } });
    if (url.pathname === '/api/status') return json({ attached: false });
    return json({ error: 'no route' }, 404);
  }) as unknown as typeof fetch;

  return { files, dirs, ops, fetchImpl, refuseWith: (m: string | null) => { refuse = m; } };
}

function mount(d: ReturnType<typeof disk>) {
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
      scannedAt: new Date().toISOString(),
    },
    at: Date.now(),
  });
  render(
    <StoreProvider store={store}>
      <ConnectedFilesPanel fetchImpl={d.fetchImpl} />
    </StoreProvider>,
  );
}

const rowAt = async (path: string): Promise<HTMLElement> =>
  waitFor(() => {
    const el = screen.getAllByTestId(FILES.row).find((r) => r.getAttribute('data-path') === path);
    if (!el) throw new Error(`no row ${path}`);
    return el;
  });

const gone = async (path: string) =>
  waitFor(() => {
    if (screen.queryAllByTestId(FILES.row).some((r) => r.getAttribute('data-path') === path)) {
      throw new Error(`still ${path}`);
    }
  });

function dragData() {
  const store = new Map<string, string>();
  return {
    setData: (k: string, v: string) => void store.set(k, v),
    getData: (k: string) => store.get(k) ?? '',
    effectAllowed: 'all',
    dropEffect: 'none',
  };
}

function drag(source: HTMLElement, target: HTMLElement) {
  const dataTransfer = dragData();
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  fireEvent.dragEnd(source, { dataTransfer });
}

describe('Files rail organising', () => {
  it('dragging a file onto a folder moves it on disk and the row follows', async () => {
    const d = disk(['README.md', 'docs/guide.md', 'src/a.ts', 'src/b.ts']);
    mount(d);
    const readme = await rowAt('README.md');
    const docs = await rowAt('docs');
    drag(readme, docs);
    await waitFor(() => expect(d.ops).toEqual([{ op: 'move', path: 'README.md', to: 'docs/README.md' }]));
    expect(d.files.has('docs/README.md')).toBe(true);
    await gone('README.md');
    // the folder it landed in is opened, so the file is visible at once
    await rowAt('docs/README.md');
  });

  it('dropping on the empty tree space moves to the project root; folders cannot enter themselves', async () => {
    const d = disk(['docs/guide.md', 'src/a.ts']);
    mount(d);
    const docs = await rowAt('docs');
    const src = await rowAt('src');
    // folder onto its own child path is refused client-side (no request)
    drag(docs, docs);
    expect(d.ops).toEqual([]);
    // open docs, drag guide.md to the root (the tree background)
    fireEvent.click(docs);
    const guide = await rowAt('docs/guide.md');
    drag(guide, screen.getByTestId(FILES.tree));
    await waitFor(() => expect(d.ops).toEqual([{ op: 'move', path: 'docs/guide.md', to: 'guide.md' }]));
    await rowAt('guide.md');
    expect(src).toBeTruthy();
  });

  it('right-click offers the whole menu; Rename edits in place and posts the new name', async () => {
    const d = disk(['src/a.ts', 'src/b.ts']);
    mount(d);
    fireEvent.click(await rowAt('src'));
    const a = await rowAt('src/a.ts');
    fireEvent.contextMenu(a, { clientX: 40, clientY: 40 });
    const menu = await screen.findByTestId('files-ctx-menu');
    for (const id of ['new-file', 'new-folder', 'rename', 'duplicate', 'copy-path', 'reveal', 'delete']) {
      expect(menu.querySelector(`[data-testid="files-ctx-${id}"]`), id).not.toBeNull();
    }
    fireEvent.click(screen.getByTestId('files-ctx-rename'));
    const input = await screen.findByTestId('files-name-input');
    fireEvent.change(input, { target: { value: 'renamed.ts' } });
    (input as HTMLInputElement).value = 'renamed.ts';
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(d.ops).toEqual([{ op: 'rename', path: 'src/a.ts', to: 'src/renamed.ts' }]));
    await rowAt('src/renamed.ts');
    await gone('src/a.ts');
  });

  it('Escape cancels a rename without a request', async () => {
    const d = disk(['a.ts']);
    mount(d);
    fireEvent.contextMenu(await rowAt('a.ts'), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByTestId('files-ctx-rename'));
    fireEvent.keyDown(await screen.findByTestId('files-name-input'), { key: 'Escape' });
    expect(screen.queryByTestId('files-name-input')).toBeNull();
    expect(d.ops).toEqual([]);
  });

  it('Delete asks first; cancel leaves the file, confirm removes it', async () => {
    const d = disk(['a.ts', 'b.ts']);
    mount(d);
    fireEvent.contextMenu(await rowAt('a.ts'), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByTestId('files-ctx-delete'));
    const dialog = await screen.findByTestId('files-confirm-delete');
    expect(dialog.textContent).toContain('a.ts');
    fireEvent.click(screen.getByTestId('files-confirm-delete-cancel'));
    expect(d.ops).toEqual([]);
    expect(d.files.has('a.ts')).toBe(true);

    fireEvent.contextMenu(await rowAt('a.ts'), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByTestId('files-ctx-delete'));
    await screen.findByTestId('files-confirm-delete');
    fireEvent.click(screen.getByTestId('files-confirm-delete-ok'));
    await waitFor(() => expect(d.ops).toEqual([{ op: 'delete', path: 'a.ts' }]));
    await gone('a.ts');
    await rowAt('b.ts');
  });

  it('New folder shows an empty folder row; New file inside creates and selects it', async () => {
    const d = disk(['src/a.ts']);
    mount(d);
    fireEvent.contextMenu(screen.getByTestId(FILES.tree), { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('files-ctx-new-folder'));
    const input = await screen.findByTestId('files-name-input');
    (input as HTMLInputElement).value = 'empty';
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(d.ops).toEqual([{ op: 'mkdir', path: 'empty' }]));
    const empty = await rowAt('empty');
    expect(empty.getAttribute('data-kind')).toBe('dir');

    fireEvent.contextMenu(empty, { clientX: 5, clientY: 5 });
    fireEvent.click(await screen.findByTestId('files-ctx-new-file'));
    const input2 = await screen.findByTestId('files-name-input');
    (input2 as HTMLInputElement).value = 'x.md';
    fireEvent.keyDown(input2, { key: 'Enter' });
    await waitFor(() => expect(d.ops.at(-1)).toEqual({ op: 'create', path: 'empty/x.md' }));
    const x = await rowAt('empty/x.md');
    await waitFor(() => expect(x.getAttribute('data-selected')).toBe('true'));
  });

  it('Duplicate asks the engine for a copy; Copy path writes the path to the clipboard', async () => {
    const d = disk(['a.ts']);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(d);
    fireEvent.contextMenu(await rowAt('a.ts'), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByTestId('files-ctx-duplicate'));
    await rowAt('a copy.ts');
    fireEvent.contextMenu(await rowAt('a.ts'), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByTestId('files-ctx-copy-path'));
    expect(writeText).toHaveBeenCalledWith('a.ts');
  });

  it('a refusal from the engine is said in the tree, and the tree stays as it was', async () => {
    const d = disk(['a.ts', 'docs/x.md']);
    mount(d);
    d.refuseWith('docs/a.ts already exists');
    drag(await rowAt('a.ts'), await rowAt('docs'));
    const note = await screen.findByTestId('files-ops-note');
    expect(note.textContent).toContain('already exists');
    expect(d.files.has('a.ts')).toBe(true);
  });

  it('F2 renames the selected row and Delete asks to delete it', async () => {
    const d = disk(['a.ts']);
    mount(d);
    const a = await rowAt('a.ts');
    fireEvent.click(a);
    const tree = screen.getByTestId(FILES.tree);
    fireEvent.keyDown(tree, { key: 'F2' });
    await screen.findByTestId('files-name-input');
    fireEvent.keyDown(screen.getByTestId('files-name-input'), { key: 'Escape' });
    fireEvent.keyDown(tree, { key: 'Delete' });
    await screen.findByTestId('files-confirm-delete');
  });
});

