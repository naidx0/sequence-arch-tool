/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD'S PNG, ASKED FOR FROM THE CHAT (S2a)
   packages/web2/src/chat/boardPngBus.ts

   "Send the board to the agent" reuses the board's own export
   (canvas/ConnectedBoard.tsx, html-to-image). The mounted board registers
   its exporter here; a request is answered by that export with the PNG
   handed back instead of downloaded. Tiny on purpose: the board imports it
   at boot.
   ══════════════════════════════════════════════════════════════════════════ */

export type BoardPng = { dataUrl: string; width: number; height: number };

let exporter: (() => Promise<BoardPng>) | null = null;

/** The board registers its export while it is mounted (null on unmount). */
export function registerBoardExporter(fn: (() => Promise<BoardPng>) | null): void {
  exporter = fn;
}

/** The board as a PNG; refused at once when no board is mounted. */
export function requestBoardPng(): Promise<BoardPng> {
  return exporter ? exporter() : Promise.reject(new Error('Open the board first: there is no board to send.'));
}
