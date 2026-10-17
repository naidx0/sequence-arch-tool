/* THE SPACES SURFACE CLOSES WHEN ITS LIST EMPTIES, never on a list that belongs to another project.

   The boards index is not keyed on the project: for the render after a project switch, `index` is still the OLD
   project's. So on a switch the index object in hand is marked stale, and nothing is learned from it: a Space is
   recorded as "had" only from an index fetched AFTER the switch, and a close needs that record for THIS project. */

import { useRef } from 'react';
import { useEffect } from 'react';

import { closeAfterEmpty } from '../canvas/boards/boardsModel';

export function useCloseWhenEmpty(project: string, index: unknown, count: number, close: () => void): void {
  const had = useRef<string | null>(null);
  const stale = useRef<{ project: string; index: unknown }>({ project, index: undefined });
  if (stale.current.project !== project) {
    stale.current = { project, index };
    had.current = null;
  }
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (index === null || index === stale.current.index) return;
    const verdict = closeAfterEmpty(had.current, project, count);
    had.current = verdict.had;
    if (verdict.close) closeRef.current();
  }, [index, project, count]);
}
