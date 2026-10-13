import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GetArchGraphResponse } from '@sequence/api-types';

import { summarizeGraph, type BootOutcome, type BootTransport } from '../boot';
import { agentRuns, createAgentRunStore } from '../agents/agentRuns';
import { seqdFromGraph } from '../canvas/seqdFromGraph';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore } from '../state';
import { EMPTY_CANVAS } from '../state/initial';
import type { Turn } from '../state/types';
import { rememberRead, getSnapshot, resetSnapshotsForTest } from '../v3/sessionSnapshots';
import type { SessionsClient } from './sessionsClient';
import { IN_PLACE_FLAG, inPlaceSwitchEnabled, onWorkspaceSwitched, switchWorkspaceInPlace } from './workspaceSwitch';

const createAgentRunStoreForTest = () => createAgentRunStore({});

/* Opening a chat in another workspace without reloading the page (plan P14). */

const graphFor = (name: string) =>
  ({ repoName: name, scannedAt: '2026-10-01T00:00:00.000Z', nodes: [{ id: 'svc:api', label: 'api', kind: 'service', file: 'src/api.ts', line: 1 }], edges: [], nodeDetail: {} }) as unknown as GetArchGraphResponse;
const draftFor = (root: string, name: string) => {
  const graph = graphFor(name);
  return { root, repoName: name, graph, summary: summarizeGraph(graph), scannedAt: graph.scannedAt as string };
};
const platform = { reachable: true, detail: 'test', at: 1 };
const ok = <T,>(body: T) => ({ outcome: 'ok' as const, status: 200, body });

function newStore() {
  return createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });
}

function fakes(opts: { attachFails?: boolean; bootFails?: boolean } = {}) {
  const log: string[] = [];
  const transport = {
    attach: vi.fn(async (p: string) => {
      log.push(`attach ${p}`);
      return opts.attachFails ? { outcome: 'error' as const, status: 400, body: { error: 'nope' } } : ok({});
    }),
    detach: vi.fn(async () => {
      log.push('detach');
      return ok({});
    }),
  } as unknown as BootTransport;
  const sessions = {
    activate: vi.fn(async (id: string) => {
      log.push(`activate ${id}`);
      return ok({ index: {} });
    }),
    list: vi.fn(async () => {
      log.push('list');
      return { outcome: 'ok' as const, body: { index: { version: 1, activeId: 'b1', sessions: [{ id: 'b1', title: 'B chat', createdAt: 'x', updatedAt: 'x' }] }, scope: 'repo', repos: [] } };
    }),
    readSession: vi.fn(async (id: string) => {
      log.push(`read ${id}`);
      return { outcome: 'ok' as const, body: { chat: { version: 1, sessionId: id, turns: [{ role: 'user', text: 'hello from B', at: '2026-10-01T00:00:00.000Z' }] }, meta: {} } };
    }),
  } as unknown as SessionsClient;
  const boot = vi.fn(async (): Promise<BootOutcome> => {
    log.push('boot');
    if (opts.bootFails) throw new Error('boom');
    return { kind: 'attached', repo: draftFor('/work/b', 'b'), platform };
  });
  return {
    transport,
    sessions,
    boot,
    log,
    leave: vi.fn(async () => {
      log.push('leave');
    }),
  };
}

function storeOnA() {
  const store = newStore();
  store.dispatch({ type: 'repo/loaded', draft: draftFor('/work/a', 'a'), at: 0 });
  store.dispatch({ type: 'session/hydrated', turns: [{ id: 't1', role: 'user', text: 'about A', chips: [], at: 1 } as unknown as Turn] });
  return store;
}

afterEach(() => {
  resetSnapshotsForTest();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('workspace/switch (the reducer)', () => {
  it('resets the repo-scoped slices, keeps the shell and the composer, and keeps the old graph as `previous`', () => {
    const store = storeOnA();
    const before = store.getState();
    store.dispatch({ type: 'workspace/switch', root: '/work/b', at: 5 });
    const s = store.getState();
    expect(s.repo.phase).toBe('scanning');
    expect(s.repo.phase === 'scanning' && s.repo.root).toBe('/work/b');
    expect(s.repo.phase === 'scanning' && s.repo.previous?.root).toBe('/work/a');
    expect(s.session.turns).toHaveLength(0);
    expect(s.session.hydrating).toBe(true);
    expect(s.canvas).toBe(EMPTY_CANVAS);
    expect(s.shell).toBe(before.shell);
    expect(s.composer).toBe(before.composer);
  });

  it('the home workspace is attached to nothing', () => {
    const store = storeOnA();
    store.dispatch({ type: 'workspace/switch', root: null, at: 5 });
    expect(store.getState().repo.phase).toBe('unattached');
  });
});

describe('switchWorkspaceInPlace', () => {
  it('lands on the other workspace and its chat, in order, keeps the page-held run store, and drops the held snapshots', async () => {
    const f = fakes();
    const store = storeOnA();
    rememberRead('b1', { chat: { version: 1, sessionId: 'b1', turns: [{ role: 'user', text: 'STALE from workspace A', at: 'x' }] } } as never, [], true);
    expect(getSnapshot('b1')).toBeDefined();
    const runsBefore = agentRuns.get().runs;
    const heard: unknown[] = [];
    const off = onWorkspaceSwitched((to) => heard.push(to));
    const r = await switchWorkspaceInPlace({ store, transport: f.transport, sessions: f.sessions, leave: f.leave, boot: f.boot }, '/work/b', 'b1');
    off();
    expect(r).toEqual({ outcome: 'ok' });
    expect(f.log).toEqual(['leave', 'attach /work/b', 'activate b1', 'boot', 'list', 'read b1']);
    const s = store.getState();
    expect(s.repo.phase).toBe('attached');
    expect(s.repo.phase === 'attached' && s.repo.repo.root).toBe('/work/b');
    expect(s.session.activeId).toBe('b1');
    expect(s.session.turns.map((t) => t.text)).toEqual(['hello from B']);
    expect(agentRuns.get().runs).toEqual(runsBefore);
    expect(heard).toEqual([{ root: '/work/b', sessionId: 'b1' }]);
  });

  it('a folder that will not attach is refused with its message and nothing moves', async () => {
    const f = fakes({ attachFails: true });
    const store = storeOnA();
    const r = await switchWorkspaceInPlace({ store, transport: f.transport, sessions: f.sessions, leave: f.leave, boot: f.boot }, '/work/b', 'b1');
    expect(r).toEqual({ outcome: 'refused', message: 'nope' });
    expect(f.boot).not.toHaveBeenCalled();
    expect(store.getState().repo.phase).toBe('attached');
    expect(store.getState().session.turns).toHaveLength(1);
  });

  it('a boot that throws after the attach says reload, so the caller falls back to the old path', async () => {
    const f = fakes({ bootFails: true });
    const r = await switchWorkspaceInPlace({ store: storeOnA(), transport: f.transport, sessions: f.sessions, leave: f.leave, boot: f.boot }, '/work/b', 'b1');
    expect(r).toEqual({ outcome: 'reload' });
  });

  it('home workspace: detaches instead of attaching', async () => {
    const f = fakes();
    f.boot.mockImplementation(async () => ({ kind: 'unattached', platform }) as BootOutcome);
    const store = storeOnA();
    const r = await switchWorkspaceInPlace({ store, transport: f.transport, sessions: f.sessions, leave: f.leave, boot: f.boot }, null, 'b1');
    expect(r).toEqual({ outcome: 'ok' });
    expect(f.log.slice(0, 3)).toEqual(['leave', 'detach', 'activate b1']);
    expect(store.getState().repo.phase).toBe('unattached');
  });
});

describe('the flag', () => {
  it('is on by default and off with seq.inPlaceSwitch=0', () => {
    expect(inPlaceSwitchEnabled()).toBe(true);
    localStorage.setItem(IN_PLACE_FLAG, '0');
    expect(inPlaceSwitchEnabled()).toBe(false);
  });
});


describe('the run store is partitioned by workspace', () => {
  it('a run keeps streaming while another workspace is shown, is hidden there, and is back on return; ids cannot meet', () => {
    const store = createAgentRunStoreForTest();
    store.setWorkspace('/work/a');
    const run = (id: string, ws: string) => ({ id, sessionId: 'session-0001', agentRef: null, nodeId: null, nodeLabel: null, prompt: 'p', status: 'running', startedAt: 1, endedAt: null, items: [], approvals: [], error: null, ws });
    store.patch((s) => ({ ...s, runs: [...s.runs, run('r-a', '/work/a') as never, run('r-b', '/work/b') as never] }));
    expect(store.get().runs.map((r) => r.id)).toEqual(['r-a']);
    store.setWorkspace('/work/b', '/work/a');
    expect(store.get().runs.map((r) => r.id)).toEqual(['r-b']);
    store.setWorkspace('/work/a');
    expect(store.get().runs.map((r) => r.id)).toEqual(['r-a']);
  });

  it('Edit from here in B counts only B runs of a chat id both workspaces use, and never removes A runs', () => {
    const store = createAgentRunStoreForTest();
    const run = (id: string, ws: string) => ({ id, sessionId: 'session-0042', agentRef: null, nodeId: null, nodeLabel: null, prompt: 'p', status: 'done', startedAt: 1, endedAt: 2, items: [], approvals: [], error: null, ws }) as never;
    store.setWorkspace('/work/b', '/work/a');
    store.patch((s) => ({ ...s, runs: [run('a1', '/work/a'), run('a2', '/work/a'), run('b1', '/work/b')] }));
    expect(store.truncateFrom('b1')?.keep).toBe(0);
    expect(store.truncateFrom('a1')).toBeNull(); /* another workspace's run is not reachable from here */
    store.setWorkspace('/work/a');
    expect(store.get().runs.map((r) => r.id)).toEqual(['a1', 'a2']);
  });

  it('runs made before the first switch belong to the workspace being left', () => {
    const store = createAgentRunStoreForTest();
    store.patch((s) => ({ ...s, runs: [{ id: 'old', sessionId: 'session-0001', agentRef: null, nodeId: null, nodeLabel: null, prompt: 'p', status: 'done', startedAt: 1, endedAt: 2, items: [], approvals: [], error: null } as never] }));
    expect(store.get().runs).toHaveLength(1);
    store.setWorkspace('/work/b', '/work/a');
    expect(store.get().runs).toHaveLength(0);
    store.setWorkspace('/work/a');
    expect(store.get().runs.map((r) => r.id)).toEqual(['old']);
  });
});

describe('page-held streams re-point on a switch', () => {
  it('the boards stream, the git stream and the agent stream each reopen', async () => {
    const { announceWorkspaceSwitched } = await import('./workspaceEvents');
    const { createAgentStore } = await import('../agents/agentStream');
    const opened: string[] = [];
    const fake = () => ({ onmessage: null, onopen: null, onerror: null, close: () => opened.push('closed') });
    const agents = createAgentStore((u) => {
      opened.push(`open ${u}`);
      return fake();
    });
    const off = agents.subscribe(() => undefined);
    expect(opened).toEqual(['open /api/agent-events']);
    agents.reconnect();
    expect(opened).toEqual(['open /api/agent-events', 'closed', 'open /api/agent-events']);
    off();
    const { onGitEvent, resetGitEvents } = await import('../git/gitEvents');
    const heard: string[] = [];
    const stopGit = onGitEvent((e) => heard.push(e.type));
    announceWorkspaceSwitched({ root: '/x', sessionId: 's' });
    expect(heard).toEqual(['graph:updated']);
    stopGit();
    resetGitEvents();
  });
});
