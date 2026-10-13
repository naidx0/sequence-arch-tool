/* ══════════════════════════════════════════════════════════════════════════
   SEQUENCE'S BOARD SERVER, FOR EVERY AGENT SESSION SEQUENCE STARTS (S2a)
   packages/analyzer/src/server/sequenceMcp.ts

   The agent Sequence drives (Claude over ACP, codex over app-server) gets
   Sequence's own MCP server (packages/mcp) in its session: the map slice, a
   node's neighbours, its blast radius, the architecture diff. acp's
   promptContent.ts puts the entry built here into ACP `mcpServers` and
   codex's per-thread `mcp_servers.sequence.*` override; nothing writes the
   user's own config.

   NO RESCAN PER SESSION. The server is spawned per session with the
   session's repository (SEQUENCE_REPO, the repo or the chat's worktree);
   building it reads nothing, and its tools load the persisted analysis
   (`<repo>/.sequence/graph.json`, graphCache.ts) whenever the code is
   unchanged, as the running server keeps it. packages/mcp's
   s2a-session.test.ts holds both.

   CONTEXT COST. SEQUENCE_MCP_TOOLS=core gives the session the four map tools
   (1,197 tokens of listing) plus the three drawing tools (draw, list_boards,
   create_board; round 9, ask 27), against 4,076 for all sixteen (lab/log.md);
   the "all board tools" agent setting gives it everything.

   THE ENTRY. In the installed app: analyzer/dist/sequence-mcp.cjs, the one
   file desktop prepare-server bundles (analyzer scripts/bundle-mcp.mjs). In
   the workspace: packages/mcp/dist/server.js (the stdio entry; dist/index.js
   only builds the server), or under node_modules. Or named by
   SEQUENCE_MCP_ENTRY. Not found: no server, and the session runs as before.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentMcpServer } from '@sequence/acp';

/* First the packaged app's one-file bundle (desktop prepare-server writes it
   beside the analyzer's: <resources>/server/packages/analyzer/dist/
   sequence-mcp.cjs, found from dist/ or dist/server/), then the workspace. */
const CANDIDATES = ['sequence-mcp.cjs', path.join('packages', 'mcp', 'dist', 'server.js'), path.join('node_modules', '@sequence', 'mcp', 'dist', 'server.js')];

/** The stdio entry of packages/mcp, or null when this install has none. */
export function sequenceMcpEntry(env: NodeJS.ProcessEnv = process.env, from: string = path.dirname(fileURLToPath(import.meta.url))): string | null {
  const named = env.SEQUENCE_MCP_ENTRY?.trim();
  if (named) return fs.existsSync(named) ? path.resolve(named) : null;
  let dir = from;
  for (let i = 0; i < 10; i++) {
    for (const rel of CANDIDATES) {
      const file = path.join(dir, rel);
      if (fs.existsSync(file)) return file;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/**
 * The entry for a session in `repo`: node (this process's own, so no PATH
 * lookup) running the stdio server for that repository. Under Electron the
 * same binary runs as node (ELECTRON_RUN_AS_NODE).
 */
/** The drawing ids a message references (@drawing:d3): the only ones the agent's visual tool may version from another chat. */
export const referencedDrawingIds = (message: string): string[] => [...new Set([...message.matchAll(/@drawing:(d\d+)\b/g)].map((m) => m[1]!))];

export function sequenceMcpServer(repo: string, opts: { allTools?: boolean; /** false: the session starts without the `components` tool (mode manual, or components off). */ components?: boolean; /** Where `components load` asks the app, and as which thread (so approve mode can raise a card). */ componentsMode?: string; componentsUrl?: string; componentsKey?: string; entry?: string | null; drawings?: { root: string; chat: string | null; referenced?: readonly string[] }; /** A goal run is working this chat: the agent also gets the `goal` tool (plan ticks), jailed to this chat's plan. */ goal?: { chat: string; url: string; key: string } } = {}): AgentMcpServer | null {
  const entry = opts.entry === undefined ? sequenceMcpEntry() : opts.entry;
  if (!entry) return null;
  const electron = typeof process.versions.electron === 'string';
  return {
    name: 'sequence',
    command: process.execPath,
    args: [entry],
    env: {
      SEQUENCE_REPO: path.resolve(repo),
      SEQUENCE_MCP_TOOLS: opts.allTools ? 'all' : 'core',
      ...(opts.components === false ? { SEQUENCE_MCP_COMPONENTS: 'off' } : {}),
      ...(opts.componentsMode ? { SEQUENCE_COMPONENTS_MODE: opts.componentsMode } : {}),
      ...(opts.componentsUrl ? { SEQUENCE_COMPONENTS_URL: opts.componentsUrl } : {}),
      ...(opts.componentsKey ? { SEQUENCE_COMPONENTS_KEY: opts.componentsKey } : {}),
      /* Lane components: the visual tool saves drawings where the app reads them (the project, not the chat's worktree) under this chat. */
      ...(opts.drawings ? { SEQUENCE_DRAWINGS_ROOT: path.resolve(opts.drawings.root), ...(opts.drawings.chat ? { SEQUENCE_CHAT: opts.drawings.chat } : {}), ...(opts.drawings.referenced?.length ? { SEQUENCE_REFERENCED: opts.drawings.referenced.join(',') } : {}) } : {}),
      ...(opts.goal ? { SEQUENCE_GOAL_URL: opts.goal.url, SEQUENCE_GOAL_KEY: opts.goal.key, SEQUENCE_GOAL_CHAT: opts.goal.chat } : {}),
      ...(electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
    },
  };
}
