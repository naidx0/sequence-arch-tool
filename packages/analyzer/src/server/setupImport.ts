/**
 * "Import my setup": which MCP servers and skills the user already has in
 * Claude Code and Codex, by NAME ONLY.
 *
 * The sources are the ones Hermes' `hermes_cli/agent_import.py` (MIT) reads:
 *   Claude Code  ~/.claude.json mcpServers, ~/.claude/settings.json mcpServers,
 *                ~/.claude/skills/<name>/SKILL.md
 *   Codex        ~/.codex/config.toml [mcp_servers.<name>],
 *                ~/.codex/skills/<name>/SKILL.md
 * Unlike that importer, nothing is copied and no server definition leaves this
 * file: a server's command, args and env (where keys and tokens live) are
 * never read into the answer, and the TOML is read for section headers only.
 * Credential files (~/.claude/.credentials.json, ~/.codex/auth.json) are never
 * opened.
 */

import fs from 'node:fs';
import path from 'node:path';

export type SetupSource = 'claude' | 'codex';

export interface SetupItem {
  name: string;
  source: SetupSource;
}

export interface SetupInventory {
  mcpServers: SetupItem[];
  skills: SetupItem[];
}

/** A name a person would recognise; anything else (a path, a URL, a key) is dropped. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._ @-]{0,63}$/;

function readSmall(file: string, cap = 2_000_000): string | null {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > cap) return null;
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** The keys of `mcpServers` in a JSON file, and nothing else from it. */
export function jsonServerNames(text: string | null): string[] {
  if (text === null) return [];
  try {
    const j = JSON.parse(text) as { mcpServers?: unknown };
    const s = j && typeof j === 'object' ? j.mcpServers : undefined;
    return s && typeof s === 'object' && !Array.isArray(s) ? Object.keys(s) : [];
  } catch {
    return [];
  }
}

/** `[mcp_servers.<name>]` headers in a Codex config.toml. Values are never parsed. */
export function tomlServerNames(text: string | null): string[] {
  if (text === null) return [];
  const out: string[] = [];
  const re = /^\s*\[\s*mcp_servers\s*\.\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Folders under `dir` that hold a SKILL.md. */
export function skillNames(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
    .map((e) => e.name);
}

function items(names: readonly string[], source: SetupSource): SetupItem[] {
  const seen = new Set<string>();
  const out: SetupItem[] = [];
  for (const n of names) {
    if (!NAME.test(n) || seen.has(n)) continue;
    seen.add(n);
    out.push({ name: n, source });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function readSetupInventory(home: string): SetupInventory {
  const claudeDir = path.join(home, '.claude');
  const codexDir = path.join(home, '.codex');
  const claudeServers = [
    ...jsonServerNames(readSmall(path.join(home, '.claude.json'), 20_000_000)),
    ...jsonServerNames(readSmall(path.join(claudeDir, 'settings.json'))),
  ];
  return {
    mcpServers: [
      ...items(claudeServers, 'claude'),
      ...items(tomlServerNames(readSmall(path.join(codexDir, 'config.toml'))), 'codex'),
    ],
    skills: [...items(skillNames(path.join(claudeDir, 'skills')), 'claude'), ...items(skillNames(path.join(codexDir, 'skills')), 'codex')],
  };
}
