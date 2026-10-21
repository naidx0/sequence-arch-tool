/* The rail's lists (RailLists: workflows with the editor's glyphs and the built-in programs, components with their
   detail, profiles, skills) load when a section opens. They are not on the path to the composer: the nav rows draw
   without them, and the section note reads "Loading" for the few ms the chunk takes. boot/entryGraph.test.ts holds
   RailLists out of the entry chunk. */

import { lazy, Suspense } from 'react';

import { RailNote } from './RailSection';
import type { RailBodyProps } from './RailLists';

const Body = lazy(() => import('./RailLists').then((m) => ({ default: m.RailBody })));

export function RailBody(props: RailBodyProps) {
  return (
    <Suspense fallback={<RailNote kind="loading">Loading.</RailNote>}>
      <Body {...props} />
    </Suspense>
  );
}
