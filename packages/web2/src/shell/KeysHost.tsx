/* ══════════════════════════════════════════════════════════════════════════
   THE PAGE-WIDE KEYS (S5)
   packages/web2/src/shell/KeysHost.tsx

   One window listener for the `keys` rows of shell/shortcuts.ts:
     Cmd/Ctrl+N          a new chat (as the rail's New chat does)
     Ctrl+Tab / +Shift   the next / previous chat, in rail order
     Cmd/Ctrl+/          the keys help, every row of the same table
     Cmd/Ctrl+B          show or hide the sidebar (DeepSeek's key)

   `matchShortcut` decides; this file only does. No key fires in a text field
   other than the composer, and from the composer only rows marked
   `inComposer` (all three of these are: a person typing still wants Cmd+N).
   EAGER, so every chord works from the first frame and its default action
   is cancelled on the original event (a replayed key cannot do that). Only
   the help panel is lazy: nobody needs it at first paint.
   ══════════════════════════════════════════════════════════════════════════ */

import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { groundedRepoRoot, useAppState, useStore } from '../state/connect';
import { activateSession, createNewChat } from '../v3/sessionActions';
import { toggleSidebar } from '../shell2/layoutPrefs';
import { cycleChat } from './chatCycle';
import { matchShortcut, type KeyTarget } from './shortcuts';

/** The help chunk's load; the lazy component and a test await the same import. */
export const loadKeysHelp = () => import('./KeysHelp');
const KeysHelp = lazy(loadKeysHelp);

/** Where a keystroke landed: the composer, another text field, or neither. */
export function keyTargetOf(el: EventTarget | null): KeyTarget {
  if (!el || typeof (el as Element).closest !== 'function') return 'other';
  const node = el as HTMLElement;
  if (node.closest('[data-testid="composer-field"]')) return 'composer';
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return 'text';
  if (tag === 'INPUT') {
    const type = ((node as HTMLInputElement).type || 'text').toLowerCase();
    return ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type) ? 'other' : 'text';
  }
  if (node.isContentEditable || node.closest('[contenteditable=""], [contenteditable="true"], .xterm')) return 'text';
  return 'other';
}

export function KeysHost() {
  const store = useStore();
  const state = useAppState();
  const [helpOpen, setHelpOpen] = useState(false);
  const live = useRef({ sessions: state.session.sessions, activeId: state.session.activeId ?? null, repo: groundedRepoRoot(state) });
  live.current = { sessions: state.session.sessions, activeId: state.session.activeId ?? null, repo: groundedRepoRoot(state) };

  useEffect(() => {
    const act = (id: string): void => {
      const { sessions, activeId, repo } = live.current;
      switch (id) {
        case 'keys-help':
          setHelpOpen((open) => !open);
          return;
        case 'toggle-sidebar':
          toggleSidebar();
          return;
        case 'new-chat':
          void createNewChat(store, undefined, repo ? 'code' : 'work');
          return;
        case 'next-chat':
        case 'prev-chat': {
          const next = cycleChat(sessions, activeId, id === 'next-chat' ? 1 : -1);
          if (next) void activateSession(store, next);
          return;
        }
        default:
          return;
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      const hit = matchShortcut(event, keyTargetOf(event.target), 'keys');
      if (!hit) return;
      event.preventDefault();
      act(hit.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  if (!helpOpen) return null;
  return (
    <Suspense fallback={null}>
      <KeysHelp onClose={() => setHelpOpen(false)} />
    </Suspense>
  );
}

export default KeysHost;
