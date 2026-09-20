/**
 * Shell public surface — Decision 22.
 * Product chrome is `src/v3/V3Shell`. `Shell` is a retired no-op; `ShellProps`
 * remains for `shellPropsFrom` / ConnectedShell type compatibility.
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
