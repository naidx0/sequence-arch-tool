import { describe, expect, it, vi } from 'vitest';

import { changesForApproval, foldRunEvent } from './agentRunFold';
import { createAgentRunStore, restoreAgentTranscript, tokenTotalsBySession, transcriptForRestore, type AgentRun } from './agentRuns';
import { fromChatMemory } from '../sessions/chatMemory';
import type { RunNodeEvent } from './runNodeStream';
import fs from 'node:fs';

const blank = (): AgentRun => ({
  id: 'r',
  sessionId: null,
  agentRef: 'codex',
  nodeId: null,
  nodeLabel: null,
  prompt: 'q',
  status: 'running',
  startedAt: 0,
  endedAt: null,
  items: [],
  approvals: [],
  error: null,
});

/* The server forwards ACP's notification whole: { sessionId, update }. */
const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });

const FILE_ITEM = {
  type: 'fileChange',
  id: 'item-1',
  status: 'inProgress',
  changes: [{ path: '/repo/hello.txt', kind: { type: 'add' }, diff: 'hello\n' }],
};

describe('folding a run', () => {
  it('reopen maps saved prose once: retained browser runs suppress matching disk rows; restart keeps them', () => {
    const saved = { version: 1, sessionId: 's', turns: [
      { role: 'user', text: 'question', at: '2026-10-07T12:00:00Z', agentTurn: { id: 't' } },
      { role: 'assistant', text: 'answer', at: '2026-10-07T12:00:01Z', agentTurn: { id: 't' } },
      { role: 'user', text: 'another question' },
    ] };
    expect(fromChatMemory(transcriptForRestore(saved, [{ ...blank(), sessionId: 's', transcriptId: 't' }])).map(t => t.text)).toEqual(['another question']);
    expect(fromChatMemory(transcriptForRestore(saved, [])).map(t => t.text)).toEqual(['question', 'answer', 'another question']);
    expect(fromChatMemory(transcriptForRestore(saved, [{ ...blank(), sessionId: 'other', transcriptId: 't' }]))).toHaveLength(3);
  });
  it('counts cumulative thread totals once, including cache counts, and sums distinct ACP turns', () => {
    const counts = { inputTokens: 100, outputTokens: 10, cachedReadTokens: 30, cachedWriteTokens: 5 };
    const a = { ...blank(), id: 'a', sessionId: 's', tokens: { ...counts, scope: 'thread' as const, threadId: 'one' } };
    const b = { ...a, id: 'b', tokens: { ...a.tokens, inputTokens: 200 } };
    const c = { ...a, id: 'c', agentRef: 'claude', tokens: { ...counts, scope: 'turn' as const } };
    expect(tokenTotalsBySession([a, b, c])).toEqual({ s: { inputTokens: 300, outputTokens: 20, cachedReadTokens: 60, cachedWriteTokens: 10 } });
  });
  it('heartbeat silence is visible, clears on agent activity, and never completes an answer', () => {
    let run = foldRunEvent(blank(), upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } }), 10);
    run = foldRunEvent(run, { type: 'acp:waiting', reason: 'quiet', lastEventAt: 10, quietMs: 40_000, stalled: true } as unknown as RunNodeEvent, 40_010);
    expect(run).toMatchObject({ lastEventAt: 10, stalled: { since: 10, reason: 'No agent events for 40s' }, waiting: { reason: 'quiet' }, status: 'running' });
    run = foldRunEvent(run, upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' world' } }), 40_020);
    expect(run).toMatchObject({ lastEventAt: 40_020, stalled: null, waiting: null, status: 'running' });
  });
  it('an explicit final answer can complete while the bridge is still running', () => {
    const run = foldRunEvent(blank(), upd({ sessionUpdate: 'session_info_update', _meta: { sequence: { answerComplete: true, evidence: 'codex.final_answer.completed' } } }), 50);
    expect(run).toMatchObject({ answerComplete: true, status: 'running' });
    expect(run.turn).toBeUndefined();
    expect(foldRunEvent(run, { type: 'acp:turn', state: 'settled' }, 60).turn).toBe('settled');
  });
  it('empty and whitespace-only end_turn results fail visibly; a prose answer succeeds', () => {
    for (const text of ['', '  \n']) {
      const streamed = foldRunEvent(blank(), upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }), 5);
      const run = foldRunEvent(streamed, { type: 'acp:result', stopReason: 'end_turn', text }, 10);
      expect(run).toMatchObject({ status: 'failed', answerComplete: false, endedWithoutAnswer: true, error: 'The agent ended without an answer (end_turn).' });
    }
    expect(foldRunEvent(blank(), { type: 'acp:result', stopReason: 'end_turn', text: 'answer' }, 10).status).toBe('done');
  });
  it('usage tokens are separate from context usage', () => {
    const run = foldRunEvent(blank(), { type: 'acp:tokens', tokens: { inputTokens: 100, outputTokens: 20, cachedReadTokens: 30, cachedWriteTokens: 5, scope: 'turn' } } as unknown as RunNodeEvent, 50);
    expect(run).toMatchObject({ tokens: { inputTokens: 100, outputTokens: 20, scope: 'turn' } });
    expect(run.usage).toBeUndefined();
  });
  it('text, a tool call with its duration, a plan, an approval and the result, in arrival order', () => {
    const events: [RunNodeEvent, number][] = [
      [upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Looking ' } }), 10],
      [upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'now.' } }), 20],
      [upd({ sessionUpdate: 'tool_call', toolCallId: 'item-1', title: 'Edit /repo/hello.txt', kind: 'edit', status: 'in_progress', rawInput: FILE_ITEM }), 100],
      [upd({ sessionUpdate: 'plan', entries: [{ content: 'write it', status: 'in_progress' }] }), 110],
      [
        {
          type: 'acp:permission',
          toolCallId: 'item-1',
          requestId: 'q1',
          pending: true,
          decision: null,
          toolKind: 'edit',
          title: 'Edit /repo/hello.txt',
          proposal: { proposalId: 'q1', title: 'Edit /repo/hello.txt', rationale: null, files: [{ path: '/repo/hello.txt', diff: 'hello\n' }] },
        },
        150,
      ],
      [{ type: 'acp:permission', requestId: 'q1', pending: false, decision: 'allow', answeredBy: 'person' }, 400],
      [upd({ sessionUpdate: 'tool_call_update', toolCallId: 'item-1', status: 'completed', rawOutput: {} }), 900],
      [upd({ sessionUpdate: 'plan', entries: [{ content: 'write it', status: 'completed' }] }), 950],
      [{ type: 'acp:result', stopReason: 'end_turn', text: 'Looking now.' }, 1000],
    ];
    let run = blank();
    for (const [e, at] of events) run = foldRunEvent(run, e, at);
    expect(run.items.map((i) => i.kind)).toEqual(['message', 'tool', 'plan', 'approval']);
    expect(run.items[0]).toMatchObject({ kind: 'message', text: 'Looking now.' });
    expect(run.items[1]).toMatchObject({ kind: 'tool', status: 'done', startedAt: 100, endedAt: 900, toolKind: 'edit' });
    expect(run.items[2]).toMatchObject({ kind: 'plan', startedAt: 110, endedAt: 950 });
    expect(run.items[3]).toMatchObject({ kind: 'approval', id: 'q1', at: 150, settledAt: 400 });
    expect(run.approvals[0]).toMatchObject({ decision: 'allow', toolCallId: 'item-1' });
    /* The change set the approval is about, with its kind, from the tool call. */
    expect(changesForApproval(run, run.approvals[0])).toEqual([{ path: '/repo/hello.txt', kind: 'add', diff: 'hello\n', movePath: null }]);
    /* The streamed text is the answer; the result's copy of it is not added twice. */
    expect(run).toMatchObject({ status: 'done', endedAt: 1000 });
  });

  it('a result with no streamed text becomes the message; an error fails the run', () => {
    const done = foldRunEvent(blank(), { type: 'acp:result', text: 'Only this.' }, 5);
    expect(done.items).toEqual([{ kind: 'message', id: 'm0', text: 'Only this.' }]);
    const failed = foldRunEvent(blank(), { type: 'acp:error', error: 'agent exited' }, 5);
    expect(failed).toMatchObject({ status: 'failed', error: 'agent exited', endedAt: 5 });
  });
});

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

describe('the run store', () => {
  it('recorded Compact completes its operation without claiming an answer', async () => {
    const recorded = fs.readFileSync('../acp/src/test/fixtures/replay/sse-s2b/compact.sse.jsonl', 'utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
    // codex-s2b/compact.jsonl produces this empty end_turn; operation is not prose.
    const store = createAgentRunStore({ fetch: async () => sse(recorded) });
    const run = await store.start({ agentRef: 'codex', question: '', compact: true });
    expect(run).toMatchObject({ status: 'done', answerComplete: false, endedWithoutAnswer: false });
  });
  it('restores persisted token totals across restart without doubling retained live runs', async () => {
    const tokens = { inputTokens: 100, outputTokens: 10, cachedReadTokens: 30, cachedWriteTokens: 5, scope: 'turn' as const };
    const store = createAgentRunStore({ fetch: async () => sse([{ type: 'acp:transcript', turnId: 't' }, { type: 'acp:tokens', tokens }, { type: 'acp:result', stopReason: 'end_turn', text: 'answer' }]) });
    await store.start({ agentRef: 'claude', sessionId: 's', question: 'q' });
    const doc = { version: 1, sessionId: 's', turns: [{ role: 'assistant', text: 'answer', agentTurn: { id: 't', agentRef: 'claude', tokens } }] };
    restoreAgentTranscript(doc, store);
    expect(store.get().tokensBySession?.s.inputTokens).toBe(100);
    const restarted = createAgentRunStore(); restoreAgentTranscript(doc, restarted);
    expect(restarted.get().tokensBySession?.s).toMatchObject({ inputTokens: 100, outputTokens: 10 });
  });
  it('Stop immediately frees the composer even while transport discovery is pending', async () => {
    let reply!: (r: Response) => void;
    const store = createAgentRunStore({ fetch: async () => new Promise<Response>(r => { reply = r; }) });
    const work = store.start({ question: 'q' });
    await vi.waitFor(() => expect(reply).toBeTypeOf('function'));
    store.stop(store.get().runs[0].id);
    await vi.waitFor(() => expect(store.get().runs[0]).toMatchObject({ status: 'failed', error: 'Stopped.' }));
    reply(new Response(JSON.stringify({ agents: [{ id: 'codex' }] })));
    expect((await work).status).toBe('failed');
  });
  it('belongs to the open thread, pins its node through the chat host, and streams to the end', async () => {
    const f = vi.fn(async (url: string) =>
      url === '/api/acp/agents'
        ? new Response(JSON.stringify({ agents: [{ id: 'codex' }] }))
        : sse([
            { type: 'acp:update', update: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi.' } } } },
            { type: 'acp:result', stopReason: 'end_turn', text: 'Hi.' },
          ]),
    );
    const store = createAgentRunStore({ fetch: f });
    const pinNode = vi.fn(() => 'orders');
    store.setHost({ sessionId: () => 'thread-7', pinNode });
    const run = await store.start({ nodeId: 'svc:orders', access: 'ask' });
    expect(pinNode).toHaveBeenCalledWith('svc:orders');
    expect(run).toMatchObject({ sessionId: 'thread-7', nodeLabel: 'orders', agentRef: 'codex', status: 'done' });
    expect(run.items).toEqual([{ kind: 'message', id: 'm0', text: 'Hi.' }]);
    const body = JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(body).toMatchObject({ agentRef: 'codex', contextNodeId: 'svc:orders', permissionMode: 'propose', interactivePermissions: true });
  });

  it('no registered agent fails the run with the way to add one', async () => {
    const store = createAgentRunStore({ fetch: async () => new Response(JSON.stringify({ agents: [] })) });
    const run = await store.start({ question: 'hi' });
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/sequence agent add/);
  });

  it('an answer the server refuses gives the buttons back', async () => {
    /* The server's answer is held until the card has been seen answering:
       "at once" means before the server replies (the marking lives in the
       lazy runner, which a run has always loaded by the time it asks). */
    let reply!: (r: Response) => void;
    const store = createAgentRunStore({ fetch: () => new Promise<Response>((r) => (reply = r)) });
    store.setHost({ sessionId: () => null });
    void store.start({ agentRef: 'x', question: 'q' }, async () => new Promise<Response>(() => {}));
    const id = store.get().runs[0].id;
    store.apply(id, { type: 'acp:permission', requestId: 'p', pending: true, decision: null, proposal: { files: [] } });
    const answering = store.answer(id, 'p', 'allow');
    await vi.waitFor(() => expect(store.get().runs[0].approvals[0].sending).toBe('allow'));
    expect(reply, 'shown as answering before the server has replied').toBeTypeOf('function');
    reply(new Response('{}', { status: 404 }));
    await answering;
    expect(store.get().runs[0].approvals[0].sending).toBeNull();
  });
});
