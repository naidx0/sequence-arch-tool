import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/**
 * A TINY MAP YOU CAN EDIT (owner, second tour: "let them move with this map
 * and kind of create it on their own"). The research loop from the whiteboard
 * recording, as boxes a visitor can drag, rename, add to and connect. Nothing
 * leaves the page: no network, no storage.
 *
 * - Boxes sit at fractions of the canvas and are placed by transform (container
 *   query units), so moving one never shifts the layout. The canvas has a fixed
 *   aspect ratio before anything renders.
 * - Edges are drawn in an SVG under the boxes from measured sizes, each ending
 *   on the target's border. Drawn edges are dashed: a sketch is a claim.
 * - Keyboard: every box is a button. Arrows move it (Shift for bigger steps),
 *   Enter or F2 renames, Delete removes; in connect mode Enter picks it.
 * - Reduced motion: no fades.
 */
type Box = { id: number; name: string; fx: number; fy: number };
type Edge = { a: number; b: number };

const SEED_BOXES: Box[] = [
  { id: 1, name: 'Question', fx: 0.16, fy: 0.22 },
  { id: 2, name: 'Read papers', fx: 0.5, fy: 0.22 },
  { id: 3, name: 'Hypothesis', fx: 0.84, fy: 0.22 },
  { id: 4, name: 'Experiment', fx: 0.84, fy: 0.74 },
  { id: 5, name: 'Results', fx: 0.5, fy: 0.74 },
  { id: 6, name: 'Write-up', fx: 0.16, fy: 0.74 },
];
/* Phones: the same loop in two columns, so every box has room. */
const SEED_PHONE: Box[] = [
  { id: 1, name: 'Question', fx: 0.27, fy: 0.12 },
  { id: 2, name: 'Read papers', fx: 0.73, fy: 0.12 },
  { id: 3, name: 'Hypothesis', fx: 0.73, fy: 0.4 },
  { id: 4, name: 'Experiment', fx: 0.73, fy: 0.68 },
  { id: 5, name: 'Results', fx: 0.27, fy: 0.68 },
  { id: 6, name: 'Write-up', fx: 0.27, fy: 0.9 },
];
const seed = () => (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches ? SEED_PHONE : SEED_BOXES);
const SEED_EDGES: Edge[] = [
  { a: 1, b: 2 },
  { a: 2, b: 3 },
  { a: 3, b: 4 },
  { a: 4, b: 5 },
  { a: 5, b: 3 },
  { a: 5, b: 6 },
];
const MAX_BOXES = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Size = { w: number; h: number; bw: number; bh: number };

/** Where the segment from a's centre to b's centre leaves b's box. */
function border(ax: number, ay: number, bx: number, by: number, hw: number, hh: number): [number, number] {
  const dx = ax - bx;
  const dy = ay - by;
  if (dx === 0 && dy === 0) return [bx, by];
  const s = Math.min(Math.abs(dx) > 0 ? hw / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? hh / Math.abs(dy) : Infinity);
  return [bx + dx * s, by + dy * s];
}

export function MiniMap() {
  const [boxes, setBoxes] = useState<Box[]>(seed);
  const [edges, setEdges] = useState<Edge[]>(SEED_EDGES);
  const [connect, setConnect] = useState<null | { from: number | null }>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [say, setSay] = useState('');
  const [size, setSize] = useState<Size | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<number, HTMLButtonElement>());
  const drag = useRef<null | { id: number; dx: number; dy: number; moved: boolean }>(null);
  const nextId = useRef(SEED_BOXES.length + 1);
  const focusAfter = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return undefined;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const any = nodeRefs.current.values().next().value as HTMLButtonElement | undefined;
      setSize({ w: r.width, h: r.height, bw: any?.offsetWidth ?? 132, bh: any?.offsetHeight ?? 44 });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (focusAfter.current !== null) {
      nodeRefs.current.get(focusAfter.current)?.focus();
      focusAfter.current = null;
    }
  });

  /* Keep a box's centre far enough in that the whole box stays on the canvas. */
  const limits = () => {
    const s = size;
    if (!s || s.w === 0) return { x0: 0.1, x1: 0.9, y0: 0.1, y1: 0.9 };
    return { x0: s.bw / 2 / s.w + 0.01, x1: 1 - s.bw / 2 / s.w - 0.01, y0: s.bh / 2 / s.h + 0.02, y1: 1 - s.bh / 2 / s.h - 0.02 };
  };
  const move = (id: number, fx: number, fy: number) => {
    const l = limits();
    setBoxes((bs) => bs.map((b) => (b.id === id ? { ...b, fx: clamp(fx, l.x0, l.x1), fy: clamp(fy, l.y0, l.y1) } : b)));
  };
  const nameOf = (id: number) => boxes.find((b) => b.id === id)?.name ?? 'box';

  const pickForConnect = (id: number) => {
    if (!connect) return;
    if (connect.from === null) {
      setConnect({ from: id });
      setSay(`From ${nameOf(id)}. Now pick the box to connect it to.`);
      return;
    }
    if (connect.from === id) {
      setConnect({ from: null });
      setSay('Pick the first box.');
      return;
    }
    const a = connect.from;
    setEdges((es) => (es.some((e) => e.a === a && e.b === id) ? es : [...es, { a, b: id }]));
    setConnect(null);
    setSay(`Connected ${nameOf(a)} to ${nameOf(id)}.`);
  };

  const startRename = (id: number) => {
    setEditing(id);
    setDraft(nameOf(id));
  };
  const commitRename = (keep: boolean) => {
    if (editing === null) return;
    const id = editing;
    const name = draft.trim().slice(0, 24);
    if (keep && name) setBoxes((bs) => bs.map((b) => (b.id === id ? { ...b, name } : b)));
    setEditing(null);
    focusAfter.current = id;
  };

  const remove = (id: number) => {
    const name = nameOf(id);
    setBoxes((bs) => bs.filter((b) => b.id !== id));
    setEdges((es) => es.filter((e) => e.a !== id && e.b !== id));
    setSay(`Removed ${name}.`);
  };

  const add = () => {
    if (boxes.length >= MAX_BOXES) {
      setSay(`That is ${MAX_BOXES} boxes, the most this little map holds.`);
      return;
    }
    const id = nextId.current++;
    /* The first free spot on a loose grid in the middle band. */
    const spots = [
      [0.5, 0.48],
      [0.33, 0.48],
      [0.67, 0.48],
      [0.16, 0.48],
      [0.84, 0.48],
    ];
    const free = spots.find(([x, y]) => !boxes.some((b) => Math.abs(b.fx - x!) < 0.12 && Math.abs(b.fy - y!) < 0.12)) ?? [0.5, 0.48];
    setBoxes((bs) => [...bs, { id, name: `Box ${id - SEED_BOXES.length}`, fx: free[0]!, fy: free[1]! }]);
    setEditing(id);
    setDraft(`Box ${id - SEED_BOXES.length}`);
    setSay('Added a box. Type its name, then press Enter.');
  };

  const reset = () => {
    setBoxes(seed());
    setEdges(SEED_EDGES);
    setConnect(null);
    setEditing(null);
    nextId.current = SEED_BOXES.length + 1;
    setSay('Back to the research loop.');
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, b: Box) => {
    if (editing === b.id || e.button !== 0) return;
    const r = canvas.current?.getBoundingClientRect();
    if (!r) return;
    drag.current = { id: b.id, dx: (e.clientX - r.left) / r.width - b.fx, dy: (e.clientY - r.top) / r.height - b.fy, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const r = canvas.current?.getBoundingClientRect();
    if (!d || !r) return;
    d.moved = true;
    move(d.id, (e.clientX - r.left) / r.width - d.dx, (e.clientY - r.top) / r.height - d.dy);
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (drag.current && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onClick = (b: Box) => {
    const moved = drag.current?.moved;
    drag.current = null;
    if (moved) return;
    if (connect) pickForConnect(b.id);
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, b: Box) => {
    const step = e.shiftKey ? 0.08 : 0.025;
    const k = e.key;
    if (k === 'ArrowLeft') move(b.id, b.fx - step, b.fy);
    else if (k === 'ArrowRight') move(b.id, b.fx + step, b.fy);
    else if (k === 'ArrowUp') move(b.id, b.fx, b.fy - step * 1.6);
    else if (k === 'ArrowDown') move(b.id, b.fx, b.fy + step * 1.6);
    else if (k === 'Delete' || k === 'Backspace') remove(b.id);
    else if (k === 'F2' || (k === 'Enter' && !connect)) startRename(b.id);
    else if (k === 'Enter' && connect) pickForConnect(b.id);
    else if (k === 'Escape' && connect) {
      setConnect(null);
      setSay('Stopped connecting.');
    } else return;
    e.preventDefault();
  };

  /* Where a box is drawn: its place, kept inside the canvas whatever its size. */
  const at = (b: Box) => {
    const l = limits();
    return { fx: clamp(b.fx, l.x0, l.x1), fy: clamp(b.fy, l.y0, l.y1) };
  };
  const pos = (b: Box) => {
    if (!size) return null;
    const q = at(b);
    return { x: q.fx * size.w, y: q.fy * size.h };
  };

  return (
    <div className="lt-mini">
      <div className="lt-mini-bar" role="toolbar" aria-label="Edit the map">
        <button type="button" className="lt-mini-btn" onClick={add}>
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Add a box
        </button>
        <button
          type="button"
          className={`lt-mini-btn lt-mini-connect ${connect ? 'is-on' : ''}`}
          aria-pressed={connect !== null}
          onClick={() => {
            if (connect) {
              setConnect(null);
              setSay('Stopped connecting.');
            } else {
              setConnect({ from: null });
              setSay('Pick the first box.');
            }
          }}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path d="M3 12 13 4M9 4h4v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {connect ? (connect.from === null ? 'Pick a box' : 'Pick the second') : 'Connect two'}
        </button>
        <button type="button" className="lt-mini-btn is-quiet" onClick={reset}>
          Reset
        </button>
        <p className="lt-mini-say" aria-live="polite">
          {say}
        </p>
      </div>

      <div ref={canvas} className={`lt-mini-canvas ${connect ? 'is-connecting' : ''}`} role="group" aria-label="A small map you can edit" aria-describedby="lt-mini-hint">
        <svg className="lt-mini-edges" aria-hidden="true">
          <defs>
            <marker id="lt-mini-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1 1 9 5 1 9" fill="none" stroke="rgb(91, 155, 255)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {size
            ? edges.map((e) => {
                const A = boxes.find((b) => b.id === e.a);
                const B = boxes.find((b) => b.id === e.b);
                if (!A || !B) return null;
                const a = pos(A)!;
                const b = pos(B)!;
                const [x2, y2] = border(a.x, a.y, b.x, b.y, size.bw / 2 + 3, size.bh / 2 + 3);
                const [x1, y1] = border(b.x, b.y, a.x, a.y, size.bw / 2, size.bh / 2);
                return <line key={`${e.a}-${e.b}`} x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#lt-mini-head)" />;
              })
            : null}
        </svg>
        {boxes.map((b) => {
          const from = connect?.from === b.id;
          return editing === b.id ? (
            <div key={b.id} className="lt-mini-box is-editing" style={{ ['--fx' as string]: at(b).fx, ['--fy' as string]: at(b).fy }}>
              <input
                autoFocus
                aria-label="Name of the box"
                value={draft}
                maxLength={24}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitRename(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(true);
                  else if (e.key === 'Escape') commitRename(false);
                }}
              />
            </div>
          ) : (
            <button
              key={b.id}
              ref={(el) => {
                if (el) nodeRefs.current.set(b.id, el);
                else nodeRefs.current.delete(b.id);
              }}
              type="button"
              className={`lt-mini-box ${from ? 'is-from' : ''}`}
              style={{ ['--fx' as string]: at(b).fx, ['--fy' as string]: at(b).fy }}
              aria-label={`${b.name}. Arrow keys move it, Enter renames, Delete removes.${connect ? ' Enter picks it to connect.' : ''}`}
              onPointerDown={(e) => onPointerDown(e, b)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onClick={() => onClick(b)}
              onDoubleClick={() => startRename(b.id)}
              onKeyDown={(e) => onKey(e, b)}
            >
              <i aria-hidden="true" />
              <span>{b.name}</span>
            </button>
          );
        })}
      </div>
      <p id="lt-mini-hint" className="lt-mini-hint">
        Drag a box, double-click to rename, or add your own and connect two. It stays on this page.
      </p>
    </div>
  );
}
