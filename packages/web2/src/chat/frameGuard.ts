import { useCallback, useRef, useState } from 'react';

/**
 * A sandboxed srcdoc frame loads exactly once per document and per iframe element (`resetKey` is the srcdoc). A second `load` means the page navigated itself
 * (location.href, meta refresh, a clicked link): CSP has no navigation directive, so the app stops
 * it here (and the desktop window refuses it in the main process, desktop/src/frameNavigation.ts).
 * `stopped` is true from the second load; the owner draws a note instead of the frame.
 */
export function useFrameGuard(resetKey: string): { onLoad: (frame?: Element | null) => void; stopped: boolean } {
  const loads = useRef(0);
  const element = useRef<Element | null>(null);
  const keyRef = useRef(resetKey);
  const [stoppedKey, setStoppedKey] = useState<string | null>(null);
  /* A new document (new srcdoc, or a remounted frame) is a new first load. */
  if (keyRef.current !== resetKey) {
    keyRef.current = resetKey;
    loads.current = 0;
  }
  const onLoad = useCallback((frame?: Element | null) => {
    /* Loads are counted per iframe ELEMENT: View source then View page remounts the frame, and that first load is not a second one. */
    if (frame && frame !== element.current) {
      element.current = frame;
      loads.current = 0;
    }
    loads.current += 1;
    if (loads.current > 1) setStoppedKey(keyRef.current);
  }, []);
  return { onLoad, stopped: stoppedKey === resetKey };
}

export const FRAME_STOPPED_NOTE = 'The page tried to navigate away and was stopped.';
