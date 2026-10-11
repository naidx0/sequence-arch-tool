/* ══════════════════════════════════════════════════════════════════════════
   THE CHAT COLUMN'S PUBLIC FACE — items 2.5, 2.7, 2.8
   packages/web2/src/chat/index.ts

   Everything the shell (item 2.3) and the store lane need, and nothing else.
   Internals — WorkRowLine, Icon, the fixtures — are deliberately not re-exported:
   a surface that reaches past this file is a surface this lane cannot change.

   THE PURE HALVES ARE EXPORTED ON PURPOSE. `deriveSendState` is here because
   the STORE must derive `composer.send`, not the component: a button state
   computed in the renderer is a second source of truth about whether a turn can
   be sent, and the first thing that disagrees with it is the Enter key.
   ══════════════════════════════════════════════════════════════════════════ */

export { ChatColumn } from './ChatColumn';
export type { ChatColumnProps } from './ChatColumn';

export { Transcript } from './Transcript';
export type { TranscriptProps } from './Transcript';

export { Composer } from './Composer';
export type { ComposerFailure, ComposerProps } from './Composer';

export { TrustStrip } from './TrustStrip';
export type { TrustStripProps } from './TrustStrip';

export { PERMISSION_MODES, PermissionControl } from './PermissionControl';
export type { PermissionControlProps, PermissionModeSpec } from './PermissionControl';

export {
  TOOLBELT,
  autosizeHeight,
  deriveSendState,
  keyIntent,
  placeholderFor,
  toolbeltAskText,
} from './composerModel';
export type { KeyIntent, ToolbeltId, ToolbeltItem } from './composerModel';

export { foldTranscript, isRestoredTurnId } from './transcriptModel';
export type { EndingReason, TranscriptItem } from './transcriptModel';

export { TAIL_THRESHOLD_PX, shouldFollow } from './scrollFollow';

export { formatElapsed, glyphFor } from './workRowModel';
