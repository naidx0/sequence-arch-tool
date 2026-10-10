import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { goldenNames, readGolden, replayFetch } from '../../test/support/replaySse';
import { AgentRunView } from '../chat/AgentRunThread';
import { createAgentRunStore } from './agentRuns';

/*
 * RECORDED CODEX SESSIONS INTO web2's RUN STORE AND ITS CARDS (S0).
 *
 * Each golden stream is what the real server sent while a recorded codex
 * session replayed through it (packages/analyzer replay-run-node.test.ts).
 * Here it goes through the shipping run store (agentRuns.ts, the fold in
 * agentRunFold.ts) and the chat's run view, exactly as the browser would
 * receive it. The store is driven to the end of the stream; nothing sleeps.
 *
 * Each case proves: the run ends `done`; the answer text is the server's
 * result; one tool card per tool call the server streamed, and one approval
 * card per question, settled the way it was answered; the card headers fold.
 */

type Json = Record<string, unknown>;

const updates = (events: Json[], kind: string): Json[] =>
  events.filter((e) => e.type === 'acp:update' && ((e.update as Json).update as Json).sessionUpdate === kind);

describe('recorded codex sessions through the run store', () => {
  for (const name of goldenNames()) {
    it(`${name}${name.endsWith('-synthetic') ? ' (not run live)' : ''}: the run, its text, tool cards and approvals`, async () => {
      const events = readGolden(name);
      const { fetch, calls } = replayFetch(events);
      const store = createAgentRunStore({ clock: () => 1000, fetch });
      const run = await store.start({ question: 'replay', access: 'ask' }, fetch);

      expect(calls.map((c) => c.url)).toEqual(['/api/acp/agents', '/api/acp/run-node?stream=1']);
      expect(run.status).toBe('done');
      const result = events.find((e) => e.type === 'acp:result') as Json;
      const text = run.items.filter((i) => i.kind === 'message').map((i) => (i.kind === 'message' ? i.text : '')).join('');
      expect(text).toBe(result.text);

      const toolCalls = updates(events, 'tool_call');
      expect(run.items.filter((i) => i.kind === 'tool')).toHaveLength(toolCalls.length);
      const pending = events.filter((e) => e.type === 'acp:permission' && e.pending === true);
      expect(run.approvals).toHaveLength(pending.length);
      const settled = events.filter((e) => e.type === 'acp:permission' && e.pending === false && typeof e.requestId === 'string');
      expect(run.approvals.map((a) => a.decision)).toEqual(settled.map((e) => e.decision));

      const view = render(<AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} />);
      /* One card per tool call: an approval about a streamed call is drawn in
         that call's card, so only approvals about no streamed call add one. */
      const callIds = new Set(toolCalls.map((e) => ((e.update as Json).update as Json).toolCallId));
      const loose = pending.filter((e) => !callIds.has(e.toolCallId));
      /* S2b: runs of settled calls fold into one row; open every fold to count the cards. */
      for (const t of view.container.querySelectorAll('[data-testid="agent-tool-fold-toggle"]')) (t as HTMLElement).click();
      await Promise.resolve();
      /* The plan (S2b: codex's todo list now reaches the run) is a card of its own. */
      const plans = updates(events, 'plan').length > 0 ? 1 : 0;
      const cards = view.container.querySelectorAll('.s2-agcard');
      expect(cards).toHaveLength(toolCalls.length + loose.length + plans);
      expect(view.container.querySelectorAll('[data-testid="agent-card-approval"]')).toHaveLength(loose.length);
      for (const card of cards) {
        expect(within(card as HTMLElement).getByTestId('agent-card-toggle').getAttribute('aria-expanded')).toBe('false');
      }
      view.unmount();
    });
  }

  it('while a recorded approval waits: one card for the call, "needs you", Allow / Deny on it, the change shown once', async () => {
    for (const name of ['command-approval', 'file-approval-denied']) {
      const events = readGolden(name);
      const upTo = events.findIndex((e) => e.type === 'acp:permission' && e.pending === true);
      /* The stream as it stood when the question was put. */
      const { fetch } = replayFetch(events.slice(0, upTo + 1));
      const run = await createAgentRunStore({ clock: () => 1000, fetch }).start({ question: 'replay' }, fetch);
      const asked = events[upTo] as Json;
      const view = render(<AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} />);
      const card = view.container.querySelector(`[data-approval-id="${run.approvals[0]!.requestId}"]`) as HTMLElement;
      expect(card, name).toBeTruthy();
      expect(card.id).toBe(`agcard-${String(asked.toolCallId)}`);
      expect(card.getAttribute('data-status')).toBe('waiting');
      expect(within(card).getByTestId('agent-card-status').textContent).toBe('needs you');
      expect(within(card).getByTestId('agent-allow')).toBeTruthy();
      expect(view.container.querySelectorAll(`[id="agcard-${String(asked.toolCallId)}"]`)).toHaveLength(1);
      within(card).getByTestId('agent-card-toggle').click();
      await Promise.resolve();
      const body = within(card).getByTestId('agent-card-body');
      expect(body.querySelectorAll('[data-testid="chat-edit-approval-diff"], [data-testid="agent-approval-command-text"]')).toHaveLength(1);
      expect(body.querySelectorAll('[data-testid="agent-diff"]')).toHaveLength(0);
      view.unmount();
    }
  });

  it('the command approval arrives allowed, the denied file change denied', async () => {
    for (const [name, decision] of [
      ['command-approval', 'allow'],
      ['file-approval-denied', 'deny'],
    ] as const) {
      const { fetch } = replayFetch(readGolden(name));
      const run = await createAgentRunStore({ fetch }).start({ question: 'replay' }, fetch);
      expect(run.approvals.map((a) => [a.toolKind, a.decision])).toEqual([[name === 'command-approval' ? 'execute' : 'edit', decision]]);
    }
  });
});
