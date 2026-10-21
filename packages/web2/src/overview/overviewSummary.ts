/* The one line each overview section says about itself. PURE: counts in, words out.
 * The panel is compact because a section says "3 files, 2 edited" and unfolds only when asked. */

import type { TodoItem } from '../state/types';
import type { FileState } from './overviewModel';

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function filesSummary(files: readonly { state: FileState }[]): string {
  const edited = files.filter((f) => f.state === 'edited').length;
  const head = plural(files.length, 'file', 'files');
  return edited > 0 ? `${head}, ${edited} edited` : head;
}

export function artifactsSummary(count: number): string {
  return plural(count, 'card', 'cards');
}

/**
 * THE WINDOW ROW, IN ONE LINE.
 *
 * The window and the usage are two different measurements, and the row has to keep them
 * apart: a turn that WAS metered says how much it sent, even when nobody can say how big
 * the window is, and a window nobody can name is not a usage nobody measured. "Not measured"
 * was a lie in both directions - the ring beside the row said the real number, or the real
 * window, while the row said nothing had been measured at all.
 *
 * The numbers arrive already formatted: this module counts and words, it does not format
 * tokens. A null window is a window nobody could name; a null usage is nothing measured.
 */
export function windowLine(used: string | null, window: string | null): string {
  if (used !== null) return window === null ? `${used} used, window unknown` : `${used} of ${window}`;
  if (window !== null) return `${window}, nothing sent yet`;
  return 'Not measured';
}

export function progressSummary(todos: readonly Pick<TodoItem, 'status'>[], run: { round: number; roundCap: number } | null): string {
  if (todos.length === 0) return run ? `Round ${run.round} of ${run.roundCap}` : '';
  const done = todos.filter((t) => t.status === 'done').length;
  return `${done} of ${todos.length} done`;
}

/** Progress shows prominently only while something runs or work is left; a finished list folds to its line. */
export function progressOpenByDefault(live: boolean, todos: readonly Pick<TodoItem, 'status'>[]): boolean {
  return live || todos.some((t) => t.status !== 'done');
}

/** A short list opens in place; a long one folds to its summary line until the reader asks. */
export const LIST_OPEN_MAX = 3;
export function listOpenByDefault(count: number): boolean {
  return count <= LIST_OPEN_MAX;
}

/** The key count the collapsed pill carries: what this chat holds. */
export function keyCount(files: readonly unknown[], artifacts: readonly unknown[]): number {
  return files.length + artifacts.length;
}

/** One quiet line for an empty chat, in place of two empty headings. Null when either list has something. */
export function emptyLine(filesN: number, artifactsN: number): string | null {
  return filesN === 0 && artifactsN === 0 ? 'No files or artifacts yet' : null;
}
