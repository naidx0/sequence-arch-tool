import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  changeStatsLine,
  deltaOf,
  parseNumstat,
  type FileNumstat,
} from '../server/runChangeStats.js';

const TAB = '\t';
function numstat(rows: string[][]): string {
  return rows.map((r) => r.join(TAB)).join('\n');
}

describe('reading git numstat', () => {
  it('reads added, removed and path', () => {
    const out = parseNumstat(numstat([['3', '1', 'src/a.ts']]));
    assert.deepEqual(out, [{ path: 'src/a.ts', added: 3, removed: 1 }]);
  });

  it('marks a binary file rather than calling it 0 and 0', () => {
    /* "changed nothing" and "cannot be counted in lines" are different facts,
       and a reader who sees 0/0 concludes the first. */
    const out = parseNumstat(numstat([['-', '-', 'docs/logo.png']]));
    assert.equal(out[0]?.binary, true);
    assert.equal(out[0]?.added, 0);
  });

  it('keeps a path containing a tab intact', () => {
    const out = parseNumstat(`1${TAB}0${TAB}src/od${TAB}d.ts`);
    assert.equal(out[0]?.path, `src/od${TAB}d.ts`);
  });

  it('normalises Windows separators, because every other path here is posix', () => {
    const out = parseNumstat(numstat([['1', '0', 'src\\win\\a.ts']]));
    assert.equal(out[0]?.path, 'src/win/a.ts');
  });

  it('skips a malformed line instead of inventing a file', () => {
    const out = parseNumstat(['not a numstat line', numstat([['2', '2', 'ok.ts']])].join('\n'));
    assert.deepEqual(out.map((f) => f.path), ['ok.ts']);
  });

  it('is sorted, so two snapshots compare without re-sorting', () => {
    const out = parseNumstat(numstat([['1', '0', 'z.ts'], ['1', '0', 'a.ts']]));
    assert.deepEqual(out.map((f) => f.path), ['a.ts', 'z.ts']);
  });

  it('answers empty for an empty diff, not a one-element array', () => {
    assert.deepEqual(parseNumstat(''), []);
    assert.deepEqual(parseNumstat('\n\n'), []);
  });
});

describe('what a run actually changed', () => {
  const f = (path: string, added: number, removed: number): FileNumstat => ({ path, added, removed });

  it('credits a run with nothing when the tree did not move', () => {
    const snap = [f('a.ts', 5, 2)];
    assert.deepEqual(deltaOf(snap, snap), { files: 0, added: 0, removed: 0, uncountedFiles: 0 });
  });

  it('does NOT credit a run with edits that were already there when it started', () => {
    /* The whole reason this is a delta. Reporting the end state would hand a
       run every dirty file it happened to find. */
    const before = [f('already-dirty.ts', 40, 10)];
    const after = [f('already-dirty.ts', 40, 10), f('the-run.ts', 3, 0)];
    const d = deltaOf(before, after);
    assert.equal(d.files, 1);
    assert.equal(d.added, 3);
  });

  it('counts only the lines added DURING the window on a file already dirty', () => {
    const d = deltaOf([f('a.ts', 10, 0)], [f('a.ts', 25, 4)]);
    assert.equal(d.files, 1);
    assert.equal(d.added, 15);
    assert.equal(d.removed, 4);
  });

  it('counts a file that went back to clean, which falls out of the diff entirely', () => {
    /* A reverted file is absent from the second snapshot. Iterating only the
       second snapshot would report the run as having changed nothing. */
    const d = deltaOf([f('reverted.ts', 8, 8)], []);
    assert.equal(d.files, 1);
  });

  it('never reports a negative count', () => {
    const d = deltaOf([f('a.ts', 100, 0)], [f('a.ts', 1, 0)]);
    assert.equal(d.files, 1);
    assert.equal(d.added, 0);
    assert.ok(d.added >= 0 && d.removed >= 0);
  });

  it('counts a binary file as changed without counting lines it does not have', () => {
    const d = deltaOf([], [{ path: 'logo.png', added: 0, removed: 0, binary: true }]);
    assert.equal(d.files, 1);
    assert.equal(d.uncountedFiles, 1);
    assert.equal(d.added, 0);
  });

  it('carries the overlap flag when the window was shared, and omits it otherwise', () => {
    assert.equal(deltaOf([], [f('a.ts', 1, 0)], true).overlapping, true);
    assert.equal(deltaOf([], [f('a.ts', 1, 0)]).overlapping, undefined);
  });
});

describe('an untracked file is a real change, not a zero', () => {
  it('counts a newly created file as changed with its lines added', () => {
    /* Regression, found by probing the real repository: untracked files were
       reported 0/0, so a run whose whole output was a new file read as
       "1 file" however much it wrote. */
    const d = deltaOf([], [{ path: 'new.ts', added: 42, removed: 0 }]);
    assert.equal(d.files, 1);
    assert.equal(d.added, 42);
  });

  it('sees an edit to an already-untracked file', () => {
    /* The worse half of the same bug: a run touching only untracked files
       reported "no files changed". */
    const d = deltaOf([{ path: 'new.ts', added: 3, removed: 0 }], [{ path: 'new.ts', added: 90, removed: 0 }]);
    assert.equal(d.files, 1);
    assert.equal(d.added, 87);
  });

  it('an over-cap file counts as changed but not as zero lines', () => {
    const d = deltaOf([], [{ path: 'huge.log', added: 0, removed: 0, uncounted: true }]);
    assert.equal(d.files, 1);
    assert.equal(d.uncountedFiles, 1);
    assert.equal(d.added, 0);
  });

  it('a file that becomes countable is a change, even with the same counts', () => {
    const d = deltaOf(
      [{ path: 'a.ts', added: 0, removed: 0, uncounted: true }],
      [{ path: 'a.ts', added: 0, removed: 0 }],
    );
    assert.equal(d.files, 1);
  });
});

describe('the line a run row shows', () => {
  it('says nothing at all when there is no measurement, rather than zero', () => {
    /* Zero is a measurement. Printing it for "not measured yet" is the exact
       shape of guessing that the grounded rule exists to prevent. */
    assert.equal(changeStatsLine(null), null);
  });

  it('distinguishes measured-zero from not-measured', () => {
    assert.equal(changeStatsLine({ files: 0, added: 0, removed: 0, uncountedFiles: 0 }), 'no files changed');
  });

  it('reads as a person would say it', () => {
    assert.equal(changeStatsLine({ files: 3, added: 40, removed: 12, uncountedFiles: 0 }), '3 files +40 -12');
    assert.equal(changeStatsLine({ files: 1, added: 2, removed: 0, uncountedFiles: 0 }), '1 file +2');
  });

  it('says a file was NOT COUNTED rather than implying it changed nothing', () => {
    assert.equal(
      changeStatsLine({ files: 2, added: 1, removed: 0, uncountedFiles: 1 }),
      '2 files +1 1 not counted',
    );
  });

  it('THE CAVEAT TRAVELS WITH THE NUMBER', () => {
    /* Not in a tooltip, not in a footnote: a number that may include another
       run's edits has to carry that where it is read. */
    assert.equal(
      changeStatsLine({ files: 5, added: 10, removed: 1, overlapping: true, uncountedFiles: 0 }),
      '5 files +10 -1 (shared with another run)',
    );
  });
});
