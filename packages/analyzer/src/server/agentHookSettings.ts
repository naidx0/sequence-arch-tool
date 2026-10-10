/* ══════════════════════════════════════════════════════════════════════════
   THE PER-SESSION HOOK SETTINGS — `claude --settings <file>`
   packages/analyzer/src/server/agentHookSettings.ts

   Registers Sequence's agent-event route as Claude Code `type: "http"` hooks
   for ONE session. It writes a fresh file and never reads or edits the user's
   own ~/.claude/settings.json: `--settings` layers this file on top of theirs
   for the session it is passed to, and nowhere else.

     node packages/analyzer/dist/server/agentHookSettings.js --port 4317 [--out file]
     claude --settings <file>
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** The tools whose calls are drawn on the board. */
export const AGENT_HOOK_TOOL_MATCHER = 'Edit|Write|MultiEdit|Read|Bash';
/** The tools that write files: their PreToolUse is synchronous, so the turn
 *  snapshot records the path BEFORE the write lands (snapshot.ts, S3). */
export const AGENT_HOOK_WRITE_MATCHER = 'Edit|Write|MultiEdit';
/** The rest of the tool matcher, still fire-and-forget. */
export const AGENT_HOOK_OTHER_MATCHER = 'Read|Bash';
/** Hooks without a tool matcher. */
export const AGENT_HOOK_LIFECYCLE = ['SessionStart', 'SubagentStart', 'SubagentStop', 'Stop'] as const;

export interface HttpHook {
  type: 'http';
  url: string;
  timeout: number;
  async?: true;
}
export interface HookSettings {
  hooks: Record<string, { matcher?: string; hooks: HttpHook[] }[]>;
  /** S2a: Sequence's board tools run without asking (they only read). */
  permissions?: { allow: string[] };
}

/** S2a: the permission rule for every tool of Sequence's board server. */
export const BOARD_TOOLS_RULE = 'mcp__sequence__*';

/**
 * The settings object for a server on `baseUrl` (e.g. http://127.0.0.1:4317).
 *
 * Synchronous: PostToolUse (its reply carries the service context) and
 * SessionStart (its reply carries the first 1k tokens of map.md — an async
 * hook's reply would never reach the session). Everything else is
 * `async: true`, so the board can never hold an agent up.
 */
export function agentHookSettings(baseUrl: string, opts: { allowBoard?: boolean } = {}): HookSettings {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/agent-event`;
  const sync: HttpHook = { type: 'http', url, timeout: 5 };
  const fireAndForget: HttpHook = { ...sync, async: true };
  const hooks: HookSettings['hooks'] = {
    PreToolUse: [
      { matcher: AGENT_HOOK_WRITE_MATCHER, hooks: [sync] },
      { matcher: AGENT_HOOK_OTHER_MATCHER, hooks: [fireAndForget] },
    ],
    PostToolUse: [{ matcher: AGENT_HOOK_TOOL_MATCHER, hooks: [sync] }],
    SessionStart: [{ hooks: [sync] }],
    /* A turn starts when the user's prompt is submitted: synchronous, so the
       working tree is snapshotted before the agent can change it. */
    UserPromptSubmit: [{ hooks: [sync] }],
  };
  for (const ev of AGENT_HOOK_LIFECYCLE) if (!hooks[ev]) hooks[ev] = [{ hooks: [fireAndForget] }];
  return opts.allowBoard ? { hooks, permissions: { allow: [BOARD_TOOLS_RULE] } } : { hooks };
}

/**
 * S2a: THE TERMINAL'S CLAUDE SEES THE BOARD TOO. Beside the per-session
 * settings, an `--mcp-config` file names Sequence's board server for this
 * repository, and the settings allow its tools. Neither is the user's own
 * config; both are fresh files in a fresh temp directory.
 */
export function writeClaudeSession(
  baseUrl: string,
  board: { command: string; args: string[]; env?: Record<string, string> } | null,
  homeDir: string = os.homedir(),
): { settingsFile: string; mcpConfigFile: string | null; command: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-hooks-'));
  const settingsFile = path.join(dir, 'claude-settings.json');
  const home = path.resolve(homeDir, '.claude', 'settings.json');
  if (path.resolve(settingsFile) === home) throw new Error("refusing to write the user's own ~/.claude/settings.json; pass a per-session file");
  fs.writeFileSync(settingsFile, JSON.stringify(agentHookSettings(baseUrl, { allowBoard: board !== null }), null, 2) + '\n');
  let mcpConfigFile: string | null = null;
  if (board) {
    mcpConfigFile = path.join(dir, 'claude-mcp.json');
    fs.writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers: { sequence: { command: board.command, args: board.args, env: board.env ?? {} } } }, null, 2) + '\n');
  }
  const command = `claude --settings "${settingsFile}"${mcpConfigFile ? ` --mcp-config "${mcpConfigFile}"` : ''}`;
  return { settingsFile, mcpConfigFile, command };
}

/**
 * Write the settings file. `out` defaults to a new file under the OS temp dir,
 * so two sessions never share (or clobber) one.
 */
export function writeAgentHookSettings(baseUrl: string, out?: string, homeDir: string = os.homedir()): string {
  const file =
    out ?? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-hooks-')), 'claude-settings.json');
  const home = path.resolve(homeDir, '.claude', 'settings.json');
  if (path.resolve(file) === home) {
    throw new Error("refusing to write the user's own ~/.claude/settings.json; pass a per-session file");
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(agentHookSettings(baseUrl), null, 2) + '\n');
  return file;
}

/* Run directly only as itself: in the one-file server bundle import.meta.url is
   the bundle, which is also argv[1], so the bundle's boot used to run this
   (round 7: a stray settings file and a printed command on every start). */
const invokedDirectly =
  !!process.argv[1] && /^agentHookSettings\.[cm]?js$/.test(path.basename(process.argv[1])) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const arg = (n: string): string | undefined => {
    const i = process.argv.indexOf(n);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const base = arg('--url') ?? `http://127.0.0.1:${arg('--port') ?? '4317'}`;
  const file = writeAgentHookSettings(base, arg('--out'));
  process.stdout.write(`${file}\nclaude --settings "${file}"\n`);
}
