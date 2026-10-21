/* Focus requests from outside the Files surface (the chat header's Find icon). The surface may not be
   mounted when the icon is pressed, so the request waits here until a field exists. This file is
   separate from FilesFind.tsx so the shell's header icon does not pull the Find component into the boot chunk. */
let pendingFocus = 0;
export const FOCUS_EVENT = 'seq:files-find-focus';
const MOVED_ON = ['pointerdown', 'keydown'] as const;

function stopWatching(): void {
  try {
    for (const type of MOVED_ON) window.removeEventListener(type, moveOn, true);
  } catch {
    /* no window */
  }
}

/* A request is stale when the reader has moved on, which is something they do (press, click, type), not something a
   clock can tell: the Files chunk and tree can take longer than any fixed wait on a busy machine, and a request
   dropped on the clock never focuses the field. */
function moveOn(): void {
  pendingFocus = 0;
  stopWatching();
}

/** Ask the Files find field to take focus now, or as soon as it mounts. */
export function requestFilesFindFocus(): void {
  pendingFocus += 1;
  stopWatching();
  try {
    for (const type of MOVED_ON) window.addEventListener(type, moveOn, true);
    window.dispatchEvent(new Event(FOCUS_EVENT));
  } catch {
    /* no window */
  }
}

export function clearPendingFocus(): void {
  pendingFocus = 0;
  stopWatching();
}

/** True when a request is waiting and the reader has not pressed or typed anything since. */
export function takePendingFocus(): boolean {
  return pendingFocus > 0;
}
