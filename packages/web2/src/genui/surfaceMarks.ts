/* WHICH CHATS HAVE SAVED CARDS, kept in this browser so the chat can leave the card code unloaded.
   packages/web2/src/genui/surfaceMarks.ts

   Drawing a saved card needs the genui stack (about 150 KB with its schema library), which is not on the path to the
   composer. The server cannot say "this chat has cards" without a request, and a request at boot is a request in the
   boot window. So the answer is remembered per chat: '1' once a card was saved or read back, '0' once the list came
   back empty. A chat marked '1' loads the stack when the page is idle; a chat never checked is checked once, well after
   boot; a chat marked '0' waits for an agent turn (which loads the stack at once and marks the chat when it saves). */

const KEY = 'sequence.genui.surfaces.';

export type SurfaceMark = 'has' | 'none' | 'unknown';

export function readSurfaceMark(chatId: string): SurfaceMark {
  try {
    const v = localStorage.getItem(KEY + chatId);
    return v === '1' ? 'has' : v === '0' ? 'none' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function writeSurfaceMark(chatId: string, has: boolean): void {
  try {
    localStorage.setItem(KEY + chatId, has ? '1' : '0');
  } catch {
    /* a marker that did not save only means one more check next time */
  }
}
