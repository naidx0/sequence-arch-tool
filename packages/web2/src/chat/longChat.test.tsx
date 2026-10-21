import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SSE_GOLDEN } from '../../test/support/replaySse';
import { installFakeLayout } from '../../test/support/fakeLayout';
import '../agents/agentRunFold';
import { createAgentRunStore, type AgentRunStore } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { createStore, StoreProvider } from '../state';
import type { Turn } from '../state/types';
import { resetKeptOpen } from './AgentRunThread';
import { ChatTranscript } from './ChatTranscript';
import { STICK_PX } from './stickToBottom';

/*
 * S6, LONG CHATS STAY SMOOTH: the web half's transcript.
 *
 *   · a 2,000-row transcript keeps about a screenful of rows in the page;
 *   · the scroller follows the end only while it rests within 40 px of it,
 *     and a reader who scrolled up is never moved and gets "Jump to latest";
 *   · an approval whose card is scrolled out of the virtualized list still
 *     raises its toast (S1).
 *
 * jsdom has no layout, so test/support/fakeLayout.ts gives the list one.
 */

type Json = Record<string, unknown>;

const turnsOf = (n: number): Turn[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i}`, role: i % 2 ? 'assistant' : 'user', text: `row ${i}`, at: i }) as unknown as Turn);

const renderTurn = (t: Turn) => (
  <p key={t.id} className="row" data-turn={t.id}>
    {(t as unknown as { text: string }).text}
  </p>
);

function appStore() {
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [{ id: 's1', title: 'Long', pinned: false, updatedAt: '2026-10-06' }], activeId: 's1' } as never);
  return store;
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 20));
  });

/** A run that never ends, fed `events` by hand. */
function heldRun(events: Json[], runs: AgentRunStore): string {
  void runs.start({ agentRef: 'codex', question: 'q', access: 'ask', sessionId: 's1' }, () => new Promise<Response>(() => {}));
  const id = runs.get().runs[runs.get().runs.length - 1]!.id;
  for (const e of events) runs.apply(id, e as RunNodeEvent);
  return id;
}

const upd = (update: Json): Json => ({ type: 'acp:update', update: { sessionId: 's', update } });

let restoreLayout: (() => void) | null = null;
beforeEach(() => {
  restoreLayout = installFakeLayout();
});
afterEach(() => {
  restoreLayout?.();
  restoreLayout = null;
  resetKeptOpen();
});

describe('a 2,000-row transcript', { timeout: 20_000 }, () => {
  it('keeps about a screenful in the page, pinned to the end, with stable row keys', async () => {
    const turns = turnsOf(2000);
    const runs = createAgentRunStore({ fetch: async () => new Response('{}') });
    const store = appStore();

    const plain = render(
      <StoreProvider store={store}>
        <ChatTranscript turns={turns} renderTurn={renderTurn} tail={[]} empty={false} runStore={runs} virtualAt={Infinity} />
      </StoreProvider>,
    );
    const plainNodes = plain.container.querySelectorAll('*').length;
    expect(plain.container.querySelectorAll('[data-turn]')).toHaveLength(2000);
    plain.unmount();

    const virtual = render(
      <StoreProvider store={store}>
        <ChatTranscript turns={turns} renderTurn={renderTurn} tail={[]} empty={false} runStore={runs} />
      </StoreProvider>,
    );
    expect(screen.getByTestId('v3-transcript-virtual')).toBeTruthy();
    /* The list is its own chunk: wait for it to load (a loaded machine takes longer), not for a fixed time. */
    await waitFor(() => expect(virtual.container.querySelector('[data-row-key]')).not.toBeNull(), { timeout: 10_000 });
    await settle();
    const keys = [...virtual.container.querySelectorAll('[data-row-key]')].map((r) => r.getAttribute('data-row-key'));
    const nodes = virtual.container.querySelectorAll('*').length;
    console.log(`  S6 2,000-row transcript: DOM nodes ${plainNodes} plain -> ${nodes} virtualized (${keys.length} rows drawn)`);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.length).toBeLessThan(60);
    expect(nodes * 20).toBeLessThan(plainNodes);
    /* Pinned to the end: the last turn is drawn, the first is not. */
    expect(keys).toContain('turn:t1999');
    expect(keys).not.toContain('turn:t0');
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('pinned to the end within 40 px, never moved once the reader scrolled up', () => {
  /** The plain scroller with a scroll position of its own (jsdom has none). */
  function scroller(container: HTMLElement) {
    const el = container.querySelector('[data-transcript-scroller]') as HTMLElement;
    let top = 0;
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => el.querySelectorAll('[data-turn]').length * 40 });
    return {
      el,
      get top() {
        return top;
      },
      scrollTo(v: number) {
        top = v;
        fireEvent.scroll(el);
      },
      end: () => el.querySelectorAll('[data-turn]').length * 40 - 600,
    };
  }

  it('follows while within 40 px; a reader further up stays put, sees "Jump to latest", and the button takes them back', async () => {
    const runs = createAgentRunStore({ fetch: async () => new Response('{}') });
    const store = appStore();
    const view = (n: number) => (
      <StoreProvider store={store}>
        <ChatTranscript turns={turnsOf(n)} renderTurn={renderTurn} tail={[]} empty={false} runStore={runs} />
      </StoreProvider>
    );
    const r = render(view(30));
    const s = scroller(r.container);

    /* At the end: what streams in keeps it at the end. */
    s.scrollTo(s.end());
    r.rerender(view(34));
    await settle();
    expect(s.top).toBeGreaterThanOrEqual(s.end());
    expect(screen.queryByRole('button', { name: 'Jump to latest message' })).toBeNull();

    /* Within 40 px of the end still counts as the end. */
    s.scrollTo(s.end() - (STICK_PX - 10));
    r.rerender(view(36));
    await settle();
    expect(s.top).toBeGreaterThanOrEqual(s.end());

    /* Scrolled up past 40 px: nothing the stream does moves the reader. */
    s.scrollTo(s.end() - (STICK_PX + 60));
    const held = s.top;
    r.rerender(view(44));
    await settle();
    expect(s.top).toBe(held);
    const jump = screen.getByRole('button', { name: 'Jump to latest message' });
    expect(jump.textContent).toContain('Jump to latest');

    /* The button: back to the end, following again. */
    fireEvent.click(jump);
    expect(s.top).toBeGreaterThanOrEqual(s.end());
    expect(screen.queryByRole('button', { name: 'Jump to latest message' })).toBeNull();
    r.rerender(view(48));
    await settle();
    expect(s.top).toBeGreaterThanOrEqual(s.end());
  });
});

describe('sending takes a reader who scrolled up back to the end', () => {
  function scroller(container: HTMLElement) {
    const el = container.querySelector('[data-transcript-scroller]') as HTMLElement;
    let top = 0;
    Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => el.querySelectorAll('[data-turn]').length * 40 });
    return {
      get top() {
        return top;
      },
      scrollTo(v: number) {
        top = v;
        fireEvent.scroll(el);
      },
      end: () => el.querySelectorAll('[data-turn]').length * 40 - 600,
    };
  }

  it('a new user turn scrolls to the end and shows no "Jump to latest"; an assistant turn arriving does not move the reader', async () => {
    const runs = createAgentRunStore({ fetch: async () => new Response('{}') });
    const store = appStore();
    const view = (n: number) => (
      <StoreProvider store={store}>
        <ChatTranscript turns={turnsOf(n)} renderTurn={renderTurn} tail={[]} empty={false} runStore={runs} />
      </StoreProvider>
    );
    const r = render(view(30));
    const s = scroller(r.container);
    s.scrollTo(s.end());
    /* Scrolled far up to read. */
    s.scrollTo(s.end() - (STICK_PX + 200));
    const held = s.top;
    r.rerender(view(32));
    await settle();
    expect(s.top).toBe(held);
    expect(screen.getByRole('button', { name: 'Jump to latest message' })).toBeTruthy();
    /* The person sends: turn 32 is a user turn and now the last one. */
    r.rerender(view(33));
    await settle();
    expect(s.top).toBeGreaterThanOrEqual(s.end());
    expect(screen.queryByRole('button', { name: 'Jump to latest message' })).toBeNull();
  });

  it('a new agent run in the chat does the same', async () => {
    const runs = createAgentRunStore({ fetch: async () => new Response('{}') });
    const store = appStore();
    const r = render(
      <StoreProvider store={store}>
        <ChatTranscript turns={turnsOf(30)} renderTurn={renderTurn} tail={[]} empty={false} runStore={runs} />
      </StoreProvider>,
    );
    const s = scroller(r.container);
    s.scrollTo(s.end());
    s.scrollTo(s.end() - (STICK_PX + 200));
    await settle();
    expect(screen.getByRole('button', { name: 'Jump to latest message' })).toBeTruthy();
    heldRun([], runs);
    await settle();
    expect(screen.queryByRole('button', { name: 'Jump to latest message' })).toBeNull();
    expect(s.top).toBeGreaterThanOrEqual(s.end());
  });
});

describe('an approval scrolled out of the virtualized list still raises its toast (S1)', () => {
  const alwaysPrefix = (): Json[] =>
    fs
      .readFileSync(path.join(SSE_GOLDEN, '..', 'sse-s1', 'always-prefix.sse.jsonl'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Json);
  const isPending = (e: Json): boolean => e.type === 'acp:permission' && e.pending === true;
  /* After the question: more of the agent's work, a message and a finished call at a time. */
  const filler = (n: number): Json[] =>
    Array.from({ length: n }, (_, i) => [
      upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `step ${i}` } }),
      upd({ sessionUpdate: 'tool_call', toolCallId: `f${i}`, title: `read ${i}`, kind: 'read', status: 'completed' }),
    ]).flat();

  async function mountWith(work: number) {
    const runs = createAgentRunStore({ fetch: async () => new Response('{}') });
    const events = alwaysPrefix();
    heldRun([...events.slice(0, events.findIndex(isPending) + 1), ...filler(work)], runs);
    const store = appStore();
    const r = render(
      <StoreProvider store={store}>
        <ChatTranscript turns={[]} renderTurn={renderTurn} tail={[]} empty={false} runStore={runs} />
      </StoreProvider>,
    );
    /* The cards (or the list's rows) and the toasts load as their own chunks: wait for them, not for a fixed time. */
    await waitFor(() => expect(r.container.querySelector('[data-row-key], [data-approval-id]')).not.toBeNull(), { timeout: 10_000 });
    await settle();
    return r;
  }

  it('control: a short chat draws the card, it is on screen, and no toast repeats it', async () => {
    const r = await mountWith(2);
    expect(r.container.querySelector('[data-testid="v3-transcript-virtual"]')).toBeNull();
    expect(document.querySelector('[data-approval-id]')).not.toBeNull();
    expect(screen.queryByTestId('agent-toast')).toBeNull();
  });

  it('a long chat draws the end, not the card, and the toast asks', async () => {
    const r = await mountWith(150);
    expect(r.container.querySelector('[data-testid="v3-transcript-virtual"]')).not.toBeNull();
    expect(document.querySelector('[data-approval-id]')).toBeNull();
    const toast = screen.getByTestId('agent-toast');
    expect(toast.getAttribute('data-kind')).toBe('approval');
    expect(toast.textContent).toContain('needs approval');
  });
});
