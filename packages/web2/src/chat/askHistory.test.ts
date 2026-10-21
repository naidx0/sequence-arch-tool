import { describe, expect, it } from 'vitest';

import type { AgentRun } from '../agents/agentRuns';
import type { Turn, WorkRow } from '../state/types';

import {
  HISTORY_CAP,
  HISTORY_WORK_CAP,
  askHistory,
  askHistoryMeta,
  askHistoryMetaWithRuns,
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

function claudeRun(prompt: string, reply: string, startedAt: number, over: Partial<AgentRun> = {}): AgentRun {
  return {
    id: `run-${startedAt}`,
    sessionId: 'chat',
    agentRef: 'claude',
    nodeId: null,
    nodeLabel: null,
    prompt,
    status: 'done',
    startedAt,
    endedAt: startedAt + 5,
    items: [{ kind: 'message', id: 'm0', text: reply }],
    approvals: [],
    error: null,
    ...over,
  } as AgentRun;
}

describe('askHistoryMetaWithRuns (A7)', () => {
  it('with one Claude run then a local ask, history includes the Claude reply, ordered by time', () => {
    const turns = [{ ...user('earlier question'), at: 10 } as Turn, { ...assistant('earlier answer'), at: 11 } as Turn];
    const out = askHistoryMetaWithRuns(turns, [claudeRun('what does scan.ts do', 'It walks the repo.', 100)]);
    expect(out.turns).toEqual([
      { role: 'user', text: 'earlier question' },
      { role: 'assistant', text: 'earlier answer' },
      { role: 'user', text: 'what does scan.ts do' },
      { role: 'assistant', text: 'It walks the repo.', agent: 'claude' },
    ]);
    expect(out.droppedTurns).toBe(0);
  });

  it('places a run between the local turns it happened between', () => {
    const turns = [{ ...user('a'), at: 1 } as Turn, { ...assistant('b'), at: 2 } as Turn, { ...user('c'), at: 300 } as Turn, { ...assistant('d'), at: 301 } as Turn];
    const out = askHistoryMetaWithRuns(turns, [claudeRun('q', 'r', 100)]);
    expect(out.turns.map((t) => t.text)).toEqual(['a', 'b', 'q', 'r', 'c', 'd']);
  });

  it('is capped by HISTORY_CAP from the newest end and counts what it dropped', () => {
    const runs = Array.from({ length: 15 }, (_, i) => claudeRun(`q${i}`, `r${i}`, 100 + i * 10));
    const out = askHistoryMetaWithRuns([], runs);
    expect(out.turns).toHaveLength(HISTORY_CAP);
    expect(out.turns.at(-1)).toMatchObject({ text: 'r14', agent: 'claude' });
    expect(out.droppedTurns).toBe(30 - HISTORY_CAP);
  });

  it('carries final messages only: not a running, failed or compaction run, and a codex run is labelled codex', () => {
    const out = askHistoryMetaWithRuns([], [
      claudeRun('q1', 'still going', 1, { status: 'running', endedAt: null }),
      claudeRun('q2', 'oops', 2, { status: 'failed' }),
      claudeRun('/compact', 'summary', 3, { operation: 'compact' }),
      claudeRun('q4', 'tools then text', 4, { agentRef: 'codex', items: [{ kind: 'message', id: 'm0', text: 'early words' }, { kind: 'tool', id: 't', title: 'Read x', toolKind: 'read', status: 'done', startedAt: 4, endedAt: 4, changes: [], diffs: [], output: null }, { kind: 'message', id: 'm2', text: 'the answer' }] }),
    ]);
    expect(out.turns).toEqual([{ role: 'user', text: 'q4' }, { role: 'assistant', text: 'the answer', agent: 'codex' }]);
  });

  it('with no runs it is askHistoryMeta', () => {
    const turns = [user('hi'), assistant('hello')];
    expect(askHistoryMetaWithRuns(turns, [])).toEqual(askHistoryMeta(turns));
  });
});
