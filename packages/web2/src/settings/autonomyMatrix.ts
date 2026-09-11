/* ══════════════════════════════════════════════════════════════════════════
   B5.2 — AUTONOMY MATRIX (Settings → Workspace)
   packages/web2/src/settings/autonomyMatrix.ts

   One ladder of trust: Plan → Propose → Auto-edit → Full. Each row says what
   happens to FILES and COMMANDS — the only consequences the user is consenting
   to. Settings opt-in is named so Auto-edit / Full never look "always on".

   PURE data + render helpers. Graphite: no hue, compact mono cells.
   ══════════════════════════════════════════════════════════════════════════ */

import type { PermissionMode } from '../state/types';

export type AutonomyCapability =
  | 'read'
  | 'propose'
  | 'writeWithoutAccept'
  | 'runCommands'
  | 'settingsOptIn';

export interface AutonomyMatrixRow {
  mode: PermissionMode;
  label: string;
  /** Short consequence line for the matrix caption. */
  summary: string;
  capabilities: Record<AutonomyCapability, boolean>;
}

/** Weakest first — same order as the composer Permission menu. */
export const AUTONOMY_MATRIX: readonly AutonomyMatrixRow[] = [
  {
    mode: 'plan',
    label: 'Plan',
    summary: 'Reads only. Ends in a written plan.',
    capabilities: {
      read: true,
      propose: false,
      writeWithoutAccept: false,
      runCommands: false,
      settingsOptIn: false,
    },
  },
  {
    mode: 'propose',
    label: 'Propose',
    summary: 'Changes arrive as proposals you accept.',
    capabilities: {
      read: true,
      propose: true,
      writeWithoutAccept: false,
      runCommands: false,
      settingsOptIn: false,
    },
  },
  {
    mode: 'autoEdit',
    label: 'Auto-edit',
    summary: 'Writes files without asking.',
    capabilities: {
      read: true,
      propose: true,
      writeWithoutAccept: true,
      runCommands: false,
      settingsOptIn: true,
    },
  },
  {
    mode: 'full',
    label: 'Full access',
    summary: 'Writes files and runs allowlisted commands.',
    capabilities: {
      read: true,
      propose: true,
      writeWithoutAccept: true,
      runCommands: true,
      settingsOptIn: true,
    },
  },
];

export const AUTONOMY_MATRIX_COLUMNS: readonly {
  key: AutonomyCapability;
  label: string;
}[] = [
  { key: 'read', label: 'Read' },
  { key: 'propose', label: 'Propose edits' },
  { key: 'writeWithoutAccept', label: 'Write without Accept' },
  { key: 'runCommands', label: 'Run commands' },
  { key: 'settingsOptIn', label: 'Needs Settings opt-in' },
];

export function autonomyCellMark(on: boolean): 'yes' | 'no' {
  return on ? 'yes' : 'no';
}
