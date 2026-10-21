/* ══════════════════════════════════════════════════════════════════════════
   THE AGENTS DOCK (round 7, A7)
   packages/web2/src/agents/AgentsDock.tsx

   Jaden: "Agent window sucks. It transpons all the other screens. As a
   pop-up, it's not really clear what the boundaries are... the buttons don't
   match... the theme isn't there." The Agents panel is now a card docked in
   the stage, beside the board, in mockup B's language: a rounded card on
   the room with its own edge and lift, B's segmented Tree | Timeline, its
   rows and buttons, and a close (x) that Escape also presses. It never
   covers the page: no scrim, no overlay, no focus trap; the board and the
   chat stay usable beside it.

   Mount (the shell's): <AgentsDock open={agentsOpen} onClose={...} width={360} />
   in the stage row, after the surface it docks beside. Self-contained: it
   reads the page's one agent stream.
   ══════════════════════════════════════════════════════════════════════════ */

import type { KeyboardEvent } from 'react';

import { AgentsPanel } from './AgentsPanel';
import type { AgentStore } from './agentStream.js';
import './agents.css';

export const AGENTS_DOCK_WIDTH = 360;
export const AGENTS_DOCK_MIN = 300;

export interface AgentsDockProps {
  open: boolean;
  onClose: () => void;
  /** Card width in px (default 360, never under 300). */
  width?: number;
  /** Fill the host instead (the narrow Agents view, or the dock standing in for the stage). */
  fill?: boolean;
  /** Test seam; defaults to the page's agent stream. */
  store?: AgentStore;
}

export function AgentsDock({ open, onClose, width = AGENTS_DOCK_WIDTH, fill = false, store }: AgentsDockProps) {
  if (!open) return null;
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
  };
  return (
    <aside className="ag-dock" aria-label="Agents" data-testid="agents-dock" style={fill ? { width: '100%' } : { width: Math.max(AGENTS_DOCK_MIN, width) }} onKeyDown={onKeyDown}>
      <AgentsPanel {...(store ? { store } : {})} onClose={onClose} />
    </aside>
  );
}

export default AgentsDock;
