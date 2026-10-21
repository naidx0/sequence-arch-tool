/* ══════════════════════════════════════════════════════════════════════════
   THE COMPACTION LINE
   packages/web2/src/chat/CompactNotice.tsx

   A compaction is not a message. The chat draws it as one calm line where it
   happened, live and after a reload alike:

     running   "Compacting the conversation"
     done      "Conversation compacted: 12 earlier turns summarized", and a
               "Show summary" button when the agent left its summary in the turn
     failed    the honest error ("Compaction failed: ... The conversation is
               unchanged.")
     stopped   "Compaction stopped. The conversation is unchanged."

   Presentational: it reads a run (operation 'compact') and nothing else. The
   quiet note style and the theme's small button are reused; nothing here
   moves or takes an accent.
   ══════════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';

import type { AgentRun } from '../agents/agentRuns';

export type CompactNoticeRun = Pick<AgentRun, 'id' | 'status' | 'error' | 'items' | 'summarizedTurns'> & { stopped?: boolean };

/** The line's words for a compaction in its state. */
export function compactNoticeText(run: CompactNoticeRun): string {
  if (run.status === 'running') return 'Compacting the conversation';
  if (run.status === 'failed') {
    if (run.stopped) return 'Compaction stopped. The conversation is unchanged.';
    return run.error?.trim() || 'Compaction failed. The conversation is unchanged.';
  }
  const n = run.summarizedTurns;
  if (typeof n === 'number' && n > 0) return `Conversation compacted: ${n} earlier ${n === 1 ? 'turn' : 'turns'} summarized`;
  return 'Conversation compacted: earlier turns summarized';
}

/** What the agent said while compacting (its summary), or ''. */
export function compactSummary(run: Pick<AgentRun, 'items'>): string {
  return run.items
    .filter((i): i is Extract<AgentRun['items'][number], { kind: 'message' }> => i.kind === 'message')
    .map((i) => i.text)
    .join('')
    .trim();
}

export function CompactNotice({ run }: { run: CompactNoticeRun }) {
  const [open, setOpen] = useState(false);
  const summary = run.status === 'done' ? compactSummary(run) : '';
  return (
    <div data-testid="compact-notice" data-status={run.status}>
      <p className="agrun-note" data-testid="compact-notice-text">
        {compactNoticeText(run)}
      </p>
      {summary ? (
        <>
          <button type="button" className="s2-btn s2-btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="compact-notice-toggle">
            {open ? 'Hide summary' : 'Show summary'}
          </button>
          {open ? (
            <p className="agrun-note" data-testid="compact-notice-summary" style={{ whiteSpace: 'pre-wrap' }}>
              {summary}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
