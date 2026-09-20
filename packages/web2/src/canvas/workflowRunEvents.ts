/**
 * Subscribe to program run SSE and project events onto the board overlay.
 */

import type { ProgramRunEvent } from '@sequence/api-types';

import {
  applyBoardRunEvent,
  clearBoardRunOverlay,
  initBoardRunOverlay,
} from './workflowRunOverlay.js';

/**
 * A stream that ends when the run does.
 *
 * ── THE RECONNECT LOOP THIS CLOSES, END TO END ────────────────────────────
 *
 * The server ends the response on `run:finished` (`repoServer.ts`). An
 * EventSource treats a closed response as a dropped connection and reconnects
 * BY SPEC — and `programRunner.subscribe` returns nothing for a run that is no
 * longer live, so the server ends the new response immediately too. No `retry:`
 * field is ever written, so the browser default applies: one request every ~3
 * seconds, per run ever watched, for as long as the tab is open. Only closing
 * the source from THIS side stops it, because only this side knows the run is
 * over rather than the connection being unlucky.
 *
 * `onerror` still says nothing and does nothing: a genuine drop mid-run SHOULD
 * reconnect, and the overlay keeping its last known state through it is the
 * honest behaviour — the board does not blank a run because a socket blinked.
 * The two cases are told apart by the terminal EVENT, not by the transport.
 */
export function subscribeProgramRunEvents(
  runId: string,
  onEvent?: (event: ProgramRunEvent) => void,
): () => void {
  const source = new EventSource(`/api/program/runs/${encodeURIComponent(runId)}/events`);
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    source.removeEventListener('message', onMessage as EventListener);
    source.close();
  };
  const onMessage = (ev: MessageEvent<string>) => {
    try {
      const parsed = JSON.parse(ev.data) as ProgramRunEvent;
      applyBoardRunEvent(parsed);
      onEvent?.(parsed);
      /* AFTER the overlay and the caller have seen it. Closing first would
         drop the very event that says the run is over. */
      if (parsed.type === 'run:finished' || parsed.type === 'run:cancelled') stop();
    } catch {
      /* ignore malformed */
    }
  };
  source.addEventListener('message', onMessage as EventListener);
  source.onerror = () => {
    /* EventSource retries; overlay keeps last known state */
  };
  return stop;
}

export function beginBoardRunWatch(
  runId: string,
  programId: string,
  nodeIds: string[],
  onEvent?: (event: ProgramRunEvent) => void,
): () => void {
  initBoardRunOverlay({ runId, programId, nodeIds });
  return subscribeProgramRunEvents(runId, onEvent);
}

/**
 * Drop the overlay entirely — the board stops showing a run at all.
 *
 * SEPARATE FROM CLOSING THE STREAM, and it has to stay separate: unmounting the
 * launch bar must stop the socket without erasing what the reader was looking
 * at, while dismissing the run must erase it. Collapsing the two is how the
 * board ends up either leaking a connection or blanking a run the reader had
 * not finished reading.
 */
export function endBoardRunWatch(): void {
  clearBoardRunOverlay();
}
