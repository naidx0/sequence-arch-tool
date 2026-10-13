import { requestHostCommand } from '../app/hostCommands';
import { DEFAULT_VIEW_STATE, toHash } from '../canvas/viewState';

/**
 * Take the reader to the Diff board: the board's view lives in the URL hash
 * (canvas/useBoardView), so the hash is set first and a mounted board follows
 * it on `hashchange`; then the host is asked to put the Architecture surface
 * on stage (V3CommandPalette listens and calls the shell's own surface open).
 */
export function requestDiffBoard(): void {
  if (typeof window === 'undefined') return;
  try {
    window.location.hash = toHash({ ...DEFAULT_VIEW_STATE, view: 'diff' });
  } catch {
    /* no location: the event alone still opens the surface */
  }
  requestHostCommand('canvas.board');
}
