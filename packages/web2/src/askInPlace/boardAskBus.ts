/* ══════════════════════════════════════════════════════════════════════════
   HOW A BOARD REACHES THE CHAT'S SEND
   packages/web2/src/askInPlace/boardAskBus.ts

   A chat has two ways to send: the coding agent it talks to (agentRuns) or the
   engine's ask. Which one is the mounted chat's to know (v3/V3Chat.tsx), so the
   chat registers ONE sender here while it is mounted and a board's ask-in-place
   calls it. The board never learns which route the words took.

   Tiny on purpose, like chat/boardPngBus.ts: both boards import it at boot.
   ══════════════════════════════════════════════════════════════════════════ */

let sender: ((text: string) => void) | null = null;

/** The mounted chat registers its send while it is mounted (null on unmount). */
export function registerBoardAskSender(fn: ((text: string) => void) | null): void {
  sender = fn;
}

/** Send `text` as a message in the chat, with whatever the composer holds (chips, attachments). False when no chat is mounted. */
export function sendThroughChat(text: string): boolean {
  if (!sender) return false;
  sender(text);
  return true;
}
