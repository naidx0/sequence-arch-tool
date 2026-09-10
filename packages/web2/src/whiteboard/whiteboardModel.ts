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
}

/** Freehand ink, kept as the points it was drawn with. */
export interface WbStroke {
  kind: 'stroke';
  id: string;
  points: Point[];
  /** Stroke weight in board units. */
  width: number;
}

/** A drawn shape. Not a node, and it never becomes one. */
export interface WbShape {
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
  shape: 'rect' | 'ellipse' | 'line' | 'arrow';
  from: Point;
  to: Point;
}

/** A label somebody typed. */
export interface WbText {
  kind: 'text';
  id: string;
  at: Point;
  text: string;
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
export interface WbNodeRef {
  kind: 'noderef';
  id: string;
  at: Point;
  nodeId: string;
  label: string;
}

export type WbItem = WbStroke | WbShape | WbText | WbNodeRef;

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
  | { type: 'wb/text'; id: string; text: string }
  | { type: 'wb/delete'; id: string }
  | { type: 'wb/clear' };

function shift(item: WbItem, dx: number, dy: number): WbItem {
  switch (item.kind) {
    case 'stroke':
      return { ...item, points: item.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    case 'shape':
      return {
        ...item,
        from: { x: item.from.x + dx, y: item.from.y + dy },
        to: { x: item.to.x + dx, y: item.to.y + dy },
      };
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
      const items = doc.items.map((it) => {
        if (it.id !== edit.id) return it;
        touched = true;
        return shift(it, edit.dx, edit.dy);
      });
      return touched ? { ...doc, items } : doc;
    }

    case 'wb/text': {
      let touched = false;
      const items = doc.items.map((it) => {
        if (it.id !== edit.id || it.kind !== 'text' || it.text === edit.text) return it;
        touched = true;
        return { ...it, text: edit.text };
      });
      return touched ? { ...doc, items } : doc;
    }

    case 'wb/delete': {
      const items = doc.items.filter((it) => it.id !== edit.id);
      return items.length === doc.items.length ? doc : { ...doc, items };
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

function textFootprint(
  at: Point,
  value: string,
  em: number,
  monospace: boolean,
): { left: number; top: number; right: number; bottom: number } {
  return {
    left: at.x,
    top: at.y - em,
    right: at.x + estimatedTextWidth(value, em, monospace),
    bottom: at.y + em,
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
    return false;
  });

  return { version: 1, items };
}

/** Serialise for storage. */
export function writeWhiteboard(doc: WhiteboardDoc): string {
  return JSON.stringify(doc);
}

/**
 * The storage key for one repository.
 *
 * PER REPOSITORY, because a whiteboard is planning ABOUT a codebase and
 * carrying one repo's sketches into another is worse than losing them — the
 * reader would be looking at notes for a system they are not in.
 */
export function whiteboardKey(repoRoot: string | null): string {
  const root = (repoRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return `sequence.whiteboard.${root || '(none)'}`;
}
