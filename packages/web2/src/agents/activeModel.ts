/* ══════════════════════════════════════════════════════════════════════════
   WHICH MODEL THE AGENT IS ON (round 7, A3)
   packages/web2/src/agents/activeModel.ts

   Jaden: "In terms of Codex, it doesn't tell you which model you're using."
   The model pill and the status bar name the agent's model from what the
   agent itself said, in this order:
     1. the model the person picked for that agent (it goes on every turn);
     2. the model the agent said its last turn in this chat ran on
        (acp:model: codex's thread/start|resume `model`, an ACP agent's model
        option);
     3. the default the agent reports in its model list (codex model/list
        isDefault).
   Before any of these is known it is the agent's default ("Codex default"; a
   bare "Default model" read as a model of its own). Never a name the agent
   did not give: an id with no display name is shown as its short nickname
   (chat/modelNickname.ts), the id itself when nothing can be said.
   ══════════════════════════════════════════════════════════════════════════ */

import { tidyModelName } from '../chat/modelNickname';
import type { AgentRunsState } from './agentRuns';

/** What an agent's model is called before the agent has said which: whose default it is. */
export function defaultModelLabel(agentRef: string): string {
  return `${agentRef.charAt(0).toUpperCase()}${agentRef.slice(1)} default`;
}

export interface ActiveModel {
  /** The id the agent knows it by, or null while unknown. */
  id: string | null;
  /** What to show. */
  label: string;
  /** Where it came from (for the title and tests). */
  source: 'chosen' | 'session' | 'default' | 'unknown';
}

export function activeAgentModel(state: Pick<AgentRunsState, 'runs' | 'caps' | 'config'>, agentRef: string, sessionId: string | null): ActiveModel {
  const caps = state.caps?.[agentRef];
  const nameOf = (id: string) => tidyModelName(caps?.models.find((m) => m.id === id)?.name || id);
  const chosen = state.config?.[agentRef]?.model;
  if (chosen) return { id: chosen, label: nameOf(chosen), source: 'chosen' };
  const said = [...state.runs].reverse().find((r) => r.agentRef === agentRef && (sessionId === null || r.sessionId === sessionId) && r.model)?.model;
  if (said) return { id: said, label: nameOf(said), source: 'session' };
  const def = caps?.models.find((m) => m.isDefault);
  if (def) return { id: def.id, label: tidyModelName(def.name || def.id), source: 'default' };
  return { id: null, label: defaultModelLabel(agentRef), source: 'unknown' };
}

/* ── THE MODEL THE COMPOSER HAS RESOLVED ───────────────────────────────────
   The composer chip resolves the saved model that answers (its nickname, its
   provider, whether it is hosted) from the picker's list. The status bar reads
   the same record so the bar and the chip cannot name different providers. */

import type { ModelIdentity } from '../shell2/brandIcons';

export interface ResolvedModel extends ModelIdentity {
  /** The wire id the composer's selection carries. */
  model: string;
  /** What the chip calls it. */
  label: string;
}

let resolved: ResolvedModel | null = null;
const listeners = new Set<() => void>();

export const resolvedModel = {
  get: (): ResolvedModel | null => resolved,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  set(next: ResolvedModel | null): void {
    const same =
      next === resolved ||
      (next !== null && resolved !== null && next.model === resolved.model && next.label === resolved.label && next.provider === resolved.provider && next.baseUrl === resolved.baseUrl && next.keyed === resolved.keyed && next.managed === resolved.managed);
    if (same) return;
    resolved = next;
    for (const fn of [...listeners]) fn();
  },
};
