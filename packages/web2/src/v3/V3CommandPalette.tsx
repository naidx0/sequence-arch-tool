import { useCallback, useEffect, useRef, useState } from 'react';

import { CommandSurface } from '../shell/CommandSurface';
import { PALETTE_EVENT } from '../shell/paletteEvent';
import { sessionsClient } from '../sessions/sessionsClient';
import { createNewChat } from './sessionActions';
import { SHELL_COMMANDS, type ShellCommand, type ShellCommandId } from '../shell/shellModel';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';

/**
 * Cmd/Ctrl+K reachability for V3 — same command list as the retired Shell,
 * routed through the store overlay + chrome tabs the V3 shell owns.
 */
export function V3CommandPalette({
  onOpenSurface,
  onRevealChat,
}: {
  /** Host-owned surface opens (whiteboard / architecture board). */
  onOpenSurface?: (id: ShellCommandId) => void;
  onRevealChat?: () => void;
}) {
  const store = useStore();
  const state = useAppState();
  const repoRoot = groundedRepoRoot(state);
  const [open, setOpen] = useState(false);
  /* Closing gives focus back to the control that had it when the palette opened
     (unless the command just run moved it somewhere, e.g. into an overlay). */
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;
    const opener = openerRef.current;
    openerRef.current = null;
    const lost = !document.activeElement || document.activeElement === document.body;
    if (opener && opener.isConnected && lost) opener.focus();
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        /* Recorded before the palette mounts and takes focus itself. */
        if (!open) openerRef.current = document.activeElement as HTMLElement | null;
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

  /* The sidebar's Commands row and the chat's more menu open it too (shell/paletteEvent.ts). */
  useEffect(() => {
    const on = () => {
      openerRef.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    window.addEventListener(PALETTE_EVENT, on);
    return () => window.removeEventListener(PALETTE_EVENT, on);
  }, []);

  const unavailableReason = useCallback(
    (command: ShellCommand): string | null => {
      if (command.id === 'repo.detach' && !repoRoot) return 'no project attached';
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
        onRevealChat?.();
        store.dispatch({ type: 'composer/focus' });
        return;
      }

      if (command.id === 'chat.new') {
        void createNewChat(store, sessionsClient, repoRoot ? 'code' : 'work');
        return;
      }

      if (command.id === 'repo.detach') {
        store.dispatch({ type: 'repo/detached' });
        return;
      }

      onOpenSurface?.(command.id);
    },
    [onOpenSurface, onRevealChat, repoRoot, store, unavailableReason],
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
