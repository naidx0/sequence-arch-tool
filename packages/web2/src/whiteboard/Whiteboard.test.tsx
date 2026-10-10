import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { recognizeStroke } from '@sequence/ink';

import { createStore } from '../state/store';
import { Whiteboard } from './Whiteboard';
import type { WbItem, WhiteboardDoc } from './whiteboardModel';
import '../tokens/graphite.css';
import './whiteboard.css';

function pickShape(tool: 'rect' | 'ellipse' | 'line' | 'arrow') {
  fireEvent.click(screen.getByTestId('wb-shapes-trigger'));
  fireEvent.click(screen.getByTestId(`wb-tool-${tool}`));
}

function pickAnnotate(tool: 'text' | 'link') {
  fireEvent.click(screen.getByTestId('wb-annotate-trigger'));
  fireEvent.click(screen.getByTestId(`wb-tool-${tool}`));
}

/**
 * THE WHITEBOARD, RENDERED.
 *
 * Owner walk 2026-08-22: "Draw. It doesn't seem to work. It doesn't let me do
 * anything." — and, separately, "a separate kind of whiteboard you can switch
 * tabs between… like a Miro board where you can literally just draw from
 * scratch."
 *
 * Those are one finding. Draw on the ARCHITECTURE board is a structured
 * editing gesture: `recognizeStroke` emits box, line or scribble, and
 * `inkToEdit` refuses a scribble, because a rough box there means "make me a
 * node". Freehand is the rejected case, by design. Here it is the only case.
 */

/** A memory Storage, so persistence is answerable without a browser. */
function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => [...map.entries()],
  };
}

/**
 * Fire a stroke.
 *
 * jsdom's `PointerEvent` CARRIES NO clientX — this is measured, not assumed,
 * and it bit this very file: `fireEvent.pointerDown(el, {clientX})` produced
 * `undefined`, `pointOf` computed `undefined - 0`, and every coordinate came
 * out NaN. React then warned "Received NaN for the x attribute" and a
 * zero-size-shape guard silently stopped working, because `NaN < 3` is false.
 *
 * So the harness dispatches MouseEvents, which do carry coordinates, under the
 * pointer event names React listens for. THE PRODUCT IS UNTOUCHED: a real
 * browser's PointerEvent has clientX, and bending the component to satisfy the
 * test environment would be fixing the wrong side.
 */
function stroke(el: Element, points: { x: number; y: number }[]) {
  const fire = (type: string, p: { x: number; y: number }) => {
    /* `fireEvent(el, event)` rather than `el.dispatchEvent(event)`: the second
       bypasses React Testing Library's act() wrapper, so the state update
       never flushes and the assertion reads a stale DOM. */
    fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y }));
  };
  fire('pointerdown', points[0]!);
  for (const p of points.slice(1)) fire('pointermove', p);
  fire('pointerup', points[points.length - 1]!);
}

const SQUIGGLE = [
  { x: 10, y: 10 },
  { x: 22, y: 41 },
  { x: 35, y: 12 },
  { x: 48, y: 44 },
  { x: 61, y: 15 },
];

describe('drawing from scratch', () => {
  it('KEEPS A FREEHAND SQUIGGLE that the architecture board refuses', () => {
    /*
     * THE WHOLE POINT, in one assertion. The same path, put through the
     * architecture board's recogniser, comes back `scribble` — which
     * `inkToEdit` refuses, and which is why Draw felt like it "doesn't let me
     * do anything". Here it becomes ink.
     */
    expect(recognizeStroke(SQUIGGLE).kind).toBe('scribble');

    const store = memoryStore();
    render(<Whiteboard repoRoot="C:/repos/shop" storage={store} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);

    const items = screen.getAllByTestId('wb-item');
    expect(items).toHaveLength(1);
    expect(items[0]!.getAttribute('data-kind')).toBe('stroke');
  });

  it('a click is not a stroke', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    stroke(screen.getByTestId('wb-canvas'), [{ x: 5, y: 5 }]);
    /* One point is a click. Storing it makes an invisible item that still
       answers hit tests, which reads as a board that cannot be cleaned up. */
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
  });

  it('draws a box with the box tool, and it is a shape rather than a node', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    pickShape('rect');
    stroke(screen.getByTestId('wb-canvas'), [
      { x: 10, y: 10 },
      { x: 90, y: 70 },
    ]);
    const item = screen.getByTestId('wb-item');
    expect(item.getAttribute('data-kind')).toBe('shape');
    /* Not a graph node: nothing here carries a node id or evidence. */
    expect(item.getAttribute('data-node-id')).toBeNull();
  });

  it('a box tool CLICK draws nothing', () => {
    /* A zero-size shape is invisible and still selectable — a board that
       cannot be tidied. */
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    pickShape('rect');
    stroke(screen.getByTestId('wb-canvas'), [
      { x: 10, y: 10 },
      { x: 11, y: 11 },
    ]);
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
  });
});

describe('the board can be undone and tidied', () => {
  it('undo takes the last mark back', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);

    fireEvent.click(screen.getByTestId('wb-undo'));
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
  });

  it('UNDO IS DISABLED WITH NOTHING TO UNDO, and a click that draws nothing does not enable it', () => {
    /*
     * `whiteboardEdit` returns the same object for a no-op and the surface
     * pushes a frame only when the document actually changed. Without that,
     * Ctrl-Z appears broken: the reader presses it and nothing visible
     * happens, several times in a row.
     */
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    const undo = screen.getByTestId('wb-undo') as HTMLButtonElement;
    expect(undo.disabled).toBe(true);

    stroke(screen.getByTestId('wb-canvas'), [{ x: 5, y: 5 }]);
    expect(undo.disabled).toBe(true);
  });

  it('erase removes the mark it is clicked on, and only that one', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    const canvas = screen.getByTestId('wb-canvas');
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(canvas, SQUIGGLE);
    stroke(canvas, [
      { x: 200, y: 200 },
      { x: 260, y: 240 },
    ]);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('wb-tool-erase'));
    fireEvent.click(screen.getAllByTestId('wb-item')[0]!);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
  });

  it('clear is disabled on an empty board', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    fireEvent.click(screen.getByTestId('wb-more'));
    expect((screen.getByTestId('wb-more-clear') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('it survives a reload, per repository', () => {
  it('a drawing comes back', () => {
    const store = memoryStore();
    const first = render(<Whiteboard repoRoot="C:/repos/shop" storage={store} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    first.unmount();

    render(<Whiteboard repoRoot="C:/repos/shop" storage={store} />);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
  });

  it('ANOTHER REPOSITORY GETS A BLANK BOARD', () => {
    /* Carrying one repo's sketches into another is worse than losing them: the
       reader would be looking at notes for a system they are not in. */
    const store = memoryStore();
    const first = render(<Whiteboard repoRoot="C:/repos/shop" storage={store} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    first.unmount();

    render(<Whiteboard repoRoot="C:/repos/other" storage={store} />);
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
  });

  it('storage that throws costs persistence, never the surface', () => {
    /* Private mode, a blocked origin, or a full quota. A sketchpad that
       refuses to open because of storage has traded the feature for a drawing. */
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    render(<Whiteboard repoRoot="r" storage={hostile} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
  });
});

describe('it says what it is', () => {
  it('an empty board shows one short muted hint, not a paragraph', () => {
    /*
     * Owner 2026-10-09: "a lot of blank text. Not a fan." The long sentence
     * about nothing being read from your code is gone; what stays is a single
     * line that says what to do.
     */
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    const note = screen.getByTestId('wb-empty');
    expect(note.textContent).toBe('Draw, or ask to sketch something');
    expect(note.textContent).not.toMatch(/nothing here is read from your code/i);
    expect(note.textContent!.length).toBeLessThan(40);
  });

  it('the note goes away once something is drawn', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    expect(screen.queryByTestId('wb-empty')).toBeNull();
  });
});

describe('SELECT AND MOVE — the edit the model could already do and nothing asked for', () => {
  /*
   * `whiteboardEdit` has handled `{ type: 'wb/move' }` since the model landed,
   * with four tests over it. Nothing in the product dispatched it: a grep for
   * `wb/move` outside `whiteboardModel.ts` returned only that file's own test.
   * So every mark on this board was fixed where it fell — you could draw a
   * plan and never rearrange it, on a surface whose stated model is "like a
   * Miro board".
   *
   * That is this repository's dominant failure mode, in the feature the owner
   * walk asked for by name.
   *
   * SELECT IS THE DEFAULT TOOL (owner, 2026-10): drag first, like the architecture
   * board; draw is picked with P.
   */

  /** Press on `el`, move over the canvas, release. */
  function drag(el: Element, canvas: Element, from: { x: number; y: number }, to: { x: number; y: number }) {
    fireEvent(el, new MouseEvent('pointerdown', { bubbles: true, clientX: from.x, clientY: from.y }));
    fireEvent(canvas, new MouseEvent('pointermove', { bubbles: true, clientX: to.x, clientY: to.y }));
    fireEvent(canvas, new MouseEvent('pointerup', { bubbles: true, clientX: to.x, clientY: to.y }));
  }

  /** The items on the board, as they were persisted. */
  function storedItems(store: ReturnType<typeof memoryStore>) {
    const raw = store.dump()[0]?.[1];
    return raw ? (JSON.parse(raw).items as { kind: string; from?: { x: number } }[]) : [];
  }

  function boardWithBox(store: ReturnType<typeof memoryStore>) {
    render(<Whiteboard repoRoot="r" storage={store} />);
    pickShape('rect');
    stroke(screen.getByTestId('wb-canvas'), [
      { x: 10, y: 10 },
      { x: 90, y: 70 },
    ]);
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    return { canvas: screen.getByTestId('wb-canvas'), item: screen.getByTestId('wb-item') };
  }

  it('opens on select (drag), not on draw, like the architecture board', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    expect(screen.getByTestId('wb-tool-select').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('wb-tool-draw').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('wb-canvas').getAttribute('data-tool')).toBe('select');
  });

  it('a press with select marks the item, and says so on the element', () => {
    const { item } = boardWithBox(memoryStore());
    fireEvent(item, new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 40 }));
    expect(screen.getByTestId('wb-item').getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('wb-sel-halo')).toBeTruthy();
  });

  it('MOVES IT, and the move is what lands on disk', () => {
    const store = memoryStore();
    const { canvas, item } = boardWithBox(store);
    drag(item, canvas, { x: 50, y: 40 }, { x: 90, y: 65 });

    const shape = storedItems(store)[0]!;
    /* The box was drawn from x=10; a +40 drag puts it at 50. Asserted on the
       PERSISTED document, because a surface that moved the pixels and not the
       record loses the move on the next reload. */
    expect(shape.from!.x).toBe(50);
  });

  it('CAPTURES A MOVE POINTER, so releasing outside still commits and ends the drag', () => {
    const store = memoryStore();
    const { canvas, item } = boardWithBox(store);
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 7 });
      return event;
    };
    const capture = vi.fn(() => {
      const relay = (event: Event) => {
        if (event.target === item || (event as PointerEvent).pointerId !== 7) return;
        const mouse = event as MouseEvent;
        item.dispatchEvent(pointer(event.type, mouse.clientX, mouse.clientY));
      };
      const release = (event: Event) => {
        relay(event);
        window.removeEventListener('pointermove', relay);
        window.removeEventListener('pointerup', release);
      };
      window.addEventListener('pointermove', relay);
      window.addEventListener('pointerup', release);
    });
    Object.defineProperty(item, 'setPointerCapture', { value: capture, configurable: true });

    fireEvent(item, pointer('pointerdown', 50, 40));
    fireEvent(document.body, pointer('pointermove', 90, 65));
    fireEvent(document.body, pointer('pointerup', 90, 65));

    expect(capture).toHaveBeenCalledWith(7);
    expect(storedItems(store)[0]!.from!.x).toBe(50);

    /* Re-entering after the outside release cannot continue the old drag. */
    fireEvent(canvas, pointer('pointermove', 130, 90));
    fireEvent(canvas, pointer('pointerup', 130, 90));
    expect(storedItems(store)[0]!.from!.x).toBe(50);
  });

  it('ONE DRAG IS ONE UNDO, not one per pointer event', () => {
    /*
     * The obvious implementation applies a move per `pointermove`, which is
     * ~60 documents a second and an undo stack that eats its own 50-deep
     * budget in under a second. Ctrl-Z would then appear to do nothing.
     */
    const store = memoryStore();
    const { canvas, item } = boardWithBox(store);
    drag(item, canvas, { x: 50, y: 40 }, { x: 90, y: 65 });
    expect(storedItems(store)[0]!.from!.x).toBe(50);

    fireEvent.click(screen.getByTestId('wb-undo'));
    expect(storedItems(store)[0]!.from!.x).toBe(10);
  });

  it('a press that does not move is not a move', () => {
    /* `whiteboardEdit` returns the same document for a zero delta, so no undo
       frame is pushed — clicking to select must not arm Undo. One click of
       Undo must therefore still take the box itself back. */
    const store = memoryStore();
    const { canvas, item } = boardWithBox(store);
    drag(item, canvas, { x: 50, y: 40 }, { x: 50, y: 40 });
    fireEvent.click(screen.getByTestId('wb-undo'));
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
  });

  it('DRAWS NOTHING while select is the tool', () => {
    /* The regression that would make select feel broken: a drag across the
       empty board leaving a stroke behind it. */
    const store = memoryStore();
    boardWithBox(store);
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
  });

  it('a press on the empty board clears the selection', () => {
    const { canvas, item } = boardWithBox(memoryStore());
    fireEvent(item, new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 40 }));
    expect(screen.getByTestId('wb-item').getAttribute('data-selected')).toBe('true');

    fireEvent(canvas, new MouseEvent('pointerdown', { bubbles: true, clientX: 300, clientY: 300 }));
    expect(screen.getByTestId('wb-item').getAttribute('data-selected')).toBe('false');
  });

  it('Delete removes the selected item, so erase is not the only way', () => {
    const { item } = boardWithBox(memoryStore());
    fireEvent(item, new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 40 }));
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
  });

  it('Delete with nothing selected does nothing', () => {
    /* A key that silently clears the board when the reader meant nothing by it
       is worse than a key that does not work. */
    const store = memoryStore();
    boardWithBox(store);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
  });

  it('Escape clears the selection without deleting anything', () => {
    const { item } = boardWithBox(memoryStore());
    fireEvent(item, new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 40 }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('wb-item').getAttribute('data-selected')).toBe('false');
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
  });
});

describe('THE CAMERA, on the surface', () => {
  /*
   * `whiteboardCamera.test.ts` proves the arithmetic. This proves a person can
   * reach it — the distinction this repository keeps paying for.
   */

  function board(store = memoryStore()) {
    render(<Whiteboard repoRoot="r" storage={store} />);
    return screen.getByTestId('wb-canvas');
  }

  const viewport = () => screen.getByTestId('wb-viewport').getAttribute('transform') ?? '';

  it('draws everything inside ONE viewport transform', () => {
    board();
    expect(viewport()).toBe('translate(0,0) scale(1)');
  });

  it('THE PAN TOOL MOVES THE CAMERA, and draws nothing', () => {
    const store = memoryStore();
    const canvas = board(store);
    fireEvent.keyDown(canvas, { key: 'h' });
    stroke(canvas, [
      { x: 10, y: 10 },
      { x: 60, y: 40 },
    ]);
    expect(viewport()).toBe('translate(50,30) scale(1)');
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
  });

  it('THE WHEEL ZOOMS', () => {
    const canvas = board();
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 0, clientY: 0 });
    expect(viewport()).toMatch(/scale\(1\.1/);
  });

  it('A MARK LANDS WHERE THE PEN IS, not where the screen is', () => {
    /*
     * The silent defect a camera introduces. With the board panned by 50, a
     * pointer at screen x=60 is at board x=10 — and a surface that stored 60
     * would put every mark somewhere the reader did not draw it, invisibly,
     * until the view was reset.
     */
    const store = memoryStore();
    const canvas = board(store);
    fireEvent.keyDown(canvas, { key: 'h' });
    stroke(canvas, [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ]);

    pickShape('rect');
    stroke(canvas, [
      { x: 60, y: 10 },
      { x: 160, y: 90 },
    ]);

    const raw = store.dump()[0]?.[1] ?? '{}';
    const shape = JSON.parse(raw).items[0] as { from: { x: number; y: number } };
    expect(shape.from.x).toBe(10);
  });

  it('FIT IS DISABLED ON AN EMPTY BOARD — there is nothing to frame', () => {
    /* `whiteboardBounds` answers null for it, and moving the camera to a
       rectangle nobody drew would be Fit inventing a destination. */
    board();
    expect((screen.getByTestId('wb-fit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reset view is disabled until the camera has actually moved', () => {
    const canvas = board();
    /* Reset view lives in More, which is always on the pill. */
    fireEvent.click(screen.getByTestId('wb-more'));
    expect((screen.getByTestId('wb-more-reset') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('wb-more'));
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 0, clientY: 0 });
    fireEvent.click(screen.getByTestId('wb-more'));
    expect((screen.getByTestId('wb-more-reset') as HTMLButtonElement).disabled).toBe(false);
  });

  it('reset takes it home', () => {
    const canvas = board();
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 0, clientY: 0 });
    fireEvent.click(screen.getByTestId('wb-more'));
    fireEvent.click(screen.getByTestId('wb-more-reset'));
    expect(viewport()).toBe('translate(0,0) scale(1)');
  });

  it('the camera is NOT persisted with the drawing', () => {
    /*
     * Where you were last looking is not part of what you drew. Restoring a
     * camera position on open is a surface deciding where the reader wanted to
     * be — and on a shared repository, deciding it from somebody else's session.
     */
    const store = memoryStore();
    const canvas = board(store);
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 0, clientY: 0 });
    stroke(canvas, SQUIGGLE);
    const raw = store.dump()[0]?.[1] ?? '{}';
    expect(raw).not.toMatch(/zoom/);
  });
});

describe('A DRAWING POINTS AT REAL STRUCTURE, and hands itself to the AI', () => {
  /*
   * `WbNodeRef` had a type, a renderer and a stylesheet, and NOTHING CREATED
   * ONE. It is the whiteboard's only structural link back to the scan — the
   * missing half of "not just visually, but in real structure within the
   * project" — and it was unreachable.
   *
   * The whiteboard also had no AI hand-off of any kind, while the architecture
   * board has the Generate gate. Moat point 4 is "draw ↔ chat sync"; this
   * surface had none of it.
   */
  const GRAPH = {
    nodes: [
      { id: 'svc:gateway', label: 'gateway', kind: 'service' },
      { id: 'svc:payments', label: 'payments', kind: 'service' },
    ],
    edges: [],
    repoName: 'shop',
  } as never;

  function linked(onAsk?: (r: { prompt: string; nodeIds: string[] }) => void) {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} graph={GRAPH} onAsk={onAsk} />);
    return { store, canvas: screen.getByTestId('wb-canvas') };
  }

  function placeRef(canvas: Element, query: string) {
    pickAnnotate('link');
    fireEvent(canvas, new MouseEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 40 }));
    fireEvent.change(screen.getByTestId('wb-picker-query'), { target: { value: query } });
    const rows = screen.getAllByTestId('wb-picker-row');
    fireEvent.click(rows[0]!);
  }

  it('THE LINK TOOL CREATES A NODE REFERENCE, ranked by the composer s own matcher', () => {
    const { store, canvas } = linked();
    placeRef(canvas, 'pay');

    const item = screen.getByTestId('wb-item');
    expect(item.getAttribute('data-kind')).toBe('noderef');

    const stored = JSON.parse(store.dump()[0]?.[1] ?? '{}').items[0];
    expect(stored.nodeId).toBe('svc:payments');
    expect(stored.label).toBe('payments');
  });

  it('it lands WHERE THE READER PRESSED', () => {
    const { store, canvas } = linked();
    placeRef(canvas, 'pay');
    const stored = JSON.parse(store.dump()[0]?.[1] ?? '{}').items[0];
    expect(stored.at).toEqual({ x: 40, y: 40 });
  });

  it('NOTHING MATCHES IS A RENDERED ROW, and there is NO free-text fallback', () => {
    /*
     * Sheet 12.4's ruling, inherited from the composer's `@`: a reference
     * "resolves against the graph, or it resolves against nothing… where
     * nothing matches it says so and offers NO FREE-TEXT FALLBACK, because a
     * reference the engine cannot resolve is the exact thing this product
     * exists to prevent."
     */
    const { canvas } = linked();
    pickAnnotate('link');
    fireEvent(canvas, new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    fireEvent.change(screen.getByTestId('wb-picker-query'), { target: { value: 'zzzznope' } });

    expect(screen.getByTestId('wb-picker-none')).toBeTruthy();
    expect(screen.queryAllByTestId('wb-picker-row')).toHaveLength(0);
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
  });

  it('with no project open it says THAT, rather than showing an empty list', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot={null} storage={store} graph={null} />);
    const canvas = screen.getByTestId('wb-canvas');
    pickAnnotate('link');
    fireEvent(canvas, new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(screen.getByTestId('wb-picker-none').textContent).toMatch(/No project/i);
  });

  it('Escape closes the picker without marking the board', () => {
    const { canvas } = linked();
    pickAnnotate('link');
    fireEvent(canvas, new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    fireEvent.keyDown(screen.getByTestId('wb-picker-query'), { key: 'Escape' });
    expect(screen.queryByTestId('wb-picker')).toBeNull();
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
  });

  it('ASK IS DISABLED UNTIL THE BOARD SAYS SOMETHING', () => {
    /* A sketch of unlabelled strokes produces a request whose whole content is
       "the reader drew three lines". Refusing says that for free. */
    const { canvas } = linked(() => {});
    expect((screen.getByTestId('wb-ask') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(canvas, SQUIGGLE);
    expect((screen.getByTestId('wb-ask') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a reference alone is enough to ask about', () => {
    const { canvas } = linked(() => {});
    placeRef(canvas, 'gate');
    expect((screen.getByTestId('wb-ask') as HTMLButtonElement).disabled).toBe(false);
  });

  it('THE REQUEST REACHES THE HOST, carrying the note and the references', () => {
    const seen: { prompt: string; nodeIds: string[] }[] = [];
    const { canvas } = linked((r) => seen.push(r));
    placeRef(canvas, 'gate');

    fireEvent.click(screen.getByTestId('wb-ask'));
    fireEvent.change(screen.getByTestId('wb-ask-note'), {
      target: { value: 'put a rate limiter in front of this' },
    });
    fireEvent.click(screen.getByTestId('wb-ask-send'));

    expect(seen).toHaveLength(1);
    expect(seen[0]!.nodeIds).toEqual(['svc:gateway']);
    expect(seen[0]!.prompt.startsWith('put a rate limiter in front of this')).toBe(true);
    /* And it says the sketch is not evidence, in the prompt itself. */
    expect(seen[0]!.prompt).toMatch(/not from the scan/);
  });

  it('Back closes the panel and sends nothing', () => {
    const seen: unknown[] = [];
    const { canvas } = linked((r) => seen.push(r));
    placeRef(canvas, 'gate');
    fireEvent.click(screen.getByTestId('wb-ask'));
    fireEvent.click(screen.getByTestId('wb-ask-cancel'));
    expect(screen.queryByTestId('wb-ask-panel')).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('WITHOUT A HOST THERE IS NO CONTROL, rather than a dead one', () => {
    /* A button that looks like it does something and does not is worse than an
       absent one — the register is full of them. */
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} graph={GRAPH} />);
    expect(screen.queryByTestId('wb-ask')).toBeNull();
  });
});

describe('a note can be given words', () => {
  /*
   * `whiteboardEdit` has handled `wb/text` since the model landed and nothing
   * dispatched it, so every note on every board read "Note" for ever.
   */
  it('DOUBLE-CLICK EDITS IT, and the new words land on disk', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    const canvas = screen.getByTestId('wb-canvas');

    pickAnnotate('text');
    stroke(canvas, [
      { x: 30, y: 30 },
      { x: 30, y: 30 },
    ]);
    expect(screen.getByTestId('wb-item').textContent).toBe('Note');

    fireEvent.click(screen.getByTestId('wb-tool-select'));
    fireEvent.doubleClick(screen.getByTestId('wb-item'));
    fireEvent.change(screen.getByTestId('wb-edit-text'), { target: { value: 'split auth out' } });
    fireEvent.keyDown(screen.getByTestId('wb-edit-text'), { key: 'Enter' });

    expect(screen.getByTestId('wb-item').textContent).toBe('split auth out');
    expect(store.dump()[0]?.[1]).toContain('split auth out');
  });

  it('Escape leaves it as it was', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    const canvas = screen.getByTestId('wb-canvas');
    pickAnnotate('text');
    stroke(canvas, [
      { x: 30, y: 30 },
      { x: 30, y: 30 },
    ]);
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    fireEvent.doubleClick(screen.getByTestId('wb-item'));
    fireEvent.change(screen.getByTestId('wb-edit-text'), { target: { value: 'discarded' } });
    fireEvent.keyDown(screen.getByTestId('wb-edit-text'), { key: 'Escape' });
    expect(screen.getByTestId('wb-item').textContent).toBe('Note');
  });

  it('Backspace edits the input instead of deleting the selected note', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    const canvas = screen.getByTestId('wb-canvas');
    pickAnnotate('text');
    stroke(canvas, [
      { x: 30, y: 30 },
      { x: 30, y: 30 },
    ]);
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    const item = screen.getByTestId('wb-item');
    fireEvent(item, new MouseEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 30 }));
    fireEvent(canvas, new MouseEvent('pointerup', { bubbles: true, clientX: 30, clientY: 30 }));
    fireEvent.doubleClick(item);

    const allowed = fireEvent.keyDown(screen.getByTestId('wb-edit-text'), { key: 'Backspace' });

    expect(allowed).toBe(true);
    expect(screen.getByTestId('wb-item').textContent).toBe('Note');
    expect(screen.getByTestId('wb-edit-text')).toBeTruthy();
  });

  it('only a NOTE is editable — a stroke has no words to change', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    fireEvent.doubleClick(screen.getByTestId('wb-item'));
    expect(screen.queryByTestId('wb-edit')).toBeNull();
  });
});

describe('the tool row groups shapes and annotate behind menus', () => {
  /*
   * Owner 2026-08-25: expandable features rather than an icon dump. Primary
   * tools (select/pan/draw/erase) stay one click; shapes and annotate open
   * from a menu. Decision 8/9 glyphs and accessible names still apply inside
   * the menus.
   */
  const PRIMARY = [
    ['select', 'Select'],
    ['draw', 'Draw'],
    ['erase', 'Erase'],
  ] as const;

  const SHAPE = [
    ['rect', 'Box'],
    ['ellipse', 'Oval'],
    ['line', 'Line'],
    ['arrow', 'Arrow'],
  ] as const;

  const ANNOTATE = [
    ['text', 'Text'],
    ['link', 'Link'],
  ] as const;

  it('keeps primary tools one click and dumps shapes/annotate into menus', () => {
    render(<Whiteboard repoRoot={null} storage={memoryStore()} />);
    for (const [tool] of PRIMARY) {
      expect(screen.getByTestId(`wb-tool-${tool}`)).toBeTruthy();
    }
    expect(screen.queryByTestId('wb-tool-rect')).toBeNull();
    expect(screen.queryByTestId('wb-tool-text')).toBeNull();
    expect(screen.getByTestId('wb-shapes-trigger')).toBeTruthy();
    expect(screen.getByTestId('wb-annotate-trigger')).toBeTruthy();
  });

  it('has no Pan button: Space-hold and an empty-board drag pan, and H still picks the tool', () => {
    render(<Whiteboard repoRoot={null} storage={memoryStore()} />);
    expect(screen.queryByTestId('wb-tool-pan')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('wb-canvas'), { key: 'h' });
    expect(screen.getByTestId('wb-canvas').getAttribute('data-tool')).toBe('pan');
  });

  it('renders a GLYPH for every primary tool', () => {
    render(<Whiteboard repoRoot={null} storage={memoryStore()} />);
    for (const [tool] of PRIMARY) {
      const btn = screen.getByTestId(`wb-tool-${tool}`);
      expect(btn.querySelector('svg'), `${tool} should draw a glyph`).toBeTruthy();
      expect(btn.textContent.trim(), `${tool} shows no bare word`).toBe('');
    }
  });

  it('KEEPS THE WORD AS THE ACCESSIBLE NAME on every tool (menus included)', () => {
    render(<Whiteboard repoRoot={null} storage={memoryStore()} />);
    const KEY: Record<string, string> = { select: 'V', draw: 'P', erase: 'E' };
    for (const [tool, word] of PRIMARY) {
      const btn = screen.getByTestId(`wb-tool-${tool}`);
      expect(btn.getAttribute('aria-label'), `${tool} keeps its aria-label`).toBe(word);
      expect(btn.getAttribute('title'), `${tool} tooltip shows its key`).toBe(`${word} (${KEY[tool]})`);
    }
    fireEvent.click(screen.getByTestId('wb-shapes-trigger'));
    for (const [tool, word] of SHAPE) {
      const btn = screen.getByTestId(`wb-tool-${tool}`);
      expect(btn.getAttribute('aria-label'), `${tool} keeps its aria-label`).toBe(word);
    }
    fireEvent.click(screen.getByTestId('wb-annotate-trigger'));
    for (const [tool, word] of ANNOTATE) {
      const btn = screen.getByTestId(`wb-tool-${tool}`);
      expect(btn.getAttribute('aria-label'), `${tool} keeps its aria-label`).toBe(word);
    }
  });

  it('draws each tool with its OWN pixel-grid glyph, none borrowed from another tool', () => {
    render(<Whiteboard repoRoot={null} storage={memoryStore()} />);
    const glyphOf = (id: string) => screen.getByTestId(id).querySelector('svg:not(.wb-caret)')?.getAttribute('data-wb-icon');

    expect(glyphOf('wb-tool-select')).toBe('select');
    expect(glyphOf('wb-tool-draw')).toBe('draw');
    expect(glyphOf('wb-tool-erase')).toBe('erase');
    fireEvent.click(screen.getByTestId('wb-shapes-trigger'));
    expect(glyphOf('wb-tool-rect')).toBe('rect');
    expect(glyphOf('wb-tool-ellipse')).toBe('ellipse');
    expect(glyphOf('wb-tool-line')).toBe('line');
    expect(glyphOf('wb-tool-arrow')).toBe('arrow');
    expect(screen.getByTestId('wb-tool-ellipse').querySelector('svg ellipse')).toBeTruthy();
    expect(screen.getByTestId('wb-tool-rect').querySelectorAll('svg rect').length).toBe(1);

    fireEvent.click(screen.getByTestId('wb-annotate-trigger'));
    expect(glyphOf('wb-tool-text')).toBe('text');
    expect(glyphOf('wb-tool-sticky')).toBe('sticky');
    expect(glyphOf('wb-tool-link')).toBe('link');

    /* Derived from the page: no two tools on the pill and its menus draw the same glyph. */
    const all = [...document.querySelectorAll('[data-testid^="wb-tool-"] svg:not(.wb-caret)')].map((s) => s.getAttribute('data-wb-icon'));
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(new Set(all).size).toBe(all.length);
  });

  it('paints whiteboard icons with stroke (seat blank-button lock): outlined, 16px, never filled solid', () => {
    render(<Whiteboard repoRoot={null} storage={memoryStore()} />);
    const svg = screen.getByTestId('wb-tool-select').querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.classList.contains('wb-ic')).toBe(true);
    expect(svg!.getAttribute('stroke')).toBe('currentColor');
    expect(svg!.getAttribute('fill')).toBe('none');
    expect(svg!.getAttribute('width')).toBe('16');
  });
});

/*
 * THE TWO PROPS THAT LET THE AGENT REACH THIS SURFACE — code-canvas item 1.4.
 *
 * The board's document lived in this component's own `useState`, which is why
 * `packages/analyzer/` contained no whiteboard code at all: there was nowhere
 * outside the file for a written item to land and nowhere for the ask payload
 * to read one from. The camera, the model, the edit vocabulary and fifty frames
 * of undo were finished, and the surface was sealed.
 */
describe('the board can be read and written from outside', () => {
  it('mirrors the document out on hydrate and on every edit', async () => {
    const seen: WhiteboardDoc[] = [];
    const storage = memoryStore();
    render(
      <Whiteboard repoRoot="/r" storage={storage} onDocChange={(d) => seen.push(d)} />,
    );
    // Hydration counts: a parent that only hears about EDITS never learns what
    // was already on the board when the surface opened.
    await waitFor(() => expect(seen.length).toBeGreaterThan(0));
    expect(seen[0]!.items).toEqual([]);
  });

  it('APPENDS what the agent drew, and does not adopt a foreign document', async () => {
    const storage = memoryStore();
    const view = render(<Whiteboard repoRoot="/r" storage={storage} />);
    const agentItem = { kind: 'text', id: 'agent-1', at: { x: 10, y: 10 }, text: 'cache' } as WbItem;
    view.rerender(<Whiteboard repoRoot="/r" storage={storage} agentItems={[agentItem]} />);
    await waitFor(() => expect(screen.getByText('cache')).toBeTruthy());
  });

  it('is IDEMPOTENT — a replayed event cannot double-draw', async () => {
    const storage = memoryStore();
    const agentItem = { kind: 'text', id: 'agent-1', at: { x: 10, y: 10 }, text: 'once' } as WbItem;
    const view = render(
      <Whiteboard repoRoot="/r" storage={storage} agentItems={[agentItem]} />,
    );
    await waitFor(() => expect(screen.getAllByText('once')).toHaveLength(1));
    // The same item arriving again — a re-render, a reconnect, a replayed frame.
    view.rerender(
      <Whiteboard repoRoot="/r" storage={storage} agentItems={[agentItem, agentItem]} />,
    );
    await waitFor(() => expect(screen.getAllByText('once')).toHaveLength(1));
  });

  it('renders exactly as before when neither prop is given', async () => {
    // The property that keeps every existing test in this file meaningful.
    const storage = memoryStore();
    const { container } = render(<Whiteboard repoRoot="/r" storage={storage} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

/*
 * A GROUNDED REFERENCE DRAWS AS A CODE CARD — and this test exists because it
 * did not.
 *
 * `CodeCard` shipped with 23 tests and was rendered by nothing: a grep for it
 * across the app found only its `elidePath` helper being imported by another
 * component. That is the defect this repo keeps catching — canvas/proposal
 * dispatched by nothing, SeqChartView with no caller, WorkspaceFiles, the board
 * writers — and it was in the board program's own renderer.
 */
describe('a grounded reference is a code card', () => {
  const card = {
    kind: 'noderef',
    id: 'c1',
    at: { x: 20, y: 20 },
    nodeId: 'file:src/scan.ts',
    label: 'scan.ts',
    path: 'src/scan.ts',
    lines: { from: 10, to: 24 },
  } as WbItem;

  it('renders the CARD when the reference carries a path', async () => {
    const storage = memoryStore();
    render(<Whiteboard repoRoot="/r" storage={storage} agentItems={[card]} />);
    await waitFor(() => expect(screen.getByTestId('code-card')).toBeTruthy());
    expect(screen.getByTestId('code-card-path').textContent).toContain('scan.ts');
  });

  it('keeps the bare CAPTION when it does not', async () => {
    /*
     * A hand-placed `@` mention knows a label and a node id and nothing else.
     * A card frame round a lone word promises a file the surface cannot show.
     */
    const storage = memoryStore();
    const mention = { kind: 'noderef', id: 'm1', at: { x: 5, y: 5 }, nodeId: 'svc:api', label: 'api' } as WbItem;
    render(<Whiteboard repoRoot="/r" storage={storage} agentItems={[mention]} />);
    await waitFor(() => expect(screen.getByText('api')).toBeTruthy());
    expect(screen.queryByTestId('code-card')).toBeNull();
  });
});

/*
 * A FRAME WITH NO BLOCK IS NOT DRAWN — owner photo and live measurement,
 * 2026-09-22: a new chat opened onto a "Block gone" frame saved there from the
 * previous chat's Mermaid diagram.
 */
describe('artifact frames the document does not hold', () => {
  const doc = (ids: string[]) =>
    JSON.stringify({
      version: 1,
      items: ids.map((id) => ({
        kind: 'artifact',
        id,
        at: { x: 40, y: 40 },
        size: { w: 200, h: 120 },
        ref: { type: 'block', blockId: id.replace('artifact:block:', '') },
      })),
    });

  it('are not drawn, while the ones it holds are', () => {
    const store = memoryStore();
    store.setItem('k', doc(['artifact:block:gone', 'artifact:block:here']));
    render(
      <Whiteboard
        repoRoot="r"
        storage={store}
        storageKey="k"
        artifactIds={new Set(['artifact:block:here'])}
        renderArtifact={(item) => <span>{item.id === 'artifact:block:here' ? 'Here' : 'Block gone'}</span>}
      />,
    );
    expect(screen.queryByText('Block gone')).toBeNull();
    expect(screen.getByText('Here')).toBeTruthy();
  });

  it('a switch to another key never writes the old document under the new one', () => {
    const store = memoryStore();
    store.setItem('chat-a', doc(['artifact:block:a1']));
    const view = render(<Whiteboard repoRoot="r" storage={store} storageKey="chat-a" />);
    view.rerender(<Whiteboard repoRoot="r" storage={store} storageKey="chat-b" />);
    const b = store.getItem('chat-b');
    expect(b === null || !b.includes('artifact:block:a1')).toBe(true);
  });
});

describe('DRAG FIRST — the board behaves like the architecture board', () => {
  const viewport = () => screen.getByTestId('wb-viewport').getAttribute('transform') ?? '';

  it('an empty-canvas drag pans the camera and draws nothing', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    stroke(screen.getByTestId('wb-canvas'), [
      { x: 10, y: 10 },
      { x: 60, y: 40 },
    ]);
    expect(viewport()).toBe('translate(50,30) scale(1)');
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
  });

  it('Space pans from the pen, and releasing it gives the pen back', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    const canvas = screen.getByTestId('wb-canvas');
    fireEvent.keyDown(canvas, { key: ' ', code: 'Space' });
    expect(canvas.getAttribute('data-space-pan')).toBe('true');
    stroke(canvas, [
      { x: 0, y: 0 },
      { x: 20, y: 20 },
    ]);
    expect(viewport()).toBe('translate(20,20) scale(1)');
    expect(screen.queryAllByTestId('wb-item')).toHaveLength(0);
    fireEvent.keyUp(canvas, { key: ' ', code: 'Space' });
    expect(canvas.getAttribute('data-space-pan')).toBeNull();
    stroke(canvas, SQUIGGLE);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
  });

  it('letter keys switch tools, and are ignored while typing in a field', () => {
    render(
      <>
        <Whiteboard repoRoot="r" storage={memoryStore()} />
        <input data-testid="other" />
      </>,
    );
    const canvas = screen.getByTestId('wb-canvas');
    const pressed = (id: string) => screen.getByTestId(id).getAttribute('aria-pressed');
    fireEvent.keyDown(canvas, { key: 'p' });
    expect(pressed('wb-tool-draw')).toBe('true');
    fireEvent.keyDown(canvas, { key: 'h' });
    expect(canvas.getAttribute('data-tool')).toBe('pan');
    fireEvent.keyDown(canvas, { key: 'e' });
    expect(pressed('wb-tool-erase')).toBe('true');
    fireEvent.keyDown(canvas, { key: 'v' });
    expect(pressed('wb-tool-select')).toBe('true');
    fireEvent.keyDown(canvas, { key: 'r' });
    expect(canvas.getAttribute('data-tool')).toBe('rect');
    fireEvent.keyDown(screen.getByTestId('other'), { key: 'p' });
    expect(canvas.getAttribute('data-tool')).toBe('rect');
  });

  it('Shift-drag marquees an item instead of panning', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    const canvas = screen.getByTestId('wb-canvas');
    stroke(canvas, SQUIGGLE);
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    const fire = (type: string, x: number, y: number) =>
      fireEvent(canvas, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, shiftKey: true }));
    fire('pointerdown', -50, -50);
    fire('pointermove', 600, 600);
    fire('pointerup', 600, 600);
    expect(screen.getByTestId('wb-item').getAttribute('data-selected')).toBe('true');
    expect(viewport()).toBe('translate(0,0) scale(1)');
  });
});

describe('THE AGENT RE-LAYS ITS DRAWING — later versions replace earlier ones', () => {
  const rect = (id: string, x: number): WbItem => ({
    kind: 'shape',
    id,
    shape: 'rect',
    from: { x, y: 0 },
    to: { x: x + 156, y: 44 },
  });
  const label = (id: string, text: string): WbItem => ({ kind: 'text', id, at: { x: 0, y: 0 }, text });

  const xs = () =>
    screen
      .getAllByTestId('wb-item')
      .map((el) => Number(el.getAttribute('x')))
      .sort((p, q) => p - q);

  it('replaces a mark the agent re-sent at new geometry', () => {
    const store = memoryStore();
    const view = render(<Whiteboard repoRoot="r" storage={store} agentItems={[rect('a:box', 0), label('a', 'Plan')]} />);
    expect(xs()).toEqual([0]);
    view.rerender(<Whiteboard repoRoot="r" storage={store} agentItems={[rect('a:box', 300), label('a', 'Plan')]} />);
    expect(xs()).toEqual([300]);
  });

  it('drops the extra segments of a connector whose route got shorter, and only those', () => {
    const store = memoryStore();
    const seg = (id: string, x: number): WbItem => ({ kind: 'shape', id, shape: 'line', from: { x, y: 0 }, to: { x, y: 50 } });
    const view = render(<Whiteboard repoRoot="r" storage={store} agentItems={[rect('a:box', 0), seg('e', 10), seg('e:s1', 20), seg('e:s2', 30)]} />);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(4);
    view.rerender(<Whiteboard repoRoot="r" storage={store} agentItems={[rect('a:box', 0), seg('e', 10)]} />);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(2);
  });

  it('NEVER DELETES THE DRAWING when the agent items reset (a chat switch)', () => {
    const store = memoryStore();
    const onDocChange = vi.fn();
    const view = render(
      <Whiteboard repoRoot="r" storage={store} onDocChange={onDocChange} agentItems={[rect('a:box', 0), label('a', 'Plan')]} />,
    );
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
    onDocChange.mockClear();
    /* store.ts `session/hydrated` sets boardAgentItems to []. */
    view.rerender(<Whiteboard repoRoot="r" storage={store} onDocChange={onDocChange} agentItems={[]} />);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
    expect(onDocChange).not.toHaveBeenCalled();
    /* ... and to ANOTHER chat's marks: the first chat's drawing is still there. */
    view.rerender(<Whiteboard repoRoot="r" storage={store} onDocChange={onDocChange} agentItems={[rect('z:box', 500), label('z', 'Other')]} />);
    expect(xs()).toEqual([0, 500]);
  });

  it('keeps the drawing through a chat switch in the REAL store', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/draft', text: 'draw a loop' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({
      type: 'turn/event',
      event: {
        type: 'board:item',
        items: [
          { kind: 'shape', id: 'a:box', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 156, y: 44 } },
          { kind: 'text', id: 'a', at: { x: 14, y: 25 }, text: 'Plan' },
        ],
      },
      at: 2,
    });
    const storeItems = () => store.getState().session.boardAgentItems as readonly WbItem[];
    expect(storeItems()).toHaveLength(2);
    const backing = memoryStore();
    const view = render(<Whiteboard repoRoot="r" storage={backing} agentItems={storeItems()} />);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
    store.dispatch({ type: 'session/browse', activeId: 'other', turns: [] });
    expect(storeItems()).toHaveLength(0);
    view.rerender(<Whiteboard repoRoot="r" storage={backing} agentItems={storeItems()} />);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
  });

  it('draws the label inside its box, wrapped, and the box grows to hold it', () => {
    render(
      <Whiteboard
        repoRoot="r"
        storage={memoryStore()}
        agentItems={[rect('r:box', 0), label('r', 'Tool result (stdout, files, errors, anything else the tool returned)')]}
      />,
    );
    const lines = screen.getAllByTestId('wb-label-line');
    expect(lines.length).toBeGreaterThan(2);
    const box = screen.getByTestId('wb-item');
    expect(Number(box.getAttribute('height'))).toBeGreaterThanOrEqual(lines.length * 18 + 24);
    /* The label item is not ALSO drawn as loose text. */
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
  });
});

describe('THE TOOLBAR IS ONE FLOATING PILL, ONE LINE (jsdom has no layout: the DOM and CSS contract; the browser run is in the PR shots)', () => {
  const css = readFileSync(path.resolve(__dirname, 'whiteboard.css'), 'utf8');
  /** Every `@container wb (query)` block, joined: a width may be styled in more than one step. */
  const rules = (query: string) => {
    const found: string[] = [];
    for (let at = css.indexOf(`@container wb (${query})`); at >= 0; at = css.indexOf(`@container wb (${query})`, at + 1)) {
      let depth = 0;
      for (let i = css.indexOf('{', at); i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}' && --depth === 0) {
          found.push(css.slice(at, i + 1));
          break;
        }
      }
    }
    return found.length > 0 ? found.join('\n') : null;
  };
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };
  const order = () =>
    [...screen.getByTestId('wb-tools').querySelectorAll('button')]
      .map((b) => b.getAttribute('data-testid'))
      .filter((id) => id && !id.startsWith('wb-more-'));

  it('has no block above the board: the tools are a pill over the canvas, and the canvas is the first thing in flow', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} onAsk={() => undefined} />);
    const tools = screen.getByTestId('wb-tools');
    expect(tools.closest('.wb-furniture')).not.toBeNull();
    /* The overlay is out of flow, so it cannot take a row above the canvas. */
    expect(rule('.wb-furniture')).toMatch(/position:\s*absolute/);
    expect(rule('.wb-furniture')).toMatch(/pointer-events:\s*none/);
    expect(rule('.wb-tools')).not.toMatch(/border-bottom/);
    expect(rule('.wb-tools')).toMatch(/border-radius:\s*var\(--r-full\)/);
    expect(rule('.wb-tools')).toMatch(/inline-flex/);
  });

  it('is one row, in the documented order, with exactly one primary', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} onAsk={() => undefined} />);
    expect(order()).toEqual([
      'wb-tool-select',
      'wb-tool-draw',
      'wb-shapes-trigger',
      'wb-annotate-trigger',
      'wb-tool-erase',
      'wb-undo',
      'wb-fit',
      'wb-more',
      'wb-ask',
    ]);
    /* Nothing on the pill repeats another control: Pan is Space-hold and an empty drag, Reset view is in More beside Clear. */
    for (const gone of ['wb-tool-pan', 'wb-reset-view', 'wb-clear']) expect(screen.queryByTestId(gone), gone).toBeNull();
    expect(screen.getByTestId('wb-tools').querySelectorAll('.wb-tool-solid')).toHaveLength(1);
    expect(screen.getByTestId('wb-ask').classList.contains('wb-tool-solid')).toBe(true);
    expect(rule('.wb-tools')).toMatch(/flex-wrap:\s*nowrap/);
    expect(css).not.toMatch(/flex-wrap:\s*wrap/);
  });

  it('gives every control the same height, and a name', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} onAsk={() => undefined} />);
    expect(rule('.wb-tool')).toMatch(/height:\s*var\(--control-h-lg\)/);
    expect(rule('.wb-tool-solid')).not.toMatch(/height:/);
    for (const b of screen.getByTestId('wb-tools').querySelectorAll('button')) {
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('title')).toBeTruthy();
    }
    /* Ask has inner padding of its own: it is a word, not a glyph. */
    expect(rule('.wb-tool-solid')).toMatch(/padding:\s*0 var\(--sp-16\)/);
  });

  it('folds Undo and Fit into More under 520px of the board, never into a second row; More itself is always there', () => {
    const block = rules('max-width: 520px');
    expect(block).not.toBeNull();
    expect(block).toMatch(/\.wb-opt[^}]*display:\s*none/);
    expect(block).toMatch(/\.wb-more-menu \.wb-fold[^}]*display:\s*flex/);
    expect(block).not.toMatch(/flex-wrap/);
    /* More has no hiding rule of its own, and its folded rows are hidden until the pill folds. */
    expect(css).not.toMatch(/\.wb-morewrap \{\s*display:\s*none/);
    expect(css).toMatch(/\.wb-fold \{\s*display:\s*none/);
  });

  it('IS THE ARCHITECTURE DOCK: one fill, one padding, one separator, one border, one shadow, no blur', () => {
    const arch = readFileSync(path.resolve(__dirname, '../canvas/board.css'), 'utf8');
    /* The rule that DRAWS the dock (the narrow-board rules repeat the selector with a smaller padding). */
    const archRule = (sel: string) => {
      const all = [...arch.matchAll(new RegExp(`${sel.replace(/[.]/g, '\.')} \{([^}]*)\}`, 'g'))].map((m) => m[1]!);
      return all.find((body) => /border-radius|height: var\(--dock-sep-h\)|width: var\(--w-hair\)/.test(body)) ?? '';
    };
    /* ONE fill, defined once, applied to both inside the translucent-allowed media query. */
    const shared = arch.slice(arch.indexOf('@media not (prefers-reduced-transparency: reduce)'));
    expect(shared).toMatch(/\.board-scope \.bdock\.bdock\.bdock,\s*\.wb-scope \.wb-tools\.wb-tools\.wb-tools \{\s*background: var\(--dock-fill\)/);
    const fill = /--dock-fill: color-mix\(in srgb, var\(--surface-1\) (\d+)%, transparent\)/.exec(arch);
    expect(fill, 'a translucent fill').not.toBeNull();
    /* A notch more transparent than the 80% it was, but still a surface, not a smear. */
    expect(Number(fill![1])).toBeLessThan(80);
    expect(Number(fill![1])).toBeGreaterThanOrEqual(60);
    /* Neither dock sets its own fill beside the shared one. */
    expect(rule('.wb-tools')).not.toMatch(/\n\s*background:/);
    /* The same padding, separator, border, radius and shadow, read off the same tokens. */
    expect(rule('.wb-tools')).toMatch(/padding:\s*var\(--dock-pad\)/);
    expect(archRule('.board-scope .bdock')).toMatch(/padding:\s*var\(--dock-pad\)/);
    expect(rule('.wb-sep')).toMatch(/height:\s*var\(--dock-sep-h\)/);
    expect(archRule('.board-scope .bdock-sep')).toMatch(/height:\s*var\(--dock-sep-h\)/);
    for (const prop of [/border:\s*var\(--w-hair\) solid var\(--glass-ctl-edge\)/, /border-radius:\s*var\(--r-full\)/, /box-shadow:\s*var\(--e1\)/, /gap:\s*var\(--sp-4\)/]) {
      expect(rule('.wb-tools')).toMatch(prop);
      expect(archRule('.board-scope .bdock')).toMatch(prop);
    }
    /* The style ratchet caps blurring backdrops, and a blurred ancestor would blind the pill's menus. */
    expect(rule('.wb-tools') + shared).not.toMatch(/backdrop-filter:\s*blur/);
  });

  it('keeps Undo, Fit, Reset and Clear reachable from More, with the same behaviour', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    fireEvent.click(screen.getByTestId('wb-more'));
    expect(['undo', 'fit', 'reset', 'clear'].map((id) => screen.getByTestId(`wb-more-${id}`).textContent)).toEqual([
      'Undo',
      'Fit to drawing',
      'Reset view',
      'Clear board',
    ]);
    fireEvent.click(screen.getByTestId('wb-more-clear'));
    expect(screen.queryByTestId('wb-item')).toBeNull();
    expect(screen.queryByTestId('wb-more-menu')).toBeNull();
  });

  it('opens its menus upward out of the pill, and never clips them', () => {
    expect(rule('.wb-menu')).toMatch(/bottom:\s*calc\(100% \+/);
    expect(rule('.wb-menu')).not.toMatch(/\btop:/);
    expect(rule('.wb-tools')).not.toMatch(/overflow:\s*hidden/);
  });

  it('keeps Undo and Fit reachable at every width (inline, or listed in More when the board is narrow); Reset and Clear only in More', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    for (const id of ['wb-undo', 'wb-fit']) expect(screen.getByTestId(id).classList.contains('wb-opt')).toBe(true);
    /* Every narrow step that hides .wb-opt shows the folded rows of More in the same step. */
    const widths = [...css.matchAll(/@container wb \(max-width: (\d+)px\)/g)].map((m) => m[1]);
    expect(widths.length).toBeGreaterThan(0);
    let hid = 0;
    for (const w of widths) {
      const block = rules(`max-width: ${w}px`)!;
      if (/\.wb-opt[^}]*display:\s*none/.test(block)) {
        hid++;
        expect(block).toMatch(/\.wb-more-menu \.wb-fold[^}]*display:\s*flex/);
      }
    }
    expect(hid).toBeGreaterThan(0);
    /* Nothing hides Undo or Fit by name. */
    for (const block of css.match(/@container wb[\s\S]*?\n\}/g) ?? []) expect(block).not.toMatch(/wb-fit|wb-undo/);
    /* More is outside the .wb-opt group, so the fold can never hide it, and it lists all four. */
    expect(screen.getByTestId('wb-more').closest('.wb-opt')).toBeNull();
    fireEvent.click(screen.getByTestId('wb-more'));
    const rows = (id: string) => screen.getByTestId(`wb-more-${id}`);
    expect(rows('undo').classList.contains('wb-fold')).toBe(true);
    expect(rows('fit').classList.contains('wb-fold')).toBe(true);
    expect(rows('reset').classList.contains('wb-fold')).toBe(false);
    expect(rows('clear').classList.contains('wb-fold')).toBe(false);
  });

  it('sizes the Ask panel and the link picker to the board, not the window', () => {
    expect(rule('.wb-askpanel')).toMatch(/100cqw/);
    expect(rule('.wb-askpanel')).not.toMatch(/\bvw\b/);
    expect(rule('.wb-picker')).toMatch(/100cqw/);
    expect(rule('.wb-picker')).not.toMatch(/\bvw\b/);
  });

  describe('menu keyboard and pointer', () => {
    const drawn = () => {
      render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
      fireEvent.click(screen.getByTestId('wb-tool-draw'));
      stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    };
    const open = () => {
      fireEvent.click(screen.getByTestId('wb-more'));
      return screen.getByTestId('wb-more');
    };
    const items = () => [...screen.getByTestId('wb-more-menu').querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];

    it('Escape closes and puts focus back on the trigger', () => {
      drawn();
      const trigger = open();
      items()[0]!.focus();
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(screen.queryByTestId('wb-more-menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('a press outside closes it; a press inside does not', () => {
      drawn();
      open();
      fireEvent.mouseDown(screen.getByTestId('wb-more-menu'));
      expect(screen.queryByTestId('wb-more-menu')).not.toBeNull();
      fireEvent.pointerDown(screen.getByTestId('wb-canvas'));
      expect(screen.queryByTestId('wb-more-menu')).toBeNull();
    });

    it('Arrow Down and Up, Home and End move focus among the items, wrapping', () => {
      drawn();
      const trigger = open();
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      const list = items();
      expect(list.length).toBeGreaterThan(2);
      expect(document.activeElement).toBe(list[0]);
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(list[1]);
      fireEvent.keyDown(document.activeElement!, { key: 'End' });
      expect(document.activeElement).toBe(list[list.length - 1]);
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(list[0]);
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(list[list.length - 1]);
      fireEvent.keyDown(document.activeElement!, { key: 'Home' });
      expect(document.activeElement).toBe(list[0]);
    });

    it('opens from the closed trigger with Arrow Down, focusing the first item', () => {
      drawn();
      const trigger = screen.getByTestId('wb-more');
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(items()[0]);
    });

    it('running an item returns focus to the trigger', () => {
      drawn();
      const trigger = open();
      fireEvent.click(screen.getByTestId('wb-more-undo'));
      expect(screen.queryByTestId('wb-more-menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('the Shapes menu behaves the same: Escape, outside press, arrows, and focus back after a pick', () => {
      render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
      const trigger = screen.getByTestId('wb-shapes-trigger');
      fireEvent.click(trigger);
      const list = [...screen.getByTestId('wb-shapes-menu').querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
      list[0]!.focus();
      fireEvent.keyDown(list[0]!, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(list[1]);
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      expect(screen.queryByTestId('wb-shapes-menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      fireEvent.click(trigger);
      fireEvent.pointerDown(screen.getByTestId('wb-canvas'));
      expect(screen.queryByTestId('wb-shapes-menu')).toBeNull();
      fireEvent.click(trigger);
      fireEvent.click(screen.getByTestId('wb-tool-ellipse'));
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('centres each glyph in its button by flex, with the svg a block', () => {
    expect(rule('.wb-tool')).toMatch(/display:\s*inline-flex/);
    expect(rule('.wb-tool')).toMatch(/align-items:\s*center/);
    expect(rule('.wb-tool')).toMatch(/justify-content:\s*center/);
    expect(rule('.wb-tool .i')).toMatch(/display:\s*block/);
    expect(rule('.wb-ic')).toMatch(/display:\s*block/);
  });

  it('never scales a pill glyph off its pixel grid: no stylesheet gives .wb-ic a size or a transform', () => {
    for (const block of css.match(/[^{}]*\.wb-ic[^{}]*\{[^}]*\}/g) ?? []) {
      expect(block, block).not.toMatch(/\b(width|height|transform|scale|zoom):/);
    }
    expect(rule('.wb-tool .wb-caret')).not.toMatch(/\b(width|height):/);
    /* The icons this pill drew before, from the book's 24 grid, are gone from it. */
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    expect(screen.getByTestId('wb-tools').querySelectorAll('svg.i')).toHaveLength(0);
  });

  it('keeps the menu triggers centred too: their caret is a corner badge, not a second flex item', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    for (const id of ['wb-shapes-trigger', 'wb-annotate-trigger']) {
      const trigger = screen.getByTestId(id);
      const caret = trigger.querySelector('.wb-caret');
      expect(caret).not.toBeNull();
      expect(trigger.querySelectorAll('svg:not(.wb-caret)')).toHaveLength(1);
    }
    expect(rule('.wb-tool .wb-caret')).toMatch(/position:\s*absolute/);
  });
});

describe('THE BOARD EDGE (the browser run measures it; this locks the CSS that makes it true)', () => {
  const css = readFileSync(path.resolve(__dirname, 'whiteboard.css'), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
  };

  it("clips to the pane's rounded rect, so nothing spills past an edge", () => {
    expect(rule('.wb-scope.wb')).toMatch(/overflow:\s*hidden/);
    expect(rule('.wb-scope.wb')).toMatch(/border-radius:/);
  });

  it('draws the SAME field as the architecture board: board ground, strong-hairline dots every --sp-20, moving with the camera', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    expect(document.querySelector('pattern')).toBeNull();
    const field = rule('.wb-canvas');
    const arch = readFileSync(path.resolve(__dirname, '../canvas/board.css'), 'utf8');
    const archField = arch.slice(arch.indexOf('--board-field-ink: var(--edge-strong)'), arch.indexOf('/* C4.1'));
    for (const piece of [
      '--board-field-ink: var(--edge-strong)',
      '--board-field-pitch: var(--sp-20)',
      'background-color: var(--board-ground)',
      'radial-gradient(',
      'var(--board-field-fade, 1) * 100%',
      'var(--board-field-dot)',
      'var(--board-cam-z, 1) * var(--board-field-step, 1)',
      'background-position: calc(var(--board-cam-x, 0px)) calc(var(--board-cam-y, 0px))',
    ]) {
      expect(archField, `architecture: ${piece}`).toContain(piece);
      expect(field, `whiteboard: ${piece}`).toContain(piece);
    }
  });

  it('the dots travel with the camera: the canvas writes the same custom properties Board.tsx does', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    const canvas = screen.getByTestId('wb-canvas');
    expect(canvas.style.getPropertyValue('--board-cam-x')).toBe('0px');
    expect(canvas.style.getPropertyValue('--board-cam-z')).toBe('1');
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 0, clientY: 0 });
    expect(Number(canvas.style.getPropertyValue('--board-cam-z'))).toBeGreaterThan(1);
  });
});

describe('CHAT-DRAWN DIAGRAMS DRAW THEMSELVES IN, LIVE ONLY', () => {
  const css = readFileSync(path.resolve(__dirname, 'whiteboard.css'), 'utf8');
  const box = (id: string, x: number): WbItem => ({
    kind: 'shape',
    id: `${id}:box`,
    shape: 'rect',
    from: { x, y: 0 },
    to: { x: x + 156, y: 44 },
    by: 'agent',
  });
  const arrow = (id: string, x: number): WbItem => ({
    kind: 'shape',
    id,
    shape: 'arrow',
    from: { x, y: 22 },
    to: { x: x + 40, y: 22 },
    by: 'agent',
  });
  const batch1 = [box('a', 0), box('b', 200), arrow('e1', 156)];
  const batch2 = [box('c', 400), arrow('e2', 356)];
  /** One <g> per mark: an arrow is a line plus a head, both tagged wb-item. */
  const marks = () => [...new Set(screen.getAllByTestId('wb-item').map((el) => el.closest('g')!.parentElement!))];
  const classes = () => marks().map((g) => g.getAttribute('class') ?? '');

  it('animates marks that arrive while the turn is live, staggered in flow order', () => {
    const store = memoryStore();
    const view = render(<Whiteboard repoRoot="r" storage={store} agentItems={[]} live />);
    view.rerender(<Whiteboard repoRoot="r" storage={store} agentItems={batch1} live />);
    const groups = marks();
    expect(groups).toHaveLength(3);
    expect(groups[0]!.getAttribute('class')).toMatch(/wb-arrive-box/);
    expect(groups[1]!.getAttribute('class')).toMatch(/wb-arrive-box/);
    expect(groups[2]!.getAttribute('class')).toMatch(/wb-arrive-line/);
    const delay = (g: Element) => Number((g as HTMLElement).style.getPropertyValue('--wb-delay').replace('ms', ''));
    expect(delay(groups[0]!)).toBeLessThan(delay(groups[1]!));
    /* The connector is staggered into the same span, not dropped at zero. */
    expect(delay(groups[2]!)).toBeGreaterThan(delay(groups[0]!));
    /* The connector is drawn by dash offset: its length is normalised to 1. */
    expect(groups[2]!.querySelector('line')!.getAttribute('pathLength')).toBe('1');
    expect(groups[2]!.querySelector('path')!.getAttribute('class')).toMatch(/wb-arrive-head/);
  });

  it('frames the first live drawing on an empty board, and leaves the camera alone for a replay', () => {
    const box2 = (id: string, x: number, y: number): WbItem => ({
      kind: 'shape',
      id: `${id}:box`,
      shape: 'rect',
      from: { x, y },
      to: { x: x + 156, y: y + 44 },
      by: 'agent',
    });
    const sized = vi
      .spyOn(SVGElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 800, height: 600, x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, toJSON: () => ({}) });
    try {
      const store = memoryStore();
      const view = render(<Whiteboard repoRoot="r" storage={store} agentItems={[]} live />);
      expect(screen.getByTestId('wb-viewport').getAttribute('transform')).toBe('translate(0,0) scale(1)');
      view.rerender(<Whiteboard repoRoot="r" storage={store} agentItems={[box2('a', 0, 0), box2('b', 0, 300)]} live />);
      expect(screen.getByTestId('wb-viewport').getAttribute('transform')).not.toBe('translate(0,0) scale(1)');
      view.unmount();
      render(<Whiteboard repoRoot="r" storage={memoryStore()} agentItems={[box2('a', 0, 0)]} live={false} />);
      expect(screen.getByTestId('wb-viewport').getAttribute('transform')).toBe('translate(0,0) scale(1)');
    } finally {
      sized.mockRestore();
    }
  });

  it('animates on a wrapper INSIDE the drag translate: a box grabbed mid-arrival moves with the pointer', () => {
    const store = memoryStore();
    const view = render(<Whiteboard repoRoot="r" storage={store} agentItems={[]} live />);
    view.rerender(<Whiteboard repoRoot="r" storage={store} agentItems={[box('a', 0)]} live />);
    const rectEl = screen.getByTestId('wb-item');
    const arriving = rectEl.closest('.wb-arrive')!;
    expect(arriving.getAttribute('class')).toMatch(/wb-arrive-box/);
    const canvas = screen.getByTestId('wb-canvas');
    const fire = (el: Element, type: string, x: number, y: number) =>
      fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
    fire(rectEl, 'pointerdown', 10, 10);
    fire(canvas, 'pointermove', 40, 30);
    /* The element that takes the drag is an ancestor of the animated one, and the animated one carries no transform attribute. */
    const dragged = arriving.parentElement!;
    expect(dragged.getAttribute('transform')).toBe('translate(30,20)');
    expect(arriving.hasAttribute('transform')).toBe(false);
    expect(dragged.getAttribute('class')).toBeNull();
  });

  it("the pulse starts and ends at the mark's own stroke: no hard-coded colour or end frames in its keyframes", () => {
    const at = css.indexOf('@keyframes wb-pulse');
    const frames = css.slice(at, css.indexOf('.wb-arrive-box {', at));
    expect(frames).not.toMatch(/\b0%/);
    expect(frames).not.toMatch(/\b100%/);
    expect(frames).not.toMatch(/var\(--ink-2\)/);
  });

  it('pulses only the newest batch', () => {
    const store = memoryStore();
    const view = render(<Whiteboard repoRoot="r" storage={store} agentItems={[]} live />);
    view.rerender(<Whiteboard repoRoot="r" storage={store} agentItems={batch1} live />);
    expect(classes().filter((c) => /wb-pulse/.test(c))).toHaveLength(2);
    view.rerender(<Whiteboard repoRoot="r" storage={store} agentItems={[...batch1, ...batch2]} live />);
    const pulsing = screen
      .getAllByTestId('wb-item')
      .filter((el) => /wb-pulse/.test(el.closest('g')?.parentElement?.getAttribute('class') ?? ''))
      .map((el) => el.getAttribute('x'));
    expect(pulsing).toEqual(['400']);
  });

  it('does not animate marks that are already on the board when it opens (a reload or a replay)', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} agentItems={batch1} live />);
    expect(classes().join(' ')).not.toMatch(/wb-arrive|wb-pulse/);
  });

  it('does not animate a chat switch or hydrate, which arrives when no turn is running', () => {
    const store = memoryStore();
    const view = render(<Whiteboard repoRoot="r" storage={store} agentItems={[]} live={false} />);
    view.rerender(<Whiteboard repoRoot="r" storage={store} agentItems={batch1} live={false} />);
    expect(marks()).toHaveLength(3);
    expect(classes().join(' ')).not.toMatch(/wb-arrive|wb-pulse/);
  });

  it('does not re-animate on a remount: the board already holds the marks', () => {
    const store = memoryStore();
    const view = render(<Whiteboard repoRoot="r" storage={store} agentItems={[]} live />);
    view.rerender(<Whiteboard repoRoot="r" storage={store} agentItems={batch1} live />);
    view.unmount();
    render(<Whiteboard repoRoot="r" storage={store} agentItems={batch1} live />);
    expect(classes().join(' ')).not.toMatch(/wb-arrive|wb-pulse/);
  });

  it('ships the motion only under prefers-reduced-motion: no-preference', () => {
    const at = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(at).toBeGreaterThan(-1);
    const motion = css.slice(at);
    for (const name of ['wb-pop', 'wb-draw', 'wb-pulse']) expect(motion).toMatch(new RegExp(`@keyframes ${name}`));
    expect(motion).toMatch(/stroke-dashoffset/);
    /* Outside that media block there is no animation at all on these classes. */
    expect(css.slice(0, at)).not.toMatch(/animation:/);
  });
});
