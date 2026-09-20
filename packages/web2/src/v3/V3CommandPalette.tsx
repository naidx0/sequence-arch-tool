import { useCallback, useEffect, useState } from 'react';

import { CommandSurface } from '../shell/CommandSurface';
import { SHELL_COMMANDS, type ShellCommand, type ShellCommandId } from '../shell/shellModel';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';

/**
 * Cmd/Ctrl+K reachability for V3 — same command list as the retired Shell,
 * routed through the store overlay + chrome tabs the V3 shell owns.
 */
export function V3CommandPalette({
  onOpenSurface,
}: {
  /** Host-owned surface opens (whiteboard / architecture board). */
  onOpenSurface?: (id: ShellCommandId) => void;
}) {
  const store = useStore();
  const state = useAppState();
  const repoRoot = groundedRepoRoot(state);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (event.key === 'Escape' && open && !event.defaultPrevented) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const unavailableReason = useCallback(
    (command: ShellCommand): string | null => {
      if (command.id === 'repo.detach' && !repoRoot) return 'no repository attached';
      return null;
    },
    [repoRoot],
  );

  const runCommand = useCallback(
    (command: ShellCommand) => {
      setOpen(false);
      if (unavailableReason(command)) return;

      if (command.overlay) {
        store.dispatch({ type: 'shell/overlay', overlay: command.overlay });
        return;
      }

      if (command.id === 'composer.focus') {
        store.dispatch({ type: 'composer/focus' });
        return;
      }

      if (command.id === 'repo.detach') {
        store.dispatch({ type: 'repo/detached' });
        return;
      }

      onOpenSurface?.(command.id);
    },
    [onOpenSurface, store, unavailableReason],
  );

  if (!open) return null;

  return (
    <CommandSurface
      commands={SHELL_COMMANDS}
      unavailableReason={unavailableReason}
      onRun={runCommand}
      onClose={() => setOpen(false)}
    />
  );
}
