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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import type { ArchGraph } from '@sequence/schema';
import { CODE_CARD_MAX_H, CODE_CARD_W, CodeCard } from './CodeCard';

import { WbIcon, type WbGlyph } from './wbIcons';
import { Icon } from '../chat/Icon';
import { S2Icon } from '../shell2/icons';
import { mentionSources, rankMentions } from '../chat/mentionModel';
import { askFromWhiteboard, askableFrom, type WbAskRequest } from './whiteboardAsk';
import { AGENT_ACTIONS, agentActionQuestion } from '../askInPlace/agentActions';
import { whiteboardReference } from '../askInPlace/askReference';
import { regionAround, snapshotSvgRegion, unionBox } from '../askInPlace/snapshot';
import { useAskInPlace, type AskPayload } from '../askInPlace/useAskInPlace';
import { EMPTY_VIEW, WB_FIT_BOTTOM, WB_FIT_TOP, boardPoint, fitTo, screenPoint, wbCamera, type WbView } from './whiteboardCamera';
import { resolveItems } from '../canvas/boards/boardsModel';
import { fieldDots } from '../canvas/fieldDots';
import { whiteboardBounds } from './whiteboardModel';
import { layoutAgentBoard, paintedDoc, type EdgeLabelPlace } from './agentLayout';
import { logBoardEdit } from './boardEditLog';
import { hostedSvg } from './svgItem';
import { VideoBody } from './videoItem';
import { itemBox } from '../canvas/boards/boardsModel';
import { copyText, downloadText, sceneFilename, sceneRemotionSource } from './exportScene';
import { clampTime, formatTime, poseTransform, safeDuration, scenePoses, type Pose } from './scene';
import { WB_COLORS, WB_COLOR_LABEL, paint, type WbColor } from './palette';
import { SNAP_PREF_EVENT, readGridEnabled, readSnapMode, writeGridEnabled } from './snapPreference';
import { SNAP_WORDS, boxAt, shapeFromOffer } from './snapShape';
import type { SnapOffer, SnapSession } from './snapSession';
import {
  EMPTY_WHITEBOARD,
  STICKY_H,
  SVG_MIN,
  STICKY_W,
  WB_UNDO_DEPTH,
  readWhiteboard,
  strokeFrom,
  whiteboardEdit,
  whiteboardKey,
  writeWhiteboard,
  type Point,
  type WbScene,
  type WbShape,
  type WbStroke,
  svgSourceOf,
  type WhiteboardDoc,
  type WhiteboardEdit,
  type WbItem,
  WB_BOX_LINE,
  type WbBoxLabel,
} from './whiteboardModel';

/**
 * What a press does. Worded controls — sheet 09 ruling 3, as with Draw.
 *
 * `select` is FIRST and it is the DEFAULT (owner, 2026-10): the board opens the
 * way the architecture board does. An empty-canvas drag pans, a drag on a mark
 * moves it, Shift-drag marquees. Drawing is a tool you pick (P), never the
 * state a stray drag lands in. The tool is component state and is not
 * persisted, so a reload cannot reopen on a pen.
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
  | 'sticky'
  | 'link'
  | 'erase';

export interface WhiteboardProps {
  /** Which repository this board belongs to. Null is a real state, not an error. */
  repoRoot: string | null;
  /** Injected in tests so persistence is answerable without a browser. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  /** Override localStorage key — AI Canvas SeqDraw uses `seqDrawKey`. */
  storageKey?: string;

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
  /** P2-4: false when no model and no agent can answer yet; the Ask panel's one sentence then says so. Default true. */
  canAnswer?: boolean;
  /**
   * ASK IN PLACE (askInPlace/): the reader pointed at items on this board and
   * typed a question beside them. Absent means nowhere to send it, and the
   * hover button, the right-click item and the key are not offered.
   */
  onAskInPlace?: (payload: AskPayload) => void;
  /**
   * Human moved an agent mark — pin + intent ghost for the next diagram turn.
   * `ghostAt` is where the agent left it; `at` is where the human put it.
   */
  onPin?: (args: { id: string; ghostAt: Point; at: Point }) => void;

  /*
   * ── THE TWO PROPS THAT LET THE AGENT REACH THIS SURFACE ────────────────
   *
   * The board's document has always lived in this component's own `useState`,
   * which is why `packages/analyzer/` contains no whiteboard code at all: there
   * was nowhere outside this file for a written item to land, and nowhere for
   * the ask payload to read one from. The camera, the model, the edit
   * vocabulary and fifty frames of undo were all finished and the surface was
   * sealed.
   *
   * BOTH ARE OPTIONAL, AND THAT IS THE DESIGN. `ConnectedWhiteboard` supplies
   * them from the store; `Whiteboard.test.tsx` renders this component with
   * neither and gets exactly the behaviour it had before. The repo already
   * takes this shape twice (`ConnectedBoard`, `ConnectedAiCanvas`) — a
   * presentational surface plus a thin connected wrapper — rather than making
   * every test stand up a StoreProvider.
   */
  /** Fired whenever the document changes, so the store can mirror it. */
  onDocChange?: (doc: WhiteboardDoc) => void;
  /**
   * Items the AGENT drew, arriving from the stream.
   *
   * Appended by id, never adopted wholesale. Replacing the document with an
   * external copy would fight the person's own edits mid-stroke and would make
   * this prop a second writer of the same state; matching on id is idempotent,
   * so a re-render or a replayed event cannot double-draw.
   */
  agentItems?: readonly WbItem[];
  /**
   * True while the agent's turn is running, so `agentItems` that arrive now are
   * LIVE: they draw themselves in (boxes pop in along the flow, connectors
   * draw, the newest batch pulses once). Marks that were already on the board,
   * or come back from a reload or a chat switch, never animate.
   */
  live?: boolean;
  /** Faint marks at the agent's last placement after a human pin. */
  intentGhosts?: readonly { id: string; at: Point }[];
  /** Render body for `artifact` frames (AI Canvas charts/blocks). */
  renderArtifact?: (item: Extract<WbItem, { kind: 'artifact' }>) => React.ReactNode;
  /**
   * The artifact ids the surface's document actually has. When given, an
   * artifact frame outside it is not drawn — no "Block gone" placeholder for a
   * frame whose block this document does not hold (owner photo, 2026-09-22).
   * Hidden, not deleted: a thread's blocks load from disk a moment after it
   * opens, and its frames must still be there when they do.
   */
  artifactIds?: ReadonlySet<string>;
  /**
   * ROUND 8 — THE STORE'S COPY, ADOPTED WHEN IT CHANGES. The board now lives
   * in `/api/boards` and an agent can draw on it from another process; when
   * the store's document moves on (a new object here), the surface takes it
   * wholesale, without an undo frame (Ctrl-Z stays the person's own). The
   * caller writes the person's changes back from `onDocChange`.
   */
  externalDoc?: WhiteboardDoc | null;
}

let seq = 0;
/** Ids are supplied by the surface so the model stays pure and testable. */
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}${seq}`;
}

/** An id that cannot collide with one a previous session saved (the counter above restarts at 1). */
function freshId(prefix: string): string {
  return `${nextId(prefix)}-${Date.now().toString(36)}`;
}

/** How long an unanswered offer stays, and how long "Tidied" keeps its Undo. */
const OFFER_MS = 12_000;
const TIDIED_MS = 6_000;
/** How long "Board cleared, Undo" stays (0.1.8.1 C3, audit P1-4). */
export const CLEARED_MS = 8_000;

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

function itemOrigin(item: WbItem): Point {
  if (item.kind === 'text' || item.kind === 'noderef' || item.kind === 'artifact' || item.kind === 'svg' || item.kind === 'scene' || item.kind === 'video') {
    return { ...item.at };
  }
  if (item.kind === 'shape') return { ...item.from };
  return item.points[0] ? { ...item.points[0] } : { x: 0, y: 0 };
}

/**
 * The pill's left margin so its left edge lands on a WHOLE DEVICE PIXEL: the
 * centre, snapped in page coordinates (`origin` is where the margin starts, which
 * the shell may have put on a fraction), never negative.
 */
export function pillLeftFor(inner: number, pillWidth: number, origin = 0, dpr = 1): number {
  const snapped = Math.round((origin + (inner - pillWidth) / 2) * dpr) / dpr;
  return Math.max(0, snapped - origin);
}

/** P2-4: the Ask panel's one sentence: what Send does, and what is missing when nothing can answer. */
export function askPanelLine(canAnswer: boolean): string {
  return canAnswer
    ? 'Send puts this board and your note in the chat box, ready to ask.'
    : 'Send puts this board and your note in the chat box; no model is connected yet, so the chat will offer to connect one.';
}

export function Whiteboard({
  repoRoot,
  storage,
  storageKey,
  graph = null,
  onAsk,
  canAnswer = true,
  onAskInPlace,
  onPin,
  onDocChange,
  agentItems,
  live = false,
  intentGhosts,
  renderArtifact,
  artifactIds,
  externalDoc,
}: WhiteboardProps) {
  const store = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  /* Callers should pass storageKey (session-scoped). Fallback keeps tests working. */
  const key = storageKey ?? whiteboardKey(repoRoot);

  const [doc, setDoc] = useState<WhiteboardDoc>(EMPTY_WHITEBOARD);
  /*
   * THE CALLBACK IN A REF, so mirroring the document outward does not become a
   * dependency of hydration, of `apply`, or of `undo`. A parent that passes an
   * inline arrow re-creates it every render; naming it in those deps would
   * re-run the hydrate effect on every parent render and throw away the board.
   * The ref is read at call time and never compared.
   */
  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;
  const [past, setPast] = useState<WhiteboardDoc[]>([]);
  const [tool, setTool] = useState<WbTool>(WB_DEFAULT_TOOL);
  /*
   * ONE SHAPE, THEN BACK TO SELECT; A DOUBLE-CLICK KEEPS THE TOOL (0.1.8.1 C6, audit P2-1 and P2-2, as tldraw and
   * Excalidraw do). `lockedTool` is the tool a double-click kept; picking any tool any other way lets it go. The
   * Shapes and Text buttons pick the last one used from their list with one click; the chevron opens the list.
   */
  const [lockedTool, setLockedTool] = useState<WbTool | null>(null);
  const [lastShape, setLastShape] = useState<WbTool>('rect');
  const [lastAnnotate, setLastAnnotate] = useState<WbTool>('text');
  useEffect(() => {
    if ((['rect', 'ellipse', 'line', 'arrow'] as WbTool[]).includes(tool)) setLastShape(tool);
    if ((['text', 'sticky', 'link'] as WbTool[]).includes(tool)) setLastAnnotate(tool);
    setLockedTool((kept) => (kept === tool ? kept : null));
  }, [tool]);
  const lockTool = (t: WbTool) => {
    setTool(t);
    setLockedTool(t);
  };
  /* Hold Space to pan from any tool (same rule as canvas/Board.tsx). */
  const [spaceHeld, setSpaceHeld] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const pointerOver = useRef(false);
  /* Shift-drag marquee, in board space. */
  const [marquee, setMarquee] = useState<{ from: Point; to: Point } | null>(null);
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
  const [selected, setSelectedRaw] = useState<string | null>(null);
  /* A Shift-marquee that touched several marks selects them together (for Ask;
     a press on one mark is a single selection again and clears this). */
  const [group, setGroup] = useState<string[]>([]);
  /* The pen: new marks are drawn in this colour (ink is the default and is stored as no colour). */
  const [penColor, setPenColor] = useState<WbColor>('ink');
  /* New marks take the pen: a shape or stroke by `stroke`, a text by `color` (the backend's board-item fields). */
  const penStyle = penColor === 'ink' ? {} : { stroke: penColor };
  const penText = penColor === 'ink' ? {} : { color: penColor };
  const setSelected = (id: string | null) => {
    setSelectedRaw(id);
    setGroup([]);
  };
  const [dragFrom, setDragFrom] = useState<Point | null>(null);
  /* A hosted svg being resized from its corner handle: the pointer's start and the frame it started from, then the size so far. */
  const [resizing, setResizing] = useState<{ id: string; from: Point; w: number; h: number } | null>(null);
  const [resizeTo, setResizeTo] = useState<{ w: number; h: number } | null>(null);
  /* SCENES: the playhead of each scene (ms), which one is playing, which one a drag writes keyframes into, the
     scrubber being dragged, and the last export note. A paused scene at 0 is the board as drawn. */
  const [sceneT, setSceneT] = useState<Record<string, number>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState<{ id: string; x0: number; w: number } | null>(null);
  const [sceneNote, setSceneNote] = useState<{ id: string; text: string } | null>(null);
  const sceneTRef = useRef(sceneT);
  sceneTRef.current = sceneT;
  const itemsRef = useRef<readonly WbItem[]>([]);
  const selectedItem = selected !== null ? doc.items.find((i) => i.id === selected) : undefined;
  const selectedGroup = selectedItem?.group ?? null;
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
  /* Set once the board has been framed on load, OR the reader has touched it (an edit, a pan, a zoom):
     from then on the camera is theirs and a first stroke on an empty board never moves it. */
  const loadFramed = useRef(false);
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

  const more = useMenu();
  const [askNote, setAskNote] = useState('');
  const [askFocused, setAskFocused] = useState(false);
  const [asking, setAsking] = useState(false);
  const sendAsk = () => {
    if (!askableFrom(doc, askNote)) return;
    const request = askFromWhiteboard(doc, askNote);
    if (!request) return;
    onAsk?.(request);
    setAsking(false);
    setAskNote('');
  };

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
    const hydrated = readWhiteboard(raw);
    docKeyRef.current = key;
    setDoc(hydrated);
    setPast([]);
    onDocChangeRef.current?.(hydrated);
  }, [key, store]);

  /*
   * THE KEY THE DOCUMENT ON SCREEN WAS LOADED FOR. Measured 2026-09-22: one
   * chat's Mermaid frame was saved under the next chat's key, and that chat
   * opened with a "Block gone" frame. Between a key change and the load that
   * follows it, the document in memory is still the previous chat's; any save
   * in that window (a frame resizing as its diagram finishes rendering) wrote
   * it under the new key. A save now only lands under the key its document
   * came from.
   */
  const docKeyRef = useRef<string | null>(null);
  const persist = useCallback(
    (next: WhiteboardDoc) => {
      if (docKeyRef.current !== key) return;
      try {
        store?.setItem(key, writeWhiteboard(next));
      } catch {
        /* Quota, or storage denied. The drawing stays on screen either way. */
      }
    },
    [key, store],
  );

  /* The store moved on (an agent drew, another tab wrote): take its copy. */
  useEffect(() => {
    if (!externalDoc) return;
    setDoc((current) => (current === externalDoc ? current : externalDoc));
    onDocChangeRef.current?.(externalDoc);
  }, [externalDoc]);

  /*
   * WHAT THE AGENT DREW, APPENDED BY ID.
   *
   * Never an adoption of an external document: replacing `doc` wholesale would
   * fight the person's own edits mid-stroke and would make this prop a second
   * writer of the same state. Matching on id is idempotent, so a re-render, a
   * replayed stream event or a reconnect cannot double-draw.
   *
   * Straight into `setDoc` rather than through `apply`, and that is deliberate:
   * `apply` pushes an undo frame, and Ctrl-Z is the PERSON's word for "take
   * back what I just did". Making their undo swallow the agent's drawing —
   * silently, one item at a time — is the kind of shared-undo confusion this
   * surface has no way to explain.
   */
  /*
   * WHAT THE AGENT LAST SAID ABOUT EACH OF ITS MARKS, by id.
   *
   * The server lays a drawing out again every time the model adds to it, and
   * says so by dropping the old marks and sending new ones under the same ids.
   * Appending only unseen ids would keep the FIRST, scattered version of every
   * mark for ever. So: an id the agent has changed since this mount saw it is
   * replaced. An id seen for the first time that the document already holds is
   * left alone: that is a reload replaying the stream over marks the person may
   * have moved since.
   *
   * AN EMPTY OR DIFFERENT `agentItems` IS NEVER A WITHDRAWAL. A chat switch
   * resets the prop to [] (store `session/hydrated`) or to another chat's marks
   * while this component stays mounted; reading that as "the agent took these
   * back" deleted the drawing and wrote the deletion to the board store. The
   * one thing a re-layout really withdraws is a connector's extra segments
   * (`E:s1`, `E:s2`) when its route got shorter, and only when the connector
   * itself (`E`) was re-sent in the same batch.
   */
  const agentSeen = useRef(new Map<string, string>());
  /* WHAT ARRIVED LIVE, and in which batch (id -> stagger delay and batch
     number). Held per mount, so a remount, a reload and a chat switch all
     start with nothing animating. The first run of the effect is the board
     opening, not an arrival. */
  const [arrivals, setArrivals] = useState<ReadonlyMap<string, WbArrival>>(() => new Map());
  const arrivalBatch = useRef(0);
  const frameAfterArrival = useRef(false);
  const frameEmpty = useRef(false);
  const agentRan = useRef(false);
  const liveRef = useRef(live);
  liveRef.current = live;
  const docRef = useRef(doc);
  docRef.current = doc;
  useEffect(() => {
    const seen = agentSeen.current;
    const firstRun = !agentRan.current;
    agentRan.current = true;
    /* A reset: forget what was seen, remove nothing. */
    if (!agentItems || agentItems.length === 0) {
      seen.clear();
      return;
    }
    const incoming = new Map((agentItems ?? []).map((i) => [i.id, JSON.stringify(i)] as const));
    const withdrawn = [...seen.keys()].filter((id) => {
      const base = /^(.*):s\d+$/u.exec(id)?.[1];
      return base !== undefined && incoming.has(base) && !incoming.has(id);
    });
    const changed = new Map<string, WbItem>();
    for (const item of agentItems ?? []) {
      const before = seen.get(item.id);
      if (before !== undefined && before !== incoming.get(item.id)) changed.set(item.id, item);
    }
    if (!firstRun && liveRef.current) {
      const held = new Set(docRef.current.items.map((i) => i.id));
      const arrived = (agentItems ?? []).filter((i) => !seen.has(i.id) && !held.has(i.id));
      if (arrived.length > 0) {
        /* The first drawing onto an empty board is framed once it lands: the agent
           lays out from the origin, which is under the board tags at the default camera. */
        frameEmpty.current = docRef.current.items.length === 0;
        frameAfterArrival.current = true;
        const batch = ++arrivalBatch.current;
        const plan = planArrival(arrived, batch);
        setArrivals((was) => new Map([...was, ...plan]));
      }
    }
    for (const [id, json] of incoming) seen.set(id, json);
    for (const id of withdrawn) seen.delete(id);
    setDoc((current) => {
      const have = new Set(current.items.map((i) => i.id));
      const fresh = agentItems.filter((i) => !have.has(i.id));
      const drop = new Set(withdrawn);
      if (fresh.length === 0 && changed.size === 0 && drop.size === 0) return current;
      const kept = current.items
        .filter((i) => !drop.has(i.id))
        .map((i) => changed.get(i.id) ?? i);
      const next = { ...current, items: [...kept, ...fresh] };
      /* Persisted like any other item: a drawing that vanishes on reload because
         the agent rather than the person made it is a board the reader cannot
         trust to be the board. */
      persist(next);
      onDocChangeRef.current?.(next);
      return next;
    });
  }, [agentItems, persist]);

  /**
   * Apply an edit, remembering the previous document only when something
   * actually changed.
   *
   * `whiteboardEdit` returns the SAME object for a no-op, so identity is the
   * test — an undo stack that grows on no-ops makes Ctrl-Z look broken.
   */
  const boardId = key.startsWith('board:') ? key.slice('board:'.length) : 'whiteboard';
  const apply = useCallback(
    (edit: WhiteboardEdit) => {
      /* A reader's edit means the board has been opened: no load framing after it. */
      loadFramed.current = true;
      /* The local edit log (boardEditLog.ts): moves, renames, deletes and new
         marks, as small facts. Strokes are not logged one by one. */
      if (edit.type === 'wb/move' && (edit.dx !== 0 || edit.dy !== 0)) logBoardEdit(boardId, 'move', { dx: edit.dx, dy: edit.dy });
      else if (edit.type === 'wb/text') logBoardEdit(boardId, 'rename', { length: edit.text.length });
      else if (edit.type === 'wb/delete') logBoardEdit(boardId, 'delete');
      else if (edit.type === 'wb/add' && edit.item.kind !== 'stroke') logBoardEdit(boardId, 'add', { kind: edit.item.kind });
      setDoc((current) => {
        const next = whiteboardEdit(current, edit);
        if (next === current) return current;
        setPast((frames) => [...frames, current].slice(-WB_UNDO_DEPTH));
        persist(next);
        onDocChangeRef.current?.(next);
        return next;
      });
    },
    [persist, boardId],
  );

  /** Content-fit resize — no undo frame (same rationale as agent append). */
  const applyQuiet = useCallback(
    (edit: WhiteboardEdit) => {
      /* A reader's edit means the board has been opened: no load framing after it. */
      loadFramed.current = true;
      setDoc((current) => {
        const next = whiteboardEdit(current, edit);
        if (next === current) return current;
        persist(next);
        onDocChangeRef.current?.(next);
        return next;
      });
    },
    [persist],
  );

  const resizeArtifact = useCallback(
    (id: string, w: number, h: number) => {
      applyQuiet({ type: 'wb/resize', id, w, h });
    },
    [applyQuiet],
  );

  const undo = useCallback(() => {
    setPast((frames) => {
      if (frames.length === 0) return frames;
      const previous = frames[frames.length - 1]!;
      setDoc(previous);
      persist(previous);
      onDocChangeRef.current?.(previous);
      return frames.slice(0, -1);
    });
  }, [persist]);

  /* ── TIDY-UP OF DRAWN SHAPES ───────────────────────────────────────────
   *
   * After the pen rests, the recognizer (loaded with the first stroke, never at
   * boot) may offer a clean box, ellipse, diamond or arrow for what was drawn.
   * Settings > Whiteboard picks suggest (the default: a small offer, Enter or
   * a click takes it), auto (done for you, one Ctrl+Z from the raw strokes) or
   * off. Handwriting is never offered: the model's answer for a letter is "leave
   * it". Taking an offer is one `wb/replace`, so Ctrl+Z puts every raw stroke
   * back exactly as it was drawn.
   */
  const viewRef = useRef(view);
  viewRef.current = view;
  const pastRef = useRef(past);
  pastRef.current = past;
  const [offers, setOffers] = useState<SnapOffer[]>([]);
  const [tidied, setTidied] = useState<{ shapeId: string; decision: SnapOffer['decision']; noun: string } | null>(null);
  const lastSnap = useRef<{ shapeId: string; decision: SnapOffer['decision'] } | null>(null);
  const sessionRef = useRef<Promise<SnapSession> | null>(null);
  const penDownAt = useRef(0);
  const offerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tidiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOffers = useCallback(
    (how: 'esc' | 'x' | 'ignored' | 'taken') => {
      setOffers((current) => {
        if (how !== 'taken') for (const o of current) logBoardEdit(boardId, 'snap-dismissed', { shape: o.decision, how });
        return current.length === 0 ? current : [];
      });
      if (offerTimer.current) clearTimeout(offerTimer.current);
    },
    [boardId],
  );

  const takeOffer = useCallback(
    (offer: SnapOffer, how: 'snap-accepted' | 'snap-auto') => {
      const current = docRef.current;
      const strokes = offer.strokeIds
        .map((id) => current.items.find((i) => i.id === id))
        .filter((i): i is WbStroke => i?.kind === 'stroke');
      /* Erased or undone while the offer stood: nothing left to tidy. */
      if (strokes.length !== offer.strokeIds.length) return;
      const shapeId = freshId('q');
      apply({ type: 'wb/replace', remove: offer.strokeIds, add: [shapeFromOffer(shapeId, offer, strokes, current.items)] });
      lastSnap.current = { shapeId, decision: offer.decision };
      logBoardEdit(boardId, how, { shape: offer.decision, strokes: strokes.length, confidence: offer.confidence });
      setTidied({ shapeId, decision: offer.decision, noun: SNAP_WORDS[offer.decision].noun });
      if (tidiedTimer.current) clearTimeout(tidiedTimer.current);
      tidiedTimer.current = setTimeout(() => setTidied(null), TIDIED_MS);
    },
    [apply, boardId],
  );

  const onOffers = useCallback(
    (found: SnapOffer[]) => {
      const mode = readSnapMode();
      if (mode === 'off') return;
      if (mode === 'auto') {
        /* Auto acts alone only where it is sure: a closed shape, or a line that
           touches a box. A loose line may be an underline or a stroke of a letter,
           so it is only offered, as in suggest. */
        const items = docRef.current.items;
        const sure = (o: SnapOffer) => o.decision !== 'connector' || !!boxAt(items, o.from) || !!boxAt(items, o.to);
        for (const o of found.filter(sure)) takeOffer(o, 'snap-auto');
        found = found.filter((o) => !sure(o));
        if (found.length === 0) return;
      }
      setOffers(found);
      for (const o of found) logBoardEdit(boardId, 'snap-offered', { shape: o.decision, strokes: o.strokeIds.length, confidence: o.confidence });
      if (offerTimer.current) clearTimeout(offerTimer.current);
      offerTimer.current = setTimeout(() => clearOffers('ignored'), OFFER_MS);
    },
    [boardId, takeOffer, clearOffers],
  );

  /** The session and the model behind it load together, on the first stroke. */
  const session = useCallback((): Promise<SnapSession> => {
    sessionRef.current ??= import('./snapSession').then(
      ({ SnapSession }) =>
        new SnapSession({
          onOffer: onOffers,
          context: (pending) =>
            docRef.current.items.flatMap((i) => (i.kind === 'stroke' && !pending.has(i.id) ? [i.points] : [])),
          present: (id) => docRef.current.items.some((i) => i.id === id),
          zoom: () => viewRef.current.zoom,
          recognizer: () =>
            import('@sequence/ink/shape-model').then((m) => (pts, o) => m.recognizeShape(pts, o)),
        }),
    );
    /* If the session chunk itself fails to load, drawing goes on as plain ink and
       the next stroke tries again. */
    sessionRef.current.catch(() => {
      sessionRef.current = null;
    });
    return sessionRef.current;
  }, [onOffers]);

  useEffect(
    () => () => {
      if (offerTimer.current) clearTimeout(offerTimer.current);
      if (tidiedTimer.current) clearTimeout(tidiedTimer.current);
      void sessionRef.current?.then((s) => s.dispose()).catch(() => undefined);
    },
    [],
  );
  /* The dotted ground: off until the person turns it on in More (read at mount, followed through the pref event). */
  const [gridOn, setGridOn] = useState(() => readGridEnabled());
  /* A switch changed in Settings reaches an open board without a reload. */
  useEffect(() => {
    const onPref = () => {
      if (readSnapMode() === 'off') setOffers([]);
      setGridOn(readGridEnabled());
    };
    window.addEventListener(SNAP_PREF_EVENT, onPref);
    return () => window.removeEventListener(SNAP_PREF_EVENT, onPref);
  }, []);

  /**
   * Ctrl+Z (Cmd+Z), Enter and Escape for the board, while it has the keyboard.
   * Ctrl+Z is the Undo button's word: it takes back the last edit, and when that
   * edit was a tidy-up the raw strokes come back and the undo is logged as such.
   */
  const undoWithLog = useCallback(() => {
    const snap = lastSnap.current;
    const frames = pastRef.current;
    const reverts =
      snap &&
      docRef.current.items.some((i) => i.id === snap.shapeId) &&
      frames.length > 0 &&
      !frames[frames.length - 1]!.items.some((i) => i.id === snap.shapeId);
    undo();
    if (reverts && snap) {
      logBoardEdit(boardId, 'snap-undone', { shape: snap.decision });
      lastSnap.current = null;
      setTidied(null);
    }
  }, [undo, boardId]);

  /* ── SCENES ─────────────────────────────────────────────────────────────
     Play and pause one scene's playhead, copy or save its Remotion composition, and add a new stage. The clock is a
     requestAnimationFrame loop that runs only while a scene plays and stops at its end. */
  const toggleScene = (sc: WbScene) => {
    setArmed(sc.id);
    if (playing === sc.id) {
      setPlaying(null);
      return;
    }
    if ((sceneT[sc.id] ?? 0) >= safeDuration(sc.duration)) setSceneT((m) => ({ ...m, [sc.id]: 0 }));
    setPlaying(sc.id);
  };
  const exportScene = async (sc: WbScene, how: 'copy' | 'save') => {
    const text = sceneRemotionSource(sc, doc.items);
    if (how === 'save') {
      downloadText(sceneFilename(sc), text);
      setSceneNote({ id: sc.id, text: `Saved ${sceneFilename(sc)}` });
    } else {
      setSceneNote({ id: sc.id, text: (await copyText(text)) ? 'Copied Remotion composition' : 'Could not copy' });
    }
  };
  const addScene = () => {
    const at = boardPoint(view, { x: 60, y: 90 });
    const id = freshId('sc');
    apply({ type: 'wb/add', item: { kind: 'scene', id, at, w: 480, h: 300, duration: 4000, keyframes: [] } });
    setSelectedRaw(id);
    setArmed(id);
  };
  useEffect(() => {
    if (!playing || typeof requestAnimationFrame !== 'function') return undefined;
    let last = performance.now();
    let at = sceneTRef.current[playing] ?? 0;
    let raf = 0;
    const tick = (now: number) => {
      const sc = itemsRef.current.find((i) => i.id === playing);
      if (!sc || sc.kind !== 'scene') {
        setPlaying(null);
        return;
      }
      /* The playhead is accumulated here, not read back from state: frames can arrive faster than React renders. */
      at += now - last;
      const t = at;
      last = now;
      if (t >= safeDuration(sc.duration)) {
        setSceneT((m) => ({ ...m, [playing]: safeDuration(sc.duration) }));
        setPlaying(null);
        return;
      }
      setSceneT((m) => ({ ...m, [playing]: t }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  /* GROUP: a multi-selection (Shift-marquee) becomes one diagram, moved and selected together; Ungroup takes the selected mark's group apart. */
  const groupSelection = () => {
    if (group.length < 2) return;
    /* freshId, not nextId: the counter restarts at 1 on every load and would reuse a saved group's id (g1, g2, ...). */
    apply({ type: 'wb/group', ids: group, group: freshId('g') });
  };
  const ungroupSelection = () => {
    const g = selectedItem?.group;
    if (g === undefined) return;
    apply({ type: 'wb/group', ids: doc.items.filter((i) => i.group === g).map((i) => i.id), group: null });
    setGroup([]);
  };

  const onBoardKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      if (event.shiftKey) ungroupSelection();
      else groupSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undoWithLog();
      return;
    }
    if (event.key === 'Enter' && offers.length > 0) {
      event.preventDefault();
      const [first, ...rest] = offers;
      clearOffers('taken');
      if (first) takeOffer(first, 'snap-accepted');
      if (rest.length > 0) setOffers(rest);
      return;
    }
    if (event.key === 'Escape' && offers.length > 0) {
      event.preventDefault();
      clearOffers('esc');
    }
  };

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
    if (spaceHeld || tool === 'pan') {
      (event.target as Element).setPointerCapture?.(event.pointerId);
      /* SCREEN space, not board space: a pan is a movement of the camera, and
         measuring it in board units would make it accelerate as you zoom in. */
      setPanFrom(screenOf(event));
      return;
    }

    if (tool === 'erase') return;

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
      (event.target as Element).setPointerCapture?.(event.pointerId);
      if (event.shiftKey) {
        const at = pointOf(event);
        setMarquee({ from: at, to: at });
      } else {
        setPanFrom(screenOf(event));
      }
      return;
    }
    (event.target as Element).setPointerCapture?.(event.pointerId);
    /* The board takes the keyboard on a press, so Ctrl+Z / Enter / Escape reach it. */
    rootRef.current?.focus({ preventScroll: true });
    penDownAt.current = event.timeStamp;
    if (tool === 'draw') {
      void sessionRef.current?.then((s) => s.strokeBegan()).catch(() => undefined);
      if (offers.length > 0) clearOffers('ignored');
    }
    setDrafting([{ ...pointOf(event), t: 0 }]);
  };

  const onMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (panFrom) {
      const at = screenOf(event);
      setView((v) => wbCamera(v, { kind: 'pan', dx: at.x - panFrom.x, dy: at.y - panFrom.y }));
      setPanFrom(at);
      return;
    }

    if (marquee) {
      const to = pointOf(event);
      setMarquee((m) => (m ? { ...m, to } : m));
      return;
    }

    if (scrubbing) {
      const sc = doc.items.find((i) => i.id === scrubbing.id);
      if (sc?.kind === 'scene') setSceneT((m) => ({ ...m, [sc.id]: clampTime(((pointOf(event).x - scrubbing.x0) / scrubbing.w) * safeDuration(sc.duration), safeDuration(sc.duration)) }));
      return;
    }

    if (resizing) {
      const at = pointOf(event);
      setResizeTo({ w: Math.max(SVG_MIN, resizing.w + at.x - resizing.from.x), h: Math.max(SVG_MIN, resizing.h + at.y - resizing.from.y) });
      return;
    }

    if (dragFrom) {
      const at = pointOf(event);
      setDragBy({ x: at.x - dragFrom.x, y: at.y - dragFrom.y });
      return;
    }
    setDrafting((points) => (points ? [...points, { ...pointOf(event), t: Math.max(0, Math.round(event.timeStamp - penDownAt.current)) }] : points));
  };

  const onUp = () => {
    if (panFrom) {
      setPanFrom(null);
      return;
    }

    if (marquee) {
      const x0 = Math.min(marquee.from.x, marquee.to.x);
      const y0 = Math.min(marquee.from.y, marquee.to.y);
      const x1 = Math.max(marquee.from.x, marquee.to.x);
      const y1 = Math.max(marquee.from.y, marquee.to.y);
      setMarquee(null);
      /* One selection at a time on this board: the topmost mark the rectangle
         touches. */
      const hits = shownItems.filter((item) => {
        const b = itemBounds(item);
        return b !== null && b.x <= x1 && b.x + b.w >= x0 && b.y <= y1 && b.y + b.h >= y0;
      });
      const top = hits[hits.length - 1];
      if (top) {
        setSelectedRaw(top.id);
        setGroup(hits.length > 1 ? hits.map((h) => h.id) : []);
      }
      return;
    }

    if (scrubbing) {
      setScrubbing(null);
      return;
    }

    if (resizing) {
      const to = resizeTo;
      setResizing(null);
      setResizeTo(null);
      if (to) apply({ type: 'wb/resize', id: resizing.id, w: to.w, h: to.h });
      return;
    }

    if (dragFrom) {
      const by = dragBy;
      setDragFrom(null);
      setDragBy(null);
      /* A zero delta reaches `whiteboardEdit`, which returns the same document
         for it, so no undo frame is pushed. Guarding here as well would put
         one rule in two places. */
      const armedScene = armed ? doc.items.find((i) => i.id === armed) : undefined;
      const heldItem = selected ? doc.items.find((i) => i.id === selected) : undefined;
      if (selected && by && (by.x !== 0 || by.y !== 0) && armedScene?.kind === 'scene' && heldItem && heldItem.kind !== 'scene' && (sceneT[armedScene.id] ?? 0) > 0) {
        /* A DRAG WHILE A SCENE IS ARMED AND ITS PLAYHEAD IS PAST 0 WRITES A KEYFRAME there, at where the item now is, rather
           than moving the item itself: the item keeps its place on the board and the scene says where it goes. */
        const box = itemBox(heldItem);
        const pose = poses.get(heldItem.id);
        if (box) {
          apply({
            type: 'wb/scene-key',
            id: armedScene.id,
            key: { t: Math.round(sceneT[armedScene.id] ?? 0), target: heldItem.id, x: Math.round(box.x + (pose?.dx ?? 0) + by.x), y: Math.round(box.y + (pose?.dy ?? 0) + by.y) },
          });
        }
      } else if (selected && by && (by.x !== 0 || by.y !== 0)) {
        const item = doc.items.find((i) => i.id === selected);
        const ghostAt = item ? itemOrigin(item) : null;
        apply({ type: 'wb/move', id: selected, dx: by.x, dy: by.y });
        if (onPin && ghostAt && agentItems?.some((a) => a.id === selected)) {
          onPin({
            id: selected,
            ghostAt,
            at: { x: ghostAt.x + by.x, y: ghostAt.y + by.y },
          });
        }
      } else if (selected && by) {
        apply({ type: 'wb/move', id: selected, dx: by.x, dy: by.y });
      }
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
      const stroke = strokeFrom(freshId('s'), points);
      if (stroke) {
        apply({ type: 'wb/add', item: { ...stroke, ...penStyle } });
        const lastT = points[points.length - 1]?.t ?? 0;
        const t0 = penDownAt.current;
        if (readSnapMode() !== 'off') {
          void session()
            .then((s) => s.strokeEnded({ id: stroke.id, points: stroke.points, t0, t1: t0 + lastT }))
            .catch(() => undefined);
        }
      }
      return;
    }

    /* The note opens for typing at once with its placeholder selected (0.1.5): it used to land as a literal
       "Note" that only a double-click could change, so typing after a click did nothing. */
    if (tool === 'text') {
      const id = nextId('t');
      apply({
        type: 'wb/add',
        item: { kind: 'text', id, at: from, text: 'Note', ...penText },
      });
      setEditing({ id, text: 'Note' });
      return;
    }

    /* A sticky lands where they pressed and opens for typing at once: a blank
       note nobody wrote in is not a note. */
    if (tool === 'sticky') {
      const id = nextId('n');
      apply({
        type: 'wb/add',
        item: { kind: 'text', sticky: true, id, at: from, text: '', w: STICKY_W, h: STICKY_H, ...penText },
      });
      setEditing({ id, text: '' });
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
      item: { kind: 'shape', id: nextId('r'), shape: tool, from, to, ...penStyle },
    });
    /* One shape, then Select again, unless a double-click kept the tool (C6). */
    if (lockedTool !== tool) setTool('select');
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

  /**
   * Tool keys and hold-Space pan. Never while typing in a field, never with a
   * modifier. Keys act when focus is on the board or on the page body with the
   * pointer over the board, so another surface's letters stay its own.
   */
  useEffect(() => {
    const onBoard = (target: EventTarget | null) => {
      const root = rootRef.current;
      if (!root) return false;
      if (target instanceof Node && root.contains(target)) return true;
      return (target === document.body || target === null) && pointerOver.current;
    };
    const down = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!onBoard(event.target)) return;
      if (event.code === 'Space' || event.key === ' ') {
        /* A focused button keeps its own Space. */
        if (event.target instanceof Element && event.target.closest('button, a, [role="menuitemradio"]')) return;
        event.preventDefault();
        if (!event.repeat) setSpaceHeld(true);
        return;
      }
      const next = WB_TOOL_KEYS[event.key.toLowerCase()];
      if (next) {
        event.preventDefault();
        setTool(next);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.key === ' ') setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const draftPath = useMemo(
    () => (drafting && drafting.length > 1 ? toPath(drafting) : null),
    [drafting],
  );

  const empty = doc.items.length === 0 && !drafting;
  /* Bound arrows aimed at where their targets are now (boardsModel). */
  const agentIdSet = useMemo(() => new Set((agentItems ?? []).map((i) => i.id)), [agentItems]);
  /* What is PAINTED: the stored marks, their boxes grown to their words, notes wrapped and kept off boxes, connector
     labels placed clear of every box (agentLayout.ts). The stored document is never rewritten by it. */
  /* THE SCENES' POSES at their playheads: where, how big, how opaque each keyframed item is NOW, and the colour or words
     it has taken. The colours and words are applied before the board lays itself out, so a label that changes is wrapped
     like any other; the move and scale are an SVG transform on the item (WbItemView). */
  itemsRef.current = doc.items;
  const poses = useMemo(() => {
    const out = new Map<string, Pose>();
    const real = doc.items.filter((i) => i.kind !== 'scene');
    for (const sc of doc.items) {
      if (sc.kind !== 'scene') continue;
      for (const [id, pose] of scenePoses(real, sc, sceneT[sc.id] ?? 0)) out.set(id, pose);
    }
    return out;
  }, [doc.items, sceneT]);
  const styledItems = useMemo(() => (poses.size === 0 ? doc.items : doc.items.map((i) => withPose(i, poses.get(i.id)))), [doc.items, poses]);
  const composed = useMemo(() => layoutAgentBoard(resolveItems(styledItems).items, agentIdSet), [styledItems, agentIdSet]);
  const painted = useMemo(() => paintedDoc(composed), [composed]);
  const shownItems = composed.items;

  /* ══ ASK IN PLACE (askInPlace/) ══════════════════════════════════════════
     Point at marks, type beside them, and the words go to the main chat with
     the marks referenced by id. What this board supplies is only what the hook
     cannot know: which marks are selected (a marquee selects several), which
     mark an element belongs to, and where a mark is on screen. */
  const askSelection = group.length > 1 ? group : selected ? [selected] : [];
  const labelOfItem = (item: WbItem): string => {
    const composedLabel = composed.labels.get(item.id);
    if (composedLabel) return composedLabel.lines.join(' ');
    if (item.kind === 'shape') return item.label ?? '';
    if (item.kind === 'text') return item.text;
    if (item.kind === 'noderef') return item.label;
    return '';
  };
  /* The marks' union box in the canvas's own pixels (the camera applied). */
  const askBoxOf = (ids: readonly string[]) => {
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    for (const item of shownItems) {
      if (!ids.includes(item.id)) continue;
      const b = itemBounds(item);
      if (!b) continue;
      const at = screenPoint(view, { x: b.x, y: b.y });
      boxes.push({ x: at.x, y: at.y, w: b.w * view.zoom, h: b.h * view.zoom });
    }
    return unionBox(boxes);
  };
  const askRectOf = (ids: readonly string[]) => {
    const b = askBoxOf(ids);
    const svg = svgRef.current;
    if (!b || !svg) return null;
    const r = svg.getBoundingClientRect();
    return { left: r.left + b.x, top: r.top + b.y, width: b.w, height: b.h };
  };
  /* The picture of some marks, cropped from the board: what Ask sends along, and what Copy as image copies. */
  const snapshotIds = async (ids: readonly string[]): Promise<Blob | null> => {
    const b = askBoxOf(ids);
    const svg = svgRef.current;
    const root = rootRef.current;
    if (!b || !svg || !root) return null;
    const r = svg.getBoundingClientRect();
    const region = regionAround(b, { x: 0, y: 0, w: r.width, h: r.height });
    const cs = getComputedStyle(root);
    /* The marks pointed at carry a dashed accent halo in the crop. */
    return snapshotSvgRegion(svg, region, cs.backgroundColor, { box: b, color: cs.getPropertyValue('--accent').trim() || 'rgb(102, 51, 217)' });
  };
  /*
   * THE RIGHT-CLICK MENUS (0.1.8.1 C7, audit P2-3: "Minimal right-click menu, with duplicate Ask items"). On marks:
   * the one "Ask agent about this", then Explain, Duplicate, Bring to front, Copy as image and Delete. On the empty
   * board: the board's own actions. Every edit here is one undo frame.
   */
  const copyImage = async (ids: readonly string[]) => {
    const blob = await snapshotIds(ids).catch(() => null);
    if (!blob || typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return;
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]).catch(() => undefined);
  };
  const duplicateItems = (ids: readonly string[]) => {
    const idFor = Object.fromEntries(ids.map((id) => [id, freshId('d')]));
    apply({ type: 'wb/duplicate', ids: [...ids], dx: 16, dy: 16, idFor });
    const copies = Object.values(idFor);
    if (copies.length > 1) {
      setSelectedRaw(copies[copies.length - 1]!);
      setGroup(copies);
    } else setSelected(copies[0] ?? null);
  };
  const deleteItems = (ids: readonly string[]) => {
    apply({ type: 'wb/replace', remove: [...ids], add: [] });
    setSelected(null);
    setGroup([]);
  };
  const ask = useAskInPlace({
    enabled: true,
    ask: Boolean(onAskInPlace),
    menuItems: () => [
      ...(onAskInPlace ? [{ id: 'explain', label: 'Explain', run: (ids: readonly string[]) => ask.askAbout(ids, 'Explain this.') }] : []),
      ...(onAskInPlace
        ? AGENT_ACTIONS.map((a) => ({
            id: a.id,
            label: a.label,
            run: (ids: readonly string[]) =>
              ask.askAbout(
                ids,
                agentActionQuestion(
                  a.id,
                  shownItems.filter((i) => ids.includes(i.id)).map((i) => ({ id: i.id, label: labelOfItem(i), path: (i as { path?: string }).path })),
                ),
              ),
          }))
        : []),
      { id: 'duplicate', label: 'Duplicate', run: duplicateItems },
      { id: 'front', label: 'Bring to front', run: (ids) => apply({ type: 'wb/front', ids: [...ids] }) },
      { id: 'copy-image', label: 'Copy as image', run: (ids) => void copyImage(ids) },
      { id: 'delete', label: 'Delete', run: deleteItems },
    ],
    emptyMenuItems: () => [
      ...(onAsk ? [{ id: 'ask-board', label: 'Ask agent about this board', run: () => setAsking(true) }] : []),
      { id: 'fit', label: 'Fit to drawing', run: () => fit(), disabled: doc.items.length === 0 },
      { id: 'reset', label: 'Reset view', run: () => resetView() },
      { id: 'grid', label: gridOn ? 'Hide grid' : 'Show grid', run: () => writeGridEnabled(!gridOn) },
      { id: 'clear', label: 'Clear board', run: () => clearBoard(), disabled: doc.items.length === 0 },
    ],
    containerRef: rootRef,
    surface: 'whiteboard',
    selection: askSelection,
    idAt: (el) => el.closest('[data-item-id]')?.getAttribute('data-item-id') ?? null,
    resolve: (ids) => whiteboardReference(shownItems, ids, labelOfItem),
    rectOf: askRectOf,
    elementsOf: (ids) =>
      Array.from(rootRef.current?.querySelectorAll('[data-item-id]') ?? []).filter((el) =>
        ids.includes(el.getAttribute('data-item-id') ?? ''),
      ),
    snapshot: snapshotIds,
    select: (ids) => {
      if (ids.length > 1) {
        setSelectedRaw(ids[ids.length - 1]!);
        setGroup(ids);
      } else setSelected(ids[0] ?? null);
    },
    onSend: (payload) => onAskInPlace?.(payload),
  });

  const fit = () => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return;
    /* Frame the drawing between the board tags above and the pill below. */
    const framed = fitTo(painted, { width: box.width, height: box.height, top: WB_FIT_TOP, bottom: WB_FIT_BOTTOM });
    /* NULL IS A REAL ANSWER: an empty board has nothing to frame, and the
       control is disabled for it rather than moving the camera to a rectangle
       nobody drew. */
    if (framed) setView(framed);
  };
  /* Would the PAINTED drawing run past the pane through the current camera? */
  const paintedCutOff = () => {
    const box = svgRef.current?.getBoundingClientRect();
    const bounds = whiteboardBounds(painted);
    if (!box || box.width <= 0 || !bounds) return false;
    const left = bounds.x * view.zoom + view.x;
    const top = bounds.y * view.zoom + view.y;
    return (
      left < 0 ||
      top < WB_FIT_TOP / 2 ||
      left + bounds.width * view.zoom > box.width ||
      top + bounds.height * view.zoom > box.height - WB_FIT_BOTTOM / 2
    );
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    if (!frameAfterArrival.current || doc.items.length === 0) return;
    frameAfterArrival.current = false;
    /* The first drawing onto an empty board is framed outright; a later one only when it would be cut off by the
       pane's edge (a board the reader has arranged is not moved for a mark that fits). */
    if (frameEmpty.current || paintedCutOff()) fitRef.current();
  }, [doc]);
  /* A BOARD OPENED WITH A DRAWING THAT DOES NOT FIT THE PANE is framed once, on load.
     A reload used to leave the camera at the origin, so a diagram wider than a
     narrow pane ran off its right edge until someone pressed Fit. Only a drawing
     that is actually cut off is moved; one that fits stays where it was drawn. */
  useEffect(() => {
    if (view.x !== 0 || view.y !== 0 || view.zoom !== 1) loadFramed.current = true;
  }, [view]);
  useEffect(() => {
    if (loadFramed.current || doc.items.length === 0) return;
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    loadFramed.current = true;
    const bounds = whiteboardBounds(painted);
    if (!bounds) return;
    /* Through the CURRENT camera: bounds are board units, the pane is screen pixels. */
    const left = bounds.x * view.zoom + view.x;
    const top = bounds.y * view.zoom + view.y;
    const cut = left < 0 || top < 0 || left + bounds.width * view.zoom > box.width || top + bounds.height * view.zoom > box.height;
    if (cut) fitRef.current();
  }, [doc]);
  const resetView = () => setView(wbCamera(view, { kind: 'reset' }));
  /*
   * CLEAR BOARD SAYS SO, WITH ITS UNDO (0.1.8.1 C3, audit P1-4: "Clear board has no undo toast"). The clear is one
   * undo frame, so Undo (the toast's button, or Ctrl+Z anywhere on the page while the toast shows) puts back every
   * shape and stroke. The toast goes when the board has something on it again: an undo, or a new mark (after which
   * Ctrl+Z would take back the mark, not the clear).
   */
  const [cleared, setCleared] = useState(false);
  const clearedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearBoard = () => {
    if (doc.items.length === 0) return;
    apply({ type: 'wb/clear' });
    setCleared(true);
    if (clearedTimer.current) clearTimeout(clearedTimer.current);
    clearedTimer.current = setTimeout(() => setCleared(false), CLEARED_MS);
  };
  useEffect(() => () => {
    if (clearedTimer.current) clearTimeout(clearedTimer.current);
  }, []);
  useEffect(() => {
    if (cleared && doc.items.length > 0) setCleared(false);
  }, [cleared, doc.items.length]);
  const undoRef = useRef(undoWithLog);
  undoRef.current = undoWithLog;
  useEffect(() => {
    if (!cleared) return undefined;
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isEditableTarget(event.target)) return;
      /* Only a board on screen takes the page's Ctrl+Z: not one folded away behind a hidden pane (review N4). */
      const root = rootRef.current;
      if (!root || !root.isConnected || root.closest('[hidden], [inert], [aria-hidden="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoRef.current();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [cleared]);

  /* THE PILL SITS ON WHOLE PIXELS. Centring it with flex puts its left edge on a
     half pixel whenever the board and the pill differ by an odd width, and every
     glyph inside lands at x + 0.5. The left margin is rounded here instead. */
  const pillRef = useRef<HTMLDivElement | null>(null);
  const [pillLeft, setPillLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const pill = pillRef.current;
    const host = pill?.parentElement;
    if (!pill || !host || typeof ResizeObserver === 'undefined') return undefined;
    const place = () => {
      const pad = parseFloat(getComputedStyle(host).paddingLeft) || 0;
      const inner = host.clientWidth - pad * 2;
      const wide = pill.offsetWidth;
      const left = pillLeftFor(inner, wide, host.getBoundingClientRect().left + pad, window.devicePixelRatio || 1);
      setPillLeft((was) => (was === left ? was : left));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(host);
    ro.observe(pill);
    return () => ro.disconnect();
  }, []);

  const shapeTools = ['rect', 'ellipse', 'line', 'arrow'] as const;
  const annotateTools = ['text', 'sticky', 'link'] as const;
  const shapeActive = shapeTools.includes(tool as (typeof shapeTools)[number]);
  const annotateActive = annotateTools.includes(tool as (typeof annotateTools)[number]);

  return (
    <div
      className="wb-scope wb"
      data-testid="whiteboard"
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onBoardKey}
      onPointerEnter={() => {
        pointerOver.current = true;
      }}
      onPointerLeave={() => {
        pointerOver.current = false;
      }}
    >
      {/* ONE FLOATING PILL, ONE LINE (owner 2026-10-09: no block above the
          board; "I like the bar. Make it transparent. Simplify."). Select, Draw,
          Shapes, Text, Erase | Undo, Fit | More | Ask. Pan is not a button
          (Space-hold and an empty-board drag pan); Reset view and Clear board
          live in More, which is always there. Under 520px of the board's own
          width Undo and Fit fold into More too, never into a second row. The
          architecture board's dock glass: a light translucent fill and a
          hairline edge. */}
      <div className="wb-furniture">
        <div
          className="wb-tools"
          data-testid="wb-tools"
          role="toolbar"
          aria-label="Spaces tools"
          ref={pillRef}
          style={pillLeft === null ? undefined : { marginLeft: pillLeft, marginRight: 'auto' }}
        >
          {(['select', 'draw'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className="wb-tool"
              data-testid={`wb-tool-${t}`}
              aria-pressed={tool === t}
              data-on={tool === t ? 'true' : 'false'}
              data-locked={lockedTool === t ? 'true' : undefined}
              onClick={() => setTool(t)}
              onDoubleClick={() => lockTool(t)}
              aria-label={TOOL_LABEL[t]}
              title={toolTitle(t)}
            >
              <WbIcon name={TOOL_ICON[t]} />
            </button>
          ))}

          {/* Shapes + annotate as dropdowns: expandable features rather than an
              icon dump of every tool at once (2026-08-25). */}
          <WbToolMenu
            testId="wb-shapes"
            label="Shapes"
            icon={shapeActive ? TOOL_ICON[tool] : TOOL_ICON[lastShape]}
            active={shapeActive}
            tools={shapeTools}
            current={tool}
            last={lastShape}
            locked={lockedTool}
            onPick={setTool}
            onLock={lockTool}
          />
          <WbToolMenu
            testId="wb-annotate"
            label="Text"
            icon={annotateActive ? TOOL_ICON[tool] : TOOL_ICON[lastAnnotate]}
            active={annotateActive}
            tools={annotateTools}
            current={tool}
            last={lastAnnotate}
            locked={lockedTool}
            onPick={setTool}
            onLock={lockTool}
          />
          <WbColorMenu
            color={penColor}
            /* Fill is offered for what the store keeps a fill on: a shape. A sticky's `fill` is dropped by the text kind. */
            fillable={selectedItem?.kind !== 'text'}
            canTint={selectedItem !== undefined && selectedItem.kind === 'shape'}
            tinted={selectedItem?.fill !== undefined && selectedItem.fill !== 'none'}
            onPick={(c) => {
              setPenColor(c);
              if (selected) apply({ type: 'wb/style', id: selected, stroke: c });
            }}
            onTint={() => {
              if (!selected || !selectedItem) return;
              apply({ type: 'wb/style', id: selected, fill: selectedItem.fill && selectedItem.fill !== 'none' ? null : 'surface' });
            }}
          />
          <button
            type="button"
            className="wb-tool wb-opt2"
            data-testid="wb-tool-erase"
            aria-pressed={tool === 'erase'}
            data-on={tool === 'erase' ? 'true' : 'false'}
            onClick={() => setTool('erase')}
            aria-label={TOOL_LABEL.erase}
            title={toolTitle('erase')}
          >
            <WbIcon name={TOOL_ICON.erase} />
          </button>

          <span className="wb-sep wb-opt" aria-hidden="true" />
          <button
            type="button"
            className="wb-tool wb-opt"
            data-testid="wb-undo"
            aria-label="Undo"
            title="Undo"
            disabled={past.length === 0}
            onClick={undo}
          >
            <WbIcon name="undo" />
          </button>
          <button
            type="button"
            className="wb-tool wb-opt"
            data-testid="wb-fit"
            aria-label="Fit to drawing"
            title="Fit to drawing"
            disabled={doc.items.length === 0}
            onClick={fit}
          >
            <WbIcon name="fit" />
          </button>
          <span className="wb-sep" aria-hidden="true" />

          {/* The rare actions live here at every width; Undo and Fit join them when the board is narrow. */}
          <span className="wb-morewrap" ref={more.wrap} onKeyDown={more.onKeyDown}>
            <button
              type="button"
              className="wb-tool"
              data-testid="wb-more"
              data-erase={tool === 'erase' ? 'true' : undefined}
              aria-haspopup="menu"
              aria-expanded={more.open}
              aria-label="More"
              title="More"
              ref={more.trigger}
              onClick={() => more.setOpen((was) => !was)}
            >
              <WbIcon name="more" />
            </button>
            {more.open ? (
              <div className="wb-menu wb-more-menu" role="menu" data-testid="wb-more-menu">
                {(
                  [
                    ['erase', 'Eraser', 'erase', false, () => setTool('erase'), 'wb-fold2'],
                    ['undo', 'Undo', 'undo', past.length === 0, undo, 'wb-fold'],
                    ['fit', 'Fit to drawing', 'fit', doc.items.length === 0, fit, 'wb-fold'],
                    ['reset', 'Reset view', 'reset', view.x === 0 && view.y === 0 && view.zoom === 1, resetView, ''],
                    ['group', 'Group', 'group', group.length < 2, groupSelection, ''],
                    ['ungroup', 'Ungroup', 'group', selectedItem?.group === undefined, ungroupSelection, ''],
                    ['scene', 'Add scene', 'scene', false, addScene, ''],
                    ['grid', 'Show grid', 'grid', false, () => writeGridEnabled(!gridOn), ''],
                    ['clear', 'Clear board', 'trash', doc.items.length === 0, clearBoard, ''],
                  ] as const
                ).map(([id, text, icon, off, run, fold]) => (
                  <button
                    key={id}
                    type="button"
                    role={id === 'grid' ? 'menuitemcheckbox' : 'menuitem'}
                    aria-checked={id === 'grid' ? gridOn : undefined}
                    className={`wb-menuitem${fold ? ` ${fold}` : ''}${id === 'clear' ? ' wb-menuitem-danger' : ''}`}
                    data-testid={`wb-more-${id}`}
                    disabled={off}
                    onClick={() => {
                      run();
                      more.close();
                    }}
                  >
                    <WbIcon name={icon} />
                    <span>{text}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </span>

          {onAsk ? (
            <button
              type="button"
              className="wb-tool wb-tool-solid"
              data-testid="wb-ask"
              aria-label="Ask about this"
              title="Ask about this"
              /* NEVER DISABLED (0.1.5). It used to be disabled on any board with no
                 words on it, which is every board of boxes and arrows: a greyed
                 pill that looked like decoration and could not be clicked. The
                 panel it opens decides what can be sent. */
              aria-expanded={asking}
              aria-controls={asking ? 'wb-ask-panel' : undefined}
              onClick={() => setAsking((was) => !was)}
            >
              Ask
            </button>
          ) : null}
        </div>
      </div>

      {/* `data-tool` is on the canvas because the cursor over a mark depends
          on which tool is active, and CSS cannot ask React what that is. */}
      <svg
        ref={svgRef}
        className="wb-canvas"
        data-testid="wb-canvas"
        data-tool={tool}
        data-grid={gridOn ? 'true' : 'false'}
        data-space-pan={spaceHeld ? 'true' : undefined}
        data-panning={panFrom ? 'true' : undefined}
        /* The field moves with the camera, exactly as the architecture board's does. */
        style={
          {
            '--board-cam-x': `${view.x}px`,
            '--board-cam-y': `${view.y}px`,
            '--board-cam-z': view.zoom,
            '--board-field-step': fieldDots(view.zoom).step,
            '--board-field-fade': fieldDots(view.zoom).fade,
          } as CSSProperties
        }
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onWheel={onWheel}
      >
        {/* The dotted ground is the canvas's own CSS background (whiteboard.css
            .wb-canvas): centred on the board, so the margins left and right
            match and no dot is cut by an edge. It says which surface this is
            before anything is drawn on it. */}

        {/* ONE TRANSFORM FOR THE WHOLE DRAWING. Applying the camera per item
            would mean every item recomputing it, and a stroke and its own
            draft could disagree mid-gesture. The grid above stays outside it
            so the paper does not zoom with the ink. */}
        <g
          data-testid="wb-viewport"
          transform={`translate(${view.x},${view.y}) scale(${view.zoom})`}
        >

        {shownItems
          .filter((item) => item.kind !== 'artifact' || !artifactIds || artifactIds.has(item.id))
          .map((item) => (
          <WbItemView
            key={item.id}
            item={resizing?.id === item.id && resizeTo && item.kind === 'svg' ? { ...item, w: resizeTo.w, h: resizeTo.h } : item}
            pose={poses.get(item.id)}
            sceneUi={
              item.kind === 'scene'
                ? {
                    t: sceneT[item.id] ?? 0,
                    playing: playing === item.id,
                    armed: armed === item.id,
                    note: sceneNote?.id === item.id ? sceneNote.text : null,
                    onToggle: () => toggleScene(item),
                    onScrubStart: (event, x0, w) => {
                      event.stopPropagation();
                      (event.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(event.pointerId);
                      setPlaying(null);
                      setArmed(item.id);
                      setScrubbing({ id: item.id, x0, w });
                      setSceneT((m) => ({ ...m, [item.id]: clampTime(((pointOf(event).x - x0) / w) * safeDuration(item.duration), safeDuration(item.duration)) }));
                    },
                    onExport: (how) => void exportScene(item, how),
                  }
                : undefined
            }
            onResizeStart={
              tool === 'select' && item.kind === 'svg' && item.id === selected
                ? (event) => {
                    event.stopPropagation();
                    (event.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(event.pointerId);
                    setResizing({ id: item.id, from: pointOf(event), w: item.w, h: item.h });
                    setResizeTo(null);
                  }
                : undefined
            }
            boxLabel={composed.labels.get(item.id)}
            edgeLabel={composed.edgeLabels.get(item.id)}
            noteLines={composed.noteLines.get(item.id)}
            arrival={arrivals.get(item.id)}
            newestBatch={arrivalBatch.current}
            selected={item.id === selected || group.includes(item.id)}
            offset={item.id === selected || (selectedGroup !== null && item.group === selectedGroup) ? dragBy : null}
            renderArtifact={renderArtifact}
            onResizeArtifact={resizeArtifact}
            onPress={
              tool === 'select' && !spaceHeld
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
                    if (item.kind === 'scene') setArmed(item.id);
                    /* A mark in a group is selected, and will be dragged, with the rest of its diagram. */
                    if (item.group) setGroup(shownItems.filter((o) => o.group === item.group).map((o) => o.id));
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

        {(intentGhosts ?? []).map((g) => (
          <rect
            key={`ghost-${g.id}`}
            data-testid="wb-intent-ghost"
            className="wb-intent-ghost"
            x={g.at.x}
            y={g.at.y}
            width={40}
            height={24}
            rx={2}
          />
        ))}

        {draftPath ? <path className="wb-ink wb-draft" d={draftPath} /> : null}
        {marquee ? (
          <rect
            data-testid="wb-marquee"
            className="wb-marquee"
            x={Math.min(marquee.from.x, marquee.to.x)}
            y={Math.min(marquee.from.y, marquee.to.y)}
            width={Math.abs(marquee.to.x - marquee.from.x)}
            height={Math.abs(marquee.to.y - marquee.from.y)}
          />
        ) : null}
        {offers.map((o) => (
          <SnapGhost key={o.strokeIds.join('+')} offer={o} />
        ))}
        </g>
      </svg>

      {/* ── THE TIDY-UP OFFER, AND ITS UNDO ───────────────────────────────
          Quiet by design: one small chip beside the shape, nothing modal, no
          focus taken. Enter takes it, Escape or the cross keeps the ink as
          drawn, and a new stroke simply moves on. After it is taken the same
          place says "Tidied" with an Undo that is Ctrl+Z. */}
      {offers.slice(0, 1).map((o) => {
        const at = screenPoint(view, { x: Math.max(o.from.x, o.to.x), y: Math.min(o.from.y, o.to.y) });
        const words = SNAP_WORDS[o.decision];
        return (
          <div
            key={o.strokeIds.join('+')}
            className="wb-snap"
            data-testid="wb-snap-offer"
            data-shape={o.decision}
            role="group"
            aria-label={`Tidy this into ${words.noun === 'arrow' ? 'an' : 'a'} ${words.noun}`}
            style={{ left: Math.max(at.x, 160), top: Math.max(at.y, 52) }}
          >
            <button
              type="button"
              className="s2-chipbtn"
              data-testid="wb-snap-accept"
              onClick={() => {
                clearOffers('taken');
                takeOffer(o, 'snap-accepted');
              }}
            >
              Tidy to {words.noun === 'arrow' ? 'an' : 'a'} {words.noun}
              <kbd className="s2-kbd">Enter</kbd>
            </button>
            <button
              type="button"
              className="s2-ibtn s2-ibtn-sm"
              data-testid="wb-snap-dismiss"
              aria-label="Keep it as drawn"
              title="Keep it as drawn (Esc)"
              onClick={() => clearOffers('x')}
            >
              <S2Icon name="x" small />
            </button>
          </div>
        );
      })}
      {cleared ? (
        <div className="wb-snap wb-snap-done" data-testid="wb-cleared" role="status">
          <button type="button" className="s2-chipbtn" data-testid="wb-cleared-undo" onClick={() => undoWithLog()}>
            <span>Board cleared</span>
            <span>Undo</span>
            <kbd className="s2-kbd">Ctrl Z</kbd>
          </button>
        </div>
      ) : null}
      {tidied ? (
        <div className="wb-snap wb-snap-done" data-testid="wb-snap-done" role="status">
          <button type="button" className="s2-chipbtn" data-testid="wb-snap-undo" onClick={undoWithLog}>
            <span className="wb-sr">Tidied to {tidied.noun === 'arrow' ? 'an' : 'a'} {tidied.noun}.</span>
            <span>Undo tidy</span>
            <kbd className="s2-kbd">Ctrl Z</kbd>
          </button>
        </div>
      ) : null}
      <span className="wb-sr" role="status" aria-live="polite">
        {offers[0]
          ? `Offer: tidy this into ${SNAP_WORDS[offers[0].decision].noun === 'arrow' ? 'an' : 'a'} ${SNAP_WORDS[offers[0].decision].noun}. Press Enter to accept or Escape to keep it as drawn.`
          : ''}
      </span>

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
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setEditing({ id: editing.id, text: event.target.value })}
            onKeyDown={(event) => {
              /* A sticky still blank when the editor closes was never written:
                 it goes, rather than staying as an empty card. */
              const blankSticky = () => {
                const it = doc.items.find((i) => i.id === editing.id);
                return it?.kind === 'text' && it.sticky === true && it.text === '' && editing.text.trim() === '';
              };
              if (event.key === 'Escape') {
                if (blankSticky()) apply({ type: 'wb/delete', id: editing.id });
                setEditing(null);
              }
              if (event.key === 'Enter' && blankSticky()) {
                apply({ type: 'wb/delete', id: editing.id });
                setEditing(null);
                return;
              }
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
                ? 'No project is attached, so there is nothing to point at.'
                : 'Nothing in this project is called that.'}
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
        <div
          className="wb-askpanel chat-scope"
          id="wb-ask-panel"
          data-testid="wb-ask-panel"
          role="dialog"
          aria-label="Ask about this board"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setAsking(false);
            }
          }}
        >
          {/* THE CHAT COMPOSER'S OWN BOX AND BUTTONS (chat.css, under `.chat-scope`): the words on top, then one row
              with the close X where the composer's + sits and Send where its send sits. Enter sends, Shift+Enter
              breaks the line, as in the composer. */}
          <span className="wb-label" id="wb-ask-label">
            {askPanelLine(canAnswer)}
          </span>
          <div className={`composer${askFocused ? ' focused' : ''}`}>
            <textarea
              className="field wb-ask-field"
              data-testid="wb-ask-note"
              aria-labelledby="wb-ask-label"
              rows={2}
              autoFocus
              value={askNote}
              onChange={(event) => setAskNote(event.target.value)}
              onFocus={() => setAskFocused(true)}
              onBlur={() => setAskFocused(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  sendAsk();
                }
              }}
              placeholder="Add a note (optional)"
            />
            <div className="ctrls wb-askactions">
              <button
                type="button"
                className="plusbtn"
                data-testid="wb-ask-cancel"
                aria-label="Close"
                title="Close (Esc)"
                onClick={() => setAsking(false)}
              >
                <Icon name="x" />
              </button>
              <button
                type="button"
                className="sendbtn"
                data-testid="wb-ask-send"
                aria-label="Put it in the chat box"
                title="Put it in the chat box"
                disabled={!askableFrom(doc, askNote)}
                onClick={sendAsk}
              >
                <Icon name="send" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {ask.layer}

      {empty ? (
        <p className="wb-empty" data-testid="wb-empty">
          Draw, or ask to sketch something
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
const TOOL_ICON: Record<WbTool, WbGlyph> = {
  select: 'select',
  /* Pan has no button (Space and an empty-board drag pan); H still picks it. */
  pan: 'select',
  draw: 'draw',
  rect: 'rect',
  ellipse: 'ellipse',
  line: 'line',
  arrow: 'arrow',
  text: 'text',
  sticky: 'sticky',
  link: 'link',
  erase: 'erase',
};

/** Single-letter shortcuts. Link has none (L is the line, as in Figma/Miro). */
const TOOL_KEY: Partial<Record<WbTool, string>> = {
  select: 'V',
  pan: 'H',
  draw: 'P',
  rect: 'R',
  ellipse: 'O',
  line: 'L',
  arrow: 'A',
  text: 'T',
  sticky: 'S',
  erase: 'E',
};

export const WB_DEFAULT_TOOL: WbTool = 'select';

const WB_TOOL_KEYS: Record<string, WbTool> = Object.fromEntries(
  (Object.entries(TOOL_KEY) as [WbTool, string][]).map(([tool, key]) => [key.toLowerCase(), tool]),
);

function toolTitle(tool: WbTool): string {
  const key = TOOL_KEY[tool];
  return key ? `${TOOL_LABEL[tool]} (${key})` : TOOL_LABEL[tool];
}

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
  sticky: 'Sticky note',
  erase: 'Erase',
};

/** One grouped tool menu — shapes or annotate — instead of dumping every glyph. */
/**
 * The keyboard and pointer contract shared by the pill's menus (Shapes, Text,
 * More): Escape closes and puts focus back on the trigger, a press outside
 * closes, Arrow Up and Down, Home and End move focus between the items (Arrow
 * Down on the trigger opens it), and running an item returns focus to the
 * trigger.
 */
function useMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const focusFirst = useRef(false);
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('mousedown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('mousedown', outside);
    };
  }, [open]);
  /* THE MENU STAYS INSIDE THE BOARD (0.1.5). It is centred on its trigger, which on a narrow board put its left edge
     past the board's own edge. Measured before paint: centred if it fits, else pushed in to an 8px margin, with the
     left edge rounded to a whole device pixel so the rows' text lands on the pixel grid. */
  useLayoutEffect(() => {
    if (!open) return;
    const host = wrap.current;
    const menu = host?.querySelector<HTMLElement>('.wb-menu');
    const scope = host?.closest<HTMLElement>('.wb-scope');
    if (!host || !menu || !scope) return;
    const dpr = window.devicePixelRatio || 1;
    const edge = 8;
    const at = host.getBoundingClientRect();
    const board = scope.getBoundingClientRect();
    const width = menu.offsetWidth;
    const ideal = at.left + at.width / 2 - width / 2;
    const least = board.left + edge;
    const most = board.right - edge - width;
    const left = Math.round(Math.max(least, Math.min(ideal, Math.max(least, most))) * dpr) / dpr;
    menu.style.translate = 'none';
    menu.style.left = `${left - at.left}px`;
  }, [open]);
  useEffect(() => {
    if (open && focusFirst.current) {
      focusFirst.current = false;
      wrap.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    }
  }, [open]);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusFirst.current = true;
        setOpen(true);
      }
      return;
    }
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (at + 1) % items.length
            : (at <= 0 ? items.length : at) - 1;
    items[next]!.focus();
  };
  return { open, setOpen, wrap, trigger, close, onKeyDown };
}

function WbToolMenu({
  testId,
  label,
  icon,
  active,
  tools,
  current,
  last,
  locked,
  onPick,
  onLock,
}: {
  testId: string;
  label: string;
  icon: WbGlyph;
  active: boolean;
  tools: readonly WbTool[];
  current: WbTool;
  /** The tool the glyph picks with one click: the last one used from this list (0.1.8.1 C6). */
  last: WbTool;
  locked: WbTool | null;
  onPick: (tool: WbTool) => void;
  /** A double-click keeps the tool after a shape (0.1.8.1 C6). */
  onLock: (tool: WbTool) => void;
}) {
  const { open, setOpen, wrap, trigger, close, onKeyDown } = useMenu();
  return (
    <span className="wb-menuwrap" data-testid={testId} ref={wrap} onKeyDown={onKeyDown}>
      {/* The glyph is the last tool used from the list, one click to pick it (audit P2-1: "two clicks"); the chevron
          beside it opens the list. Two controls, one look: the pair is the same width the single trigger was. */}
      <button
        type="button"
        className="wb-tool wb-tool-split"
        data-testid={`${testId}-main`}
        aria-pressed={active}
        data-on={active ? 'true' : 'false'}
        data-locked={locked !== null && locked === current && active ? 'true' : undefined}
        aria-label={TOOL_LABEL[last]}
        title={`${toolTitle(last)}. Double-click to keep it`}
        onClick={() => onPick(last)}
        onDoubleClick={() => onLock(last)}
      >
        <WbIcon name={icon} />
      </button>
      <button
        type="button"
        className="wb-tool wb-tool-chev"
        data-testid={`${testId}-trigger`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        ref={trigger}
        onClick={() => setOpen((was) => !was)}
      >
        {/* On a narrow board the glyph button folds away and this one carries the glyph, as the single trigger did
            (whiteboard.css: the pill keeps its 240 px budget). */}
        <WbIcon name={icon} className="wb-chev-glyph" />
        <WbIcon name="caret" className="wb-caret" />
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
              title={toolTitle(t)}
              onClick={() => {
                onPick(t);
                close();
              }}
            >
              <WbIcon name={TOOL_ICON[t]} />
              <span>{TOOL_LABEL[t]}</span>
              {TOOL_KEY[t] ? <kbd className="wb-kbd">{TOOL_KEY[t]}</kbd> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** The pen colour: a swatch trigger and the palette's names, in the same menu rows as the shape and text menus. */
function WbColorMenu({
  color,
  fillable,
  canTint,
  tinted,
  onPick,
  onTint,
}: {
  color: WbColor;
  fillable: boolean;
  canTint: boolean;
  tinted: boolean;
  onPick: (color: WbColor) => void;
  onTint: () => void;
}) {
  const { open, setOpen, wrap, trigger, close, onKeyDown } = useMenu();
  return (
    <span className="wb-menuwrap" data-testid="wb-color" ref={wrap} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="wb-tool wb-tool-menu"
        data-testid="wb-color-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Colour: ${WB_COLOR_LABEL[color]}`}
        title={`Colour: ${WB_COLOR_LABEL[color]}`}
        ref={trigger}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="wb-swatch" data-color={color} aria-hidden="true" />
        <WbIcon name="caret" className="wb-caret" />
      </button>
      {open ? (
        <div className="wb-menu" role="menu" data-testid="wb-color-menu">
          {WB_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              className="wb-menuitem"
              data-testid={`wb-color-${c}`}
              aria-checked={color === c}
              /* Every swatch is named, by its menu row and its tooltip (0.1.8.1 C9, audit P2-10). */
              aria-label={WB_COLOR_LABEL[c]}
              title={WB_COLOR_LABEL[c]}
              onClick={() => {
                onPick(c);
                close();
              }}
            >
              <span className="wb-swatch" data-color={c} aria-hidden="true" />
              <span>{WB_COLOR_LABEL[c]}</span>
            </button>
          ))}
          {fillable ? (
          <button
            type="button"
            role="menuitemcheckbox"
            className="wb-menuitem"
            data-testid="wb-color-tint"
            aria-checked={tinted}
            aria-label={`Fill with ${WB_COLOR_LABEL[color]}`}
            title={`Fill with ${WB_COLOR_LABEL[color]}`}
            disabled={!canTint}
            onClick={() => {
              onTint();
              close();
            }}
          >
            <span className="wb-swatch" data-color={color} data-tint="true" aria-hidden="true" />
            <span>Fill</span>
          </button>
          ) : null}
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
export function itemBounds(item: WbItem): { x: number; y: number; w: number; h: number } | null {
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
      const xs = [item.from.x, item.to.x, ...(item.points ?? []).map((p) => p.x)];
      const ys = [item.from.y, item.to.y, ...(item.points ?? []).map((p) => p.y)];
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return {
        x,
        y,
        w: Math.max(1, Math.max(...xs) - x),
        h: Math.max(1, Math.max(...ys) - y),
      };
    }
    case 'text':
      if (item.sticky) return { x: item.at.x, y: item.at.y, w: item.w ?? STICKY_W, h: item.h ?? STICKY_H };
      return { x: item.at.x - 4, y: item.at.y - 14, w: 80, h: 20 };
    case 'noderef':
      return { x: item.at.x - 4, y: item.at.y - 14, w: 80, h: 20 };
    case 'artifact':
      return { x: item.at.x, y: item.at.y, w: item.size.w, h: item.size.h };
    case 'svg':
    case 'scene':
    case 'video':
      return { x: item.at.x, y: item.at.y, w: item.w, h: item.h };
  }
}

/** The four corners of a diamond inside the box x,y,w,h. */
function diamondPoints(x: number, y: number, w: number, h: number): string {
  return `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`;
}

/** What the offer would become, drawn dashed over the raw ink (never over the pointer). */
function SnapGhost({ offer }: { offer: SnapOffer }) {
  const x = Math.min(offer.from.x, offer.to.x);
  const y = Math.min(offer.from.y, offer.to.y);
  const w = Math.abs(offer.to.x - offer.from.x);
  const h = Math.abs(offer.to.y - offer.from.y);
  const props = { className: 'wb-sel-halo', 'data-testid': 'wb-snap-ghost', 'data-shape': offer.decision, fill: 'none', pointerEvents: 'none' as const };
  if (offer.decision === 'rect') return <rect {...props} x={x} y={y} width={w} height={h} rx={8} />;
  if (offer.decision === 'ellipse') return <ellipse {...props} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />;
  if (offer.decision === 'diamond') return <polygon {...props} points={diamondPoints(x, y, w, h)} strokeLinejoin="round" />;
  return <line {...props} x1={offer.from.x} y1={offer.from.y} x2={offer.to.x} y2={offer.to.y} />;
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

/**
 * Measure content and grow the artifact frame so foreignObject does not clip
 * MD/JSON/charts on the freeform plane (owner walk 2026-09-16).
 */
function ArtifactFitBody({
  itemId,
  size,
  onResize,
  children,
}: {
  itemId: string;
  size: { w: number; h: number };
  onResize?: (id: string, w: number, h: number) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const last = useRef({ w: size.w, h: size.h });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !onResize) return;

    const measure = () => {
      const contentW = Math.ceil(Math.max(el.scrollWidth, el.offsetWidth));
      const contentH = Math.ceil(Math.max(el.scrollHeight, el.offsetHeight));
      const w = Math.max(120, contentW + 8);
      const h = Math.max(80, contentH + 8);
      if (Math.abs(w - last.current.w) < 6 && Math.abs(h - last.current.h) < 6) return;
      last.current = { w, h };
      onResize(itemId, w, h);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [itemId, onResize, children]);

  return (
    <div className="wb-artifact-body" data-testid="wb-artifact-body" ref={ref}>
      {children}
    </div>
  );
}

/** The words inside a box: centred, one tspan per wrapped line. */
function BoxLabel({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: WbBoxLabel }) {
  const cx = x + w / 2;
  const top = y + h / 2 - ((label.lines.length - 1) * WB_BOX_LINE) / 2;
  return (
    <text
      className={`wb-label wb-box-label${label.kind === 'ref' ? ' wb-box-label-ref' : ''}`}
      data-testid="wb-label"
      textAnchor="middle"
      dominantBaseline="central"
    >
      {label.lines.map((line, i) => (
        <tspan key={i} x={cx} y={top + i * WB_BOX_LINE} data-testid="wb-label-line">
          {line}
        </tspan>
      ))}
    </text>
  );
}

/** How one live-arrived mark animates: its stagger delay, its batch, and whether it draws (a connector) or pops (a box). */
export interface WbArrival {
  delay: number;
  batch: number;
  draws: boolean;
}

const isConnector = (item: WbItem): boolean =>
  item.kind === 'stroke' || (item.kind === 'shape' && (item.shape === 'line' || item.shape === 'arrow'));

/**
 * The stagger for one batch of arrivals, in flow order. The agent sends the
 * boxes in the order the flow reads, so the box index IS the flow position;
 * connectors are spread across the same span so each lands between the boxes
 * it joins rather than all after the last one. Pure, so it is testable.
 */
export function planArrival(items: readonly WbItem[], batch: number): Map<string, WbArrival> {
  const boxes = items.filter((i) => !isConnector(i));
  const lines = items.filter(isConnector);
  const step = Math.max(40, Math.min(110, Math.round(900 / Math.max(boxes.length, 1))));
  const span = boxes.length * step;
  const plan = new Map<string, WbArrival>();
  boxes.forEach((i, n) => plan.set(i.id, { delay: n * step, batch, draws: false }));
  lines.forEach((i, n) =>
    plan.set(i.id, { delay: 160 + Math.round(((n + 1) / (lines.length + 1)) * span), batch, draws: true }),
  );
  return plan;
}

const FRAME_BAND = 36;

/** What the player on a scene needs from the board. */
interface SceneUi {
  t: number;
  playing: boolean;
  armed: boolean;
  note: string | null;
  onToggle: () => void;
  onScrubStart: (event: React.PointerEvent, trackX: number, trackW: number) => void;
  onExport: (how: 'copy' | 'save') => void;
}

/** The colours and words a scene has given an item at its playhead, laid over the item as stored. */
function withPose(item: WbItem, pose: Pose | undefined): WbItem {
  if (!pose || (pose.stroke === undefined && pose.fill === undefined && pose.text === undefined)) return item;
  const next = { ...item } as Record<string, unknown>;
  if (pose.stroke !== undefined) {
    if (item.kind === 'text') next.color = pose.stroke;
    else next.stroke = pose.stroke;
  }
  if (pose.fill !== undefined) next.fill = pose.fill;
  if (pose.text !== undefined) {
    if (item.kind === 'text') next.text = pose.text;
    else if (item.kind === 'shape') next.label = pose.text;
  }
  return next as unknown as WbItem;
}

const BAR_H = 32;
const BTN_W = 44;

/**
 * THE SCENE ON THE BOARD: a dashed stage frame with its title, and under it the player: play and pause, a scrubber with
 * a tick for each keyframe and the playhead, the time, and the two exports. Buttons are SVG groups with a role and a
 * name; none is a new look (the board's own pill colours, whiteboard.css).
 */
function SceneStageView({ item, ui, selected }: { item: WbScene; ui: SceneUi; selected: boolean }) {
  const barY = item.at.y + item.h + 10;
  const trackX = item.at.x + 40;
  const timeW = 84;
  const trackW = Math.max(40, item.w - 40 - timeW - BTN_W * 2 - 16);
  const frac = Math.min(1, Math.max(0, ui.t / safeDuration(item.duration)));
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const press = (run: () => void) => ({
    role: 'button' as const,
    tabIndex: 0,
    onPointerDown: stop,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      run();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        run();
      }
    },
  });
  const exportX = trackX + trackW + timeW + 8;
  return (
    <g
      data-testid="wb-scene"
      data-playing={ui.playing ? 'true' : 'false'}
      data-armed={ui.armed ? 'true' : 'false'}
      data-t={Math.round(ui.t)}
    >
      <rect
        className="wb-scene-frame"
        data-testid="wb-item"
        data-kind="scene"
        data-selected={selected ? 'true' : 'false'}
        x={item.at.x}
        y={item.at.y}
        width={item.w}
        height={item.h}
        rx={10}
      />
      <rect className="wb-hit" x={item.at.x} y={item.at.y} width={item.w} height={FRAME_BAND} fill="transparent" />
      <text className="wb-scene-title" x={item.at.x + 14} y={item.at.y + FRAME_BAND / 2} dominantBaseline="central">
        {item.title ?? 'Scene'}
      </text>
      <g className="wb-scene-bar">
        <rect className="wb-scene-bar-back" x={item.at.x} y={barY} width={item.w} height={BAR_H} rx={8} />
        <g data-testid="wb-scene-play" aria-label={ui.playing ? 'Pause' : 'Play'} {...press(ui.onToggle)}>
          <rect className="wb-scene-btn" x={item.at.x + 4} y={barY + 4} width={28} height={BAR_H - 8} rx={6} />
          {ui.playing ? (
            <path className="wb-scene-glyph" d={`M${item.at.x + 13},${barY + 11} v10 M${item.at.x + 22},${barY + 11} v10`} />
          ) : (
            <polygon className="wb-scene-glyph wb-scene-glyph-fill" points={`${item.at.x + 13},${barY + 10} ${item.at.x + 23},${barY + 16} ${item.at.x + 13},${barY + 22}`} />
          )}
        </g>
        <g data-testid="wb-scene-track" onPointerDown={(e) => ui.onScrubStart(e, trackX, trackW)}>
          <rect className="wb-scene-track" x={trackX} y={barY + BAR_H / 2 - 3} width={trackW} height={6} rx={3} />
          <rect className="wb-scene-progress" x={trackX} y={barY + BAR_H / 2 - 3} width={trackW * frac} height={6} rx={3} />
          {item.keyframes.map((k, i) => (
            <line
              key={`${k.target}:${k.t}:${i}`}
              className="wb-scene-tick"
              data-testid="wb-scene-tick"
              data-t={k.t}
              x1={trackX + (Math.min(k.t, safeDuration(item.duration)) / safeDuration(item.duration)) * trackW}
              x2={trackX + (Math.min(k.t, safeDuration(item.duration)) / safeDuration(item.duration)) * trackW}
              y1={barY + 6}
              y2={barY + BAR_H - 6}
            />
          ))}
          <circle className="wb-scene-head" data-testid="wb-scene-head" cx={trackX + trackW * frac} cy={barY + BAR_H / 2} r={6} />
          <rect x={trackX} y={barY} width={trackW} height={BAR_H} fill="transparent" />
        </g>
        <text className="wb-scene-time" data-testid="wb-scene-time" x={trackX + trackW + 10} y={barY + BAR_H / 2} dominantBaseline="central">
          {formatTime(ui.t)} / {formatTime(safeDuration(item.duration))}
        </text>
        <g data-testid="wb-scene-copy" aria-label="Export as Remotion: copy the composition" {...press(() => ui.onExport('copy'))}>
          <rect className="wb-scene-btn" x={exportX} y={barY + 4} width={BTN_W} height={BAR_H - 8} rx={6} />
          <text className="wb-scene-btn-t" x={exportX + BTN_W / 2} y={barY + BAR_H / 2} textAnchor="middle" dominantBaseline="central">
            Copy
          </text>
        </g>
        <g data-testid="wb-scene-save" aria-label="Export as Remotion: save as a .tsx file" {...press(() => ui.onExport('save'))}>
          <rect className="wb-scene-btn" x={exportX + BTN_W + 4} y={barY + 4} width={BTN_W} height={BAR_H - 8} rx={6} />
          <text className="wb-scene-btn-t" x={exportX + BTN_W + 4 + BTN_W / 2} y={barY + BAR_H / 2} textAnchor="middle" dominantBaseline="central">
            Save
          </text>
        </g>
      </g>
      {ui.note ? (
        <text className="wb-scene-note" data-testid="wb-scene-note" x={item.at.x} y={barY + BAR_H + 16}>
          {ui.note}
        </text>
      ) : null}
    </g>
  );
}

/** A text's own look: an own-theme hex colour, and its size (sm 12, md 14, lg 17). */
function textStyle(item: Extract<WbItem, { kind: 'text' }>): CSSProperties | undefined {
  const hex = paint(item.color, item.ownTheme, false).hex;
  const style: CSSProperties = {};
  if (hex) style.fill = hex;
  if (item.fontSize) style.fontSize = FONT_PX[item.fontSize];
  return Object.keys(style).length > 0 ? style : undefined;
}

function stickyStyle(item: Extract<WbItem, { kind: 'text' }>): CSSProperties | undefined {
  const hex = paint(item.color, item.ownTheme, false).hex;
  const style: CSSProperties = {};
  if (hex) style.borderColor = hex;
  if (item.fontSize) style.fontSize = FONT_PX[item.fontSize];
  return Object.keys(style).length > 0 ? style : undefined;
}
const FONT_PX = { sm: 12, md: 14, lg: 17 } as const;
const fontPx = (size: 'sm' | 'md' | 'lg' | undefined, fallback: number): number => (size ? FONT_PX[size] : fallback);

/**
 * How a shape or stroke LOOKS, from the item's own fields (the backend's board-item contract): a named colour is the
 * data attribute the stylesheet maps to a token, an own-theme hex is an inline style, and width, dash and fill ride
 * beside them. Nothing here is css from the item: names are checked against the palette, a hex against a plain-hex test.
 */
export function shapeLook(item: WbShape | WbStroke): {
  'data-color': string | undefined;
  'data-fill': string | undefined;
  style: CSSProperties | undefined;
} {
  const line = paint(item.stroke ?? item.color, item.ownTheme, false);
  const fill = paint(item.fill, item.ownTheme, true);
  const style: CSSProperties = {};
  if (line.hex) style.stroke = line.hex;
  if (fill.hex) style.fill = fill.hex;
  if (item.kind === 'shape') {
    if (item.strokeWidth !== undefined && item.strokeWidth >= 1 && item.strokeWidth <= 8) style.strokeWidth = item.strokeWidth;
    if (item.dash === 'dashed') style.strokeDasharray = '6 4';
    if (item.dash === 'dotted') {
      style.strokeDasharray = '1.5 4';
      style.strokeLinecap = 'round';
    }
  }
  return { 'data-color': line.name, 'data-fill': fill.name, style: Object.keys(style).length > 0 ? style : undefined };
}

/** The end of a line, a path or an arrow: an arrow head, a dot, a bar, or nothing. `from` only gives the direction. */
function LineHead({
  kind,
  from,
  to,
  common,
  arrival,
}: {
  kind: 'none' | 'arrow' | 'dot' | 'bar';
  from: Point;
  to: Point;
  common: Record<string, unknown>;
  arrival: boolean;
}) {
  if (kind === 'none') return null;
  const base = common as { className: string };
  if (kind === 'arrow') {
    const d = arrowHead(from, to);
    return d ? <path {...(common as object)} className={`${base.className}${arrival ? ' wb-arrive-head' : ''}`} d={d} /> : null;
  }
  if (kind === 'dot') return <circle {...(common as object)} className={`${base.className} wb-head-fill`} data-head="dot" cx={to.x} cy={to.y} r={4} />;
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len === 0) return null;
  const px = -(to.y - from.y) / len;
  const py = (to.x - from.x) / len;
  return <line {...(common as object)} className={base.className} data-head="bar" x1={to.x + px * 7} y1={to.y + py * 7} x2={to.x - px * 7} y2={to.y - py * 7} />;
}

/** A shape label, where `labelPos` puts it (centre by default): inside for centre, beside the box for the rest. */
function ShapeLabel({ item, x, y, w, h }: { item: WbShape; x: number; y: number; w: number; h: number }) {
  const pos = item.labelPos ?? 'center';
  const at =
    pos === 'top'
      ? { x: x + w / 2, y: y - 10, anchor: 'middle' }
      : pos === 'bottom'
        ? { x: x + w / 2, y: y + h + 16, anchor: 'middle' }
        : pos === 'left'
          ? { x: x - 10, y: y + h / 2, anchor: 'end' }
          : pos === 'right'
            ? { x: x + w + 10, y: y + h / 2, anchor: 'start' }
            : { x: x + w / 2, y: y + h / 2, anchor: 'middle' };
  return (
    <text
      className="wb-shape-label"
      data-testid="wb-shape-label"
      data-pos={pos}
      x={at.x}
      y={at.y}
      textAnchor={at.anchor as 'start' | 'middle' | 'end'}
      dominantBaseline="central"
      style={{ fontSize: fontPx(item.fontSize, 13) }}
    >
      {item.label}
    </text>
  );
}

/**
 * ONE MARK, in three layers, each owning one thing:
 *   outer   the drag translate (an SVG attribute) and the pointer handlers;
 *   middle  the arrival animation (CSS transform, opacity, dash), only for a
 *           mark that arrived live;
 *   inner   the mark (WbItemBody).
 * The animation never shares a group with the drag translate: a CSS transform
 * on the same element overrides the attribute, so a box grabbed during its
 * arrival would freeze and then jump.
 */
function WbItemView(props: Parameters<typeof WbItemBody>[0]) {
  const { arrival, newestBatch = 0, offset = null, onPress, onEdit, onErase, pose } = props;
  /* A scene's pose (move, scale, fade) and a drag in progress are both transforms of the same group, drag first. */
  const move = offset ? `translate(${offset.x},${offset.y})` : undefined;
  const transform = [move, pose ? poseTransform(pose) : undefined].filter(Boolean).join(' ') || undefined;
  const body = <WbItemBody {...props} />;
  const arriveClass = arrival
    ? `wb-arrive ${arrival.draws ? 'wb-arrive-line' : 'wb-arrive-box'}${
        !arrival.draws && arrival.batch === newestBatch ? ' wb-pulse' : ''
      }`
    : undefined;
  return (
    <g
      data-item-id={props.item.id}
      transform={transform}
      opacity={pose && pose.opacity < 1 ? pose.opacity : undefined}
      onPointerDown={onPress}
      onDoubleClick={onEdit}
      onClick={onErase}
    >
      {arrival ? (
        <g className={arriveClass} style={{ '--wb-delay': `${arrival.delay}ms` } as CSSProperties}>
          {body}
        </g>
      ) : (
        body
      )}
    </g>
  );
}

function WbItemBody({
  item,
  boxLabel,
  edgeLabel,
  noteLines,
  arrival,
  selected = false,
  onErase,
  renderArtifact,
  onResizeArtifact,
  onResizeStart,
  sceneUi,
}: {
  item: WbItem;
  /** Where the scenes have taken this item (scene.ts). The transform is applied by WbItemView; here only for the type. */
  pose?: Pose | undefined;
  /** Supplied for a scene item: its playhead and the player's handlers. */
  sceneUi?: SceneUi | undefined;
  /** Supplied only for the selected hosted svg under the select tool: the corner handle starts a resize. */
  onResizeStart?: (event: React.PointerEvent) => void;
  /** What is drawn inside this shape, wrapped to it (`composeBoxes`). */
  boxLabel?: WbBoxLabel;
  /** Where this connector's label is drawn, clear of the boxes (agentLayout.ts). */
  edgeLabel?: EdgeLabelPlace | undefined;
  /** A long free note's wrapped lines. */
  noteLines?: string[] | undefined;
  /** Set only for a mark that arrived live in this session. */
  arrival?: WbArrival | undefined;
  /** The newest batch number: only its boxes pulse. */
  newestBatch?: number;
  selected?: boolean;
  /** How far the drag in progress has carried it. Nothing is written until release. */
  offset?: Point | null;
  onPress?: (event: React.PointerEvent) => void;
  /** Only ever supplied for a text item under the select tool. */
  onEdit?: () => void;
  onErase?: () => void;
  renderArtifact?: (item: Extract<WbItem, { kind: 'artifact' }>) => ReactNode;
  onResizeArtifact?: (id: string, w: number, h: number) => void;
}) {
  const common = {
    className: `wb-ink${onErase ? ' wb-erasable' : ''}`,
    'data-testid': 'wb-item',
    'data-kind': item.kind,
    /* PRESENT BOTH WAYS. An attribute that only appears when true cannot be
       read from outside without asking whether it is missing or false. */
    'data-selected': selected ? 'true' : 'false',
    /* Whose mark it is: the agent's are tinted (whiteboard.css). */
    'data-by': item.by ?? 'person',
  };

  /* The drag translate, the handlers and the arrival animation are NOT on this
     group (see WbItemView): this is the mark itself. */
  const groupProps = {};

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
        <path {...common} {...shapeLook(item)} pathLength={arrival ? 1 : undefined} d={toPath(item.points)} />
      </g>
    );
  }

  if (item.kind === 'shape') {
    const xs = [item.from.x, item.to.x, ...(item.points ?? []).map((p) => p.x)];
    const ys = [item.from.y, item.to.y, ...(item.points ?? []).map((p) => p.y)];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const h = Math.max(...ys) - y;
    const label = boxLabel ? <BoxLabel x={x} y={y} w={w} h={h} label={boxLabel} /> : null;
    const boxed = boxLabel !== undefined || item.id.endsWith(':box');
    const look = shapeLook(item);
    const own = { ...common, ...look };
    /* The words of a shape the box composer does not wrap (diamond, path): at the spot labelPos names. */
    const words =
      !boxLabel && item.label && item.shape !== 'line' && item.shape !== 'arrow' && item.shape !== 'frame' ? (
        <ShapeLabel item={item} x={x} y={y} w={w} h={h} />
      ) : null;
    if (item.shape === 'rect') {
      return (
        <g {...groupProps}>
          {halo}
          <rect {...own} className={`${common.className}${boxed ? ' wb-box' : ''}`} x={x} y={y} width={w} height={h} rx={8} />
          {label}
        </g>
      );
    }
    if (item.shape === 'frame') {
      /* A FRAME groups what lies inside it: an outline, no fill unless asked, and a 36px title band with its label. */
      return (
        <g {...groupProps}>
          {halo}
          <rect {...own} className={`${common.className} wb-frame`} data-shape="frame" x={x} y={y} width={w} height={h} rx={10} />
          <line {...own} className={`${common.className} wb-frame-band`} x1={x} y1={y + FRAME_BAND} x2={x + w} y2={y + FRAME_BAND} />
          {item.label ? (
            <text
              className="wb-shape-label"
              data-testid="wb-frame-title"
              data-color={own['data-color']}
              x={x + 14}
              y={y + FRAME_BAND / 2}
              dominantBaseline="central"
              style={{ fontSize: fontPx(item.fontSize, 14) }}
            >
              {item.label}
            </text>
          ) : null}
        </g>
      );
    }
    if (item.shape === 'ellipse') {
      return (
        <g {...groupProps}>
          {halo}
          <ellipse {...own} className={`${common.className}${boxed ? ' wb-box' : ''}`} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />
          {label}
        </g>
      );
    }
    if (item.shape === 'diamond') {
      return (
        <g {...groupProps}>
          {halo}
          <polygon {...own} points={diamondPoints(x, y, w, h)} strokeLinejoin="round" />
          {words}
        </g>
      );
    }
    /* A path is a polyline through its points; a line and an arrow are one segment. All three take heads at their ends. */
    const trail: Point[] = item.shape === 'path' && item.points && item.points.length >= 2 ? item.points : [item.from, item.to];
    const startHead = item.arrowStart ?? 'none';
    const endHead = item.arrowEnd ?? (item.shape === 'arrow' ? 'arrow' : 'none');
    const tip = trail[trail.length - 1]!;
    const before = trail[trail.length - 2]!;
    const first = trail[0]!;
    const after = trail[1]!;
    return (
      <g {...groupProps}>
        {halo}
        {hit ? (
          <rect className="wb-hit" x={hit.x - 4} y={hit.y - 4} width={hit.w + 8} height={hit.h + 8} fill="transparent" />
        ) : null}
        {item.shape === 'path' ? (
          <polyline {...own} pathLength={arrival ? 1 : undefined} points={trail.map((p) => `${p.x},${p.y}`).join(' ')} />
        ) : (
          <line {...own} pathLength={arrival ? 1 : undefined} x1={item.from.x} y1={item.from.y} x2={item.to.x} y2={item.to.y} />
        )}
        <LineHead kind={endHead} from={before} to={tip} common={own} arrival={arrival !== undefined} />
        <LineHead kind={startHead} from={after} to={first} common={own} arrival={false} />
        {words}
        {edgeLabel ? (
          /* ON A BACKING, CLEAR OF THE BOXES: the words never sit on a border or across the line. */
          <g className="wb-edge-label" data-testid="wb-edge-label">
            <rect
              className="wb-edge-back"
              x={edgeLabel.x - edgeLabel.w / 2}
              y={edgeLabel.y - edgeLabel.h / 2}
              width={edgeLabel.w}
              height={edgeLabel.h}
              rx={6}
            />
            <text
              className="wb-label wb-edge-text"
              data-testid="wb-label"
              x={edgeLabel.x}
              y={edgeLabel.y}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {edgeLabel.text}
            </text>
          </g>
        ) : null}
      </g>
    );
  }

  if (item.kind === 'text' && item.sticky) {
    const w = item.w ?? STICKY_W;
    const h = item.h ?? STICKY_H;
    return (
      <g {...groupProps}>
        {halo}
        <foreignObject x={item.at.x} y={item.at.y} width={w} height={h}>
          <div
            className={`wb-sticky${onErase ? ' wb-erasable' : ''}`}
            data-testid="wb-item"
            data-kind="sticky"
            data-by={item.by ?? 'person'}
            data-color={paint(item.color, item.ownTheme, false).name}
            data-fill={paint(item.fill, item.ownTheme, true).name}
            style={stickyStyle(item)}
            data-selected={selected ? 'true' : 'false'}
          >
            {item.by === 'agent' ? <span className="wb-sticky-by">Agent</span> : null}
            <span className="wb-sticky-t">{item.text}</span>
          </div>
        </foreignObject>
      </g>
    );
  }

  if (item.kind === 'text') {
    return (
      <g {...groupProps}>
        {halo}
        <text
          {...common}
          className={`wb-text${onErase ? ' wb-erasable' : ''}`}
          data-color={paint(item.color, item.ownTheme, false).name}
          style={textStyle(item)}
          x={item.at.x}
          y={item.at.y}
        >
          {noteLines || item.text.includes('\n')
            ? (noteLines ?? item.text.split('\n')).map((line, i) => (
                <tspan key={i} x={item.at.x} dy={i === 0 ? 0 : WB_BOX_LINE}>
                  {line}
                </tspan>
              ))
            : item.text}
        </text>
      </g>
    );
  }

  if (item.kind === 'scene' && sceneUi) {
    return (
      <g {...groupProps}>
        {halo}
        <SceneStageView item={item} ui={sceneUi} selected={selected} />
      </g>
    );
  }

  if (item.kind === 'scene') return null;

  if (item.kind === 'video') {
    return (
      <g {...groupProps}>
        {halo}
        <rect className="wb-hit" x={item.at.x} y={item.at.y} width={item.w} height={item.h} fill="transparent" />
        <foreignObject x={item.at.x} y={item.at.y} width={item.w} height={item.h} data-testid="wb-item" data-kind="video" data-selected={selected ? 'true' : 'false'}>
          <VideoBody src={item.src} poster={item.poster} label={item.label} w={item.w} h={item.h} />
        </foreignObject>
      </g>
    );
  }

  if (item.kind === 'svg') {
    const drawn = hostedSvg(svgSourceOf(item), item.at, { w: item.w, h: item.h });
    return (
      <g {...groupProps} data-testid="wb-svg-host">
        {halo}
        <rect className="wb-hit" x={item.at.x} y={item.at.y} width={item.w} height={item.h} fill="transparent" />
        {drawn.ok ? (
          <g
            className={`wb-svg${onErase ? ' wb-erasable' : ''}`}
            data-testid="wb-item"
            data-kind="svg"
            data-by={item.by ?? 'person'}
            data-selected={selected ? 'true' : 'false'}
            dangerouslySetInnerHTML={{ __html: drawn.html }}
          />
        ) : (
          <g className="wb-svg wb-svg-bad" data-testid="wb-item" data-kind="svg" data-selected={selected ? 'true' : 'false'}>
            <rect x={item.at.x} y={item.at.y} width={item.w} height={item.h} rx={8} />
            <text x={item.at.x + 12} y={item.at.y + 22}>This svg could not be drawn</text>
          </g>
        )}
        {item.label ? (
          <text className="wb-svg-label" data-testid="wb-svg-label" x={item.at.x} y={item.at.y + item.h + 14}>
            {item.label}
          </text>
        ) : null}
        {onResizeStart ? (
          <rect
            className="wb-resize-handle"
            data-testid="wb-resize"
            x={item.at.x + item.w - 6}
            y={item.at.y + item.h - 6}
            width={12}
            height={12}
            rx={3}
            onPointerDown={onResizeStart}
          />
        ) : null}
      </g>
    );
  }

  if (item.kind === 'artifact') {
    const body = renderArtifact?.(item) ?? null;
    return (
      <g {...groupProps} data-testid="wb-artifact" data-plane-artifact="true">
        {halo}
        <rect
          className={`wb-artifact-frame${onErase ? ' wb-erasable' : ''}${selected ? ' is-selected' : ''}`}
          data-testid="wb-item"
          data-kind="artifact"
          x={item.at.x}
          y={item.at.y}
          width={item.size.w}
          height={item.size.h}
          rx={10}
        />
        <foreignObject
          x={item.at.x + 4}
          y={item.at.y + 4}
          width={Math.max(1, item.size.w - 8)}
          height={Math.max(1, item.size.h - 8)}
        >
          <ArtifactFitBody
            itemId={item.id}
            size={item.size}
            onResize={onResizeArtifact}
          >
            {body}
          </ArtifactFitBody>
        </foreignObject>
      </g>
    );
  }

  /*
   * A NODE REFERENCE WITH A PATH IS A CODE CARD.
   *
   * `WbNodeRef` has always rendered as a bare caption — "a caption plus a
   * pointer, never a copy of the node" — which was right while nothing could
   * tell you WHICH file it pointed at. `board.add_card` grounds one against a
   * real scanned node, and `CodeCard` is the renderer that shows the path, the
   * line range and an excerpt. A card whose renderer is never mounted is the
   * defect this repo keeps catching; this is the mount.
   *
   * THE CAPTION SURVIVES for a reference with no path. A hand-placed `@`
   * mention carries a label and a node id and nothing else, and drawing a
   * card frame around a lone word would promise a file it cannot show.
   */
  if (item.path) {
    return (
      <g {...groupProps}>
        {halo}
        <foreignObject
          x={item.at.x}
          y={item.at.y}
          width={CODE_CARD_W}
          height={CODE_CARD_MAX_H}
          className={onErase ? 'wb-erasable' : undefined}
        >
          <CodeCard
            item={{
              id: item.id,
              label: item.label,
              path: item.path,
              nodeId: item.nodeId,
              ...(item.lines ? { lines: item.lines } : {}),
              ...(item.excerpt ? { excerpt: item.excerpt } : {}),
            }}
            selected={selected}
          />
        </foreignObject>
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
