/**
 * Retired Shell component — Decision 22.
 * Types kept for `shellPropsFrom` / ConnectedShell. Product UI is `v3/V3Shell`.
 */
import type { ReactNode } from 'react';

import type { ShellOverlay, ShellSlice } from '../state/types';
import type { PaneName, ShellCommandId } from './shellModel';

export interface ShellProps {
  chat: ReactNode;
  canvas?: ReactNode;
  sessions?: ReactNode;
  rail: ReactNode;
  railHeader?: ReactNode;
  boardMounted?: boolean;
  boardDocked?: boolean;
  onMinimizeBoard?: () => void;
  onRestoreBoard?: () => void;
  appbar?: ReactNode;
  workspaceChrome?: ReactNode;
  tabLayout?: boolean;
  tabWorkspace?: ReactNode;
  repoName?: string | null;
  onInterrupt?: () => void;
  chatTitle?: string;
  sessionsTitle?: string;
  railTitle?: string;
  shell: ShellSlice;
  onFrame: (frame: { width: number; height: number }) => void;
  onTogglePane: (pane: PaneName) => void;
  onResizePane: (pane: PaneName, width: number) => void;
  onDragPane: (pane: PaneName | null) => void;
  onResetPanes: () => void;
  onOverlay: (overlay: ShellOverlay | null) => void;
  onCommand?: (id: ShellCommandId) => void;
  renderOverlay?: (overlay: ShellOverlay, close: () => void) => ReactNode;
}

export function Shell(_props: ShellProps): null {
  return null;
}
