/**
 * Host commands that live outside the three-pane store slice.
 *
 * The architecture / whiteboard tab is React state in `App.tsx`, not a store
 * field — so a work-row "open on canvas" cannot dispatch its way there. This
 * bridge is the one-way call from chat → shell host, cleared on unmount.
 * Prefer a store field the day the tab moves into `ShellSlice`.
 */
export type HostCommandId =
  | 'canvas.board'
  | 'canvas.whiteboard'
  | 'canvas.ai'
  | 'rail.focus'
  | 'terminal.open'
  | 'browser.open';

type HostHandler = (id: HostCommandId) => void;

let handler: HostHandler | null = null;

export function setHostCommandHandler(next: HostHandler | null): void {
  handler = next;
}

export function requestHostCommand(id: HostCommandId): void {
  handler?.(id);
}
