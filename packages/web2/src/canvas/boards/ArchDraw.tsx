/* ══════════════════════════════════════════════════════════════════════════
   DRAWING ON THE ARCHITECTURE BOARD — the marks, the capture, the palette
   packages/web2/src/canvas/boards/ArchDraw.tsx

   Jaden, round 8: "the architecture board should be sort of a canvas, I
   guess, to draw on." Draw mode had one gesture (Sketch: a box becomes a node,
   a line an edge — a structural edit, `inkToEdit`). This adds the annotation
   layer on top of the graph: pen, rectangle, ellipse, arrow, text and sticky
   notes, kept in the architecture board's store (`/api/boards/architecture`),
   where the agent's `draw` tool writes too.

   WHAT KEEPS A MARK FROM PASSING FOR A FINDING: marks are drawn in their own
   layer, in sketch ink and sticky tint, never as cards; they carry no
   evidence; and the agent's marks are tinted so you can tell whose they are.

   ANCHORED MARKS FOLLOW THEIR NODE. A mark started on a card is stored as an
   offset from that card (`anchor`), so moving the card, relaying the board or
   a rescan that keeps the id leaves the note beside it. A bound arrow's ends
   are recomputed from its targets every frame (boardsModel.resolveItems).

   Loaded after the board's first layout or on the first press of Draw: none
   of this is boot JS.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { STICKY_H, STICKY_W, type Point, type WbItem, type WbShape } from '../../whiteboard/whiteboardModel';
import { resolveItems, shiftItem, type Box } from './boardsModel';
import { linesFromPaths, ownerShape, placeTextMark, textMarkBox } from './textPlace';
import { TOOL_GLYPH_PATHS, TOOL_GLYPH_SHAPES } from './archToolGlyphs';
import './archDraw.css';

export type ArchTool = 'sketch' | 'select' | 'pen' | 'rect' | 'ellipse' | 'arrow' | 'text' | 'sticky' | 'erase';

export const ARCH_TOOLS: { id: ArchTool; label: string; hint: string }[] = [
  { id: 'sketch', label: 'Sketch', hint: 'Draw a box to add a service. Draw a line between two boxes to connect them.' },
  { id: 'select', label: 'Select', hint: 'Select: drag a mark to move it, Delete removes it' },
  { id: 'pen', label: 'Pen', hint: 'Pen: freehand ink' },
  { id: 'rect', label: 'Rectangle', hint: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse', hint: 'Ellipse' },
  { id: 'arrow', label: 'Arrow', hint: 'Arrow: start and end on a card or a mark and it stays attached' },
  { id: 'text', label: 'Text', hint: 'Text: click to type' },
  { id: 'sticky', label: 'Sticky note', hint: 'Sticky note: click to place, then type' },
  { id: 'erase', label: 'Erase', hint: 'Erase: click a mark to remove it' },
];

/* ── the marks, in flow space ─────────────────────────────────────────── */

function arrowHead(from: Point, to: Point, size = 11): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = to.x - ux * size;
  const by = to.y - uy * size;
  const h = size * 0.45;
  return `M${bx - uy * h},${by + ux * h} L${to.x},${to.y} L${bx + uy * h},${by - ux * h}`;
}

function path(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

function ShapeMark({ item }: { item: WbShape }) {
  const x = Math.min(item.from.x, item.to.x);
  const y = Math.min(item.from.y, item.to.y);
  const w = Math.abs(item.to.x - item.from.x);
  const h = Math.abs(item.to.y - item.from.y);
  const common = { 'data-annot-id': item.id, 'data-kind': item.shape, 'data-by': item.by ?? 'person', className: 'annot-ink' };
  if (item.shape === 'rect' || item.shape === 'ellipse' || item.shape === 'diamond') {
    return (
      <g {...common} data-testid="annot-mark">
        {item.shape === 'rect' ? (
          <rect x={x} y={y} width={w} height={h} rx={10} />
        ) : item.shape === 'diamond' ? (
          <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} />
        ) : (
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
        )}
        {item.label ? (
          <text className="annot-label" x={x + w / 2} y={y + h / 2} textAnchor="middle" dominantBaseline="central">
            {item.label}
          </text>
        ) : null}
      </g>
    );
  }
  const mid = { x: (item.from.x + item.to.x) / 2, y: (item.from.y + item.to.y) / 2 };
  return (
    <g {...common} data-testid="annot-mark" data-bound={item.fromId || item.toId ? 'true' : undefined}>
      <line className="annot-hit" x1={item.from.x} y1={item.from.y} x2={item.to.x} y2={item.to.y} />
      <line x1={item.from.x} y1={item.from.y} x2={item.to.x} y2={item.to.y} />
      {item.shape === 'arrow' ? <path d={arrowHead(item.from, item.to)} /> : null}
      {item.label ? (
        <text className="annot-label annot-label-line" x={mid.x} y={mid.y - 8} textAnchor="middle">
          {item.label}
        </text>
      ) : null}
    </g>
  );
}

export interface ArchMarksProps {
  items: readonly WbItem[];
  boxOf: (id: string) => Box | null | undefined;
  /** Erase / text tools: marks answer a hit test. */
  hittable?: boolean;
  /** The connectors' paths and the cards: a text mark is drawn clear of both. */
  paths?: readonly string[];
  cards?: readonly Box[];
}

export function ArchMarks({ items, boxOf, hittable = false, paths, cards }: ArchMarksProps) {
  const { items: shown, hidden } = resolveItems(items, boxOf);
  const lines = useMemo(() => linesFromPaths(paths ?? []), [paths]);
  const svgMarks = shown.filter((i) => i.kind === 'shape' || i.kind === 'stroke');
  const htmlMarks = shown.filter((i) => i.kind === 'text' || i.kind === 'noderef');
  return (
    <div
      className="annot-layer"
      data-testid="annot-layer"
      data-count={shown.length}
      data-hidden={hidden}
      data-hittable={hittable ? 'true' : 'false'}
    >
      <svg className="annot-svg" width={1} height={1} aria-hidden="true">
        {svgMarks.map((it) =>
          it.kind === 'stroke' ? (
            <g key={it.id} className="annot-ink" data-annot-id={it.id} data-kind="stroke" data-by={it.by ?? 'person'} data-testid="annot-mark">
              <path className="annot-hit" d={path(it.points)} />
              <path d={path(it.points)} style={{ strokeWidth: it.width }} />
            </g>
          ) : it.kind === 'shape' ? (
            <ShapeMark key={it.id} item={it} />
          ) : null,
        )}
      </svg>
      {htmlMarks.map((it) => {
        if (it.kind === 'text' && it.sticky) {
          return (
            <div
              key={it.id}
              className="annot-sticky"
              data-testid="annot-mark"
              data-kind="sticky"
              data-annot-id={it.id}
              data-by={it.by ?? 'person'}
              style={{ left: it.at.x, top: it.at.y, width: it.w ?? STICKY_W, minHeight: it.h ?? STICKY_H }}
            >
              {it.by === 'agent' ? <span className="annot-by">Agent</span> : null}
              <span className="annot-sticky-t">{it.text}</span>
            </div>
          );
        }
        const text = it.kind === 'text' ? it.text : it.kind === 'noderef' ? it.label : '';
        /* Off any connector and any card, at the nearest clear spot. */
        const tb = textMarkBox(it.at, text);
        const nudge = it.kind === 'text' ? placeTextMark(tb, lines, cards ?? [], ownerShape(tb, shown)) : { x: 0, y: 0, plate: false };
        return (
          <div
            key={it.id}
            className="annot-text"
            data-testid="annot-mark"
            data-kind={it.kind}
            data-annot-id={it.id}
            data-by={it.by ?? 'person'}
            data-nudged={nudge.x !== 0 || nudge.y !== 0 ? 'true' : undefined}
            data-plate={nudge.plate ? 'true' : undefined}
            style={{ left: it.at.x + nudge.x, top: it.at.y + nudge.y }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
}

/* ── the capture surface, in screen space ─────────────────────────────── */

export interface ArchCaptureProps {
  tool: Exclude<ArchTool, 'sketch'>;
  /** Space is held: let the pointer through to pan. */
  passive: boolean;
  toFlow: (client: Point) => Point;
  /** Every card on the board now, in flow space (for anchoring). */
  boxes: readonly (Box & { id: string; container?: boolean })[];
  /** The marks as stored (for editing a note in place). */
  items: readonly WbItem[];
  onPut: (item: WbItem) => void | Promise<unknown>;
  onRemove: (id: string) => void;
}

let seq = 0;
function freshId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}${seq.toString(36)}`;
}

/** The smallest card containing a flow point (a service before the group frame around it). */
export function nodeAt(boxes: ArchCaptureProps['boxes'], p: Point): (Box & { id: string }) | null {
  let best: (Box & { id: string }) | null = null;
  for (const b of boxes) {
    if (p.x < b.x || p.y < b.y || p.x > b.x + b.w || p.y > b.y + b.h) continue;
    if (!best || b.w * b.h < best.w * best.h) best = b;
  }
  return best;
}

/** Re-express an item's coordinates as offsets from a node's box. */
export function anchorTo<T extends WbItem>(item: T, node: (Box & { id: string }) | null): T {
  if (!node) return item;
  const mv = (p: Point): Point => ({ ...p, x: p.x - node.x, y: p.y - node.y });
  if (item.kind === 'stroke') return { ...item, anchor: node.id, points: item.points.map(mv) };
  if (item.kind === 'shape') return { ...item, anchor: node.id, from: mv(item.from), to: mv(item.to) };
  if ('at' in item) return { ...item, anchor: node.id, at: mv(item.at) } as T;
  return item;
}

/** Where a mark starts, for deciding which card it now belongs to. */
function refPoint(item: WbItem): Point {
  if (item.kind === 'stroke') return item.points[0] ?? { x: 0, y: 0 };
  if (item.kind === 'shape') return item.from;
  return (item as { at: Point }).at;
}

/**
 * A mark moved by (dx, dy) flow units (round 9, ask 26: drawings draggable).
 * The mark's stored coordinates are offsets from its anchor card, so it is
 * made absolute, shifted, and anchored again to whichever card is under its
 * new start; dropped on empty board it is free. A bound arrow is detached:
 * it moves from where it is drawn (`rendered`, its ends resolved against their
 * targets) and its ends become plain points, so it never jumps on release.
 */
export function moveMarkTo(item: WbItem, dx: number, dy: number, boxes: ArchCaptureProps['boxes'], rendered?: WbItem): WbItem {
  const fromRendered = !!rendered && item.kind === 'shape' && !!(item.fromId || item.toId);
  const home = item.anchor ? boxes.find((b) => b.id === item.anchor) : undefined;
  if (item.anchor && !home && !fromRendered) return shiftItem(item, dx, dy);
  const { anchor: _anchor, ...bare } = fromRendered ? rendered! : item;
  void _anchor;
  /* `rendered` is already absolute; a stored item is offset from its anchor card. */
  let abs = home && !fromRendered ? shiftItem(bare as WbItem, home.x, home.y) : (bare as WbItem);
  abs = shiftItem(abs, dx, dy);
  if (abs.kind === 'shape' && (abs.fromId || abs.toId)) {
    const { fromId: _f, toId: _t, ...unbound } = abs;
    void _f;
    void _t;
    abs = unbound as WbItem;
  }
  return anchorTo(abs, nodeAt(boxes, refPoint(abs)));
}

export function ArchCapture({ tool, passive, toFlow, boxes, items, onPut, onRemove }: ArchCaptureProps) {
  const ref = useRef<SVGSVGElement | null>(null);
  const client = useRef<Point[]>([]);
  const [draft, setDraft] = useState<Point[]>([]);
  const [editor, setEditor] = useState<{ local: Point; flow: Point; kind: 'text' | 'sticky'; id: string | null; text: string; anchorAt: (Box & { id: string }) | null; size?: { w?: number; h?: number }; at?: Point } | null>(null);

  const localOf = (e: { clientX: number; clientY: number }): Point => {
    const box = ref.current?.getBoundingClientRect();
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) };
  };

  /** What is under a screen point: a mark, a card, or nothing (the layer punches through). */
  const under = (p: Point): { mark: string | null; node: string | null } => {
    const el = ref.current;
    const prev = el?.style.pointerEvents;
    if (el) el.style.pointerEvents = 'none';
    try {
      const hit = document.elementFromPoint?.(p.x, p.y) ?? null;
      /* Only this board's own layer: another mounted board may hold a mark with the same id. */
      const scope = el?.closest('.board-scope') ?? el?.parentElement?.parentElement;
      if (!hit || !scope?.contains(hit)) return { mark: null, node: null };
      return {
        mark: hit.closest('[data-annot-id]')?.getAttribute('data-annot-id') ?? null,
        node: hit.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null,
      };
    } finally {
      if (el) el.style.pointerEvents = prev ?? '';
    }
  };

  /* The editor in a ref as well: a press elsewhere commits it AND its blur
     fires as it unmounts, and the second must find nothing left to commit
     (or one note would land twice). */
  const editorRef = useRef<typeof editor>(null);
  editorRef.current = editor;
  const commitEditor = () => {
    const editor = editorRef.current;
    if (!editor) return;
    editorRef.current = null;
    const text = editor.text.trim();
    setEditor(null);
    if (editor.id) {
      const prev = items.find((i) => i.id === editor.id);
      if (!prev) return;
      if (!text) return onRemove(editor.id);
      if (prev.kind === 'text' && prev.text !== text) onPut({ ...prev, text });
      return;
    }
    if (!text) return;
    const base: WbItem =
      editor.kind === 'sticky'
        ? { kind: 'text', sticky: true, id: freshId('note'), by: 'person', at: editor.flow, text, w: STICKY_W, h: STICKY_H }
        : { kind: 'text', id: freshId('text'), by: 'person', at: editor.flow, text };
    onPut(anchorTo(base, editor.anchorAt));
  };

  const hold = useMemo(() => new Set(['pen', 'rect', 'ellipse', 'arrow']), []);

  /* ── Select: pick a mark, drag it, Delete removes it (round 9, ask 26) ──
     The drag is shown by translating the mark's own element; the move is
     written ONCE on release (one undo step, one write), then the transform is
     let go when the write has landed and the stored position takes over. */
  const drag = useRef<{ id: string; start: Point; startFlow: Point; moved: boolean } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  /** A dropped mark whose translate is kept until its stored position lands (see the layout effect below). */
  const landing = useRef<{ id: string; prev: WbItem } | null>(null);
  const releaseLanding = () => {
    const l = landing.current;
    if (!l) return;
    landing.current = null;
    for (const el of markEls(l.id)) el.style.translate = '';
  };
  /* The stored position and the end of the preview translate must change in ONE commit: a rAF
     release could fire after the position rendered and before the translate went, which draws the
     mark moved twice for a frame. */
  useLayoutEffect(() => {
    const l = landing.current;
    if (l && items.find((i) => i.id === l.id) !== l.prev) releaseLanding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  const markEls = (id: string): HTMLElement[] =>
    [...document.querySelectorAll<HTMLElement>('[data-annot-id]')].filter((el) => el.getAttribute('data-annot-id') === id);
  const setSelectedMark = (id: string | null) => {
    document.querySelectorAll('[data-annot-selected]').forEach((el) => el.removeAttribute('data-annot-selected'));
    if (id) for (const el of markEls(id)) el.setAttribute('data-annot-selected', 'true');
    setPicked(id);
  };
  /** Let go of a drag that cannot be honoured: the preview is dropped, nothing is written, the mark is deselected. */
  const cancelDrag = () => {
    if (!drag.current) return;
    for (const el of markEls(drag.current.id)) el.style.translate = '';
    drag.current = null;
    setSelectedMark(null);
  };
  useEffect(() => {
    if (tool !== 'select') {
      document.querySelectorAll('[data-annot-selected]').forEach((el) => el.removeAttribute('data-annot-selected'));
      setPicked(null);
    }
    if (passive) cancelDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, passive]);
  useEffect(() => {
    const scope = ref.current?.closest('.board-stack') ?? ref.current?.closest('.board-scope');
    if (!scope) return undefined;
    /* A camera or pane change invalidates the screen delta that began the drag. */
    const observer = new MutationObserver((changes) => {
      if (changes.some((c) => (c.target as Element).matches('.board, .board-stack, .react-flow, .react-flow__viewport'))) cancelDrag();
    });
    observer.observe(scope, { attributes: true, subtree: true, attributeFilter: ['style', 'class', 'data-zoom', 'data-view'] });
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (tool !== 'select' || !picked) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
      e.preventDefault();
      onRemove(picked);
      setSelectedMark(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, picked]);

  return (
    <div className="annot-capture-wrap" data-testid="annot-capture-wrap">
      <svg
        ref={ref}
        className={passive ? 'strokelayer annot-capture is-passive' : 'strokelayer annot-capture'}
        data-testid="annot-capture"
        data-tool={tool}
        data-passive={passive ? 'true' : undefined}
        onPointerDown={(e) => {
          if (passive || e.button !== 0) return;
          if (editor) {
            commitEditor();
            return;
          }
          if (tool === 'select') {
            const { mark } = under({ x: e.clientX, y: e.clientY });
            setSelectedMark(mark);
            if (mark) {
              drag.current = { id: mark, start: { x: e.clientX, y: e.clientY }, startFlow: toFlow({ x: e.clientX, y: e.clientY }), moved: false };
              (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
            }
            return;
          }
          if (!hold.has(tool)) return;
          client.current = [{ x: e.clientX, y: e.clientY, t: e.timeStamp }];
          setDraft([localOf(e)]);
          (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (passive) return;
          const d = drag.current;
          if (d) {
            const now = toFlow({ x: e.clientX, y: e.clientY });
            const dx = now.x - d.startFlow.x;
            const dy = now.y - d.startFlow.y;
            if (!d.moved && Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 3) return;
            d.moved = true;
            for (const el of markEls(d.id)) el.style.translate = `${dx}px ${dy}px`;
            return;
          }
          if (client.current.length === 0) return;
          client.current.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
          setDraft((d) => (tool === 'pen' ? [...d, localOf(e)] : [d[0] ?? localOf(e), localOf(e)]));
        }}
        onPointerUp={(e) => {
          if (passive) return;
          const d = drag.current;
          if (d) {
            drag.current = null;
            (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
            const now = toFlow({ x: e.clientX, y: e.clientY });
            const dx = now.x - d.startFlow.x;
            const dy = now.y - d.startFlow.y;
            const prev = items.find((i) => i.id === d.id);
            const release = () => {
              landing.current = null;
              for (const el of markEls(d.id)) el.style.translate = '';
            };
            if (!d.moved || !prev || (dx === 0 && dy === 0)) {
              release();
              return;
            }
            // Keep the translate until the stored position has landed, so the mark never snaps back.
            const rendered = resolveItems(items, (id) => boxes.find((b) => b.id === id)).items.find((i) => i.id === prev.id);
            landing.current = { id: d.id, prev };
            void Promise.resolve(onPut(moveMarkTo(prev, dx, dy, boxes, rendered))).then(
              () => requestAnimationFrame(() => { if (landing.current?.id === d.id) release(); }),
              release,
            );
            return;
          }
          if (tool === 'select') return;
          const pts = client.current;
          client.current = [];
          setDraft([]);
          (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
          const at = { x: e.clientX, y: e.clientY };
          if (tool === 'erase') {
            const { mark } = under(at);
            if (mark) onRemove(mark);
            return;
          }
          if (tool === 'text' || tool === 'sticky') {
            const { mark } = under(at);
            const existing = mark ? items.find((i) => i.id === mark) : undefined;
            if (existing && existing.kind === 'text') {
              setEditor({ local: localOf(e), flow: toFlow(at), kind: existing.sticky ? 'sticky' : 'text', id: existing.id, text: existing.text, anchorAt: null });
              return;
            }
            const flow = toFlow(at);
            setEditor({ local: localOf(e), flow, kind: tool, id: null, text: '', anchorAt: nodeAt(boxes, flow) });
            return;
          }
          if (pts.length < 2) return;
          const first = pts[0]!;
          const last = pts[pts.length - 1]!;
          const f0 = toFlow(first);
          const f1 = toFlow(last);
          if (tool === 'pen') {
            const item: WbItem = { kind: 'stroke', id: freshId('ink'), by: 'person', points: pts.map((p) => ({ ...toFlow(p), t: Math.max(0, Math.round((p.t ?? 0) - (pts[0]!.t ?? 0))) })), width: 2 };
            onPut(anchorTo(item, nodeAt(boxes, f0)));
            return;
          }
          if (Math.abs(last.x - first.x) < 4 && Math.abs(last.y - first.y) < 4) return;
          if (tool === 'arrow') {
            const a = under(first);
            const b = under(last);
            const fromId = a.mark ?? a.node ?? undefined;
            const toId = b.mark ?? b.node ?? undefined;
            onPut({
              kind: 'shape',
              id: freshId('arrow'),
              by: 'person',
              shape: 'arrow',
              from: f0,
              to: f1,
              ...(fromId && fromId !== toId ? { fromId } : {}),
              ...(toId && fromId !== toId ? { toId } : {}),
            });
            return;
          }
          const item: WbItem = { kind: 'shape', id: freshId(tool), by: 'person', shape: tool, from: f0, to: f1 };
          onPut(anchorTo(item, nodeAt(boxes, f0)));
        }}
        onPointerCancel={() => {
          cancelDrag();
          client.current = [];
          setDraft([]);
        }}
        onLostPointerCapture={cancelDrag}
      >
        {draft.length > 1 ? <DraftMark tool={tool} points={draft} /> : null}
      </svg>
      {editor ? (
        <textarea
          className={`annot-editor${editor.kind === 'sticky' ? ' is-sticky' : ''}`}
          data-testid="annot-editor"
          aria-label={editor.kind === 'sticky' ? 'Sticky note text' : 'Text'}
          placeholder={editor.kind === 'sticky' ? 'Note' : 'Text'}
          autoFocus
          maxLength={500}
          style={{ left: editor.local.x, top: editor.local.y }}
          value={editor.text}
          onChange={(e) => setEditor({ ...editor, text: e.target.value })}
          onBlur={commitEditor}
          onKeyDown={(e) => {
            /* The board's keys (Esc leaves Draw, arrows walk cards) are not this field's. */
            e.stopPropagation();
            if (e.key === 'Escape') {
              e.preventDefault();
              setEditor(null);
            } else if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitEditor();
            }
          }}
        />
      ) : null}
    </div>
  );
}

function DraftMark({ tool, points }: { tool: ArchCaptureProps['tool']; points: Point[] }) {
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (tool === 'pen') return <path className="annot-draft" data-testid="annot-draft" d={path(points)} />;
  if (tool === 'rect') {
    return <rect className="annot-draft" data-testid="annot-draft" x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} rx={10} />;
  }
  if (tool === 'ellipse') {
    return <ellipse className="annot-draft" data-testid="annot-draft" cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} rx={Math.abs(b.x - a.x) / 2} ry={Math.abs(b.y - a.y) / 2} />;
  }
  return (
    <g className="annot-draft" data-testid="annot-draft">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      <path d={arrowHead(a, b)} />
    </g>
  );
}

/* ── the palette ──────────────────────────────────────────────────────── */

function ToolGlyph({ tool }: { tool: ArchTool | 'done' }) {
  const p =
    tool === 'rect' ? (
      <rect {...TOOL_GLYPH_SHAPES.rect} />
    ) : tool === 'ellipse' ? (
      <ellipse {...TOOL_GLYPH_SHAPES.ellipse} />
    ) : (
      TOOL_GLYPH_PATHS[tool].map((d) => <path key={d} d={d} />)
    );
  return (
    <svg className="annot-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {p}
    </svg>
  );
}

export interface ArchPaletteProps {
  tool: ArchTool;
  onTool: (tool: ArchTool) => void;
  onDone: () => void;
  /** Marks not drawn because their node is not on this level. */
  hidden: number;
}

export function ArchPalette({ tool, onTool, onDone, hidden }: ArchPaletteProps) {
  return (
    <div className="annot-palette" role="toolbar" aria-label="Draw tools" data-testid="annot-palette">
      {ARCH_TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className="annot-tool"
          data-testid={`annot-tool-${t.id}`}
          aria-label={t.label}
          data-hint={t.hint}
          aria-describedby={`annot-hint-${t.id}`}
          aria-pressed={tool === t.id}
          data-on={tool === t.id ? 'true' : 'false'}
          onClick={() => onTool(t.id)}
        >
          <ToolGlyph tool={t.id} />
          <span id={`annot-hint-${t.id}`} className="annot-sr">
            {t.hint}
          </span>
        </button>
      ))}
      <span className="annot-sep" />
      <button type="button" className="annot-tool annot-done" data-testid="annot-done" aria-label="Done drawing" title="Leave Draw (Esc)" onClick={onDone}>
        <ToolGlyph tool="done" />
      </button>
      {hidden > 0 ? (
        <span className="annot-hidden" data-testid="annot-hidden" title="Marks anchored to cards that are not on this level of the board">
          {hidden} hidden
        </span>
      ) : null}
    </div>
  );
}
