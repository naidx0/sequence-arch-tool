import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { recognizeStroke } from '@sequence/ink';

import { GLYPHS } from '../chat/Icon';
import { Whiteboard } from './Whiteboard';
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
    expect((screen.getByTestId('wb-clear') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('it survives a reload, per repository', () => {
  it('a drawing comes back', () => {
    const store = memoryStore();
    const first = render(<Whiteboard repoRoot="C:/repos/shop" storage={store} />);
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
    stroke(screen.getByTestId('wb-canvas'), SQUIGGLE);
    expect(screen.getAllByTestId('wb-item')).toHaveLength(1);
  });
});

describe('it says what it is', () => {
  it('an empty board says nothing here is read from your code', () => {
    /*
     * The sentence that keeps the two surfaces apart in the reader's head. An
     * empty whiteboard and an empty architecture board are the same pixels
     * otherwise, and the architecture board's emptiness means something
     * completely different — that the scan found nothing.
     */
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
    const note = screen.getByTestId('wb-empty');
    expect(note.textContent).toMatch(/nothing here is read from your code/i);
  });

  it('the note goes away once something is drawn', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot="r" storage={store} />);
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
   * DRAW STAYS THE DEFAULT TOOL. MIRO opens on select. This opens on draw,
   * because the walk's complaint was "Draw. It doesn't seem to work" and a
   * whiteboard is opened to draw on. Select is first in the row, where a
   * reader looks for it.
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

  it('offers a select tool, and draw is still what the board opens on', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    expect(screen.getByTestId('wb-tool-select')).toBeTruthy();
    expect(screen.getByTestId('wb-tool-draw').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('wb-tool-select').getAttribute('aria-pressed')).toBe('false');
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
    fireEvent.click(screen.getByTestId('wb-tool-pan'));
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
    fireEvent.click(screen.getByTestId('wb-tool-pan'));
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
    expect((screen.getByTestId('wb-reset-view') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 0, clientY: 0 });
    expect((screen.getByTestId('wb-reset-view') as HTMLButtonElement).disabled).toBe(false);
  });

  it('reset takes it home', () => {
    const canvas = board();
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 0, clientY: 0 });
    fireEvent.click(screen.getByTestId('wb-reset-view'));
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

  it('with no repository attached it says THAT, rather than showing an empty list', () => {
    const store = memoryStore();
    render(<Whiteboard repoRoot={null} storage={store} graph={null} />);
    const canvas = screen.getByTestId('wb-canvas');
    pickAnnotate('link');
    fireEvent(canvas, new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    expect(screen.getByTestId('wb-picker-none').textContent).toMatch(/No repository/i);
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
    ['pan', 'Pan'],
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
    for (const [tool, word] of PRIMARY) {
      const btn = screen.getByTestId(`wb-tool-${tool}`);
      expect(btn.getAttribute('aria-label'), `${tool} keeps its aria-label`).toBe(word);
      expect(btn.getAttribute('title'), `${tool} keeps its tooltip`).toBe(word);
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

  it('draws the four AUTHORED glyphs, not borrowed kinds', () => {
    render(<Whiteboard repoRoot={null} storage={memoryStore()} />);
    const pathsOf = (btn: HTMLElement) =>
      [...btn.querySelectorAll('svg path')].map((p) => p.getAttribute('d'));

    fireEvent.click(screen.getByTestId('wb-shapes-trigger'));
    expect(screen.getByTestId('wb-tool-ellipse').querySelector('svg ellipse')).toBeTruthy();
    expect(screen.getByTestId('wb-tool-rect').querySelectorAll('svg rect').length).toBe(1);

    fireEvent.click(screen.getByTestId('wb-annotate-trigger'));
    expect(pathsOf(screen.getByTestId('wb-tool-text'))).toEqual(
      GLYPHS.text.map((s) => ('p' in s ? s.p : '')).filter(Boolean),
    );
    expect(pathsOf(screen.getByTestId('wb-tool-link'))).toEqual(
      GLYPHS.link.map((s) => ('p' in s ? s.p : '')).filter(Boolean),
    );
    expect(pathsOf(screen.getByTestId('wb-tool-erase'))).toEqual(
      GLYPHS.erase.map((s) => ('p' in s ? s.p : '')).filter(Boolean),
    );
    expect(pathsOf(screen.getByTestId('wb-tool-pan'))).toEqual(
      GLYPHS.pan.map((s) => ('p' in s ? s.p : '')).filter(Boolean),
    );
    expect(screen.getByTestId('wb-tool-select').querySelector('svg ellipse')).toBeNull();
  });

  it('paints whiteboard icons with stroke under .wb-scope (seat blank-button lock)', () => {
    render(<Whiteboard repoRoot={null} storage={memoryStore()} />);
    const svg = screen.getByTestId('wb-tool-pan').querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.classList.contains('i')).toBe(true);
  });
});
