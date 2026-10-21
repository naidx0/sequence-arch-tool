/* The session as React state: one subscription, one snapshot per published change.
   The session connects in an effect (and disconnects in its cleanup), so StrictMode's
   mount, unmount, mount leaves exactly one live subscription and the agent running. */
import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { GenUIAgent } from './agent';
import { GenUISession, type SessionView } from './session';

export function useGenUISession(agent: GenUIAgent): [SessionView, GenUISession] {
  const session = useMemo(() => new GenUISession(agent, { connect: false }), [agent]);
  useEffect(() => session.connect(), [session]);
  const view = useSyncExternalStore(
    (fn) => session.subscribe(fn),
    () => session.get(),
  );
  return [view, session];
}
