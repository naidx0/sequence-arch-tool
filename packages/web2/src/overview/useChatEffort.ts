/* What this chat's agent is on, worded for the overview's rows. Both come from the resolvers the composer pill and the model menu use
   (shell2/ModelMenu: agentPillText, resolveAgentEffort), so the rail cannot disagree with the composer. Null with no agent. */

import { useSyncExternalStore } from 'react';

import { activeAgentModel } from '../agents/activeModel';
import { agentRuns } from '../agents/agentRuns';
import { effortLabelOf } from '../chat/composerModel';
import { agentPillText, resolveAgentEffort } from '../shell2/ModelMenu';

export function useChatEffort(chatId: string | null): string | null {
  return useSyncExternalStore(
    agentRuns.subscribe,
    () => {
      if (!chatId) return null;
      const state = agentRuns.get();
      const agentRef = state.agents?.[chatId];
      if (!agentRef) return null;
      const { effort } = resolveAgentEffort(state, agentRef, chatId);
      return effort ? effortLabelOf(effort) : null;
    },
    () => null,
  );
}

/** The model the composer pill names for this chat's agent, or null with no agent (the caller then reads the composer's own model). */
export function useChatAgentModel(chatId: string | null): string | null {
  return useSyncExternalStore(
    agentRuns.subscribe,
    () => {
      if (!chatId) return null;
      const state = agentRuns.get();
      const agentRef = state.agents?.[chatId];
      return agentRef ? agentPillText(activeAgentModel(state, agentRef, chatId)) : null;
    },
    () => null,
  );
}
