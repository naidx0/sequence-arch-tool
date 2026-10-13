import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setHostCommandHandler } from '../app/hostCommands';
import { CHART_FIXTURES } from '../charts/chartFixtures';
import { fromChatMemory, toChatMemory } from '../sessions/chatMemory';
import { createStore, StoreProvider, type Store } from '../state';
import { V3Chat } from '../v3/V3Chat';
import { assistantTurn, userTurn, workRow } from './fixtures';
import { Transcript } from './Transcript';

/*
 * B8 / I1: what a turn draws shows in the chat as a little diagram, with an
 * Open on surface action; the source of truth stays on the surface. The old
 * pointer sentence is gone.
 */

const CHART = CHART_FIXTURES['node-link'];

function drawnTurn(): Store {
  const store = createStore({});
  store.dispatch({ type: 'composer/draft', text: 'draw the package graph' });
  store.dispatch({ type: 'turn/send', at: 1 });
  store.dispatch({ type: 'turn/event', event: { type: 'chart:proposal', chart: CHART }, at: 2 });
  store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'Here is how they depend on each other.' }, at: 3 });
  return store;
}

function drawChat(store: Store): void {
  render(
    <StoreProvider store={store}>
      <div className="v3-chat-col">
        <V3Chat />
      </div>
    </StoreProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => setHostCommandHandler(null as never));

describe('a chart:proposal event is kept on the assistant turn', () => {
  it('commits the chart onto the turn', () => {
    const turn = drawnTurn().getState().session.turns.find((t) => t.role === 'assistant');
    expect(turn && 'charts' in turn ? turn.charts : undefined).toEqual([CHART]);
  });

  it('a redraw replaces its original in the turn too', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'q' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'chart:proposal', chart: CHART }, at: 2 });
    const redraw = { ...CHART, title: 'Redrawn' };
    store.dispatch({ type: 'turn/event', event: { type: 'chart:proposal', chart: redraw, replacesTurnChart: 0 }, at: 3 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'ok' }, at: 4 });
    const turn = store.getState().session.turns.find((t) => t.role === 'assistant');
    expect(turn && 'charts' in turn ? turn.charts?.map((c) => c.title) : null).toEqual(['Redrawn']);
  });
});

describe('the chat draws it inline', () => {
  it('renders the chart with its labels, without the old pointer sentence', async () => {
    drawChat(drawnTurn());
    const inline = await screen.findByTestId('chat-chart-inline', {}, { timeout: 8000 });
    expect(inline.textContent).toContain('analyzer');
    expect(inline.textContent).toContain('web2');
    expect(document.body.textContent?.toLowerCase()).not.toContain('open the ai canvas');
  });

  it('Open on surface opens the surface the chart lives on', async () => {
    const seen: string[] = [];
    setHostCommandHandler((id) => seen.push(id));
    drawChat(drawnTurn());
    fireEvent.click(await screen.findByTestId('chat-chart-open', {}, { timeout: 8000 }));
    expect(seen).toContain('canvas.ai');
  });

  it('survives a reload: written to chat memory and read back, it renders again', async () => {
    const turns = drawnTurn().getState().session.turns;
    const stored = JSON.parse(JSON.stringify(toChatMemory('s1', turns)));
    const back = fromChatMemory(stored);
    const store = createStore({});
    store.dispatch({ type: 'session/hydrated', turns: back } as never);
    drawChat(store);
    const inline = await screen.findByTestId('chat-chart-inline', {}, { timeout: 8000 });
    expect(inline.textContent).toContain('analyzer');
  });
});

describe('the older transcript view', () => {
  it('draws the chart for a chart row and calls onOpen with the surface', async () => {
    const onOpen = vi.fn();
    const row = workRow('r-chart', { verb: 'Drew a chart', from: 'chart:proposal', opens: 'ai-canvas' } as never);
    render(
      <Transcript
        turns={[userTurn('u1', 'draw it'), assistantTurn('a1', 'u1', { text: 'done', work: [row], charts: [CHART] } as never)]}
        inFlight={null}
        onOpen={onOpen}
      />,
    );
    expect((await screen.findByTestId('chat-chart-inline', {}, { timeout: 8000 })).textContent).toContain('analyzer');
    fireEvent.click(screen.getByTestId('chat-chart-open'));
    expect(onOpen).toHaveBeenCalledWith('ai-canvas', 'a1');
    expect(document.body.textContent?.toLowerCase()).not.toContain('open the ai canvas');
  });

  it('a restored turn with no chart kept still has its one-line pointer, without the old words', () => {
    const row = workRow('r-chart', { verb: 'Drew a chart', from: 'chart:proposal', opens: 'ai-canvas' } as never);
    render(<Transcript turns={[userTurn('u1', 'x'), assistantTurn('a1', 'u1', { text: 'done', work: [row] })]} inFlight={null} />);
    expect(screen.getByTestId('chat-chart-pointer').textContent).toContain('Open on surface');
    expect(document.body.textContent?.toLowerCase()).not.toContain('open the ai canvas');
  });
});

describe('a board drawing', () => {
  it('shows as a small sketch with Open on surface', async () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'sketch the flow' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'board:item',
        items: [
          { id: 'a:box', kind: 'rect', x: 0, y: 0, w: 120, h: 50, label: 'Gateway' },
          { id: 'b:box', kind: 'rect', x: 240, y: 0, w: 120, h: 50, label: 'Analyzer' },
        ],
      } as never,
      at: 2,
    });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'Sketched.' }, at: 3 });
    const turn = store.getState().session.turns.find((t) => t.role === 'assistant');
    expect(turn && 'boardMarks' in turn ? turn.boardMarks?.length : 0).toBeGreaterThan(0);
    drawChat(store);
    const sketch = await screen.findByTestId('chat-board-inline', {}, { timeout: 8000 });
    await waitFor(() => expect(sketch.textContent).toContain('Gateway'));
    expect(screen.getByTestId('chat-board-open')).toBeTruthy();
  });
});

describe('review fixes: board marks', () => {
  it('restoring skips malformed marks instead of throwing', () => {
    const good = { id: 'a', kind: 'shape', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 10, y: 10 } };
    const mem = { version: 2, sessionId: 's', turns: [{ role: 'user', text: 'q' }, { role: 'assistant', text: 'ok', boardMarks: [good, { id: 'b', kind: 'shape' }, { kind: 'text' }, 7] }] };
    const turn = fromChatMemory(mem).find((t) => t.role === 'assistant');
    expect(turn && 'boardMarks' in turn ? turn.boardMarks : null).toEqual([good]);
  });

  it('two cards on screen use different arrowhead ids', async () => {
    const { BoardTurnCard } = await import('./BoardTurnCard');
    const arrow = [{ id: 'a', kind: 'shape', shape: 'arrow', from: { x: 0, y: 0 }, to: { x: 50, y: 0 } }] as never;
    render(<><BoardTurnCard items={arrow} /><BoardTurnCard items={arrow} /></>);
    const ids = Array.from(document.querySelectorAll('marker')).map((m) => m.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
