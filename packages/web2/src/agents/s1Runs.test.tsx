import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SSE_GOLDEN, replayFetch } from '../../test/support/replaySse';
import { AgentRunsList } from '../chat/AgentRunThread';
import { createAgentRunStore, type AgentRun } from './agentRuns';

/* The sign-in terminal is the first-run one; here a stub records which vendor it was opened for. */
vi.mock('../terminal/TerminalPane', () => ({
  TerminalPane: ({ signIn, onExit }: { signIn?: string; onExit?: () => void }) => (
    <div data-testid="stub-terminal" data-sign-in={signIn}>
      <button type="button" onClick={onExit}>
        login finished
      </button>
    </div>
  ),
}));

/*
 * S1 IN THE PAGE: what the streams of the S1 replays (packages/analyzer
 * acp-s1-turns.test.ts, kept in sse-s1/) do to a run and its card. The
 * fixtures behind them are not run live except where named.
 *   resume-after-restart  the run says it continued the chat's thread
 *   hung-after-start      the run is hung, failed, and offers Retry, which asks
 *                         the same question in the same chat
 *   signed-out            the run offers Sign in again (codex's own login, in a
 *                         terminal), then Retry
 */

type Json = Record<string, unknown>;

const s1 = (name: string): Json[] =>
  fs
    .readFileSync(path.join(SSE_GOLDEN, '..', 'sse-s1', `${name}.sse.jsonl`), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Json);

async function played(name: string): Promise<{ run: AgentRun; store: ReturnType<typeof createAgentRunStore>; calls: { url: string; body: unknown }[] }> {
  const { fetch, calls } = replayFetch(s1(name));
  const store = createAgentRunStore({ clock: () => 1000, fetch });
  const run = await store.start({ question: 'What did the command print?', access: 'autoEdit', sessionId: 'chat-1' }, fetch);
  return { run, store, calls };
}

describe('S1 streams through the run store and its card', () => {
  it('resume-after-restart: ended, then settled; the run continued the chat\'s thread', async () => {
    const { run } = await played('resume-after-restart');
    expect(run.status).toBe('done');
    expect(run.turn).toBe('settled');
    expect(run.resumed).toBe(true);
    render(<AgentRunsList runs={[run]} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.queryByTestId('agent-run-resume-note')).toBeNull();
    expect(screen.queryByTestId('agent-recovery')).toBeNull();
  });

  it('hung-after-start: the run is hung and failed, never done, and Retry asks again in the same chat', async () => {
    const { run, calls } = await played('hung-after-start');
    expect(run.status).toBe('failed');
    expect(run.turn).toBe('hung');
    expect(run.recovery).toEqual({ kind: 'retry', cause: 'timeout' });
    const onRetry = vi.fn();
    render(<AgentRunsList runs={[run]} repoRoot={null} onAnswer={() => {}} onRetry={onRetry} />);
    const card = screen.getByTestId('agent-recovery');
    expect(card.textContent).toContain('made no progress');
    fireEvent.click(within(card).getByTestId('agent-recovery-retry'));
    expect(onRetry).toHaveBeenCalledWith(run);

    /* What the retry sends: the same question, agent, chat and session key, so the server resumes the thread. */
    const first = calls.find((c) => c.url.startsWith('/api/acp/run-node'))!.body as Json;
    const again = replayFetch(s1('resume-after-restart'));
    const store = createAgentRunStore({ clock: () => 2000, fetch: again.fetch });
    await store.start(run.retry!, again.fetch);
    const second = again.calls.find((c) => c.url.startsWith('/api/acp/run-node'))!.body as Json;
    for (const k of ['prompt', 'agentRef', 'sessionKey', 'chatId', 'permissionMode']) expect(second[k], k).toEqual(first[k]);
    expect(second.chatId).toBe('chat-1');
  });

  it('signed-out: Sign in again opens codex\'s own login in a terminal; when it ends, Retry', async () => {
    const { run } = await played('signed-out');
    expect(run.status).toBe('failed');
    expect(run.recovery).toEqual({ kind: 'signIn', provider: 'codex', cause: 'signedOut' });
    render(<AgentRunsList runs={[run]} repoRoot={null} onAnswer={() => {}} onRetry={() => {}} />);
    const card = screen.getByTestId('agent-recovery');
    expect(card.textContent).toContain('Codex is signed out');
    expect(within(card).getByTestId('agent-recovery-retry').className).not.toContain('is-primary');
    fireEvent.click(within(card).getByTestId('agent-recovery-signin'));
    const term = await screen.findByTestId('stub-terminal');
    expect(term.getAttribute('data-sign-in')).toBe('codex');
    await act(async () => {
      fireEvent.click(within(term).getByText('login finished'));
    });
    expect(within(card).getByTestId('agent-recovery-retry').className).toContain('is-primary');
  });

  it('a thread the agent could not reopen: the run says it is a new conversation, and why', () => {
    const store = createAgentRunStore({ fetch: async () => new Response('{}') });
    void store.start({ agentRef: 'codex', question: 'q', sessionId: 'chat-1' }, () => new Promise<Response>(() => {}));
    const id = store.get().runs[0]!.id;
    store.apply(id, { type: 'acp:session', resumed: false, threadId: 't2', reason: 'the agent offers neither session/resume nor session/load' });
    render(<AgentRunsList runs={store.get().runs} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-run-resume-note').textContent).toBe('New conversation: the agent offers neither session/resume nor session/load');
  });
});
