import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GetArchGraphResponse, TreeNode } from '@sequence/api-types';

import '../tokens/graphite.css';
import './files.css';

import { summarizeGraph } from '../boot';
import { CanvasProvider, ConnectedBoard, DocProvider, seqdFromGraph } from '../canvas';
import { twoPackageFunctions, twoPackages } from '../rail/fixtures';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore, type Store } from '../state';

import { FILES } from './anchors';
import { ConnectedFilesPanel } from './ConnectedFilesPanel';

/* ═══════════════════════════════════════════════════════════════════════════
   THE FOUR PIECES THE RETIRED INDEX RAIL LEFT TO FILES
   packages/web2/src/files/filesRailPieces.test.tsx

   Owner ruling, docs/plans/0.1.9/HANDOFF.md, 2026-10-14: the rail is deleted and
   Files gains (1) the function count on each file row, (2) the "N source files
   outside every service were not read" disclosure, (3) reveal-in-Files when a
   board card is clicked, (4) an optional group-by-service view.

   Every case reads the DOM a reader sees. Each piece has a negative control: the
   count is absent (never "0") with no function index, the disclosure is absent
   when the scan has nothing to disclose, the reveal waits on a path the repo
   does not hold, and the grouped view is off until asked.
   ═══════════════════════════════════════════════════════════════════════════ */

const file = (p: string): TreeNode => ({ path: p, name: p.split('/').pop()!, type: 'file' });
const dir = (p: string, children: TreeNode[]): TreeNode => ({ path: p, name: p.split('/').pop()!, type: 'dir', children });
const TREE: TreeNode = dir('', [
  dir('packages', [
    dir('packages/alpha', [
      dir('packages/alpha/src', [
        file('packages/alpha/src/one.ts'),
        file('packages/alpha/src/two.ts'),
        file('packages/alpha/src/plain.md'),
      ]),
    ]),
    dir('packages/beta', [dir('packages/beta/src', [file('packages/beta/src/gate.ts')])]),
  ]),
  file('README.md'),
]);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function storeFor(graph: GetArchGraphResponse): Store {
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
  return store;
}

function wire(functions: boolean): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/tree') return json(TREE);
    if (url.pathname === '/api/git/status') return json({ branch: 'main', files: [] });
    if (url.pathname === '/api/functions') return functions ? json(twoPackageFunctions()) : json({ error: 'nf' }, 404);
    return json({ error: 'nf' }, 404);
  }) as unknown as typeof fetch;
}

function Providers({ store, children }: { store: Store; children: ReactNode }) {
  return (
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>{children}</DocProvider>
      </CanvasProvider>
    </StoreProvider>
  );
}

function mount(opts: { functions?: boolean; graph?: GetArchGraphResponse; board?: boolean } = {}) {
  const store = storeFor(opts.graph ?? twoPackages());
  render(
    <Providers store={store}>
      {opts.board ? <ConnectedBoard /> : null}
      <ConnectedFilesPanel fetchImpl={wire(opts.functions ?? true)} />
    </Providers>,
  );
  return store;
}

const rowFor = async (path: string) =>
  await waitFor(() => {
    const el = screen.getAllByTestId(FILES.row).find((e) => e.getAttribute('data-path') === path);
    if (!el) throw new Error(`no row ${path}`);
    return el;
  });
const rowNow = (path: string) =>
  screen.queryAllByTestId(FILES.row).find((e) => e.getAttribute('data-path') === path);

async function openAlphaSrc() {
  fireEvent.click(await rowFor('packages'));
  fireEvent.click(await rowFor('packages/alpha/src'));
  await rowFor('packages/alpha/src/one.ts');
}

const scrolled: Element[] = [];
beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this);
  };
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  window.localStorage.clear();
});

describe('(1) the function count on each file row', () => {
  it('prints the scan’s own count beside every file that has functions, and nothing beside one that has none', async () => {
    mount({ functions: true });
    await openAlphaSrc();
    /* twoPackageFunctions: one.ts holds openGate and helper, two.ts holds store, plain.md holds nothing. */
    await waitFor(() => expect(within((rowNow('packages/alpha/src/one.ts'))!).getByTestId('files-fncount').textContent).toBe('2'));
    expect(within(rowNow('packages/alpha/src/two.ts')!).getByTestId('files-fncount').textContent).toBe('1');
    expect(within(rowNow('packages/alpha/src/plain.md')!).queryByTestId('files-fncount')).toBeNull();
  });

  it('prints no count at all, and never a 0, when the function index was not served', async () => {
    mount({ functions: false });
    await openAlphaSrc();
    expect(screen.queryByTestId('files-fncount')).toBeNull();
    expect(rowNow('packages/alpha/src/one.ts')!.textContent).not.toMatch(/\d/);
  });
});

describe('(2) the “not read” disclosure', () => {
  const withUnscanned = (regions: { dir: string; files: number; extensions: string[] }[]) =>
    ({ ...twoPackages(), unscanned: regions }) as GetArchGraphResponse;

  it('says how many source files sit outside every service, from the scan, naming the biggest regions', async () => {
    mount({
      graph: withUnscanned([
        { dir: 'tools', files: 350, extensions: ['.js'] },
        { dir: 'site', files: 78, extensions: ['.ts'] },
        { dir: 'lab', files: 16, extensions: ['.py'] },
      ]),
    });
    await rowFor('packages');
    expect((await screen.findByTestId('files-unscanned')).textContent).toBe(
      '444 source files outside every service were not read — tools (350), site (78), +1 more.',
    );
  });

  it('is singular for one file, and absent when the scan reports nothing unread', async () => {
    mount({ graph: withUnscanned([{ dir: 'tools', files: 1, extensions: ['.js'] }]) });
    await rowFor('packages');
    expect((await screen.findByTestId('files-unscanned')).textContent).toBe(
      '1 source file outside every service was not read — tools (1).',
    );
  });

  it('draws nothing when the graph carries no unscanned field or an empty one', async () => {
    mount({ graph: withUnscanned([]) });
    await rowFor('packages');
    expect(screen.queryByTestId('files-unscanned')).toBeNull();
  });
});

describe('(3) a board card click reveals its file in Files', () => {
  it('selects the file, opens the folders above it and scrolls it into view', async () => {
    const store = mount();
    await rowFor('packages');
    expect(rowNow('packages/alpha/src/two.ts')).toBeUndefined(); /* collapsed: the control */
    act(() => {
      store.dispatch({ type: 'rail/reveal', path: 'packages/alpha/src/two.ts' as never });
    });
    const target = await rowFor('packages/alpha/src/two.ts');
    await waitFor(() => expect(target.getAttribute('data-selected')).toBe('true'));
    await waitFor(() => expect(scrolled).toContain(target));
    /* The request is consumed, so asking again after moving away works. */
    expect(store.getState().rail.selectedPath).toBeNull();
    fireEvent.click(await rowFor('packages/alpha/src/one.ts'));
    await waitFor(() => expect(rowNow('packages/alpha/src/two.ts')!.getAttribute('data-selected')).toBe('false'));
    act(() => {
      store.dispatch({ type: 'rail/reveal', path: 'packages/alpha/src/two.ts' as never });
    });
    await waitFor(() => expect(rowNow('packages/alpha/src/two.ts')!.getAttribute('data-selected')).toBe('true'));
  });

  it('takes the engine’s native separators', async () => {
    const store = mount();
    await rowFor('packages');
    act(() => {
      store.dispatch({ type: 'rail/reveal', path: 'packages\\beta\\src\\gate.ts' as never });
    });
    await waitFor(() => expect(rowNow('packages/beta/src/gate.ts')?.getAttribute('data-selected')).toBe('true'));
  });

  it('selects nothing for a path the repository does not hold', async () => {
    const store = mount();
    await rowFor('packages');
    act(() => {
      store.dispatch({ type: 'rail/reveal', path: 'packages/gamma/nothing.ts' as never });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryAllByTestId(FILES.row).some((r) => r.getAttribute('data-selected') === 'true')).toBe(false);
  });

  it('a real click on a board card opens its folder in Files and brings it into view', async () => {
    mount({ board: true });
    await rowFor('packages');
    expect(rowNow('packages/alpha/src')).toBeUndefined();
    const card = await waitFor(() => {
      const el = screen.getAllByTestId('board-node').find((n) => n.getAttribute('data-node-id') === 'svc:alpha');
      if (!el) throw new Error('no alpha card');
      return el;
    });
    fireEvent.click(card);
    await rowFor('packages/alpha/src');
    await waitFor(() => expect(scrolled.some((el) => el.getAttribute('data-path') === 'packages/alpha/src')).toBe(true));
  });
});

describe('(4) group by service', () => {
  it('is off until asked, then lists each service’s files under its name, and the rest under “Outside every service”', async () => {
    mount();
    await rowFor('packages');
    expect(screen.queryByTestId('files-group-head')).toBeNull();
    const toggle = screen.getByTestId('files-group-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    /* The off state is drawn too: Folders is the lit half until Services is chosen. */
    const folders = screen.getByTestId('files-group-folders');
    expect(folders.getAttribute('aria-pressed')).toBe('true');
    expect(folders.classList.contains('is-on')).toBe(true);
    expect(toggle.classList.contains('is-on')).toBe(false);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.classList.contains('is-on')).toBe(true);
    expect(folders.classList.contains('is-on')).toBe(false);

    const heads = await waitFor(() => {
      const h = screen.getAllByTestId('files-group-head');
      expect(h.length).toBe(3);
      return h;
    });
    expect(heads.map((h) => h.querySelector('.files-group-name')!.textContent)).toEqual(['alpha', 'beta', 'Outside every service']);
    expect(heads.map((h) => h.querySelector('.files-group-count')!.textContent)).toEqual(['2', '1', '2']);

    /* The rows sit under their header, in order: alpha's two files, beta's one, then what no service claimed. */
    const order = screen
      .getAllByTestId(FILES.tree)[0]
      .querySelectorAll('[data-testid="files-group-head"], [data-testid="files-row"]');
    const seq = Array.from(order).map((el) => el.getAttribute('data-group-id') ?? el.getAttribute('data-path'));
    expect(seq.slice(0, 7)).toEqual([
      'svc:alpha',
      'packages/alpha/src/one.ts',
      'packages/alpha/src/two.ts',
      'svc:beta',
      'packages/beta/src/gate.ts',
      'ungrouped',
      expect.any(String),
    ]);
    /* Labels drop the directory a group's files all share. */
    expect(within(rowNow('packages/alpha/src/one.ts')!).getByText('one.ts')).toBeTruthy();

    /* Off again: the repository's own layout is back. */
    fireEvent.click(folders);
    await waitFor(() => expect(screen.queryByTestId('files-group-head')).toBeNull());
    expect(rowNow('packages')).toBeTruthy();
  });

  it('draws no toggle when the scan names no service with files', async () => {
    const graph = { ...twoPackages(), nodes: twoPackages().nodes.filter((n) => n.kind !== 'file') } as GetArchGraphResponse;
    mount({ graph });
    await rowFor('packages');
    expect(screen.queryByTestId('files-group-toggle')).toBeNull();
  });

  it('keeps the filter: only the matching files are grouped', async () => {
    mount();
    await rowFor('packages');
    fireEvent.click(screen.getByTestId('files-group-toggle'));
    fireEvent.change(screen.getByTestId(FILES.filter), { target: { value: 'gate' } });
    await waitFor(() => expect(screen.getAllByTestId('files-group-head').length).toBe(1));
    expect(screen.getByTestId('files-group-head').getAttribute('data-group-id')).toBe('svc:beta');
    expect(rowNow('packages/alpha/src/one.ts')).toBeUndefined();
  });
});

vi.setConfig({ testTimeout: 15000 });
