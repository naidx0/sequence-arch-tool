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
    summary: 'Draws and drafts. File changes arrive as proposals you accept.',
    capabilities: {
      read: true,
      propose: true,
      writeWithoutAccept: false,
      /*
       * FALSE, AND THE ENGINE AGREES. This cell is the one that was a lie
       * before: `propose` said false here while `askTools.ts` handed it the
       * shell. That gate is now a membership test on `build` alone, so this
       * row and the belt say the same thing.
       */
      runCommands: false,
      settingsOptIn: false,
    },
  },
  {
    mode: 'build',
    label: 'Build',
    summary: 'Writes files and runs allowlisted commands without asking.',
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
