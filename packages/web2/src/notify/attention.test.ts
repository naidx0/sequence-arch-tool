import { describe, expect, it } from 'vitest';

import { approvalWaitingNotice, turnEndedNotice } from './attentionNotices';
import { NOTIFY_APPROVALS_KEY, readAttentionEnabled, writeAttentionEnabled } from '../settings/attentionPreference';
import { startAttention, type DesktopAttentionRequest, type RunSource } from './attention';
import { agentName, attentionEvents, snapshotOf, waitingCount, type RunLike } from './attentionModel';

/*
 * S5, NEVER MISS A TURN, the page side. A fake run store (the shape of
 * agents/agentRuns.ts), a fake desktop bridge and a fake browser notifier.
 * Every change is pushed synchronously, the way the real store emits, so
 * nothing waits.
 */

const run = (over: Partial<RunLike> = {}): RunLike => ({
  id: 'run-1',
  sessionId: 'chat-a',
  agentRef: 'codex',
  prompt: 'Fix the failing parser test',
  status: 'running',
  approvals: [],
  ...over,
});

function fakeRuns(initial: RunLike[]): RunSource & { set(runs: RunLike[]): void } {
  let runs = initial;
  const fns = new Set<() => void>();
  return {
    get: () => ({ runs }),
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    set(next) {
      runs = next;
      for (const f of [...fns]) f();
    },
  };
}

function rig(opts: { visible?: boolean; desktop?: boolean; permission?: 'granted' | 'default' | 'denied'; prefs?: Partial<Record<'turns' | 'approvals', boolean>> } = {}) {
  const runs = fakeRuns([run()]);
  const sent: DesktopAttentionRequest[] = [];
  const shown: { title: string; body: string; click: () => void }[] = [];
  const focused: (string | null)[] = [];
  let focusChat: ((info: { runId: string | null }) => void) | null = null;
  const visible = { value: opts.visible ?? false };
  const handle = startAttention({
    runs,
    isVisible: () => visible.value,
    desktop: opts.desktop
      ? {
          attention: async (req) => void sent.push(req),
          onFocusChat: (cb) => ((focusChat = cb), () => (focusChat = null)),
        }
      : null,
    browser: { permission: () => opts.permission ?? 'granted', show: (title, body, click) => void shown.push({ title, body, click }) },
    prefs: (k) => opts.prefs?.[k] ?? true,
    focusChat: (r) => void focused.push(r?.id ?? null),
  });
  return { runs, sent, shown, focused, visible, handle, clickDesktop: (runId: string | null) => focusChat?.({ runId }) };
}

describe('attentionModel: transitions, not states', () => {
  it('a run already over when first seen is not news; one that ends while watched is', () => {
    const prev = snapshotOf([run({ id: 'old', status: 'done' }), run({ id: 'live' })]);
    const events = attentionEvents(prev, [run({ id: 'old', status: 'done' }), run({ id: 'live', status: 'done' })]);
    expect(events.map((e) => (e.kind === 'turn-ended' ? `${e.run.id}:${e.status}` : e.kind))).toEqual(['live:done']);
  });

  it('an approval is news when it starts waiting, once, and not after it is answered', () => {
    const asked = run({ approvals: [{ requestId: 'r1', title: 'Run npm test', decision: null }] });
    const first = attentionEvents(snapshotOf([run()]), [asked]);
    expect(first).toHaveLength(1);
    expect(attentionEvents(snapshotOf([asked]), [asked])).toEqual([]);
    expect(waitingCount([asked, run({ id: 'b', approvals: [{ requestId: 'r2', title: null, decision: 'allow' }] })])).toBe(1);
  });

  it('names the agent in the reader\'s words', () => {
    expect(agentName('codex')).toBe('Codex');
    expect(agentName('claude-code-acp')).toBe('Claude');
    expect(agentName(null)).toBe('The agent');
  });
});

describe('notifyModel: the words, behind runFinishedNotice\'s gate', () => {
  const GRANTED = { permission: 'granted' as const, enabled: true };
  it('a finished turn names the agent and the prompt; a failed one says failed', () => {
    expect(turnEndedNotice({ state: GRANTED, visible: false, agentName: 'Codex', status: 'done', prompt: 'Fix the parser' })).toEqual({
      title: 'Codex finished',
      body: '“Fix the parser”. Open Sequence to see the answer.',
    });
    expect(turnEndedNotice({ state: GRANTED, visible: false, agentName: 'Codex', status: 'failed' })!.title).toBe('Codex failed');
  });
  it('an approval says it needs you and what is waiting', () => {
    expect(approvalWaitingNotice({ state: GRANTED, visible: false, agentName: 'Codex', title: 'Run npm test', waiting: 2 })).toEqual({
      title: 'Codex needs you (2 waiting)',
      body: 'Run npm test is waiting for Allow or Deny.',
    });
  });
  it('nothing while visible, without permission, or switched off', () => {
    expect(turnEndedNotice({ state: GRANTED, visible: true, agentName: 'Codex', status: 'done' })).toBeNull();
    expect(turnEndedNotice({ state: { permission: 'default', enabled: true }, visible: false, agentName: 'Codex', status: 'done' })).toBeNull();
    expect(approvalWaitingNotice({ state: { permission: 'granted', enabled: false }, visible: false, agentName: 'C', title: null, waiting: 1 })).toBeNull();
  });
});

describe('the preferences: on by default, off only when turned off', () => {
  it('reads on for nothing stored and for garbage; off only for "off"', () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(readAttentionEnabled('approvals', store)).toBe(true);
    mem.set(NOTIFY_APPROVALS_KEY, '???');
    expect(readAttentionEnabled('approvals', store)).toBe(true);
    writeAttentionEnabled('approvals', false, store);
    expect(readAttentionEnabled('approvals', store)).toBe(false);
    expect(readAttentionEnabled('turns', store)).toBe(true);
  });
});

describe('startAttention in a browser', () => {
  it('a turn that ends while the window is hidden raises one notification; its click opens that chat', () => {
    const r = rig();
    r.runs.set([run({ status: 'done' })]);
    expect(r.shown.map((s) => s.title)).toEqual(['Codex finished']);
    r.shown[0]!.click();
    expect(r.focused).toEqual(['run-1']);
  });

  it('nothing while the window is visible and focused', () => {
    const r = rig({ visible: true });
    r.runs.set([run({ status: 'done', approvals: [{ requestId: 'q', title: 'Edit a.ts', decision: null }] })]);
    expect(r.shown).toEqual([]);
  });

  it('an approval waiting while hidden is announced', () => {
    const r = rig();
    r.runs.set([run({ approvals: [{ requestId: 'q', title: 'Run npm test', decision: null }] })]);
    expect(r.shown.map((s) => s.title)).toEqual(['Codex needs you']);
  });

  it('permission not yet granted: silent (the prompt is only ever raised by the enable click)', () => {
    const r = rig({ permission: 'default' });
    r.runs.set([run({ status: 'done' })]);
    expect(r.shown).toEqual([]);
  });

  it('turn-end switched off, approvals still on', () => {
    const r = rig({ prefs: { turns: false } });
    r.runs.set([run({ status: 'done', approvals: [{ requestId: 'q', title: 'x', decision: null }] })]);
    expect(r.shown.map((s) => s.title)).toEqual(['Codex needs you']);
  });
});

describe('startAttention in the desktop app', () => {
  it('notifies through the bridge, and reports the waiting count for the badge as it changes', () => {
    const r = rig({ desktop: true });
    expect(r.sent).toEqual([{ kind: 'waiting', count: 0 }]);
    r.runs.set([run({ approvals: [{ requestId: 'q', title: 'Run npm test', decision: null }] })]);
    expect(r.sent.slice(1)).toEqual([
      { kind: 'notify', title: 'Codex needs you', body: 'Run npm test is waiting for Allow or Deny.', runId: 'run-1' },
      { kind: 'waiting', count: 1 },
    ]);
    r.runs.set([run({ status: 'done', approvals: [{ requestId: 'q', title: 'Run npm test', decision: 'allow' }] })]);
    expect(r.sent.slice(3)).toEqual([
      { kind: 'notify', title: 'Codex finished', body: '“Fix the failing parser test”. Open Sequence to see the answer.', runId: 'run-1' },
      { kind: 'waiting', count: 0 },
    ]);
    expect(r.shown).toEqual([], 'the browser path is not used in the desktop app');
  });

  it('a click in the OS comes back on onFocusChat and opens that run\'s chat', () => {
    const r = rig({ desktop: true });
    r.clickDesktop('run-1');
    expect(r.focused).toEqual(['run-1']);
  });

  it('seed "runs" (started on the first blur): an approval already waiting is announced, a run already over is not', () => {
    const sent: DesktopAttentionRequest[] = [];
    const runs = fakeRuns([
      run({ id: 'old', status: 'done' }),
      run({ id: 'asking', approvals: [{ requestId: 'q', title: 'Run npm test', decision: null }] }),
    ]);
    startAttention({
      runs,
      isVisible: () => false,
      desktop: { attention: async (req) => void sent.push(req) },
      browser: null,
      prefs: () => true,
      focusChat: () => {},
      seed: 'runs',
    });
    expect(sent).toEqual([
      { kind: 'notify', title: 'Codex needs you', body: 'Run npm test is waiting for Allow or Deny.', runId: 'asking' },
      { kind: 'waiting', count: 1 },
    ]);
  });

  it('stop() unsubscribes', () => {
    const r = rig({ desktop: true });
    r.handle.stop();
    r.runs.set([run({ status: 'done' })]);
    expect(r.sent).toEqual([{ kind: 'waiting', count: 0 }]);
  });
});
