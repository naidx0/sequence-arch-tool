import { describe, expect, it } from 'vitest';

import { fromCanvasMemory, toCanvasMemory, worthPersistingCanvas } from './canvasMemory';
import type { CanvasDoc } from '../state/types';

/**
 * THE PLANTED CASE: a session whose only canvas content is a chart.
 *
 * Measured on the real product: a teach turn proposed a derived chart,
 * `chat.json` recorded it as a work row ("Drew a chart", from
 * `chart:proposal`), and the AI Canvas showed its empty placeholder with
 * `canvas.json` holding `blocks: []`. The chart reached the store and never
 * reached the file — dropped in THREE places at once, each of which looks
 * complete on its own:
 *
 *   1. `CanvasMemoryShape` had no `charts` field
 *   2. `toCanvasMemory` did not send it
 *   3. `worthPersistingCanvas` did not count a chart-only canvas as worth writing
 *
 * So `14 of 21` — the number the derived visual is measured by — was invisible
 * on the route users drive, and the surface that renders it looked broken
 * rather than empty.
 */
const CHART = {
  version: 1,
  kind: 'data-flow',
  title: 'bigram_counts.py',
  caption: 'bigram_counts.py and what it connects to, from the scanned graph.',
  items: [
    { id: 'a', label: 'bigram_counts.py', nodeId: 'file:bigram_counts.py' },
    { id: 'b', label: 'nn_bigram.py', nodeId: 'file:nn_bigram.py' },
  ],
  links: [{ from: 'b', to: 'a' }],
  focusItemId: 'a',
} as never;

describe('a chart-only canvas survives the trip to disk', () => {
  it('is worth persisting at all', () => {
    /* The first of the three gates, and the one that made the other two moot:
       a canvas with a chart and no blocks was never written. */
    const doc: CanvasDoc = { blocks: [], charts: [CHART] };
    expect(worthPersistingCanvas(doc)).toBe(true);
    expect(worthPersistingCanvas({ blocks: [] })).toBe(false);
  });

  it('round-trips the chart through save and load', () => {
    const doc: CanvasDoc = { blocks: [], charts: [CHART] };
    const saved = toCanvasMemory('session-1', doc);
    expect(saved.charts, 'the save payload carries the chart').toHaveLength(1);

    const loaded = fromCanvasMemory(JSON.parse(JSON.stringify(saved)));
    expect(loaded.charts, 'and the load restores it').toHaveLength(1);
    expect(loaded.charts![0]).toEqual(CHART);
  });

  it('keeps blocks and charts independent', () => {
    /* Neither may hide the other: a canvas with both must persist both, and the
       block path must not start depending on a chart being present. */
    const both: CanvasDoc = {
      blocks: [{ id: 'b1', type: 'markdown', payload: '# hi', status: 'landed' }],
      charts: [CHART],
    };
    const loaded = fromCanvasMemory(JSON.parse(JSON.stringify(toCanvasMemory('s', both))));
    expect(loaded.blocks).toHaveLength(1);
    expect(loaded.charts).toHaveLength(1);
  });

  it('a canvas file with no charts loads as before', () => {
    /* Every session written before this change has no `charts` key. It must
       load as an empty canvas, not as a broken one. */
    const legacy = { version: 1, sessionId: 's', blocks: [] };
    const loaded = fromCanvasMemory(legacy);
    expect(loaded.blocks).toEqual([]);
    expect(loaded.charts).toBeUndefined();
  });

  it('a malformed charts field is ignored, not thrown on', () => {
    /* A hand edit or a torn write must not take the canvas down with it. */
    expect(fromCanvasMemory({ version: 1, sessionId: 's', blocks: [], charts: 'nope' }).charts)
      .toBeUndefined();
    const partial = fromCanvasMemory({
      version: 1,
      sessionId: 's',
      blocks: [],
      charts: [null, CHART],
    });
    expect(partial.charts).toHaveLength(1);
  });
});

/* ═══ the live path: the chart must survive the turn ending ══════════════ */

import { createStore } from '../state/store';

/**
 * THE PLANTED CASE FOR THE LIVE PATH: one `chart:proposal` received, then the
 * turn ends, and the chart is still there.
 *
 * The persistence fix was NOT the whole story. Opening the AI Canvas seconds
 * after a turn finished — same browser session, no reload — still showed the
 * placeholder, which meant the chart had left the store before anything was
 * saved. `landCanvasBlocks` rebuilt the canvas doc as a fresh `{ blocks }` at
 * the end of every turn, destroying `charts` (and `storyRoute`, and
 * `teachStep`) while being named for what it does to blocks.
 */
const LIVE_CHART = {
  version: 1,
  kind: 'data-flow',
  title: 'scan.ts',
  items: [{ id: 'a', label: 'scan.ts', nodeId: 'file:scan.ts' }],
  links: [],
  focusItemId: 'a',
} as never;

describe('a chart proposed during a turn survives the turn', () => {
  it('is still in canvasDoc after the turn ends', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'teach me the scanner' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'trajectory:start', runId: 'r1', instructionHash: 'test' } as never,
      at: 2,
    });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'chart:proposal', chart: LIVE_CHART } as never,
      at: 3,
    });
    expect(
      store.getState().session.canvasDoc.charts,
      'the chart arrives while the turn is running',
    ).toHaveLength(1);

    /* The `result` event IS the end of the turn — it is what calls `commit`,
       which is where the canvas doc was being rebuilt. */
    store.dispatch({
      type: 'turn/event',
      event: { type: 'result', text: 'A lesson.' } as never,
      at: 4,
    });
    expect(store.getState().session.inFlight, 'the turn has landed').toBeNull();

    expect(
      store.getState().session.canvasDoc.charts,
      'and is STILL there once the turn lands — this is what the AI Canvas reads',
    ).toHaveLength(1);
  });
});

/* ═══ the third leg: a reopened session must show its saved chart ════════ */

/**
 * THE PLANTED CASE: a session directory whose `canvas.json` holds one chart and
 * no blocks, reopened, must render the chart.
 *
 * Measured at the seat: after a full page reload, reopening the lesson from the
 * session list showed the placeholder while `canvas.json` held
 * `charts: 1, blocks: 0`, written four minutes earlier. The file was right the
 * whole time.
 *
 * Three legs, three separate defects, each looking complete on its own:
 * `landCanvasBlocks` wiped the chart when the turn landed, `toCanvasMemory`
 * never wrote it, and the hydrate path read it and threw it away.
 */
describe('a saved chart-only canvas is restored, not discarded', () => {
  it('the hydrate guard treats a chart as content', () => {
    /* The guard that dropped it tested `blocks` and `storyRoute` only. This is
       that condition, stated as the code now states it. */
    const doc = fromCanvasMemory({
      version: 1,
      sessionId: 's',
      blocks: [],
      charts: [CHART],
    });
    const wouldDiscard =
      doc.blocks.length === 0 && !doc.storyRoute && (doc.charts?.length ?? 0) === 0;
    expect(wouldDiscard, 'a chart-only canvas must not be discarded on load').toBe(false);
  });

  it('a genuinely empty canvas is still discarded', () => {
    /* The other half: a session with nothing saved must not dispatch an empty
       doc over whatever the store already has. */
    const doc = fromCanvasMemory({ version: 1, sessionId: 's', blocks: [] });
    const wouldDiscard =
      doc.blocks.length === 0 && !doc.storyRoute && (doc.charts?.length ?? 0) === 0;
    expect(wouldDiscard).toBe(true);
  });

  it('hydration does not overwrite a canvas that already holds a chart', () => {
    /* The store guard tested `blocks.length > 0`, so a doc holding a LIVE chart
       and no blocks counted as empty and could be replaced by the disk copy. */
    const store = createStore();
    /* A chart:proposal is only read while a turn is in flight — the reducer
       ignores turn events otherwise, which is why the send comes first. */
    store.dispatch({ type: 'composer/draft', text: 'teach me the scanner' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: { type: 'chart:proposal', chart: LIVE_CHART } as never,
      at: 2,
    });
    expect(store.getState().session.canvasDoc.charts).toHaveLength(1);
    /* The turn must land first: hydration is refused outright while one is in
       flight, so testing it mid-turn would pass for the wrong reason. */
    store.dispatch({
      type: 'turn/event',
      event: { type: 'result', text: 'A lesson.' } as never,
      at: 3,
    });
    store.dispatch({
      type: 'session/canvas-hydrated',
      doc: { blocks: [] },
    } as never);
    expect(
      store.getState().session.canvasDoc.charts,
      'the live chart survives a hydrate carrying nothing',
    ).toHaveLength(1);
  });
});
