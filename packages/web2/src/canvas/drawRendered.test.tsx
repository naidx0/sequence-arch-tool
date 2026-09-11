import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider } from './docChannel';
import { seqdFromGraph } from './seqdFromGraph';
import { StoreProvider, createStore, type Store } from '../state';
import { readShellPersisted, readShellTokens } from '../shell';
import { summarizeGraph } from '../boot';
import { installResizeObserver } from './testResizeObserver';
import type { GetArchGraphResponse } from '@sequence/api-types';

installResizeObserver();

/**
 * "YOU CANNOT DRAW ON THE CANVAS AT ALL."
 *
 * `packages/ink` has had stroke recognition with passing tests since it was
 * written, and nothing imported it. `inkToEdit.test.ts` proves the translation;
 * this proves a PERSON can reach it — the lesson this package has paid for
 * repeatedly, where the logic was right and no surface called it.
 *
 * THE TOGGLE IS A WORD. Sheet 09 ruling 3: the vocabulary has no `ic-pen` and
 * "does not borrow one", which is the same reason Fit is a word in the cluster
 * beside it. The five-tool toolbar that sheet specifies needs glyphs that do
 * not exist, and drawing them is a brand decision — a worded toggle is what the
 * book's own ruling says to do until it is made.
 */

const GRAPH = {
  repoName: 'draw',
  scannedAt: '2026-08-22T00:00:00.000Z',
  nodes: [{ id: 'svc:gateway', label: 'gateway', kind: 'service', path: 'src/g.ts', line: 1 }],
  edges: [],
  nodeDetail: {},
} as unknown as GetArchGraphResponse;

function mount(): Store {
  const store = createStore({
    project: (g) => seqdFromGraph(g, g.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
  store.dispatch({
    type: 'repo/loaded',
    draft: {
      root: '/tmp/draw',
      repoName: 'draw',
      graph: GRAPH,
      summary: summarizeGraph(GRAPH),
      scannedAt: '2026-08-22T00:00:00.000Z',
    },
    at: 0,
  });
  render(
    <StoreProvider store={store}>
      <CanvasProvider>
        <DocProvider>
          <ConnectedBoard />
        </DocProvider>
      </CanvasProvider>
    </StoreProvider>,
  );
  return store;
}

function titles(): string[] {
  return screen.queryAllByTestId('board-node-title').map((el) => el.textContent ?? '');
}

/**
 * Fire a pointer event that actually CARRIES coordinates.
 *
 * jsdom implements `PointerEvent` without the MouseEvent geometry —
 * `fireEvent.pointerMove(el, { clientX })` arrives with `clientX === null`,
 * which the recogniser correctly reads as a zero-size stroke and rejects as a
 * scribble. Measured with a probe rather than guessed at. A `MouseEvent` named
 * `pointermove` carries them and React dispatches on the name, so the PRODUCT
 * stays honest: nothing here works around a defect in the code under test.
 */
function pointer(el: Element, type: string, x: number, y: number) {
  fireEvent(el, new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

/** Drag a wobbly closed box across the capture layer. */
function drawBox(layer: Element) {
  pointer(layer, 'pointerdown', 100, 100);
  const wobble = (i: number) => (i % 3) - 1;
  for (let i = 0; i <= 20; i += 1) pointer(layer, 'pointermove', 100 + (120 * i) / 20, 100 + wobble(i));
  for (let i = 0; i <= 20; i += 1) pointer(layer, 'pointermove', 220 + wobble(i), 100 + (80 * i) / 20);
  for (let i = 0; i <= 20; i += 1) pointer(layer, 'pointermove', 220 - (120 * i) / 20, 180 + wobble(i));
  for (let i = 0; i <= 20; i += 1) pointer(layer, 'pointermove', 100 + wobble(i), 180 - (80 * i) / 20);
  pointer(layer, 'pointerup', 100, 100);
}

describe('drawing on the canvas', () => {
  it('there is a Draw control, and it is icon-first (Decision 9)', () => {
    mount();
    const toggle = screen.getByTestId('board-draw-toggle');
    /* Decision 9 — `ic-pen` is the glyph; the word is the accessible name. */
    expect(toggle.querySelector('svg')).toBeTruthy();
    expect(toggle.textContent?.trim()).toBe('');
    expect(toggle.getAttribute('aria-label')).toMatch(/draw/i);
  });

  it('the capture surface only exists while Draw is on', () => {
    mount();
    /*
     * Mounted, not hidden. A transparent overlay left in the tree would eat
     * every click on the board for the rest of the session, and the bug would
     * look like the board having stopped responding rather than like a layer.
     */
    expect(screen.queryByTestId('board-stroke-layer')).toBeNull();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    expect(screen.getByTestId('board-stroke-layer')).toBeTruthy();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    expect(screen.queryByTestId('board-stroke-layer')).toBeNull();
  });

  it('the toggle carries its state for a reader who cannot see the fill', () => {
    mount();
    const toggle = screen.getByTestId('board-draw-toggle');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('DRAWING A BOX ADDS A SERVICE — and fires no proposal', () => {
    const store = mount();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    drawBox(screen.getByTestId('board-stroke-layer'));

    /* "Free drawing is real editing of a real artifact." */
    expect(titles()).toContain('New service');
    /*
     * AND THE OWNER'S SHARPEST CONSTRAINT HOLDS: "Drawing a box must NOT fire a
     * code proposal." No turn started, and nothing was put in the composer.
     */
    expect(store.getState().session.turns).toHaveLength(0);
    expect(store.getState().composer.draft).toBe('');
  });

  it('the stroke says what it did', () => {
    mount();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    drawBox(screen.getByTestId('board-stroke-layer'));
    /* Silence after a stroke is indistinguishable from a dropped event, and the
       reader's next move is to draw it again harder. */
    expect(screen.getByTestId('board-ink-note').textContent).toMatch(/Added a service/);
  });

  it('a scribble adds nothing and says so', () => {
    mount();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    const layer = screen.getByTestId('board-stroke-layer');

    pointer(layer, 'pointerdown', 100, 100);
    for (let i = 0; i < 60; i += 1) {
      pointer(layer, 'pointermove', 100 + Math.sin(i) * 40 + i, 100 + Math.cos(i * 1.7) * 40);
    }
    pointer(layer, 'pointerup', 100, 100);

    expect(titles()).not.toContain('New service');
    expect(screen.getByTestId('board-ink-note').textContent).toMatch(/not a box or a line/i);
  });

  it('a click is not a stroke', () => {
    mount();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    const layer = screen.getByTestId('board-stroke-layer');
    pointer(layer, 'pointerdown', 10, 10);
    pointer(layer, 'pointerup', 10, 10);
    /* One point is a click, not a gesture — handing it to the recogniser would
       spend a round trip to be told it is a scribble. */
    expect(screen.queryByTestId('board-ink-note')).toBeNull();
  });

  it('a drawn service can then be renamed like any other node', () => {
    mount();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    drawBox(screen.getByTestId('board-stroke-layer'));
    fireEvent.click(screen.getByTestId('board-draw-toggle')); // leave draw mode

    const drawn = screen
      .queryAllByTestId('board-node')
      .find((el) => el.textContent?.includes('New service'))!;
    fireEvent.contextMenu(drawn);
    fireEvent.click(screen.getByTestId('board-menu-rename'));
    fireEvent.change(screen.getByTestId('board-menu-rename-input'), {
      target: { value: 'Billing' },
    });
    fireEvent.keyDown(screen.getByTestId('board-menu-rename-input'), { key: 'Enter' });

    /* One document, one edit funnel: a drawn node is a node. */
    expect(titles()).toContain('Billing');
  });

  it('a drawn service offers Generate — the separate, deliberate step', () => {
    mount();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    drawBox(screen.getByTestId('board-stroke-layer'));
    fireEvent.click(screen.getByTestId('board-draw-toggle'));

    const drawn = screen
      .queryAllByTestId('board-node')
      .find((el) => el.textContent?.includes('New service'))!;
    fireEvent.contextMenu(drawn);
    /*
     * The whole editing model, composed: draw it, and Generate is there — and
     * it still takes two more deliberate acts before anything is asked of a
     * model.
     */
    expect(screen.getByTestId('board-menu-generate')).toBeTruthy();
  });
});

describe('THE INK IS VISIBLE WHILE IT IS BEING DRAWN', () => {
  /*
   * Reported: "drawing on the actual architecture board doesn't work. On the
   * whiteboard, it works fine."
   *
   * It was never inert. StrokeLayer recorded every point and the recogniser
   * turned a closed loop into a real service — the tests above prove that and
   * were green throughout. What it rendered was NOTHING: the <svg> had no
   * children, so a reader dragged across the board, saw no mark under the
   * cursor, and stopped.
   *
   * That is the gap this file had. Every test above asserts the OUTCOME of a
   * stroke; not one asserted that the person making it could see it happening.
   */
  it('paints a path as the pointer moves, and clears it on release', () => {
    mount();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    const layer = screen.getByTestId('board-stroke-layer');
    /* Offset the SVG so LOCAL ≠ CLIENT — the bug that painted ink off-screen
       when the board sat beside chat. jsdom defaults rect to zeros. */
    vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue({
      x: 400,
      y: 80,
      left: 400,
      top: 80,
      right: 1200,
      bottom: 680,
      width: 800,
      height: 600,
      toJSON() {
        return {};
      },
    });

    expect(screen.queryByTestId('board-ink')).toBeNull();

    pointer(layer, 'pointerdown', 500, 180);
    pointer(layer, 'pointermove', 540, 200);
    pointer(layer, 'pointermove', 580, 230);

    const ink = screen.getByTestId('board-ink');
    /* LOCAL path under the cursor — not raw client coords. */
    expect(ink.getAttribute('d')).toBe('M100,100 L140,120 L180,150');

    pointer(layer, 'pointerup', 580, 230);
    expect(screen.queryByTestId('board-ink')).toBeNull();
  });

  it('a single point draws nothing — that is a click, not a gesture', () => {
    mount();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    const layer = screen.getByTestId('board-stroke-layer');
    pointer(layer, 'pointerdown', 100, 100);
    expect(screen.queryByTestId('board-ink')).toBeNull();
  });

  it('A CANCELLED POINTER LEAVES NO MARK', () => {
    /* Ink left behind by a stroke that never completed would claim an edit the
       document does not hold — the board's whole promise is the opposite. */
    mount();
    fireEvent.click(screen.getByTestId('board-draw-toggle'));
    const layer = screen.getByTestId('board-stroke-layer');
    pointer(layer, 'pointerdown', 100, 100);
    pointer(layer, 'pointermove', 140, 120);
    expect(screen.getByTestId('board-ink')).toBeTruthy();

    fireEvent.pointerCancel(layer);
    expect(screen.queryByTestId('board-ink')).toBeNull();
  });
});
