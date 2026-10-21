/* ══════════════════════════════════════════════════════════════════════════
   EACH CHAT REMEMBERS ITS OWN AGENT, MODEL AND EFFORT
   packages/web2/src/agents/chatConfig.ts

   Owner: "it was more of a logistic issue of switching models and context
   saving and being pushed into the next agents. And when you come back into a
   chat, the model isn't, and it's actually not really there."

   The picker wrote the model and effort under the AGENT (`config[agent]`), so
   every chat on Claude shared one pick: choosing Sonnet in chat A made chat B
   show Sonnet and send it, and a reload forgot a pick no turn had used yet.
   The pick is now kept under the CHAT (`chatConfig[chatId]`) and saved in the
   browser with the agent the chat talks to; `config[agent]` stays only as the
   default for board nodes and chats with no pick of their own. The picker
   writes the chat's pick directly (`setChatPick`).
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentCaps, AgentRunsState } from './agentRuns';
import { readSwitchRule, type SwitchRule } from '../state/switchRule';

export type ChatPick = { model?: string; effort?: string; switchRule?: SwitchRule };

/**
 * Whether `caps` still offers `model`. Unknown until the agent's list is read: then the
 * saved model is kept (and sent), because the list is the only record of what is offered.
 */
export function modelOffered(caps: AgentCaps | undefined, model: string): boolean {
  return !caps || caps.models.length === 0 || caps.models.some((m) => m.id === model);
}

/** The pick a chat made, or {}. Its model is dropped when the agent no longer offers it (the agent's default answers, visibly). */
export function chatPick(state: Pick<AgentRunsState, 'caps' | 'chatConfig'>, agentRef: string, sessionId: string | null): ChatPick {
  const pick = (sessionId && state.chatConfig?.[sessionId]) || {};
  /* A model that is gone takes its effort with it: the effort was chosen for that model. */
  return pick.model && !modelOffered(state.caps?.[agentRef], pick.model) ? {} : pick;
}

/** Drop a deleted chat's agent and pick. */
export function forgetChat(state: AgentRunsState, sessionId: string): AgentRunsState {
  if (!(sessionId in (state.agents ?? {})) && !(sessionId in (state.chatConfig ?? {}))) return state;
  const { [sessionId]: _a, ...agents } = state.agents ?? {};
  const { [sessionId]: _c, ...chatConfig } = state.chatConfig ?? {};
  return { ...state, agents, chatConfig };
}

/** Write a chat's pick (the composer's own path: it knows the chat). */
export function setChatPick(state: AgentRunsState, sessionId: string, patch: ChatPick): AgentRunsState {
  if (!sessionId) return state;
  return { ...state, chatConfig: { ...state.chatConfig, [sessionId]: { ...state.chatConfig?.[sessionId], ...patch } } };
}

/* ── SAVED IN THE BROWSER ──────────────────────────────────────────────────
   What no turn has carried yet (an agent attached, a model picked, nothing sent)
   is in no saved run, so it is kept here: chat id -> agent, model, effort. */

const KEY = 'sequence.chatAgentPicks.v1';
export type SavedPicks = Record<string, ChatPick & { agent?: string }>;

type Keeper = Pick<Storage, 'getItem' | 'setItem'>;

export function readSavedPicks(storage: Keeper | null): SavedPicks {
  try {
    const raw = storage?.getItem(KEY);
    const j = raw ? (JSON.parse(raw) as unknown) : null;
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    const out: SavedPicks = {};
    for (const [sid, v] of Object.entries(j as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const s = (x: unknown) => (typeof x === 'string' && x ? x : undefined);
      const e = v as Record<string, unknown>;
      /* An EMPTY agent is a fact: the reader chose a built-in model for this chat. */
      const rule = readSwitchRule(e.switchRule);
      out[sid] = { ...(typeof e.agent === 'string' ? { agent: e.agent } : {}), ...(s(e.model) ? { model: s(e.model) } : {}), ...(s(e.effort) ? { effort: s(e.effort) } : {}), ...(rule ? { switchRule: rule } : {}) };
    }
    return out;
  } catch {
    return {};
  }
}

export function savedPicksOf(state: Pick<AgentRunsState, 'agents' | 'chatConfig'>): SavedPicks {
  const out: SavedPicks = {};
  for (const sid of new Set([...Object.keys(state.agents ?? {}), ...Object.keys(state.chatConfig ?? {})])) {
    const agent = state.agents?.[sid];
    const c = state.chatConfig?.[sid] ?? {};
    const e = { ...(agent !== undefined ? { agent } : {}), ...(c.model ? { model: c.model } : {}), ...(c.effort ? { effort: c.effort } : {}), ...(c.switchRule ? { switchRule: c.switchRule } : {}) };
    if (Object.keys(e).length) out[sid] = e;
  }
  return out;
}

export function writeSavedPicks(storage: Keeper | null, state: Pick<AgentRunsState, 'agents' | 'chatConfig'>): void {
  try {
    storage?.setItem(KEY, JSON.stringify(savedPicksOf(state)));
  } catch {
    /* a full or blocked store: the picks last for this page only */
  }
}

/** The state's agents and chatConfig, from what was saved. */
export function stateFromSaved(saved: SavedPicks): Pick<AgentRunsState, 'agents' | 'chatConfig'> {
  const agents: Record<string, string> = {};
  const chatConfig: Record<string, ChatPick> = {};
  for (const [sid, v] of Object.entries(saved)) {
    if (v.agent !== undefined) agents[sid] = v.agent;
    if (v.model || v.effort || v.switchRule) chatConfig[sid] = { ...(v.model ? { model: v.model } : {}), ...(v.effort ? { effort: v.effort } : {}), ...(v.switchRule ? { switchRule: v.switchRule } : {}) };
  }
  return { agents, chatConfig };
}
