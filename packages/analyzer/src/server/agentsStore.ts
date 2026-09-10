/**
 * The USER-LEVEL local-agent registry (`~/.sequence/agents.json`, v16 Wave 2a).
 *
 * A user registers the coding agents installed on THEIR machine — Claude Code,
 * Codex, Gemini, Copilot — as `{ id, command, args?, cwd?, label? }` records, and
 * the CLI (`sequence agent add/list/remove`) plus the localhost-gated ACP
 * endpoints (`GET /api/acp/agents`, `POST /api/acp/run-node`) resolve an agent by
 * `id` to a launch config for `@sequence/acp`'s `AcpClient`.
 *
 * This mirrors `store.ts`'s github.json pattern EXACTLY: the raw JSON is read /
 * written via the hardened {@link readUserJson}/{@link writeUserJson} helpers
 * (a missing / unreadable / malformed file yields an empty registry, never a
 * throw), and every persisted entry is validated to a clean shape on the way in
 * AND filtered on the way out, so a poisoned / hand-edited file can never inject
 * a non-string command or crash a `program run`. It holds NO secret — just how to
 * launch a local binary — so nothing is redacted.
 */

import { readUserJson, writeUserJson, AGENTS_FILE } from './store.js';

/** One registered local coding agent: how to spawn it over ACP. */
export interface AgentEntry {
  /** Stable id the user (and program `acp.agentRef`) references. */
  id: string;
  /** The agent binary/command to spawn (e.g. `npx`, `claude-code-acp`). */
  command: string;
  /** Arguments for the command. */
  args?: string[];
  /** Default working directory (the repo). Absent ⇒ the caller's cwd. */
  cwd?: string;
  /** A human-friendly display name. */
  label?: string;
}

/** The on-disk shape of `agents.json`. */
export interface AgentsConfig {
  agents: AgentEntry[];
}

/**
 * Coerce ONE raw record to a clean {@link AgentEntry}, or `null` when it is not a
 * usable agent (no string id / command). Optional fields survive only when
 * well-typed; anything else is dropped. Total — never throws — so a partially
 * poisoned file still yields the entries that ARE valid.
 */
function sanitizeEntry(raw: unknown): AgentEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const command = typeof r.command === 'string' ? r.command.trim() : '';
  if (id === '' || command === '') return null;
  const entry: AgentEntry = { id, command };
  if (Array.isArray(r.args)) {
    const args = r.args.filter((a): a is string => typeof a === 'string');
    if (args.length > 0) entry.args = args;
  }
  if (typeof r.cwd === 'string' && r.cwd.trim() !== '') entry.cwd = r.cwd;
  if (typeof r.label === 'string' && r.label.trim() !== '') entry.label = r.label;
  return entry;
}

/**
 * The registered agents, most-recently-added last, de-duplicated by id (a later
 * entry with the same id wins), with every malformed record pruned. A missing /
 * unreadable / malformed file yields `[]`.
 */
export function listAgents(storeDir: string): AgentEntry[] {
  const cfg = readUserJson<Partial<AgentsConfig>>(storeDir, AGENTS_FILE);
  const rawList = cfg && Array.isArray(cfg.agents) ? cfg.agents : [];
  const byId = new Map<string, AgentEntry>();
  for (const raw of rawList) {
    const clean = sanitizeEntry(raw);
    if (clean) byId.set(clean.id, clean);
  }
  return [...byId.values()];
}

/** The agent registered under `id`, or undefined when there is none. */
export function getAgent(storeDir: string, id: string): AgentEntry | undefined {
  if (typeof id !== 'string' || id.trim() === '') return undefined;
  return listAgents(storeDir).find((a) => a.id === id.trim());
}

/**
 * Add (or REPLACE, by id) an agent and persist the registry. Returns the full
 * agent list after the write. Throws a clear Error when the entry is unusable
 * (no id / no command) — the CLI turns that into an honest message + nonzero exit.
 */
export function addAgent(storeDir: string, entry: AgentEntry): AgentEntry[] {
  const clean = sanitizeEntry(entry);
  if (!clean) {
    throw new Error('an agent needs a non-empty "id" and "command"');
  }
  const next = listAgents(storeDir).filter((a) => a.id !== clean.id);
  next.push(clean);
  writeUserJson(storeDir, AGENTS_FILE, { agents: next } satisfies AgentsConfig);
  return next;
}

/**
 * Remove the agent registered under `id` and persist. Returns `{ removed, agents }`
 * — `removed` is false when there was no such id (the caller reports that honestly
 * rather than pretending it deleted something).
 */
export function removeAgent(storeDir: string, id: string): { removed: boolean; agents: AgentEntry[] } {
  const before = listAgents(storeDir);
  const next = before.filter((a) => a.id !== id.trim());
  const removed = next.length !== before.length;
  if (removed) writeUserJson(storeDir, AGENTS_FILE, { agents: next } satisfies AgentsConfig);
  return { removed, agents: next };
}
