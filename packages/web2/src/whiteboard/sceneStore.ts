/* Scenes kept on this machine, per board, until the board store takes the `scene` kind (boardsModel SCENE_ON_SERVER).
   The store refuses kinds it does not know, so a scene is never sent as an op; it is saved here and read back with the
   board. A scene the SERVER holds (once it can) wins over a local one of the same id. */

import { readWhiteboard, type WbItem, type WbScene } from './whiteboardModel';

const key = (boardId: string) => `sequence.scenes.${boardId}`;

export function readScenes(boardId: string): WbScene[] {
  try {
    const raw = window.localStorage.getItem(key(boardId));
    return readWhiteboard(raw).items.filter((i): i is WbScene => i.kind === 'scene');
  } catch {
    return [];
  }
}

export function writeScenes(boardId: string, scenes: readonly WbItem[]): void {
  try {
    const mine = scenes.filter((i) => i.kind === 'scene');
    if (mine.length === 0) window.localStorage.removeItem(key(boardId));
    else window.localStorage.setItem(key(boardId), JSON.stringify({ version: 1, items: mine }));
  } catch {
    /* kept for this tab only */
  }
}
