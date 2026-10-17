import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GetArchGraphResponse, TreeNode } from '@sequence/api-types';

import '../tokens/graphite.css';
import './files.css';

import { summarizeGraph } from '../boot';
import { CanvasProvider, DocProvider, seqdFromGraph } from '../canvas';
import { loadRealRepoScan } from '../rail/realRepoScan.testSupport';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore, type Store } from '../state';

import { FILES } from './anchors';
import { ConnectedFilesPanel } from './ConnectedFilesPanel';
import { FileTree } from './FileTree';
import { buildFileTree } from './filesModel';
import { GroupUiContext, type GroupUi } from './groupUi';
import { groupByService } from './serviceGroups';

/* ═══════════════════════════════════════════════════════════════════════════
   GROUP BY SERVICE AND REVEAL, AT THE SCALE OF THE REAL REPOSITORY
   packages/web2/src/files/serviceGroupsRealScale.test.tsx

   The owner-seat review of the Index-rail-into-Files work ran the view on this
   repo (ten services, one of them 900+ files) and found what a fixture of three
   files cannot show: only 2 of 10 services reachable under the 300-row cap,
   group heads that do not fold, a board-card reveal that did nothing in the
   grouped view and opened an arbitrary subfolder in the tree, sibling rows that
   read the same once the middle of their paths was ellipsized, and a match count
   of 1 beside 43 listed files.

   So the fixture IS this repository: the scanner's own graph (loadRealRepoScan,
   the same deterministic key-free scan the other real-repo suites use) and the
   tracked file list from git for the tree. Every case reads what a reader sees
   (the rendered label text, never the title attribute).

   The canvas and the text measure are stubbed at file level, BEFORE the first
   render, because FitName caches its measuring context: a row 120 px wide whose
   text is 7 px a character is what makes a long path elide in the middle here
   the way it does in the browser.
   ═══════════════════════════════════════════════════════════════════════════ */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const { graph: GRAPH } = await loadRealRepoScan(REPO);
const TRACKED = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 })
  .toString('utf8')
  .split('\0')
  .filter((p) => p !== '' && !p.startsWith('tmp-shots/'));
const GROUPS = groupByService(GRAPH);
const CAP = 300;

function treeOf(paths: readonly string[]): TreeNode {
  const root: TreeNode = { path: '', name: '', type: 'dir', children: [] };
  const dirs = new Map<string, TreeNode>([['', root]]);
  const ensure = (dirPath: string): TreeNode => {
    const have = dirs.get(dirPath);
    if (have) return have;
    const slash = dirPath.lastIndexOf('/');
    const parent = ensure(slash < 0 ? '' : dirPath.slice(0, slash));
    const node: TreeNode = { path: dirPath, name: dirPath.slice(slash + 1), type: 'dir', children: [] };
    parent.children!.push(node);
    dirs.set(dirPath, node);
    return node;
  };
  for (const p of paths) {
    const slash = p.lastIndexOf('/');
    ensure(slash < 0 ? '' : p.slice(0, slash)).children!.push({ path: p, name: p.slice(slash + 1), type: 'file' });
  }
  return root;
}
const TREE = treeOf(TRACKED);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const wire = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname === '/api/tree') return json(TREE);
  if (url.pathname === '/api/git/status') return json({ branch: 'main', files: [] });
  return json({ error: 'nf' }, 404);
}) as unknown as typeof fetch;

function mount(): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: { root: REPO, repoName: 'repo', graph: GRAPH as GetArchGraphResponse, summary: summarizeGraph(GRAPH), scannedAt: 'x' },
    at: 0,
  });
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <ConnectedFilesPanel fetchImpl={wire} />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return store;
}

/** The room a row's label gets, in px (7 px a character): 120 forces elision; the all-open case uses a real tree width. */
let roomPx = 120;
const scrolled: { el: Element; arg: unknown }[] = [];
const originals: { ctx: unknown; cw: PropertyDescriptor | undefined } = { ctx: undefined, cw: undefined };
beforeAll(() => {
  originals.ctx = HTMLCanvasElement.prototype.getContext;
  originals.cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = () => ({
    font: '',
    measureText: (s: string) => ({ width: s.length * 7 }),
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => roomPx });
});
afterAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = originals.ctx;
  if (originals.cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originals.cw);
  else delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
});
beforeEach(() => {
  roomPx = 120;
  scrolled.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element, arg?: unknown) {
    scrolled.push({ el: this, arg });
  };
});
afterEach(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  window.localStorage.clear();
});

const heads = () => screen.queryAllByTestId('files-group-head');
const headFor = (id: string) => heads().find((h) => h.getAttribute('data-group-id') === id);
const rows = () => screen.queryAllByTestId(FILES.row);
const rowNow = (path: string) => rows().find((e) => e.getAttribute('data-path') === path);
async function groupView() {
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  fireEvent.click(screen.getByTestId('files-group-toggle'));
  await waitFor(() => expect(heads().length).toBeGreaterThan(0));
}
/** The disclosure button of a group head. */
const foldOf = (id: string) => within(headFor(id)!).getByRole('button');
/** The file rows listed under one group head, in order. */
function rowsUnder(id: string): HTMLElement[] {
  const tree = screen.getAllByTestId(FILES.tree)[0]!;
  const out: HTMLElement[] = [];
  let inside = false;
  for (const el of Array.from(tree.querySelectorAll<HTMLElement>('[data-testid="files-group-head"], [data-testid="files-row"]'))) {
    if (el.getAttribute('data-testid') === 'files-group-head') inside = el.getAttribute('data-group-id') === id;
    else if (inside) out.push(el);
  }
  return out;
}
const analyzer = () => GROUPS.find((g) => g.label === 'analyzer')!;
const tracked = new Set(TRACKED);
const sizeOf = (paths: readonly string[]) => paths.filter((p) => tracked.has(p)).length;

describe('the real-scale fixture is what the review saw', () => {
  it('has ten services and one group far past the row cap', () => {
    expect(GROUPS.length).toBeGreaterThanOrEqual(10);
    expect(sizeOf(analyzer().paths)).toBeGreaterThan(CAP * 2);
    expect(TRACKED.length).toBeGreaterThan(1000);
  });
});

describe('(3) every service is reachable, and a group folds', () => {
  it('lists a head for every service with its own file count, whatever the row cap', async () => {
    mount();
    await groupView();
    for (const g of GROUPS) {
      const head = headFor(g.id);
      expect(head, `no head for ${g.label}`).toBeTruthy();
      expect(head!.querySelector('.files-group-count')!.textContent).toBe(String(sizeOf(g.paths)));
    }
  });

  it('opens collapsed when the files would not fit the cap, expands on click and folds again', async () => {
    mount();
    await groupView();
    const id = analyzer().id;
    expect(foldOf(id).tagName).toBe('BUTTON');
    expect(foldOf(id).getAttribute('aria-expanded')).toBe('false');
    expect(rowsUnder(id)).toHaveLength(0);
    fireEvent.click(foldOf(id));
    await waitFor(() => expect(rowsUnder(id).length).toBeGreaterThan(0));
    expect(foldOf(id).getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(foldOf(id));
    await waitFor(() => expect(rowsUnder(id)).toHaveLength(0));
  });

  it('a fold key does not select a file or move the tree selection', async () => {
    mount();
    await groupView();
    const id = analyzer().id;
    foldOf(id).focus();
    fireEvent.keyDown(foldOf(id), { key: 'Enter' });
    expect(rows().some((r) => r.getAttribute('data-selected') === 'true')).toBe(false);
  });

  it('caps each expanded group on its own, with a "+N more in <service>" row that lists the rest on click', async () => {
    mount();
    await groupView();
    const id = analyzer().id;
    const total = sizeOf(analyzer().paths);
    fireEvent.click(foldOf(id));
    await waitFor(() => expect(rowsUnder(id)).toHaveLength(CAP));
    const more = await screen.findByTestId('files-group-more');
    expect(more.textContent).toContain(`+${total - CAP} more in analyzer`);
    /* Another group opened beside it has its OWN cap, not what is left of a shared one. */
    const other = GROUPS.find((g) => g.label === 'web2')!;
    fireEvent.click(foldOf(other.id));
    await waitFor(() => expect(rowsUnder(other.id)).toHaveLength(Math.min(CAP, sizeOf(other.paths))));
    expect(rowsUnder(id)).toHaveLength(CAP);
    fireEvent.click(more);
    await waitFor(() => expect(rowsUnder(id)).toHaveLength(total));
  });
});

describe('(4) a board card click reveals in both views', () => {
  it('group view: the card’s service is opened and its head scrolled to', async () => {
    const store = mount();
    await groupView();
    const web2 = GROUPS.find((g) => g.label === 'web2')!;
    expect(foldOf(web2.id).getAttribute('aria-expanded')).toBe('false');
    act(() => {
      store.dispatch({ type: 'rail/reveal', path: 'packages/web2' as never });
    });
    await waitFor(() => expect(foldOf(web2.id).getAttribute('aria-expanded')).toBe('true'));
    await waitFor(() => expect(scrolled.some((s) => s.el === headFor(web2.id))).toBe(true));
    expect(headFor(web2.id)!.className).toContain('is-on');
    expect(rowsUnder(web2.id).length).toBeGreaterThan(0);
    expect(store.getState().rail.selectedPath).toBeNull();
  });

  it('group view: a file past the cap of its group is listed, selected and scrolled to', async () => {
    const store = mount();
    await groupView();
    const g = analyzer();
    const deep = g.paths.filter((p) => tracked.has(p))[CAP + 40]!;
    act(() => {
      store.dispatch({ type: 'rail/reveal', path: deep as never });
    });
    await waitFor(() => expect(rowNow(deep)?.getAttribute('data-selected')).toBe('true'));
    await waitFor(() => expect(scrolled.some((s) => s.el === rowNow(deep))).toBe(true));
  });

  it('tree view: highlights the folder, scrolls it to the centre and opens no other subfolder', async () => {
    const store = mount();
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    act(() => {
      store.dispatch({ type: 'rail/reveal', path: 'packages/web2' as never });
    });
    const row = await waitFor(() => {
      const r = rowNow('packages/web2');
      if (!r) throw new Error('no row');
      return r;
    });
    await waitFor(() => expect(row.className).toContain('is-on'));
    await waitFor(() =>
      expect(scrolled.some((s) => s.el === row && (s.arg as { block?: string } | undefined)?.block === 'center')).toBe(true),
    );
    /* The folder itself is open; nothing UNDER it was opened on a guess. */
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const below = rows().filter((r) => r.getAttribute('data-kind') === 'dir' && r.getAttribute('data-path')!.startsWith('packages/web2/'));
    expect(below.length).toBeGreaterThan(0);
    expect(below.filter((r) => r.getAttribute('aria-expanded') === 'true')).toEqual([]);
  });
});

describe('(5) a group’s rows read differently, and the match count counts files', () => {
  it('keeps every file name whole and no two sibling rows read the same', async () => {
    mount();
    await groupView();
    const checked: string[] = [];
    for (const g of GROUPS) {
      fireEvent.click(foldOf(g.id));
      await waitFor(() => expect(rowsUnder(g.id).length).toBeGreaterThan(0));
      const listed = rowsUnder(g.id);
      const texts = listed.map((r) => r.querySelector('.files-name')!.textContent!);
      for (const r of listed) {
        const base = r.getAttribute('data-path')!.split('/').pop()!;
        const name = r.querySelector('[data-testid="files-row-name"]')!.textContent!;
        /* 120 px at 7 px a character: a name that fits is shown whole, never cut to make room for its folder.
           One that cannot fit even alone keeps its start and its extension. */
        /* (A name another row of the group also has gives up room to its folder: that is what tells the two apart.) */
        const twin = g.paths.filter((p) => tracked.has(p) && p.split('/').pop() === base).length > 1;
        if (twin) continue;
        if (base.length * 7 <= 120) expect(name, r.getAttribute('data-path')!).toBe(base);
        else {
          expect(name.startsWith(base.slice(0, 2)), name).toBe(true);
          expect(name.endsWith(base.slice(base.lastIndexOf('.'))), name).toBe(true);
        }
      }
      const dup = texts.filter((t, i) => texts.indexOf(t) !== i);
      expect(dup, `${g.label}: rows that read the same`).toEqual([]);
      checked.push(g.label);
    }
    expect(checked.length).toBeGreaterThanOrEqual(10);
  });

  it('with every group open and every "+N more" expanded, no two rows of a group read the same', () => {
    /* One render with every group open and every cap lifted (4,000+ rows): the lists are what the reviewer read.
       A row's label gets 260 px (about 37 characters): the room the Files rail gives it on a 1440 px window. */
    roomPx = 260;
    const ui: GroupUi = {
      on: true,
      onToggle: () => {},
      groups: GROUPS,
      unread: null,
      open: new Map([...GROUPS.map((g) => [g.id, true] as const), ['ungrouped', true]]),
      showAll: new Set([...GROUPS.map((g) => g.id), 'ungrouped']),
      onToggleGroup: () => {},
      onShowAll: () => {},
      revealed: null,
    };
    render(
      <GroupUiContext.Provider value={ui}>
        <FileTree nodes={buildFileTree(TRACKED)} expanded="all" selected={null} onSelect={() => {}} onToggle={() => {}} onOpen={() => {}} />
      </GroupUiContext.Provider>,
    );
    expect(screen.queryAllByTestId('files-group-more')).toHaveLength(0);
    const ids = heads().map((h) => h.getAttribute('data-group-id')!);
    expect(ids.length).toBeGreaterThanOrEqual(10);
    let rowCount = 0;
    let sameName = 0;
    const shared: string[] = [];
    for (const id of ids) {
      const listed = rowsUnder(id);
      rowCount += listed.length;
      const by = new Map<string, string[]>();
      const bases = new Set<string>();
      for (const r of listed) {
        const text = r.querySelector('.files-name')!.textContent!;
        by.set(text, [...(by.get(text) ?? []), r.getAttribute('data-path')!]);
        const base = r.getAttribute('data-path')!.split('/').pop()!;
        if (bases.has(base)) sameName += 1;
        bases.add(base);
      }
      for (const [text, paths] of by) if (paths.length > 1) shared.push(`${id}: "${text}" <- ${paths.join(' , ')}`);
    }
    /* Positive controls: the specimen is the real scale and really holds same-named files in one group. */
    expect(rowCount).toBeGreaterThan(1000);
    expect(sameName, 'same-named files in one group exist in this repo').toBeGreaterThan(10);
    expect(shared, shared.slice(0, 10).join(String.fromCharCode(10))).toEqual([]);
  });

  it('the filter header counts the files it lists, in the grouped view', async () => {
    mount();
    await groupView();
    fireEvent.change(screen.getByTestId(FILES.filter), { target: { value: 'web2/src/files' } });
    await waitFor(() => expect(heads().length).toBeGreaterThan(0));
    const listed = heads().flatMap((h) => rowsUnder(h.getAttribute('data-group-id')!));
    expect(listed.length).toBeGreaterThan(20);
    const text = screen.getByTestId(FILES.matches).textContent!;
    expect(text).toBe(`${listed.length} matches`);
  });
});

/* Thousands of rows with a layout effect each: jsdom spends tens of seconds on getComputedStyle alone, more under a loaded suite. */
vi.setConfig({ testTimeout: 240000 });
