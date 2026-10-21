/* What a row in the rail DOES, in one place so the tests and both rails (panel and collapsed) call the same thing. */

import type { ComponentEntry } from '../components/componentsClient';
import { sessionsClient } from '../sessions/sessionsClient';
import { groundedRepoRoot } from '../state/connect';
import type { Store } from '../state/store';
import { createNewChat } from '../v3/sessionActions';

/**
 * "Use in chat" for a component: the same chip the composer's Components picker adds (V3Chat's onPick), so the next
 * message carries it. A chip for the same component twice is one chip (the reducer keeps it so).
 */
export function addComponentChip(store: Pick<Store, 'dispatch'>, entry: Pick<ComponentEntry, 'id' | 'name'>): void {
  store.dispatch({ type: 'composer/chip-add', chip: { id: `component:${entry.id}`, kind: 'component', ref: entry.id, label: entry.name, nodeKind: null } });
  focusComposer();
}

export function focusComposer(): void {
  try {
    document.querySelector<HTMLTextAreaElement>('[data-testid="s2-chat"] textarea')?.focus();
  } catch {
    /* no document */
  }
}

const LEADING_MENTION = /^@[a-z0-9][a-z0-9._-]{0,47}\s*/i;

/**
 * Pick an agent profile. The composer starts a message with `@name ` (agentProfiles.ts reads that when it sends), so
 * this sets the current chat's draft the same way, replacing a profile already at its start. With no chat open yet it
 * starts one first.
 */
export async function pickProfile(store: Store, name: string): Promise<void> {
  if (!store.getState().session.activeId) {
    await createNewChat(store, sessionsClient, groundedRepoRoot(store.getState()) ? 'code' : 'work');
  }
  const rest = store.getState().composer.draft.replace(LEADING_MENTION, '');
  store.dispatch({ type: 'composer/draft', text: `@${name} ${rest}` });
  focusComposer();
}
