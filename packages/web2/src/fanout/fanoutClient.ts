/* ══════════════════════════════════════════════════════════════════════════
   BEST OF N, THE PAGE'S HALF
   packages/web2/src/fanout/fanoutClient.ts

   One message to several agents: POST /api/fanout makes a chat and a worktree
   per agent (all or none), then each agent is started in its own chat with the
   same message. The page lands in the first chat; the others are in the rail,
   and each chat's worktree panel compares the siblings (FanoutCompare.tsx).
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentRunStore, StartRunOptions } from '../agents/agentRuns';
import type { Store } from '../state';
import { activateSession, listAndHydrateSessions } from '../v3/sessionActions';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface FanoutChat {
  chatId: string;
  agentRef: string;
  title: string;
}

/** A sibling whose work was never merged: what discarding it would lose. */
export interface AtRisk {
  chatId: string;
  agentRef: string;
  commits: { sha: string; subject: string }[];
  uncommittedFiles: number;
}

export interface SiblingView {
  chatId: string;
  agentRef: string;
  title: string;
  branch: string | null;
  chosen: boolean;
  merged: boolean;
  removed: boolean;
  /** The server says an agent turn is running in this chat. */
  running?: boolean;
  files: { path: string; status: string }[];
  dryRun: { target: string; conflicts: string[]; mainUncommitted: string[]; clean: boolean } | null;
  error?: string;
}

interface Answer<T> {
  ok: boolean;
  status: number;
  body: T & { error?: string };
}

async function call<T>(f: Fetch, url: string, body?: unknown): Promise<Answer<T>> {
  const res = await f(url, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let parsed: unknown = {};
  try {
    parsed = await res.json();
  } catch {
    parsed = { error: `The server answered ${res.status}.` };
  }
  return { ok: res.ok, status: res.status, body: parsed as T & { error?: string } };
}

export const fanoutApi = {
  create: (prompt: string, agents: readonly string[], f: Fetch = fetch) => call<{ fanoutId: string; chats: FanoutChat[] }>(f, '/api/fanout', { prompt, agents }),
  compare: (id: string, f: Fetch = fetch) => call<{ prompt: string; siblings: SiblingView[] }>(f, `/api/fanout/${encodeURIComponent(id)}`),
  choose: (id: string, chatId: string, mode: 'merge' | 'squash', f: Fetch = fetch) =>
    call<{ into: string; files: unknown[] }>(f, `/api/fanout/${encodeURIComponent(id)}/choose`, { chatId, mode }),
  discardOthers: (id: string, keep: string, confirmLoss: string | null = null, f: Fetch = fetch) =>
    call<{ removed: string[]; failed: { chatId: string; error: string }[]; needsConfirm?: AtRisk[]; confirmToken?: string }>(f, `/api/fanout/${encodeURIComponent(id)}/discard-others`, { keep, ...(confirmLoss ? { confirmLoss } : {}) }),
};

export type SendResult = { ok: true; fanoutId: string; chats: FanoutChat[] } | { ok: false; error: string };

export interface SendOptions {
  store: Store;
  runs: AgentRunStore;
  prompt: string;
  agents: readonly string[];
  /** How each agent is started (access, intent); the question and chat are set here. */
  start?: Omit<StartRunOptions, 'question' | 'sessionId' | 'agentRef'>;
  f?: Fetch;
}

/** The send: make the chats, show them, land in the first, start every agent. */
export async function sendToAgents(o: SendOptions): Promise<SendResult> {
  const made = await fanoutApi.create(o.prompt, o.agents, o.f ?? ((i, init) => fetch(i, init))).catch((e: unknown) => ({ ok: false, status: 0, body: { error: `Could not reach the server: ${e instanceof Error ? e.message : String(e)}` } }) as Awaited<ReturnType<typeof fanoutApi.create>>);
  if (!made.ok) return { ok: false, error: made.body.error ?? `The server refused (${made.status}).` };
  const { fanoutId, chats } = made.body;
  await listAndHydrateSessions(o.store);
  await activateSession(o.store, chats[0]!.chatId);
  for (const c of chats) void o.runs.start({ ...(o.start ?? {}), agentRef: c.agentRef, sessionId: c.chatId, question: o.prompt });
  return { ok: true, fanoutId, chats };
}
