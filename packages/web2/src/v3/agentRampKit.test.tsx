import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readGolden } from '../../test/support/replaySse';
import { agentDoing } from '../agents/agentActivity';
import { foldRunEvent } from '../agents/agentRunFold';
import { agentRuns, type AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { ToolCallCard } from '../chat/ToolCallCard';
import { readableToolTitle } from '../chat/commandLabel';
import { createStore, StoreProvider } from '../state';
import { V3App } from './V3App';
import { V3Chat } from './V3Chat';

/*
 * S2b, THE CHAT-LOGIC HALF OF THE RAMP KIT PARTS (the CSS is S4's).
 *
 *   - the thinking fold says "Thought for N s" (codex's own reasoning times,
 *     live edit-with-plan recording)
 *   - a block cursor ends the streaming text, and goes on settle
 *   - the status strip above the composer says what the agent is doing, with
 *     Stop; a running tool is named once on screen (its row), never twice
 *   - a running row carries the braille loader, a state dot, and no shimmer
 *
 * Runs are fed the recorded streams (acp fixtures/replay/sse, regenerated
 * from the recordings by the analyzer's replay test).
 */

type Json = Record<string, unknown>;

/** The runs pane and the composer slots are lazy chunks: under a loaded machine their first import can take seconds. */
const LAZY = { timeout: 10_000 };
vi.setConfig({ testTimeout: 20_000 });

const sessionUpdate = (e: Json): string | undefined => (((e.update as Json)?.update as Json) ?? {}).sessionUpdate as string | undefined;
const meta = (e: Json): Json | undefined => ((((e.update as Json)?.update as Json)?._meta as Json)?.sequence as Json) ?? undefined;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('/api/acp/capabilities')) return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      return new Promise<Response>(() => {});
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  agentRuns.patch((s) => ({ ...s, agents: {}, caps: {}, config: {} }));
});

function app(chat: string) {
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [{ id: chat, title: 'Agent chat', pinned: false, updatedAt: '2026-01-01' }], activeId: chat } as never);
  render(<V3App appStore={store} />);
  return store;
}

/** A stream that stays open until Stop aborts it. */
const openStream = (_: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

async function startIn(chat: string, events: Json[]) {
  await act(async () => {
    void agentRuns.start({ agentRef: 'codex', question: 'replay', access: 'ask', sessionId: chat }, openStream);
  });
  const id = agentRuns.get().runs.filter((r) => r.sessionId === chat).at(-1)!.id;
  feed(id, events);
  return id;
}

function feed(id: string, events: Json[]) {
  act(() => {
    for (const e of events) agentRuns.apply(id, e as RunNodeEvent);
  });
}

describe('the thinking fold', () => {
  it('live edit-with-plan: "Thinking" while codex reasons, then "Thought for 12.2 s" on codex\'s own clock', async () => {
    const events = readGolden('edit-with-plan');
    const start = events.findIndex((e) => sessionUpdate(e) === 'agent_thought_chunk' && meta(e)?.thought === 'start');
    const end = events.findIndex((e) => sessionUpdate(e) === 'agent_thought_chunk' && meta(e)?.thought === 'end');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    app('rk-thought');
    const id = await startIn('rk-thought', events.slice(0, start + 1));
    expect((await screen.findByTestId('agent-thought-label', {}, LAZY)).textContent).toBe('Thinking');
    feed(id, events.slice(start + 1, end + 1));
    expect(screen.getByTestId('agent-thought-label').textContent).toBe('Thought for 12.2 s');
    /* Every reasoning item with a measurable time is one fold, each closed by
       the end of the run. Codex stamps some with one time for start and end
       (no text, 0 ms): those say nothing and are not drawn. */
    feed(id, events.slice(end + 1));
    const at = new Map<string, number[]>();
    for (const e of events) {
      const m = sessionUpdate(e) === 'agent_thought_chunk' ? meta(e) : undefined;
      if (m) at.set(String(m.id), [...(at.get(String(m.id)) ?? []), m.at as number]);
    }
    const measurable = [...at.values()].filter(([a, b]) => b! - a! >= 100).length;
    expect(measurable).toBeGreaterThan(0);
    const labels = screen.getAllByTestId('agent-thought-label').map((n) => n.textContent);
    expect(labels).toHaveLength(measurable);
    expect(labels.every((l) => /^Thought for \d+\.\d s$/.test(l ?? ''))).toBe(true);
  });

  it('an ACP thought (text chunks, no times of its own) ends at the first answer token, on the clock', () => {
    const at = (sessionUpdate: string, text: string) => ({ type: 'acp:update', update: { update: { sessionUpdate, content: { type: 'text', text } } } }) as RunNodeEvent;
    let run = { id: 'r', sessionId: null, agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'q', status: 'running', startedAt: 0, endedAt: null, items: [], approvals: [], error: null } as AgentRun;
    run = foldRunEvent(run, at('agent_thought_chunk', 'Reading the plan. '), 1_000);
    run = foldRunEvent(run, at('agent_thought_chunk', 'Then the tests.'), 2_000);
    expect(agentDoing(run)).toBe('Thinking');
    run = foldRunEvent(run, at('agent_message_chunk', 'Here'), 4_500);
    expect(run.items.map((i) => i.kind)).toEqual(['thought', 'message']);
    expect(run.items[0]).toMatchObject({ text: 'Reading the plan. Then the tests.', endedAt: 4_500, ms: 3_500 });
    expect(agentDoing(run)).toBe('Writing');
  });

  it("Sequence's own turn: the fold says how long it thought, stopped at the first answer token", () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'why?' });
    store.dispatch({ type: 'turn/send', at: 1_000 });
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'Looking at the gateway.' }, at: 1_100 } as never);
    render(
      <StoreProvider store={store}>
        <V3Chat />
      </StoreProvider>,
    );
    expect(screen.getByTestId('v3-thinking-fold-label').textContent).toBe('Thinking');
    act(() => {
      store.dispatch({ type: 'turn/event', event: { type: 'delta', text: 'The gateway is hot because' }, at: 3_400 } as never);
    });
    expect(screen.getByTestId('v3-thinking-fold-label').textContent).toBe('Thought for 2.4 s');
    /* Settled: the turn keeps the time it thought, so its fold still says it. */
    act(() => {
      store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'The gateway is hot because of retries.' }, at: 9_000 } as never);
    });
    expect(screen.queryByTestId('v3-thinking-fold-label')).toBeNull();
    const settled = store.getState().session.turns.find((t) => t.role === 'assistant');
    expect(settled && settled.role === 'assistant' ? settled.thoughtMs : null).toBe(2_400);
    expect(screen.getByTestId('v3-turn-thought-label').textContent).toBe('Thought for 2.4 s');
  });

  it("Sequence's own turn that only thought: the settled fold measures to the turn's end", () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'why?' });
    store.dispatch({ type: 'turn/send', at: 1_000 });
    store.dispatch({ type: 'turn/event', event: { type: 'reasoning', text: 'Nothing to add.' }, at: 1_100 } as never);
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: '' }, at: 6_500 } as never);
    render(
      <StoreProvider store={store}>
        <V3Chat />
      </StoreProvider>,
    );
    expect(screen.getByTestId('v3-turn-thought-label').textContent).toBe('Thought for 5.5 s');
  });
});

describe('the block cursor', () => {
  it('ends the streaming text while the turn streams (codex\'s goal, usage and limits landing after it do not move it), and goes when the run settles', async () => {
    const events = readGolden('edit-with-plan');
    const firstText = events.findIndex((e) => sessionUpdate(e) === 'agent_message_chunk');
    /* Cut just before the next thought: codex's goal, usage and limits have landed after the text. */
    const kinds = events.map(sessionUpdate);
    const cut = kinds.findIndex((k, i) => i > firstText && k === 'agent_thought_chunk');
    expect(kinds.slice(firstText, cut)).toEqual(expect.arrayContaining(['plan_update', 'usage_update', 'session_info_update']));
    expect(kinds.slice(firstText, cut).some((k) => k === 'tool_call' || k === 'agent_thought_chunk')).toBe(false);
    app('rk-cursor');
    const id = await startIn('rk-cursor', events.slice(0, cut));
    const run = await screen.findByTestId('agent-run', {}, LAZY);
    const streaming = () => run.querySelectorAll('.s2-answer[data-streaming]');
    expect(streaming()).toHaveLength(1);
    expect([...run.querySelectorAll('.s2-answer')].at(-1)!.hasAttribute('data-streaming')).toBe(true);
    feed(id, events.slice(cut));
    expect(agentRuns.get().runs.find((r) => r.id === id)!.status).toBe('done');
    expect(streaming()).toHaveLength(0);
  });
});

describe('the status strip, and one place for the running tool', () => {
  it('command-approval: the status bar says "Running a command" and the send button is Stop; the command is named once, by its row, which carries the loader and no shimmer', async () => {
    const events = readGolden('command-approval');
    const call = events.findIndex((e) => sessionUpdate(e) === 'tool_call');
    expect(call).toBeGreaterThan(-1);
    const u = (events[call]!.update as Json).update as Json;
    const label = readableToolTitle(String(u.title), String(u.kind));
    app('rk-strip');
    await startIn('rk-strip', events.slice(0, call + 1));
    await screen.findByTestId('agent-card-tool', {}, LAZY);
    /* Decision 49: the agent's state is in the status bar; Stop is the composer's send button. */
    await waitFor(() => expect(screen.getByTestId('s2-status-state').textContent).toBe('Running a command'));
    expect(screen.getByTestId('composer-stop')).toBeTruthy();
    /* Exactly one element on screen names the running command. */
    expect(screen.getAllByText(label, { exact: false })).toHaveLength(1);
    const card = screen.getByTestId('agent-card-tool');
    expect(within(card).getAllByText(label, { exact: false })).toHaveLength(1);
    /* Round 11: the loader is the one ASCII spinner, not a CSS ring. */
    expect(within(within(card).getByTestId('agent-card-loader')).getByTestId('s2-ascii-spinner')).toBeTruthy();
    expect(within(card).getByTestId('agent-card-dot')).toBeTruthy();
    expect(document.querySelectorAll('.shimmer')).toHaveLength(0);
    /* Codex stamped this run's reasoning with one time for start and end: no "Thought for 0.0 s". */
    const thoughts = events.slice(0, call).filter((e) => sessionUpdate(e) === 'agent_thought_chunk').map(meta);
    expect(thoughts.map((m) => m?.at)).toEqual([thoughts[0]!.at, thoughts[0]!.at]);
    expect(screen.queryByTestId('agent-thought')).toBeNull();
  });

  it('the approval that follows reads "Waiting on you"; Stop drops the stream and the run ends "Stopped." with Retry', async () => {
    const events = readGolden('command-approval');
    const ask = events.findIndex((e) => e.type === 'acp:permission');
    app('rk-stop');
    const id = await startIn('rk-stop', events.slice(0, ask + 1));
    await waitFor(() => expect(screen.getByTestId('s2-status-state').textContent).toBe('Waiting on you'), LAZY);
    await act(async () => {
      fireEvent.click(screen.getByTestId('composer-stop'));
    });
    await waitFor(() => expect(agentRuns.get().runs.find((r) => r.id === id)!.status).toBe('failed'));
    const run = agentRuns.get().runs.find((r) => r.id === id)!;
    expect([run.error, run.recovery?.kind]).toEqual(['Stopped.', 'retry']);
    expect(screen.getByTestId('s2-status-state').getAttribute('data-state')).toBe('idle');
    /* The stopped run's call is no longer drawn as running. */
    expect(run.items.filter((i) => i.kind === 'tool').map((i) => (i.kind === 'tool' ? i.status : ''))).not.toContain('running');
    expect(screen.queryByTestId('agent-card-loader')).toBeNull();
  });
});

describe("Sequence's own running row", () => {
  it('carries the braille loader and no shimmer', () => {
    render(<ToolCallCard tool={{ id: 't1', name: 'search' }} running />);
    expect(screen.getByTestId('chat-tool-call-spinner').getAttribute('data-variant')).toBe('cell');
    expect(screen.getByTestId('chat-tool-call-spinner').className).toContain('braille');
    expect(document.querySelectorAll('.shimmer')).toHaveLength(0);
  });

  it('a running search is named once: by its row, not again by the bar above it', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'find the gateway' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'tool:start', id: 'w1', name: 'search' }, at: 2 } as never);
    render(
      <StoreProvider store={store}>
        <V3Chat />
      </StoreProvider>,
    );
    expect(screen.getAllByText(/Calling search|Searching/)).toHaveLength(1);
    expect(screen.getByTestId('v3-thinking-phase').textContent).toBe('Working');
  });
});
