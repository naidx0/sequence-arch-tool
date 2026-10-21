/* The file tree for a path list. A small list is built at once, inside the render, exactly as before. A large one (opening Files on
   a big repository) is built in slices that hand the thread back, so no frame is dropped; the last tree built stays on screen until
   the next one is ready, and the very first draw is an empty list for a few frames rather than a stalled page. */
import { useEffect, useMemo, useState } from 'react';

import { buildFileTree, buildFileTreeSliced } from './filesModel';
import type { FileTreeNode } from './filesModel';

/** Below this many paths a build is a millisecond or two: not worth a yield. */
export const SLICED_TREE_MIN_PATHS = 600;

const NONE: FileTreeNode[] = [];

export function useFileTree(paths: readonly string[], emptyDirs: readonly string[] | undefined): FileTreeNode[] {
  const small = paths.length < SLICED_TREE_MIN_PATHS;
  const now = useMemo(() => (small ? buildFileTree(paths, emptyDirs ?? []) : null), [small, paths, emptyDirs]);
  const [late, setLate] = useState<FileTreeNode[]>(NONE);
  useEffect(() => {
    if (small) return undefined;
    const controller = new AbortController();
    buildFileTreeSliced(paths, emptyDirs ?? [], { signal: controller.signal }).then(
      (tree) => {
        if (!controller.signal.aborted) setLate(tree);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, [small, paths, emptyDirs]);
  return now ?? late;
}
