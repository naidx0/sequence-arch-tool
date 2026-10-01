import { describe, expect, it } from 'vitest';

import type { CheckpointRecord, RestorePlan } from '@sequence/api-types';

import { planReading, rewindRows, whenText } from './rewindModel';

const NOW = 1_700_000_000_000;

function plan(over: Partial<RestorePlan> = {}): RestorePlan {
  return {
    ok: true,
    sessionId: 's',
    seq: 1,
    requestedScope: 'code',
    touches: { code: true, conversation: false },
    writes: [],
    deletes: [],
    unchanged: [],
    unrecoverable: [],
    notes: [],
    ...over,
  };
}

function cp(over: Partial<CheckpointRecord> = {}): CheckpointRecord {
  return { seq: 1, at: NOW, sessionId: 's', files: [], ...over };
}

describe('how long ago', () => {
  it('says just now under a minute, never "0 min ago"', () => {
    expect(whenText(NOW - 30_000, NOW)).toBe('just now');
  });

  it('a clock that ran backwards is not information', () => {
    expect(whenText(NOW + 5_000, NOW)).toBe('just now');
  });

  it('steps up a unit only when the coarser one is true', () => {
    expect(whenText(NOW - 59 * 60_000, NOW)).toBe('59 min ago');
    expect(whenText(NOW - 60 * 60_000, NOW)).toBe('1 hr ago');
    expect(whenText(NOW - 23 * 3_600_000, NOW)).toBe('23 hr ago');
    expect(whenText(NOW - 24 * 3_600_000, NOW)).toBe('yesterday');
    expect(whenText(NOW - 48 * 3_600_000, NOW)).toBe('2 days ago');
  });
});

describe('the list', () => {
  it('is NEWEST FIRST, because undo means the last thing', () => {
    const rows = rewindRows([cp({ seq: 1 }), cp({ seq: 2 }), cp({ seq: 3 })], NOW);
    expect(rows.map((r) => r.seq)).toEqual([3, 2, 1]);
  });

  it('never invents a label', () => {
    expect(rewindRows([cp({ label: '   ' })], NOW)[0].label).toBeNull();
    expect(rewindRows([cp()], NOW)[0].label).toBeNull();
    expect(rewindRows([cp({ label: 'after the refactor' })], NOW)[0].label).toBe('after the refactor');
  });

  it('tells absent apart from empty for the conversation', () => {
    /* The wire type is explicit that these are different states, and a
       restore that claimed to put back a conversation it never captured
       would be the exact lie the `undefined` case exists to prevent. */
    expect(rewindRows([cp()], NOW)[0].conversation).toBe('not captured');
    expect(rewindRows([cp({ conversation: [] })], NOW)[0].conversation).toBe('empty');
    expect(rewindRows([cp({ conversation: [{ role: 'user', text: 'hi' }] })], NOW)[0].conversation).toBe('captured');
  });
});

describe('reading a plan before doing it', () => {
  it('refuses when a blob was swept, and NAMES the file', () => {
    const r = planReading(plan({ unrecoverable: ['src/a.ts'], writes: [{ path: 'src/b.ts', bytes: 1 }] } as Partial<RestorePlan>));
    expect(r.canRestore).toBe(false);
    expect(r.lines).toContain('src/a.ts');
    expect(r.refusal).toMatch(/gone/);
  });

  it('an unrestorable plan does not get a Restore button just because it has writes', () => {
    /* The engine refuses outright rather than restoring the rest: a partially
       restored tree is worse than none. The button must agree. */
    const r = planReading(plan({ ok: false, error: 'no such checkpoint' }));
    expect(r.canRestore).toBe(false);
    expect(r.lines).toContain('no such checkpoint');
  });

  it('"already matches" is an answer, not an error, and still leaves the button off', () => {
    const r = planReading(plan({ unchanged: ['src/a.ts'] }));
    expect(r.canRestore).toBe(false);
    expect(r.headline).toMatch(/already matches/);
    expect(r.headline).not.toMatch(/cannot|error|failed/i);
  });

  it('makes the VERB agree, not just the noun', () => {
    /* Caught on screen, not here: the panel read "1 file already match". */
    expect(planReading(plan({ unchanged: ['a'] })).lines[0]).toBe('1 file already matches and will not be touched.');
    expect(planReading(plan({ unchanged: ['a', 'b'] })).lines[0]).toBe('2 files already match and will not be touched.');
  });

  it('counts what will actually move, and says files not writes', () => {
    const r = planReading(
      plan({
        writes: [{ path: 'a', bytes: 1 }, { path: 'b', bytes: 1 }] as RestorePlan['writes'],
        deletes: ['c'],
      }),
    );
    expect(r.canRestore).toBe(true);
    expect(r.headline).toBe('This will change 3 files.');
    expect(r.lines[0]).toBe('Put back 2 files.');
    expect(r.lines[1]).toBe('Delete 1 file created since.');
  });

  it('singular and plural are both correct', () => {
    const r = planReading(plan({ writes: [{ path: 'a', bytes: 1 }] as RestorePlan['writes'] }));
    expect(r.headline).toBe('This will change 1 file.');
    expect(r.lines[0]).toBe('Put back 1 file.');
  });

  it("passes the server's notes through verbatim rather than restating them", () => {
    const r = planReading(
      plan({ writes: [{ path: 'a', bytes: 1 }] as RestorePlan['writes'], notes: ['scope narrowed to code'] }),
    );
    expect(r.lines).toContain('scope narrowed to code');
  });

  it('a conversation-only restore still counts as something to do', () => {
    const r = planReading(plan({ conversationTurns: 4 }));
    expect(r.canRestore).toBe(true);
    expect(r.lines).toContain('Set the conversation back to 4 turns.');
  });

  it('no plan is not a refusal to explain away', () => {
    const r = planReading(null);
    expect(r.canRestore).toBe(false);
    expect(r.lines).toEqual([]);
  });
});
