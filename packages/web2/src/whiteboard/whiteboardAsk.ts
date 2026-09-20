import { summarizeStrokes, type InkStrokeSummary } from '@sequence/ink';
import type { AskSurfaceBoardItem } from '@sequence/api-types';

import type { WhiteboardDoc, WbItem, WbNodeRef } from './whiteboardModel';

/* ══════════════════════════════════════════════════════════════════════════
   FINISH A DRAWING, HAND IT TO THE AI
   packages/web2/src/whiteboard/whiteboardAsk.ts

   Moat point 4 is "draw ↔ chat sync". The architecture board has half of it —
   a stroke becomes a node, and the Generate gate hands that node to the
   composer. The whiteboard had NONE of it: you could sketch a plan and there
   was no way to tell the assistant about it.

   ── WHAT A DRAWING CAN HONESTLY SAY, AND WHAT IT CANNOT ──────────────────

   "Three boxes and two lines" is not a brief; it is a description of pixels.
   What a sketch actually carries is the WORDS on it and the REFERENCES it
   makes to real parts of the system, and those are the two things this sends.

   So the shape is deliberately narrow:

     • every note, verbatim, in the order they were drawn
     • every node reference, as a grounded chip the engine can resolve
     • a COUNT of the marks that carry no words, said plainly as unread

   The last one is the honest part. A drawing with forty strokes and no labels
   produces a request that says so, rather than a request that pretends the
   strokes meant something. Silence about them would let the reader believe the
   assistant is looking at their diagram.

   ── AND IT LANDS IN THE COMPOSER, NEVER ON THE WIRE ──────────────────────

   The owner's constraint on the board's Generate gate, verbatim: "Drawing a box
   must NOT fire a code proposal. Generate is an explicit act with a
   confirmation step." A canvas gesture that started a metered run would be the
   same violation on a different surface, so this builds a REQUEST and the host
   puts it in the composer for the reader to edit, add to, or discard.

   PURE. Document in, request out.
   ══════════════════════════════════════════════════════════════════════════ */

export interface WbAskRequest {
  /** The prompt text, for the composer. The reader edits it before sending. */
  prompt: string;
  /** Node ids the drawing referenced — the host turns each into a chip. */
  nodeIds: string[];
}

/** The notes on a board, in the order they were drawn. */
function notesOf(items: readonly WbItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    if (item.kind !== 'text') continue;
    const text = item.text.trim();
    if (text !== '') out.push(text);
  }
  return out;
}

/** The references, deduplicated by node id, first mention winning. */
function refsOf(items: readonly WbItem[]): WbNodeRef[] {
  const seen = new Set<string>();
  const out: WbNodeRef[] = [];
  for (const item of items) {
    if (item.kind !== 'noderef') continue;
    if (seen.has(item.nodeId)) continue;
    seen.add(item.nodeId);
    out.push(item);
  }
  return out;
}

/** Marks that carry no words — strokes and shapes. Counted, never described. */
function unlabelledCount(items: readonly WbItem[]): number {
  return items.filter((i) => i.kind === 'stroke' || i.kind === 'shape').length;
}

/**
 * Whether there is anything worth asking about.
 *
 * A BOARD OF UNLABELLED STROKES IS NOT A BRIEF, and offering to send it would
 * produce a request whose entire content is "the reader drew twelve lines".
 * The control is disabled instead, which says the same thing before the reader
 * spends a turn finding out.
 */
export function askableFrom(doc: WhiteboardDoc): boolean {
  return notesOf(doc.items).length > 0 || refsOf(doc.items).length > 0;
}

/**
 * Turn a finished drawing into a request.
 *
 * `note` is the reader's own sentence about what they want done, carried
 * VERBATIM and first — the same rule the board's Generate gate follows, where
 * rewording the note "would answer a question they did not ask".
 */
export function askFromWhiteboard(doc: WhiteboardDoc, note: string): WbAskRequest | null {
  if (!askableFrom(doc)) return null;

  const notes = notesOf(doc.items);
  const refs = refsOf(doc.items);
  const unlabelled = unlabelledCount(doc.items);

  const lines: string[] = [];
  const asked = note.trim();
  if (asked !== '') lines.push(asked, '');

  lines.push('This is from a whiteboard sketch, not from the scan — nothing on it is evidence.');
  lines.push('');

  if (notes.length > 0) {
    lines.push(`Notes on the board (${notes.length}), in the order they were written:`);
    for (const text of notes) lines.push(`- ${text}`);
    lines.push('');
  }

  if (refs.length > 0) {
    lines.push(`It refers to ${refs.length} part${refs.length === 1 ? '' : 's'} of the system:`);
    for (const ref of refs) lines.push(`- ${ref.label} (${ref.nodeId})`);
    lines.push('');
  }

  /*
   * THE SHAPES THE RECOGNISER WILL NAME, NAMED.
   *
   * `unlabelledCount` has counted strokes and shapes as one undifferentiated
   * pile since this file was written, and `@sequence/ink` could name most of
   * them the whole time. A drawing of three boxes and two arrows reached the
   * composer as "5 marks with no words on them" — true, and a worse sentence
   * than the one available for free.
   *
   * THE HONEST HALF IS UNCHANGED BELOW: a stroke the classifier REFUSES to
   * name is still counted and still said out loud as unreadable. Only the ones
   * it actually named are described, so nothing here claims to see a picture.
   */
  const drawn = namedInkPhrase(doc);
  if (drawn !== '') {
    lines.push(`Its freehand marks include ${drawn} — shapes, not words, so they claim nothing.`);
    lines.push('');
  }

  if (unlabelled > 0) {
    /*
     * SAID OUT LOUD. The assistant is not looking at the picture, and a request
     * that stayed silent about the unlabelled marks would let the reader
     * believe it was. Naming the number is also an invitation to go and label
     * the ones that mattered.
     */
    lines.push(
      `There ${unlabelled === 1 ? 'is' : 'are'} also ${unlabelled} mark${unlabelled === 1 ? '' : 's'} ` +
        'with no words on them, which I cannot read.',
    );
    lines.push('');
  }

  return {
    prompt: lines.join('\n').trimEnd(),
    nodeIds: refs.map((r) => r.nodeId),
  };
}
/* ══════════════════════════════════════════════════════════════════════════
   THE SAME DRAWING, FOR THE SURFACE CHANNEL

   Everything above builds a COMPOSER DRAFT the reader edits before sending —
   the whiteboard's Generate rule, where a gesture may never start a metered
   run on its own. What follows serves the other half: `AskSurfaceContext.board`,
   the field the request already carries and the server already renders
   (`analyzer/src/explain/askSurface.ts`, "--- ALREADY ON THE WHITEBOARD ---").

   ONE MAPPING, NOT TWO. `store.ts`'s `withBoardState` maps the AGENT's items
   into that field and is the only filler it has ever had, which is why a
   reader's own sketch reaches the model on no surface at all. This is that
   mapping made total — human items included — and it lives here, beside the
   composer path, so the two descriptions of one document cannot drift.

   AND THE STROKES ARE NAMED. `@sequence/ink` has classified strokes since the
   day the board shipped and both callers turned the answer into pixels; a
   stroke reached the wire as `kind: 'stroke'` with a position and no label, so
   a page of rectangles and arrows read to the model as a list of nothings.
   `summarizeStrokes` supplies the name and the ninth of the drawing it sits
   in — never the point list, which is expensive and says nothing.
   ══════════════════════════════════════════════════════════════════════════ */

/** Matches the server's own cap (`askSurface.ts`, MAX_BOARD_ITEMS). */
export const WB_ASK_ITEM_CAP = 40;

/** Labels are a caption, not a document — the server truncates at 160 anyway. */
const MAX_ASK_LABEL = 80;

export interface WbAskBoard {
  items: AskSurfaceBoardItem[];
  /** Items past the cap — a count, never a silent drop. */
  omitted?: number;
}

function artifactLabel(ref: { type: 'chart'; index: number } | { type: 'block'; blockId: string }): string {
  return ref.type === 'chart' ? `chart#${ref.index}` : `block:${ref.blockId}`;
}

/**
 * Describe one document as the items the ask wire carries.
 *
 * A STROKE GETS A NAME AND A PLACE, e.g. `rectangle · top-left`. Both halves
 * matter and neither is a guess: the name is whatever `recognizeStroke` — the
 * same classifier the board's own autocorrect uses — returned, so the words in
 * the prompt cannot disagree with the shapes on screen, and a stroke it refused
 * to name is called an unreadable mark rather than rounded to the nearest box.
 *
 * PURE. Document in, wire items out; an empty document yields no items, so a
 * request built from this is byte-identical to one built without it.
 */
export function boardItemsForAsk(doc: WhiteboardDoc): WbAskBoard {
  const strokes = strokesOf(doc);
  const summary = summarizeStrokes(strokes);
  const byStrokeId = new Map<string, InkStrokeSummary>();
  summary.strokes.forEach((s) => {
    const stroke = strokes[s.index];
    if (stroke) byStrokeId.set(stroke.id, s);
  });

  const items: AskSurfaceBoardItem[] = [];
  for (const it of doc.items) {
    if (items.length >= WB_ASK_ITEM_CAP) break;
    if (it.kind === 'text') {
      const text = it.text.trim();
      if (text === '') continue;
      items.push({ id: it.id, kind: 'text', label: text.slice(0, MAX_ASK_LABEL), at: round(it.at) });
      continue;
    }
    if (it.kind === 'noderef') {
      items.push({
        id: it.id,
        kind: 'noderef',
        label: it.label.slice(0, MAX_ASK_LABEL),
        at: round(it.at),
        nodeId: it.nodeId,
      });
      continue;
    }
    if (it.kind === 'shape') {
      items.push({ id: it.id, kind: 'shape', label: it.shape, at: round(it.from) });
      continue;
    }
    if (it.kind === 'artifact') {
      /*
       * AN ARTIFACT FRAME IS A `text` ON THE WIRE, and the wire is right: the
       * closed set has four kinds and a frame is not a fifth. What the block
       * INSIDE it holds travels on `surface.canvas` (id, type, title, size,
       * and an excerpt for the newest), so repeating its contents here would
       * be the same document described twice in one prompt.
       */
      items.push({
        id: it.id,
        kind: 'text',
        label: artifactLabel(it.ref).slice(0, MAX_ASK_LABEL),
        at: round(it.at),
      });
      continue;
    }
    const named = byStrokeId.get(it.id);
    if (!named) continue;
    items.push({
      id: it.id,
      kind: 'stroke',
      label: `${named.name} · ${named.cell}`,
      at: { x: named.rect.x, y: named.rect.y },
    });
  }
  const seen = doc.items.filter((i) => i.kind !== 'text' || i.text.trim() !== '').length;
  const board: WbAskBoard = { items };
  if (seen > items.length) board.omitted = seen - items.length;
  return board;
}

function round(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/**
 * The one sentence that says what the freehand adds up to — "3 rectangles and
 * 2 lines" — or `''` when there are no strokes at all.
 *
 * Separate from {@link boardItemsForAsk} because it answers a different
 * question: the item list says WHERE each mark is, and this says what the
 * drawing IS. A model handed forty positions and no shape of the whole reads
 * forty facts and sees no picture.
 */
export function inkPhrase(doc: WhiteboardDoc): string {
  return summarizeStrokes(strokesOf(doc)).phrase;
}

/**
 * The same phrase over the NAMED strokes only — `''` when the classifier named
 * none of them.
 *
 * The composer draft needs this narrower one and not {@link inkPhrase}, because
 * the sentence UNDER it already counts every unreadable mark and says so. A
 * board of nothing but scribbles would otherwise be described twice, once as
 * "2 unreadable marks" and once as "2 marks with no words on them" — the same
 * fact in two costumes, which is the defect this repo keeps a log about.
 */
export function namedInkPhrase(doc: WhiteboardDoc): string {
  const named = summarizeStrokes(strokesOf(doc)).strokes.filter((s) => s.kind !== 'scribble');
  if (named.length === 0) return '';
  const boxes = named.filter((s) => s.kind === 'box').length;
  const lines = named.length - boxes;
  const parts: string[] = [];
  if (boxes > 0) parts.push(`${boxes} ${boxes === 1 ? 'rectangle' : 'rectangles'}`);
  if (lines > 0) parts.push(`${lines} ${lines === 1 ? 'line' : 'lines'}`);
  return parts.join(' and ');
}

function strokesOf(doc: WhiteboardDoc): Extract<WbItem, { kind: 'stroke' }>[] {
  return doc.items.filter((i): i is Extract<WbItem, { kind: 'stroke' }> => i.kind === 'stroke');
}
