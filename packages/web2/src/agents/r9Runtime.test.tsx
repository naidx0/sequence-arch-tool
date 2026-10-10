import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgentRunsList } from '../chat/AgentRunThread';
import { livePhrase } from '../chat/RunLiveStatus';
import { createAgentRunStore, type AgentRun } from './agentRuns';
import { CHAT_TITLE_EVENT, fromSavedRun, loadSavedRuns } from './savedRuns';

/*
 * ROUND 9 IN THE PAGE (Jaden's walkthrough, items 4 to 7), with a fake
 * bridge: a run-node stream this test writes into and never has to end,
 * which is exactly the bridge that holds a turn open after the answer.
 *   answered      Send comes back while the bridge holds the turn
 *   queued        a send behind a held turn says it is waiting, and for what
 *   Stop          frees the chat at once; whatever the agent sends after is ignored
 *   status        the live line names the phase and counts the seconds
 *   saved/titled  a relaunch puts the chat's agent turns back; the title travels
 */

type Json = Record<string, unknown>;

/** A run-node stream the test feeds; aborting the request errors the body, as a browser does. */
function heldBridge() {
  const enc = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: (c) => void (ctrl = c) });
  const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    if (input === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'claude' }] }), { status: 200 });
    init?.signal?.addEventListener('abort', () => {
      try {
        ctrl.error(new DOMException('aborted', 'AbortError'));
      } catch {
        /* already closed */
      }
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return {
    fetch,
    send: (e: Json) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)),
    end: () => ctrl.close(),
  };
}

const flush = async (): Promise<void> => {
  await act(async () => await new Promise((r) => setTimeout(r, 40)));
};

function liveRun(store: ReturnType<typeof createAgentRunStore>): AgentRun {
  return store.get().runs[store.get().runs.length - 1]!;
}

const chunk = (text: string): Json => ({ type: 'acp:update', update: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });

describe('round 9: agent turns that answer, queue, stop and come back', () => {

  it('answered: the run is done (Send is back) while the bridge still holds the turn; its late failure is a note', async () => {
    const b = heldBridge();
    const store = createAgentRunStore({ clock: () => 1000, fetch: b.fetch });
    const started = store.start({ question: 'What is the answer?', agentRef: 'claude', sessionId: 'chat-1' }, b.fetch);
    await flush();
    b.send(chunk('The answer is 42.'));
    b.send({ type: 'acp:status', phase: 'writing', forMs: 0, quietMs: 0, openTools: 1 });
    await flush();
    expect(liveRun(store).status).toBe('running');
    b.send({ type: 'acp:turn', state: 'answered', text: 'The answer is 42.' });
    await flush();
    const run = liveRun(store);
    expect(run.status).toBe('done');
    expect(run.answered).toBe(true);
    /* What the composer reads to show Send or Stop (V3Chat agentRunning). */
    expect(store.get().runs.some((r) => r.status === 'running' && r.sessionId === 'chat-1')).toBe(false);
    /* The bridge's background work fails later: a note, the answer stands. */
    b.send({ type: 'acp:error', error: 'The agent process exited (code 1)' });
    b.send({ type: 'acp:result', stopReason: 'end_turn', text: 'The answer is 42.' });
    b.end();
    const final = await started;
    expect(final.status).toBe('done');
    expect(final.items.some((i) => i.kind === 'note' && i.text.includes('background work'))).toBe(true);
    expect(final.items.filter((i) => i.kind === 'message')).toHaveLength(1);
  });

  it('queued: a send behind a held turn says it is waiting, with the seconds', async () => {
    const b = heldBridge();
    const store = createAgentRunStore({ clock: () => 1000, fetch: b.fetch });
    void store.start({ question: 'and then?', agentRef: 'claude', sessionId: 'chat-1' }, b.fetch);
    await flush();
    b.send({ type: 'acp:turn', state: 'queued' });
    b.send({ type: 'acp:status', phase: 'queued', forMs: 8000, quietMs: 0, openTools: 0 });
    await flush();
    const run = liveRun(store);
    expect(run.queued).toBe(true);
    expect(livePhrase(run, run.live!.at)?.text).toBe('Queued: waiting for Claude to finish the last turn, 8s');
    render(<AgentRunsList runs={[run]} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-run-live').getAttribute('data-phase')).toBe('queued');
    expect(screen.queryByTestId('agent-run-starting')).toBeNull();
    store.stop(run.id);
    await flush();
  });

  it('Stop frees the chat at once and nothing the agent sends after shows', async () => {
    const b = heldBridge();
    const store = createAgentRunStore({ clock: () => 1000, fetch: b.fetch });
    const started = store.start({ question: 'run the tests', agentRef: 'claude', sessionId: 'chat-1' }, b.fetch);
    await flush();
    b.send({ type: 'acp:update', update: { sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'pnpm test', kind: 'execute', status: 'in_progress' } } });
    await flush();
    const id = liveRun(store).id;
    store.stop(id);
    /* Synchronously: the bridge has not answered the cancel, and does not need to. */
    const stopped = store.get().runs.find((r) => r.id === id)!;
    expect(stopped.status).toBe('failed');
    expect(stopped.stopped).toBe(true);
    expect(stopped.error).toBe('Stopped.');
    expect(stopped.recovery).toEqual({ kind: 'retry' });
    expect(stopped.items.find((i) => i.kind === 'tool')).toMatchObject({ status: 'failed' });
    /* A late event from the agent changes nothing. */
    store.apply(id, chunk('late words'));
    store.apply(id, { type: 'acp:result', stopReason: 'cancelled', text: 'late words' });
    await flush();
    const after = await started;
    expect(after.status).toBe('failed');
    expect(after.items.some((i) => i.kind === 'message')).toBe(false);
  });

  it('status: the live line names each phase, and a quiet bridge reads as a warning', () => {
    const base: AgentRun = { id: 'r', sessionId: 'c', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'q', status: 'running', startedAt: 0, endedAt: null, items: [], approvals: [], error: null };
    const at = (phase: string, forMs: number, tool: AgentRun['live'] extends infer L ? (L extends { tool: infer T } ? T : never) : never = null) => ({ ...base, live: { phase, forMs, quietMs: 0, openTools: tool ? 1 : 0, tool, at: 10_000 } });
    expect(livePhrase(at('waiting', 3000), 10_000)?.text).toBe('Waiting for Claude, 3s');
    expect(livePhrase(at('waiting', 3000), 12_000)?.text).toBe('Waiting for Claude, 5s');
    expect(livePhrase(at('tool', 41_000, { kind: 'execute', title: 'pnpm test' }), 10_000)?.text).toBe('Running: pnpm test, 41s');
    expect(livePhrase(at('approval', 0), 10_000)?.text).toBe('Waiting for your answer');
    const quiet = livePhrase(at('quiet', 75_000), 10_000)!;
    expect(quiet.text).toBe('Claude has been quiet for 1m 15s. Stop frees the chat');
    expect(quiet.tone).toBe('warn');
    expect(livePhrase({ ...base, status: 'done' }, 0)).toBeNull();
  });

  it('saved: a relaunch reads the chat\'s agent turns back, and the chat talks to its agent again', async () => {
    const calls: string[] = [];
    const f = async (input: string): Promise<Response> => {
      calls.push(input);
      return new Response(
        JSON.stringify({
          runs: [
            { id: 't1', agentRef: 'claude', prompt: 'Explain auth', text: '## Auth\nIt uses JWT.', status: 'done', error: null, stopReason: 'end_turn', startedAt: 5, endedAt: 9, model: 'opus', nodeId: null, tools: [{ id: 'x', title: 'Read auth.ts', toolKind: 'read', status: 'done' }] },
            { id: 't2', agentRef: 'claude', prompt: 'and tests?', text: '', status: 'stopped', error: 'Stopped.', stopReason: null, startedAt: 10, endedAt: 12, model: null, nodeId: null, tools: [] },
            { nonsense: true },
          ],
        }),
        { status: 200 },
      );
    };
    const saved = await loadSavedRuns('chat-9', f);
    expect(calls).toEqual(['/api/acp/runs?chatId=chat-9']);
    expect(saved.map((r) => [r.prompt, r.status, r.restored])).toEqual([
      ['Explain auth', 'done', true],
      ['and tests?', 'failed', true],
    ]);
    expect(saved[0]!.items.map((i) => i.kind)).toEqual(['tool', 'message']);
    expect(saved[1]!.stopped).toBe(true);

    const store = createAgentRunStore();
    store.hydrate('chat-9', saved);
    expect(store.get().runs.filter((r) => r.sessionId === 'chat-9')).toHaveLength(2);
    expect(store.get().agents?.['chat-9']).toBe('claude');
    /* Hydrating again with the same saved runs adds nothing (merged by run id). */
    store.hydrate('chat-9', saved!);
    expect(store.get().runs).toHaveLength(2);
    render(<AgentRunsList runs={store.get().runs} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getAllByTestId('agent-run')).toHaveLength(2);
    expect(screen.getByText('It uses JWT.')).toBeTruthy();
  });

  it('titled: the server\'s title for the chat reaches the page', async () => {
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(CHAT_TITLE_EVENT, on);
    try {
      const b = heldBridge();
      const store = createAgentRunStore({ clock: () => 1000, fetch: b.fetch });
      const started = store.start({ question: 'hi', agentRef: 'claude', sessionId: 'chat-3' }, b.fetch);
      await flush();
      b.send({ type: 'acp:title', title: 'Repository overview' });
      b.send({ type: 'acp:log', log: { outcome: 'ended', ms: 1200, tools: 0, entries: [{ t: 0, ev: 'asked' }, { t: 1200, ev: 'answered' }] } });
      b.send({ type: 'acp:result', stopReason: 'end_turn', text: 'Hello' });
      b.end();
      const run = await started;
      expect(seen).toEqual([{ sessionId: 'chat-3', title: 'Repository overview' }]);
      expect(run.log?.outcome).toBe('ended');
      render(<AgentRunsList runs={[run]} repoRoot={null} onAnswer={() => {}} />);
      expect(screen.getByTestId('agent-run-log').textContent).toContain('Turn details: ended');
    } finally {
      window.removeEventListener(CHAT_TITLE_EVENT, on);
    }
  });
});
