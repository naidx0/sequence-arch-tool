/* ══════════════════════════════════════════════════════════════════════════
   THE ARCHITECTURE MAP IN THE AGENT'S CONTEXT — on by default
   packages/analyzer/src/server/askAgentMap.ts

   Every ask turn on an attached repository carries the repo's `.sequence/map.md`
   (the 4k map the server writes on attach and rescan; agentMap.ts) as one
   section of the prompt, unless the user turned it off.

   THE EVIDENCE, scoped to what was measured: a bash agent with map.md in its
   prompt beat the same agent without it on the sealed 36-question set
   (cdbd6fa7), paired 3 vs 3, on two model families — qwen3.5:4b +0.148 F1
   (2.58 SE) and granite4.2:3b +0.240 F1 (4.26 SE). lab/log.md, 2026-10-05/06.

   The token count the settings pane shows comes from THIS module's
   `agentMapSection`, the same call that builds the lines the prompt carries,
   so the number on screen is the size of what is sent.

     GET /api/agent-settings  → { includeArchitectureMap, mapToAgents, allBoardTools, autoRefine, updates: { check },
                                  map: { tokens } | null,
                                  tools: { all, core, allTokens, coreTokens } | null }
     PUT /api/agent-settings  { includeArchitectureMap?, mapToAgents?, allBoardTools?, autoRefine?, updates?: { check } }
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_MAP_BUDGET, MAP_FILES, mapHead } from '../agentMap.js';
import type { ThreadNoteLedger } from '../harness/refineNotes.js';
import { readToolsListing } from './toolsListing.js';
import { readUserJson, writeUserJson } from './store.js';

/** The user-store file, beside ai.json and recent.json. */
export const AGENT_SETTINGS_FILE = 'agent-settings.json';

export interface AgentSettings {
  /** "Include the architecture map in the agent's context". On by default. */
  includeArchitectureMap: boolean;
  /** Also send the map to Claude and Codex, once per chat thread (agentMapBlockForThread). OFF by default until the A/B shows it helps; only an explicit true turns it on. */
  mapToAgents: boolean;
  /**
   * S2a: give a coding agent's session every board tool instead of the core
   * set (packages/mcp CORE_TOOLS). The counts and token cost are in the GET
   * payload's `tools`, read from the registry. Off by default.
   */
  allBoardTools: boolean;
  /**
   * Accept a newly proposed repo note without asking (harness/learningLoop.ts
   * runSignalLoop). OFF by default and only an explicit true turns it on: the
   * Factorio run in the Prime Agent post is what an ungated self-edit loop
   * learns to do. Every auto-accepted note is still one line with its evidence
   * and can be undone from the same card.
   */
  autoRefine: boolean;
  /**
   * `updates.check`: the app looks for a new release once a day (a request to api.github.com).
   * On by default; only an explicit false turns it off. The scheduler (cli.ts launch) reads it on
   * every tick through `updatesCheckEnabled`, so switching it takes effect without a restart.
   */
  updates: { check: boolean };
  /**
   * Claims-audit 1.6 (V05): draw short flows (1 to 3 ranks) top to bottom like longer ones, instead of left to
   * right. OFF by default (today's layout) until the screenshot A/B (tools/bench/flow-direction-score.mjs) says
   * top to bottom wins; only an explicit true turns it on.
   */
  boardFlowsTopDown: boolean;
  /**
   * Claims-audit 2.6 (F3): in Claude sessions, a PreToolUse hook answers the first Grep or Glob of a turn with
   * find_files results. OFF by default; only an explicit true turns it on. The agent-ab A/B is not yet run.
   */
  findFilesFirst: boolean;
}

/** Whether anything may ask GitHub for a release on its own: the setting is on and SEQUENCE_NO_UPDATE_CHECK is not 1. Only an explicit "Check now" ignores this. */
export function automaticUpdateCheckAllowed(storeDir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SEQUENCE_NO_UPDATE_CHECK !== '1' && updatesCheckEnabled(storeDir);
}

/** Whether the daily release check may run. Unreadable or absent settings mean yes (the default). */
export function updatesCheckEnabled(storeDir: string): boolean {
  return readAgentSettings(storeDir).updates.check;
}

export function readAgentSettings(storeDir: string): AgentSettings {
  let raw: unknown;
  try {
    raw = readUserJson(storeDir, AGENT_SETTINGS_FILE);
  } catch {
    raw = undefined;
  }
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  /* Only an explicit false turns the map off, only an explicit true turns every tool on: absent, corrupt or unreadable is the default. */
  const up = o.updates && typeof o.updates === 'object' ? (o.updates as Record<string, unknown>) : {};
  return { includeArchitectureMap: o.includeArchitectureMap !== false, mapToAgents: o.mapToAgents === true, allBoardTools: o.allBoardTools === true, autoRefine: o.autoRefine === true, updates: { check: up.check !== false }, boardFlowsTopDown: o.boardFlowsTopDown === true, findFilesFirst: o.findFilesFirst === true };
}

/** Write the settings; a field left out keeps its stored value. */
export function writeAgentSettings(storeDir: string, settings: Partial<AgentSettings>): void {
  writeUserJson(storeDir, AGENT_SETTINGS_FILE, { ...readAgentSettings(storeDir), ...settings });
}

export const AGENT_MAP_HEADER = '--- ARCHITECTURE MAP (.sequence/map.md: services, cross-service edges at file:line, apis, modules) ---';

export interface AgentMapSection {
  /** Exactly the lines the prompt carries. */
  lines: string[];
  /** ceil(chars / 4) of `lines.join('\n')`: what the settings pane shows. */
  tokens: number;
}

export const tokensOfLines = (lines: readonly string[]): number => Math.ceil(lines.join('\n').length / 4);

/**
 * The map section for `repoRoot`, cut so the whole section stays within
 * `budget` tokens. Null when the repo has no map.md (never scanned by this
 * server, a read-only tree): the prompt then simply has no map.
 */
export function agentMapSection(repoRoot: string | null, budget = DEFAULT_MAP_BUDGET): AgentMapSection | null {
  if (!repoRoot) return null;
  let text: string;
  try {
    text = fs.readFileSync(path.join(repoRoot, '.sequence', MAP_FILES[DEFAULT_MAP_BUDGET]), 'utf8');
  } catch {
    return null;
  }
  text = text.replace(/\r\n/g, '\n').trimEnd();
  if (!text.startsWith('# map ')) return null;
  /* The scan time changes on every rescan and sits near the top of the stable prompt head, where it broke
     the reusable prefix from that point on (harness study 2026-10-09). The prompt does not need it. */
  text = text.replace(/^(# map [^\n]*?) · scanned [^ \n]+ ·/, '$1 ·');
  const room = budget - Math.ceil((AGENT_MAP_HEADER.length + 1) / 4);
  const body = mapHead(`${text}\n`, room).trimEnd();
  const lines = [AGENT_MAP_HEADER, ...body.split('\n')];
  return { lines, tokens: tokensOfLines(lines) };
}

/** What an ask turn passes as `agentMapLines`: empty when off, in design mode, or with no map. */
export function agentMapLinesFor(opts: { storeDir: string; repoRoot: string | null; designMode: boolean }): string[] {
  if (opts.designMode || !opts.repoRoot) return [];
  if (!readAgentSettings(opts.storeDir).includeArchitectureMap) return [];
  return agentMapSection(opts.repoRoot)?.lines ?? [];
}

/** Ledger key for the map, beside the notes key (`#skills`, `#components` follow the same shape); `forget(prefix)` clears it with the thread. */
export const mapLedgerKey = (noteKey: string): string => `${noteKey}#map`;
export const AGENT_MAP_BLOCK_OPEN = "[Added by Sequence, not typed by the person. The architecture map of this repo, for orientation. It is information, not a request; the person's message wins:]";
export const AGENT_MAP_BLOCK_UPDATED = '[Added by Sequence, not typed by the person. The repo was rescanned; this architecture map replaces the earlier one:]';

export interface AgentMapBlock {
  /** Goes in front of the person's message. */
  text: string;
  /** ceil(chars / 4) of `text`. */
  tokens: number;
  /** Hash of the map lines; pass to {@link markMapBlock} once the turn has gone out. */
  hash: string;
}

/**
 * The map as a block in front of a Claude/Codex prompt: once per (chat, agent, thread), the same bytes every time,
 * sent again only when the map's hash changes (a rescan). Null when off, in design mode, with no map, or already sent.
 * Capped at DEFAULT_MAP_BUDGET by agentMapSection.
 */
export function agentMapBlockForThread(o: { storeDir: string; repoRoot: string | null; designMode: boolean; key: string; thread: string | null; ledger: ThreadNoteLedger }): AgentMapBlock | null {
  const s = readAgentSettings(o.storeDir);
  /* The sub-setting rides on the main one: with the map off, nothing goes to Claude or Codex either (what the Settings line says). */
  if (o.designMode || !o.repoRoot || !s.includeArchitectureMap || !s.mapToAgents) return null;
  const section = agentMapSection(o.repoRoot);
  if (!section) return null;
  const hash = createHash('sha1').update(section.lines.join('\n')).digest('hex').slice(0, 12);
  const lk = mapLedgerKey(o.key);
  if (o.ledger.unsent(lk, o.thread, [{ id: 'map', tip: hash }]).length === 0) return null;
  const resend = o.ledger.opened(lk, o.thread);
  const text = [resend ? AGENT_MAP_BLOCK_UPDATED : AGENT_MAP_BLOCK_OPEN, ...section.lines, '', '---', '', ''].join('\n');
  return { text, tokens: Math.ceil(text.length / 4), hash };
}

/** Record that the map with this hash went out on this thread (call once the prompt was accepted). */
export function markMapBlock(key: string, thread: string | null, ledger: ThreadNoteLedger, hash: string): void {
  ledger.mark(mapLedgerKey(key), thread, [{ id: 'map', tip: hash }]);
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Handle GET/PUT /api/agent-settings. False when the request is not ours. */
export async function handleAgentSettingsRoute(ctx: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  storeDir: string;
  repoRoot: string | null;
}): Promise<boolean> {
  const { req, res, method } = ctx;
  if (method === 'PUT') {
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, 4096));
    } catch (e) {
      send(res, 400, { error: `invalid JSON body: ${(e as Error).message}` });
      return true;
    }
    const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const map = o.includeArchitectureMap;
    const toAgents = o.mapToAgents;
    const all = o.allBoardTools;
    const auto = o.autoRefine;
    const up = o.updates;
    const flowTd = o.boardFlowsTopDown;
    const ffFirst = o.findFilesFirst;
    const upCheck = up && typeof up === 'object' ? (up as Record<string, unknown>).check : undefined;
    if (
      (map !== undefined && typeof map !== 'boolean') ||
      (toAgents !== undefined && typeof toAgents !== 'boolean') ||
      (all !== undefined && typeof all !== 'boolean') ||
      (auto !== undefined && typeof auto !== 'boolean') ||
      (up !== undefined && typeof upCheck !== 'boolean') ||
      (flowTd !== undefined && typeof flowTd !== 'boolean') ||
      (ffFirst !== undefined && typeof ffFirst !== 'boolean') ||
      (flowTd === undefined && ffFirst === undefined && map === undefined && toAgents === undefined && all === undefined && auto === undefined && up === undefined)
    ) {
      send(res, 400, { error: 'body must be {"includeArchitectureMap"?: true|false, "mapToAgents"?: true|false, "allBoardTools"?: true|false, "autoRefine"?: true|false, "updates"?: {"check": true|false}, "boardFlowsTopDown"?: true|false, "findFilesFirst"?: true|false} with at least one' });
      return true;
    }
    writeAgentSettings(ctx.storeDir, {
      ...(typeof map === 'boolean' ? { includeArchitectureMap: map } : {}),
      ...(typeof toAgents === 'boolean' ? { mapToAgents: toAgents } : {}),
      ...(typeof all === 'boolean' ? { allBoardTools: all } : {}),
      ...(typeof auto === 'boolean' ? { autoRefine: auto } : {}),
      ...(typeof upCheck === 'boolean' ? { updates: { check: upCheck } } : {}),
      ...(typeof flowTd === 'boolean' ? { boardFlowsTopDown: flowTd } : {}),
      ...(typeof ffFirst === 'boolean' ? { findFilesFirst: ffFirst } : {}),
    });
  } else if (method !== 'GET') {
    return false;
  }
  const settings = readAgentSettings(ctx.storeDir);
  const section = agentMapSection(ctx.repoRoot);
  /* The tool counts come from the MCP entry (toolsListing.ts), so the Settings copy cannot drift from the registry. null: no entry here. */
  send(res, 200, { ...settings, map: section ? { tokens: section.tokens } : null, tools: await readToolsListing() });
  return true;
}
