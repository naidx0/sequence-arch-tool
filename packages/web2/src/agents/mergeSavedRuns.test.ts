import { describe, expect, it, vi } from 'vitest';

import { createAgentRunStore, type AgentRun } from './agentRuns';
import { fromSavedRun } from './savedRuns';
import { mergeSavedRuns } from './mergeSavedRuns';

const saved = (id: string, extra: Record<string, unknown> = {}): AgentRun =>
  fromSavedRun({ id, prompt: `Goal run: ${id}`, text: `did ${id}`, status: 'done', startedAt: 1, endedAt: 2, agentRef: 'mock', ...extra }, 'c1')!;

describe('mergeSavedRuns', () => {
  it('adds the turns the page does not hold at the END, in order, and nothing twice', () => {
    const store = createAgentRunStore();
    mergeSavedRuns(store, 'c1', [saved('t1'), saved('t2')]);
    mergeSavedRuns(store, 'c1', [saved('t1'), saved('t2'), saved('t3')]);
    expect(store.get().runs.map((r) => r.prompt)).toEqual(['Goal run: t1', 'Goal run: t2', 'Goal run: t3']);
    expect(store.get().runs.every((r) => r.sessionId === 'c1' && r.restored)).toBe(true);
  });

  it('leaves a turn this page streams itself alone (same turn id)', () => {
    const store = createAgentRunStore();
    store.patch((s) => ({ ...s, runs: [{ ...saved('t1'), id: 'live-1', turnId: 't1', restored: false }] }));
    mergeSavedRuns(store, 'c1', [saved('t1')]);
    expect(store.get().runs).toHaveLength(1);
  });

  it('follows a turn the server is still running, once, so its words stream', () => {
    const store = createAgentRunStore();
    const follow = vi.spyOn(store, 'follow').mockImplementation(() => {});
    mergeSavedRuns(store, 'c1', [saved('t1', { status: 'running', endedAt: 0 })]);
    mergeSavedRuns(store, 'c1', [saved('t1', { status: 'running', endedAt: 0 })]);
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow.mock.calls[0]![0]).toMatchObject({ turnId: 't1', chatId: 'c1', agentRef: 'mock' });
  });

  it('replaces a restored running turn with its final record once the server says it ended', () => {
    const store = createAgentRunStore();
    vi.spyOn(store, 'follow').mockImplementation(() => {});
    mergeSavedRuns(store, 'c1', [saved('t1', { status: 'running', endedAt: 0 })]);
    expect(store.get().runs[0]!.status).toBe('running');
    mergeSavedRuns(store, 'c1', [saved('t1')]);
    expect(store.get().runs).toHaveLength(1);
    expect(store.get().runs[0]!.status).toBe('done');
  });
});
