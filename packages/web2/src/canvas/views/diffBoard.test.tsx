import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArchGraph } from '@sequence/schema';

import { StoreProvider, createStore } from '../../state';
import { readShellPersisted, readShellTokens } from '../../shell';
import { seqdFromGraph } from '../index';

import { DiffView, diffHeadline } from './DiffView';
import type { ViewBox } from './viewModel';

/* ══════════════════════════════════════════════════════════════════════════
   E3/E4 — THE DIFF BOARD YOU CAN KEEP TRACK OF
   Jaden: "the diffs are hard to keep track of at times ... easier to navigate
   to the diff page ... I like that against main metric ... the coloring ...
   the icon centering in the buttons".
   ══════════════════════════════════════════════════════════════════════════ */

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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const FILES = [
  { path: 'orders/a.ts', status: 'modified' },
  { path: 'orders/b.ts', status: 'added' },
  { path: 'payments/c.ts', status: 'deleted' },
];

function api(opts: { changes?: boolean } = {}) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/git/branch-files')) return json({ files: FILES });
    if (url.startsWith('/api/git/branch-changes')) {
      if (opts.changes === false) return json({ error: 'nf' }, 404);
      return json({
        branch: 'f',
        base: 'main',
        mergeBase: 'm',
        head: 'h',
        files: [
          { path: 'orders/a.ts', status: 'M', added: 300, removed: 20 },
          { path: 'orders/b.ts', status: 'A', added: 40, removed: 0 },
          { path: 'payments/c.ts', status: 'D', added: 0, removed: 100 },
        ],
      });
    }
    return json({ error: 'unexpected' }, 404);
  });
}

function mount(f: ReturnType<typeof api>) {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  return render(
    <StoreProvider store={store}>
      <DiffView boxes={boxes} lines={[]} graph={graph} fetchImpl={f as never} />
    </StoreProvider>,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('the against-main metric, written plainly', () => {
  it('diffHeadline says files changed against the base with +added −removed', () => {
    expect(diffHeadline(12, 'main', { added: 340, removed: 120 })).toBe('12 files changed against main, +340 −120');
    expect(diffHeadline(1, 'main', null)).toBe('1 file changed against main');
    expect(diffHeadline(0, 'main', null)).toBe('No files changed against main');
  });

  it('shows it from the branch-changes counts, and from the file list alone when that route is absent', async () => {
    mount(api());
    expect((await screen.findByTestId('diff-headline')).textContent).toBe('3 files changed against main, +340 −120');
    document.body.innerHTML = '';
    mount(api({ changes: false }));
    expect((await screen.findByTestId('diff-headline')).textContent).toBe('3 files changed against main');
  });

  it('puts +N −N beside each file when the counts are known', async () => {
    mount(api());
    await screen.findByTestId('diff-headline');
    const row = (await screen.findAllByTestId('diff-file')).find((r) => r.getAttribute('data-path') === 'orders/a.ts')!;
    await waitFor(() => expect(within(row).getByTestId('diff-file-counts').textContent).toBe('+300 −20'));
  });
});

describe('keeping track: its own scroll, a current file, a jump list', () => {
  it('the changes scroll in their own region and the header stays', async () => {
    mount(api());
    await screen.findByTestId('diff-headline');
    const scroll = screen.getByTestId('diff-scroll');
    expect(scroll.contains(screen.getAllByTestId('diff-box')[0]!)).toBe(true);
    expect(scroll.contains(screen.getByTestId('diff-headline'))).toBe(false);
    const css = readFileSync(resolve(__dirname, 'views.css'), 'utf8');
    const at = css.indexOf('.diffview .dv-scroll {');
    expect(css.slice(at, css.indexOf('}', at))).toContain('overflow-y: auto');
    const hd = css.indexOf('.diffview .dv-row-hd {');
    expect(css.slice(hd, css.indexOf('}', hd))).toContain('position: sticky');
  });

  it('j/k and ]/[ move through every changed file in order, and stop at the ends', async () => {
    mount(api());
    await screen.findByTestId('diff-headline');
    const current = () => screen.getAllByTestId('diff-file').filter((r) => r.getAttribute('data-current') === 'true').map((r) => r.getAttribute('data-path'));
    expect(current()).toEqual([]);
    fireEvent.keyDown(window, { key: 'j' });
    expect(current()).toEqual(['orders/a.ts']);
    fireEvent.keyDown(window, { key: ']' });
    expect(current()).toEqual(['orders/b.ts']);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'j' });
    expect(current()).toEqual(['payments/c.ts']);
    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: '[' });
    expect(current()).toEqual(['orders/a.ts']);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('ignores the keys while typing in a field', async () => {
    mount(api());
    await screen.findByTestId('diff-headline');
    fireEvent.keyDown(screen.getByTestId('diff-base'), { key: 'j' });
    expect(screen.getAllByTestId('diff-file').some((r) => r.getAttribute('data-current') === 'true')).toBe(false);
  });

  it('a jump list names every file and choosing one makes it current', async () => {
    mount(api());
    await screen.findByTestId('diff-headline');
    const jump = screen.getByTestId('diff-jump') as HTMLSelectElement;
    expect([...jump.options].map((o) => o.value).filter(Boolean)).toEqual(['orders/a.ts', 'orders/b.ts', 'payments/c.ts']);
    fireEvent.change(jump, { target: { value: 'payments/c.ts' } });
    const row = screen.getAllByTestId('diff-file').find((r) => r.getAttribute('data-path') === 'payments/c.ts')!;
    expect(row.getAttribute('data-current')).toBe('true');
  });
});

describe('colour and icon centring', () => {
  const css = readFileSync(resolve(__dirname, 'views.css'), 'utf8');

  it('added and removed take the diff tokens, not hand-picked hues', () => {
    expect(css).toMatch(/\.board-view \.is-added \.dv-glyph[^}]*var\(--diff-add-gutter\)/);
    expect(css).toMatch(/\.board-view \.is-removed \.dv-glyph[^}]*var\(--diff-del-gutter\)/);
    expect(css).toMatch(/\.diffview \.dv-cadd[^}]*var\(--diff-add-gutter\)/);
    expect(css).toMatch(/\.diffview \.dv-cdel[^}]*var\(--diff-del-gutter\)/);
  });

  it('the status chip centres its glyph by grid (the pattern e2e/icons-centred.mjs measures)', () => {
    const at = css.indexOf('.board-view .dv-ic {');
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('display: inline-grid');
    expect(rule).toContain('place-items: center');
  });

  it('the grid view draws its cell lines with the readable edge token', () => {
    const at = css.indexOf('.gridview .gv-cell {');
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('var(--edge)');
    expect(rule).not.toContain('var(--edge-faint)');
  });
});

describe('reaching the Diff board', () => {
  it('requestDiffBoard sets the board hash to the diff view and asks the host to open the surface', async () => {
    const { requestDiffBoard } = await import('../../git/openDiff');
    const { setHostCommandHandler } = await import('../../app/hostCommands');
    const seen = vi.fn();
    setHostCommandHandler(seen);
    requestDiffBoard();
    expect(window.location.hash.startsWith('#diff')).toBe(true);
    expect(seen).toHaveBeenCalledWith('canvas.board');
    setHostCommandHandler(null);
    window.location.hash = '';
  });

  it('the branch switcher sits in the Diff header', async () => {
    const f = vi.fn(async (url: string) => {
      if (url === '/api/git/branches')
        return json({ current: 'f', detached: false, sha: 'abc', dirty: false, branches: [{ name: 'f', ahead: 0, behind: 0, lastCommit: null }], remoteBranches: [] });
      return api()(url);
    });
    mount(f as never);
    expect(await screen.findByTestId('branch-switcher-trigger')).toBeTruthy();
  });
});

describe('keeping the navigation honest at scale', () => {
  it('j on a hidden file shows that one file, not the whole box, and the rest stay behind the count', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ path: `orders/f${String(i).padStart(2, '0')}.ts`, status: 'modified' }));
    const f = vi.fn(async (url: string) => (url.startsWith('/api/git/branch-files') ? json({ files: many }) : json({ error: 'nf' }, 404)));
    mount(f as never);
    await screen.findByTestId('diff-headline');
    const rows = () => screen.getAllByTestId('diff-file').length;
    expect(rows()).toBe(8);
    for (let i = 0; i < 12; i += 1) fireEvent.keyDown(window, { key: 'j' });
    expect(rows()).toBe(9);
    expect(screen.getAllByTestId('diff-file').find((r) => r.getAttribute('data-current') === 'true')?.getAttribute('data-path')).toBe('orders/f11.ts');
    expect(screen.getByTestId('diff-more-files').textContent).toBe('21 more files');
  });

  it('files that sit in no box are not in the jump list and j skips them', async () => {
    const f = vi.fn(async (url: string) =>
      url.startsWith('/api/git/branch-files')
        ? json({ files: [{ path: 'orders/a.ts', status: 'modified' }, { path: 'README.md', status: 'modified' }] })
        : json({ error: 'nf' }, 404),
    );
    mount(f as never);
    await screen.findByTestId('diff-elsewhere');
    const jump = screen.getByTestId('diff-jump') as HTMLSelectElement;
    expect([...jump.options].map((o) => o.value).filter(Boolean)).toEqual(['orders/a.ts']);
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'j' });
    expect(screen.getAllByTestId('diff-file').find((r) => r.getAttribute('data-current') === 'true')?.getAttribute('data-path')).toBe('orders/a.ts');
  });
});
