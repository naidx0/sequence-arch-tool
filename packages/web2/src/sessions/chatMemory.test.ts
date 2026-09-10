import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { foldTranscript } from '../chat/transcriptModel';

import type { Turn, WorkRow } from '../state/types';

import { fromChatMemory, toChatMemory, worthPersisting } from './chatMemory';

/**
 * THE TRANSCRIPT, ACROSS A RELOAD — P3 evidence memory v2.
 */

function user(text: string, at = 1_000): Turn {
  return {
    id: 'u',
    role: 'user',
    text,
    intents: [],
    chips: [],
    contextLines: [],
    surface: null,
    at,
  };
}

const WORK: WorkRow = {
  id: 'w1',
  group: 'read',
  verb: 'Read the graph',
  identifier: 'archgraph',
  outcome: { kind: 'count', n: 12, unit: 'nodes' },
  provenance: 'measured',
  status: 'done',
  from: 'file:read',
  opens: 'canvas',
};

type AssistantTurn = Extract<Turn, { role: 'assistant' }>;

function assistant(text: string, at = 2_000, grounded = true): AssistantTurn {
  return {
    id: 'a',
    role: 'assistant',
    replyTo: 'u',
    text,
    work: grounded ? [WORK] : [],
    effect: { kind: 'answer' },
    coverage: grounded
      ? { edgesSeen: 3, edgesTotal: 10, packagesSeen: ['pkg'], packagesMissed: [] }
      : null,
    evidence: grounded
      ? {
          tools: [{ id: 't1', name: 'read_file', text: 'body', evidence: 'src/a.ts:1', at: 2_000 }],
          filesRead: ['src/a.ts'],
          proposals: [],
        }
      : { tools: [], filesRead: [], proposals: [] },
    usage: null,
    metrics: null,
    contextBreakdown: null,
    advisor: null,
    diagram: null,
    source: null,
    runId: null,
    failure: null,
    at,
  };
}

describe('what is written', () => {
  it('carries the conversation as version 2', () => {
    const memory = toChatMemory('s1', [user('question'), assistant('answer')]);
    expect(memory.version).toBe(2);
    expect(memory.sessionId).toBe('s1');
    expect(memory.turns.map((t) => [t.role, t.text])).toEqual([
      ['user', 'question'],
      ['assistant', 'answer'],
    ]);
  });

  it('writes work, evidence and coverage on assistant turns', () => {
    const memory = toChatMemory('s1', [assistant('answer')]);
    expect(memory.version).toBe(2);
    if (memory.version !== 2) throw new Error('unreachable');
    const turn = memory.turns[0]!;
    expect(turn.role).toBe('assistant');
    expect(turn.work).toEqual([WORK]);
    expect(turn.evidence?.filesRead).toEqual(['src/a.ts']);
    expect(turn.coverage?.edgesSeen).toBe(3);
  });

  it('writes the time as ISO, because a human reads this file', () => {
    expect(toChatMemory('s1', [user('q', 0)]).turns[0]!.at).toBe('1970-01-01T00:00:00.000Z');
  });

  it('drops empty turns', () => {
    expect(toChatMemory('s1', [user('  '), assistant('real')]).turns).toHaveLength(1);
  });
});

describe('WHAT COMES BACK', () => {
  it('restores the words', () => {
    const restored = fromChatMemory(toChatMemory('s1', [user('question'), assistant('answer')]));
    expect(restored.map((t) => t.text)).toEqual(['question', 'answer']);
  });

  it('RESTORES WORK, EVIDENCE AND COVERAGE from a v2 file', () => {
    const restored = fromChatMemory(toChatMemory('s1', [assistant('answer')]));
    const turn = restored[0] as Extract<Turn, { role: 'assistant' }>;
    expect(turn.work).toEqual([WORK]);
    expect(turn.coverage?.edgesTotal).toBe(10);
    expect(turn.evidence.filesRead).toEqual(['src/a.ts']);
    expect(turn.evidence.tools[0]?.name).toBe('read_file');
  });

  it('round-trips command exit stdout on work rows (C1.5)', () => {
    const withCmd: AssistantTurn = {
      ...assistant('ran tests'),
      work: [
        {
          id: 'c1',
          group: 'run',
          verb: 'Ran a command',
          identifier: 'pnpm test',
          outcome: { kind: 'exit', code: 0, output: 'ok\n' },
          provenance: 'measured',
          status: 'done',
          from: 'command:log',
          opens: null,
        },
      ],
    };
    const restored = fromChatMemory(toChatMemory('s1', [withCmd]));
    const turn = restored[0] as AssistantTurn;
    expect(turn.work[0]?.outcome).toEqual({ kind: 'exit', code: 0, output: 'ok\n' });
  });

  it('v1 prose files still restore empty work — honest absence', () => {
    const restored = fromChatMemory({
      version: 1,
      sessionId: 's1',
      turns: [{ role: 'assistant', text: 'answer only' }],
    });
    const turn = restored[0] as Extract<Turn, { role: 'assistant' }>;
    expect(turn.work).toEqual([]);
    expect(turn.coverage).toBeNull();
    expect(turn.evidence).toEqual({ tools: [], filesRead: [], proposals: [] });
  });

  it('gives restored turns ids that cannot collide with live ones', () => {
    const restored = fromChatMemory(toChatMemory('s1', [user('q'), assistant('a')]));
    expect(restored.map((t) => t.id)).toEqual(['restored:0', 'restored:1']);
  });
});

describe('a malformed transcript costs the transcript, never the session', () => {
  it('reads anything unreadable as an empty conversation', () => {
    for (const bad of [null, undefined, 'text', 42, {}, { version: 3, turns: [] }, { version: 1 }]) {
      expect(fromChatMemory(bad)).toEqual([]);
    }
  });

  it('skips individual bad turns and keeps the good ones', () => {
    const restored = fromChatMemory({
      version: 2,
      sessionId: 's1',
      turns: [
        { role: 'user', text: 'keep me' },
        { role: 'wizard', text: 'not a role' },
        { role: 'assistant', text: '' },
        null,
        { role: 'assistant', text: 'keep me too' },
      ],
    });
    expect(restored.map((t) => t.text)).toEqual(['keep me', 'keep me too']);
  });

  it('an unparseable timestamp becomes 0 rather than NaN', () => {
    const restored = fromChatMemory({
      version: 1,
      sessionId: 's',
      turns: [{ role: 'user', text: 'q', at: 'not a date' }],
    });
    expect(restored[0]!.at).toBe(0);
  });
});

describe('AN EMPTY TRANSCRIPT IS NOT WORTH WRITING', () => {
  it('refuses to persist nothing', () => {
    expect(worthPersisting([])).toBe(false);
    expect(worthPersisting([user('   ')])).toBe(false);
  });

  it('persists a real conversation', () => {
    expect(worthPersisting([user('question')])).toBe(true);
  });
});

describe('A RESTORED TURN IS A REAL TURN, or the transcript cannot render it', () => {
  const STORED = {
    version: 1 as const,
    sessionId: 's1',
    turns: [
      { role: 'user', text: 'question', at: '2026-01-01T00:00:00.000Z' },
      { role: 'assistant', text: 'answer', at: '2026-01-01T00:00:01.000Z' },
    ],
  };

  it('foldTranscript accepts a restored conversation', () => {
    expect(() => foldTranscript(fromChatMemory(STORED), null)).not.toThrow();
  });

  it('restored assistant work is an array foldTranscript can filter', () => {
    const answer = fromChatMemory(STORED).find((t) => t.role === 'assistant');
    expect(answer && answer.role === 'assistant' && Array.isArray(answer.work)).toBe(true);
  });
});

describe('the on-disk path the sessions client writes', () => {
  it('matches the shape sessionsStore reads', () => {
    /* Smoke: toChatMemory output is JSON-serializable. */
    const memory = toChatMemory('session-1', [user('q'), assistant('a')]);
    expect(() => JSON.stringify(memory)).not.toThrow();
    expect(JSON.parse(JSON.stringify(memory)).version).toBe(2);
  });

  it('the module file still exists where connect imports it', () => {
    const src = readFileSync(resolve(import.meta.dirname, 'chatMemory.ts'), 'utf8');
    expect(src).toContain('version: 2');
  });
});
