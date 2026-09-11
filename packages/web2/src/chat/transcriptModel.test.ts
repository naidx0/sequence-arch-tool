import { describe, expect, it } from 'vitest';

import { assistantTurn, inFlight, userTurn, workRow } from './fixtures';
import { shouldFollow } from './scrollFollow';
import { foldTranscript, isRestoredTurnId } from './transcriptModel';
import { formatElapsed, glyphFor } from './workRowModel';

/**
 * ITEM 2.5 — THE TRANSCRIPT, PURE HALF.
 *
 * The transcript is a FOLD over turns, not a second copy of them. The
 * adoption study's first finding is that MLH's transcript is
 * `foldEvents(events) -> TranscriptItem[]` with no store behind it
 * (docs/research/ml-harness-adoption.md §1.1, §1.10), and that this is why a
 * reload cannot disagree with what was on screen. The fold is where every
 * ordering and suppression rule lives, and it is pure so that all of them are
 * assertable without a DOM.
 *
 * Cited: docs/brand/graphite/pages/12-the-agentic-surfaces.html §12.1-12.3.
 */

describe('foldTranscript — the three objects of a turn, in one order', () => {
  it('is empty for an empty thread', () => {
    expect(foldTranscript([], null)).toEqual([]);
  });

  it('folds a turn with work INTO THE PROSE — Decision 7, inline', () => {
    /*
     * Decision 7 (docs/OWNER-PLAN-2026-08-24c.md §1): work rows render inside
     * the answer flow, not as a detached trail block before it. The fold
     * carries the rows ON the prose item; there is no separate work item for
     * a turn that has an answer.
     */
    const items = foldTranscript(
      [
        userTurn('u1', 'If I change the auth middleware, what breaks?'),
        assistantTurn('a1', 'u1', {
          text: 'Two callers, and only one of them is yours.',
          work: [
            workRow('w1', { group: 'reason', verb: 'Thought for' }),
            workRow('w2', { group: 'read', verb: 'Explored 2 files' }),
          ],
        }),
      ],
      null,
    );

    expect(items.map((i) => i.kind)).toEqual(['user', 'prose']);
    const prose = items.find((i) => i.kind === 'prose');
    expect(prose?.kind === 'prose' && prose.work.map((r) => r.id)).toEqual(['w1', 'w2']);
  });

  it('keeps rows OUT of the prose item when they are affordances, and those below the answer', () => {
    /*
     * The inline fold moves NARRATION (opens === null). A row that opens
     * another surface is still sheet 12.1's door below the answer.
     */
    const items = foldTranscript(
      [
        userTurn('u1', 'what breaks'),
        assistantTurn('a1', 'u1', {
          text: 'Two callers.',
          work: [
            workRow('w1', { group: 'read', verb: 'Read the attached graph' }),
            workRow('w2', { group: 'reason', verb: 'Selected 2 nodes on the board', opens: 'canvas' }),
          ],
        }),
      ],
      null,
    );

    expect(items.map((i) => i.kind)).toEqual(['user', 'prose', 'opens']);

    const prose = items.find((i) => i.kind === 'prose');
    expect(prose?.kind === 'prose' && prose.work.map((r) => r.id)).toEqual(['w1']);
  });

  it('folds a topology proposal as an opens row below the answer', () => {
    const items = foldTranscript(
      [
        userTurn('u1', 'add a rate limiter'),
        assistantTurn('a1', 'u1', {
          text: 'I proposed one in front of the gateway.',
          work: [
            workRow('w1', {
              group: 'change',
              verb: 'Proposed architecture',
              identifier: 'Add a rate limiter',
              from: 'topology:proposal',
              opens: 'canvas',
              outcome: { kind: 'count', n: 1, unit: 'nodes' },
            }),
          ],
        }),
      ],
      null,
    );

    expect(items.map((i) => i.kind)).toEqual(['user', 'prose', 'opens']);
    const door = items.find((i) => i.kind === 'opens');
    expect(door?.kind === 'opens' && door.row.from).toBe('topology:proposal');
    expect(door?.kind === 'opens' && door.row.opens).toBe('canvas');
  });

  it('survives as a stack ONLY where a row precedes any prose — a wordless turn', () => {
    // A turn with no words has no answer flow to fold into. The rows keep
    // their own item so the evidence stays on screen above the ending.
    const items = foldTranscript(
      [userTurn('u1', 'fix it'), assistantTurn('a1', 'u1', {
        text: '',
        work: [workRow('w1', { group: 'run', verb: 'Ran the test suite' })],
      })],
      null,
    );
    expect(items.map((i) => i.kind)).toEqual(['user', 'work', 'ending']);
  });

  it('emits no work item when a turn called no tools', () => {
    // An empty stack rendered as a container is a row of nothing, and the
    // gap ladder then reads as if something was suppressed.
    const items = foldTranscript(
      [userTurn('u1', 'hi'), assistantTurn('a1', 'u1', { text: 'Hello.', work: [] })],
      null,
    );
    expect(items.map((i) => i.kind)).toEqual(['user', 'prose']);
  });

  it('gives a wordless turn words rather than leaving it silent', () => {
    /*
     * MLH's single most-cited mechanism: a turn ALWAYS ends in words
     * (conductor.py:170-205, adoption §1.3, §2 item 10). Sequence's live bug is
     * askPipeline.ts:307-312 — if the last round emitted tool blocks only,
     * `text` is '' and the user gets an empty answer with no explanation.
     * The transcript refuses to render that as nothing.
     */
    const items = foldTranscript(
      [
        userTurn('u1', 'fix it'),
        assistantTurn('a1', 'u1', {
          text: '',
          work: [workRow('w1', { group: 'run', verb: 'Ran the test suite' })],
        }),
      ],
      null,
    );

    expect(items.map((i) => i.kind)).toEqual(['user', 'work', 'ending']);
    const ending = items.find((i) => i.kind === 'ending');
    expect(ending?.kind === 'ending' && ending.reason).toBe('no-words');
    expect(ending?.kind === 'ending' && ending.text.length).toBeGreaterThan(0);
  });

  it('says a turn was stopped, and does not dress it as a failure', () => {
    // A cancelled turn is not an error. types.ts keeps `stopped` and `error`
    // as separate members of TurnFailure for exactly this render.
    const items = foldTranscript(
      [
        userTurn('u1', 'go'),
        assistantTurn('a1', 'u1', {
          text: 'Partial sen',
          failure: { kind: 'stopped', at: 3 },
        }),
      ],
      null,
    );

    const ending = items.find((i) => i.kind === 'ending');
    expect(ending?.kind === 'ending' && ending.reason).toBe('stopped');
  });

  it('holds the in-flight turn outside the committed list', () => {
    /*
     * types.ts: "A partially streamed answer is not a turn yet". The fold
     * renders it, but it is never spliced into `turns` — so a stream that dies
     * mid-sentence cannot leave half a sentence that reloads as fact.
     */
    const items = foldTranscript([userTurn('u1', 'go')], inFlight({ text: 'Two call' }));

    expect(items.map((i) => i.kind)).toEqual(['user', 'turn-elapsed', 'prose']);
    const prose = items.find((i) => i.kind === 'prose');
    expect(prose?.kind === 'prose' && prose.streaming).toBe(true);
  });

  it('renders nothing for an in-flight turn that has produced nothing yet', () => {
    /*
     * `phase: 'queued'` is the gap between send and the first server event.
     * The composer already shows stop; the transcript stays honest and empty,
     * because a row can never be invented — WorkRow.from names the event that
     * produced it, and no event has arrived.
     */
    expect(foldTranscript([], inFlight({ text: '', phase: 'queued', work: [] }))).toEqual([
      expect.objectContaining({ kind: 'turn-elapsed', live: true }),
    ]);
  });

  it('folds the in-flight work into its streaming prose, live', () => {
    /*
     * Decision 7: the same inline placement holds while the answer streams —
     * the running row lives INSIDE the answer flow it is still earning.
     */
    const items = foldTranscript(
      [userTurn('u1', 'go')],
      inFlight({ text: 'Two call', work: [workRow('w1', { status: 'running', from: 'file:read' })] }),
    );

    expect(items.map((i) => i.kind)).toEqual(['user', 'turn-elapsed', 'phase', 'prose']);
    const prose = items.find((i) => i.kind === 'prose');
    expect(prose?.kind === 'prose' && prose.streaming).toBe(true);
    expect(prose?.kind === 'prose' && prose.work.map((r) => r.id)).toEqual(['w1']);
  });

  it('renders the in-flight stack alone until any prose exists', () => {
    // The surviving detached case: rows precede ANY prose. Once text arrives
    // they move inside it (the test above).
    const items = foldTranscript(
      [userTurn('u1', 'go')],
      inFlight({ text: '', phase: 'streaming', work: [workRow('w1', { status: 'running' })] }),
    );
    expect(items.map((i) => i.kind)).toEqual(['user', 'turn-elapsed', 'phase', 'work']);
  });

  it('gives every item a stable key across two folds of the same input', () => {
    // Keys derived from array position remount a row whenever a row above it
    // is added, which restarts the pulse on every running row in the stack.
    const turns = [userTurn('u1', 'go'), assistantTurn('a1', 'u1', { text: 'done' })];
    expect(foldTranscript(turns, null).map((i) => i.key)).toEqual(
      foldTranscript(turns, null).map((i) => i.key),
    );
    expect(new Set(foldTranscript(turns, null).map((i) => i.key)).size).toBe(2);
  });

  it('emits turn elapsed for committed assistant turns with durationMs', () => {
    const items = foldTranscript(
      [
        userTurn('u1', 'go', { at: 0 }),
        assistantTurn('a1', 'u1', { text: 'done', durationMs: 12_000, at: 12_000 }),
      ],
      null,
    );
    expect(items.map((i) => i.kind)).toContain('turn-elapsed');
    const elapsed = items.find((i) => i.kind === 'turn-elapsed');
    expect(elapsed?.kind === 'turn-elapsed' && elapsed.ms).toBe(12_000);
  });

  it('emits live turn elapsed and phase card while streaming', () => {
    const items = foldTranscript(
      [userTurn('u1', 'go', { at: 0 })],
      inFlight({
        startedAt: 1000,
        work: [
          workRow('w1', {
            status: 'running',
            from: 'canvas:block',
            verb: 'canvas.write_mermaid',
            opens: 'ai-canvas',
          }),
        ],
      }),
      { now: 7000, reasoningProvider: 'deepseek' },
    );
    expect(items.map((i) => i.kind)).toEqual(['user', 'turn-elapsed', 'phase']);
    const phase = items.find((i) => i.kind === 'phase');
    expect(phase?.kind === 'phase' && phase.crumb).toBe('sequence / AI Canvas');
  });

  it('emits edit ledger when proposals resolve', () => {
    const proposal = {
      id: 'p1' as const,
      turnId: 'a1' as const,
      title: null,
      rationale: null,
      status: 'pending' as const,
      verify: null,
      files: [
        {
          path: 'src/x.ts' as const,
          content: 'a\nb\n',
          decision: 'pending' as const,
          diff: null,
          comments: [],
        },
      ],
    };
    const items = foldTranscript(
      [
        userTurn('u1', 'q'),
        assistantTurn('a1', 'u1', {
          text: 'patched',
          evidence: { tools: [], filesRead: [], proposals: ['p1'] },
        }),
      ],
      null,
      { proposals: { p1: proposal } },
    );
    expect(items.some((i) => i.kind === 'edits')).toBe(true);
  });
});

describe('restored-turn honesty — came back from disk', () => {
  it('recognises the structural restored: id prefix', () => {
    expect(isRestoredTurnId('restored:0')).toBe(true);
    expect(isRestoredTurnId('u1')).toBe(false);
  });

  it('inserts ONE honesty note before the first restored turn', () => {
    const items = foldTranscript(
      [
        userTurn('restored:0', 'what does scan.ts do'),
        assistantTurn('restored:1', 'restored:0', { text: 'It walks the repo.', work: [] }),
      ],
      null,
    );
    expect(items[0]).toMatchObject({
      kind: 'restored',
      text: 'Came back from disk — words only. Work and evidence were not saved.',
    });
    expect(items.filter((i) => i.kind === 'restored')).toHaveLength(1);
    expect(items.map((i) => i.kind)).toEqual(['restored', 'user', 'prose']);
  });

  it('names memory trimmed when this ask dropped earlier turns (B3.2)', () => {
    const u = { ...userTurn('u2', 'follow-up'), memoryTrim: { droppedTurns: 12 } };
    const items = foldTranscript([u], null);
    expect(items[0]).toMatchObject({
      kind: 'memory-trim',
      text: 'Memory trimmed — 12 earlier turns were omitted from this ask to save tokens.',
    });
    expect(items.map((i) => i.kind)).toEqual(['memory-trim', 'user']);
  });

  it('names a grounded restore when work/evidence came back', () => {
    const items = foldTranscript(
      [
        userTurn('restored:0', 'q'),
        assistantTurn('restored:1', 'restored:0', {
          text: 'a',
          work: [
            {
              id: 'w1',
              group: 'read',
              verb: 'Read',
              identifier: null,
              outcome: null,
              provenance: null,
              status: 'done',
              from: 'file:read',
              opens: null,
            },
          ],
        }),
      ],
      null,
    );
    expect(items[0]).toMatchObject({
      kind: 'restored',
      text: 'Came back from disk — reloaded from the saved session.',
    });
  });

  it('does not invent a restored note for live turns', () => {
    const items = foldTranscript(
      [userTurn('u1', 'go'), assistantTurn('a1', 'u1', { text: 'done' })],
      null,
    );
    expect(items.every((i) => i.kind !== 'restored')).toBe(true);
  });
});

describe('glyphFor — the row names the event that produced it', () => {
  it('takes the glyph from the stream event, not from a verb string', () => {
    // WorkRow.from is the wire event type. Deriving the glyph from it is what
    // makes "a row can never be invented" true at render time too.
    expect(glyphFor({ from: 'file:read', group: 'read' })).toBe('file');
    expect(glyphFor({ from: 'command:log', group: 'run' })).toBe('terminal');
    expect(glyphFor({ from: 'edit:proposal', group: 'change' })).toBe('code');
    expect(glyphFor({ from: 'advisor', group: 'reason' })).toBe('alert');
  });

  it('falls back to the group when the event does not pick a glyph', () => {
    expect(glyphFor({ from: 'tool:done', group: 'read' })).toBe('search');
    expect(glyphFor({ from: 'tool:done', group: 'run' })).toBe('terminal');
  });
});

describe('formatElapsed — a measured number, formatted, never invented', () => {
  it('reads sub-second in milliseconds', () => {
    expect(formatElapsed(820)).toBe('820ms');
  });

  it('reads seconds with one decimal under ten', () => {
    expect(formatElapsed(7000)).toBe('7.0s');
    expect(formatElapsed(12400)).toBe('12s');
  });

  it('reads minutes and seconds past a minute', () => {
    expect(formatElapsed(64000)).toBe('1m 04s');
  });
});

describe('shouldFollow — the tail threshold that yields to the reader', () => {
  /*
   * MLH/frontend/src/App.tsx:223-232, adoption §2 item 7. v1 has NO autoscroll
   * at all — grep for scrollTop/scrollIntoView across product/ returns zero —
   * and the study calls this the highest user-visible-improvement-per-line item
   * in the document. The threshold exists so that a user who scrolled up to
   * read is not yanked back down by the next delta.
   */
  it('follows while the reader is parked at the bottom', () => {
    expect(shouldFollow({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
  });

  it('follows within 48px of the bottom', () => {
    expect(shouldFollow({ scrollTop: 860, scrollHeight: 1000, clientHeight: 100 })).toBe(true);
  });

  it('stops following once the reader has scrolled away', () => {
    expect(shouldFollow({ scrollTop: 500, scrollHeight: 1000, clientHeight: 100 })).toBe(false);
  });

  it('follows when there is nothing to scroll', () => {
    expect(shouldFollow({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })).toBe(true);
  });
});
