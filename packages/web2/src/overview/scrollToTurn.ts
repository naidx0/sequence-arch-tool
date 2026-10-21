/* ══════════════════════════════════════════════════════════════════════════
   BRING A TURN INTO VIEW
   packages/web2/src/overview/scrollToTurn.ts

   The transcript has no scroll-to-turn of its own (its reveal is for agent
   runs, chat/transcriptNav.ts). The virtual list draws a row with
   data-row-key="turn:<id>", and every turn's own block carries data-turn-id
   (v3/V3Chat.tsx MessageBlock); when that row is in the page it is scrolled to.
   When it is not (a long chat, the row scrolled far away) the virtualized list
   is asked for it (chat/transcriptNav.ts revealTurn); with no such list the
   scroller is moved to the turn's share of the list, and the row is looked for
   again once it has been drawn.
   ══════════════════════════════════════════════════════════════════════════ */

import { revealTurn, SCROLLER_ATTR } from '../chat/transcriptNav';

const esc = (s: string): string => s.replace(/["\\]/g, '\\$&');

function rowOf(root: ParentNode, turnId: string): HTMLElement | null {
  /* An agent run is no turn of the chat: its article is `agrun-<id>`, and a card it drew is saved under that id. */
  return root.querySelector<HTMLElement>(`[data-turn-id="${esc(turnId)}"], [data-row-key="turn:${esc(turnId)}"], [id="agrun-${esc(turnId)}"]`);
}

/** Returns true when a row was scrolled to now; false when only the scroller was moved (or nothing was found). */
export function scrollToTurn(turnId: string, turnIds: readonly string[], root: ParentNode = document): boolean {
  const row = rowOf(root, turnId);
  if (row) {
    row.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    return true;
  }
  /* A virtualized list knows where the turn's row is, drawn or not, and draws it on arrival. */
  if (revealTurn(turnId)) return true;
  const scroller = root.querySelector<HTMLElement>(`[${SCROLLER_ATTR}]`) ?? root.querySelector<HTMLElement>('[data-transcript-scroller]');
  const at = turnIds.indexOf(turnId);
  if (!scroller || at < 0 || turnIds.length === 0) return false;
  scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * (at / Math.max(1, turnIds.length - 1));
  const retry = (n: number): void => {
    const r = rowOf(root, turnId);
    if (r) r.scrollIntoView?.({ block: 'start' });
    else if (n > 0) requestAnimationFrame(() => retry(n - 1));
  };
  requestAnimationFrame(() => retry(6));
  return false;
}
