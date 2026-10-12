import { describe, expect, it } from 'vitest';

import { activeAgentModel } from './activeModel';
import { agentActivity } from './agentActivity';
import { createAgentRunStore, type AgentCaps, type AgentRun } from './agentRuns';
import { chatPick, forgetChat, setChatPick } from './chatConfig';

/* Owner: "when you come back into a chat, the model isn't ... really there."
   Each chat keeps its own agent, model and effort. */

const caps = (...ids: string[]): AgentCaps => ({ models: ids.map((id, i) => ({ id, name: id.toUpperCase(), efforts: [], isDefault: i === 0 })), efforts: [], commands: [], skills: [] });
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const modelOf = (store: ReturnType<typeof createAgentRunStore>, agent: string, sid: string) => activeAgentModel(store.get(), agent, sid);
/* What ModelMenu does on a model row: the agent and the model, in one patch. */
const pickInMenu = (store: ReturnType<typeof createAgentRunStore>, sid: string, agent: string, model: string) =>
  store.patch((s) => {
    const next = setChatPick({ ...s, agents: { ...s.agents, [sid]: agent } }, sid, { model });
    return { ...next, config: { ...s.config, [agent]: { ...s.config?.[agent], model } } };
  });
/* What ModelMenu does on an effort pill. */
const pickEffortInMenu = (store: ReturnType<typeof createAgentRunStore>, sid: string, agent: string, effort: string) =>
  store.patch((s) => ({ ...setChatPick(s, sid, { effort }), config: { ...s.config, [agent]: { ...s.config?.[agent], effort } } }));

describe('a chat remembers its own model', () => {
  it('(a) Sonnet picked in A stays in A: B is not Sonnet, and A is Sonnet again on return', () => {
    const store = createAgentRunStore();
    store.patch((s) => ({ ...s, caps: { claude: caps('opus', 'sonnet') } }));
    pickInMenu(store, 'A', 'claude', 'sonnet');
    store.patch((s) => ({ ...s, agents: { ...s.agents, B: 'claude' } }));
    expect(modelOf(store, 'claude', 'B')).toMatchObject({ id: 'opus', source: 'default' });
    expect(modelOf(store, 'claude', 'A')).toMatchObject({ id: 'sonnet', source: 'chosen' });
    pickInMenu(store, 'B', 'claude', 'opus');
    expect(modelOf(store, 'claude', 'A').id).toBe('sonnet');
  });

  it('(a) store only: with helpers that write the chat pick, A and B holding the same pick each keep their own (the menu itself is locked in shell2/chatModelPickUi.test.tsx)', () => {
    const store = createAgentRunStore();
    store.patch((s) => ({ ...s, caps: { claude: caps('opus', 'sonnet') } }));
    pickInMenu(store, 'A', 'claude', 'sonnet');
    pickEffortInMenu(store, 'A', 'claude', 'high');
    store.patch((s) => ({ ...s, agents: { ...s.agents, B: 'claude' } }));
    expect(modelOf(store, 'claude', 'B').id).toBe('opus');
    pickInMenu(store, 'B', 'claude', 'sonnet');
    pickEffortInMenu(store, 'B', 'claude', 'high');
    expect(modelOf(store, 'claude', 'B')).toMatchObject({ id: 'sonnet', source: 'chosen' });
    expect(chatPick(store.get(), 'claude', 'B')).toEqual({ model: 'sonnet', effort: 'high' });
    expect(chatPick(store.get(), 'claude', 'A')).toEqual({ model: 'sonnet', effort: 'high' });
  });

  it("a deleted chat's agent and pick are forgotten, in memory and in the saved copy", () => {
    const disk = memory();
    const store = createAgentRunStore({ picks: disk });
    pickInMenu(store, 'A', 'claude', 'sonnet');
    pickInMenu(store, 'B', 'codex', 'gpt-5.5');
    store.patch((s) => forgetChat(s, 'A'));
    expect(store.get().agents).toEqual({ B: 'codex' });
    expect(store.get().chatConfig).toEqual({ B: { model: 'gpt-5.5' } });
    expect(createAgentRunStore({ picks: disk }).get().agents).toEqual({ B: 'codex' });
  });

  it('(b) a Codex model in A and a Claude model in B are each restored by a new page', () => {
    const disk = memory();
    const before = createAgentRunStore({ picks: disk });
    pickInMenu(before, 'A', 'codex', 'gpt-5.5');
    pickInMenu(before, 'B', 'claude', 'sonnet');
    const after = createAgentRunStore({ picks: disk });
    expect(after.get().agents).toEqual({ A: 'codex', B: 'claude' });
    expect(modelOf(after, 'codex', 'A')).toMatchObject({ id: 'gpt-5.5', source: 'chosen' });
    expect(modelOf(after, 'claude', 'B')).toMatchObject({ id: 'sonnet', source: 'chosen' });
    expect(chatPick(after.get(), 'claude', 'A')).toEqual({ model: 'gpt-5.5' });
  });

  it('(b) control: a store with nothing saved restores nothing', () => {
    expect(createAgentRunStore({ picks: memory() }).get().agents).toEqual({});
    expect(createAgentRunStore({ picks: { getItem: () => '{not json', setItem: () => {} } }).get().chatConfig).toEqual({});
  });

  it('(c) A handed to Codex: its ring is Codex\'s (none yet), and Claude\'s numbers come back with Claude', () => {
    const store = createAgentRunStore();
    const run = (agentRef: string, used: number): AgentRun =>
      ({ id: `r-${agentRef}`, sessionId: 'A', agentRef, status: 'done', items: [], approvals: [], usage: { used, size: 200_000 } }) as unknown as AgentRun;
    store.patch((s) => ({ ...s, agents: { A: 'claude', B: 'claude' }, runs: [run('claude', 50_000), { ...run('claude', 9_000), id: 'rb', sessionId: 'B' }] }));
    expect(agentActivity(store.get(), 'A')?.usage?.used).toBe(50_000);
    store.patch((s) => ({ ...s, agents: { ...s.agents, A: 'codex' } }));
    expect(agentActivity(store.get(), 'A')?.usage).toBeNull();
    expect(agentActivity(store.get(), 'B')?.usage?.used).toBe(9_000);
    store.patch((s) => ({ ...s, agents: { ...s.agents, A: 'claude' } }));
    expect(agentActivity(store.get(), 'A')?.usage?.used).toBe(50_000);
  });

  it('(d) a saved model the agent no longer offers falls back to its default, shown, and is not sent', () => {
    const store = createAgentRunStore();
    pickInMenu(store, 'A', 'claude', 'retired-model');
    store.patch((s) => ({ ...s, caps: { claude: caps('opus', 'sonnet') } }));
    expect(modelOf(store, 'claude', 'A')).toMatchObject({ id: 'opus', label: 'OPUS', source: 'default' });
    expect(chatPick(store.get(), 'claude', 'A')).toEqual({});
    /* control: before the list is read the pick is kept, and a pick that is offered is shown */
    const early = createAgentRunStore();
    pickInMenu(early, 'A', 'claude', 'sonnet');
    expect(modelOf(early, 'claude', 'A').id).toBe('sonnet');
    early.patch((s) => ({ ...s, caps: { claude: caps('opus', 'sonnet') } }));
    expect(modelOf(early, 'claude', 'A').source).toBe('chosen');
  });
});

describe('a turn carries its own chat\'s model', () => {
  it('chat B on Claude does not send chat A\'s Sonnet', async () => {
    const { vi } = await import('vitest');
    const bodies: Record<string, unknown>[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/acp/run-node')) bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response('', { status: 200 });
    });
    const store = createAgentRunStore();
    pickInMenu(store, 'A', 'claude', 'sonnet');
    await store.start({ agentRef: 'claude', sessionId: 'A', question: 'hi' } as never, f as never).catch(() => undefined);
    await store.start({ agentRef: 'claude', sessionId: 'B', question: 'hi' } as never, f as never).catch(() => undefined);
    const sent = (i: number) => (bodies[i]?.config as { model?: string } | undefined)?.model;
    expect(bodies).toHaveLength(2);
    expect(sent(0)).toBe('sonnet');
    expect(sent(1)).toBeUndefined();
  });
});

describe('deleting a chat forgets its pick', () => {
  it('clearSessionPads (every delete path) drops the chat\'s agent and pick from the page store', async () => {
    const { clearSessionPads } = await import('../v3/sessionActions');
    const { agentRuns } = await import('./agentRuns');
    agentRuns.patch((s) => ({ ...s, agents: { gone: 'claude', kept: 'codex' }, chatConfig: { gone: { model: 'sonnet' }, kept: { model: 'm' } } }));
    clearSessionPads('gone');
    expect(agentRuns.get().agents).toEqual({ kept: 'codex' });
    expect(agentRuns.get().chatConfig).toEqual({ kept: { model: 'm' } });
  });
});
