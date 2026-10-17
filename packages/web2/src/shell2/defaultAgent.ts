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

import { noteAgentLabels } from '../agents/agentRegistry';
import { sharedGet } from '../api/sharedGet';
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

/**
 * THE ONE READ OF THE REGISTERED AGENTS. Whoever asks first at boot (the first-run gate, the default pick, or a chat that
 * already has its agent) makes the request; the others join it (api/sharedGet.ts), and every answer hands the agents'
 * labels to the page, so the pill names an agent by its label from first paint rather than after the menu is opened.
 * Null when the server cannot say.
 */
let agentsRead = false;
/** Tests: the page has not read the agents yet. */
export function forgetAgentsRead(): void {
  agentsRead = false;
}
export async function readRegisteredAgents(): Promise<{ id: string; label?: unknown }[] | null> {
  try {
    const r = await sharedGet(REGISTERED_AGENTS_ROUTE);
    if (!r.ok) return null;
    const listed = ((await r.json()) as { agents?: { id: string; label?: unknown }[] }).agents ?? [];
    noteAgentLabels(agentRuns, listed);
    agentsRead = true;
    return listed;
  } catch {
    return null;
  }
}

/** A chat that already has its agent asks for the agents' labels unless some read of them has answered (the default pick does not run for it). */
export function useAgentLabels(agentRef: string | undefined): void {
  useEffect(() => {
    if (agentRef && !agentsRead) void readRegisteredAgents();
  }, [agentRef]);
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

/**
 * A message sent to a built-in model is the chat's choice of it. Saved as an EMPTY agent, it survives a reload: without it a
 * chat that never picked anything looked undecided, and the default pick (or the last run's agent) took it over.
 */
export function keepBuiltInChoice(sessionId: string | null | undefined): void {
  if (!sessionId || agentRuns.get().agents?.[sessionId] !== undefined) return;
  agentRuns.patch((s) => (s.agents?.[sessionId] !== undefined ? s : { ...s, agents: { ...s.agents, [sessionId]: '' } }));
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
        /* The labels the registry gave them are noted by the read, for the pill and the pickers (agents/agentLabels.ts). */
        const listed = await readRegisteredAgents();
        if (!listed) return;
        const ids = listed.map((a) => a.id);
        const st = agentRuns.get();
        /* An empty agent is the reader's choice of a built-in model; only a chat that never chose is given one. */
        if (st.agents?.[sessionId] !== undefined) return;
        const lastUsed = [...st.runs].reverse().find((x) => x.agentRef)?.agentRef ?? undefined;
        const pick = pickDefaultAgent(ids, lastUsed, readNote());
        if (!pick) return;
        agentRuns.patch((s) => (s.agents?.[sessionId] !== undefined ? s : { ...s, agents: { ...s.agents, [sessionId]: pick } }));
        await loadCapabilities(agentRuns, pick, (i, init) => fetch(i, init));
      } catch {
        /* unreachable server: the pill keeps saying Connect agent */
      }
    })();
  }, [needed, sessionId, again]);
}
