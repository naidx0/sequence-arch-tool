/* ══════════════════════════════════════════════════════════════════════════
   THE PILL NEVER SAYS "CONNECT AGENT" WHEN AN AGENT IS CONNECTED (UX audit #3)
   packages/web2/src/shell2/defaultAgent.ts

   A new chat, or a reload, has no agent of its own and no saved model, so the
   pill read "Connect agent" although Settings said "Connected". This asks the
   server which agents are registered (GET /api/acp/agents, the list the
   connect rows already read) and gives the chat the agent it used last, else
   the only one there is, then loads its models so the pill names the model.
   With two registered and none used yet, the agent first run connected
   (onboarding/loneAgent.ts leaves a note) is the pick; with no note the
   choice is the reader's: nothing is picked for them. This is the one path
   that gives a chat its first agent (it replaced round 11's useFirstAgent).
   The note is cleared a few seconds after it is first read, not at once:
   boot may settle on a saved chat after the first one, and that chat should
   get the agent too.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { agentRuns } from '../agents/agentRuns';
import { loadCapabilities } from '../agents/agentRunner';
import { FIRST_AGENT_EVENT, clearFirstAgent, takeFirstAgent } from '../onboarding/loneAgent';

export const REGISTERED_AGENTS_ROUTE = '/api/acp/agents';

/** The agent a chat with none should talk to: the last one used, else the one first run connected, else the only registered one. */
export function pickDefaultAgent(registered: readonly string[], lastUsed: string | undefined, noted?: string | null): string | null {
  if (lastUsed && registered.includes(lastUsed)) return lastUsed;
  if (noted && registered.includes(noted)) return noted;
  return registered.length === 1 ? registered[0]! : null;
}

const KEEP_NOTE_MS = 4000;
let clearing = false;

/** The agent first run connected, if it left a note; schedules the note's removal. */
function readNote(): string | null {
  const id = takeFirstAgent();
  if (id && !clearing) {
    clearing = true;
    window.setTimeout(() => {
      clearing = false;
      clearFirstAgent();
    }, KEEP_NOTE_MS);
  }
  return id;
}

/** Runs once per chat that has no agent and no model; a no-answer leaves the pill honest ("Connect agent"). */
export function useDefaultAgent(sessionId: string | null | undefined, needed: boolean): void {
  const asked = useRef<string | null>(null);
  /* Round 12: first run no longer reloads, so the screen leaving (an agent just connected) asks again. */
  const [again, setAgain] = useState(0);
  useEffect(() => {
    const on = () => {
      asked.current = null;
      setAgain((n) => n + 1);
    };
    window.addEventListener(FIRST_AGENT_EVENT, on);
    return () => window.removeEventListener(FIRST_AGENT_EVENT, on);
  }, []);
  useEffect(() => {
    if (!needed || !sessionId || asked.current === sessionId) return;
    asked.current = sessionId;
    void (async () => {
      try {
        const r = await fetch(REGISTERED_AGENTS_ROUTE);
        if (!r.ok) return;
        const ids = (((await r.json()) as { agents?: { id: string }[] }).agents ?? []).map((a) => a.id);
        const st = agentRuns.get();
        if (st.agents?.[sessionId]) return;
        const lastUsed = [...st.runs].reverse().find((x) => x.agentRef)?.agentRef ?? undefined;
        const pick = pickDefaultAgent(ids, lastUsed, readNote());
        if (!pick) return;
        agentRuns.patch((s) => (s.agents?.[sessionId] ? s : { ...s, agents: { ...s.agents, [sessionId]: pick } }));
        await loadCapabilities(agentRuns, pick, (i, init) => fetch(i, init));
      } catch {
        /* unreachable server: the pill keeps saying Connect agent */
      }
    })();
  }, [needed, sessionId, again]);
}
