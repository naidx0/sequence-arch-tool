import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { agentRuns, createAgentRunStore } from '../agents/agentRuns';
import { useOtherWorkspaceRunMarks } from '../agents/railRuns';
import { HOME_WORKSPACE_KEY, normalizeWorkspacePath, workspaceKeyOf } from './workspaceEvents';

const createAgentRunStoreForTest = () => createAgentRunStore({});

/* The reported shape: a chat in each of two workspaces, A -> B -> A. The engine names the root one way when the page
   boots into it, the sidebar names it another way when the reader clicks back, and the run store must call both the
   same workspace. Before: stamped with 'C:\Work\App\', looked up as 'c:/work/app', the runs of A were hidden on return. */
const run = (id: string, sessionId: string, status: 'running' | 'done', ws?: string) =>
  ({ id, sessionId, agentRef: null, nodeId: null, nodeLabel: null, prompt: 'p', status, startedAt: 1, endedAt: status === 'done' ? 2 : null, items: [], approvals: [], error: null, ws }) as never;

describe('one canonical workspace key', () => {
  it('spells the same folder one way', () => {
    const a = workspaceKeyOf('C:\\Work\\App\\');
    for (const spelling of ['c:/work/app', 'C:/Work/App/', 'c:\\work\\app', 'C:\\Work\\\\App', '  C:/Work/App  ']) expect(workspaceKeyOf(spelling)).toBe(a);
    expect(workspaceKeyOf('/home/me/app/')).toBe(workspaceKeyOf('/home/me/app'));
    expect(workspaceKeyOf('\\\\SRV\\Share\\x\\')).toBe(workspaceKeyOf('//srv/share/x'));
    expect(workspaceKeyOf('/')).toBe('/');
    expect(normalizeWorkspacePath('//srv/share/x/')).toBe('//srv/share/x');
  });

  it('keeps the case of a POSIX path: two folders that differ only by case stay two workspaces', () => {
    expect(workspaceKeyOf('/srv/App')).not.toBe(workspaceKeyOf('/srv/app'));
    expect(workspaceKeyOf('/Users/Me/App/')).toBe('/Users/Me/App');
    expect(workspaceKeyOf(null)).toBe(HOME_WORKSPACE_KEY);
  });

  it('folds case for a Windows path only: a drive-letter or UNC spelling folds, the same letters under a POSIX root do not', () => {
    expect(workspaceKeyOf('C:\\Work\\App')).toBe(workspaceKeyOf('c:/WORK/app'));
    expect(workspaceKeyOf('\\\\SRV\\Share')).toBe(workspaceKeyOf('//srv/share'));
    expect(workspaceKeyOf('/c:/Work/App')).not.toBe(workspaceKeyOf('/c:/work/app'));
    expect(workspaceKeyOf('/home/Max/App')).not.toBe(workspaceKeyOf('/home/max/app'));
  });
});

describe('A -> B -> A with differently spelled paths', () => {
  const spellings: [string, string, string][] = [
    ['Windows drive, trailing slash', 'C:\\Work\\App\\', 'c:/work/app'],
    ['trailing slash', '/home/me/app', '/home/me/app/'],
    ['doubled slash', '/home/me//app', '/home/me/app'],
    ['Windows case', 'D:\\Repos\\Shop', 'd:/repos/shop/'],
  ];
  for (const [name, engineRoot, sidebarPath] of spellings) {
    it(`${name}: A's chat is still there on return`, () => {
      const store = createAgentRunStoreForTest();
      /* a run made before any switch: stamped by the switch with the root the engine reported */
      store.patch((s) => ({ ...s, runs: [run('a-old', 'session-0001', 'done')] }));
      store.setWorkspace(workspaceKeyOf('/work/b'), workspaceKeyOf(engineRoot));
      store.patch((s) => ({ ...s, runs: [...s.runs, run('b1', 'session-0001', 'running', workspaceKeyOf('/work/b'))] }));
      expect(store.get().runs.map((r) => r.id)).toEqual(['b1']);
      /* back: the key comes from the sidebar's spelling */
      store.setWorkspace(workspaceKeyOf(sidebarPath), workspaceKeyOf('/work/b'));
      expect(store.get().runs.map((r) => r.id)).toEqual(['a-old']);
    });
  }

  it('the store itself folds raw spellings, whoever calls it', () => {
    const store = createAgentRunStoreForTest();
    store.patch((s) => ({ ...s, runs: [run('a-old', 'session-0001', 'done')] }));
    store.setWorkspace('/work/b', 'C:\\Work\\App\\');
    store.setWorkspace('c:/work/app/');
    expect(store.get().runs.map((r) => r.id)).toEqual(['a-old']);
  });
});

describe("the sidebar keeps saying the other workspace's chat is running", () => {
  it("a running run of the workspace not shown marks its row, under that workspace's key only", () => {
    const keepRuns = agentRuns.everyRun().runs;
    agentRuns.setWorkspace(workspaceKeyOf('C:\\Work\\App\\'));
    agentRuns.patch((s) => ({ ...s, runs: [run('b-run', 'session-0042', 'running', workspaceKeyOf('/work/b')), run('a-run', 'session-0042', 'running', workspaceKeyOf('c:/work/app'))] }));
    const { result } = renderHook(() => useOtherWorkspaceRunMarks());
    expect(result.current[workspaceKeyOf('/work/b')]).toEqual({ 'session-0042': 'running' });
    expect(result.current[workspaceKeyOf('C:/Work/App')]).toBeUndefined(); /* the shown workspace has its own marks */
    act(() => agentRuns.setWorkspace(workspaceKeyOf('/work/b'), workspaceKeyOf('c:/work/app/')));
    expect(result.current[workspaceKeyOf('C:/Work/App/')]).toEqual({ 'session-0042': 'running' });
    expect(result.current[workspaceKeyOf('/work/b')]).toBeUndefined();
    agentRuns.patch((s) => ({ ...s, runs: [...keepRuns] }));
  });
});
