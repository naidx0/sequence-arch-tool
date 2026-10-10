/* ══════════════════════════════════════════════════════════════════════════
   ONE READY AGENT CONNECTS ITSELF (round 11, UX audit 1 and 2)
   packages/web2/src/onboarding/loneAgent.ts

   First run found Claude Code "Ready, Max" and then offered no way to use it:
   the shell opened with "Connect agent" and it took three more clicks. When
   exactly one agent is ready, opening a project registers it (the same
   POST /api/acp/agents/connect the model menu uses) and leaves a note for the
   shell, which makes it the first chat's agent. Two ready agents are a
   choice, so nothing is picked for the person.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ProviderStatus } from './onboardingClient';

export const CONNECT_ROUTE = '/api/acp/agents/connect';
export const AGENTS_ROUTE = '/api/acp/agents';
/** Fired once an agent is connected and noted, so a shell already on screen asks which agent to use. */
export const FIRST_AGENT_EVENT = 'sequence:first-agent';
/** The agent first run connected, kept until the shell has made it the chat's agent. */
export const FIRST_AGENT_KEY = 'sequence.onboarding.firstAgent';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The one provider that is ready, or null when none or several are. */
export function loneReady(providers: readonly ProviderStatus[] | null): ProviderStatus | null {
  const ready = (providers ?? []).filter((p) => p.state === 'ready');
  return ready.length === 1 ? ready[0]! : null;
}

export function rememberFirstAgent(id: string): void {
  try {
    window.localStorage.setItem(FIRST_AGENT_KEY, id);
    window.dispatchEvent(new Event(FIRST_AGENT_EVENT));
  } catch {
    /* the pill then offers the connect row, as before */
  }
}

export function takeFirstAgent(): string | null {
  try {
    const id = window.localStorage.getItem(FIRST_AGENT_KEY);
    return id || null;
  } catch {
    return null;
  }
}

export function clearFirstAgent(): void {
  try {
    window.localStorage.removeItem(FIRST_AGENT_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** Register one ready provider (round 12: first run's "Start chatting") and note it for the shell. */
export async function connectAgent(p: Pick<ProviderStatus, 'id'>, f: Fetch = (i, init) => fetch(i, init)): Promise<string | null> {
  try {
    const list = await f(AGENTS_ROUTE);
    const have = list.ok ? ((await list.json().catch(() => ({}))) as { agents?: { id: string }[] }).agents ?? [] : [];
    if (!have.some((a) => a.id === p.id)) {
      const r = await f(CONNECT_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: p.id }),
      });
      if (!r.ok) return null;
    }
    rememberFirstAgent(p.id);
    return p.id;
  } catch {
    return null;
  }
}
