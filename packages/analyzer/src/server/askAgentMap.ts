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

     GET /api/agent-settings  → { includeArchitectureMap, map: { tokens } | null }
     PUT /api/agent-settings  { includeArchitectureMap: boolean }
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { DEFAULT_MAP_BUDGET, MAP_FILES, mapHead } from '../agentMap.js';
import { readUserJson, writeUserJson } from './store.js';

/** The user-store file, beside ai.json and recent.json. */
export const AGENT_SETTINGS_FILE = 'agent-settings.json';

export interface AgentSettings {
  /** "Include the architecture map in the agent's context". On by default. */
  includeArchitectureMap: boolean;
  /**
   * S2a: give a coding agent's session every board tool (16, 4,076 tokens of
   * listing) instead of the core four (map, who_calls, impact,
   * architecture_changed; packages/mcp CORE_TOOLS). Off by default.
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
  return { includeArchitectureMap: o.includeArchitectureMap !== false, allBoardTools: o.allBoardTools === true, autoRefine: o.autoRefine === true };
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
    const all = o.allBoardTools;
    const auto = o.autoRefine;
    if ((map !== undefined && typeof map !== 'boolean') || (all !== undefined && typeof all !== 'boolean') || (auto !== undefined && typeof auto !== 'boolean') || (map === undefined && all === undefined && auto === undefined)) {
      send(res, 400, { error: 'body must be {"includeArchitectureMap"?: true|false, "allBoardTools"?: true|false, "autoRefine"?: true|false} with at least one' });
      return true;
    }
    writeAgentSettings(ctx.storeDir, { ...(typeof map === 'boolean' ? { includeArchitectureMap: map } : {}), ...(typeof all === 'boolean' ? { allBoardTools: all } : {}), ...(typeof auto === 'boolean' ? { autoRefine: auto } : {}) });
  } else if (method !== 'GET') {
    return false;
  }
  const settings = readAgentSettings(ctx.storeDir);
  const section = agentMapSection(ctx.repoRoot);
  send(res, 200, { ...settings, map: section ? { tokens: section.tokens } : null });
  return true;
}
