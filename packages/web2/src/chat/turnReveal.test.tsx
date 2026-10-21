/**
 * The overview jumps to the right turn: every drawn turn carries data-turn-id, and a turn whose row the
 * virtualised list has not drawn is brought in by the list itself (revealTurn).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { preloadChatLazies } from '../../test/preloadChat';
import { scrollToTurn } from '../overview/scrollToTurn';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import type { AgentRun } from '../agents/agentRuns';
import { assistantTurn, userTurn } from './fixtures';
import { revealInTranscript, revealTurn, setTranscriptRevealer, type RevealTarget } from './transcriptNav';
import { rowIndexOf, transcriptRows } from './VirtualTranscript';

beforeAll(async () => {
  await Promise.all([preloadChatLazies(), import('../overview/ChatOverview')]);
}, 120_000);

beforeEach(() => {
  localStorage.clear();
  /* The shell opens with the map beside the chat; the chat alone is a stored choice, and the overview needs it. */
  localStorage.setItem('v3.chromeTabs', JSON.stringify({ tabs: [{ id: 'chat', minimized: false }], active: 'chat' }));
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  cleanup();
  setTranscriptRevealer(null);
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }));

const GENUI = '```genui\n{"title":"Pricing card","root":{}}\n```';
const seeded = () => {
  const store = createStore({});
  store.dispatch({
    type: 'session/hydrated',
    turns: [userTurn('u1', 'draw a card'), assistantTurn('a1', 'u1', { text: `Here.\n${GENUI}` }), userTurn('u2', 'thanks'), assistantTurn('a2', 'u2', { text: 'You are welcome.' })],
  } as never);
  return store;
};

describe('the plain transcript stamps every turn', { timeout: 60000 }, () => {
  it('each turn row has a stable data-turn-id, and an artifact click scrolls that one into view', async () => {
    const scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scroll });
    render(<V3App appStore={seeded()} />);
    await waitFor(() => expect(document.querySelectorAll('[data-turn-id]').length).toBe(4));
    expect([...document.querySelectorAll('[data-turn-id]')].map((e) => e.getAttribute('data-turn-id'))).toEqual(['u1', 'a1', 'u2', 'a2']);
    fireEvent.click(await screen.findByTestId('ov-artifact', {}, { timeout: 15000 }));
    const target = scroll.mock.contexts.at(-1) as HTMLElement;
    expect(target.getAttribute('data-turn-id')).toBe('a1');
  });
});

describe('a turn whose row the virtual list has not drawn', () => {
  it('rowIndexOf finds a turn row by its id and no other kind of row', () => {
    const turns = [userTurn('u1', 'a'), assistantTurn('a1', 'u1', { text: 'b' }), userTurn('u2', 'c')];
    const rows = transcriptRows(turns, [], null, []);
    expect(rowIndexOf(rows, { turnId: 'u2' })).toBe(rows.findIndex((r) => r.key === 'turn:u2'));
    expect(rowIndexOf(rows, { turnId: 'a1' })).toBe(1);
    expect(rowIndexOf(rows, { turnId: 'nope' })).toBe(-1);
  });

  it('revealTurn asks the registered list for the turn, and says false with no list', () => {
    expect(revealTurn('a1')).toBe(false);
    const asked: RevealTarget[] = [];
    setTranscriptRevealer((t) => (asked.push(t), true));
    expect(revealTurn('a1')).toBe(true);
    expect(asked).toEqual([{ turnId: 'a1', align: 'top' }]);
    /* A run reveal still reads as a run reveal. */
    expect(revealInTranscript({ runId: 'r1' })).toBe(true);
    expect(asked[1]).toEqual({ runId: 'r1' });
  });

  it('scrollToTurn hands an undrawn row to the list, and leaves the scroller alone', () => {
    const scroller = document.createElement('div');
    scroller.setAttribute('data-transcript-scroller', '');
    document.body.appendChild(scroller);
    scroller.scrollTop = 0;
    const seen: string[] = [];
    setTranscriptRevealer((t) => ('turnId' in t ? (seen.push(t.turnId), true) : false));
    expect(scrollToTurn('far-away', ['x', 'far-away', 'y'])).toBe(true);
    expect(seen).toEqual(['far-away']);
    expect(scroller.scrollTop).toBe(0);
    scroller.remove();
  });
});

describe('an overview click on a saved agent-run card in a long chat', () => {
  it('rowIndexOf finds the run head when the id given is a run id, and a turn row still wins for a turn id', () => {
    const turns = [userTurn('u1', 'a'), assistantTurn('a1', 'u1', { text: 'b' })];
    const run = { id: 'run-xyz', sessionId: null, agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'p', status: 'done', startedAt: 0, endedAt: 1, items: [], approvals: [], error: null } as unknown as AgentRun;
    const rows = transcriptRows(turns, [run], null, []);
    const head = rows.findIndex((r) => r.kind === 'run-head');
    expect(head).toBeGreaterThan(-1);
    expect(rowIndexOf(rows, { turnId: 'run-xyz' })).toBe(head);
    expect(rowIndexOf(rows, { turnId: 'a1' })).toBe(rows.findIndex((r) => r.key === 'turn:a1'));
    expect(rowIndexOf(rows, { turnId: 'nope' })).toBe(-1);
  });
});
