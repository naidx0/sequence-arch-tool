/* ══════════════════════════════════════════════════════════════════════════
   WHICH AGENTS ARE CONNECTED, AS THE PICKER SEES IT (0.1.5 G1)
   packages/web2/src/agents/agentRegistry.ts

   The owner: Codex said Connected, yet the model picker had no Codex in it,
   and disconnecting and reconnecting changed nothing. The picker built an
   agent's rows only from a non-empty model list, and a failed read stayed in
   the page (loadCapabilities skips an agent with a recorded error) until a
   Retry that was shown only once the chat was already on that agent.

   Here the page keeps the list of registered agents (GET /api/acp/agents) so
   the picker offers each one whatever its model list says, and connect and
   disconnect (Settings or the picker) change that state at once.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentRunStore } from './agentRuns';
import { loadCapabilities } from './agentRunner';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function without<T>(rec: Readonly<Record<string, T>> | undefined, id: string): Record<string, T> {
  const next = { ...(rec ?? {}) };
  delete next[id];
  return next;
}

/** What GET /api/acp/agents answered: the agents the picker offers. */
export function noteRegistered(store: AgentRunStore, ids: readonly string[]): void {
  const now = store.get().registered;
  if (now && now.length === ids.length && now.every((id, i) => id === ids[i])) return;
  store.patch((s) => ({ ...s, registered: [...ids] }));
}

/**
 * Connected (Settings' Connect, or the picker's): it is offered at once, any
 * earlier failure to read its models is forgotten, and its models are asked
 * for again, past the server's cache (refresh=1).
 */
export async function noteConnected(store: AgentRunStore, id: string, f: Fetch): Promise<void> {
  store.patch((s) => ({
    ...s,
    registered: s.registered ? (s.registered.includes(id) ? s.registered : [...s.registered, id]) : [id],
    caps: without(s.caps, id),
    capsError: without(s.capsError, id),
  }));
  await loadCapabilities(store, id, f, true);
}

/** Disconnected: it leaves the picker, what was read of it is dropped, and a chat on it goes back to a model. */
export function forgetAgent(store: AgentRunStore, id: string): void {
  store.patch((s) => {
    const agents: Record<string, string> = {};
    for (const [sid, ref] of Object.entries(s.agents ?? {})) agents[sid] = ref === id ? '' : ref;
    return {
      ...s,
      agents,
      registered: (s.registered ?? []).filter((x) => x !== id),
      caps: without(s.caps, id),
      capsError: without(s.capsError, id),
    };
  });
}
