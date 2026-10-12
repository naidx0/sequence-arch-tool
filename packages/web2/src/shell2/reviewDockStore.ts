/* ══════════════════════════════════════════════════════════════════════════
   WHICH TURN THE REVIEW DOCK SHOWS (Decision 49)
   packages/web2/src/shell2/reviewDock.ts

   The changed-files line asks for the review; the shell draws the dock on the
   stage. One tiny store between them, so neither imports the other and the
   dock's code loads only when it is first opened.
   ══════════════════════════════════════════════════════════════════════════ */

import { useSyncExternalStore } from 'react';

export interface ReviewTarget {
  /** The chat, which is the snapshot session for an agent turn (run-node). */
  sessionId: string;
  seq: number;
  /** The file to open first, if the reader picked one. */
  path?: string;
}

let target: ReviewTarget | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export const reviewDock = {
  open(next: ReviewTarget): void {
    target = next;
    emit();
  },
  close(): void {
    target = null;
    emit();
  },
  get(): ReviewTarget | null {
    return target;
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export function useReviewDock(): ReviewTarget | null {
  return useSyncExternalStore(reviewDock.subscribe, reviewDock.get, () => null);
}
