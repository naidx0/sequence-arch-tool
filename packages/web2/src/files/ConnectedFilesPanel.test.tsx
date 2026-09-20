import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GetArchGraphResponse, TreeNode } from '@sequence/api-types';

import '../tokens/graphite.css';
import './files.css';

import { App } from '../app/App';
import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas';
import { twoPackages } from '../rail/fixtures';
import { readShellPersisted, readShellTokens } from '../shell';
import { StoreProvider, createStore, type Store } from '../state';

import { FILES } from './anchors';
import { CONNECTED_FILES, ConnectedFilesPanel } from './ConnectedFilesPanel';

/* ══════════════════════════════════════════════════════════════════════════
   THE FILES PANEL, WIRED
   packages/web2/src/files/ConnectedFilesPanel.test.tsx

   WHAT THIS FILE IS ACTUALLY ABOUT, AND IT IS ONE THING: the panel next door
   was finished, tested ninety-two times and REACHABLE BY NOBODY, because the
   only entry named "Files" opened the architecture surface. `FilesPanel.test`
   proves the panel draws; this proves the product contains it.

   So the last test in this file is the important one. It presses the menu
   entry a person presses, on the real `<App/>`, and looks for the panel in the
   DOM — not for a dispatch, not for a state flag. CANON §6: "This project has
   twice shipped a test asserting that a dispatch landed while the button
   opened nothing."

   THE OTHERS ARE THE WIRE'S FOUR RULES, each with a failure it prevents:
     - selecting a file READS it, from `/api/file`, and shows what came back;
     - switching to Diff ASKS `/api/git/diff`, and does not show stale text;
     - an EMPTY diff is a complete answer and says "unchanged, or untracked" —
       `idle` there would print "nothing loaded yet" forever about a question
       that was asked and answered;
     - a refusal carries THE SERVER'S OWN SENTENCE, out of the `{error:…}`
       envelope it arrives in. "too large", "outside the repo" and "not found"
       are three different fixes and one generic line is none of them.

   jsdom has no layout, so nothing here claims anything about overflow or
   scrolling — that is the legibility gate's question, against a real browser
   and the real repository.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── a server ────────────────────────────────────────────────────────────── */

interface Served {
  /** `GET /api/tree`. `null` refuses, which is how the graph fallback is
   *  exercised — an origin with a static graph and no engine 404s here. */
  tree?: TreeNode | null;
  status?: { branch: string; files: { path: string; status: string }[] };
  /** Repo-relative path → what `GET /api/file` answers. */
  file?: Record<string, { status?: number; body: string }>;
  /** Repo-relative path → what `GET /api/git/diff` answers. */
  diff?: Record<string, { status?: number; body: unknown }>;
  /** What `PUT /api/file` answers. */
  write?: { status?: number; body: unknown };
}

interface Wire {
  fetchImpl: typeof fetch;
  calls: { url: string; method: string; body: string | null }[];
  /** Every request to one pathname, newest last. */
  to(pathname: string): { url: string; method: string; body: string | null }[];
}

function serving(served: Served): Wire {
  const calls: Wire['calls'] = [];

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url: url.pathname + url.search, method, body });
    const rel = url.searchParams.get('path') ?? '';

    if (url.pathname === '/api/tree') {
      if (served.tree === null) return json({ error: 'no repository attached' }, 400);
      return json(served.tree ?? { name: 'repo', path: '', type: 'dir', children: [] });
    }

    if (url.pathname === '/api/git/status') {
      return json(served.status ?? { branch: 'main', files: [] });
    }

    if (url.pathname === '/api/file' && method === 'GET') {
      const hit = served.file?.[rel];
      /* THE ENGINE'S OWN SHAPE. `sendError` answers JSON with an `error` key
         and the route answers `text/plain` when it succeeds, so a fake that
         sent plain text both ways would let a client that never unwraps the
         envelope pass. */
      if (hit === undefined) return json({ error: 'file not found' }, 404);
      return new Response(hit.body, {
        status: hit.status ?? 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (url.pathname === '/api/file' && method === 'PUT') {
      const write = served.write ?? { status: 200, body: { ok: true, path: rel } };
      return json(write.body, write.status ?? 200);
    }

    if (url.pathname === '/api/git/diff') {
      const hit = served.diff?.[rel];
      if (hit === undefined) return json({ path: rel, diff: '' });
      return json(hit.body, hit.status ?? 200);
    }

    /* Boot's own probes land here. Unattached rather than refused, because a
       refusal on `/api/status` is a different ladder rung and this file is not
       about boot. An already-attached store is never demoted by it either
       way (`bootSettled`). */
    if (url.pathname === '/api/status') return json({ attached: false });

    return json({ error: `no route in this test for ${url.pathname}` }, 404);
  };

  return {
    fetchImpl: impl as unknown as typeof fetch,
    calls,
    to: (pathname) => calls.filter((call) => call.url.split('?')[0] === pathname),
  };
}

/* ── a repository ────────────────────────────────────────────────────────── */

const TREE: TreeNode = {
  name: 'sequence',
  path: '',
  type: 'dir',
  children: [
    {
      name: 'packages',
      path: 'packages',
      type: 'dir',
      children: [
        { name: 'one.ts', path: 'packages/one.ts', type: 'file' },
        { name: 'two.ts', path: 'packages/two.ts', type: 'file' },
      ],
    },
    /* At the root, so it is a visible row with nothing expanded — the tree
       opens collapsed on purpose (see the connector's header). */
    { name: 'README.md', path: 'README.md', type: 'file' },
  ],
};

/** A store holding a scan, built the way `App.tsx` builds the real one — same
 *  projector, same token read — so a defect in that composition shows up here
 *  rather than being configured around. */
function storeWithGraph(graph: GetArchGraphResponse = twoPackages()): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/repo',
      repoName: graph.repoName ?? 'repo',
      graph,
      summary: summarizeGraph(graph),
      scannedAt: graph.scannedAt ?? new Date().toISOString(),
    },
    at: Date.now(),
  });
  return store;
}

function mount(served: Served, store: Store = storeWithGraph()) {
  const wire = serving(served);
  render(
    <StoreProvider store={store}>
      <ConnectedFilesPanel fetchImpl={wire.fetchImpl} />
    </StoreProvider>,
  );
  return { wire, store };
}

/** The tree row for a path, once the tree has arrived. */
async function row(path: string): Promise<HTMLElement> {
  return await waitFor(() => {
    const found = screen
      .getAllByTestId(FILES.row)
      .find((element) => element.getAttribute('data-path') === path);
    if (!found) throw new Error(`no row for ${path}`);
    return found;
  });
}

function mode(id: 'code' | 'diff' | 'edit'): HTMLElement {
  const found = screen
    .getAllByTestId(FILES.viewOption)
    .find((element) => element.getAttribute('data-mode') === id);
  if (!found) throw new Error(`no ${id} mode control`);
  return found;
}

const JSDOM_DEFAULT_WIDTH = window.innerWidth;

beforeEach(() => {
  /* The shell puts its columns up at the wide breakpoint; the App test below
     asks a question about a desktop frame, and jsdom's default is 1024. */
  Object.defineProperty(window, 'innerWidth', { value: 1600, configurable: true });
});

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: JSDOM_DEFAULT_WIDTH, configurable: true });
  window.localStorage.clear();
});

/* ── the tree ────────────────────────────────────────────────────────────── */

describe('what the tree holds', () => {
  it('lists the repository from /api/tree, not only the files the scanner named', async () => {
    /*
     * THE RAIL IS AN INDEX OF WHAT THE SCANNER UNDERSTOOD; THIS IS AN IDE.
     * `README.md` has no node in any arch graph, and an editor that cannot
     * open it is not one. `twoPackages()` names three .ts files and no
     * markdown, so a row for README.md can only have come from the route.
     */
    mount({ tree: TREE });
    expect(await row('README.md')).toBeTruthy();
  });

  it('falls back to the scan’s file nodes when /api/tree is not served', async () => {
    /*
     * An origin serving a static `/archgraph.json` with no engine behind it
     * refuses this route. Drawing nothing there would claim the repository is
     * empty, which is a different fact from "nobody answered".
     *
     * AND IT NORMALISES. The engine sends NATIVE separators — the fixture
     * carries `packages\alpha\src\one.ts` for exactly this reason — while
     * every path this panel compares against is forward-slashed. A missing
     * `toRepoPath` makes one file two rows.
     */
    mount({ tree: null });
    const packages = await row('packages');
    fireEvent.click(packages);
    expect(await row('packages/alpha/src')).toBeTruthy();
    for (const element of screen.getAllByTestId(FILES.row)) {
      expect(element.getAttribute('data-path')).not.toContain(String.fromCharCode(92));
    }
  });

  it('shows a file that git knows about and the tree does not', async () => {
    /* A file created since the tree was read is in status and in no other
       list. The two are CONCATENATED for that reason and `buildFileTree`
       dedupes the overlap. */
    mount({
      tree: TREE,
      status: { branch: 'main', files: [{ path: 'brand-new.ts', status: 'untracked' }] },
    });
    expect(await row('brand-new.ts')).toBeTruthy();
  });
});

/* ── reading ─────────────────────────────────────────────────────────────── */

describe('reading a file', () => {
  it('SELECTING A FILE FETCHES IT AND SHOWS WHAT CAME BACK', async () => {
    const { wire } = mount({
      tree: TREE,
      file: { 'README.md': { body: '# Sequence\nKeeps your architecture honest.' } },
    });

    fireEvent.click(await row('README.md'));

    await waitFor(() => expect(screen.getByTestId(FILES.code)).toBeTruthy());
    expect(screen.getByTestId(FILES.code).textContent).toContain('Keeps your architecture honest.');
    /* The path travels as an ENCODED query parameter, which is what keeps the
       file being read from becoming part of the request's own host. */
    expect(wire.to('/api/file')[0]?.url).toBe('/api/file?path=README.md');
  });

  it('SURFACES THE SERVER’S OWN SENTENCE, out of the envelope it arrives in', async () => {
    /*
     * "too large", "outside the repo" and "unreadable" are three different
     * fixes, and a panel that flattened them into "could not load" would
     * delete the only line the reader can act on. The envelope is unwrapped
     * because `sendError` sends `{"error":"…"}` — printing the body raw puts
     * braces and a key name in front of the sentence.
     */
    mount({
      tree: TREE,
      file: {
        'README.md': {
          status: 413,
          body: JSON.stringify({ error: 'file too large (>2000000 bytes)' }),
        },
      },
    });

    fireEvent.click(await row('README.md'));

    await waitFor(() =>
      expect(screen.getByTestId(FILES.note).textContent).toBe('file too large (>2000000 bytes)'),
    );
    expect(screen.queryByTestId(FILES.code)).toBeNull();
  });
});

/* ── diffing ─────────────────────────────────────────────────────────────── */

const DIFF = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1,1 +1,2 @@',
  ' # Sequence',
  '+Keeps your architecture honest.',
  '',
].join('\n');

describe('the diff', () => {
  it('SWITCHING TO DIFF FETCHES THE DIFF', async () => {
    const { wire } = mount({
      tree: TREE,
      file: { 'README.md': { body: '# Sequence' } },
      diff: { 'README.md': { body: { path: 'README.md', diff: DIFF } } },
    });

    fireEvent.click(await row('README.md'));
    await waitFor(() => expect(screen.getByTestId(FILES.code)).toBeTruthy());
    /* Nothing is asked of git until the diff is what is showing. */
    expect(wire.to('/api/git/diff')).toHaveLength(0);

    fireEvent.click(mode('diff'));

    await waitFor(() => expect(screen.getByTestId(FILES.diff)).toBeTruthy());
    expect(wire.to('/api/git/diff')[0]?.url).toBe('/api/git/diff?path=README.md');
    expect(screen.getByTestId(FILES.diff).textContent).toContain(
      'Keeps your architecture honest.',
    );
  });

  it('AN EMPTY DIFF SAYS UNCHANGED, and never sits on "nothing loaded yet"', async () => {
    /*
     * THE RULE THIS FILE EXISTS MOST TO LOCK. An unchanged or untracked file
     * has an empty diff, and that is a complete, correct answer — so it is
     * passed as `ready` with an empty string. Passing `idle` would render
     * "Nothing loaded for README.md yet", which is a statement about this
     * client that is false, and it would never change.
     */
    mount({
      tree: TREE,
      file: { 'README.md': { body: '# Sequence' } },
      diff: { 'README.md': { body: { path: 'README.md', diff: '' } } },
    });

    fireEvent.click(await row('README.md'));
    fireEvent.click(mode('diff'));

    const note = await waitFor(() => screen.getByTestId(FILES.diffNote));
    expect(note.textContent).toContain('unchanged, or git is not tracking it yet');
    expect(screen.getByTestId(FILES.diff).getAttribute('data-state')).toBe('empty');
    expect(screen.queryByText(/Nothing loaded/)).toBeNull();
    expect(screen.queryByText(/Reading README\.md/)).toBeNull();
  });

  it('shows the engine’s refusal when the diff cannot be taken', async () => {
    mount({
      tree: TREE,
      file: { 'README.md': { body: '# Sequence' } },
      diff: {
        'README.md': { status: 409, body: { error: 'this repository has no commits yet' } },
      },
    });

    fireEvent.click(await row('README.md'));
    fireEvent.click(mode('diff'));

    await waitFor(() =>
      expect(screen.getByTestId(FILES.note).textContent).toBe(
        'this repository has no commits yet',
      ),
    );
  });
});

/* ── writing ─────────────────────────────────────────────────────────────── */

describe('editing', () => {
  it('writes the draft through PUT /api/file and marks the graph stale', async () => {
    /*
     * A SAVE RIDES WITH THE FIELD. The panel draws an Edit tab only when
     * `onDraft` is passed, and passing it without a write endpoint would be "a
     * tab that silently discards typing". The write goes through the review
     * lane's client because that is what sends the checkpoint `sessionId` —
     * the engine takes a pre-write baseline only when the request names one,
     * so a private PUT here would write files Rewind cannot undo.
     */
    const { wire, store } = mount({
      tree: TREE,
      file: { 'README.md': { body: '# Sequence' } },
    });

    fireEvent.click(await row('README.md'));
    await waitFor(() => expect(screen.getByTestId(FILES.code)).toBeTruthy());
    fireEvent.click(mode('edit'));

    const editor = await waitFor(() => screen.getByTestId(FILES.editor));
    fireEvent.change(editor, { target: { value: '# Sequence, edited' } });

    const save = screen
      .getAllByTestId(FILES.action)
      .find((element) => element.getAttribute('data-action') === 'save');
    expect(save?.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save!);

    await waitFor(() => expect(wire.to('/api/file').some((c) => c.method === 'PUT')).toBe(true));
    const put = wire.to('/api/file').find((c) => c.method === 'PUT')!;
    expect(JSON.parse(put.body ?? '{}')).toMatchObject({
      path: 'README.md',
      content: '# Sequence, edited',
    });

    /* `PUT /api/file` clears the persisted graph cache WITHOUT re-scanning, so
       every citation the board draws is now grounded in a file that may no
       longer say what the citation says. The app has to say so. */
    await waitFor(() => expect(store.getState().repo.phase).toBe('stale'));
    const repo = store.getState().repo;
    expect(repo.phase === 'stale' ? repo.reason : null).toBe('file-written');
  });

  it('shows the engine’s refusal instead of claiming the file was written', async () => {
    mount({
      tree: TREE,
      file: { 'README.md': { body: '# Sequence' } },
      write: { status: 403, body: { error: 'path targets a reserved git-internal path' } },
    });

    fireEvent.click(await row('README.md'));
    await waitFor(() => expect(screen.getByTestId(FILES.code)).toBeTruthy());
    fireEvent.click(mode('edit'));
    fireEvent.change(await waitFor(() => screen.getByTestId(FILES.editor)), {
      target: { value: 'edited' },
    });
    fireEvent.click(
      screen
        .getAllByTestId(FILES.action)
        .find((element) => element.getAttribute('data-action') === 'save')!,
    );

    await waitFor(() =>
      expect(screen.getByTestId(CONNECTED_FILES.saveNote).textContent).toBe(
        'path targets a reserved git-internal path',
      ),
    );
  });
});

/* ── with nothing attached ───────────────────────────────────────────────── */

describe('with no repository', () => {
  it('points at the local workspace, rather than drawing an empty repo tree', () => {
    /* Unattached General home still opens Files against ~/.sequence/workspace. */
    const wire = serving({});
    render(
      <StoreProvider store={createStore({ tokens: readShellTokens(document.documentElement) })}>
        <ConnectedFilesPanel fetchImpl={wire.fetchImpl} />
      </StoreProvider>,
    );

    expect(screen.getByTestId(CONNECTED_FILES.unattached).textContent).toContain(
      'Local workspace at ~/.sequence/workspace',
    );
    expect(screen.queryByTestId(FILES.panel)).toBeNull();
    /* Soft-jail still probes /api/tree for the workspace home. */
    expect(wire.calls.some((c) => c.url.includes('/api/tree'))).toBe(true);
  });

  it('V3 mount has one Files title (live pane), not a duplicate strip', () => {
    render(
      <StoreProvider store={createStore({ tokens: readShellTokens(document.documentElement) })}>
        <ConnectedFilesPanel fetchImpl={serving({}).fetchImpl} />
      </StoreProvider>,
    );
    /* onClose absent ⇒ V3 live pane; panel must not re-title "Files — …". */
    expect(screen.queryByText(/Files —/)).toBeNull();
  });
});

/* ── the whole point ─────────────────────────────────────────────────────── */

describe('the Files chrome tab', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('MOUNTS THE PANEL — the defect this whole file exists for', async () => {
    /*
     * V3 opens Files from the chrome tab, not the retired workspace-plus menu.
     * Press what a person presses on the real <App/>, and read the DOM.
     */
    const wire = serving({ tree: TREE });
    globalThis.fetch = wire.fetchImpl;

    render(<App appStore={storeWithGraph()} />);

    fireEvent.click(screen.getByRole('button', { name: /^Files$/ }));
    expect(screen.getByTestId(CONNECTED_FILES.root)).toBeTruthy();
    expect(screen.getByTestId(FILES.panel)).toBeTruthy();
    /* Wired, not merely mounted: the tree fills from the engine. */
    expect(await row('README.md')).toBeTruthy();

    /* And it can be put down again — a surface with no way out is a trap. */
    fireEvent.click(screen.getByTestId('v3-tab-close-files'));
    expect(screen.queryByTestId(FILES.panel)).toBeNull();
  });

  /*
   * Files is a workspace COLUMN now, so Architecture opens BESIDE it
   * instead of behind it. NO PILL IN THE BAR IS DEAD: the other surface must
   * appear, and Files must survive until its own chrome × closes it.
   */
  it('another surface opens BESIDE it and does not put it down — no tab in the bar is dead', async () => {
    const wire = serving({ tree: TREE });
    globalThis.fetch = wire.fetchImpl;

    render(<App appStore={storeWithGraph()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Files$/ }));
    expect(await row('README.md')).toBeTruthy();

    /* Architecture is already open at boot — both panes should coexist. */
    expect(document.querySelector('.v3-live-pane[data-surface="architecture"]')).toBeTruthy();
    expect(document.querySelector('.v3-live-pane[data-surface="files"]')).toBeTruthy();
    expect(screen.getByTestId(FILES.panel)).toBeTruthy();

    fireEvent.click(screen.getByTestId('v3-tab-close-files'));
    expect(screen.queryByTestId(FILES.panel)).toBeNull();
  });
});
