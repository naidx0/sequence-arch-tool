import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { agentRuns, type AgentRun } from './agentRuns';
import { agentActivity } from './agentActivity';
import { buildAgentsOverview } from './agentsOverview';
import { chatContext } from './contextMeter';
import { StoreProvider, createStore } from '../state';
import { StatusBar } from '../shell2/StatusBar';

/* 0.1.8 C: one reading of "context" (the agent's own window fill, in this chat), shared by the status bar and the Agents pane. */

const CODEX_WINDOW = 258_400;
type Turn = NonNullable<AgentRun['turnUsage']>;
const NONE = { used: null, size: null, source: 'none' };

const run = (over: Partial<AgentRun> & { id: string }): AgentRun =>
  ({ sessionId: 'c1', agentRef: 'codex', nodeId: null, nodeLabel: null, prompt: 'q', status: 'done', startedAt: 1, endedAt: 2, items: [], approvals: [], error: null, ...over }) as AgentRun;

/* A tiny seeded generator, so a failure names its seed and replays. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/** One Codex turn as the wire gives it: `requests` model calls, each reporting `last`; the turn's usage is their sum, usage_update is the last one. */
function codexTurn(id: string, at: number, r: () => number, requests: number, size = CODEX_WINDOW): { run: AgentRun; sum: number; last: number; requests: number } {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let last = 0;
  for (let i = 0; i < requests; i++) {
    const cached = Math.floor(r() * 180_000);
    const fresh = Math.floor(r() * 60_000) + 1;
    const out = Math.floor(r() * 4_000) + 1;
    input += cached + fresh;
    cacheRead += cached;
    output += out;
    /* An agent can overshoot its own window by a hair (a late compaction): the meter never shows over 100%. */
    last = cached + fresh + out + (r() < 0.1 ? 50_000 : 0);
  }
  const turnUsage: Turn = { input, output, cacheRead, cacheWrite: 0, thought: 0, total: input + output };
  return { run: run({ id, startedAt: at, endedAt: at + 1, turnUsage, usage: { used: last, size, cost: null } }), sum: input + output, last, requests };
}

describe('chatContext', () => {
  it('property: any sequence of turns reads the newest turn window fill, clamped, never a multi-request or multi-turn sum', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const turns = 1 + Math.floor(r() * 60);
      const made = Array.from({ length: turns }, (_, i) => codexTurn(`t${i}`, 10 + i * 10, r, 1 + Math.floor(r() * 40)));
      const runs = made.map((m) => m.run);
      const ctx = chatContext(runs, 'c1');
      const newest = made[made.length - 1]!;
      const why = `seed ${seed}, ${turns} turns`;
      expect(ctx.source, why).toBe('agent');
      expect(ctx.size, why).toBe(CODEX_WINDOW);
      expect(ctx.used!, why).toBeLessThanOrEqual(ctx.size!);
      expect(ctx.used, why).toBe(Math.min(newest.last, CODEX_WINDOW));
      if (newest.requests > 1) expect(ctx.used, why).not.toBe(newest.run.turnUsage!.total);
      if (made.length > 1) expect(ctx.used, why).not.toBe(made.reduce((n, m) => n + m.sum, 0));
      /* The Agents pane and the activity chip read the same number for the same runs. */
      const o = buildAgentsOverview(runs, [], 1_000_000, { agents: { c1: 'codex' }, activeSessionId: 'c1' });
      expect(o.chats[0]!.context, why).toBe(ctx.used);
      expect(o.context, why).toBe(ctx.used);
      expect(agentActivity({ runs, agents: { c1: 'codex' } } as never, 'c1')!.usage?.used, why).toBe(ctx.used);
    }
  });

  it('15M reproduction: a chat that processed 15,000,000 tokens shows a context inside the window, or unknown', () => {
    const r = rng(15);
    const made: AgentRun[] = [];
    let processed = 0;
    for (let i = 0; made.length < 400 && processed < 15_000_000; i++) {
      const t = codexTurn(`t${i}`, 10 + i, r, 30);
      processed += t.sum;
      made.push(t.run);
    }
    expect(processed).toBeGreaterThanOrEqual(15_000_000);
    const o = buildAgentsOverview(made, [], 1_000_000, { agents: { c1: 'codex' }, activeSessionId: 'c1' });
    expect(o.chats[0]!.processed).toBeGreaterThanOrEqual(15_000_000);
    expect(o.chats[0]!.context!).toBeLessThanOrEqual(CODEX_WINDOW);
    expect(o.context!).toBeLessThanOrEqual(CODEX_WINDOW);
    /* The newest turn reported nothing: unknown, not the millions the totals hold. */
    const silent = [...made, run({ id: 'silent', startedAt: 1_000_000, turnUsage: made[0]!.turnUsage })];
    expect(chatContext(silent, 'c1')).toEqual(NONE);
    expect(buildAgentsOverview(silent, [], 2_000_000).chats[0]!.context).toBeNull();
    expect(buildAgentsOverview(silent, [], 2_000_000, { activeSessionId: 'c1' }).context).toBeNull();
  });

  it('a Claude run with no usage_update is unknown, not a figure worked out from its turn totals', () => {
    const claude = run({ id: 'cl', agentRef: 'claude', turnUsage: { input: 3_000, output: 500, cacheRead: 90_000, cacheWrite: 0, thought: 0, total: 93_500 } });
    expect(chatContext([claude], 'c1')).toEqual(NONE);
    expect(buildAgentsOverview([claude], [], 10).chats[0]!.context).toBeNull();
    expect(buildAgentsOverview([claude], [], 10).chats[0]!.processed).toBe(93_500);
  });

  it('only this chat: another chat, an older finished run and an empty chat never carry a number over', () => {
    const a = run({ id: 'a', sessionId: 'c1', usage: { used: 50_000, size: 200_000, cost: null } });
    const b = run({ id: 'b', sessionId: 'c2', startedAt: 5, usage: { used: 90_000, size: 200_000, cost: null } });
    expect(chatContext([a, b], 'c1').used).toBe(50_000);
    expect(chatContext([a, b], 'c2').used).toBe(90_000);
    expect(chatContext([a, b], 'c3')).toEqual(NONE);
    expect(chatContext([a, b], null).used).toBeNull();
    /* A finished newer run with no report hides the older one; a run still starting does not. */
    expect(chatContext([a, run({ id: 'a2', startedAt: 9 })], 'c1').used).toBeNull();
    expect(chatContext([a, run({ id: 'a3', startedAt: 9, status: 'running', endedAt: null })], 'c1').used).toBe(50_000);
  });

  it('clamps to the window, takes a fallback window only when the agent gave none, and treats junk as unknown', () => {
    expect(chatContext([run({ id: 'x', usage: { used: 300_000, size: 200_000, cost: null } })], 'c1')).toEqual({ used: 200_000, size: 200_000, source: 'agent' });
    expect(chatContext([run({ id: 'x', usage: { used: 80_000, size: 0, cost: null } })], 'c1', null, 100_000)).toEqual({ used: 80_000, size: 100_000, source: 'agent' });
    expect(chatContext([run({ id: 'x', usage: { used: 180_000, size: 0, cost: null } })], 'c1', null, 100_000).used).toBe(100_000);
    expect(chatContext([run({ id: 'x', usage: { used: Number.NaN, size: 200_000, cost: null } })], 'c1').used).toBeNull();
    expect(chatContext([run({ id: 'x', usage: { used: -5, size: 200_000, cost: null } })], 'c1').used).toBeNull();
  });
});

/* ------------------------------ the status bar and the pane agree ------------------------------ */

function mount(activeChat: string, runs: AgentRun[], agents: Record<string, string>) {
  const store = createStore({});
  store.dispatch({ type: 'composer/model', model: { model: 'claude-sonnet-5-5', origin: 'api-key' } });
  const sessions = ['c1', 'c2', 'c3'].map((id) => ({ id, title: id, pinned: false, updatedAt: '2026-01-01' }));
  store.dispatch({ type: 'session/index', sessions, activeId: activeChat } as never);
  act(() => agentRuns.patch((s) => ({ ...s, runs, agents })));
  render(
    <StoreProvider store={store}>
      <StatusBar />
    </StoreProvider>,
  );
}
const panel = (): string => {
  fireEvent.focus(screen.getByTestId('composer-context'));
  return screen.getByTestId('composer-context-breakdown').textContent ?? '';
};

describe('the status bar and the Agents pane read one number', () => {
  beforeEach(() => agentRuns.patch((s) => ({ ...s, runs: [], agents: {} })));
  afterEach(cleanup);

  it('a 15M-processed chat: the bar shows the pane number, inside the window', () => {
    const r = rng(7);
    const runs: AgentRun[] = [];
    for (let i = 0; i < 300; i++) runs.push(codexTurn(`t${i}`, 10 + i, r, 40, 200_000).run);
    const o = buildAgentsOverview(runs, [], 1_000_000);
    expect(o.chats[0]!.processed!).toBeGreaterThan(15_000_000);
    const shown = o.chats[0]!.context!;
    expect(shown).toBeLessThanOrEqual(200_000);
    mount('c1', runs, { c1: 'codex' });
    const text = panel();
    const k = Math.round(shown / 1000);
    expect(text).toMatch(new RegExp(`${k}k|${(shown / 1000).toFixed(1)}k`));
    expect(text).not.toMatch(/\dM/);
  });

  it('switching the active chat to one with no runs shows unknown, not the previous chat number', () => {
    const runs = [run({ id: 'a', sessionId: 'c1', agentRef: 'claude', usage: { used: 50_000, size: 200_000, cost: null } })];
    mount('c1', runs, { c1: 'claude', c3: 'claude' });
    expect(panel()).toMatch(/50k/);
    cleanup();
    mount('c3', runs, { c1: 'claude', c3: 'claude' });
    const text = panel();
    expect(text).not.toMatch(/50k/);
    expect(text).toMatch(/Nothing sent yet/);
  });
});
