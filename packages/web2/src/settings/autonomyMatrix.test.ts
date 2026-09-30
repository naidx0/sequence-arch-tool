import { describe, expect, it } from 'vitest';

import {
  AUTONOMY_MATRIX,
  AUTONOMY_MATRIX_COLUMNS,
  autonomyCellMark,
} from './autonomyMatrix';

describe('B5.2 autonomy matrix', () => {
  /*
   * TWO RUNGS, not four. Owner, 2026-09-13: "teach mode, plan mode, build mode
   * … it should be pretty simple." `plan` and `propose` both STAGED, and
   * `autoEdit` and `full` both APPLIED — four names for two behaviours, which
   * is how a reader ends up unable to say what the mode they are in will do.
   * Teach rides beside these as its own flag, so the composer shows three rows
   * and this matrix has two.
   */
  it('lists Plan → Build in trust order', () => {
    expect(AUTONOMY_MATRIX.map((r) => r.mode)).toEqual(['plan', 'build']);
  });

  it('PLAN STAGES AND NEVER RUNS — and the engine agrees with this row', () => {
    /*
     * THE CELL THAT USED TO BE A LIE. `askTools.ts` records that `propose`, the
     * old default, fell through to the full belt with `run_command` on it while
     * this matrix printed `runCommands: false` and the composer promised
     * "changes arrive as proposals you accept". Two surfaces asserting a
     * consent the engine never collected.
     *
     * Plan inherits propose's REFUSAL, not its hole: the belt gate is now a
     * membership test on `build` alone, so every other value — including one
     * this build has never heard of — loses the shell.
     */
    const plan = AUTONOMY_MATRIX.find((r) => r.mode === 'plan')!;
    expect(plan.capabilities).toEqual({
      read: true,
      propose: true,
      writeWithoutAccept: false,
      runCommands: false,
      settingsOptIn: false,
    });
  });

  it('BUILD WRITES AND RUNS, and is the only row that needs a Settings opt-in', () => {
    /* "Build mode is auto mode, full capabilities, full permissions — you say
       yes and it just goes." It is opt-in precisely because it is the one mode
       whose consequences an Accept cannot take back. */
    const build = AUTONOMY_MATRIX.find((r) => r.mode === 'build')!;
    expect(build.capabilities).toEqual({
      read: true,
      propose: true,
      writeWithoutAccept: true,
      runCommands: true,
      settingsOptIn: true,
    });
    const optIn = AUTONOMY_MATRIX.filter((r) => r.capabilities.settingsOptIn).map((r) => r.mode);
    expect(optIn).toEqual(['build']);
  });

  it('EXACTLY ONE ROW MAY RUN COMMANDS — the boundary, asserted as a count', () => {
    /* Stated as a count rather than per-row so that ADDING a mode that runs
       commands fails here, which naming each row individually would not. */
    const runners = AUTONOMY_MATRIX.filter((r) => r.capabilities.runCommands).map((r) => r.mode);
    expect(runners).toEqual(['build']);
  });

  it('columns cover every capability key exactly once', () => {
    const keys = AUTONOMY_MATRIX_COLUMNS.map((c) => c.key);
    expect(keys).toEqual(['read', 'propose', 'writeWithoutAccept', 'runCommands', 'settingsOptIn']);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('cell marks are honest yes/no, not emoji', () => {
    expect(autonomyCellMark(true)).toBe('yes');
    expect(autonomyCellMark(false)).toBe('no');
  });
});
