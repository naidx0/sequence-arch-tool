import { describe, expect, it } from 'vitest';
import { createAgentRunStore } from '../agents/agentRuns';
import { readSavedPicks, stateFromSaved, writeSavedPicks } from '../agents/chatConfig';
import { parseSwitchCommand, advanceSwitchRule } from './switchRule';
import { createAgentSwitcher, readSwitchReadiness } from './agentSwitch';

describe('switch command and durable countdown', () => {
  it('executes only a whole start command and validates its arguments', () => {
    expect(parseSwitchCommand('explain /switch codex 20')).toBeNull();
    expect(parseSwitchCommand('/switching codex')).toBeNull();
    expect(parseSwitchCommand('/switch codex 20')).toEqual({ kind: 'schedule', target: 'codex', turns: 20 });
    expect(parseSwitchCommand('/switch codex')).toEqual({ kind: 'now', target: 'codex' });
    expect(parseSwitchCommand('/switch cancel')).toEqual({ kind: 'cancel' });
    for (const s of ['/switch', '/switch codex 0', '/switch codex -1', '/switch codex 1.5', '/switch codex 2 extra', '/switch cancel 2']) expect(parseSwitchCommand(s)?.kind).toBe('invalid');
  });
  it('counts successful future prompt completions once, never history, compact, abort or failure', () => {
    const rule = { target: 'codex', remaining: 2, createdAt: 10, counted: [] };
    for (const patch of [{ restored: true }, { stopped: true }, { status: 'failed' }, { operation: 'compact' }, { startedAt: 9 }]) {
      expect(advanceSwitchRule(rule, { id: 'a', startedAt: 11, status: 'done', ...patch })).toBe(rule);
    }
    const next = advanceSwitchRule(rule, { id: 'a', startedAt: 11, status: 'done' });
    expect(next.remaining).toBe(1);
    expect(advanceSwitchRule(next, { id: 'a', startedAt: 11, status: 'done' })).toBe(next);
    expect(advanceSwitchRule(next, { id: 'b', startedAt: 12, status: 'done' }).remaining).toBe(0);
    expect(advanceSwitchRule(rule, { id: 'same-millisecond', startedAt: 10, status: 'done' }).remaining).toBe(1);
  });
  it('round trips the rule through existing per-chat picks', () => {
    let raw = '';
    const storage = { getItem: () => raw, setItem: (_: string, value: string) => { raw = value; } };
    const state = { agents: { a: 'claude' }, chatConfig: { a: { switchRule: { target: 'codex', remaining: 19, createdAt: 10, counted: ['turn'] } } } };
    writeSavedPicks(storage, state);
    expect(stateFromSaved(readSavedPicks(storage))).toEqual(state);
  });
});

describe('switch readiness', () => {
  const answer = (agents: { id: string }[], providers: Record<string, unknown>[]) => (async (url: RequestInfo | URL) => new Response(JSON.stringify(String(url) === '/api/acp/agents' ? { agents } : { providers }), { status: 200 })) as typeof fetch;
  it('a registered agent the probe does not list (a custom or local one) is ready; a listed one is ready only when the probe says so', async () => {
    const r = await readSwitchReadiness(answer(
      [{ id: 'my-local' }, { id: 'codex' }, { id: 'claude' }, { id: 'gemini' }],
      [{ id: 'codex', state: 'ready' }, { id: 'claude', state: 'signIn' }, { id: 'gemini', state: 'ready', bridgeMissing: true }, { id: 'cursor', state: 'ready' }],
    ));
    expect(r.registered).toEqual(['my-local', 'codex', 'claude', 'gemini']);
    expect(r.ready).toEqual(['my-local', 'codex']);
  });
});

describe('guarded switch transaction', () => {
  const ready = async () => ({ registered: ['codex', 'claude'], ready: ['codex', 'claude'] });
  function fixture(check = ready) {
    const runs = createAgentRunStore();
    runs.patch(s => ({ ...s, agents: { a: 'claude', b: 'claude' }, chatConfig: { a: { model: 'old' } } }));
    let busy = false;
    const guard = createAgentSwitcher({ runs, check, busy: () => busy, clock: () => 10 });
    return { runs, guard, busy: (v: boolean) => { busy = v; } };
  }
  it('refuses unknown/unready targets and active turns with all old state intact', async () => {
    const { runs, guard, busy } = fixture();
    const before = runs.get();
    expect((await guard.request('a', 'unknown')).ok).toBe(false);
    expect(runs.get()).toBe(before);
    busy(true);
    expect((await guard.request('a', 'codex')).ok).toBe(false);
    expect(runs.get()).toBe(before);
    const bad = fixture(async () => ({ registered: ['codex'], ready: [] }));
    expect((await bad.guard.request('a', 'codex')).ok).toBe(false);
  });
  it('switches only that chat, drops incompatible model picks, and clears immediate/same-agent rules', async () => {
    const { runs, guard } = fixture();
    expect((await guard.request('a', 'codex', 20)).ok).toBe(true);
    expect(runs.get().agents?.a).toBe('claude');
    expect(runs.get().chatConfig?.a.switchRule?.remaining).toBe(20);
    expect((await guard.request('a', 'codex')).ok).toBe(true);
    expect(runs.get().agents).toEqual({ a: 'codex', b: 'claude' });
    expect(runs.get().chatConfig?.a).toEqual({});
    expect((await guard.request('a', 'codex', 2)).ok).toBe(false);
    expect((await guard.request('a', 'codex')).ok).toBe(true);
  });
  it('cancel and later picks invalidate delayed responses; a turn starting during validation refuses', async () => {
    let resolve!: (v: Awaited<ReturnType<typeof ready>>) => void;
    const { runs, guard, busy } = fixture(() => new Promise(r => { resolve = r; }));
    const pending = guard.request('a', 'codex', 20);
    guard.cancel('a');
    resolve(await ready());
    expect((await pending).ok).toBe(false);
    expect(runs.get().agents?.a).toBe('claude');
    const another = guard.request('a', 'codex');
    busy(true);
    resolve(await ready());
    expect((await another).ok).toBe(false);
    expect(runs.get().agents?.a).toBe('claude');
  });
  it('a stale chat seat, missing chat and an unreadable readiness check all preserve the old pick and rule', async () => {
    const { runs, guard } = fixture();
    await guard.request('a', 'codex', 20);
    const before = runs.get();
    expect((await guard.request('a', 'codex', undefined, () => false)).ok).toBe(false);
    expect((await guard.request('', 'codex')).ok).toBe(false);
    expect(runs.get()).toBe(before);
    const offline = fixture(async () => { throw new Error('offline'); });
    const old = offline.runs.get();
    expect((await offline.guard.request('a', 'codex')).ok).toBe(false);
    expect(offline.runs.get()).toBe(old);
  });
  it('a later request supersedes an earlier async selection', async () => {
    const pending: ((v: Awaited<ReturnType<typeof ready>>) => void)[] = [];
    const { runs, guard } = fixture(() => new Promise(r => { pending.push(r); }));
    const first = guard.request('a', 'codex');
    const second = guard.request('a', 'claude');
    pending[1]!(await ready());
    expect((await second).ok).toBe(true);
    pending[0]!(await ready());
    expect((await first).ok).toBe(false);
    expect(runs.get().agents?.a).toBe('claude');
  });
});
