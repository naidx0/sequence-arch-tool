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
