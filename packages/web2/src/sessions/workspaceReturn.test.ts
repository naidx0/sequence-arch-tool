import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetArchGraphResponse } from '@sequence/api-types';

import { summarizeGraph, type BootOutcome, type BootTransport } from '../boot';
import type { AgentRun } from '../agents/agentRuns';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore } from '../state';
import { resetSnapshotsForTest } from '../v3/sessionSnapshots';
import type { SessionsClient } from './sessionsClient';

/* THE REPORTED FLOW (e2e/cross-workspace.mjs): the analyzer names each root `realpathSync(path.resolve(dir))`, writes
   it to the recent list with `addRecent`, and the sidebar clicks back with that same string. A chat runs in each
   workspace; the reader goes A -> B -> A. Both sides spell a root identically here, as they do in that e2e: the
   spelling-only tests are in workspaceKey.test.ts. */

const A = '/tmp/seq-xws-Qx9/home/shopfront';
const B = '/tmp/seq-xws-Qx9/home/plainapp';
const platform = { reachable: true, detail: 'test', at: 1 };
const ok = <T,>(body: T) => ({ outcome: 'ok' as const, status: 200, body });

const draftFor = (root: string, name: string) => {
  const graph = { repoName: name, scannedAt: '2026-10-01T00:00:00.000Z', nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }], edges: [], nodeDetail: {} } as unknown as GetArchGraphResponse;
  return { root, repoName: name, graph, summary: summarizeGraph(graph), scannedAt: graph.scannedAt as string };
};

const run = (id: string, sessionId: string, over: Partial<AgentRun> = {}): AgentRun =>
  ({ id, sessionId, agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'p', status: 'running', startedAt: 1, endedAt: null, items: [], approvals: [], error: null, ...over }) as AgentRun;

function newStore() {
  return createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
}

/** Fakes for a switch to `to`; `engineRoot` is what GET /api/status answers while the page is not attached. */
function deps(store: ReturnType<typeof newStore>, to: string, opts: { engineRoot?: string; own?: string[]; repos?: { path: string; ids: string[] }[] } = {}) {
  const transport = {
    attach: vi.fn(async () => ok({})),
    detach: vi.fn(async () => ok({})),
    status: vi.fn(async () => ok(opts.engineRoot ? { attached: true, repoName: 'x', root: opts.engineRoot } : { attached: false })),
  } as unknown as BootTransport;
  const sessions = {
    activate: vi.fn(async () => ok({ index: {} })),
    list: vi.fn(async () => ({
      outcome: 'ok' as const,
      body: {
        index: { version: 1, activeId: 'x', sessions: [{ id: 'x', title: 'chat', createdAt: 'x', updatedAt: 'x' }, ...(opts.own ?? []).map((id) => ({ id, title: id, createdAt: 'x', updatedAt: 'x' }))] },
        scope: 'repo',
        repos: (opts.repos ?? []).map((r) => ({ path: r.path, name: 'r', index: { version: 1, activeId: r.ids[0], sessions: r.ids.map((id) => ({ id, title: id, createdAt: 'x', updatedAt: 'x' })) } })),
      },
    })),
    readSession: vi.fn(async (id: string) => ({ outcome: 'ok' as const, body: { chat: { version: 1, sessionId: id, turns: [] }, meta: {} } })),
  } as unknown as SessionsClient;
  const boot = vi.fn(async (): Promise<BootOutcome> => ({ kind: 'attached', repo: draftFor(to, to === A ? 'shopfront' : 'plainapp'), platform }));
  return { store, transport, sessions, boot, leave: vi.fn(async () => {}) };
}

/* Each test gets a page of its own: the run store partitions from the first switch on, for the life of the page. */
async function page() {
  vi.resetModules();
  const [{ agentRuns }, { workspaceKeyOf }, { switchWorkspaceInPlace }] = await Promise.all([import('../agents/agentRuns'), import('./workspaceEvents'), import('./workspaceSwitch')]);
  return { agentRuns, workspaceKeyOf, switchWorkspaceInPlace };
}

afterEach(() => {
  resetSnapshotsForTest();
  localStorage.clear();
});

describe('A -> B -> A, the reported flow', () => {
  it("A's run (session shared by id with B's) is on screen again on return, and B's run never showed in A", async () => {
    const { agentRuns, workspaceKeyOf, switchWorkspaceInPlace } = await page();
    const store = newStore();
    store.dispatch({ type: 'repo/loaded', draft: draftFor(A, 'shopfront'), at: 0 });
    agentRuns.patch((s) => ({ ...s, runs: [run('run-a', 'session-0001', { items: [{ kind: 'message', id: 'm', text: 'answering MCA' } as never] })] }));
    expect((await switchWorkspaceInPlace(deps(store, B), B, 'x')).outcome).toBe('ok');
    expect(agentRuns.get().runs).toHaveLength(0);
    agentRuns.patch((s) => ({ ...s, runs: [...s.runs, run('run-b', 'session-0001', { ws: workspaceKeyOf(B) })] }));
    expect(agentRuns.get().runs.map((r) => r.id)).toEqual(['run-b']);
    expect((await switchWorkspaceInPlace(deps(store, A), A, 'x')).outcome).toBe('ok');
    expect(agentRuns.get().runs.map((r) => r.id)).toEqual(['run-a']);
  });
});

describe("the first switch names the workspace being left from the ENGINE when the page does not know it yet", () => {
  for (const phase of ['unattached', 'failed'] as const) {
    it(`page phase ${phase}: a run sent in A is still A's after A -> B -> A`, async () => {
      const { agentRuns, switchWorkspaceInPlace } = await page();
      const store = newStore();
      if (phase === 'failed') store.dispatch({ type: 'boot/settled', outcome: { kind: 'hydrate-failed', platform, failure: { outcome: 'unreachable', message: 'no graph' } } as never });
      expect(store.getState().repo.phase).toBe(phase);
      /* a fresh page store: nothing has been switched yet, so the run store is not partitioned */
      agentRuns.patch((s) => ({ ...s, runs: [run(`run-a-${phase}`, 'session-0002')] }));
      expect((await switchWorkspaceInPlace(deps(store, B, { engineRoot: A }), B, 'x')).outcome).toBe('ok');
      expect(agentRuns.get().runs.map((r) => r.id)).not.toContain(`run-a-${phase}`);
      expect((await switchWorkspaceInPlace(deps(store, A), A, 'x')).outcome).toBe('ok');
      expect(agentRuns.get().runs.map((r) => r.id)).toContain(`run-a-${phase}`);
    });
  }
});

describe("a page that reloaded into B follows A's live turn too (the cross-workspace e2e)", () => {
  it("the first switch stamps each unstamped run with ITS workspace, so A's followed turn is on screen again after B -> A", async () => {
    const { agentRuns, switchWorkspaceInPlace } = await page();
    const store = newStore();
    store.dispatch({ type: 'repo/loaded', draft: draftFor(B, 'plainapp'), at: 0 });
    /* `followLiveTurns`: the server runs every workspace's turns, the page follows them all, none stamped yet */
    agentRuns.patch((s) => ({ ...s, runs: [run('saved-turn-a', 'session-A'), run('saved-turn-b', 'session-B')] }));
    expect((await switchWorkspaceInPlace(deps(store, A, { own: ['session-B'], repos: [{ path: A, ids: ['session-A'] }] }), A, 'session-A')).outcome).toBe('ok');
    expect(agentRuns.get().runs.map((r) => r.id)).toEqual(['saved-turn-a']);
    expect((await switchWorkspaceInPlace(deps(store, B, { own: ['session-A'], repos: [{ path: B, ids: ['session-B'] }] }), B, 'session-B')).outcome).toBe('ok');
    expect(agentRuns.get().runs.map((r) => r.id)).toEqual(['saved-turn-b']);
  });

  it('a live turn followed after a switch is stamped with the workspace its chat lives in, not the one shown', async () => {
    const { agentRuns, workspaceKeyOf } = await page();
    agentRuns.setWorkspace(workspaceKeyOf(A));
    agentRuns.setChatOwners(new Map([['session-B', workspaceKeyOf(B)]]));
    agentRuns.follow({ turnId: 'tb', chatId: 'session-B', agentRef: 'codex', prompt: 'p', startedAt: 1 }, (async () => new Response('', { status: 404 })) as never);
    expect(agentRuns.get().runs).toHaveLength(0);
    agentRuns.setWorkspace(workspaceKeyOf(B));
    expect(agentRuns.get().runs.map((r) => r.id)).toEqual(['saved-tb']);
  });
});

describe("the engine's canonicalRoot (realpath) on BOTH sides of the switch, a Windows spelling", () => {
  /* The analyzer reports `realpathSync(path.resolve(dir))` as `/api/status` `root` and writes the same string into the
     recent list the sidebar clicks back with. On Windows that is `C:\Users\...` with the case the disk holds. */
  const WA = 'C:\\Users\\Max\\Work\\ShopFront';
  const WB = 'C:\\Users\\Max\\Work\\PlainApp';
  for (const phase of ['unattached', 'failed'] as const) {
    it(`page phase ${phase}: the run sent in A (engine root ${WA}) is A's on return, and is not shown in B`, async () => {
      const { agentRuns, switchWorkspaceInPlace } = await page();
      const store = newStore();
      if (phase === 'failed') store.dispatch({ type: 'boot/settled', outcome: { kind: 'hydrate-failed', platform, failure: { outcome: 'unreachable', message: 'no graph' } } as never });
      expect(store.getState().repo.phase).toBe(phase);
      agentRuns.patch((s) => ({ ...s, runs: [run(`run-w-${phase}`, 'session-0003')] }));
      expect((await switchWorkspaceInPlace(deps(store, WB, { engineRoot: WA, repos: [{ path: WB, ids: ['session-B'] }] }), WB, 'session-B')).outcome).toBe('ok');
      expect(agentRuns.get().runs.map((r) => r.id)).not.toContain(`run-w-${phase}`);
      /* back, the sidebar clicking the recent-list spelling of A */
      expect((await switchWorkspaceInPlace(deps(store, WA, { engineRoot: WB }), WA, 'x')).outcome).toBe('ok');
      expect(agentRuns.get().runs.map((r) => r.id)).toContain(`run-w-${phase}`);
    });
  }
});
