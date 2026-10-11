/* ══════════════════════════════════════════════════════════════════════════
   SUBAGENTS UNDER A CHAT IN THE RAIL (R10, C4)
   packages/web2/src/shell2/SubagentRows.tsx

   A chat that ran subagents gets a small disclosure chevron. Opened, each
   subagent is an indented sub-row: a state dot and its name. Clicking one
   opens the chat on that subthread (scrolls to it and expands it). Used by
   both rails (SessionPanel, v3/V3SessionsRail).
   ══════════════════════════════════════════════════════════════════════════ */

import { useMemo, useState } from 'react';

import type { AgentRunsState } from '../agents/agentRuns';
import { subagentsOf, type SubagentRef } from '../agents/subagents';
import { subagentLabel } from '../chat/subagentLabel';
import { AsciiSpinner } from './AsciiSpinner';
import { S2Icon } from './icons';

import './railSubagents.css';

/** The chat's subagents, from the runs the page holds. */
export function useChatSubagents(runs: AgentRunsState, sessionId: string): SubagentRef[] {
  return useMemo(() => subagentsOf(runs.runs, sessionId), [runs.runs, sessionId]);
}

/** Per-chat disclosure state for the rail (not remembered across reloads). */
export function useSubagentFolds(): [Record<string, boolean>, (id: string) => void] {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return [open, (id) => setOpen((p) => ({ ...p, [id]: !p[id] }))];
}

export function SubagentTwist({ count, open, onToggle, title }: { count: number; open: boolean; onToggle: () => void; title: string }) {
  return (
    <button
      type="button"
      className="rsub-twist"
      data-testid="rail-subagents-toggle"
      aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${count} subagent${count === 1 ? '' : 's'} of ${title}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <S2Icon name={open ? 'chev' : 'chevr'} small />
    </button>
  );
}

export function SubagentSubRows({ refs, onPick, depth = 1 }: { refs: readonly SubagentRef[]; onPick: (ref: SubagentRef) => void; depth?: number }) {
  return (
    <div className="rsub-list" data-testid="rail-subagents" style={{ paddingLeft: 26 + depth * 14 }}>
      {refs.map((r) => {
        const label = subagentLabel(r.name, r.description);
        return (
          <button key={`${r.runId}:${r.toolId}`} type="button" className="rsub-row" data-testid="rail-subagent" data-state={r.status} title={label.detail ? `${label.title}: ${label.detail}` : label.title} onClick={() => onPick(r)}>
            <span className="rsub-dot" data-state={r.status} aria-hidden="true">
              {r.status === 'running' ? <AsciiSpinner /> : null}
            </span>
            <span className={`rsub-name${r.status === 'running' ? ' shimmer-text' : ''}`}>{label.title}</span>
            {label.detail ? <span className="rsub-desc">{label.detail}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

