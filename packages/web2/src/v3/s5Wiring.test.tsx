import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SSE_GOLDEN, readGolden } from '../../test/support/replaySse';
import { agentRuns } from '../agents/agentRuns';
import '../agents/agentRunFold';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { chatQueueKey, promptQueue } from '../composer/promptQueue';
import { feedbackLine } from '../composer/rejectFeedback';
import { approvalTitle } from '../chat/AgentRunThread';
import { createStore } from '../state';
import { V3App } from './V3App';

/*
 * S5 WIRED INTO THE CHAT (V3Chat, ApprovalGate, AgentRunThread):
 *
 *   steer      Enter while the chat's agent runs posts /api/acp/steer with
 *              that run's run-node key; a yes is the end of it
 *   refused    a no (codex refused, ACP has no steer) queues the words, and
 *              the queue sends them as the next turn once this one settles
 *   queue      Tab, or the Queue button, waits in the editable list; two go
 *              first to last, one per settled turn
 *   recall     Up in an empty field brings back the last prompt
 *   deny       "Deny with reason…" answers Deny first, then sends the reason
 *
 * The words and the server's answers are the codex-s5 fixtures' (not run
 * live) as the analyzer's acp-s5-steer-server test plays them through the
 * real route: steer-mid-turn answers { steered: true }, steer-refused-then-
 * queued { steered: false, reason: 'not-steerable' }.
 */

type Json = Record<string, unknown>;

const S5 = path.join(SSE_GOLDEN, '..', 'codex-s5');
const steerTextOf = (name: string): string => {
  const frames = fs.readFileSync(path.join(S5, `${name}.jsonl`), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as Json);
  const steer = frames.find((f) => (f.msg as Json | undefined)?.method === 'turn/steer')!;
  return (((steer.msg as Json).params as Json).input as Json[])[0]!.text as string;
};
/* queue-two-in-order's two texts, as its builder (acp replay/codexS5Fixtures.ts) names them. */
const QUEUED = (() => {
  const src = fs.readFileSync(path.join(SSE_GOLDEN, '..', '..', '..', '..', 'replay', 'codexS5Fixtures.ts'), 'utf8');
  return JSON.parse(src.match(/export const QUEUED = (\[[^\]]*\])/)![1]!.replace(/'/g, '"')) as string[];
})();

const LAZY = { timeout: 10_000 };
vi.setConfig({ testTimeout: 20_000 });

let calls: { url: string; body: Json }[] = [];
let steerAnswer: { status: number; body: Json } = { status: 200, body: { steered: true } };

beforeEach(() => {
  calls = [];
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? (JSON.parse(String(init.body)) as Json) : {};
      calls.push({ url, body });
      if (url.startsWith('/api/acp/steer')) return new Response(JSON.stringify(steerAnswer.body), { status: steerAnswer.status, headers: { 'content-type': 'application/json' } });
      if (url.startsWith('/api/acp/permission')) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
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

/** A codex run in `chat` that stays open (its stream never ends) until it is fed an end. */
async function running(chat: string, events: Json[] = []): Promise<string> {
  await act(async () => {
    void agentRuns.start({ agentRef: 'codex', question: 'Fix the failing parser test.', access: 'ask', sessionId: chat }, () => new Promise<Response>(() => {}));
  });
  const id = agentRuns.get().runs.filter((r) => r.sessionId === chat).at(-1)!.id;
  act(() => {
    for (const e of events) agentRuns.apply(id, e as RunNodeEvent);
  });
  return id;
}
const end = (id: string) => act(() => agentRuns.apply(id, { type: 'acp:result', text: 'Done.' } as RunNodeEvent));

const key = async (k: string, text: string, extra: Partial<KeyboardEventInit> = {}) => {
  const field = screen.getByTestId('composer-field');
  fireEvent.change(field, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(field, { key: k, ...extra });
    await Promise.resolve();
  });
};
/** Run-node turns the page started after the first (the first is started with its own fetch). */
const runNodePosts = () => calls.filter((c) => c.url.startsWith('/api/acp/run-node')).map((c) => c.body.prompt);
const clearQueue = (k: string) => {
  for (const i of promptQueue.items(chatQueueKey(null, k))) promptQueue.remove(chatQueueKey(null, k), i.id);
};

describe('S5 in the chat', () => {
  it('steer-mid-turn: Enter while the agent runs posts the words to /api/acp/steer with the run-node key; steered, nothing is queued', async () => {
    steerAnswer = { status: 200, body: { steered: true, turnId: 'turn-steer-1' } };
    const text = steerTextOf('steer-mid-turn');
    app('s5-steer');
    await running('s5-steer');
    await key('Enter', text);
    await waitFor(() => expect(calls.some((c) => c.url === '/api/acp/steer')).toBe(true), LAZY);
    expect(calls.find((c) => c.url === '/api/acp/steer')!.body).toEqual({ sessionKey: 'chat::s5-steer::codex', text });
    expect(promptQueue.items(chatQueueKey(null, 's5-steer'))).toEqual([]);
    expect((screen.getByTestId('composer-field') as HTMLTextAreaElement).value).toBe('');
    expect(runNodePosts()).toEqual([]);
  });

  it('steer-refused-then-queued: codex says no, the words wait in the queue and go as the next turn once this one settles', async () => {
    steerAnswer = { status: 200, body: { steered: false, reason: 'not-steerable' } };
    const text = steerTextOf('steer-refused-then-queued');
    app('s5-refused');
    const id = await running('s5-refused');
    await key('Enter', text);
    await waitFor(() => expect(promptQueue.items(chatQueueKey(null, 's5-refused')).map((i) => i.text)).toEqual([text]), LAZY);
    expect((await screen.findByTestId('prompt-queue', {}, LAZY)).textContent).toContain(text);
    expect(runNodePosts()).toEqual([]);
    await end(id);
    await waitFor(() => expect(runNodePosts()).toEqual([text]), LAZY);
    expect(promptQueue.items(chatQueueKey(null, 's5-refused'))).toEqual([]);
  });

  it('queue-two-in-order: Tab queues while the agent runs; the two go first to last, one per settled turn', async () => {
    app('s5-queue');
    const first = await running('s5-queue');
    await key('Tab', QUEUED[0]!);
    await key('Tab', QUEUED[1]!);
    expect(within(await screen.findByTestId('prompt-queue', {}, LAZY)).getAllByTestId('prompt-queue-item').map((n) => n.textContent)).toEqual([
      expect.stringContaining(QUEUED[0]!),
      expect.stringContaining(QUEUED[1]!),
    ]);
    expect(calls.some((c) => c.url === '/api/acp/steer')).toBe(false);
    await end(first);
    await waitFor(() => expect(runNodePosts()).toEqual([QUEUED[0]]), LAZY);
    /* The second waits for the turn the first started. */
    const second = agentRuns.get().runs.filter((r) => r.sessionId === 's5-queue').at(-1)!;
    expect(second.prompt).toBe(QUEUED[0]);
    await end(second.id);
    await waitFor(() => expect(runNodePosts()).toEqual([QUEUED[0], QUEUED[1]]), LAZY);
    clearQueue('s5-queue');
  });

  it("the Queue button (Sequence's own turn running) puts the words in the editable queue", () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });
    store.dispatch({ type: 'turn/send', at: 1 });
    render(<V3App appStore={store} />);
    const k = store.getState().session.activeId ?? 'none';
    fireEvent.change(screen.getByTestId('composer-field'), { target: { value: 'and check the cache too' } });
    fireEvent.click(screen.getByTestId('composer-queue'));
    expect(promptQueue.items(chatQueueKey(null, k)).map((i) => i.text)).toEqual(['and check the cache too']);
    expect(store.getState().session.queued ?? null).toBeNull();
    clearQueue(k);
  });

  it.each([
    { state: 'a turn runs, words in the field, no popup', running: true, text: 'and check the cache too', queues: true },
    { state: 'nothing runs', running: false, text: 'and check the cache too', queues: false },
    { state: 'the field is empty', running: true, text: '', queues: false },
    { state: 'the / popup is open', running: true, text: '/', queues: false },
  ])('Tab queues only while a turn runs with words and no popup open: $state', ({ running: run, text, queues }) => {
    const store = createStore({});
    if (run) {
      store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });
      store.dispatch({ type: 'turn/send', at: 1 });
    }
    render(<V3App appStore={store} />);
    const k = store.getState().session.activeId ?? 'none';
    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    fireEvent.change(field, { target: { value: text } });
    if (text === '/') expect(screen.getByTestId('v3-slash')).toBeTruthy();
    /* fireEvent returns false when the handler prevented the default. */
    const kept = fireEvent.keyDown(field, { key: 'Tab' });
    expect(kept).toBe(!queues);
    expect(promptQueue.items(chatQueueKey(null, k)).map((i) => i.text)).toEqual(queues ? [text] : []);
    if (!queues) expect(field.value).toBe(text);
    if (text === '/') expect(screen.getByTestId('v3-slash')).toBeTruthy();
    clearQueue(k);
  });

  it('Up in an empty field brings back the last prompt; with words in it, Up is the caret\'s', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });
    store.dispatch({ type: 'turn/send', at: 1 });
    render(<V3App appStore={store} />);
    fireEvent.click(screen.getByTestId('composer-stop'));
    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    expect(field.value).toBe('');
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(field.value).toBe('why is the gateway hot?');
    fireEvent.change(field, { target: { value: 'half typed' } });
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(field.value).toBe('half typed');
  });

  it('command-approval: "Deny with reason…" answers Deny first, then sends the reason (steered into codex\'s turn)', async () => {
    steerAnswer = { status: 200, body: { steered: true, turnId: 't' } };
    const events = readGolden('command-approval');
    const ask = events.findIndex((e) => e.type === 'acp:permission');
    app('s5-deny');
    const id = await running('s5-deny', events.slice(0, ask + 1));
    const open = await screen.findByTestId('agent-deny-reason', {}, LAZY);
    fireEvent.click(open);
    const field = within(screen.getByTestId('agent-deny-reason-form')).getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Do not write files from node -e; edit the file instead.' } });
    await act(async () => {
      fireEvent.keyDown(field, { key: 'Enter' });
      await Promise.resolve();
    });
    await waitFor(() => expect(calls.some((c) => c.url === '/api/acp/steer')).toBe(true), LAZY);
    const order = calls.filter((c) => c.url === '/api/acp/permission' || c.url === '/api/acp/steer').map((c) => c.url);
    expect(order).toEqual(['/api/acp/permission', '/api/acp/steer']);
    expect(calls.find((c) => c.url === '/api/acp/permission')!.body.decision).toBe('deny');
    const approval = agentRuns.get().runs.find((r) => r.id === id)!.approvals[0]!;
    expect(calls.find((c) => c.url === '/api/acp/steer')!.body).toEqual({
      sessionKey: 'chat::s5-deny::codex',
      text: feedbackLine('Do not write files from node -e; edit the file instead.', approvalTitle(approval, null)),
    });
  });
});
