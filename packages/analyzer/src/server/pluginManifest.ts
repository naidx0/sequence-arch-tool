/**
 * C2.3 — Sequence plugin manifest v0 (read-only tools first).
 *
 * On-disk: `<repo>/.sequence/plugins.json` (optional). Missing file = no plugins
 * (not an error). Ask dispatches declared tools via `call_plugin` with closed
 * builtins (`ping`) and honest no-handler refusals for other names.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SEQUENCE_DIR } from './store.js';

export const PLUGIN_MANIFEST_FILE = 'plugins.json';

/** One read-only tool declared by a plugin (v0). */
export interface PluginToolV0 {
  name: string;
  description?: string;
  /** JSON Schema-ish input object; opaque to v0. */
  inputSchema?: unknown;
}

/** One plugin entry in the v0 manifest. */
export interface PluginManifestEntryV0 {
  id: string;
  /** Human label; optional. */
  title?: string;
  /**
   * v0 allows only `readonly` — mutating / shell plugins are refused at parse.
   */
  mode: 'readonly';
  tools: PluginToolV0[];
}

export interface PluginManifestV0 {
  version: 0;
  plugins: PluginManifestEntryV0[];
}

export type PluginManifestLoad =
  | { ok: true; manifest: PluginManifestV0; path: string | null }
  | { ok: false; error: string; path: string | null };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate a parsed JSON value as plugin manifest v0. */
export function parsePluginManifestV0(raw: unknown): PluginManifestLoad {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'plugins.json must be a JSON object', path: null };
  }
  if (raw.version !== 0) {
    return {
      ok: false,
      error: `plugins.json version must be 0 (got ${String(raw.version)})`,
      path: null,
    };
  }
  if (!Array.isArray(raw.plugins)) {
    return { ok: false, error: 'plugins.json needs a "plugins" array', path: null };
  }

  const plugins: PluginManifestEntryV0[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.plugins.length; i++) {
    const entry = raw.plugins[i];
    if (!isPlainObject(entry)) {
      return { ok: false, error: `plugins[${i}] must be an object`, path: null };
    }
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id) {
      return { ok: false, error: `plugins[${i}] missing non-empty "id"`, path: null };
    }
    if (seenIds.has(id)) {
      return { ok: false, error: `plugins.json repeats plugin id "${id}"`, path: null };
    }
    seenIds.add(id);
    if (entry.mode !== 'readonly') {
      return {
        ok: false,
        error: `plugin "${id}" mode must be "readonly" in v0 (got ${String(entry.mode)})`,
        path: null,
      };
    }
    if (!Array.isArray(entry.tools)) {
      return { ok: false, error: `plugin "${id}" needs a "tools" array`, path: null };
    }
    const tools: PluginToolV0[] = [];
    for (let t = 0; t < entry.tools.length; t++) {
      const tool = entry.tools[t];
      if (!isPlainObject(tool)) {
        return { ok: false, error: `plugin "${id}" tools[${t}] must be an object`, path: null };
      }
      const name = typeof tool.name === 'string' ? tool.name.trim() : '';
      if (!name) {
        return {
          ok: false,
          error: `plugin "${id}" tools[${t}] missing non-empty "name"`,
          path: null,
        };
      }
      const parsed: PluginToolV0 = { name };
      if (typeof tool.description === 'string') parsed.description = tool.description;
      if ('inputSchema' in tool) parsed.inputSchema = tool.inputSchema;
      tools.push(parsed);
    }
    const out: PluginManifestEntryV0 = { id, mode: 'readonly', tools };
    if (typeof entry.title === 'string' && entry.title.trim()) out.title = entry.title.trim();
    plugins.push(out);
  }

  return { ok: true, manifest: { version: 0, plugins }, path: null };
}

/**
 * Load `.sequence/plugins.json` when present. Missing file → empty ok manifest.
 * Invalid JSON / shape → ok: false with an honest error (never invent plugins).
 */
export function loadPluginManifestV0(repoRoot: string): PluginManifestLoad {
  const filePath = path.join(repoRoot, SEQUENCE_DIR, PLUGIN_MANIFEST_FILE);
  if (!fs.existsSync(filePath)) {
    return { ok: true, manifest: { version: 0, plugins: [] }, path: null };
  }
  let rawText: string;
  try {
    rawText = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      error: `could not read ${PLUGIN_MANIFEST_FILE}: ${(err as Error).message}`,
      path: filePath,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch (err) {
    return {
      ok: false,
      error: `${PLUGIN_MANIFEST_FILE} is not valid JSON: ${(err as Error).message}`,
      path: filePath,
    };
  }
  const result = parsePluginManifestV0(parsed);
  if (!result.ok) return { ...result, path: filePath };
  return { ok: true, manifest: result.manifest, path: filePath };
}
