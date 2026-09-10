import { describe, expect, it } from 'vitest';

import { askFromWhiteboard, askableFrom } from './whiteboardAsk';
import { EMPTY_WHITEBOARD, whiteboardEdit, type WhiteboardDoc, type WbItem } from './whiteboardModel';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * DRAW → AI, on the surface that had none of it
 *
 * Moat point 4 is "draw ↔ chat sync". The architecture board has half: a
 * stroke becomes a node and Generate hands it to the composer. The whiteboard
 * had NONE — you could sketch a whole plan and there was no way to tell the
 * assistant about it.
 * ══════════════════════════════════════════════════════════════════════════
 */

function boardOf(...items: WbItem[]): WhiteboardDoc {
  return items.reduce<WhiteboardDoc>(
    (doc, item) => whiteboardEdit(doc, { type: 'wb/add', item }),
    EMPTY_WHITEBOARD,
  );
}

const note = (id: string, text: string): WbItem => ({ kind: 'text', id, at: { x: 0, y: 0 }, text });
const ref = (id: string, nodeId: string, label: string): WbItem => ({
  kind: 'noderef',
  id,
  at: { x: 0, y: 0 },
  nodeId,
  label,
});
const scribble = (id: string): WbItem => ({
  kind: 'stroke',
  id,
  points: [
    { x: 0, y: 0 },
    { x: 9, y: 9 },
  ],
  width: 2,
});

describe('whether there is anything worth asking about', () => {
  it('an empty board is not', () => {
    expect(askableFrom(EMPTY_WHITEBOARD)).toBe(false);
    expect(askFromWhiteboard(EMPTY_WHITEBOARD, 'do something')).toBeNull();
  });

  it('A BOARD OF UNLABELLED STROKES IS NOT EITHER', () => {
    /*
     * The judgement that keeps this feature honest. Sending it would produce a
     * request whose entire content is "the reader drew three lines", and the
     * reader would only discover that after spending a turn. Refusing says the
     * same thing for free.
     */
    expect(askableFrom(boardOf(scribble('s1'), scribble('s2'), scribble('s3')))).toBe(false);
  });

  it('one note is enough', () => {
    expect(askableFrom(boardOf(note('t1', 'rate limit the gateway')))).toBe(true);
  });

  it('one reference is enough, even with no words', () => {
    /* A drawing that points at a real service is already saying something the
       engine can resolve. */
    expect(askableFrom(boardOf(ref('n1', 'svc:gateway', 'gateway')))).toBe(true);
  });
});

describe('what the request carries', () => {
  const DOC = boardOf(
    note('t1', 'gateway is doing too much'),
    note('t2', 'split auth out'),
    ref('n1', 'svc:gateway', 'gateway'),
    scribble('s1'),
    scribble('s2'),
  );

  it("THE READER'S OWN SENTENCE, FIRST AND VERBATIM", () => {
    /* The board's Generate gate rule, applied here: rewording what a person
       typed answers a question they did not ask. */
    const request = askFromWhiteboard(DOC, '  how would you do this?  ');
    expect(request?.prompt.startsWith('how would you do this?')).toBe(true);
  });

  it('every note, in the order they were written', () => {
    const prompt = askFromWhiteboard(DOC, '')?.prompt ?? '';
    expect(prompt).toContain('gateway is doing too much');
    expect(prompt).toContain('split auth out');
    expect(prompt.indexOf('gateway is doing too much')).toBeLessThan(prompt.indexOf('split auth out'));
  });

  it('the node ids, as chips the host can ground', () => {
    expect(askFromWhiteboard(DOC, '')?.nodeIds).toEqual(['svc:gateway']);
  });

  it('SAYS THE SKETCH IS NOT EVIDENCE, in the prompt itself', () => {
    /*
     * The whole reason the whiteboard is a separate surface: nothing on it is a
     * measured claim. A request that did not say so would put a sketch and a
     * scan finding into the same sentence in the model's context, which is
     * exactly what keeping two boards was meant to prevent.
     */
    expect(askFromWhiteboard(DOC, '')?.prompt).toMatch(/not from the scan|nothing on it is evidence/i);
  });

  it('COUNTS THE MARKS IT CANNOT READ, rather than staying quiet about them', () => {
    /* Silence would let the reader believe the assistant is looking at their
       diagram. The number is also an invitation to go and label them. */
    const prompt = askFromWhiteboard(DOC, '')?.prompt ?? '';
    expect(prompt).toMatch(/2 marks/);
    expect(prompt).toMatch(/cannot read/);
  });

  it('says nothing about unlabelled marks when there are none', () => {
    const prompt = askFromWhiteboard(boardOf(note('t1', 'just this')), '')?.prompt ?? '';
    expect(prompt).not.toMatch(/cannot read/);
  });

  it('one is singular', () => {
    /* "1 marks" is the sort of thing that makes a reader trust nothing else on
       the screen. */
    const doc = boardOf(note('t1', 'a'), scribble('s1'));
    expect(askFromWhiteboard(doc, '')?.prompt).toMatch(/1 mark with no words/);
  });

  it('DEDUPLICATES A NODE REFERENCED TWICE', () => {
    /* Two chips for one service is a context the reader did not build — the
       same rule `chipFromMention` follows by deriving its id from the ref. */
    const doc = boardOf(ref('n1', 'svc:gateway', 'gateway'), ref('n2', 'svc:gateway', 'gateway'));
    expect(askFromWhiteboard(doc, '')?.nodeIds).toEqual(['svc:gateway']);
  });

  it('drops a note that is only whitespace', () => {
    const doc = boardOf(note('t1', '   '), note('t2', 'real'));
    const prompt = askFromWhiteboard(doc, '')?.prompt ?? '';
    expect(prompt).toMatch(/Notes on the board \(1\)/);
  });
});
