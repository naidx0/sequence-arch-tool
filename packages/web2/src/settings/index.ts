/* The settings lane's public face — one import for `app/App.tsx`, the same way
   `review/index.ts` and `chat/index.ts` are one import each. */
export { SettingsPanel } from './SettingsPanel';
export type { SettingsPanelProps } from './SettingsPanel';
export { AI_CONFIG_ROUTE, createSettingsClient } from './settingsClient';
export type { AiConfigDraft, SettingsClient, WireResult } from './settingsClient';
