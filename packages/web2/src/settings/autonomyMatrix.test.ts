import { describe, expect, it } from 'vitest';

import {
  AUTONOMY_MATRIX,
  AUTONOMY_MATRIX_COLUMNS,
  autonomyCellMark,
} from './autonomyMatrix';

describe('B5.2 autonomy matrix', () => {
  it('lists Plan → Propose → Auto-edit → Full in trust order', () => {
    expect(AUTONOMY_MATRIX.map((r) => r.mode)).toEqual(['plan', 'propose', 'autoEdit', 'full']);
  });

  it('Plan is read-only and never needs Settings opt-in', () => {
    const plan = AUTONOMY_MATRIX.find((r) => r.mode === 'plan')!;
    expect(plan.capabilities).toEqual({
      read: true,
      propose: false,
      writeWithoutAccept: false,
      runCommands: false,
      settingsOptIn: false,
    });
  });

  it('Propose can propose but not write or run', () => {
    const propose = AUTONOMY_MATRIX.find((r) => r.mode === 'propose')!;
    expect(propose.capabilities.propose).toBe(true);
    expect(propose.capabilities.writeWithoutAccept).toBe(false);
    expect(propose.capabilities.runCommands).toBe(false);
    expect(propose.capabilities.settingsOptIn).toBe(false);
  });

  it('Auto-edit writes without Accept; Full also runs commands; both opt-in', () => {
    const auto = AUTONOMY_MATRIX.find((r) => r.mode === 'autoEdit')!;
    const full = AUTONOMY_MATRIX.find((r) => r.mode === 'full')!;
    expect(auto.capabilities.writeWithoutAccept).toBe(true);
    expect(auto.capabilities.runCommands).toBe(false);
    expect(auto.capabilities.settingsOptIn).toBe(true);
    expect(full.capabilities.writeWithoutAccept).toBe(true);
    expect(full.capabilities.runCommands).toBe(true);
    expect(full.capabilities.settingsOptIn).toBe(true);
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
