import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ArchGraph } from '@sequence/schema';

import { DiffView } from './DiffView';
import { REMOVED_PREFIX, boxOfPath, diffMarks, diffModel, heatModel, removedModules } from './historyModel';
import { HotspotsView } from './HotspotsView';
import type { ViewBox } from './viewModel';

/* Diff and Hotspots put git history onto the Map's boxes and lines. */

const graph = {
  nodes: [
    { id: 'svc:orders', kind: 'service', label: 'orders', path: 'orders' },
    { id: 'svc:pay', kind: 'service', label: 'payments', path: 'payments' },
    { id: 'svc:new', kind: 'service', label: 'shipping', path: 'shipping' },
    { id: 'f:o1', kind: 'file', label: 'a.ts', path: 'orders/a.ts', parentId: 'svc:orders', meta: { pageRank: 0.5 } },
    { id: 'f:o2', kind: 'file', label: 'b.ts', path: 'orders/b.ts', parentId: 'svc:orders', meta: { pageRank: 0.1 } },
    { id: 'f:p1', kind: 'file', label: 'c.ts', path: 'payments/c.ts', parentId: 'svc:pay', meta: { pageRank: 0.9 } },
    { id: 'f:s1', kind: 'file', label: 'd.ts', path: 'shipping/d.ts', parentId: 'svc:new', meta: { pageRank: 0.2 } },
  ],
  edges: [
    { id: 'e1', srcId: 'f:o1', dstId: 'svc:pay', kind: 'http', evidence: [{ file: 'orders/a.ts', line: 3, snippet: '' }, { file: 'orders/b.ts', line: 9, snippet: '' }] },
    { id: 'e2', srcId: 'f:p1', dstId: 'svc:orders', kind: 'http', evidence: [{ file: 'payments/c.ts', line: 1, snippet: '' }] },
  ],
} as unknown as ArchGraph;
const boxes: ViewBox[] = [
  { id: 'svc:orders', label: 'orders' },
  { id: 'svc:pay', label: 'payments' },
  { id: 'svc:new', label: 'shipping' },
];
const pairs = [
  { source: 'svc:orders', target: 'svc:pay' },
  { source: 'svc:pay', target: 'svc:orders' },
];

describe('diff model', () => {
  it('places files on the drawn box above them, including files the scan does not know', () => {
    const boxOf = boxOfPath(graph, boxes);
    expect(boxOf('orders/a.ts')).toBe('svc:orders');
    expect(boxOf('orders/deleted.ts')).toBe('svc:orders');
    expect(boxOf('README.md')).toBeUndefined();
  });

  it('marks changed and added boxes, touched lines, and files in no box', () => {
    const m = diffModel(graph, boxes, pairs, [
      { path: 'orders/a.ts', status: 'modified' },
      { path: 'shipping/d.ts', status: 'added' },
      { path: 'README.md', status: 'modified' },
    ]);
    expect(m.boxes.map((b) => `${b.id}:${b.status}`)).toEqual(['svc:orders:changed', 'svc:new:added']);
    expect(m.lines).toEqual([{ source: 'svc:orders', target: 'svc:pay', links: 1 }]);
    expect(m.elsewhere.map((f) => f.path)).toEqual(['README.md']);
    expect(m.removed).toEqual([]);
  });
});

describe('removed modules (ghosts on the Map)', () => {
  /* A tree with a top level (packages/*) and one open group (packages/app,
     whose members are its src/* modules). */
  const tree = {
    nodes: [
      { id: 'pkg:app', kind: 'package', label: 'app', path: 'packages/app' },
      { id: 'pkg:lib', kind: 'package', label: 'lib', path: 'packages/lib' },
      { id: 'mod:ui', kind: 'module', label: 'ui', path: 'packages/app/src/ui', parentId: 'pkg:app' },
      { id: 'mod:api', kind: 'module', label: 'api', path: 'packages/app/src/api', parentId: 'pkg:app' },
      { id: 'f:ui', kind: 'file', label: 'a.ts', path: 'packages/app/src/ui/a.ts', parentId: 'mod:ui' },
      { id: 'f:api', kind: 'file', label: 'b.ts', path: 'packages/app/src/api/b.ts', parentId: 'mod:api' },
      { id: 'f:lib', kind: 'file', label: 'c.ts', path: 'packages/lib/c.ts', parentId: 'pkg:lib' },
    ],
    edges: [],
  } as unknown as ArchGraph;
  const closed: ViewBox[] = [
    { id: 'pkg:app', label: 'app' },
    { id: 'pkg:lib', label: 'lib' },
  ];
  const open: ViewBox[] = [...closed, { id: 'mod:ui', label: 'ui', parentId: 'pkg:app' }, { id: 'mod:api', label: 'api', parentId: 'pkg:app' }];
  const del = (path: string) => ({ path, status: 'deleted' as const });

  it('draws a package the branch deleted whole beside the top-level boxes', () => {
    const r = removedModules(tree, closed, [del('packages/old/x.ts'), del('packages/old/y/z.ts')]);
    expect(r).toEqual([
      { id: `${REMOVED_PREFIX}packages/old`, label: 'old', dir: 'packages/old', files: [del('packages/old/x.ts'), del('packages/old/y/z.ts')] },
    ]);
  });

  it('draws a module deleted inside an open group as a member of that group', () => {
    const r = removedModules(tree, open, [del('packages/app/src/gone/x.ts')]);
    expect(r.map((b) => [b.id, b.parentId])).toEqual([[`${REMOVED_PREFIX}packages/app/src/gone`, 'pkg:app']]);
  });

  it('draws no ghost for a deletion inside a closed box, a module that still has files, a lone file, or a docs folder', () => {
    expect(removedModules(tree, closed, [del('packages/app/src/gone/x.ts')])).toEqual([]);
    expect(removedModules(tree, open, [del('packages/app/src/ui/old.ts')])).toEqual([]);
    expect(removedModules(tree, closed, [del('packages/lib/old.ts'), del('packages/README.md')])).toEqual([]);
    expect(removedModules(tree, closed, [del('packages/notes/a.md')])).toEqual([]);
  });

  it('a removed module takes its files off the changed boxes, and the marks carry it as a ghost', () => {
    const m = diffModel(tree, open, [], [del('packages/app/src/gone/x.ts'), { path: 'packages/app/src/ui/a.ts', status: 'modified' }]);
    expect(m.boxes.map((b) => `${b.id}:${b.status}`)).toEqual(['mod:ui:changed']);
    expect(m.removed.map((b) => b.id)).toEqual([`${REMOVED_PREFIX}packages/app/src/gone`]);
    expect(diffMarks(m)).toEqual({
      marks: { 'mod:ui': 'changed', [`${REMOVED_PREFIX}packages/app/src/gone`]: 'removed' },
      ghosts: [{ id: `${REMOVED_PREFIX}packages/app/src/gone`, label: 'gone', parentId: 'pkg:app' }],
    });
    /* The ghost comes back in the Map's boxes; the model is unchanged by it. */
    const again = diffModel(tree, [...open, { id: `${REMOVED_PREFIX}packages/app/src/gone`, label: 'gone', parentId: 'pkg:app' }], [], [
      del('packages/app/src/gone/x.ts'),
      { path: 'packages/app/src/ui/a.ts', status: 'modified' },
    ]);
    expect(diffMarks(again)).toEqual(diffMarks(m));
  });
});

describe('heat model', () => {
  it('ranks boxes by pageRank x commits, and leaves boxes with no heat unranked', () => {
    const h = heatModel(graph, boxes, { 'orders/a.ts': 2, 'orders/b.ts': 1, 'payments/c.ts': 1 });
    /* orders 0.5*2 + 0.1*1 = 1.1; payments 0.9*1 = 0.9; shipping none. */
    /* Centrality: mean pageRank per change, over the highest (payments 0.9):
       orders 1.1/3 = 0.367 -> 0.41; heat = changes x centrality x 0.9. */
    expect(h).toEqual([
      { id: 'svc:orders', heat: 1.1, commits: 3, centrality: 0.41, rank: 1 },
      { id: 'svc:pay', heat: 0.9, commits: 1, centrality: 1, rank: 2 },
    ]);
  });
});

describe('the views read their route and show the result', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  it('Diff asks for the branch against main and lists changed boxes with a status word', async () => {
    const f = vi.fn(async () => json({ files: [{ path: 'orders/a.ts', status: 'modified' }] }));
    render(<DiffView boxes={boxes} lines={pairs.map((p) => ({ ...p, count: 1 }))} graph={graph} fetchImpl={f} />);
    const row = await screen.findByTestId('diff-box');
    expect(f).toHaveBeenCalledWith('/api/git/branch-files?base=main');
    expect(row.getAttribute('data-id')).toBe('svc:orders');
    expect(row.textContent).toContain('~ changed');
    expect(screen.getByTestId('diff-line').getAttribute('data-pair')).toBe('svc:orders->svc:pay');
    expect(screen.getByTestId('diff-summary').textContent).toBe('1 box changes against main, 1 connection touched.');
  });

  it('Diff against a repo whose default branch is master compares against master and says so (no git error)', async () => {
    const f = vi.fn(async () => json({ base: 'master', requested: 'main', files: [{ path: 'orders/a.ts', status: 'modified' }] }));
    render(<DiffView boxes={boxes} lines={[]} graph={graph} fetchImpl={f} />);
    const sum = await screen.findByTestId('diff-summary');
    expect(sum.textContent).toContain('against master');
    expect(screen.queryByTestId('diff-error')).toBeNull();
  });

  it('Diff with no base at all is a calm empty state, not an error', async () => {
    const f = vi.fn(async () => json({ base: null, requested: 'main', mergeBase: null, head: null, files: [], noBase: true }));
    render(<DiffView boxes={boxes} lines={[]} graph={graph} fetchImpl={f} />);
    const msg = await screen.findByTestId('diff-nobase');
    expect(msg.textContent).toMatch(/no base branch/i);
    expect(screen.queryByTestId('diff-error')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Diff hands the Map its marks once, and counts one hidden file in the singular', async () => {
    const files = Array.from({ length: 9 }, (_, i) => ({ path: `orders/f${i}.ts`, status: 'modified' }));
    const f = vi.fn(async () => json({ files }));
    const onMarks = vi.fn();
    const { rerender } = render(<DiffView boxes={boxes} lines={[]} graph={graph} fetchImpl={f} onMarks={onMarks} />);
    expect((await screen.findByTestId('diff-more-files')).textContent).toBe('1 more file');
    const last = () => onMarks.mock.calls.filter((c) => c[0] !== null).at(-1)?.[0];
    await waitFor(() => expect(last()).toEqual({ marks: { 'svc:orders': 'changed' }, ghosts: [] }));
    const calls = onMarks.mock.calls.length;
    rerender(<DiffView boxes={[...boxes]} lines={[]} graph={graph} fetchImpl={f} onMarks={onMarks} />);
    expect(onMarks.mock.calls.length).toBe(calls);
  });

  it('Diff shows a long path on one line, cut from the left, the whole path on hover (round 7)', async () => {
    const path = 'orders/components/AReturningUserSeesWhatSurvived.test.tsx';
    const f = vi.fn(async () => json({ files: [{ path, status: 'modified' }] }));
    render(<DiffView boxes={boxes} lines={[]} graph={graph} fetchImpl={f} />);
    const cell = await screen.findByTestId('diff-file-path');
    expect(cell.getAttribute('dir')).toBe('rtl');
    expect(cell.textContent).toBe(`‎${path}‎`);
    expect(cell.closest('li')?.getAttribute('title')).toBe(path);
    const css = readFileSync(resolve(__dirname, 'views.css'), 'utf8');
    const at = css.indexOf('.diffview .dv-path {');
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('white-space: nowrap');
    expect(rule).toContain('text-overflow: ellipsis');
    expect(css).not.toContain('.diffview .dv-file { overflow-wrap: anywhere; }');
    /* The list may shrink below its longest path, or nothing is ever cut. */
    expect(css).toContain('.diffview .dv-files { flex: 1 0 100%; min-width: 0;');
  });

  it('Diff says why when the base cannot be read', async () => {
    const f = vi.fn(async () => json({ error: 'git merge-base failed: Not a valid object name main' }, 400));
    render(<DiffView boxes={boxes} lines={[]} graph={graph} fetchImpl={f} />);
    expect((await screen.findByTestId('diff-error')).textContent).toContain('merge-base');
  });

  it('Hotspots paints the rank on each ranked box', async () => {
    const f = vi.fn(async () => json({ files: { 'payments/c.ts': 3 }, until: '2026-09-15T12:00:00Z', commits: 3 }));
    render(<HotspotsView boxes={boxes} graph={graph} fetchImpl={f} />);
    await waitFor(() => expect(screen.getAllByTestId('hot-box')).toHaveLength(1));
    expect(f).toHaveBeenCalledWith('/api/git/churn?days=90');
    expect(screen.getByTestId('hot-rank').textContent).toBe('1');
    expect(screen.getByTestId('hot-name').textContent).toBe('Payments');
    expect(screen.getByTestId('hot-measure').textContent).toBe('3 changes, centrality 1.00');
    expect(screen.getByTestId('hot-key').textContent).toContain('changes × centrality');
  });
});
