/* ══════════════════════════════════════════════════════════════════════════
   THE STORE'S PUBLIC FACE — item 2.2
   packages/web2/src/state/index.ts

   One import for `app/App.tsx`, the same way `shell/index.ts` and
   `chat/index.ts` are one import each.

   `types.ts` IS NOT RE-EXPORTED THROUGH HERE, ON PURPOSE. It is the frozen
   state contract and every lane already imports it directly as
   `../state/types`. A second path to the same declarations is how a rename
   ends up half-applied, and the contract is the one file in this package that
   must have exactly one name.
   ══════════════════════════════════════════════════════════════════════════ */

export { createStore, reduce } from './store';
export type { Action, Projection, Projector, ScannedGraph, Store, StoreConfig } from './store';

export {
  ConnectedBootHydrate,
  ConnectedBootSurface,
  ConnectedChatColumn,
  ConnectedShell,
  StoreProvider,
  bootSurfacePropsFrom,
  chatColumnPropsFrom,
  composerPropsFrom,
  shellPropsFrom,
  useAppState,
  useStore,
} from './connect';
export type { ShellSlots } from './connect';

export {
  EMPTY_ATTACH_DIALOG,
  EMPTY_CANVAS,
  EMPTY_COMPOSER,
  EMPTY_MODEL,
  EMPTY_NET,
  EMPTY_PERMISSION,
  EMPTY_RAIL,
  EMPTY_REPO,
  EMPTY_SESSION,
  createInitialState,
  emptyShell,
} from './initial';
export type { InitialStateInput } from './initial';
