import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TreeNode } from '@sequence/api-types';

import '../tokens/graphite.css';
import './files.css';

import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas';
import { CanvasProvider, useCanvasOptional } from '../canvas/canvasChannel';
import { setHostCommandHandler } from '../app/hostCommands';
import { twoPackageFunctions, twoPackages } from '../rail/fixtures';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore } from '../state';

import { FILES } from './anchors';
import { ConnectedFilesPanel } from './ConnectedFilesPanel';

/* ══════════════════════════════════════════════════════════════════════════
   I6 (P5 option A) — THE FILES TREE LISTS FUNCTIONS UNDER A FILE, AND CLICKING
   ONE PLAYS ITS FLOW ON THE ARCHITECTURE BOARD.
   Only what GET /api/functions returned is listed.
   ══════════════════════════════════════════════════════════════════════════ */

const file = (p: string): TreeNode => ({ path: p, name: p.split('/').pop()!, type: 'file' });
const TREE: TreeNode = {
  name: 'repo',
  path: '',
  type: 'dir',
  children: [
    {
      name: 'packages',
      path: 'packages',
      type: 'dir',
      children: [
        {
          name: 'alpha',
          path: 'packages/alpha',
          type: 'dir',
          children: [{ name: 'src', path: 'packages/alpha/src', type: 'dir', children: [file('packages/alpha/src/one.ts'), file('packages/alpha/src/two.ts'), file('packages/alpha/src/plain.md')] }],
        },
      ],
    },
  ],
};

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function Probe() {
  const canvas = useCanvasOptional();
  const view = canvas?.canvas.view;
  return (
    <p data-testid="probe">
      {view && view.state === 'S3' ? `S3:${view.playback.functionId}:${view.playback.hops.length}` : (view?.state ?? 'none')}
    </p>
  );
}

function mount(functions: 'served' | 'missing') {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(url.pathname);
    if (url.pathname === '/api/tree') return json(TREE);
    if (url.pathname === '/api/git/status') return json({ branch: 'main', files: [] });
    if (url.pathname === '/api/functions') return functions === 'served' ? json(twoPackageFunctions()) : json({ error: 'nf' }, 404);
    if (url.pathname === '/api/status') return json({ attached: false });
    return json({ error: 'nf' }, 404);
  }) as unknown as typeof fetch;
  const graph = twoPackages();
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: { root: '/repo', repoName: 'repo', graph, summary: summarizeGraph(graph), scannedAt: 'x' },
    at: 0,
  });
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <ConnectedFilesPanel fetchImpl={fetchImpl} />
        <Probe />
      </CanvasProvider>
    </StoreProvider>,
  );
  return { calls, store };
}

const rowFor = async (path: string) =>
  await waitFor(() => {
    const el = screen.getAllByTestId(FILES.row).find((e) => e.getAttribute('data-path') === path);
    if (!el) throw new Error(`no row ${path}`);
    return el;
  });

async function openOne() {
  fireEvent.click(await rowFor('packages'));
  fireEvent.click(await rowFor('packages/alpha/src'));
  const one = await rowFor('packages/alpha/src/one.ts');
  fireEvent.click(await waitFor(() => within(one).getByTestId('files-symbols-toggle')));
  return one;
}

afterEach(() => {
  setHostCommandHandler(null);
  window.localStorage.clear();
});

describe('the Files tree lists functions under a file', () => {
  it('opens a file to the functions the server returned, in source order, and no others', async () => {
    mount('served');
    await openOne();
    const names = screen.getAllByTestId('files-symbol').map((r) => r.textContent);
    expect(names.map((n) => n!.replace(/^ƒ/, '').replace(/\d+$/, ''))).toEqual(['openGate', 'helper']);
    /* two.ts has `store`, plain.md has nothing: only the file with functions gets a toggle. */
    expect(within(await rowFor('packages/alpha/src/two.ts')).getByTestId('files-symbols-toggle')).toBeTruthy();
    expect(within(await rowFor('packages/alpha/src/plain.md')).queryByTestId('files-symbols-toggle')).toBeNull();
  });

  it('is exactly today\'s tree when /api/functions is not served', async () => {
    mount('missing');
    fireEvent.click(await rowFor('packages'));
    fireEvent.click(await rowFor('packages/alpha/src'));
    await rowFor('packages/alpha/src/one.ts');
    expect(screen.queryByTestId('files-symbols-toggle')).toBeNull();
    expect(screen.queryByTestId('files-symbol')).toBeNull();
  });
});

describe('clicking a function plays its flow', () => {
  it('a traced function dispatches canvas/flow (S3 with its hops), opens the board, and shows the flow strip', async () => {
    mount('served');
    const host = vi.fn();
    setHostCommandHandler(host);
    await openOne();
    const open = screen.getAllByTestId('files-symbol').find((r) => r.getAttribute('data-function-id') === 'fn:one')!;
    fireEvent.click(open);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toMatch(/^S3:fn:one:\d+$/));
    expect(Number(screen.getByTestId('probe').textContent!.split(':').pop())).toBeGreaterThan(0);
    expect(host).toHaveBeenCalledWith('canvas.board');
    expect(screen.getByTestId('rail-flow')).toBeTruthy();
    expect(screen.getAllByTestId('files-symbol').find((r) => r.getAttribute('data-function-id') === 'fn:one')!.getAttribute('data-playing')).toBe('true');
  });

  it('a function the scan cannot trace past its file says "Not traced" and plays nothing', async () => {
    mount('served');
    await openOne();
    const helper = screen.getAllByTestId('files-symbol').find((r) => r.getAttribute('data-function-id') === 'fn:two')!;
    fireEvent.click(helper);
    await waitFor(() => expect(within(helper).getByTestId('files-symbol-untraced').textContent).toBe('Not traced'));
    expect(screen.getByTestId('probe').textContent).not.toMatch(/^S3/);
  });
});
