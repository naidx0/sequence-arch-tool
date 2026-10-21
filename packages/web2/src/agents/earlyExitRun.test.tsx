import fs from 'node:fs';
import path from 'node:path';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { describe, expect, it } from 'vitest';

import { SSE_GOLDEN } from '../../test/support/replaySse';
import { AgentRunsList } from '../chat/AgentRunThread';
import { createAgentRunStore, type AgentRunStore } from './agentRuns';
import { runCallbacks } from '../chat/AgentRunsPane';
import { createStore } from '../state';

/*
 * ROUND 7, A2, IN THE PAGE: "ACP agent failed. ACP connection closed. Retry
 * doesn't work well. There's no loading. It fails loud."
 *
 * The two streams the real server sent (analyzer agent-early-exit.test.ts):
 * an agent that died while starting, then the same chat's Retry answering.
 * While the agent starts the run says so by name; the failure is one notice
 * with the agent's own reason and one Retry; Retry runs again and answers,
 * and the failed card does not offer a second Retry.
 */

type Json = Record<string, unknown>;

const golden = (name: string): Json[] =>
  fs
    .readFileSync(path.join(SSE_GOLDEN, '..', 'sse-r7', `${name}.sse.jsonl`), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Json);

function twoTurnFetch() {
  const enc = new TextEncoder();
  const streams = [golden('agent-exits-on-start'), golden('agent-retry-answers')];
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let runs = 0;
  const fetchImpl = async (input: string): Promise<Response> => {
    if (input === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'claude' }] }), { status: 200 });
    if (input.startsWith('/api/acp/run-node')) {
      const n = runs++;
      const events = streams[n]!;
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          /* The first turn holds before its first event: the agent is starting. */
          if (n === 0 && i === 0) await held;
          if (i >= events.length) return controller.close();
          controller.enqueue(enc.encode(`data: ${JSON.stringify(events[i++])}\n\n`));
        },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response('{}', { status: 200 });
  };
  return { fetch: fetchImpl, release, runs: () => runs };
}

function Runs({ store }: { store: AgentRunStore }) {
  const st = useSyncExternalStore(store.subscribe, store.get, store.get);
  const cb = runCallbacks(store, createStore({}));
  return <AgentRunsList runs={st.runs} repoRoot={null} onAnswer={() => {}} onRetry={cb.onRetry} />;
}

describe('an agent that dies while starting', () => {
  it('shows it is starting, then one notice with the real reason, and Retry answers', async () => {
    const f = twoTurnFetch();
    const store = createAgentRunStore({ clock: () => 1000, fetch: f.fetch });
    render(<Runs store={store} />);
    let first!: Promise<unknown>;
    act(() => {
      first = store.start({ question: 'hello', agentRef: 'claude', access: 'ask', sessionId: 'chat-1' }, f.fetch);
    });

    /* Loading: the run names the agent while it starts. */
    const starting = await screen.findByTestId('agent-run-starting');
    expect(within(starting).getByTestId('chat-status-text').textContent).toBe('Starting Claude');
    expect(starting.getAttribute('data-phase')).toBe('starting');

    await act(async () => {
      f.release();
      await first;
    });
    expect(screen.queryByTestId('agent-run-starting')).toBeNull();

    /* One notice: what happened, the agent's own reason, one Retry. */
    const card = screen.getByTestId('agent-recovery');
    expect(card.getAttribute('role')).toBe('status');
    expect(card.className).toContain('agnote');
    expect(within(card).getByTestId('agent-recovery-why').textContent).toBe('Claude quit unexpectedly.');
    expect(within(card).getByTestId('agent-run-error').textContent).toBe('The agent process exited (code 3): Error: Cannot find module @anthropic-ai/claude-agent-sdk');
    expect(card.textContent).not.toMatch(/connection closed/i);
    expect(screen.getAllByTestId('agent-recovery-retry')).toHaveLength(1);

    await act(async () => {
      fireEvent.click(within(card).getByTestId('agent-recovery-retry'));
    });
    await waitFor(() => expect(store.get().runs.at(-1)?.status).toBe('done'));
    expect(f.runs()).toBe(2);
    expect(store.get().runs.at(-1)?.items.length).toBeGreaterThan(0);

    /* The failed card no longer offers a second Retry. */
    expect(screen.queryAllByTestId('agent-recovery-retry')).toHaveLength(0);
    expect(within(card).getByTestId('agent-recovery-retried').textContent).toBe('Retrying below');

    /* The flag lives in the run, so a remount (a virtualised row scrolling back in) keeps it. */
    expect(store.get().runs[0]?.retried).toBe(true);
    cleanup();
    render(<Runs store={store} />);
    expect(screen.queryAllByTestId('agent-recovery-retry')).toHaveLength(0);
    expect(screen.getByTestId('agent-recovery-retried')).toBeTruthy();
    /* A second press (a stale handler) starts nothing. */
    const before = f.runs();
    runCallbacks(store, createStore({})).onRetry(store.get().runs[0]!);
    expect(f.runs()).toBe(before);
  });

  it('a failure the server did not classify still offers Retry', async () => {
    const enc = new TextEncoder();
    const fetchImpl = async (input: string): Promise<Response> => {
      if (input.startsWith('/api/acp/run-node')) {
        const body = new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'acp:error', error: 'socket hang up' })}\n\n`));
            c.close();
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response('{}', { status: 200 });
    };
    const store = createAgentRunStore({ clock: () => 1000, fetch: fetchImpl });
    await store.start({ question: 'q', agentRef: 'codex', access: 'ask', sessionId: 'chat-1' }, fetchImpl);
    render(<Runs store={store} />);
    const card = screen.getByTestId('agent-recovery');
    expect(card.getAttribute('data-kind')).toBe('retry');
    expect(within(card).getByTestId('agent-run-error').textContent).toBe('socket hang up');
    expect(within(card).getByTestId('agent-recovery-retry')).toBeTruthy();
  });
});
