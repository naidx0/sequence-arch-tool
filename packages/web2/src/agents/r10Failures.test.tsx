import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentRunsList, RunFoot } from '../chat/AgentRunThread';
import { endSentence, noticeSentence, resetsAtShort } from '../chat/RecoveryCard';
import { HUNG_MS, QUIET_MS, watchdogLevel } from '../chat/RunWatchdog';
import { createAgentRunStore, type AgentRun } from './agentRuns';
import { loadCapabilities, lookupAgent } from './agentRunner';

/* Fake streams only: no agent binary is ever started. */
function sse(events: unknown[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const NEVER_SAW = { type: 'acp:update', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } } };

async function failedRun(recovery: Record<string, unknown> | undefined, error: string, agentRef = 'claude'): Promise<AgentRun> {
  const store = createAgentRunStore({ fetch: async () => sse([{ type: 'acp:error', error, ...(recovery ? { recovery } : {}) }]) });
  return store.start({ agentRef, question: 'q', sessionId: 's' });
}

function row(run: AgentRun) {
  render(<AgentRunsList runs={[run]} repoRoot={null} onAnswer={() => {}} onRetry={() => {}} />);
  return screen.getByTestId('agent-recovery');
}

describe('a failed turn is one quiet row with its cause', () => {
  const cases: [string, Record<string, unknown>, string, string][] = [
    ['signed out', { kind: 'signIn', provider: 'claude', cause: 'signedOut' }, 'Please log in again', 'Claude is signed out.'],
    ['not installed', { kind: 'install', cause: 'notInstalled' }, 'spawn claude-agent-acp ENOENT', "Claude isn't installed."],
    ['bridge exit', { kind: 'retry', cause: 'bridgeExit' }, 'The agent process exited (code 3): Cannot find module', 'Claude quit unexpectedly.'],
    ['timeout', { kind: 'retry', cause: 'timeout' }, 'no output', 'Claude stopped responding.'],
    ['network', { kind: 'retry', cause: 'network' }, 'fetch failed', "Couldn't reach Claude's servers."],
    ['unknown', { kind: 'retry', cause: 'unknown' }, 'odd', 'Claude stopped before it answered.'],
  ];
  for (const [name, recovery, error, sentence] of cases) {
    it(`${name}: ${sentence}`, async () => {
      const run = await failedRun(recovery, error);
      expect(run.recovery?.cause).toBe(recovery.cause);
      const card = row(run);
      expect(within(card).getByTestId('agent-recovery-why').textContent).toBe(sentence);
      expect(card.className).toContain('agnote');
      /* The raw reason is behind Details. */
      expect(within(card).getByTestId('agent-run-error').closest('details')).not.toBeNull();
    });
  }

  it('a permission refusal is not retryable: it would be refused again', async () => {
    const run = await failedRun({ kind: 'settings', cause: 'unknown' }, 'Refused in read-only mode');
    const card = row(run);
    expect(within(card).getByTestId('agent-recovery-why').textContent).toBe("This permission mode doesn't allow that.");
    expect(within(card).queryByTestId('agent-recovery-retry')).toBeNull();
  });

  it('usage limit: one sentence with the reset time, no Retry', async () => {
    const at = new Date(2026, 9, 12, 16, 36).getTime();
    const run = await failedRun({ kind: 'wait', provider: 'claude', resetsAt: at, cause: 'usageLimit' }, 'limit');
    expect(noticeSentence(run, at - 3600_000)).toBe(endSentence(`Usage limit, resets ${resetsAtShort(at, at - 3600_000)}`));
    /* Windows en-CA writes "4:36 p.m.": the sentence must not end in two periods. */
    expect(endSentence('Usage limit, resets 4:36 p.m.')).toBe('Usage limit, resets 4:36 p.m.');
    expect(endSentence('Usage limit, resets 4:36 PM')).toBe('Usage limit, resets 4:36 PM.');
    expect(resetsAtShort(at, at - 3600_000, 'en-US')).toMatch(/^4:36\s?PM$/);
    const card = row(run);
    expect(within(card).queryByTestId('agent-recovery-retry')).toBeNull();
  });

  it('a stream that ends without a result still ends the run, with a reason and a Retry', async () => {
    const store = createAgentRunStore({ fetch: async () => sse([NEVER_SAW]) });
    const run = await store.start({ agentRef: 'claude', question: 'q', sessionId: 's' });
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/without a result/);
    expect(row(run)).toBeTruthy();
  });

  it('a stopped turn reads "Stopped." quietly', async () => {
    const store = createAgentRunStore({ fetch: async () => sse([{ type: 'acp:result', stopReason: 'cancelled', text: '' }]) });
    const run = await store.start({ agentRef: 'claude', question: 'q', sessionId: 's' });
    const card = row(run);
    expect(within(card).getByTestId('agent-recovery-why').textContent).toBe('Stopped.');
    expect(card.getAttribute('data-stopped')).toBe('true');
  });
});

describe('never silent', () => {
  it('an agent lookup that fails says why', async () => {
    const f = (async () => new Response(JSON.stringify({ error: 'gateway down' }), { status: 502 })) as unknown as typeof fetch;
    expect(await lookupAgent(f)).toEqual({ id: null, why: 'gateway down' });
    const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect((await lookupAgent(boom)).why).toBe('offline');
    const store = createAgentRunStore({ fetch: boom });
    const run = await store.start({ question: 'q', sessionId: 's' });
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/offline/);
  });

  it('a capabilities failure puts one line in the chat as the message is sent', async () => {
    const calls: string[] = [];
    const f = (async (u: string) => {
      calls.push(u);
      if (u.startsWith('/api/acp/capabilities')) return new Response(JSON.stringify({ error: 'claude is signed out' }), { status: 500 });
      return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'hi' }]);
    }) as unknown as typeof fetch;
    const store = createAgentRunStore({ fetch: f });
    await loadCapabilities(store, 'claude', f);
    expect(store.get().capsError?.claude).toMatch(/signed out/);
    const run = await store.start({ agentRef: 'claude', question: 'q', sessionId: 's' });
    const note = run.items.find((i) => i.kind === 'note');
    expect(note && 'text' in note && note.text).toMatch(/Couldn't load this agent's models and commands \(claude is signed out\)/);
  });
});

describe('messages', () => {
  const capsFail = (u: string) => u.startsWith('/api/acp/capabilities');
  it('the capabilities note appears once per chat, not on every send', async () => {
    const f = (async (u: string) => {
      if (capsFail(u)) return new Response(JSON.stringify({ error: 'claude is signed out' }), { status: 500 });
      return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'hi' }]);
    }) as unknown as typeof fetch;
    const store = createAgentRunStore({ fetch: f });
    await loadCapabilities(store, 'claude', f);
    const a = await store.start({ agentRef: 'claude', question: 'one', sessionId: 's' });
    const b = await store.start({ agentRef: 'claude', question: 'two', sessionId: 's' });
    const c = await store.start({ agentRef: 'claude', question: 'other chat', sessionId: 't' });
    const notes = (r: AgentRun) => r.items.filter((i) => i.kind === 'note');
    expect(notes(a)).toHaveLength(1);
    expect(notes(b)).toHaveLength(0);
    expect(notes(c)).toHaveLength(1);
  });

  it("an unreachable local server reads \"Couldn't reach Sequence's local server.\"", async () => {
    const f = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const store = createAgentRunStore({ fetch: f });
    const run = await store.start({ agentRef: 'claude', question: 'q', sessionId: 's' });
    expect(noticeSentence(run)).toBe("Couldn't reach Sequence's local server.");
  });

  it('a title error is a quiet one-line note on that chat', async () => {
    const f = (async (u: string) => {
      if (u.startsWith('/api/acp/capabilities')) return new Response('{}', { status: 200 });
      return sse([{ type: 'acp:title', error: 'the title model is offline' }, { type: 'acp:result', stopReason: 'end_turn', text: 'hi' }]);
    }) as unknown as typeof fetch;
    const store = createAgentRunStore({ fetch: f });
    const run = await store.start({ agentRef: 'claude', question: 'q', sessionId: 's' });
    const note = run.items.find((i) => i.kind === 'note');
    expect(note && 'text' in note && note.text).toBe("Couldn't name this chat (the title model is offline).");
  });
});

describe('the quiet-turn watchdog', () => {
  const t0 = 1_800_000_000_000;
  const running = (over: Partial<AgentRun> = {}): AgentRun =>
    ({ id: 'r', sessionId: 's', agentRef: 'claude', prompt: 'q', status: 'running', startedAt: t0, endedAt: null, items: [], approvals: [], retry: { question: 'q' }, ...over }) as AgentRun;

  it('is silent until 45s, quiet at 45s, hung at 3 min, and pauses while a person is asked', () => {
    expect(watchdogLevel(running(), t0 + QUIET_MS - 1)).toBeNull();
    expect(watchdogLevel(running(), t0 + QUIET_MS)?.level).toBe('quiet');
    expect(watchdogLevel(running(), t0 + HUNG_MS)?.level).toBe('hung');
    /* events reset it */
    expect(watchdogLevel(running({ lastEventAt: t0 + 40_000 }), t0 + QUIET_MS + 10_000)).toBeNull();
    /* Keep waiting hides it for another 45s */
    expect(watchdogLevel(running(), t0 + 60_000, t0 + 50_000)).toBeNull();
    expect(watchdogLevel(running(), t0 + 100_000, t0 + 50_000)?.level).toBe('quiet');
    const asked = running({ approvals: [{ requestId: 'a', decision: null } as never] });
    expect(watchdogLevel(asked, t0 + HUNG_MS)).toBeNull();
  });

  it('draws "No response from Claude for 45s" with Keep waiting / Stop, then Retry once hung', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(t0 + QUIET_MS);
      const stop = vi.fn();
      const retry = vi.fn();
      const { rerender } = render(<RunFoot run={running()} onStop={stop} onRetry={retry} />);
      const w = screen.getByTestId('agent-run-watchdog');
      expect(w.getAttribute('data-level')).toBe('quiet');
      /* No item yet: the start is slow, and the note sits under the start line, not above it. */
      expect(screen.getByTestId('agent-run-watchdog-text').textContent).toBe('Claude is still starting, 45s');
      fireEvent.click(screen.getByTestId('agent-run-watchdog-wait'));
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(screen.queryByTestId('agent-run-watchdog')).toBeNull();
      act(() => {
        vi.setSystemTime(t0 + HUNG_MS + 1000);
        vi.advanceTimersByTime(600);
      });
      rerender(<RunFoot run={running()} onStop={stop} onRetry={retry} />);
      expect(screen.getByTestId('agent-run-watchdog').getAttribute('data-level')).toBe('hung');
      fireEvent.click(screen.getByTestId('agent-run-watchdog-retry'));
      expect(stop).toHaveBeenCalledTimes(1);
      expect(retry).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a long tool run (server says waiting: tool) is never "No response" or hung, and has no Retry', () => {
    vi.useFakeTimers();
    try {
      const tool = { kind: 'tool', id: 't', title: 'npm test', toolKind: 'execute', status: 'running', startedAt: t0 } as never;
      const long = running({ items: [tool], waiting: { reason: 'tool', quietMs: 120_000, toolKind: 'execute' } });
      expect(watchdogLevel(long, t0 + QUIET_MS - 1)).toBeNull();
      expect(watchdogLevel(long, t0 + HUNG_MS + 60_000)?.level).toBe('tool');
      vi.setSystemTime(t0 + 120_000);
      render(<RunFoot run={long} onStop={() => {}} onRetry={() => {}} />);
      expect(screen.getByTestId('agent-run-watchdog-text').textContent).toBe('Running npm test for 2m');
      expect(screen.queryByTestId('agent-run-watchdog-retry')).toBeNull();
      expect(screen.queryByTestId('agent-run-watchdog-wait')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('answering an approval restarts the quiet clock', async () => {
    const { sendAnswer } = await import('./agentRunner');
    let run = running({ lastEventAt: t0, approvals: [{ requestId: 'a', decision: null } as never] });
    const w = { store: {} as never, find: () => run, defaultFetch: fetch, update: (_id: string, fn: (r: AgentRun) => AgentRun) => { run = fn(run); } };
    const before = Date.now();
    await sendAnswer(w as never, 'r', 'a', 'allow' as never, (async () => new Response('{}', { status: 200 })) as never);
    expect(run.lastEventAt).toBeGreaterThanOrEqual(before);
  });
});
