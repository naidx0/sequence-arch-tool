import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CommandSurface } from '../shell/CommandSurface';
import { PALETTE_EVENT } from '../shell/paletteEvent';
import { sessionsClient } from '../sessions/sessionsClient';
import { createNewChat } from './sessionActions';
import { requestDiffBoard } from '../git/openDiff';
import { SHELL_COMMANDS, type ShellCommand, type ShellCommandId } from '../shell/shellModel';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';

/**
 * ONE PALETTE, NO MATTER HOW MANY MOUNTS (0.1.8, G10; owner: Ctrl+K "opens differently" from the bottom-left button).
 * Shell2 mounts this component in the product; V3Shell also mounts it but is not part of the product today. Were two
 * instances ever live, each would listen: one chord would open both (or toggle one open and the other shut) and the event
 * would open both. This is a guard against that, and harmless with one mount. The earliest-mounted instance leads: it alone listens for the chord and for PALETTE_EVENT and draws the palette; any
 * other renders nothing. When the leader unmounts the next one takes over.
 */
const mounted: object[] = [];
const watchers = new Set<() => void>();
const announce = () => watchers.forEach((w) => w());

function useLeads(): boolean {
  const token = useRef<object>({}).current;
  const [, tick] = useState(0);
  useLayoutEffect(() => {
    const rerender = () => tick((n) => n + 1);
    mounted.push(token);
    watchers.add(rerender);
    announce();
    return () => {
      mounted.splice(mounted.indexOf(token), 1);
      watchers.delete(rerender);
      announce();
    };
  }, [token]);
  return mounted[0] === token;
}

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
  const leads = useLeads();
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
    if (!leads) return undefined;
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
  }, [open, leads]);

  /* The sidebar's Commands row and the chat's more menu open it too (shell/paletteEvent.ts). */
  useEffect(() => {
    if (!leads) return undefined;
    const on = () => {
      openerRef.current = document.activeElement as HTMLElement | null;
      setOpen(true);
    };
    window.addEventListener(PALETTE_EVENT, on);
    return () => window.removeEventListener(PALETTE_EVENT, on);
  }, [leads]);

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

      if (command.id === 'canvas.diff') {
        requestDiffBoard();
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

  if (!leads || !open) return null;

  return (
    <CommandSurface
      commands={SHELL_COMMANDS}
      unavailableReason={unavailableReason}
      onRun={runCommand}
      onClose={() => setOpen(false)}
    />
  );
}
