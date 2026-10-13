import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, createStore } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { seqdFromGraph } from '../canvas';
import { twoPackages } from '../rail/fixtures';
import { summarizeGraph } from '../boot';

import { BranchSwitcher, relativeDate } from './BranchSwitcher';
import { followGitEvents, reloadAfterSwitch, resetBoardReload } from './boardReload';
import { getBranchChanges, getBranches, switchBranch } from './gitCalls';
import { onGitEvent, resetGitEvents } from './gitEvents';

/* ══════════════════════════════════════════════════════════════════════════
   E7/E8 — the branch switcher, and the board following the head.
   ══════════════════════════════════════════════════════════════════════════ */

const NOW = Date.parse('2026-10-12T12:00:00Z');
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const BRANCHES = {
  current: 'feature/refunds',
  detached: false,
  sha: 'abc1234',
  dirty: 0,
  branches: [
    { name: 'main', ahead: 0, behind: 2, lastCommit: { sha: 'a', subject: 'initial shop', date: ago(2 * 86_400_000) } },
    { name: 'feature/refunds', ahead: 3, behind: 0, lastCommit: { sha: 'b', subject: 'Add refunds', date: ago(10 * 60_000) } },
    { name: 'other-branch', ahead: 0, behind: 0, lastCommit: { sha: 'c', subject: 'misc', date: ago(40 * 86_400_000) } },
  ],
  remoteBranches: [{ name: 'origin/hotfix', remote: true, lastCommit: { sha: 'd', subject: 'hot', date: ago(3_600_000) } }],
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

function makeStore() {
  const graph = twoPackages();
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: { root: '/repo', repoName: 'repo', graph, summary: summarizeGraph(graph), scannedAt: graph.scannedAt ?? new Date().toISOString() },
    at: Date.now(),
  });
  return store;
}

/** A fake EventSource the test can push frames through. */
class FakeEventSource {
  static all: FakeEventSource[] = [];
  listeners: Record<string, ((e: { data?: string }) => void)[]> = {};
  closed = false;
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(t: string, f: (e: { data?: string }) => void) {
    (this.listeners[t] ??= []).push(f);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const f of this.listeners[type] ?? []) f({ data: JSON.stringify(data) });
  }
}

beforeEach(() => {
  FakeEventSource.all = [];
  (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  resetBoardReload();
  resetGitEvents();
});
afterEach(() => {
  delete (globalThis as { EventSource?: unknown }).EventSource;
  vi.restoreAllMocks();
});

describe('gitCalls (over the backend client)', () => {
  it('answers missing on a 404 and on a static host that answers 200 with a page', async () => {
    expect((await getBranches((async () => json({ error: 'x' }, 404)) as unknown as typeof fetch)).outcome).toBe('missing');
    const page = (async () => new Response('<html></html>', { status: 200 })) as unknown as typeof fetch;
    expect((await getBranches(page)).outcome).toBe('missing');
    expect((await getBranchChanges('main', page)).outcome).toBe('missing');
  });

  it('carries a dirty 409 refusal with its files', async () => {
    const f = (async () => json({ ok: false, reason: 'dirty', error: 'dirty', files: ['a.ts'] }, 409)) as unknown as typeof fetch;
    const r = await switchBranch({ branch: 'main' }, f);
    expect(r.outcome).toBe('refused');
    if (r.outcome === 'refused') expect(r.dirty).toEqual(['a.ts']);
  });

  it('decodes SSE frames through the shared stream and closes it with the last listener', () => {
    const seen: string[] = [];
    const off = onGitEvent((e) => seen.push(e.type));
    const off2 = onGitEvent(() => undefined);
    expect(FakeEventSource.all).toHaveLength(1);
    FakeEventSource.all[0]!.emit('git:head', { type: 'git:head', branch: 'main', sha: 's', detached: false, previous: { branch: null, sha: null }, rescan: true });
    expect(seen).toEqual(['git:head']);
    off();
    expect(FakeEventSource.all[0]!.closed).toBe(false);
    off2();
    expect(FakeEventSource.all[0]!.closed).toBe(true);
  });

  it('a stub EventSource that cannot take listeners never emits and never throws', () => {
    (globalThis as { EventSource?: unknown }).EventSource = class {};
    expect(() => onGitEvent(() => undefined)()).not.toThrow();
  });
});

const graphBody = () => {
  const g = twoPackages();
  return { ...g, repoRoot: '/repo', repoName: 'repo', scannedAt: 'later', warnings: g.warnings ?? [] };
};

/** A fetch whose /archgraph.json reads the test can hold open and release one by one. */
function gatedGraph() {
  const gates: (() => void)[] = [];
  let reads = 0;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    if (String(input) !== '/archgraph.json') return json({ error: 'nf' }, 404);
    reads += 1;
    await new Promise<void>((release) => gates.push(release));
    return json(graphBody());
  }) as unknown as typeof fetch;
  return { fetchImpl, reads: () => reads, release: () => gates.shift()?.() };
}

const updated = (sha: string) => ({ type: 'graph:updated', reason: 'git:head', branch: 'b', sha });

describe('the board follows the head', () => {
  const follow = (store: ReturnType<typeof makeStore>, fetchImpl: typeof fetch) =>
    followGitEvents(store, { fetchImpl, subscribe: (on) => onGitEvent(on) });

  it('re-reads /archgraph.json on graph:updated and loads it, never dispatching repo/scanning', async () => {
    const store = makeStore();
    const phases: string[] = [];
    store.subscribe(() => phases.push(store.getState().repo.phase));
    const g = gatedGraph();
    follow(store, g.fetchImpl);
    FakeEventSource.all[0]!.emit('graph:updated', updated('s1'));
    await waitFor(() => expect(g.reads()).toBe(1));
    g.release();
    await waitFor(() => expect(store.getState().repo.phase).toBe('attached'));
    expect(phases).not.toContain('scanning');
  });

  it('git:head alone starts nothing: the engine rescans and says graph:updated when it lands', async () => {
    const g = gatedGraph();
    follow(makeStore(), g.fetchImpl);
    FakeEventSource.all[0]!.emit('git:head', { type: 'git:head', branch: 'b', sha: 's', detached: false, previous: { branch: 'a', sha: 'x' }, rescan: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(g.reads()).toBe(0);
  });

  it('A->B then B->C while a read is pending runs exactly one trailing read', async () => {
    const g = gatedGraph();
    follow(makeStore(), g.fetchImpl);
    const es = FakeEventSource.all[0]!;
    es.emit('graph:updated', updated('B'));
    await waitFor(() => expect(g.reads()).toBe(1));
    es.emit('graph:updated', updated('C'));
    g.release();
    await waitFor(() => expect(g.reads()).toBe(2));
    g.release();
    await new Promise((r) => setTimeout(r, 20));
    expect(g.reads()).toBe(2);
  });

  it('a switch 800 ms after a read finished is not dropped', async () => {
    const g = gatedGraph();
    follow(makeStore(), g.fetchImpl);
    const es = FakeEventSource.all[0]!;
    es.emit('graph:updated', updated('B'));
    await waitFor(() => expect(g.reads()).toBe(1));
    g.release();
    await new Promise((r) => setTimeout(r, 800));
    es.emit('graph:updated', updated('C'));
    await waitFor(() => expect(g.reads()).toBe(2));
    g.release();
  });

  it('a burst of 20 events is at most 2 reads', async () => {
    const g = gatedGraph();
    follow(makeStore(), g.fetchImpl);
    const es = FakeEventSource.all[0]!;
    for (let i = 0; i < 20; i += 1) es.emit('graph:updated', updated(`s${i}`));
    await waitFor(() => expect(g.reads()).toBe(1));
    g.release();
    await waitFor(() => expect(g.reads()).toBe(2));
    g.release();
    await new Promise((r) => setTimeout(r, 30));
    expect(g.reads()).toBe(2);
  });

  it('waits for a scan that is running instead of landing on it, and never touches repo/scanning', async () => {
    const store = makeStore();
    store.dispatch({ type: 'repo/scanning', root: '/repo', repoName: 'repo', at: 1 });
    const held = store.getState().repo;
    const g = gatedGraph();
    follow(store, g.fetchImpl);
    FakeEventSource.all[0]!.emit('graph:updated', updated('B'));
    await new Promise((r) => setTimeout(r, 30));
    expect(g.reads()).toBe(0);
    expect(store.getState().repo).toBe(held);
    const scanned = twoPackages();
    store.dispatch({ type: 'repo/loaded', draft: { root: '/repo', repoName: 'repo', graph: scanned, summary: summarizeGraph(scanned), scannedAt: 'x' }, at: 2 });
    await waitFor(() => expect(g.reads()).toBe(1));
    g.release();
  });

  it('says why when the graph cannot be read, and leaves the board as it was', async () => {
    const store = makeStore();
    const before = store.getState().repo;
    follow(store, (async () => json({ error: 'x' }, 500)) as unknown as typeof fetch);
    FakeEventSource.all[0]!.emit('graph:updated', updated('B'));
    await waitFor(() => expect(store.getState().net.lastFailure?.message).toMatch(/could not follow the branch/));
    expect(store.getState().repo).toBe(before);
  });

  it('two followers of one store share one subscription', () => {
    const store = makeStore();
    const f = (async () => json({}, 404)) as unknown as typeof fetch;
    const a = followGitEvents(store, { fetchImpl: f });
    const b = followGitEvents(store, { fetchImpl: f });
    expect(FakeEventSource.all).toHaveLength(1);
    a();
    expect(FakeEventSource.all[0]!.closed).toBe(false);
    b();
    expect(FakeEventSource.all[0]!.closed).toBe(true);
  });
});


describe('BranchSwitcher', () => {
  function mount(handlers: Partial<Record<string, (req: Request | { body: string | null }) => Response>> = {}) {
    const calls: { path: string; body: string | null }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const body = typeof init?.body === 'string' ? init.body : null;
      calls.push({ path: url.pathname, body });
      const h = handlers[url.pathname];
      if (h) return h({ body });
      if (url.pathname === '/api/git/branches') return json(BRANCHES);
      if (url.pathname === '/api/git/switch') return json({ ok: true, branch: JSON.parse(body ?? '{}').branch, sha: 's', created: false, changed: true, previous: 'feature/refunds', rescan: true });
      if (url.pathname === '/api/scan') return json({ error: 'not in this test' }, 500);
      return json({ error: 'nf' }, 404);
    }) as unknown as typeof fetch;
    const store = makeStore();
    render(
      <StoreProvider store={store}>
        <BranchSwitcher fetchImpl={fetchImpl} />
      </StoreProvider>,
    );
    return { calls, store };
  }

  it('renders nothing when the engine has no branches route', async () => {
    const fetchImpl = (async () => json({ error: 'nf' }, 404)) as unknown as typeof fetch;
    render(
      <StoreProvider store={makeStore()}>
        <BranchSwitcher fetchImpl={fetchImpl} />
      </StoreProvider>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('branch-switcher')).toBeNull();
  });

  it('lists local branches with ahead/behind, subject and age, folds remotes, and filters', async () => {
    mount();
    fireEvent.click(await screen.findByTestId('branch-switcher-trigger'));
    const items = await screen.findAllByTestId('branch-switcher-item');
    expect(items.map((i) => i.getAttribute('data-branch'))).toEqual(['main', 'feature/refunds', 'other-branch']);
    expect(within(items[0]!).getByText('↓2')).toBeTruthy();
    expect(within(items[1]!).getByText('↑3')).toBeTruthy();
    expect(within(items[1]!).getByText('Add refunds')).toBeTruthy();
    expect(within(items[1]!).getByText(/min ago/)).toBeTruthy();
    expect(screen.queryByText('origin/hotfix')).toBeNull();
    fireEvent.click(screen.getByTestId('branch-switcher-remotes'));
    expect(screen.getByText('origin/hotfix')).toBeTruthy();
    fireEvent.change(screen.getByTestId('branch-switcher-filter'), { target: { value: 'oth' } });
    expect(screen.getAllByTestId('branch-switcher-item').map((i) => i.getAttribute('data-branch'))).toEqual(['other-branch']);
  });

  it('switches on click via POST /api/git/switch', async () => {
    const { calls } = mount();
    fireEvent.click(await screen.findByTestId('branch-switcher-trigger'));
    fireEvent.click((await screen.findAllByTestId('branch-switcher-item'))[0]!);
    await waitFor(() => expect(calls.some((c) => c.path === '/api/git/switch')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path === '/api/git/switch')!.body!)).toEqual({ branch: 'main' });
  });

  it('creates a new branch from the current one', async () => {
    const { calls } = mount();
    fireEvent.click(await screen.findByTestId('branch-switcher-trigger'));
    fireEvent.click(await screen.findByTestId('branch-switcher-new'));
    fireEvent.change(screen.getByTestId('branch-switcher-newname'), { target: { value: 'feature/x' } });
    fireEvent.click(screen.getByTestId('branch-switcher-create'));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/git/switch')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.path === '/api/git/switch')!.body!)).toEqual({ branch: 'feature/x', create: true, from: 'feature/refunds' });
  });

  it('explains a dirty-tree 409, lists the files, and offers no stash', async () => {
    mount({
      '/api/git/switch': () => json({ ok: false, reason: 'dirty', error: 'would overwrite', files: ['src/a.ts', 'src/b.ts'] }, 409),
    });
    fireEvent.click(await screen.findByTestId('branch-switcher-trigger'));
    fireEvent.click((await screen.findAllByTestId('branch-switcher-item'))[0]!);
    const note = await screen.findByTestId('branch-switcher-note');
    expect(note.textContent).toMatch(/uncommitted changes/i);
    expect(within(screen.getByTestId('branch-switcher-dirty-files')).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(screen.queryByText(/stash and switch/i)).toBeNull();
  });

  it('a git:head event refreshes the branch list; graph:updated re-reads the graph (no POST /api/scan)', async () => {
    const { calls } = mount();
    await screen.findByTestId('branch-switcher-trigger');
    const before = calls.filter((c) => c.path === '/api/git/branches').length;
    FakeEventSource.all[0]!.emit('git:head', { type: 'git:head', branch: 'main', sha: 's', detached: false, previous: { branch: 'feature/refunds', sha: 'x' }, rescan: true });
    await waitFor(() => expect(calls.filter((c) => c.path === '/api/git/branches').length).toBeGreaterThan(before));
    FakeEventSource.all[0]!.emit('graph:updated', { type: 'graph:updated', reason: 'git:head', branch: 'main', sha: 's' });
    await waitFor(() => expect(calls.some((c) => c.path === '/archgraph.json')).toBe(true));
    expect(calls.some((c) => c.path === '/api/scan')).toBe(false);
    expect(FakeEventSource.all).toHaveLength(1);
  });

  it('a successful switch re-reads the graph even if no event ever arrives', async () => {
    const { calls } = mount();
    fireEvent.click(await screen.findByTestId('branch-switcher-trigger'));
    fireEvent.click((await screen.findAllByTestId('branch-switcher-item'))[0]!);
    await waitFor(() => expect(calls.some((c) => c.path === '/archgraph.json')).toBe(true), { timeout: 4000 });
  });

  it('onSwitched fires once for a switch and its git:head event', async () => {
    const onSwitched = vi.fn();
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/git/branches') return json(BRANCHES);
      if (url.pathname === '/api/git/switch') return json({ ok: true, branch: 'main', sha: 's', created: false, changed: true, previous: 'x', rescan: true });
      return json({ error: 'nf' }, 404);
    }) as unknown as typeof fetch;
    render(
      <StoreProvider store={makeStore()}>
        <BranchSwitcher fetchImpl={fetchImpl} onSwitched={onSwitched} />
      </StoreProvider>,
    );
    fireEvent.click(await screen.findByTestId('branch-switcher-trigger'));
    fireEvent.click((await screen.findAllByTestId('branch-switcher-item'))[0]!);
    await waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(1));
    FakeEventSource.all[0]!.emit('git:head', { type: 'git:head', branch: 'main', sha: 's', detached: false, previous: { branch: 'x', sha: 'y' }, rescan: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(onSwitched).toHaveBeenCalledTimes(1);
  });

  it('the latest branch read wins when two overlap', async () => {
    const answers: ((v: Response) => void)[] = [];
    let n = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input) !== '/api/git/branches') return json({ error: 'nf' }, 404);
      n += 1;
      return new Promise<Response>((resolve) => answers.push(resolve));
    }) as unknown as typeof fetch;
    render(
      <StoreProvider store={makeStore()}>
        <BranchSwitcher fetchImpl={fetchImpl} />
      </StoreProvider>,
    );
    await waitFor(() => expect(n).toBe(1));
    FakeEventSource.all[0]!.emit('git:head', { type: 'git:head', branch: 'new', sha: 's', detached: false, previous: { branch: 'old', sha: 'x' }, rescan: false });
    await waitFor(() => expect(n).toBe(2));
    answers[1]!(json({ ...BRANCHES, current: 'new' }));
    await screen.findByText('new');
    answers[0]!(json({ ...BRANCHES, current: 'old' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('branch-switcher-trigger').textContent).toContain('new');
  });
});

describe('a switch and its own git:head (the engine emits the event BEFORE it answers)', () => {
  function mountHeld() {
    const onSwitched = vi.fn();
    let release: () => void = () => undefined;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/git/branches') return json(BRANCHES);
      if (url.pathname === '/api/git/switch') {
        await new Promise<void>((r) => (release = r));
        return json({ ok: true, branch: 'main', sha: 's1', created: false, changed: true, previous: 'x', rescan: false });
      }
      return json({ error: 'nf' }, 404);
    }) as unknown as typeof fetch;
    render(
      <StoreProvider store={makeStore()}>
        <BranchSwitcher fetchImpl={fetchImpl} onSwitched={onSwitched} />
      </StoreProvider>,
    );
    return { onSwitched, release: () => release() };
  }
  const head = (sha: string) => ({ type: 'git:head', branch: 'main', sha, detached: false, previous: { branch: 'x', sha: 'y' }, rescan: false });

  it('event first, then the 200: onSwitched fires once, and a later git:head on the same branch (new sha) still fires', async () => {
    const { onSwitched, release } = mountHeld();
    fireEvent.click(await screen.findByTestId('branch-switcher-trigger'));
    fireEvent.click((await screen.findAllByTestId('branch-switcher-item'))[0]!);
    await waitFor(() => expect(screen.getAllByTestId('branch-switcher-item').every((b) => (b as HTMLButtonElement).disabled)).toBe(true));
    FakeEventSource.all[0]!.emit('git:head', head('s1'));
    release();
    await waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(onSwitched).toHaveBeenCalledTimes(1);
    /* a real commit/switch on main afterwards is not swallowed */
    FakeEventSource.all[0]!.emit('git:head', head('s2'));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(2));
  });

  it('the 200 first, then its own event (same sha): once; the next event with a new sha fires', async () => {
    const { onSwitched, release } = mountHeld();
    fireEvent.click(await screen.findByTestId('branch-switcher-trigger'));
    fireEvent.click((await screen.findAllByTestId('branch-switcher-item'))[0]!);
    await waitFor(() => expect(screen.getAllByTestId('branch-switcher-item').every((b) => (b as HTMLButtonElement).disabled)).toBe(true));
    release();
    await waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(1));
    FakeEventSource.all[0]!.emit('git:head', head('s1'));
    await new Promise((r) => setTimeout(r, 20));
    expect(onSwitched).toHaveBeenCalledTimes(1);
    FakeEventSource.all[0]!.emit('git:head', head('s3'));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(2));
  });

  it('a refused switch clears the marker, so the next real git:head on that branch fires', async () => {
    const onSwitched = vi.fn();
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/git/branches') return json(BRANCHES);
      if (url.pathname === '/api/git/switch') return json({ ok: false, reason: 'dirty', error: 'dirty', files: ['a'] }, 409);
      return json({ error: 'nf' }, 404);
    }) as unknown as typeof fetch;
    render(
      <StoreProvider store={makeStore()}>
        <BranchSwitcher fetchImpl={fetchImpl} onSwitched={onSwitched} />
      </StoreProvider>,
    );
    fireEvent.click(await screen.findByTestId('branch-switcher-trigger'));
    fireEvent.click((await screen.findAllByTestId('branch-switcher-item'))[0]!);
    await screen.findByTestId('branch-switcher-note');
    FakeEventSource.all[0]!.emit('git:head', head('s9'));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledTimes(1));
  });
});

describe('after a switch with no event stream, the board waits for the rescan instead of reading the old graph', () => {
  const held = (store: ReturnType<typeof makeStore>) => (store.getState().repo as { repo: { scannedAt: string } }).repo.scannedAt;

  it('polls /archgraph.json until its scannedAt changes, then loads it once', async () => {
    const store = makeStore();
    const old = held(store);
    let reads = 0;
    const fetchImpl = (async () => {
      reads += 1;
      return json({ ...graphBody(), scannedAt: reads < 3 ? old : 'after-switch' });
    }) as unknown as typeof fetch;
    await reloadAfterSwitch(store, { fetchImpl }, { sleep: async () => undefined, intervalMs: 1, tries: 10 });
    expect(reads).toBe(3);
    expect(held(store)).toBe('after-switch');
  });

  it('with the event stream alive (graph:updated arrived) it does not poll at all', async () => {
    const store = makeStore();
    const reads = vi.fn(async () => json({ ...graphBody(), scannedAt: 'x' }));
    const stop = followGitEvents(store, { fetchImpl: reads as unknown as typeof fetch });
    FakeEventSource.all[0]!.emit('graph:updated', updated('B'));
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(1));
    await reloadAfterSwitch(store, { fetchImpl: reads as unknown as typeof fetch }, { sleep: async () => undefined, intervalMs: 1, tries: 10, since: Date.now() - 1000 });
    expect(reads).toHaveBeenCalledTimes(1);
    stop();
  });

  it('gives up quietly after its tries, leaving the board as it was', async () => {
    const store = makeStore();
    const before = store.getState().repo;
    const fetchImpl = (async () => json({ ...graphBody(), scannedAt: held(store) })) as unknown as typeof fetch;
    await reloadAfterSwitch(store, { fetchImpl }, { sleep: async () => undefined, intervalMs: 1, tries: 4 });
    expect(store.getState().repo).toBe(before);
  });
});

describe('relativeDate', () => {
  it('is short and total', () => {
    expect(relativeDate('2026-10-12T11:50:00Z', NOW)).toBe('10 min ago');
    expect(relativeDate('2026-10-10T12:00:00Z', NOW)).toBe('2 d ago');
    expect(relativeDate(undefined, NOW)).toBe('');
    expect(relativeDate('nonsense', NOW)).toBe('');
  });
});
