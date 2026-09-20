import { describe, expect, it } from 'vitest';

import { createStore } from './store';

describe('canvas:block stream', () => {
  it('shows a pending placeholder on canvas tool:start then replaces it on canvas:block', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'draw svg' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' }, at: 2 });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'tool:start', id: 't1', name: 'canvas.write_svg' },
      at: 3,
    });

    let blocks = store.getState().session.canvasDoc.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('pending');
    expect(blocks[0]!.type).toBe('svg');

    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'canvas:block',
        id: 'blk-1',
        blockType: 'svg',
        title: 'TUI',
        payload: '<svg/>',
        status: 'live',
      },
      at: 4,
    });

    blocks = store.getState().session.canvasDoc.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.id).toBe('blk-1');
    expect(blocks[0]!.status).toBe('live');
    expect(blocks[0]!.payload).toBe('<svg/>');
  });

  it('drops pending placeholder when canvas tool fails without a block', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'draw' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' }, at: 2 });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'tool:start', id: 't2', name: 'canvas.write_markdown' },
      at: 3,
    });
    expect(store.getState().session.canvasDoc.blocks).toHaveLength(1);

    store.dispatch({
      type: 'turn/event',
      event: { type: 'tool:done', id: 't2', name: 'canvas.write_markdown' },
      at: 4,
    });
    expect(store.getState().session.canvasDoc.blocks).toHaveLength(0);
  });

  it('appends a live block and lands it on turn commit', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'draw a plan' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' }, at: 2 });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'canvas:block',
        id: 'blk-1',
        blockType: 'markdown',
        title: 'Flow',
        payload: '# Hello',
        status: 'live',
      },
      at: 3,
    });

    let blocks = store.getState().session.canvasDoc.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('live');
    expect(blocks[0]!.payload).toBe('# Hello');

    store.dispatch({
      type: 'turn/event',
      event: { type: 'result', text: 'Done.' },
      at: 4,
    });

    blocks = store.getState().session.canvasDoc.blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.status).toBe('landed');
  });

  it('second block lands the first live block', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'draw flow' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' }, at: 2 });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'canvas:block',
        id: 'b1',
        blockType: 'markdown',
        payload: 'first',
        status: 'live',
      },
      at: 3,
    });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'canvas:block',
        id: 'b2',
        blockType: 'mermaid',
        payload: 'graph LR; A-->B;',
        status: 'live',
      },
      at: 4,
    });

    const blocks = store.getState().session.canvasDoc.blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.status).toBe('landed');
    expect(blocks[1]!.status).toBe('live');
  });
});

describe('chart:proposal stream', () => {
  /*
   * The reducer case had NO test at all while the renderer it feeds had no
   * caller — the two halves of one dead pipeline. These lock both the landing
   * and, above all, WHERE the row sends the reader.
   */
  function turnWithChart(kind: string, title: string) {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'draw the packages' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' },
      at: 2,
    });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'chart:proposal',
        chart: { version: 1, kind, title, items: [{ id: 'a', label: 'A' }] },
      } as never,
      at: 3,
    });
    return store;
  }

  it('the work row opens AI CANVAS, which is the surface that draws charts', () => {
    /* It opened 'canvas' — the Architecture board, which has never rendered a
       chart — so clicking "Drew a chart" took the learner to the wrong
       picture. `canvas:block` rows have always opened 'ai-canvas'. */
    const store = turnWithChart('system-architecture', 'How the packages depend');
    const row = store.getState().session.inFlight!.work.find((r) => r.from === 'chart:proposal');
    expect(row, 'a chart:proposal adds a work row').toBeTruthy();
    expect(row!.opens).toBe('ai-canvas');
    expect(row!.verb).toBe('Drew a chart');
  });

  it('the spec lands on the canvas doc, verbatim and newest last', () => {
    const store = turnWithChart('system-architecture', 'First');
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'chart:proposal',
        chart: { version: 1, kind: 'user-flow', title: 'Second', items: [{ id: 'b', label: 'B' }] },
      } as never,
      at: 4,
    });
    const charts = store.getState().session.canvasDoc.charts ?? [];
    expect(charts.map((c) => c.title)).toEqual(['First', 'Second']);
    expect(charts[0]!.kind).toBe('system-architecture');
  });
});

describe('teach:step stream', () => {
  /*
   * The consumer half of docs/teach-mode.md §3. Without a case here the STREAM
   * ATTACK in tools/ci/reachability.test.mjs reports the event as declared and
   * unconsumed — which is the check that would have caught the whole feature
   * being unreachable.
   */
  function teaching() {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'teach me this repo' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' },
      at: 2,
    });
    return store;
  }

  it('records the step on the canvas doc', () => {
    const store = teaching();
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'teach:step',
        caption: 'The gateway is the only door in.',
        litNodeIds: ['svc:gateway'],
      },
      at: 3,
    });
    const step = store.getState().session.canvasDoc.teachStep;
    expect(step?.caption).toBe('The gateway is the only door in.');
    expect(step?.litNodeIds).toEqual(['svc:gateway']);
  });

  it('adds NO work row — the chart it rides already added one', () => {
    /* A second row restating the chart's own row is the owner's standing
       dislike, "a row that repeats its own name". */
    const store = teaching();
    store.dispatch({
      type: 'turn/event',
      event: { type: 'teach:step', caption: 'One concept.' },
      at: 3,
    });
    const rows = store.getState().session.inFlight!.work;
    expect(rows.filter((r) => r.from === 'teach:step')).toEqual([]);
  });

  it('a lesson advances: the next step REPLACES the last, it does not accumulate', () => {
    const store = teaching();
    store.dispatch({
      type: 'turn/event',
      event: { type: 'teach:step', caption: 'First concept.', litNodeIds: ['svc:a'] },
      at: 3,
    });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'teach:step', caption: 'Second concept.' },
      at: 4,
    });
    const step = store.getState().session.canvasDoc.teachStep;
    expect(step?.caption).toBe('Second concept.');
    expect(step?.litNodeIds, 'the previous step’s spotlight does not linger').toBeUndefined();
  });
});

describe('canvas:story stream', () => {
  it('sets storyRoute on the session canvas doc', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'guide me' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' }, at: 2 });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'canvas:story',
        title: 'Auth flow',
        steps: [
          { blockId: 'b1', caption: 'Overview' },
          { blockId: 'b2', caption: 'Detail' },
        ],
      },
      at: 3,
    });

    const route = store.getState().session.canvasDoc.storyRoute;
    expect(route?.title).toBe('Auth flow');
    expect(route?.steps).toHaveLength(2);
  });
});
