import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { foldRunEvent } from '../agents/agentRunFold';
import { createAgentRunStore, type AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { ASK_LEDGER_KEY } from '../settings/askLedgerPreference';
import { AgentRunView, resetKeptOpen } from './AgentRunThread';

/*
 * THE ASK LEDGER IN THE CHAT (t3gap/asks). A multi-ask message, setting on:
 * the run asks the server for the ledger; a reply whose closing line left an
 * ask open ends on one "Not closed: X" line with Ask again; a reply that
 * closed every ask adds nothing; the closing line itself is never shown.
 */

afterEach(() => {
  resetKeptOpen();
  localStorage.removeItem(ASK_LEDGER_KEY);
});

const VOICE = 'remove the colorful mod from the screen by default, I like the standing 7d and 5h thing, show total tokens this week as well';
const LEDGER = {
  closures: [
    { n: 1, text: 'hide the meter row', done: true, reason: null },
    { n: 2, text: 'keep the 7d/5h line', done: true, reason: null },
    { n: 3, text: 'weekly token total', done: false, reason: 'the usage API has no counts' },
  ],
  open: [3],
};
const ALL_DONE = { closures: LEDGER.closures.map((c) => ({ ...c, done: true, reason: null })), open: [] };

function runOf(events: RunNodeEvent[], over: Partial<AgentRun> = { askLedgerOn: true }): AgentRun {
  let run: AgentRun = { id: 'run-1', sessionId: 's', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: VOICE, status: 'running', startedAt: 0, endedAt: null, items: [], approvals: [], error: null, ...over };
  events.forEach((e, i) => (run = foldRunEvent(run, e, i + 1)));
  return run;
}
const chunk = (text: string): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });

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

describe('the ask ledger', () => {
  it('a request the agent marked not done ends the run on one line, and Ask again names it', () => {
    const run = runOf([
      chunk('The meter row is gone; the 7d/5h line stays.\n<asks>1 hide the meter row: done; 2 keep the 7d/5h line: done; 3 weekly token total: not done: the usage API has no counts</asks>'),
      { type: 'acp:result', stopReason: 'end_turn', text: 'The meter row is gone; the 7d/5h line stays.', askLedger: LEDGER },
    ]);
    const onAskAgain = vi.fn();
    render(<AgentRunView run={run} now={10} repoRoot={null} onAnswer={() => undefined} onAskAgain={onAskAgain} />);
    const chip = screen.getByTestId('asks-open');
    expect(chip.textContent).toContain('The agent reports not done:');
    expect(chip.textContent).toContain('weekly token total (the usage API has no counts)');
    expect(chip.textContent).not.toContain('meter row');
    expect(document.body.textContent).not.toContain('<asks>');
    fireEvent.click(screen.getByTestId('asks-again'));
    const [, text] = onAskAgain.mock.calls[0] as [AgentRun, string];
    expect(text).toMatch(/^Your reply marked this request not done:\n- weekly token total/);
  });

  it('a reply that closed every request adds nothing to read', () => {
    const run = runOf([
      chunk('All three done.\n<asks>1 a: done; 2 b: done; 3 c: done</asks>'),
      { type: 'acp:result', stopReason: 'end_turn', text: 'All three done.', askLedger: ALL_DONE },
    ]);
    render(<AgentRunView run={run} now={10} repoRoot={null} onAnswer={() => undefined} onAskAgain={() => undefined} />);
    expect(screen.queryByTestId('asks-open')).toBeNull();
    expect(document.body.textContent).toContain('All three done.');
    expect(document.body.textContent).not.toContain('<asks>');
  });

  it('a run sent without the ledger shows its text untouched, closing-line look-alikes included', () => {
    const said = 'I added parsing of the <asks> tag.\n<asks>1 done</asks>';
    const run = runOf([chunk(said), { type: 'acp:result', stopReason: 'end_turn', text: said }], {});
    render(<AgentRunView run={run} now={10} repoRoot={null} onAnswer={() => undefined} />);
    expect(document.body.textContent).toContain('I added parsing of the <asks> tag.');
    expect(document.body.textContent).toContain('<asks>1 done</asks>');
  });

  it('on a ledger run, a mention of <asks> mid-reply is kept; only the final line goes', () => {
    const said = 'I wired <asks> parsing into the fold.\n<asks>1 wire parsing: done; 2 add tests: done</asks>';
    const run = runOf([chunk(said), { type: 'acp:result', stopReason: 'end_turn', text: 'I wired <asks> parsing into the fold.', askLedger: { closures: [{ n: 1, text: 'wire parsing', done: true, reason: null }, { n: 2, text: 'add tests', done: true, reason: null }], open: [] } }]);
    render(<AgentRunView run={run} now={10} repoRoot={null} onAnswer={() => undefined} />);
    expect(document.body.textContent).toContain('I wired <asks> parsing into the fold.');
    expect(document.body.textContent).not.toContain('wire parsing: done');
  });

  it('the run asks the server for the ledger only when the setting is on', async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'claude' }] }));
      bodies.push(JSON.parse(String(init?.body)));
      return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'ok' }]);
    });
    const store = createAgentRunStore({ fetch: f });
    store.setHost({ sessionId: () => 's' });
    const off = await store.start({ question: VOICE });
    expect(bodies[0]!.askLedger).toBeUndefined();
    expect(off.askLedgerOn).toBeFalsy();
    localStorage.setItem(ASK_LEDGER_KEY, 'chip');
    const on = await store.start({ question: VOICE });
    expect(bodies[1]!.askLedger).toBe(true);
    expect(on.askLedgerOn).toBe(true);
  });

  it('auto asks again once, and never follows up its own follow-up', async () => {
    localStorage.setItem(ASK_LEDGER_KEY, 'auto');
    const prompts: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'claude' }] }));
      prompts.push(String(JSON.parse(String(init?.body)).prompt));
      return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'partly', askLedger: LEDGER }]);
    });
    const store = createAgentRunStore({ fetch: f });
    store.setHost({ sessionId: () => 's' });
    await store.start({ question: VOICE });
    await vi.waitFor(() => expect(store.get().runs.filter((r) => r.status === 'done')).toHaveLength(2));
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/^Your reply marked this request not done:/);
    expect(prompts[1]).toContain('weekly token total');
  });
});

describe('auto with Claude’s held turn', () => {
  it('asks again as soon as the run is answered with a request open, while the stream is still held open', async () => {
    localStorage.setItem(ASK_LEDGER_KEY, 'auto');
    const prompts: string[] = [];
    const enc = new TextEncoder();
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'claude' }] }));
      prompts.push(String(JSON.parse(String(init?.body)).prompt));
      if (prompts.length > 1) return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'ok' }]);
      /* The bridge answers, then holds: the stream never closes by itself. */
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify(chunk('The meter row is gone.'))}\n\n`));
          c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'acp:turn', state: 'answered', text: 'The meter row is gone.', askLedger: LEDGER })}\n\n`));
          (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    });
    const store = createAgentRunStore({ fetch: f });
    store.setHost({ sessionId: () => 's' });
    void store.start({ question: VOICE });
    await vi.waitFor(() => expect(prompts).toHaveLength(2), { timeout: 3000 });
    expect(prompts[1]).toMatch(/^Your reply marked this request not done:/);
    const first = store.get().runs.find((r) => r.prompt === VOICE)!;
    expect(first.askedAgain).toBe(true);
    expect(first.status).toBe('done');
  });
});

describe('the ask ledger after a relaunch', () => {
  it('a saved turn keeps its report, so "Not done" is still there', async () => {
    const { fromSavedRun } = await import('../agents/savedRuns');
    const run = fromSavedRun({ id: 't1', agentRef: 'claude', prompt: VOICE, text: 'The meter row is gone.', status: 'done', startedAt: 1, endedAt: 2, tools: [], askLedger: LEDGER }, 's')!;
    render(<AgentRunView run={run} now={10} repoRoot={null} onAnswer={() => undefined} onAskAgain={() => undefined} />);
    expect(screen.getByTestId('asks-open').textContent).toContain('weekly token total');
  });
});

describe('the ask ledger with Claude’s held turn', () => {
  it('a report that arrives after the run is answered is still folded in', () => {
    const run = runOf([
      chunk('The meter row is gone.'),
      { type: 'acp:turn', state: 'answered', text: 'The meter row is gone.' },
      { type: 'acp:result', stopReason: 'cancelled', text: 'The meter row is gone.', askLedger: LEDGER },
    ]);
    expect(run.answered).toBe(true);
    expect(run.askLedger?.open).toEqual([3]);
    render(<AgentRunView run={run} now={10} repoRoot={null} onAnswer={() => undefined} onAskAgain={() => undefined} />);
    expect(screen.getByTestId('asks-open').textContent).toContain('weekly token total');
  });

  it('the answered event carries the report when the server read it there', () => {
    const run = runOf([chunk('The meter row is gone.'), { type: 'acp:turn', state: 'answered', text: 'The meter row is gone.', askLedger: LEDGER }]);
    expect(run.askLedger?.open).toEqual([3]);
  });
});

describe('Ask again', () => {
  it('is spent after one use: a second click sends nothing and the button gives way to "Asked again"', async () => {
    const { askAgainFrom } = await import('../agents/askAgain');
    const prompts: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'claude' }] }));
      prompts.push(String(JSON.parse(String(init?.body)).prompt));
      return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'ok' }]);
    });
    const store = createAgentRunStore({ fetch: f });
    store.setHost({ sessionId: () => 's' });
    const first = await store.start({ question: VOICE });
    store.apply(first.id, { type: 'acp:result', stopReason: 'end_turn', text: 'partly', askLedger: LEDGER });
    const run = store.get().runs.find((r) => r.id === first.id)!;
    await askAgainFrom(store, run, 'again');
    expect(askAgainFrom(store, run, 'again')).toBeNull();
    expect(prompts.filter((p) => p === 'again')).toHaveLength(1);
    const after = store.get().runs.find((r) => r.id === first.id)!;
    render(<AgentRunView run={after} now={10} repoRoot={null} onAnswer={() => undefined} onAskAgain={() => undefined} />);
    expect(screen.queryByTestId('asks-again')).toBeNull();
    expect(screen.getByTestId('asks-asked').textContent).toBe('Asked again');
  });

  it('keeps a board node’s run in that node’s agent session', async () => {
    const { askAgainFrom } = await import('../agents/askAgain');
    const bodies: Record<string, unknown>[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'claude' }] }));
      bodies.push(JSON.parse(String(init?.body)));
      return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'ok' }]);
    });
    const store = createAgentRunStore({ fetch: f });
    store.setHost({ sessionId: () => 's', pinNode: () => 'orders' });
    const first = await store.start({ question: VOICE, nodeId: 'svc:orders', agentRef: 'claude' });
    await askAgainFrom(store, first, 'again');
    expect(bodies[1]).toMatchObject({ contextNodeId: 'svc:orders', sessionKey: 'ask-node::svc:orders::claude' });
  });
});
