/* ══════════════════════════════════════════════════════════════════════════
   THE COMPOSER'S S5 KEYS: steer, queue, recall
   packages/web2/src/composer/composerKeys.ts

   Pure, and matched against the ONE table (shell/shortcuts.ts) by id, so the
   keys help and the handler cannot disagree about a chord.

     steer   Enter while a turn runs: the text goes INTO that turn (Codex
             `turn/steer`); an agent with no steer (ACP) queues it.
     queue   Tab while a turn runs: the text waits for the turn to settle.
     recall  Up in an EMPTY composer: the last prompt comes back to edit.

   The composer (v3/V3Chat.tsx onComposerKeyDown) calls `composerKeyIntent`
   after its menus have had their keys and before its own Enter-sends; the
   exact lines are in the S5 report.
   ══════════════════════════════════════════════════════════════════════════ */

import { chordMatches, isMacLike, shortcutById, type KeyEventLike } from '../shell/shortcuts';

export type ComposerKeyIntent = 'steer' | 'queue' | 'recall' | null;

export interface ComposerKeyState {
  /** A turn is running in this chat. */
  running: boolean;
  draft: string;
  /** An IME composition is open: its Enter belongs to the IME. */
  composing: boolean;
}

export function composerKeyIntent(e: KeyEventLike, st: ComposerKeyState, mac: boolean = isMacLike()): ComposerKeyIntent {
  if (st.composing) return null;
  const hasText = st.draft.trim() !== '';
  if (st.running && hasText) {
    if (chordMatches(shortcutById('steer'), e, mac)) return 'steer';
    if (chordMatches(shortcutById('queue'), e, mac)) return 'queue';
  }
  /* EMPTY, not merely blank-ish: Up in a draft moves the caret, and taking
     that away from someone editing a multi-line prompt would be a theft. */
  if (st.draft === '' && chordMatches(shortcutById('recall'), e, mac)) return 'recall';
  return null;
}

/** The last thing the person sent in this chat, or null. */
export function lastPrompt(turns: readonly { role: string; text?: string }[]): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i]!;
    if (t.role === 'user' && typeof t.text === 'string' && t.text.trim() !== '') return t.text;
  }
  return null;
}
