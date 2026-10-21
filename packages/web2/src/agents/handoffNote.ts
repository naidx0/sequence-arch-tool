import { providerLabel, providerOf } from '../shell2/brandIcons';

/** The agent as the status bar names it: the provider's name, or the agent's own id capitalised. */
export function agentLabel(agentRef: string | null | undefined): string {
  if (!agentRef) return 'The agent';
  const p = providerOf(agentRef);
  return p === 'other' ? agentRef.charAt(0).toUpperCase() + agentRef.slice(1) : providerLabel(p);
}

/** The one-line notice for a prompt that carried the chat to an agent (it is saved with the turn, so it survives a reload). */
export function handoffNote(agentRef: string | null | undefined, kind: 'full' | 'delta'): string {
  const who = agentLabel(agentRef);
  return kind === 'delta' ? `${who} was caught up on what happened since it last spoke.` : `${who} was given this chat so far.`;
}
