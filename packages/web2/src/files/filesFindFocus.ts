/* Focus requests from outside the Files surface (the chat header's Find icon). The surface may not be
   mounted when the icon is pressed, so the request waits here until a field exists. This file is
   separate from FilesFind.tsx so the shell's header icon does not pull the Find component into the boot chunk. */
let pendingFocus = 0;
let pendingAt = 0;
/** A request older than this is stale: the reader has moved on. */
const PENDING_MS = 2000;
export const FOCUS_EVENT = 'seq:files-find-focus';

/** Ask the Files find field to take focus now, or as soon as it mounts. */
export function requestFilesFindFocus(): void {
  pendingFocus += 1;
  pendingAt = Date.now();
  try {
    window.dispatchEvent(new Event(FOCUS_EVENT));
  } catch {
    /* no window */
  }
}

export function clearPendingFocus(): void {
  pendingFocus = 0;
}

/** True when a request is waiting and still fresh; a stale one is dropped. */
export function takePendingFocus(): boolean {
  if (pendingFocus <= 0) return false;
  if (Date.now() - pendingAt <= PENDING_MS) return true;
  pendingFocus = 0;
  return false;
}
