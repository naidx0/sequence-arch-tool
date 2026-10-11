/* ══════════════════════════════════════════════════════════════════════════
   THE WHITEBOARD — a surface where nothing is a measured claim
   packages/web2/src/whiteboard/whiteboardModel.ts

   Owner walk 2026-08-22: "drawing on the boards, having a whiteboard element
   too. We have this architecture board right here, and we're going to have a
   separate kind of whiteboard you can switch tabs between. The whiteboard is
   just like a Miro board where you can literally just draw from scratch. If
   they want to plan stuff not on the architecture board separately, it would
   be there as well."

   ── WHY IT IS A SEPARATE SURFACE AND NOT A MODE ─────────────────────────

   This is the whole design, and it is not about layout. The architecture board
   is DERIVED: every node came from a parser and every edge cites a file and a
   line. The whiteboard is the opposite in kind — it holds whatever a person
   drew, with no evidence behind any of it and none possible.

   Mixed into one surface, those two are indistinguishable after a week. A box
   somebody sketched during planning would sit beside a service the scan found,
   in the same visual language, and CANON's first non-negotiable — a tool
   asserting a false edge with a citation is worse than no tool — would be
   violated by the reader's own memory rather than by the code.

   So: two tabs, two documents, and nothing drawn here ever becomes a graph
   node. That is enforced in the types (a `WbItem` has no `evidence` field and
   no node id) and asserted in the tests.

   ── AND IT IS WHY DRAW FELT BROKEN ───────────────────────────────────────

   The walk also reported "Draw. It doesn't seem to work. It doesn't let me do
   anything." That is not a bug: `recognizeStroke` emits box, line or scribble,
   and `inkToEdit` REFUSES a scribble, because on the architecture board a
   stroke is a structured editing gesture — draw a box, get a node. Freehand is
   the rejected case there, by design.

   Here it is the only case. Same input, two surfaces, two correct outcomes.

   PURE. Every function is a value in, a value out. No React, no DOM, no clock,
   no storage — the caller supplies ids and timestamps, so a test can assert an
   exact document.
   ══════════════════════════════════════════════════════════════════════════ */

export interface Point {
  x: number;
  y: number;
  /**
   * Strokes only: milliseconds since the pen went down, whole numbers. Recorded
   * from the version that added the tidy-up suggestion onward, so a stroke drawn
   * before then has none. Nothing draws from it; it is what a recognizer retrained
   * on one person's hand, or a speed-aware one, would learn from.
   */
  t?: number;
}

/*
 * ── ROUND 8: WHAT EVERY MARK MAY ALSO CARRY ─────────────────────────────
 *
 * Boards moved to one server store (`/api/boards`, lab/specs/r8-boards.md)
 * that an agent writes through the MCP. Two fields ride on any item:
 *
 *   `by`      who drew it. An agent's marks are tinted so the reader can tell
 *             their own sketch from the model's.
 *   `anchor`  a graph node id. The item's coordinates are OFFSETS from that
 *             node's top-left, so a note about the payments service stays
 *             beside it when the layout or a drag moves the card. Only the
 *             architecture board resolves anchors; a whiteboard has no nodes.
 *
 * Neither makes a mark a finding: still no evidence, still never a node.
 */
export interface WbMarkMeta {
  by?: 'agent' | 'person';
  anchor?: string;
}

/** Freehand ink, kept as the points it was drawn with. */
export interface WbStroke extends WbMarkMeta {
  kind: 'stroke';
  id: string;
  points: Point[];
  /** Stroke weight in board units. */
  width: number;
}

/** A drawn shape. Not a node, and it never becomes one. */
export interface WbShape extends WbMarkMeta {
  kind: 'shape';
  id: string;
  /*
   * `arrow` is a LINE THAT POINTS, and it is its own shape rather than a flag on
   * `line` because direction is the whole content of the mark. Asked for
   * directly: "I just wish I could see an arrow for the whiteboard as well."
   * The architecture board has had directed edges since it was written; a
   * sketching surface that could only draw undirected lines could not express
   * "A calls B", which is most of what anyone draws on one.
   */
  shape: 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow';
  from: Point;
  to: Point;
  /** A caption drawn inside a rect or ellipse, or along an arrow. */
  label?: string;
  /**
   * An arrow BOUND to other marks (or, on the architecture board, to node
   * ids): its ends are recomputed from where those are now, so moving a box
   * drags its arrows with it. `from`/`to` are the fallback when an end's
   * target is gone.
   */
  fromId?: string;
  toId?: string;
}

/** A label somebody typed. */
export interface WbText extends WbMarkMeta {
  kind: 'text';
  id: string;
  at: Point;
  text: string;
  /**
   * A STICKY NOTE is text on a tinted card (round 8): the mark people reach
   * for when they plan, and the one an agent uses to say "this is why" next to
   * a service. It is a flag on text rather than its own kind so every reader
   * of text (the ask payload, the agent move, the SeqDraw summary) reads a
   * sticky's words without learning a new kind. `at` is its top-left corner.
   */
  sticky?: boolean;
  w?: number;
  h?: number;
}

/**
 * A framed artifact on the AI Canvas SeqDraw plane — chart or canvas block.
 * Positioned in board space; content is looked up live from `canvasDoc`.
 */
export interface WbArtifact extends WbMarkMeta {
  kind: 'artifact';
  id: string;
  at: Point;
  size: { w: number; h: number };
  ref: { type: 'chart'; index: number } | { type: 'block'; blockId: string };
}

/**
 * A reference back to a real graph node.
 *
 * IT IS A POINTER, NOT A COPY. It carries the node's id and the label as it
 * read at the time, and nothing else — no kind, no evidence, no edges. A
 * whiteboard that copied a node's substance would be a second, staler answer
 * to a question the graph already answers, and the two would drift silently.
 *
 * `label` is a caption for the reader, and the id is what makes it clickable.
 * If the node is gone at click time, the surface says so rather than guessing.
 */
export interface WbNodeRef extends WbMarkMeta {
  kind: 'noderef';
  id: string;
  at: Point;
  nodeId: string;
  label: string;
  /*
   * ── WHAT MAKES A REFERENCE A CODE CARD ───────────────────────────────────
   *
   * All three are OPTIONAL and all three arrive together or not at all, which
   * is the distinction the renderer keys on: a reference with a `path` draws as
   * a CodeCard (path, line range, excerpt); one without stays the bare caption
   * it has always been.
   *
   * That split is deliberate rather than tidy. A hand-placed `@` mention knows
   * a label and a node id and nothing else, and drawing a card frame round a
   * lone word would promise a file the surface cannot show. `board.add_card`
   * grounds against the scanned graph and can fill them in.
   */
  /** Repo-relative, forward-slashed. Present ⇒ this draws as a code card. */
  path?: string;
  /** The lines this card stands for, when it stands for a range. */
  lines?: { from: number; to: number };
  /** A short excerpt of the real source. Never invented — the scan supplies it. */
  excerpt?: string;
}

/**
 * ── BOXES: A LABEL THAT CANNOT LEAVE ITS BOX ───────────────────────────────
 *
 * Owner: "make sure stuff doesn't escape the boxes". The wire carries only
 * `text`, `noderef` and `shape`, so a drawn box is two items joined by id: the
 * rectangle `X:box`, and the `text` or `noderef` `X` that is its label. A label
 * is WRAPPED to the box it belongs to and the box GROWS downward to hold every
 * line, so the only way for words to be outside a box is for the box not to
 * exist. A shape's own `label` goes through the same path.
 *
 * The four numbers below are restated by `packages/analyzer/src/server/
 * boardLayout.ts`, which sizes boxes before they are ever drawn;
 * `board-layout.test.ts` reads this file and fails if they drift.
 */
export const WB_BOX_SUFFIX = ':box';
export const WB_BOX_EM = 13;
export const WB_BOX_LINE = 18;
export const WB_BOX_PAD_X = 14;
export const WB_BOX_PAD_Y = 12;

export const STICKY_W = 180;
export const STICKY_H = 110;

export type WbItem = WbStroke | WbShape | WbText | WbNodeRef | WbArtifact;

export interface WhiteboardDoc {
  version: 1;
  items: WbItem[];
}

export const EMPTY_WHITEBOARD: WhiteboardDoc = { version: 1, items: [] };

/** How deep undo goes. Matches `docSession`'s UNDO_DEPTH, deliberately: two
 *  surfaces in one product that forget at different depths is a difference a
 *  reader would feel and could not explain. */
export const WB_UNDO_DEPTH = 50;

export type WhiteboardEdit =
  | { type: 'wb/add'; item: WbItem }
  | { type: 'wb/move'; id: string; dx: number; dy: number }
  | { type: 'wb/resize'; id: string; w: number; h: number }
  | { type: 'wb/text'; id: string; text: string }
  | { type: 'wb/delete'; id: string }
  /**
   * Take some marks out and put others in, as ONE edit (one undo frame). The tidy-up
   * uses it: the raw strokes leave and the clean shape lands where the first of them
   * was in the stacking order. Undo puts the raw strokes back exactly as drawn.
   * Declined (same document) when none of `remove` is on the board any more.
   */
  | { type: 'wb/replace'; remove: string[]; add: WbItem[] }
  | { type: 'wb/clear' };

function shift(item: WbItem, dx: number, dy: number): WbItem {
  switch (item.kind) {
    case 'stroke':
      return { ...item, points: item.points.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })) };
    case 'shape':
      return {
        ...item,
        from: { x: item.from.x + dx, y: item.from.y + dy },
        to: { x: item.to.x + dx, y: item.to.y + dy },
      };
    case 'artifact':
      return { ...item, at: { x: item.at.x + dx, y: item.at.y + dy } };
    default:
      return { ...item, at: { x: item.at.x + dx, y: item.at.y + dy } };
  }
}

/**
 * Apply one edit. Returns the SAME object when nothing changed, so a caller can
 * use identity to decide whether to push an undo frame — the discipline
 * `docEdit` already follows, for the same reason: an undo stack that grows on
 * no-ops makes Ctrl-Z appear broken.
 */
export function whiteboardEdit(doc: WhiteboardDoc, edit: WhiteboardEdit): WhiteboardDoc {
  switch (edit.type) {
    case 'wb/add':
      return { ...doc, items: [...doc.items, edit.item] };

    case 'wb/move': {
      if (edit.dx === 0 && edit.dy === 0) return doc;
      let touched = false;
      /* A box (`X:box`) and the label item that is drawn inside it (`X`) are one
         mark to the reader, so they travel together. */
      const label = edit.id.endsWith(WB_BOX_SUFFIX) ? edit.id.slice(0, -WB_BOX_SUFFIX.length) : null;
      const items = doc.items.map((it) => {
        if (it.id !== edit.id && it.id !== label) return it;
        touched = true;
        return shift(it, edit.dx, edit.dy);
      });
      return touched ? { ...doc, items } : doc;
    }

    case 'wb/resize': {
      const w = Math.max(80, Math.round(edit.w));
      const h = Math.max(60, Math.round(edit.h));
      let touched = false;
      const items = doc.items.map((it) => {
        if (it.id !== edit.id || it.kind !== 'artifact') return it;
        if (it.size.w === w && it.size.h === h) return it;
        touched = true;
        return { ...it, size: { w, h } };
      });
      return touched ? { ...doc, items } : doc;
    }

    case 'wb/text': {
      let touched = false;
      const items = doc.items.map((it) => {
        if (it.id !== edit.id) return it;
        if (it.kind === 'text') {
          if (it.text === edit.text) return it;
          touched = true;
          return { ...it, text: edit.text };
        }
        /* A shape's text is its label; an empty string takes the label off. */
        if (it.kind === 'shape' && (it.label ?? '') !== edit.text) {
          touched = true;
          const { label: _drop, ...rest } = it;
          return edit.text ? { ...rest, label: edit.text } : rest;
        }
        return it;
      });
      return touched ? { ...doc, items } : doc;
    }

    case 'wb/delete': {
      /* Deleting a box takes its label with it, or the label would reappear as
         loose text at a position nobody sees. */
      const label = edit.id.endsWith(WB_BOX_SUFFIX) ? edit.id.slice(0, -WB_BOX_SUFFIX.length) : null;
      const items = doc.items.filter((it) => it.id !== edit.id && it.id !== label);
      return items.length === doc.items.length ? doc : { ...doc, items };
    }

    case 'wb/replace': {
      const gone = new Set(edit.remove);
      const at = doc.items.findIndex((it) => gone.has(it.id));
      if (at < 0) return doc;
      const kept = doc.items.filter((it) => !gone.has(it.id));
      const before = doc.items.slice(0, at).filter((it) => !gone.has(it.id)).length;
      return { ...doc, items: [...kept.slice(0, before), ...edit.add, ...kept.slice(before)] };
    }

    case 'wb/clear':
      return doc.items.length === 0 ? doc : { ...doc, items: [] };

    default:
      return doc;
  }
}

/**
 * Turn a raw pointer path into a stroke.
 *
 * NOTHING IS RECOGNISED. `recognizeStroke` is not called and must never be:
 * the architecture board's gesture grammar turns a rough box into a node, and
 * doing that here would silently convert a sketch into something that looks
 * like a finding. A scribble is a scribble.
 *
 * A path of fewer than two points is not a stroke — it is a click, and storing
 * it produces invisible items that still answer hit tests.
 */
export function strokeFrom(id: string, points: readonly Point[], width = 2): WbStroke | null {
  if (points.length < 2) return null;
  return { kind: 'stroke', id, points: [...points], width };
}

/**
 * Conservative text footprints for Fit.
 *
 * THESE ARE NOT DOM MEASUREMENTS. A pure document module cannot ask an SVG
 * `<text>` node for `getBBox()`, and pretending otherwise would make Fit depend
 * on whether the board happened to be mounted. The em values mirror the
 * declared `--t-13` and `--t-11` sizes used by `.wb-text` and `.wb-noderef` in
 * `whiteboard.css`. The advance buckets below are explicitly HEURISTICS, not
 * measured font metrics: narrow punctuation consumes less of an em, wide
 * glyphs consume nearly one, ordinary letters sit between, and non-ASCII gets
 * a full em. Monospace references use a conservative cell estimate. A trailing
 * half-em and one em above and below the SVG baseline supply bearing and height
 * slack. This stays pure and stable while framing the marks a reader sees.
 */
const WB_TEXT_EM = 13;
const WB_NODEREF_EM = 11;

function proportionalAdvanceEm(character: string): number {
  if (/\s/u.test(character)) return 0.35;
  if (/[ilI1.,'`:;|!]/u.test(character)) return 0.32;
  if (/[MWmw@#%&]/u.test(character)) return 0.9;
  if (/[A-Z0-9]/u.test(character)) return 0.68;
  if (/^[\x00-\x7f]$/u.test(character)) return 0.56;
  return 1;
}

function estimatedTextWidth(value: string, em: number, monospace: boolean): number {
  const advance = Array.from(value).reduce(
    (sum, character) =>
      sum +
      (monospace
        ? /^[\x00-\x7f]$/u.test(character)
          ? 0.65
          : 1
        : proportionalAdvanceEm(character)),
    0,
  );
  return Math.max(em, (advance + 0.5) * em);
}

/** Width of one line at `em`, by the same conservative advance table Fit uses. */
export function measureLine(value: string, em: number = WB_BOX_EM): number {
  return estimatedTextWidth(value, em, false);
}

/**
 * Greedy word wrap to `maxWidth`. Hard newlines are kept, and a word wider than
 * the line is broken by character: a label is never allowed to be wider than
 * the thing it labels.
 */
export function wrapLabel(value: string, maxWidth: number, em: number = WB_BOX_EM): string[] {
  const out: string[] = [];
  for (const paragraph of value.split('\n')) {
    const words = paragraph.split(/\s+/u).filter((w) => w !== '');
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    const flush = () => {
      if (line !== '') out.push(line);
      line = '';
    };
    for (const word of words) {
      const trial = line === '' ? word : `${line} ${word}`;
      if (measureLine(trial, em) <= maxWidth) {
        line = trial;
        continue;
      }
      flush();
      if (measureLine(word, em) <= maxWidth) {
        line = word;
        continue;
      }
      let chunk = '';
      for (const ch of word) {
        if (measureLine(chunk + ch, em) > maxWidth && chunk !== '') {
          out.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
    }
    flush();
  }
  return out.length === 0 ? [''] : out;
}

/** What is drawn inside a box. */
export interface WbBoxLabel {
  lines: string[];
  /** A card (`noderef`) reads as a reference; a note as plain words. */
  kind: 'text' | 'ref';
}

/**
 * Join each box to its label, wrap the words to the box, and grow the box to
 * fit. Returns the items to DRAW (a consumed label item is not drawn on its
 * own) and, for each box, what goes inside it. Pure: the document is untouched.
 */
export function composeBoxes(
  items: readonly WbItem[],
  /** Which loose notes may be adopted by the box they lie on: the agent's, never a person's own text. */
  mayAdopt: (item: WbItem) => boolean = () => false,
): {
  items: WbItem[];
  labels: Map<string, WbBoxLabel>;
} {
  const shapes = new Map<string, WbShape>();
  for (const it of items) {
    if (it.kind === 'shape' && (it.shape === 'rect' || it.shape === 'ellipse')) shapes.set(it.id, it);
  }
  const labels = new Map<string, WbBoxLabel>();
  const raw = new Map<string, { text: string; kind: 'text' | 'ref' }>();
  const consumed = new Set<string>();
  for (const it of items) {
    const box = shapes.get(`${it.id}${WB_BOX_SUFFIX}`);
    if (!box) continue;
    if (it.kind === 'text' && !it.sticky) raw.set(box.id, { text: it.text, kind: 'text' });
    else if (it.kind === 'noderef' && !it.path) raw.set(box.id, { text: it.label, kind: 'ref' });
    else continue;
    consumed.add(it.id);
  }
  /* A LOOSE NOTE LYING ON AN UNLABELLED BOX IS THAT BOX'S LABEL (0.1.5). An agent that places the words by
     coordinates, without the `X`/`X:box` id pairing, put them over the box's own text or across its border;
     joined to the box they are wrapped to it like any other label. */
  const adopt = new Map<string, WbText[]>();
  for (const it of items) {
    if (it.kind !== 'text' || it.sticky || consumed.has(it.id) || !mayAdopt(it)) continue;
    for (const box of shapes.values()) {
      if (raw.has(box.id) || box.label) continue;
      const left = Math.min(box.from.x, box.to.x);
      const top = Math.min(box.from.y, box.to.y);
      const right = Math.max(box.from.x, box.to.x);
      const bottom = Math.max(box.from.y, box.to.y);
      if (it.at.x >= left && it.at.x <= right && it.at.y >= top && it.at.y <= bottom + 4) {
        adopt.set(box.id, [...(adopt.get(box.id) ?? []), it]);
        break;
      }
    }
  }
  for (const [boxId, texts] of adopt) {
    const ordered = [...texts].sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
    raw.set(boxId, { text: ordered.map((t) => t.text).join('\n'), kind: 'text' });
    for (const t of ordered) consumed.add(t.id);
  }
  for (const box of shapes.values()) {
    if (!raw.has(box.id) && box.label) raw.set(box.id, { text: box.label, kind: 'text' });
  }

  const out: WbItem[] = [];
  for (const it of items) {
    if (consumed.has(it.id)) continue;
    const found = it.kind === 'shape' ? raw.get(it.id) : undefined;
    if (it.kind !== 'shape' || !found) {
      out.push(it);
      continue;
    }
    const w = Math.abs(it.to.x - it.from.x);
    const h = Math.abs(it.to.y - it.from.y);
    /* An ellipse's usable width is the rectangle inscribed in it. */
    const inner = Math.max(24, it.shape === 'ellipse' ? w * 0.68 - 2 * 6 : w - 2 * WB_BOX_PAD_X);
    const lines = wrapLabel(found.text, inner);
    const need = lines.length * WB_BOX_LINE + 2 * WB_BOX_PAD_Y;
    labels.set(it.id, { lines, kind: found.kind });
    if (need > h) {
      const top = Math.min(it.from.y, it.to.y);
      const grown = it.from.y <= it.to.y ? { from: it.from, to: { x: it.to.x, y: top + need } } : { from: { x: it.from.x, y: top + need }, to: it.to };
      out.push({ ...it, ...grown });
    } else {
      out.push(it);
    }
  }
  return { items: out, labels };
}

function textFootprint(
  at: Point,
  value: string,
  em: number,
  monospace: boolean,
): { left: number; top: number; right: number; bottom: number } {
  /* Several lines: as wide as the widest, as tall as all of them (a newline used to count as one more glyph on one line). */
  const rows = value.split('\n');
  return {
    left: at.x,
    top: at.y - em,
    right: at.x + Math.max(...rows.map((row) => estimatedTextWidth(row, em, monospace))),
    bottom: at.y + em + (rows.length - 1) * WB_BOX_LINE,
  };
}

/** The bounding box of everything PAINTED on the board, or null when it is empty. */
export function whiteboardBounds(
  doc: WhiteboardDoc,
): { x: number; y: number; width: number; height: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const it of doc.items) {
    if (it.kind === 'stroke') {
      for (const p of it.points) {
        xs.push(p.x);
        ys.push(p.y);
      }
    } else if (it.kind === 'shape') {
      xs.push(it.from.x, it.to.x);
      ys.push(it.from.y, it.to.y);
    } else if (it.kind === 'artifact') {
      xs.push(it.at.x, it.at.x + it.size.w);
      ys.push(it.at.y, it.at.y + it.size.h);
    } else if (it.kind === 'text' && it.sticky) {
      xs.push(it.at.x, it.at.x + (it.w ?? STICKY_W));
      ys.push(it.at.y, it.at.y + (it.h ?? STICKY_H));
    } else {
      const footprint = textFootprint(
        it.at,
        it.kind === 'text' ? it.text : it.label,
        it.kind === 'text' ? WB_TEXT_EM : WB_NODEREF_EM,
        it.kind === 'noderef',
      );
      xs.push(footprint.left, footprint.right);
      ys.push(footprint.top, footprint.bottom);
    }
  }
  if (xs.length === 0) return null;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Read a persisted whiteboard, or the empty one.
 *
 * TOTAL AND SILENT ON BAD INPUT, because the alternative is a surface that
 * refuses to open. This is a sketchpad: a corrupt blob costs a drawing, and
 * blocking the tab on it costs the feature. `shellStorage` takes the same
 * stance on its own persisted string, and for the same reason.
 *
 * Items with an unknown `kind` are DROPPED rather than kept, so a document
 * written by a newer build cannot smuggle something this build will render as
 * a shape it does not understand.
 */
export function readWhiteboard(raw: string | null): WhiteboardDoc {
  if (!raw) return EMPTY_WHITEBOARD;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_WHITEBOARD;
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_WHITEBOARD;
  const doc = parsed as Partial<WhiteboardDoc>;
  if (doc.version !== 1 || !Array.isArray(doc.items)) return EMPTY_WHITEBOARD;

  const items = doc.items.filter((it): it is WbItem => {
    if (typeof it !== 'object' || it === null) return false;
    const k = (it as WbItem).kind;
    if (typeof (it as WbItem).id !== 'string') return false;
    if (k === 'stroke') return Array.isArray((it as WbStroke).points);
    if (k === 'shape') return !!(it as WbShape).from && !!(it as WbShape).to;
    if (k === 'text') return typeof (it as WbText).text === 'string';
    if (k === 'noderef') return typeof (it as WbNodeRef).nodeId === 'string';
    if (k === 'artifact') {
      const a = it as WbArtifact;
      return (
        typeof a.at?.x === 'number' &&
        typeof a.size?.w === 'number' &&
        typeof a.size?.h === 'number' &&
        typeof a.ref === 'object' &&
        a.ref !== null
      );
    }
    return false;
  });

  return { version: 1, items };
}

/** Serialise for storage. */
export function writeWhiteboard(doc: WhiteboardDoc): string {
  return JSON.stringify(doc);
}

/**
 * The storage key for one chat session's whiteboard.
 *
 * PER SESSION (not per repository): soft catalog switches hydrate session
 * surfaces without attaching, so sketches travel with the thread. A repo-keyed
 * pad would bleed across chats under the same attach.
 */
export function whiteboardKey(sessionId: string | null): string {
  const id = (sessionId ?? '').trim() || '(none)';
  return `sequence.whiteboard.${id}`;
}

/** AI Canvas SeqDraw layer — same model, separate document from the Whiteboard tab. */
export function seqDrawKey(sessionId: string | null): string {
  const id = (sessionId ?? '').trim() || '(none)';
  return `sequence.seqdraw.${id}`;
}
