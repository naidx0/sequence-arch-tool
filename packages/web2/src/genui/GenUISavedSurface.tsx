/* A surface drawn from a saved turn (surfaceStore.ts): the final spec, once. No entry animation, no repair strip,
   buttons off. The renderer validates every node again, so a spec edited on disk shows skeletons, not junk. */
import { useMemo } from 'react';

import { GenUISurface } from './GenUISurface';
import { restoredView } from './session';
import type { SavedSurface } from './surfaceStore';

const noClick = (): void => {};

export function GenUISavedSurface({ saved }: { saved: Pick<SavedSurface, 'surface' | 'spec'> }): JSX.Element {
  const view = useMemo(() => restoredView(saved.surface, saved.spec), [saved.surface, saved.spec]);
  return <GenUISurface view={view} busy={false} onClick={noClick} />;
}

export default GenUISavedSurface;
