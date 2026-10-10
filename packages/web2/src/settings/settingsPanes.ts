/* ══════════════════════════════════════════════════════════════════════════
   GETTING TO THE SETTING YOU CAME FOR
   packages/web2/src/settings/settingsPanes.ts

   Round 7 (A9), Jaden: "make it as simple as possible to understand and
   connect and configure." Round 9 (ask 18): "fuller screen, easier to move
   through". Three tabs held everything that was not a model or an agent in one
   long App page; the left nav is now five short stops, each a handful of rows:

     Agents     the coding agents on this machine: Connect, Disconnect.
     Models     Sequence's own models: the local one-click setup, the saved
                models, the provider and its key.
     Skills     round 13: the skills this project carries and the instruction
                file (AGENTS.md) in use; it moved here from the sidebar.
     General    appearance, notifications, the window.
     Safety     autonomy, tool permissions, this repository's hooks.
     Workspace  agent map, worktrees, MCP servers, the open folder.

   Callers still ask by the old names (`pane: 'provider'` from the failure
   strip and the model menu, 'notifications', 'workspace', 'hooks'): each old
   name is a SECTION, and resolvePane sends it to the tab that holds it.
   ══════════════════════════════════════════════════════════════════════════ */

/** The sections the panel draws (the old pane names, still what callers ask for). */
export type SettingsSectionId =
  | 'provider'
  | 'agents'
  | 'notifications'
  | 'hooks'
  | 'workspace'
  | 'app'
  | 'autonomy'
  | 'permissions'
  | 'skills'
  | 'mcp';

/** The tabs. */
export type SettingsTab = 'agents' | 'models' | 'skills' | 'app' | 'safety' | 'workspace';

/** What a caller may ask for: a tab, or a section by its old pane name. */
export type SettingsPane = SettingsTab | SettingsSectionId;

export interface PaneTab {
  id: SettingsTab;
  label: string;
  /** What a reader is looking for when they want this one. */
  title: string;
}

/** The tabs, in the order a reader meets them: connect first. */
export const SETTINGS_PANES: readonly PaneTab[] = [
  { id: 'agents', label: 'Agents', title: 'Connect and configure the coding agents on this machine' },
  { id: 'models', label: 'Models', title: "Sequence's own models: a local one, or a provider and its key" },
  { id: 'skills', label: 'Skills', title: 'Skills this project carries and the instruction file the agent reads' },
  { id: 'app', label: 'General', title: 'Appearance, notifications and the window' },
  { id: 'safety', label: 'Safety', title: 'What the agent may do on its own: autonomy, tool permissions and hooks' },
  { id: 'workspace', label: 'Workspace', title: 'Agent map, worktrees, MCP servers and the open folder' },
];

const SECTION_TAB: Record<SettingsSectionId, SettingsTab> = {
  agents: 'agents',
  provider: 'models',
  notifications: 'app',
  app: 'app',
  autonomy: 'safety',
  permissions: 'safety',
  hooks: 'safety',
  workspace: 'workspace',
  skills: 'skills',
  mcp: 'workspace',
};

/** The tab that holds a section. */
export function tabOf(section: SettingsSectionId): SettingsTab {
  return SECTION_TAB[section];
}

const TAB_IDS: readonly string[] = SETTINGS_PANES.map((p) => p.id);

/**
 * Which tab to show for what a caller asked. Unknown asks land on Agents,
 * the connect flow, which is where a new reader needs to be.
 */
export function resolvePane(requested: unknown): SettingsTab {
  if (typeof requested === 'string' && TAB_IDS.includes(requested)) return requested as SettingsTab;
  if (typeof requested === 'string' && Object.prototype.hasOwnProperty.call(SECTION_TAB, requested)) {
    return SECTION_TAB[requested as SettingsSectionId];
  }
  return 'agents';
}

/** Whether a tab is the one showing — for `aria-selected` and the mark. */
export function isCurrent(pane: SettingsTab, current: SettingsTab): boolean {
  return pane === current;
}
