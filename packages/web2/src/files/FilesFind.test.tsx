import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { act } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { TreeNode } from '@sequence/api-types';

import '../tokens/graphite.css';
import './files.css';

import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas';
import { twoPackages } from '../rail/fixtures';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore, type Store } from '../state';

import { ConnectedFilesPanel } from './ConnectedFilesPanel';
import { parseSearchText } from './FilesFind';
import { requestFilesFindFocus } from './filesFindFocus';

/* G9: Find in the Files space. The search text below is the exact shape executeSearchFiles returns
   (header, fence, `path:line: snippet`, fence), as read from askTools.ts. */
const SEARCH_TEXT = [
  '<untrusted_repo_content>',
  '### search results for "total" (3) (stopped after 20 matches - there may be more; narrow the query or use a glob)',
  '```',
  'packages/one.ts:12:   const total = price * qty;',
  'packages/one.ts:40: return total;',
  'README.md:3: Totals are computed here',
  '```',
  '</untrusted_repo_content>',
].join('\n');

const TREE: TreeNode = {
  name: 'sequence',
  path: '',
  type: 'dir',
  children: [
    {
      name: 'packages',
      path: 'packages',
      type: 'dir',
      children: [{ name: 'one.ts', path: 'packages/one.ts', type: 'file' }],
    },
    { name: 'README.md', path: 'README.md', type: 'file' },
  ],
};
const FILE_ONE = Array.from({ length: 50 }, (_, i) => (i === 11 ? '  const total = price * qty;' : `// line ${i + 1}`)).join('\n');

type SearchAnswer = { status?: number; body?: unknown; reject?: string };

function wire(search: SearchAnswer) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    calls.push(url.pathname + url.search);
    if (url.pathname === '/api/search') {
      if (search.reject) throw new Error(search.reject);
      return json(search.body ?? { ok: true, text: SEARCH_TEXT, evidence: '' }, search.status ?? 200);
    }
    if (url.pathname === '/api/tree') return json(TREE);
    if (url.pathname === '/api/git/status') return json({ branch: 'main', files: [] });
    if (url.pathname === '/api/file') {
      return new Response(url.searchParams.get('path') === 'packages/one.ts' ? FILE_ONE : 'readme', {
        headers: { 'content-type': 'text/plain' },
      });
    }
    if (url.pathname === '/api/git/diff') return json({ path: '', diff: '' });
    if (url.pathname === '/api/status') return json({ attached: false });
    return json({ error: 'no route' }, 404);
  };
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

/* Opening a match shows the file through lazy(import()) FilePreview / CodeEditor, which Vite transforms on first use; a cold
   transform outlasts findBy's window ("Unable to find files-find-input"). Load them first, so the wait is on the store. */
beforeAll(async () => {
  await Promise.all([import('./FilePreview'), import('./CodeEditor')]);
}, 120_000);

function store(): Store {
  const graph = twoPackages();
  const s = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  s.dispatch({
    type: 'repo/loaded',
    draft: { root: '/repo', repoName: 'repo', graph, summary: summarizeGraph(graph), scannedAt: new Date().toISOString() },
    at: Date.now(),
  });
  return s;
}

function mount(search: SearchAnswer, s: Store = store()) {
  const w = wire(search);
  render(
    <StoreProvider store={s}>
      <ConnectedFilesPanel fetchImpl={w.fetchImpl} />
    </StoreProvider>,
  );
  return { ...w, store: s };
}

const field = () => screen.findByTestId('files-find-project') as Promise<HTMLInputElement>;
async function search(text: string) {
  const input = await field();
  fireEvent.change(input, { target: { value: text } });
  return input;
}

describe('parseSearchText', () => {
  it('groups fenced hits by file, strips the header and keeps the engine note', () => {
    const r = parseSearchText(SEARCH_TEXT);
    expect(r.groups.map((g) => [g.path, g.hits.map((h) => h.line)])).toEqual([
      ['packages/one.ts', [12, 40]],
      ['README.md', [3]],
    ]);
    expect(r.groups[0]!.hits[0]!.text).toBe('  const total = price * qty;');
    expect(r.note).toMatch(/^\(stopped after 20 matches/);
  });
  it('ignores a line outside the fence and keeps a snippet that contains path:line', () => {
    const r = parseSearchText('```\na.ts:1: see b.ts:2: here\n```\nnot.ts:9: outside');
    expect(r.groups).toEqual([{ path: 'a.ts', hits: [{ line: 1, text: 'see b.ts:2: here' }] }]);
  });
  it('an empty answer has no groups', () => {
    expect(parseSearchText('')).toEqual({ groups: [], note: '' });
  });
});

describe('Find in the Files space', () => {
  it('typing a query calls /api/search and renders matches grouped by file with line numbers and the match marked', async () => {
    const { calls } = mount({});
    await search('total');
    const hits = await screen.findAllByTestId('files-find-hit');
    expect(calls.filter((c) => c.startsWith('/api/search'))).toEqual(['/api/search?query=total']);
    expect(hits).toHaveLength(3);
    const groups = within(screen.getByTestId('files-find-results')).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['packages/one.ts', 'README.md']);
    expect(hits.map((h) => [h.getAttribute('data-path'), h.getAttribute('data-line')])).toEqual([
      ['packages/one.ts', '12'],
      ['packages/one.ts', '40'],
      ['README.md', '3'],
    ]);
    expect(hits[0]!.querySelector('.files-find-ln')!.textContent).toBe('12');
    const marks = Array.from(hits[0]!.querySelectorAll('mark')).map((m) => m.textContent);
    expect(marks).toEqual(['total']);
    expect(screen.getByTestId('files-find-cap').textContent).toMatch(/stopped after 20 matches/);
  });

  it('arrows move the active match and Enter opens that path at that line, seeding the in-file find', async () => {
    const { store: s } = mount({});
    const input = await search('total');
    await screen.findAllByTestId('files-find-hit');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByTestId('files-find-hit')[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getAllByTestId('files-find-hit')[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(s.getState().session.filesFocus).toMatchObject({ path: 'packages/one.ts', line: 40, view: 'edit' });
    const seeded = (await screen.findByTestId('files-find-input')) as HTMLInputElement;
    expect(seeded.value).toBe('total');
    expect(screen.queryByTestId('files-find-results')).toBeNull();
  });

  it('clicking a match opens it the same way', async () => {
    const { store: s } = mount({});
    await search('total');
    fireEvent.click((await screen.findAllByTestId('files-find-hit'))[2]!);
    expect(s.getState().session.filesFocus).toMatchObject({ path: 'README.md', line: 3 });
  });

  it('Mod+Shift+F focuses the find field', async () => {
    mount({});
    const input = await field();
    (document.body as HTMLElement).focus();
    expect(document.activeElement).not.toBe(input);
    fireEvent.keyDown(document, { key: 'F', ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('the chat header request focuses it, even when the Files surface mounts afterwards', async () => {
    requestFilesFindFocus();
    mount({});
    const input = await field();
    await waitFor(() => expect(document.activeElement).toBe(input));
    (document.body as HTMLElement).focus();
    requestFilesFindFocus();
    expect(document.activeElement).toBe(input);
  });

  it('no matches says so, with the query', async () => {
    mount({ body: { ok: true, text: '', evidence: 'search "zzz" - no matches' } });
    await search('zzz');
    expect((await screen.findByTestId('files-find-empty')).textContent).toBe('No matches for "zzz".');
  });

  it.each([
    ['the engine refuses', { status: 400, body: { error: 'query or glob required' } }, /query or glob required/],
    ['the tool reports not ok', { body: { ok: false, text: '', evidence: 'refused: no repo' } }, /refused: no repo/],
    ['nothing answers', { reject: 'connection refused' }, /connection refused/],
  ] as const)('an error is shown, not an empty list: %s', async (_name, answer, said) => {
    mount(answer as SearchAnswer);
    await search('total');
    const err = await screen.findByTestId('files-find-error');
    expect(err.textContent).toMatch(said);
    expect(screen.queryByTestId('files-find-empty')).toBeNull();
  });

  it('an empty field asks nothing more', async () => {
    const { calls } = mount({});
    await search('total');
    await screen.findAllByTestId('files-find-hit');
    fireEvent.change(await field(), { target: { value: '  ' } });
    expect(screen.queryByTestId('files-find-results')).toBeNull();
    expect(calls.filter((c) => c.startsWith('/api/search'))).toHaveLength(1);
  });

  it('with no hits the engine note that travels only in evidence is shown (a cap is not "nothing")', async () => {
    mount({
      body: { ok: true, text: '', evidence: 'search "zzz" — no matches (stopped after 200 files - there may be more; narrow with a glob)' },
    });
    await search('zzz');
    const empty = await screen.findByTestId('files-find-empty');
    expect(empty.textContent).toContain('No matches for "zzz".');
    expect(empty.textContent).toContain('(stopped after 200 files - there may be more; narrow with a glob)');
  });

  it('Ctrl+Shift+F inside the editor goes to the project find, and does not open the in-file find', async () => {
    const { store: s } = mount({});
    const input = await search('total');
    await screen.findAllByTestId('files-find-hit');
    fireEvent.keyDown(input, { key: 'Enter' });
    const inFile = (await screen.findByTestId('files-find-input')) as HTMLInputElement;
    fireEvent.keyDown(inFile, { key: 'Escape' });
    expect(screen.queryByTestId('files-find')).toBeNull();
    const ta = await screen.findByTestId('files-editor');
    ta.focus();
    fireEvent.keyDown(ta, { key: 'F', ctrlKey: true, shiftKey: true });
    expect(screen.queryByTestId('files-find')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('files-find-project'));
    expect(s.getState().session.filesFocus?.path).toBe('packages/one.ts');
  });

  it('the seed belongs to the open it came from: a later files/open does not reuse the query', async () => {
    const { store: s } = mount({});
    const input = await search('total');
    await screen.findAllByTestId('files-find-hit');
    fireEvent.keyDown(input, { key: 'Enter' });
    const inFile = (await screen.findByTestId('files-find-input')) as HTMLInputElement;
    fireEvent.keyDown(inFile, { key: 'Escape' });
    expect(screen.queryByTestId('files-find')).toBeNull();
    act(() => s.dispatch({ type: 'files/open', path: 'packages/one.ts', line: 5 }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('files-find')).toBeNull();
  });

  it('the match is marked on the original text even where lowercasing changes its length', async () => {
    const dotted = 'İİ total';
    mount({ body: { ok: true, text: ['```', 'a.ts:1: ' + dotted, '```'].join('\n'), evidence: '' } });
    await search('TOTAL');
    const hit = (await screen.findAllByTestId('files-find-hit'))[0]!;
    expect(hit.querySelector('mark')!.textContent).toBe('total');
  });

  it('a key already handled (a terminal Ctrl+Shift+F) does not steal focus', async () => {
    mount({});
    const input = await field();
    (document.body as HTMLElement).focus();
    const swallow = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', swallow, true);
    fireEvent.keyDown(document.body, { key: 'F', ctrlKey: true, shiftKey: true });
    window.removeEventListener('keydown', swallow, true);
    expect(document.activeElement).not.toBe(input);
  });

  it('a focus request survives a slow mount: age on the clock does not drop it', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    requestFilesFindFocus();
    now.mockReturnValue(1_000_000 + 60_000);
    mount({});
    const input = await field();
    await waitFor(() => expect(document.activeElement).toBe(input));
    now.mockRestore();
  });

  it('a focus request is dropped once the reader presses or types something else before the mount', async () => {
    requestFilesFindFocus();
    fireEvent.keyDown(document.body, { key: 'a' });
    mount({});
    const input = await field();
    await new Promise((r) => setTimeout(r, 30));
    expect(document.activeElement).not.toBe(input);
  });
});
