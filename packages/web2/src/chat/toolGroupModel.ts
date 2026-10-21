/* ══════════════════════════════════════════════════════════════════════════
   WHICH TOOL CALLS FOLD TOGETHER, AND WHAT THE FOLD SAYS
   packages/web2/src/chat/toolGroupModel.ts

   Pure, so the grouping and the summary are locked without React. Focused mode folds a run of consecutive calls into
   one row ("Read 3 files, ran 2 commands"); Detailed folds nothing. A call that failed is never folded: it stays its
   own row with its error, so a failure cannot hide inside a summary.
   ══════════════════════════════════════════════════════════════════════════ */

import { foldSummary } from './commandLabel';
import type { ToolDetail } from '../settings/toolDetailPreference';

/** The kind a Sequence tool name stands for, in the vocabulary `foldSummary` counts. */
export function toolKindOfName(name: string): string | null {
  if (name === 'run_command') return 'execute';
  if (name === 'read_file' || name === 'read_topology') return 'read';
  if (name === 'search_files' || name === 'search') return 'search';
  if (name === 'fetch' || name === 'web_fetch') return 'fetch';
  if (name === 'propose_files' || name === 'edit_file' || name === 'write_file' || /^(board|canvas|diagram)\./.test(name) || name === 'propose_chart' || name === 'propose_topology') return 'edit';
  return null;
}

export interface GroupCall {
  toolKind: string | null;
  files?: number;
}

/** "Read 3 files, ran 2 commands, edited 1 file". */
export function summarizeCalls(calls: readonly GroupCall[]): string {
  return foldSummary(calls);
}

/**
 * Cut `items` into runs. In Focused, consecutive items that `canFold` share a run; any other item is a run of its own.
 * In Detailed every item is a run of its own. The order never changes.
 */
export function groupConsecutive<T>(items: readonly T[], mode: ToolDetail, canFold: (item: T) => boolean): T[][] {
  const out: T[][] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (mode === 'focused' && canFold(item) && last && canFold(last[0]!)) last.push(item);
    else out.push([item]);
  }
  return out;
}
