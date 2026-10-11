/* ══════════════════════════════════════════════════════════════════════════
   FROM THE STATIC COMPOSER TO REACT'S, WITHOUT LOSING A KEY
   packages/web2/src/chat/staticHandoff.ts

   dist/index.html carries a prerendered shell (#static-shell, from
   scripts/prerender-shell.mjs) whose composer field takes typing while React
   and the server boot. V3Chat calls `takeStaticComposer` in a layout effect
   on mount: the text, the caret, the focus and a pending Send are read and the
   static shell is removed in the same synchronous step, before the browser
   paints. JavaScript runs one event at a time, so no keystroke can land
   between the read and the removal: every key typed before it is in the text,
   every key after it goes to React's field, in order.
   ══════════════════════════════════════════════════════════════════════════ */

export interface StaticComposerState {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  focused: boolean;
  /** Enter or Send was pressed in the static composer. */
  pendingSend: boolean;
}

export const STATIC_SHELL_ID = 'static-shell';

/** Read the static composer and remove the static shell. Null when there is none. */
export function takeStaticComposer(doc: Document = document): StaticComposerState | null {
  const shell = doc.getElementById(STATIC_SHELL_ID);
  if (!shell) return null;
  const field = shell.querySelector<HTMLTextAreaElement>('[data-testid="composer-field"]');
  const state: StaticComposerState | null = field
    ? {
        text: field.value,
        selectionStart: field.selectionStart ?? field.value.length,
        selectionEnd: field.selectionEnd ?? field.value.length,
        focused: doc.activeElement === field,
        pendingSend: shell.getAttribute('data-pending-send') === '1',
      }
    : null;
  shell.remove();
  return state;
}
