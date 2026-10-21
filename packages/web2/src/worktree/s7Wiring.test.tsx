import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GetArchGraphResponse } from '@sequence/api-types';

import { AgentTree } from '../agents/AgentsPanel';
import { createAgentStore } from '../agents/agentStream';
import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import type { SessionsClient } from '../sessions/sessionsClient';
import { createStore, StoreProvider } from '../state';
import { V3SessionsRail } from '../v3/V3SessionsRail';
import MergePanel from './MergePanel';
import WorktreeSettings from './WorktreeSettings';
import type { ChatWorktree, DryRun } from './worktreeModel';

/*
 * S7 UI, wired at the S7 builder's places (all with the server answered by a
 * fetch stub; the server half is tested in the analyzer's temp-repo suite):
 *   - New Chat "In a worktree" (only with a repo attached): the chat is made,
 *     then its worktree; the server's error, or the setup command as text
 *   - the merge-back panel: dry run first; can merge → the files and
 *     "Merge into / Squash into <target>"; cannot → the one line and the
 *     conflicts, no merge button; Discard on unmerged work → 409 → the
 *     dialog names every commit, and only then confirms
 *   - the Agents tree grouped by worktree, "(merged)" where it applies; one
 *     group draws as before
 *   - settings: the limit (1-64) and the setup command, never run
 */

type Json = Record<string, unknown>;
/** How long a wait for the rail's async note may take on a loaded machine; a pass returns at once. */
const WAIT_MS = 8000;
let calls: { url: string; method: string; body: unknown }[] = [];
let answers: Record<string, () => Response> = {};

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  calls = [];
  answers = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      const a = answers[`${method} ${url}`];
      return a ? a() : new Promise<Response>(() => {});
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const WT: ChatWorktree = { id: 'ab12cd34', path: '/data/wt/ab12cd34', branch: 'sequence/fix-login-3fa2', baseCommit: 'abc', baseBranch: 'main', createdAt: '2026-10-06T08:00:00Z' };

const GRAPH = { repoName: 'shop', scannedAt: '2026-10-05T09:00:00.000Z', nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }], edges: [], nodeDetail: {} } as unknown as GetArchGraphResponse;

function railWithRepo() {
  const store = createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail) });
  const client = new Proxy(
    {
      list: () => Promise.resolve({ outcome: 'ok', body: { index: { version: 1, activeId: 's1', sessions: [] }, repos: [] } }),
      create: () => Promise.resolve({ outcome: 'ok', body: { session: { id: 'chat-new' }, index: { version: 1, activeId: 'chat-new', sessions: [{ id: 'chat-new', title: 'New chat', pinned: false, updatedAt: '2026-10-06' }] } } }),
    } as Record<string, unknown>,
    { get: (t, k) => (k in t ? t[k as string] : () => Promise.resolve({ outcome: 'error', message: 'n/a' })) },
  ) as unknown as SessionsClient;
  render(
    <StoreProvider store={store}>
      <V3SessionsRail client={client} />
    </StoreProvider>,
  );
  return store;
}

const attach = (store: ReturnType<typeof createStore>) =>
  act(() => {
    store.dispatch({
      type: 'boot/settled',
      outcome: { kind: 'attached', repo: { root: '/home/max/shop', repoName: 'shop', graph: GRAPH, summary: summarizeGraph(GRAPH), scannedAt: '2026-10-05T09:00:00.000Z' }, platform: { reachable: true, detail: 'ok', at: 1 } },
    } as never);
  });

describe('New Chat in a worktree (sessions rail)', () => {
  it('is offered only with a repo attached', () => {
    const store = railWithRepo();
    expect(screen.queryByTestId('v3-rail-new-worktree')).toBeNull();
    attach(store);
    expect(screen.getByTestId('v3-rail-new-worktree')).toBeTruthy();
  });

  it('on: the chat is made, then its worktree; a setup command is shown as text only', async () => {
    answers['POST /api/sessions/chat-new/worktree'] = json(200, { worktree: WT, setupCommand: 'pnpm install' });
    const store = railWithRepo();
    attach(store);
    fireEvent.click(screen.getByTestId('v3-rail-new-worktree'));
    await act(async () => {
      fireEvent.click(screen.getByText('New Chat'));
    });
    /* The note arrives after the chat is made and its worktree answered: two awaited requests, then a render. With the
       suite's 700 test files running in parallel that took longer than waitFor's default second (integration gates-3). */
    await waitFor(() => expect(screen.getByTestId('v3-rail-worktree-note').textContent).toContain('Run `pnpm install` in the worktree to install dependencies.'), { timeout: WAIT_MS });
    expect(calls.filter((c) => c.url.includes('/worktree')).map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/sessions/chat-new/worktree']);
    /* The chat's index entry carries the binding now (the chat header's chip reads it there; no request at boot). */
    expect((store.getState().session.sessions.find((s) => s.id === 'chat-new') as { worktree?: ChatWorktree }).worktree).toEqual(WT);
  });

  it("the server's refusal is the rail's error line; off makes no worktree", async () => {
    answers['POST /api/sessions/chat-new/worktree'] = json(409, { error: 'This repository is not a git repository.' });
    const store = railWithRepo();
    attach(store);
    await act(async () => {
      fireEvent.click(screen.getByText('New Chat'));
    });
    expect(calls.some((c) => c.url.includes('/worktree'))).toBe(false);
    fireEvent.click(screen.getByTestId('v3-rail-new-worktree'));
    await act(async () => {
      fireEvent.click(screen.getByText('New Chat'));
    });
    await waitFor(() => expect(screen.getByTestId('v3-rail-worktree-note').textContent).toContain('This repository is not a git repository.'), { timeout: WAIT_MS });
    expect(screen.getByTestId('v3-rail-worktree-note').getAttribute('data-kind')).toBe('error');
  });
});

const dry = (o: Partial<DryRun>): DryRun => ({ ok: true, target: 'main', targetHead: 'f00', files: [], conflicts: [], worktreeDirty: false, mainUncommitted: [], method: 'merge-tree', ...o });

describe('the merge-back panel', () => {
  it('can merge: the files, then "Merge into main" / "Squash into main"; a merge says what it did', async () => {
    answers['POST /api/sessions/s1/worktree/dry-run'] = json(200, dry({ files: [{ path: 'src/login.ts', status: 'modified' }, { path: 'src/new.ts', status: 'added' }] }));
    answers['POST /api/sessions/s1/worktree/merge'] = json(200, { mode: 'squash', into: 'main', commit: 'c0ffee', files: [{ path: 'src/login.ts', status: 'modified' }, { path: 'src/new.ts', status: 'added' }] });
    const changed = vi.fn();
    render(<MergePanel sessionId="s1" worktree={WT} onClose={() => {}} onChanged={changed} />);
    expect((await screen.findByTestId('worktree-summary')).textContent).toBe('2 files into main');
    expect(within(screen.getByTestId('worktree-files')).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['modified src/login.ts', 'added src/new.ts']);
    expect(screen.getByTestId('worktree-merge').textContent).toBe('Merge into main');
    fireEvent.click(screen.getByTestId('worktree-squash'));
    await waitFor(() => expect(screen.getByTestId('worktree-done').textContent).toBe('Squashed 2 files into main.'), { timeout: WAIT_MS });
    expect(calls.find((c) => c.url.endsWith('/merge'))!.body).toEqual({ mode: 'squash' });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('cannot: the one line and the conflicts, and no merge button', async () => {
    answers['POST /api/sessions/s1/worktree/dry-run'] = json(200, dry({ files: [{ path: 'src/login.ts', status: 'modified' }], conflicts: ['src/login.ts'] }));
    render(<MergePanel sessionId="s1" worktree={WT} onClose={() => {}} onChanged={() => {}} />);
    expect((await screen.findByTestId('worktree-cannot')).textContent).toBe('Merging into main would conflict in 1 file. Nothing was changed.');
    expect(within(screen.getByTestId('worktree-conflicts')).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['src/login.ts']);
    expect(screen.queryByTestId('worktree-merge')).toBeNull();
    expect(screen.queryByTestId('worktree-squash')).toBeNull();
  });

  it('Discard on unmerged work: 409, the dialog names every commit, and only then confirms with all of them', async () => {
    answers['POST /api/sessions/s1/worktree/dry-run'] = json(200, dry({}));
    let removals = 0;
    answers['DELETE /api/sessions/s1/worktree'] = () =>
      ++removals === 1 ? json(409, { unmerged: [{ sha: 'aaaaaaa1', subject: 'Fix login' }, { sha: 'bbbbbbb2', subject: 'Add test' }] })() : json(200, { deletedBranch: WT.branch })();
    const closed = vi.fn();
    render(<MergePanel sessionId="s1" worktree={WT} onClose={closed} onChanged={() => {}} />);
    fireEvent.click(await screen.findByTestId('worktree-discard'));
    const dialog = await screen.findByTestId('worktree-removal');
    expect(dialog.textContent).toContain('fix-login-3fa2 has 2 commits that your branch does not.');
    expect(within(dialog).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['aaaaaaa Fix login', 'bbbbbbb Add test']);
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.body)).toEqual([{ confirmUnmerged: [] }]);
    fireEvent.click(screen.getByTestId('worktree-removal-confirm'));
    await waitFor(() => expect(closed).toHaveBeenCalled(), { timeout: WAIT_MS });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.body)).toEqual([{ confirmUnmerged: [] }, { confirmUnmerged: ['aaaaaaa1', 'bbbbbbb2'] }]);
  });
});

describe('the Agents tree, grouped by worktree', () => {
  const events = (sessionId: string, at: number) => ({ id: `e-${sessionId}`, at, source: 'acp' as const, sessionId, kind: 'session_start' as const, paths: [], status: 'running' as const });
  const treeOf = (sessions: { id: string; title?: string; titleEdited?: boolean; worktree?: ChatWorktree | null }[], only?: string) => {
    const store = createAgentStore();
    act(() => {
      store.apply(events('chat-a', 1) as never);
      if (only !== 'chat-a') store.apply(events('chat-b', 2) as never);
    });
    return render(<AgentTree state={store.get()} now={10} store={store} sessions={sessions} />);
  };

  it('round 10: one group per chat, its worktree branch on the header, "(merged)" where it applies', () => {
    treeOf([{ id: 'chat-a', title: 'Alpha chat', titleEdited: true }, { id: 'chat-b', title: 'Beta chat', titleEdited: true, worktree: { ...WT, merged: { at: 'x', mode: 'merge', into: 'main', commit: 'c' } } }]);
    const groups = screen.getAllByTestId('agents-chat-group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Alpha chat', 'Beta chat']);
    for (const g of groups) expect(g.getAttribute('role')).toBe('group');
    expect(groups[1]!.querySelector('.ag-chat-branch')?.textContent).toBe('fix-login-3fa2 (merged)');
    expect(groups[0]!.querySelector('.ag-chat-branch')).toBeNull();
  });

  it('one chat draws as it always has (no group rows)', () => {
    treeOf([{ id: 'chat-a' }, { id: 'chat-b' }], 'chat-a');
    expect(screen.queryByTestId('agents-chat-group')).toBeNull();
    expect(screen.getByTestId('agents-tree')).toBeTruthy();
  });
});

describe('worktree settings', () => {
  it('the limit (1 to 64) and the setup command, the suggestion as placeholder, never run', async () => {
    answers['GET /api/worktree-settings'] = json(200, { cap: 8, setupCommand: null, suggestion: 'pnpm install' });
    answers['PUT /api/worktree-settings'] = json(200, { cap: 12, setupCommand: null, suggestion: 'pnpm install' });
    render(<WorktreeSettings />);
    const cap = (await screen.findByTestId('settings-worktree-cap')) as HTMLInputElement;
    await waitFor(() => expect(cap.value).toBe('8'), { timeout: WAIT_MS });
    expect((screen.getByTestId('settings-worktree-setup') as HTMLInputElement).placeholder).toBe('pnpm install');
    expect(screen.getByTestId('settings-worktree-note').textContent).toBe('Sequence shows this command; it never runs it.');
    fireEvent.change(cap, { target: { value: '65' } });
    fireEvent.blur(cap);
    expect(screen.getByTestId('settings-worktree-note').textContent).toBe('The limit is a whole number from 1 to 64.');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    fireEvent.change(cap, { target: { value: '12' } });
    await act(async () => {
      fireEvent.blur(cap);
    });
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ cap: 12 } as Json);
  });
});
