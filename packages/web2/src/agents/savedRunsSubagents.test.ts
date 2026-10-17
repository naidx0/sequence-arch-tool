import { describe, expect, it } from 'vitest';

import { fromSavedRun, withTurnLogs } from './savedRuns';
import { subagentsOf } from './subagents';

describe('saved runs keep subagents, parents and step times', () => {
  const base = { id: 'a', agentRef: 'claude', prompt: 'p', text: 'done', status: 'done', startedAt: 1_000, endedAt: 9_000, model: null, nodeId: null };

  it('restores the subagent link, the parent and each step time', () => {
    const run = fromSavedRun(
      {
        ...base,
        tools: [
          { id: 'task', title: 'Task', toolKind: 'other', status: 'done', subagent: 'Explore: find auth', startedAt: 1_100, endedAt: 6_100 },
          { id: 'read', title: 'Read a.ts', toolKind: 'read', status: 'done', parentId: 'task', startedAt: 1_200, endedAt: 2_400 },
        ],
      },
      'chat',
    )!;
    const [task, read] = run.items;
    expect(task).toMatchObject({ subagent: 'Explore: find auth', startedAt: 1_100, endedAt: 6_100 });
    expect(read).toMatchObject({ parentId: 'task', startedAt: 1_200, endedAt: 2_400 });
    expect(subagentsOf([run], 'chat')).toMatchObject([{ name: 'Explore', description: 'find auth', toolId: 'task' }]);
  });

  it('an old record without those fields still restores, with the turn span', () => {
    const run = fromSavedRun({ ...base, tools: [{ id: 'r', title: 'Read x', toolKind: 'read', status: 'done' }] }, 'chat')!;
    expect(run.items[0]).toMatchObject({ startedAt: 1_000, endedAt: 9_000 });
    expect(run.items[0]).not.toHaveProperty('subagent');
    expect(run.items[0]).not.toHaveProperty('parentId');
  });
});

describe('saved runs keep what they read', () => {
  const base = { id: 'a', agentRef: 'claude', prompt: 'p', text: 'done', status: 'done', startedAt: 1_000, endedAt: 9_000, model: null, nodeId: null, tools: [] };
  it('restores readPaths, and an old record has none', () => {
    expect(fromSavedRun({ ...base, readPaths: ['orders/a.ts', 3] }, 'chat')!.readPaths).toEqual(['orders/a.ts']);
    expect(fromSavedRun(base, 'chat')!.readPaths).toBeUndefined();
  });
});

describe('a reloaded turn reads the way the live one did', () => {
  const base = { id: 'a', agentRef: 'codex', prompt: 'WRITE it', status: 'done', startedAt: 1_000, endedAt: 9_000, model: null, nodeId: null };

  it('puts each call back between the prose before it and the prose after it', () => {
    const run = fromSavedRun({ ...base, text: 'I will create it. Created it.', tools: [{ id: 'e', title: 'Edit a.txt', toolKind: 'edit', status: 'done', at: 'I will create it. '.length }] }, 'chat')!;
    expect(run.items.map((i) => i.kind)).toEqual(['message', 'tool', 'message']);
    expect((run.items[0] as { text: string }).text).toBe('I will create it. ');
    expect((run.items[2] as { text: string }).text).toBe('Created it.');
    expect(new Set(run.items.map((i) => i.id)).size).toBe(3);
  });

  it('keeps every call and every word when the offsets are odd (out of range, equal, backwards)', () => {
    const run = fromSavedRun({ ...base, text: 'abcdef', tools: [{ id: 't1', title: 'a', toolKind: 'read', status: 'done', at: 3 }, { id: 't2', title: 'b', toolKind: 'read', status: 'done', at: 3 }, { id: 't3', title: 'c', toolKind: 'read', status: 'done', at: 1 }, { id: 't4', title: 'd', toolKind: 'read', status: 'done', at: 99 }] }, 'chat')!;
    expect(run.items.filter((i) => i.kind === 'tool').map((i) => i.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(run.items.filter((i) => i.kind === 'message').map((i) => (i as { text: string }).text).join('')).toBe('abcdef');
  });

  it('a record without offsets keeps its old shape: calls, then the text', () => {
    const run = fromSavedRun({ ...base, text: 'done', tools: [{ id: 'r', title: 'Read x', toolKind: 'read', status: 'done' }] }, 'chat')!;
    expect(run.items.map((i) => i.kind)).toEqual(['tool', 'message']);
  });

  it('an ended turn gets its log back, so "Turn details" survives a reload', () => {
    const run = fromSavedRun({ ...base, text: 'x', tools: [] }, 'chat')!;
    const log = { turnId: 'a', outcome: 'ended', ms: 1000, tools: 1 };
    expect(withTurnLogs([run], new Map([['a', log]]))[0]!.log).toEqual(log);
    expect(withTurnLogs([run], new Map())[0]!.log).toBeUndefined();
  });
});

describe('saved runs keep the words the person steered in', () => {
  const base = { id: 'a', agentRef: 'codex', prompt: 'p', text: 'first part. second part.', status: 'done', startedAt: 1_000, endedAt: 9_000, model: null, nodeId: null };
  const tool = (id: string, startedAt: number) => ({ id, title: id, toolKind: 'read', status: 'done', startedAt, endedAt: startedAt + 100 });

  it('draws each steer where it was sent, in order, after the step that was running', () => {
    const run = fromSavedRun(
      { ...base, tools: [tool('t1', 1_100), tool('t2', 4_000)], steers: [{ text: 'second steer', at: 5_000 }, { text: 'first steer', at: 2_000 }] },
      'chat',
    )!;
    const shape = run.items.map((i) => (i.kind === 'steer' ? `steer:${i.text}` : i.kind === 'tool' ? `tool:${i.id}` : i.kind));
    expect(shape).toEqual(['tool:t1', 'steer:first steer', 'tool:t2', 'steer:second steer', 'message']);
    expect(run.items.filter((i) => i.kind === 'steer').map((i) => (i as { at: number }).at)).toEqual([2_000, 5_000]);
  });

  it('a steer before any step comes first, and an old record has none', () => {
    const early = fromSavedRun({ ...base, tools: [tool('t1', 3_000)], steers: [{ text: 'early', at: 1_500 }] }, 'chat')!;
    expect(early.items[0]).toMatchObject({ kind: 'steer', text: 'early' });
    expect(fromSavedRun({ ...base, tools: [tool('t1', 3_000)] }, 'chat')!.items.some((i) => i.kind === 'steer')).toBe(false);
    expect(fromSavedRun({ ...base, tools: [], steers: [{ text: 5 }, { text: '   ', at: 3 }, 'x'] }, 'chat')!.items.some((i) => i.kind === 'steer')).toBe(false);
  });
});
