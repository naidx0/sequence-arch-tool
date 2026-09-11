import type { AskSurfaceContext } from '@sequence/api-types';

/**
 * Map the P2.5 workspace chrome (+ overlays) to the ask wire surface.
 *
 * Chat-alone with no overlay sends nothing — deictic "this" is not a board
 * question. Architecture / Whiteboard name the board. Activity and Settings
 * overlays win when open (owner bug: "this workflow" answered against the
 * repo because Agents/Activity was never on the wire).
 *
 * Wire id for Whiteboard stays `task-board` (server copy already says
 * Whiteboard). Activity uses wire id `agents` (server copy: Agents surface).
 */
export type WorkspaceSurfaceId = 'chat' | 'architecture' | 'whiteboard' | 'ai-canvas';

export type ChromeOverlayKind = 'activity' | 'settings' | 'review' | 'help' | string;

export function askSurfaceFromWorkspace(
  surface: WorkspaceSurfaceId,
): AskSurfaceContext | null {
  if (surface === 'chat') return null;
  if (surface === 'architecture') {
    return { id: 'architecture', title: 'Architecture' };
  }
  if (surface === 'ai-canvas') {
    return { id: 'ai-canvas', title: 'AI Canvas' };
  }
  return { id: 'task-board', title: 'Whiteboard' };
}

export function askSurfaceFromChrome(args: {
  workspace: WorkspaceSurfaceId;
  overlayKind: ChromeOverlayKind | null | undefined;
}): AskSurfaceContext | null {
  if (args.overlayKind === 'activity') {
    return { id: 'agents', title: 'Activity' };
  }
  if (args.overlayKind === 'settings') {
    return { id: 'settings', title: 'Settings' };
  }
  return askSurfaceFromWorkspace(args.workspace);
}
