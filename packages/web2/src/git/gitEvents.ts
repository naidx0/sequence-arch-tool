import type { GitServerEvent } from './gitClient';
import { subscribeGitEventsSafe } from './gitCalls';
import { onWorkspaceSwitched } from '../sessions/workspaceEvents';

/* ONE git event stream per tab, however many components listen (the switcher
   in Files, the switcher in Diff, the board). Reference counted: the stream
   opens with the first listener and closes with the last. */

type Listener = (event: GitServerEvent) => void;

const listeners = new Set<Listener>();
let stop: (() => void) | null = null;

export function onGitEvent(listener: Listener): () => void {
  listeners.add(listener);
  if (stop === null) {
    stop = subscribeGitEventsSafe((event) => {
      for (const l of [...listeners]) l(event);
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
    }
  };
}

/* A new workspace has its own HEAD and its own watcher on the server: reopen the stream, and tell every listener to
   read again (a graph:updated carries no branch change, so nothing announces a switch that did not happen). */
onWorkspaceSwitched(() => {
  if (stop !== null) {
    stop();
    stop = subscribeGitEventsSafe((event) => {
      for (const l of [...listeners]) l(event);
    });
  }
  for (const l of [...listeners]) l({ type: 'graph:updated', reason: 'git:head', branch: null, sha: null });
});

/** Test hook. */
export function resetGitEvents(): void {
  listeners.clear();
  stop?.();
  stop = null;
}
