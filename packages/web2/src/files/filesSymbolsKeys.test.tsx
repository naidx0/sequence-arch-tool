import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { TreeNode } from '@sequence/api-types';

import '../tokens/graphite.css';
import './files.css';

import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas';
import { CanvasProvider, useCanvasOptional } from '../canvas/canvasChannel';
import { twoPackageFunctions, twoPackages } from '../rail/fixtures';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore } from '../state';

import { FILES } from './anchors';
import { ConnectedFilesPanel } from './ConnectedFilesPanel';

/* I6 review fixes: the keyboard reaches functions, the index follows the repository,
   long lists are capped, and an untraced click stops a running flow. */

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
          children: [{ name: 'src', path: 'packages/alpha/src', type: 'dir', children: [file('packages/alpha/src/one.ts'), file('packages/alpha/src/two.ts')] }],
        },
      ],
    },
  ],
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function Probe() {
  const canvas = useCanvasOptional();
  const view = canvas?.canvas.view;
  return <p data-testid="probe">{view && view.state === 'S3' ? `S3:${view.playback.functionId}` : (view?.state ?? 'none')}</p>;
}

function setup(functions: () => Response) {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/tree') return json(TREE);
    if (url.pathname === '/api/git/status') return json({ branch: 'main', files: [] });
    if (url.pathname === '/api/functions') return functions();
    return json({ error: 'nf' }, 404);
  }) as unknown as typeof fetch;
  const graph = twoPackages();
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
  const load = (scannedAt: string) =>
    store.dispatch({ type: 'repo/loaded', draft: { root: '/repo', repoName: 'repo', graph, summary: summarizeGraph(graph), scannedAt }, at: 0 });
  load('one');
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <ConnectedFilesPanel fetchImpl={fetchImpl} />
        <Probe />
      </CanvasProvider>
    </StoreProvider>,
  );
  return { load };
}

const rowFor = async (path: string) =>
  await waitFor(() => {
    const el = screen.getAllByTestId(FILES.row).find((e) => e.getAttribute('data-path') === path);
    if (!el) throw new Error(`no row ${path}`);
    return el;
  });
const toggleOf = async (path: string) => await waitFor(() => within(screen.getAllByTestId(FILES.row).find((e) => e.getAttribute('data-path') === path)!).getByTestId('files-symbols-toggle'));
const tree = () => screen.getByTestId(FILES.tree);
const press = (key: string) => fireEvent.keyDown(tree(), { key });
const activeId = () => tree().getAttribute('aria-activedescendant');
const symbols = () => screen.queryAllByTestId('files-symbol');
const ONE = 'packages/alpha/src/one.ts';

async function onOne(functions: () => Response = () => json(twoPackageFunctions())) {
  const api = setup(functions);
  fireEvent.click(await rowFor('packages'));
  fireEvent.click(await rowFor('packages/alpha/src'));
  await toggleOf(ONE);
  fireEvent.click(await rowFor(ONE));
  return api;
}

afterEach(() => window.localStorage.clear());

describe('the keyboard reaches functions (press keys, not clicks)', () => {
  it('ArrowRight on a file opens its functions, again enters them, ArrowLeft returns and then closes', async () => {
    await onOne();
    expect(symbols()).toHaveLength(0);
    press('ArrowRight');
    expect(symbols()).toHaveLength(2);
    press('ArrowRight');
    expect(symbols()[0]!.id).toBeTruthy();
    expect(activeId()).toBe(symbols()[0]!.id);
    press('ArrowDown');
    expect(activeId()).toBe(symbols()[1]!.id);
    press('ArrowUp');
    press('ArrowLeft');
    expect(activeId()).toBe(`files-row-${ONE}`);
    press('ArrowLeft');
    expect(symbols()).toHaveLength(0);
  });

  it('ArrowDown past the last function lands on the next file; ArrowUp returns to the last function', async () => {
    await onOne();
    press('ArrowRight');
    press('ArrowRight');
    press('ArrowDown');
    press('ArrowDown');
    expect(activeId()).toBe('files-row-packages/alpha/src/two.ts');
    press('ArrowUp');
    expect(activeId()).toBe(symbols()[1]!.id);
  });

  it('Enter and Space on the selected function play it; an untraced one says Not traced', async () => {
    await onOne();
    press('ArrowRight');
    press('ArrowRight');
    press('Enter');
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('S3:fn:one'));
    press('ArrowDown');
    press(' ');
    await waitFor(() => expect(screen.getByTestId('files-symbol-untraced')).toBeTruthy());
  });
});

describe('the function index follows the repository', () => {
  it('a rescan that renames a function shows the new name (the index is read again)', async () => {
    let answers = 0;
    const renamed = twoPackageFunctions();
    renamed.functionGraph.nodes[0] = { ...renamed.functionGraph.nodes[0]!, name: 'openGateV2' };
    const { load } = setup(() => {
      answers += 1;
      return json(answers === 1 ? twoPackageFunctions() : renamed);
    });
    fireEvent.click(await rowFor('packages'));
    fireEvent.click(await rowFor('packages/alpha/src'));
    fireEvent.click(await toggleOf(ONE));
    expect(symbols()[0]!.textContent).toContain('openGate');
    expect(symbols()[0]!.textContent).not.toContain('V2');
    load('two');
    await waitFor(() => expect(symbols()[0]!.textContent).toContain('openGateV2'));
    expect(answers).toBe(2);
  });

  it('a malformed 200 from /api/functions is ignored: no function rows, no unhandled rejection', async () => {
    const seen: unknown[] = [];
    const on = (e: unknown) => seen.push(e);
    process.on('unhandledRejection', on);
    setup(() => json({ functionGraph: null }));
    await rowFor('packages');
    await new Promise((r) => setTimeout(r, 50));
    process.off('unhandledRejection', on);
    expect(seen).toEqual([]);
    expect(screen.queryByTestId('files-symbols-toggle')).toBeNull();
  });
});

describe('long lists and untraced clicks', () => {
  it('caps a file at 200 rows with an "N more" row that expands', async () => {
    const big = twoPackageFunctions();
    const base = big.functionGraph.nodes[0]!;
    big.functionGraph.nodes.push(...Array.from({ length: 250 }, (_, i) => ({ ...base, id: `fn:many${i}`, name: `many${i}`, startLine: 100 + i })));
    setup(() => json(big));
    fireEvent.click(await rowFor('packages'));
    fireEvent.click(await rowFor('packages/alpha/src'));
    fireEvent.click(await toggleOf(ONE));
    expect(symbols()).toHaveLength(200);
    const more = screen.getByTestId('files-symbols-more');
    expect(more.textContent).toBe('+52 more');
    fireEvent.click(more);
    expect(symbols()).toHaveLength(252);
  });

  it('clicking an untraced function while a flow plays clears the running flow and says Not traced', async () => {
    await onOne();
    fireEvent.click(await toggleOf(ONE));
    fireEvent.click(symbols().find((r) => r.getAttribute('data-function-id') === 'fn:one')!);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toMatch(/^S3/));
    fireEvent.click(symbols().find((r) => r.getAttribute('data-function-id') === 'fn:two')!);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).not.toMatch(/^S3/));
    expect(screen.getByTestId('files-symbol-untraced').textContent).toBe('Not traced');
  });
});
