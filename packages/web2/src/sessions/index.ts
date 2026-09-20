/**
 * Sessions public surface — Decision 22.
 * Product rail is `src/v3/V3SessionsRail`. Panel UI retired.
 */
export type SessionsPanelProps = Record<string, never>;
export function SessionsPanel(_props: SessionsPanelProps): null {
  return null;
}

export { createSessionsClient, type SessionsClient } from './sessionsClient';
export { fromChatMemory } from './chatMemory';
export { openRepoSession } from './openRepoSession';
export {
  flushSessionMemory,
  clearSessionFlush,
  flushAndReload,
} from './sessionPersist';
