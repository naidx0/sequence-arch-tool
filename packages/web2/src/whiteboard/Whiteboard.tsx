/* ══════════════════════════════════════════════════════════════════════════
   THE WHITEBOARD SURFACE
   packages/web2/src/whiteboard/Whiteboard.tsx

   The rendered half of `whiteboardModel.ts`. Everything that DECIDES lives
   there; this draws, captures pointers, and holds the undo stack.

   ── IT LOOKS DIFFERENT ON PURPOSE ────────────────────────────────────────

   The architecture board's ground is `--bg-base` with node cards on
   `--surface-2`. This one is `--surface-1` with a dot grid, and the difference
   is not decoration: a reader glancing at a screenshot in three weeks has to
   know instantly whether they are looking at something the scanner found or
   something a person drew. Two surfaces that looked alike would put a sketch
   and a finding in the same visual sentence.

   ── CAPTURE ─────────────────────────────────────────────────────────────

   Pointer events, so pen, finger and mouse are one code path, with
   `setPointerCapture` so a stroke that leaves the element still finishes —
   the same discipline `StrokeLayer` uses on the architecture board. What
   differs is what happens next: there the path goes to `recognizeStroke` and a
   scribble is refused; here it is kept as ink.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ArchGraph } from '@sequence/schema';

import { Icon, type IconName } from '../chat/Icon';
import { mentionSources, rankMentions } from '../chat/mentionModel';
import { askFromWhiteboard, askableFrom, type WbAskRequest } from './whiteboardAsk';
import { EMPTY_VIEW, boardPoint, fitTo, wbCamera, type WbView } from './whiteboardCamera';
import {
  EMPTY_WHITEBOARD,
  WB_UNDO_DEPTH,
  readWhiteboard,
  strokeFrom,
  whiteboardEdit,
  whiteboardKey,
  writeWhiteboard,
  type Point,
  type WhiteboardDoc,
  type WhiteboardEdit,
  type WbItem,
} from './whiteboardModel';

/**
 * What a press does. Worded controls — sheet 09 ruling 3, as with Draw.
 *
 * `select` is FIRST because that is where a reader looks for it, and it is not
 * the DEFAULT because the owner walk opened on "Draw. It doesn’t seem to work"
 * — a whiteboard is opened to draw on. MIRO opens on select; this opens on the
 * tool the complaint was about.
 */
export type WbTool =
  | 'select'
  | 'pan'
  | 'draw'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'text'
  | 'link'
  | 'erase';

export interface WhiteboardProps {
  /** Which repository this board belongs to. Null is a real state, not an error. */
  repoRoot: string | null;
  /** Injected in tests so persistence is answerable without a browser. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;

  /*
   * ── THE TWO THINGS THAT MAKE THIS MORE THAN A SKETCHPAD ────────────────
   *
   * `graph` is what a reference can point AT. `WbNodeRef` had a type, a
   * renderer and a stylesheet and NOTHING CREATED ONE — the whiteboard's only
   * structural link back to the scan was unreachable, which is the missing half
   * of "not just visually, but in real structure within the project".
   *
   * `onAsk` is the hand-off. Absent means this build cannot ask, and the
   * control is not drawn rather than drawn dead.
   */
  graph?: ArchGraph | null;
  onAsk?: (request: WbAskRequest) => void;
}

let seq = 0;
/** Ids are supplied by the surface so the model stays pure and testable. */
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}${seq}`;
}

/**
 * Whether a board-level key came from somewhere that owns text editing.
 *
 * Selection and editing are independent state on purpose, so merely binding the
 * Delete listener while something is selected is not enough: the note editor,
 * link picker and ask textarea can all be open while that selection still
 * exists. Their keystrokes belong to the control, never to the board.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !== null
  );
}

export function Whiteboard({ repoRoot, storage, graph = null, onAsk }: WhiteboardProps) {
  const store = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  const key = whiteboardKey(repoRoot);

  const [doc, setDoc] = useState<WhiteboardDoc>(EMPTY_WHITEBOARD);
  const [past, setPast] = useState<WhiteboardDoc[]>([]);
  const [tool, setTool] = useState<WbTool>('draw');
  const [drafting, setDrafting] = useState<Point[] | null>(null);

  /*
   * SELECTION, AND THE DRAG IN PROGRESS.
   *
   * `whiteboardEdit` has handled `wb/move` since the model landed, with four
   * tests over it, and NOTHING dispatched it — a grep for `wb/move` outside
   * the model returned only that model’s own test. So every mark on this
   * board was fixed where it fell, on a surface whose stated model is a Miro
   * board.
   *
   * `dragBy` is held here and applied ONCE on release. Applying a move per
   * `pointermove` is around sixty documents a second, which eats the 50-deep
   * undo budget inside a second and makes Ctrl-Z look broken.
   */
  const [selected, setSelected] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<Point | null>(null);
  const [dragBy, setDragBy] = useState<Point | null>(null);

  /*
   * ── THE CAMERA ────────────────────────────────────────────────────────
   *
   * The owner's bar is MIRO, and this was a fixed-viewport SVG: no pan, no
   * zoom, a board the size of the window. The view lives here and the document
   * knows nothing about it — two people looking at one drawing from different
   * places are not editing different documents.
   *
   * NOT PERSISTED, deliberately, while the drawing is. Where you were last
   * looking is not part of what you drew, and restoring a stranger's camera
   * position on open is a surface deciding where the reader wanted to be.
   */
  const [view, setView] = useState<WbView>(EMPTY_VIEW);
  const [panFrom, setPanFrom] = useState<Point | null>(null);

  /* Where a reference will land once one is chosen, and what is being typed to
     find it. Null means the picker is closed. */
  const [linkAt, setLinkAt] = useState<Point | null>(null);
  const [linkQuery, setLinkQuery] = useState('');

  /* The reader's own sentence, carried verbatim into the request. */
  /*
   * ── EDITING A NOTE ────────────────────────────────────────────────────
   *
   * `whiteboardEdit` has handled `wb/text` since the model landed and nothing
   * dispatched it: a note could be created and deleted, and every note on every
   * board read "Note" for ever. The one gesture that means "change this word"
   * on every canvas anyone has used is a double-click, so that is the gesture.
   */
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  const [askNote, setAskNote] = useState('');
  const [asking, setAsking] = useState(false);

  /*
   * WHAT A REFERENCE MAY POINT AT, ranked by the SAME function the composer's
   * `@` uses. A second ranking would be a second answer to "did they mean the
   * payments service or pay.ts", and sheet 12.4 already settled that one:
   * in an architecture tool the coarser thing wins.
   */
  const linkRows = useMemo(
    () => (linkAt === null ? [] : rankMentions(linkQuery, mentionSources(graph, null))),
    [linkAt, linkQuery, graph],
  );

  /* Load on mount and whenever the repository changes. A board that kept the
     previous repo's sketches after an attach would be showing notes for a
     system the reader is no longer in. */
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = store?.getItem(key) ?? null;
    } catch {
      /* Storage can be denied outright (private mode, a blocked origin). That
         costs persistence, and must not cost the surface. */
    }
    setDoc(readWhiteboard(raw));
    setPast([]);
  }, [key, store]);

  const persist = useCallback(
    (next: WhiteboardDoc) => {
      try {
        store?.setItem(key, writeWhiteboard(next));
      } catch {
        /* Quota, or storage denied. The drawing stays on screen either way. */
      }
    },
    [key, store],
  );

  /**
   * Apply an edit, remembering the previous document only when something
   * actually changed.
   *
   * `whiteboardEdit` returns the SAME object for a no-op, so identity is the
   * test — an undo stack that grows on no-ops makes Ctrl-Z look broken.
   */
  const apply = useCallback(
    (edit: WhiteboardEdit) => {
      setDoc((current) => {
        const next = whiteboardEdit(current, edit);
        if (next === current) return current;
        setPast((frames) => [...frames, current].slice(-WB_UNDO_DEPTH));
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const undo = useCallback(() => {
    setPast((frames) => {
      if (frames.length === 0) return frames;
      const previous = frames[frames.length - 1]!;
      setDoc(previous);
      persist(previous);
      return frames.slice(0, -1);
    });
  }, [persist]);

  /* ── capture ─────────────────────────────────────────────────────────── */

  const svgRef = useRef<SVGSVGElement | null>(null);

  /** Where the pointer is on SCREEN, relative to the canvas element. */
  const screenOf = (event: { clientX: number; clientY: number }): Point => {
    const box = svgRef.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };

  /**
   * Where the pointer is on the BOARD.
   *
   * THE ONE FUNCTION A CAMERA MAKES MANDATORY, and the one whose absence is
   * silent: keep treating a screen coordinate as a board coordinate and every
   * mark made while panned or zoomed is stored somewhere other than where the
   * reader drew it. It looks correct until the view is reset.
   */
  const pointOf = (event: { clientX: number; clientY: number }): Point =>
    boardPoint(view, screenOf(event));

  const onDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (tool === 'erase') return;

    if (tool === 'pan') {
      (event.target as Element).setPointerCapture?.(event.pointerId);
      /* SCREEN space, not board space: a pan is a movement of the camera, and
         measuring it in board units would make it accelerate as you zoom in. */
      setPanFrom(screenOf(event));
      return;
    }

    if (tool === 'link') {
      /* The picker opens WHERE THEY PRESSED, so the chosen reference lands
         under the pointer rather than at some default corner. */
      setLinkAt(pointOf(event));
      setLinkQuery('');
      return;
    }

    if (tool === 'select') {
      /* A press that reaches the ground is a deselect: an item stops the event
         before this runs, so arriving here means empty board. */
      setSelected(null);
      return;
    }
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDrafting([pointOf(event)]);
  };

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (panFrom) {
      const at = screenOf(event);
      setView((v) => wbCamera(v, { kind: 'pan', dx: at.x - panFrom.x, dy: at.y - panFrom.y }));
      setPanFrom(at);
      return;
    }

    if (dragFrom) {
      const at = pointOf(event);
      setDragBy({ x: at.x - dragFrom.x, y: at.y - dragFrom.y });
      return;
    }
    setDrafting((points) => (points ? [...points, pointOf(event)] : points));
  };

  const onUp = () => {
    if (panFrom) {
      setPanFrom(null);
      return;
    }

    if (dragFrom) {
      const by = dragBy;
      setDragFrom(null);
      setDragBy(null);
      /* A zero delta reaches `whiteboardEdit`, which returns the same document
         for it, so no undo frame is pushed. Guarding here as well would put
         one rule in two places. */
      if (selected && by) apply({ type: 'wb/move', id: selected, dx: by.x, dy: by.y });
      return;
    }

    const points = drafting;
    setDrafting(null);
    if (!points || points.length === 0) return;

    const from = points[0]!;
    const to = points[points.length - 1]!;

    if (tool === 'draw') {
      /* NOTHING IS RECOGNISED. See whiteboardModel: the architecture board
         turns a rough box into a node and refuses a scribble; doing that here
         would convert a sketch into something that looks like a finding. */
      const stroke = strokeFrom(nextId('s'), points);
      if (stroke) apply({ type: 'wb/add', item: stroke });
      return;
    }

    if (tool === 'text') {
      apply({
        type: 'wb/add',
        item: { kind: 'text', id: nextId('t'), at: from, text: 'Note' },
      });
      return;
    }

    /* Erase draws nothing — it removes on click, and `onDown` already returned
       for it. Saying so here as well is what makes the type exhaustive rather
       than relying on a guard three functions away staying true. */
    if (tool === 'erase') return;

    /* Select draws nothing either. The drag branch at the top of this function
       already returned for a move, and a press that reached the ground only
       cleared the selection — stated here for the same reason erase is, so the
       type is exhaustive rather than relying on a guard three functions away
       staying true. */
    if (tool === 'select') return;

    /* Pan draws nothing either; the branch at the top of this function already
       returned for it. Stated here for the same reason erase and select are. */
    if (tool === 'pan') return;

    /* Link draws nothing: the press opened a picker and the mark is made when
       a row is chosen, not when the pointer comes up. */
    if (tool === 'link') return;

    /* A shape needs two distinct corners. A click with the box tool would
       otherwise leave a zero-size shape that is invisible and still selectable. */
    if (Math.abs(to.x - from.x) < 3 && Math.abs(to.y - from.y) < 3) return;
    apply({
      type: 'wb/add',
      item: { kind: 'shape', id: nextId('r'), shape: tool, from, to },
    });
  };

  /**
   * The wheel zooms about the pointer.
   *
   * NOT SCROLL. A board with no scrollbars that consumed the wheel to move
   * vertically would be a surface pretending to be a page. `preventDefault`
   * is what stops the page behind it moving instead.
   */
  const onWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    /* A multiplicative step, so one notch feels the same at every zoom - an
       additive one crawls when zoomed out and lurches when zoomed in. */
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    setView((v) => wbCamera(v, { kind: 'zoom', to: v.zoom * factor, at: screenOf(event) }));
  };

  /**
   * Delete removes the selection; Escape drops it.
   *
   * BOUND ONLY WHILE SOMETHING IS SELECTED, so Delete cannot reach the board
   * when the reader meant nothing by it — a key that silently removes a mark
   * is worse than a key that does not work.
   */
  useEffect(() => {
    if (selected === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape') {
        setSelected(null);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        apply({ type: 'wb/delete', id: selected });
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, apply]);

  const draftPath = useMemo(
    () => (drafting && drafting.length > 1 ? toPath(drafting) : null),
    [drafting],
  );

  const empty = doc.items.length === 0 && !drafting;

  const shapeTools = ['rect', 'ellipse', 'line', 'arrow'] as const;
  const annotateTools = ['text', 'link'] as const;
  const shapeActive = shapeTools.includes(tool as (typeof shapeTools)[number]);
  const annotateActive = annotateTools.includes(tool as (typeof annotateTools)[number]);

  return (
    <div className="wb-scope wb" data-testid="whiteboard">
      <div className="wb-tools" data-testid="wb-tools">
        {(['select', 'pan', 'draw'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className="wb-tool"
            data-testid={`wb-tool-${t}`}
            aria-pressed={tool === t}
            data-on={tool === t ? 'true' : 'false'}
            onClick={() => setTool(t)}
            aria-label={TOOL_LABEL[t]}
            title={TOOL_LABEL[t]}
          >
            <Icon name={TOOL_ICON[t]} />
          </button>
        ))}

        {/* Shapes + annotate as dropdowns — owner: expandable features rather
            than an icon dump of every tool at once (2026-08-25). */}
        <WbToolMenu
          testId="wb-shapes"
          label="Shapes"
          icon={shapeActive ? TOOL_ICON[tool as WbTool] : 'rect'}
          active={shapeActive}
          tools={shapeTools}
          current={tool}
          onPick={setTool}
        />
        <WbToolMenu
          testId="wb-annotate"
          label="Annotate"
          icon={annotateActive ? TOOL_ICON[tool as WbTool] : 'text'}
          active={annotateActive}
          tools={annotateTools}
          current={tool}
          onPick={setTool}
        />
        <button
          type="button"
          className="wb-tool"
          data-testid="wb-tool-erase"
          aria-pressed={tool === 'erase'}
          data-on={tool === 'erase' ? 'true' : 'false'}
          onClick={() => setTool('erase')}
          aria-label={TOOL_LABEL.erase}
          title={TOOL_LABEL.erase}
        >
          <Icon name={TOOL_ICON.erase} />
        </button>

        <span className="wb-gap" />
        {/* FIT IS A WORD, not a glyph — sheet 09 ruling 3, the same reason Draw
            is: "the icon vocabulary has no glyph for a camera move and does not
            borrow one". */}
        <button
          type="button"
          className="wb-tool"
          data-testid="wb-fit"
          disabled={doc.items.length === 0}
          onClick={() => {
            const box = svgRef.current?.getBoundingClientRect();
            if (!box) return;
            const framed = fitTo(doc, { width: box.width, height: box.height });
            /* NULL IS A REAL ANSWER — an empty board has nothing to frame, and
               the control is disabled for it rather than moving the camera to
               a rectangle nobody drew. */
            if (framed) setView(framed);
          }}
        >
          Fit
        </button>
        <button
          type="button"
          className="wb-tool"
          data-testid="wb-reset-view"
          disabled={view.x === 0 && view.y === 0 && view.zoom === 1}
          onClick={() => setView(wbCamera(view, { kind: 'reset' }))}
        >
          Reset
        </button>
        <button
          type="button"
          className="wb-tool"
          data-testid="wb-undo"
          disabled={past.length === 0}
          onClick={undo}
        >
          Undo
        </button>
        {onAsk ? (
          <button
            type="button"
            className="wb-tool wb-tool-solid"
            data-testid="wb-ask"
            /* DISABLED ON A BOARD WITH NOTHING TO SAY. A sketch of unlabelled
               strokes produces a request whose whole content is "the reader
               drew twelve lines", and refusing says that for free rather than
               after a turn is spent. */
            disabled={!askableFrom(doc)}
            onClick={() => setAsking(true)}
          >
            Ask about this
          </button>
        ) : null}
        <button
          type="button"
          className="wb-tool"
          data-testid="wb-clear"
          disabled={doc.items.length === 0}
          onClick={() => apply({ type: 'wb/clear' })}
        >
          Clear
        </button>
      </div>

      {/* `data-tool` is on the canvas because the cursor over a mark depends
          on which tool is active, and CSS cannot ask React what that is. */}
      <svg
        ref={svgRef}
        className="wb-canvas"
        data-testid="wb-canvas"
        data-tool={tool}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        <defs>
          <pattern id="wb-dots" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" className="wb-dot" />
          </pattern>
        </defs>
        {/* The ground says which surface this is before anything is drawn on
            it. A blank board identical to the architecture board's is how a
            reader ends up unsure which one they are looking at. */}
        <rect width="100%" height="100%" fill="url(#wb-dots)" />

        {/* ONE TRANSFORM FOR THE WHOLE DRAWING. Applying the camera per item
            would mean every item recomputing it, and a stroke and its own
            draft could disagree mid-gesture. The grid above stays outside it
            so the paper does not zoom with the ink. */}
        <g
          data-testid="wb-viewport"
          transform={`translate(${view.x},${view.y}) scale(${view.zoom})`}
        >

        {doc.items.map((item) => (
          <WbItemView
            key={item.id}
            item={item}
            selected={item.id === selected}
            offset={item.id === selected ? dragBy : null}
            onPress={
              tool === 'select'
                ? (event) => {
                    /* Stops the ground handler from deselecting the item this
                       very press just picked. */
                    event.stopPropagation();
                    /* Prefer the mark element so existing move-capture tests and
                       pointer-leave relays keep working; fall back to the group. */
                    const host =
                      (event.currentTarget as Element).querySelector?.('[data-testid="wb-item"]') ??
                      (event.currentTarget as Element);
                    (host as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(
                      event.pointerId,
                    );
                    setSelected(item.id);
                    setDragFrom(pointOf(event));
                    setDragBy({ x: 0, y: 0 });
                  }
                : undefined
            }
            onEdit={
              tool === 'select' && item.kind === 'text'
                ? () => setEditing({ id: item.id, text: item.text })
                : undefined
            }
            onErase={tool === 'erase' ? () => apply({ type: 'wb/delete', id: item.id }) : undefined}
          />
        ))}

        {draftPath ? <path className="wb-ink wb-draft" d={draftPath} /> : null}
        </g>
      </svg>

      {/* ── CHOOSING WHAT A REFERENCE POINTS AT ───────────────────────────
          Sheet 12.4's ruling, inherited from the composer's `@`: a reference
          "resolves against the graph, or it resolves against nothing… where
          nothing matches it says so and offers NO FREE-TEXT FALLBACK, because
          a reference the engine cannot resolve is the exact thing this product
          exists to prevent." So there is no "add anyway". */}
      {editing !== null ? (
        <div className="wb-picker" data-testid="wb-edit">
          <input
            className="wb-input"
            data-testid="wb-edit-text"
            value={editing.text}
            autoFocus
            onChange={(event) => setEditing({ id: editing.id, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(null);
              if (event.key === 'Enter') {
                /* A no-op text change reaches `whiteboardEdit`, which returns
                   the same document for it, so retyping the same word does not
                   arm Undo. The rule stays in one place. */
                apply({ type: 'wb/text', id: editing.id, text: editing.text });
                setEditing(null);
              }
            }}
          />
          <p className="wb-picker-none">Enter to keep it, Escape to leave it as it was.</p>
        </div>
      ) : null}

      {linkAt !== null ? (
        <div className="wb-picker" data-testid="wb-picker">
          <input
            className="wb-input"
            data-testid="wb-picker-query"
            value={linkQuery}
            autoFocus
            placeholder="which part of the system"
            onChange={(event) => setLinkQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setLinkAt(null);
            }}
          />
          {linkRows.length === 0 ? (
            <p className="wb-picker-none" data-testid="wb-picker-none">
              {graph === null
                ? 'No repository is attached, so there is nothing to point at.'
                : 'Nothing in this repository is called that.'}
            </p>
          ) : (
            <ul className="wb-picker-rows">
              {linkRows.map((row) => (
                <li key={`${row.kind}:${row.ref}`}>
                  <button
                    type="button"
                    className="wb-picker-row"
                    data-testid="wb-picker-row"
                    data-ref={row.ref}
                    onClick={() => {
                      apply({
                        type: 'wb/add',
                        item: {
                          kind: 'noderef',
                          id: nextId('n'),
                          at: linkAt,
                          nodeId: row.ref,
                          /* The label AS IT READ AT THE TIME. A pointer, never
                             a copy: the model's own header says a whiteboard
                             that copied a node's substance would be a second,
                             staler answer to a question the graph answers. */
                          label: row.label,
                        },
                      });
                      setLinkAt(null);
                    }}
                  >
                    {row.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* ── FINISH THE DRAWING, HAND IT OVER ──────────────────────────────
          The owner's constraint on the board's Generate gate applies here
          unchanged: "Generate is an explicit act with a confirmation step."
          This is that step, and what it produces lands in the COMPOSER — a
          canvas gesture never starts a run. */}
      {asking ? (
        <div className="wb-askpanel" data-testid="wb-ask-panel">
          <label className="wb-field">
            <span className="wb-label">What should the assistant do with this?</span>
            <textarea
              className="wb-input wb-textarea"
              data-testid="wb-ask-note"
              rows={3}
              value={askNote}
              onChange={(event) => setAskNote(event.target.value)}
              placeholder="optional — the notes and references go either way"
            />
          </label>
          <div className="wb-askactions">
            <button
              type="button"
              className="wb-tool"
              data-testid="wb-ask-cancel"
              onClick={() => setAsking(false)}
            >
              Back
            </button>
            <button
              type="button"
              className="wb-tool wb-tool-solid"
              data-testid="wb-ask-send"
              onClick={() => {
                const request = askFromWhiteboard(doc, askNote);
                if (!request) return;
                onAsk?.(request);
                setAsking(false);
                setAskNote('');
              }}
            >
              Put it in the composer
            </button>
          </div>
        </div>
      ) : null}

      {empty ? (
        /* Sheet 08.5: what is not here, why, and one thing to do. The third
           part is the one that gets dropped, and dropping it turns an empty
           surface into a bug report the reader has to file. */
        <p className="wb-empty" data-testid="wb-empty">
          Nothing drawn yet. This board is yours — nothing here is read from your
          code, and nothing here is claimed about it.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Which tool draws which glyph. All ten tools map to book symbols: the four
 * Decision 8 authored (oval, text, link, erase), the two Decision 9 authored
 * (pan, rect — no borrowing of frame/module), and the pre-existing select /
 * draw / line / arrow glyphs. THE LABEL IS NEVER LOST — every control keeps
 * it as aria-label and title.
 */
const TOOL_ICON: Record<WbTool, IconName> = {
  select: 'cursor',
  pan: 'pan',
  draw: 'pen',
  rect: 'rect',
  ellipse: 'oval',
  line: 'minus',
  arrow: 'arrowright',
  text: 'text',
  link: 'link',
  erase: 'erase',
};

const TOOL_LABEL: Record<WbTool, string> = {
  select: 'Select',
  pan: 'Pan',
  link: 'Link',
  draw: 'Draw',
  rect: 'Box',
  ellipse: 'Oval',
  line: 'Line',
  arrow: 'Arrow',
  text: 'Text',
  erase: 'Erase',
};

/** One grouped tool menu — shapes or annotate — instead of dumping every glyph. */
function WbToolMenu({
  testId,
  label,
  icon,
  active,
  tools,
  current,
  onPick,
}: {
  testId: string;
  label: string;
  icon: IconName;
  active: boolean;
  tools: readonly WbTool[];
  current: WbTool;
  onPick: (tool: WbTool) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className="wb-menuwrap" data-testid={testId}>
      <button
        type="button"
        className="wb-tool"
        data-testid={`${testId}-trigger`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-pressed={active}
        data-on={active ? 'true' : 'false'}
        aria-label={label}
        title={label}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name={icon} />
        <Icon name="chevdown" size={12} />
      </button>
      {open ? (
        <div className="wb-menu" role="menu" data-testid={`${testId}-menu`}>
          {tools.map((t) => (
            <button
              key={t}
              type="button"
              role="menuitemradio"
              className="wb-menuitem"
              data-testid={`wb-tool-${t}`}
              aria-checked={current === t}
              aria-label={TOOL_LABEL[t]}
              onClick={() => {
                onPick(t);
                setOpen(false);
              }}
            >
              <Icon name={TOOL_ICON[t]} />
              <span>{TOOL_LABEL[t]}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/**
 * The two barbs at the far end, in board units.
 *
 * PURE, and sized in absolute units rather than as a fraction of the line: a
 * proportional head turns a long arrow into a dart and a short one into a
 * smudge. A zero-length drag has no direction to point in, so it draws no head
 * rather than an arbitrary one.
 */
export function arrowHead(from: Point, to: Point, size = 12): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return '';
  const ux = dx / len;
  const uy = dy / len;
  /* Perpendicular, for the spread. */
  const px = -uy;
  const py = ux;
  const baseX = to.x - ux * size;
  const baseY = to.y - uy * size;
  const half = size * 0.42;
  return (
    `M${baseX + px * half},${baseY + py * half} L${to.x},${to.y} ` +
    `L${baseX - px * half},${baseY - py * half}`
  );
}

function toPath(points: readonly Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

/** Axis-aligned box for the selection halo — obvious chrome in select mode. */
function itemBounds(item: WbItem): { x: number; y: number; w: number; h: number } | null {
  switch (item.kind) {
    case 'stroke': {
      if (item.points.length === 0) return null;
      let minX = item.points[0]!.x;
      let maxX = minX;
      let minY = item.points[0]!.y;
      let maxY = minY;
      for (const p of item.points) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
    }
    case 'shape': {
      const x = Math.min(item.from.x, item.to.x);
      const y = Math.min(item.from.y, item.to.y);
      return {
        x,
        y,
        w: Math.max(1, Math.abs(item.to.x - item.from.x)),
        h: Math.max(1, Math.abs(item.to.y - item.from.y)),
      };
    }
    case 'text':
    case 'noderef':
      return { x: item.at.x - 4, y: item.at.y - 14, w: 80, h: 20 };
  }
}

function SelectionHalo({ item }: { item: WbItem }) {
  const box = itemBounds(item);
  if (!box) return null;
  const pad = 6;
  return (
    <rect
      className="wb-sel-halo"
      data-testid="wb-sel-halo"
      x={box.x - pad}
      y={box.y - pad}
      width={box.w + pad * 2}
      height={box.h + pad * 2}
      rx={6}
    />
  );
}

function WbItemView({
  item,
  selected = false,
  offset = null,
  onPress,
  onEdit,
  onErase,
}: {
  item: WbItem;
  selected?: boolean;
  /** How far the drag in progress has carried it. Nothing is written until release. */
  offset?: Point | null;
  onPress?: (event: React.PointerEvent) => void;
  /** Only ever supplied for a text item under the select tool. */
  onEdit?: () => void;
  onErase?: () => void;
}) {
  const common = {
    className: `wb-ink${onErase ? ' wb-erasable' : ''}`,
    'data-testid': 'wb-item',
    'data-kind': item.kind,
    /* PRESENT BOTH WAYS. An attribute that only appears when true cannot be
       read from outside without asking whether it is missing or false. */
    'data-selected': selected ? 'true' : 'false',
  };

  const groupProps = {
    transform: offset ? `translate(${offset.x},${offset.y})` : undefined,
    onPointerDown: onPress,
    onDoubleClick: onEdit,
    onClick: onErase,
  };

  const halo = selected ? <SelectionHalo item={item} /> : null;
  const hit = itemBounds(item);

  if (item.kind === 'stroke') {
    return (
      <g {...groupProps}>
        {halo}
        {hit ? (
          <rect
            className="wb-hit"
            x={hit.x - 4}
            y={hit.y - 4}
            width={hit.w + 8}
            height={hit.h + 8}
            fill="transparent"
          />
        ) : null}
        <path {...common} d={toPath(item.points)} />
      </g>
    );
  }

  if (item.kind === 'shape') {
    const x = Math.min(item.from.x, item.to.x);
    const y = Math.min(item.from.y, item.to.y);
    const w = Math.abs(item.to.x - item.from.x);
    const h = Math.abs(item.to.y - item.from.y);
    if (item.shape === 'rect') {
      return (
        <g {...groupProps}>
          {halo}
          <rect {...common} x={x} y={y} width={w} height={h} rx={8} />
        </g>
      );
    }
    if (item.shape === 'ellipse') {
      return (
        <g {...groupProps}>
          {halo}
          <ellipse {...common} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
        </g>
      );
    }
    /* An arrow is the line plus a head, drawn as one polyline so the two can
       never disagree about where the mark ends. */
    return (
      <g {...groupProps}>
        {halo}
        {hit ? (
          <rect className="wb-hit" x={hit.x - 4} y={hit.y - 4} width={hit.w + 8} height={hit.h + 8} fill="transparent" />
        ) : null}
        <line {...common} x1={item.from.x} y1={item.from.y} x2={item.to.x} y2={item.to.y} />
        {item.shape === 'arrow' ? <path {...common} d={arrowHead(item.from, item.to)} /> : null}
      </g>
    );
  }

  if (item.kind === 'text') {
    return (
      <g {...groupProps}>
        {halo}
        <text {...common} className={`wb-text${onErase ? ' wb-erasable' : ''}`} x={item.at.x} y={item.at.y}>
          {item.text}
        </text>
      </g>
    );
  }

  /* A node reference is a caption plus a pointer — never a copy of the node.
     It reads as a chip so it is visibly a reference to something elsewhere,
     rather than a thing that lives here. */
  return (
    <g {...groupProps}>
      {halo}
      <text {...common} className={`wb-noderef${onErase ? ' wb-erasable' : ''}`} x={item.at.x} y={item.at.y}>
        {item.label}
      </text>
    </g>
  );
}
