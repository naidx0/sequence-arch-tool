/**
 * The shell's public surface.
 *
 * One import for app/App.tsx — `import { Shell } from '../shell'` — so that
 * swapping <BootSmoke/> for <Shell/> is the one-line change the plan describes
 * and not a spray of deep paths. Everything not listed here is internal and
 * may be rearranged without touching a caller.
 *
 * The model is exported alongside the component ON PURPOSE, and state/store.ts
 * is now the thing that calls it: shellModel.ts is React-free and produces the
 * frozen ShellSlice from state/types.ts, so every pane action in the store is
 * one of these reducers. `Shell.tsx` calls none of them any more — it takes the
 * slice as a prop and renders it — which is what makes the store the single
 * source of the shell's state rather than a second copy of it.
 *
 * `layoutOf` is exported for the same reason: the store needs the arrangement
 * to hand to a reducer, and it must not assemble `computeLayout`'s arguments
 * itself.
 */

export { Shell, type ShellProps } from './Shell';
export {
  DEFAULT_SHELL_TOKENS,
  MEDIUM_MIN,
  SHELL_COMMANDS,
  WIDE_MIN,
  breakpointFor,
  boardFloor,
  columnAllowance,
  computeLayout,
  createShellState,
  filterCommands,
  layoutOf,
  paneModeFor,
  resetPaneWidths,
  toPersisted,
  withDragging,
  withFrame,
  withOverlay,
  withPaneToggled,
  withPaneOpen,
  withPaneWidth,
  withTheme,
  type PaneIntent,
  type PaneLimits,
  type PaneName,
  type ShellCommand,
  type ShellCommandId,
  type ShellLayout,
  type ShellPersisted,
  type ShellState,
  type ShellTokens,
} from './shellModel';
export { SHELL_STORAGE_KEY, readShellPersisted, writeShellPersisted } from './shellStorage';
export { readShellTokens } from './shellTokens';
