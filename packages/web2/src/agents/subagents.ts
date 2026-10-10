/* ══════════════════════════════════════════════════════════════════════════
   SUBAGENTS A CHAT RAN (R10, C4)
   packages/web2/src/agents/subagents.ts

   A Task call (Claude's subagent tool) is a subthread: in the chat it is a
   nested card holding the subagent's own steps; in the session rail it is a
   sub-row under the chat. This is the one reading of the runs both use, and
   the "show me that one" event the rail sends the chat.
   ══════════════════════════════════════════════════════════════════════════ */

import { keepOpen } from '../chat/keptOpen';
import { revealInTranscript } from '../chat/transcriptNav';
import type { AgentRun, RunTool } from './agentRuns';

export interface SubagentRef {
  runId: string;
  toolId: string;
  /** The subagent's type ("Explore", "general-purpose"). */
  name: string;
  /** What it was asked to do, in a few words. */
  description: string;
  status: RunTool['status'];
  startedAt: number;
  endedAt: number | null;
}

/** "Explore: find the auth code" -> its type and its description. */
export function splitSubagent(label: string | null | undefined): { name: string; description: string } {
  const text = label ?? '';
  const at = text.indexOf(': ');
  return at === -1 ? { name: text || 'Subagent', description: '' } : { name: text.slice(0, at), description: text.slice(at + 2) };
}

/** The subagents of a chat's runs, oldest first. */
export function subagentsOf(runs: readonly AgentRun[], sessionId: string): SubagentRef[] {
  const out: SubagentRef[] = [];
  for (const r of runs) {
    if (r.sessionId !== sessionId) continue;
    for (const i of r.items) {
      if (i.kind !== 'tool' || !i.subagent) continue;
      out.push({ runId: r.id, toolId: i.id, ...splitSubagent(i.subagent), status: i.status, startedAt: i.startedAt, endedAt: i.endedAt });
    }
  }
  return out;
}

export const SUBAGENT_REVEAL_EVENT = 'sequence:reveal-subagent';

export function subagentAnchor(runId: string, toolId: string): string {
  return `agsub-${runId}-${toolId}`;
}

/** Open the subagent's card in the chat and scroll to it (also when the transcript has it scrolled out of the list). */
export function revealSubagent(ref: Pick<SubagentRef, 'runId' | 'toolId'>): void {
  keepOpen(`sub:${ref.runId}:${ref.toolId}`, true);
  revealInTranscript({ runId: ref.runId, requestId: ref.toolId });
  /* The card may mount a frame later (virtualized list): ask it to open itself and scroll. */
  setTimeout(() => {
    try {
      window.dispatchEvent(new CustomEvent(SUBAGENT_REVEAL_EVENT, { detail: ref }));
    } catch {
      /* no DOM */
    }
  }, 60);
}
