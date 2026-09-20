import { describe, expect, it } from 'vitest';

import type { Turn, WorkRow } from '../state/types';

import {
  HISTORY_CAP,
  HISTORY_WORK_CAP,
  askHistory,
  askHistoryMeta,
  summarizeHistoryEvidence,
  summarizeHistoryWork,
} from './askHistory';

/**
 * CONVERSATION HISTORY — prose + grounded prior work (B3.1).
 *
 * The second message in any thread was answered as if it were the first. Ask
 * "what does scan.ts do", then "and its callers?", and the model got the
 * second question with nothing to resolve "its" against.
 *
 * Chat memory v2 already kept work/evidence on disk; history used to strip to
 * role+text, so follow-ups lost grounded tool work. B3.1 puts compact verbs
 * and paths on the wire.
 */

function user(text: string, id = text): Turn {
  return {
    id,
    role: 'user',
    text,
    intents: [],
    chips: [],
    contextLines: [],
    surface: null,
    at: 0,
  } as unknown as Turn;
}

function workRow(verb: string, extras: Partial<WorkRow> = {}): WorkRow {
  return {
    id: verb,
    group: 'read',
    verb,
    identifier: null,
    outcome: null,
    provenance: null,
    status: 'done',
    from: 'tool:done',
    opens: null,
    ...extras,
  };
}

function assistant(
  text: string,
  id = text,
  extras: {
    work?: WorkRow[];
    evidence?: {
      tools?: { id: string; name: string; text: string; evidence: string | null; at: number }[];
      filesRead?: string[];
      proposals?: string[];
    };
  } = {},
): Turn {
  return {
    id,
    role: 'assistant',
    replyTo: 'x',
    text,
    work: extras.work ?? [],
    effect: null,
    coverage: null,
    evidence: extras.evidence ?? { tools: [], filesRead: [], proposals: [] },
    usage: null,
    at: 0,
  } as unknown as Turn;
}

describe('what goes on the wire', () => {
  it('carries both roles, in order', () => {
    const out = askHistory([user('what does scan.ts do'), assistant('It walks the repo.')]);
    expect(out).toEqual([
      { role: 'user', text: 'what does scan.ts do' },
      { role: 'assistant', text: 'It walks the repo.' },
    ]);
  });

  it('user turns stay role+text only', () => {
    const out = askHistory([user('hi'), assistant('hello')]);
    expect(Object.keys(out[0]!).sort()).toEqual(['role', 'text']);
  });

  it('assistant turns carry compact work + evidence when present (B3.1)', () => {
    const out = askHistory([
      user('what calls X'),
      assistant('Gateway → orders.', 'a1', {
        work: [workRow('Read the graph', { identifier: 'orders' }), workRow('Explored 3 files')],
        evidence: {
          tools: [{ id: 't1', name: 'read_file', text: '...', evidence: null, at: 1 }],
          filesRead: ['gateway/src/routes/orders.ts'],
          proposals: [],
        },
      }),
    ]);
    expect(out[1]).toEqual({
      role: 'assistant',
      text: 'Gateway → orders.',
      work: ['Read the graph (orders)', 'Explored 3 files'],
      evidence: {
        filesRead: ['gateway/src/routes/orders.ts'],
        tools: ['read_file'],
      },
    });
  });

  it('omits running work rows and empty evidence', () => {
    const out = askHistory([
      assistant('Still thinking.', 'a', {
        work: [workRow('Searching', { status: 'running' })],
        evidence: { tools: [], filesRead: [], proposals: [] },
      }),
    ]);
    expect(out[0]).toEqual({ role: 'assistant', text: 'Still thinking.' });
  });

  it('drops turns with no text', () => {
    /* A chip-only send, or an assistant turn that produced only tool work.
       "User:" with nothing after it tells the model a question was asked and
       then withheld. */
    const out = askHistory([user('real'), user('   ', 'blank'), assistant('', 'empty')]);
    expect(out).toEqual([{ role: 'user', text: 'real' }]);
  });

  it('KEEPS THE LAST N, NOT THE FIRST', () => {
    const many = Array.from({ length: 50 }, (_, i) => user(`q${i}`, `q${i}`));
    const out = askHistory(many);
    expect(out).toHaveLength(HISTORY_CAP);
    expect(out[out.length - 1]!.text).toBe('q49');
    expect(out[0]!.text).toBe('q30');
  });

  it('reports how many turns the cap dropped (B3.2)', () => {
    const many = Array.from({ length: 50 }, (_, i) => user(`q${i}`, `q${i}`));
    const meta = askHistoryMeta(many);
    expect(meta.turns).toHaveLength(HISTORY_CAP);
    expect(meta.droppedTurns).toBe(30);
  });

  it('droppedTurns is 0 when under the cap', () => {
    expect(askHistoryMeta([user('a'), assistant('b')]).droppedTurns).toBe(0);
  });

  it('mirrors the SERVER cap, and the number is named', () => {
    expect(HISTORY_CAP).toBe(20);
  });

  it('an empty thread sends an empty history, not undefined-shaped junk', () => {
    expect(askHistory([])).toEqual([]);
  });

  it('a thread of nothing but blanks sends nothing', () => {
    expect(askHistory([user('  ', 'a'), assistant('', 'b')])).toEqual([]);
  });
});

describe('summarize helpers', () => {
  it('caps work verbs', () => {
    const many = Array.from({ length: 30 }, (_, i) => workRow(`Verb ${i}`));
    expect(summarizeHistoryWork(many)).toHaveLength(HISTORY_WORK_CAP);
  });

  it('returns undefined evidence when nothing was grounded', () => {
    expect(summarizeHistoryEvidence({ tools: [], filesRead: [], proposals: [] })).toBeUndefined();
  });
});
