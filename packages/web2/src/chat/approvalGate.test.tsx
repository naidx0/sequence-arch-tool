import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SSE_GOLDEN, readGolden } from '../../test/support/replaySse';
import { agentRuns, createAgentRunStore, type AgentRunStore } from '../agents/agentRuns';
import '../agents/agentRunFold';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { AgentRunsList, resetKeptOpen } from './AgentRunThread';
import { AgentToasts } from './AgentToasts';

/*
 * THE APPROVAL GATE: "Allow once Y · Always for <prefix> A · Deny N".
 *
 * Fed by the streams the real server sent while recorded codex sessions
 * replayed through it: command-approval (live) and always-prefix (not run
 * live; packages/analyzer acp-always-rule.test.ts keeps it). Keys are pressed
 * with fireEvent; nothing sleeps.
 */

type Json = Record<string, unknown>;

const alwaysPrefix = (): Json[] =>
  fs
    .readFileSync(path.join(SSE_GOLDEN, '..', 'sse-s1', 'always-prefix.sse.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Json);

const isPending = (e: Json): boolean => e.type === 'acp:permission' && e.pending === true;

/** A run held open (its stream never ends), fed `events` by hand. */
function heldRun(events: Json[], store: AgentRunStore = createAgentRunStore({ fetch: async () => new Response('{}') }), sessionId = 's1'): { store: AgentRunStore; id: string } {
  void store.start({ agentRef: 'codex', question: 'q', access: 'ask', sessionId }, () => new Promise<Response>(() => {}));
  const id = store.get().runs[store.get().runs.length - 1]!.id;
  for (const e of events) store.apply(id, e as RunNodeEvent);
  return { store, id };
}

/** The permission answers a fetch stub was asked to post. */
function posted(f: ReturnType<typeof vi.fn>): unknown[] {
  return f.mock.calls.filter(([url]) => url === '/api/acp/permission').map(([, init]) => JSON.parse(String((init as RequestInit).body)).decision);
}

afterEach(() => {
  vi.unstubAllGlobals();
  /* S6: open cards are kept by run and card id, and these tests reuse both. */
  resetKeptOpen();
});

describe('the gate reads Allow once Y · Always for <prefix> A · Deny N', () => {
  it('always-prefix (not run live): the first npm test offers Always for npm test, on the card and the toast', async () => {
    const events = alwaysPrefix();
    const first = events.findIndex(isPending);
    const { store } = heldRun(events.slice(0, first + 1));
    render(
      <>
        <AgentRunsList runs={store.get().runs} repoRoot={null} onAnswer={() => {}} />
        <AgentToasts store={store} repoRoot={null} />
      </>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const card = document.querySelector('[data-approval-id]') as HTMLElement;
    for (const scope of [within(card), within(screen.getByTestId('agent-toast'))]) {
      expect(scope.getByTestId('agent-allow').textContent).toBe('Allow once Y');
      expect(scope.getByTestId('agent-always').textContent).toBe('Always for npm test A');
      expect(scope.getByTestId('agent-deny').textContent).toBe('Deny N');
    }
    /* Opened: the exact command, and the answers wait in the composer's
       takeover (Decision 49, DeepSeek: one place to answer). */
    fireEvent.click(within(card).getByTestId('agent-card-toggle'));
    expect(within(card).getByTestId('agent-approval-command-text').textContent).toContain('npm test -- graph');
    expect(within(card).getByTestId('agent-approval-waiting').textContent).toContain('answer in the composer');
  });

  it('command-approval (live): the wrapped command offers Always for its own prefix, never the shell', async () => {
    const events = readGolden('command-approval');
    const pending = events.find(isPending)!;
    expect(pending.always).toBe('node -e');
    const { store } = heldRun(events.slice(0, events.indexOf(pending) + 1));
    render(<AgentRunsList runs={store.get().runs} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-always').textContent).toBe('Always for node -e A');
  });

  it('always-prefix to the end: Always made a rule, the second npm test was allowed by it without a question, the other prefix asked', () => {
    const { store } = heldRun(alwaysPrefix());
    const run = store.get().runs[0]!;
    expect(run.approvals.map((a) => [a.answeredBy, a.decision, a.rule ?? null])).toEqual([
      ['person', 'allow', 'npm test'],
      ['rule', 'allow', 'npm test'],
      ['person', 'deny', null],
    ]);
    render(<AgentRunsList runs={store.get().runs} repoRoot={null} onAnswer={() => {}} />);
    /* S2b: the three settled calls fold into one row; open it. */
    fireEvent.click(screen.getByTestId('agent-tool-fold-toggle'));
    const cards = [...document.querySelectorAll('[data-approval-id]')] as HTMLElement[];
    /* One card per call: an allowed call shows its own status, a denied one says so. */
    expect(cards.map((c) => c.querySelector('[data-testid="agent-card-status"]')?.textContent)).toEqual(['done', 'done', 'denied']);
    fireEvent.click(within(cards[1]!).getByTestId('agent-card-toggle'));
    expect(within(cards[1]!).getByTestId('agent-approval-answer').textContent).toBe('Allowed by your rule: always npm test in this chat');
    fireEvent.click(within(cards[0]!).getByTestId('agent-card-toggle'));
    expect(within(cards[0]!).getByTestId('agent-approval-answer').textContent).toBe('Allowed by you, and always for npm test in this chat');
  });
});

describe('the gate\'s keys', () => {
  const twoPending = (): Json[] => {
    const events = alwaysPrefix().filter((e) => e.type !== 'acp:permission' || e.pending === true);
    return events;
  };

  it('y / a / n on a focused card answer that card', async () => {
    const events = alwaysPrefix();
    const { store } = heldRun(events.slice(0, events.findIndex(isPending) + 1));
    const onAnswer = vi.fn();
    render(<AgentRunsList runs={store.get().runs} repoRoot={null} onAnswer={onAnswer} />);
    const card = document.querySelector('[data-approval-id]') as HTMLElement;
    card.focus();
    fireEvent.keyDown(card, { key: 'a' });
    fireEvent.keyDown(card, { key: 'y' });
    fireEvent.keyDown(card, { key: 'n' });
    fireEvent.keyDown(card, { key: 'q' });
    fireEvent.keyDown(card, { key: 'y', ctrlKey: true });
    expect(onAnswer.mock.calls.map((c) => c.slice(-1)[0])).toEqual(['always', 'allow', 'deny']);
  });

  it('the only approval waiting: y from anywhere that is not a text field; two waiting: only a focused one', async () => {
    const f = vi.fn(async () => new Response('{}'));
    const events = alwaysPrefix();
    const store = createAgentRunStore({ fetch: f });
    heldRun(events.slice(0, events.findIndex(isPending) + 1), store);
    render(<AgentToasts store={store} repoRoot={null} />);
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'y' });
      await Promise.resolve();
    });
    expect(posted(f)).toEqual(['allow']);

    /* A second run with its own question: two wait, a key on the page answers neither. */
    const f2 = vi.fn(async () => new Response('{}'));
    const store2 = createAgentRunStore({ fetch: f2 });
    heldRun(twoPending(), store2);
    const { unmount } = render(<AgentToasts store={store2} repoRoot={null} />);
    expect(store2.get().runs[0]!.approvals.filter((a) => a.decision === null)).toHaveLength(2);
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'y' });
      await Promise.resolve();
    });
    expect(posted(f2)).toEqual([]);
    unmount();
  });

  it('never while the focus is in the composer text field', async () => {
    const f = vi.fn(async (url: string) => (url === '/api/acp/permission' ? new Response('{}') : new Promise<Response>(() => {})));
    vi.stubGlobal('fetch', f);
    const app = createStore({});
    app.dispatch({ type: 'session/index', sessions: [{ id: 'gate-chat', title: 'Gate', pinned: false, updatedAt: '2026-01-01' }], activeId: 'gate-chat' } as never);
    render(<V3App appStore={app} />);
    const events = alwaysPrefix();
    await act(async () => {
      heldRun(events.slice(0, events.findIndex(isPending) + 1), agentRuns, 'gate-chat');
    });
    await screen.findAllByTestId('agent-gate', undefined, { timeout: 5000 });
    const field = screen.getByTestId('composer-field');
    field.focus();
    expect(document.activeElement).toBe(field);
    for (const key of ['y', 'a', 'n', 'Y']) {
      await act(async () => {
        fireEvent.keyDown(field, { key });
        await Promise.resolve();
      });
    }
    expect(posted(f)).toEqual([]);
    /* The control: the same key outside the field answers it. */
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'n' });
      await Promise.resolve();
    });
    expect(posted(f)).toEqual(['deny']);
  });
});
