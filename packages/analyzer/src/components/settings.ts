/**
 * Components settings, in the server store beside agent-settings.json (a separate file,
 * same pattern as askAgentMap.ts readAgentSettings): never the browser's localStorage.
 */
import { readUserJson, writeUserJson } from '../server/store.js';

export const COMPONENT_SETTINGS_FILE = 'components-settings.json';
/** auto: load matches; approve: offer them (default); manual: no offers, no tool, only explicit loads. */
export type ComponentMode = 'auto' | 'approve' | 'manual';
export const COMPONENT_MODES: readonly ComponentMode[] = ['auto', 'approve', 'manual'];

export interface ComponentSettings {
  /** The whole feature: false is `/components off` (no offers, no tool, explicit loads refused). */
  enabled: boolean;
  mode: ComponentMode;
}

export function readComponentSettings(storeDir: string): ComponentSettings {
  let raw: unknown;
  try {
    raw = readUserJson(storeDir, COMPONENT_SETTINGS_FILE);
  } catch {
    raw = undefined;
  }
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mode = COMPONENT_MODES.find((m) => m === o.mode) ?? 'approve';
  return { enabled: o.enabled !== false, mode };
}

export function writeComponentSettings(storeDir: string, patch: Partial<ComponentSettings>): ComponentSettings {
  const next = { ...readComponentSettings(storeDir), ...patch };
  writeUserJson(storeDir, COMPONENT_SETTINGS_FILE, next);
  return next;
}

/** Does a session get the `components` MCP tool? */
export const componentsToolOn = (s: ComponentSettings): boolean => s.enabled && s.mode !== 'manual';

/** The `sequenceMcpServer` options every launch site passes, so none can forget one: the tool's presence, the mode snapshot, and where to ask. */
export function componentsLaunchOpts(s: ComponentSettings, ask: { url?: string; key?: string } = {}): { components: boolean; componentsMode: ComponentMode; componentsUrl?: string; componentsKey?: string } {
  return { components: componentsToolOn(s), componentsMode: s.mode, ...(ask.url ? { componentsUrl: ask.url, ...(ask.key ? { componentsKey: ask.key } : {}) } : {}) };
}
