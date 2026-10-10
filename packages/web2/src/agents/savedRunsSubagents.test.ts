import { describe, expect, it } from 'vitest';

import { fromSavedRun } from './savedRuns';
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
