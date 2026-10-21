/* ══════════════════════════════════════════════════════════════════════════
   AGENT PROFILES: `@review find what breaks`, ONE MESSAGE IN A ROLE
   packages/web2/src/chat/agentProfiles.ts

   The server reads the agent files people already have (Claude Code's
   .claude/agents, OpenCode's agents, Sequence's .sequence/agents, three built
   in) at GET /api/acp/profiles. A message that STARTS with `@<name>` goes to
   the agent with that profile's instructions in front of it; the chat shows
   and saves only what was typed (the `display` split visualHint already
   uses). A read-only profile sends that one message in Plan, so the agent's
   own permission mode refuses every write: enforced, not requested.

   Not a fourth mode. The owner cut the modes to three (Plan, Smart, Full
   auto); a profile is WHO answers, for one message, and the mode chip stays
   as the person set it.
   ══════════════════════════════════════════════════════════════════════════ */

export const PROFILES_ROUTE = '/api/acp/profiles';

export interface AgentProfile {
  name: string;
  description: string;
  prompt: string;
  readOnly: boolean;
  source: 'builtin' | 'user' | 'project';
  format: 'sequence' | 'claude' | 'opencode' | 'builtin';
  file?: string;
  model?: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

let cached: Promise<AgentProfile[]> | null = null;

function isProfile(x: unknown): x is AgentProfile {
  const p = x as AgentProfile | null;
  return !!p && typeof p.name === 'string' && typeof p.prompt === 'string' && typeof p.readOnly === 'boolean';
}

/** The profiles, read once per page (`refresh` reads again, so a send after a project switch sees that project's). A failed read is no profiles, never an error, and is not kept. */
export function loadProfiles(f: Fetch = (i, init) => fetch(i, init), refresh = false): Promise<AgentProfile[]> {
  if (cached && !refresh) return cached;
  const read: Promise<AgentProfile[]> = f(PROFILES_ROUTE, { headers: { accept: 'application/json' } })
    .then(async (r) => (r.ok ? ((await r.json()) as { profiles?: unknown }) : null))
    .then((b) => {
      if (!b || !Array.isArray(b.profiles)) throw new Error('no profile list');
      return b.profiles.filter(isProfile);
    })
    .catch(() => {
      /* A failed read (the server not up yet) is not kept: the next ask reads again. */
      if (cached === read) cached = null;
      return [] as AgentProfile[];
    });
  cached = read;
  return read;
}

/** Test seam: forget the page's read. */
export function resetProfiles(): void {
  cached = null;
}

/** `@review rest of it` -> { name: 'review', rest: 'rest of it' }; anything else -> null. Only at the very start. */
export function profileMention(text: string): { name: string; rest: string } | null {
  const m = /^@([a-z0-9][a-z0-9._-]{0,47})(?=\s|$)\s*([\s\S]*)$/i.exec(text);
  return m ? { name: m[1]!.toLowerCase(), rest: m[2]! } : null;
}

/** `@rev` typed alone at the start of the composer -> 'rev' (the profile menu opens on it); `@` -> ''; anything else -> null. */
export function profileQuery(text: string): string | null {
  const m = /^@([a-z0-9._-]{0,47})$/i.exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

export interface ProfiledMessage {
  profile: AgentProfile;
  /** The agent's copy: the profile's instructions, then the request without its `@name`. */
  agentText: string;
}

/**
 * The agent's copy of `full` (the message with its attachments expanded) when
 * `typed` starts with a known `@name`; null otherwise, and then nothing changes.
 * An unknown `@name` is left as typed: it may be a handle, not a profile.
 */
export function applyProfile(typed: string, full: string, profiles: readonly AgentProfile[]): ProfiledMessage | null {
  const mention = profileMention(typed);
  if (!mention) return null;
  const profile = profiles.find((p) => p.name === mention.name);
  if (!profile) return null;
  const request = profileMention(full)?.rest ?? full;
  const rule = profile.readOnly ? ' This message runs read-only: do not edit files or run commands that change anything.' : '';
  return {
    profile,
    agentText: `[For this message, act as the "${profile.name}" agent profile.${rule} Its instructions follow.]\n${profile.prompt}\n\n[The request:]\n${request}`,
  };
}
