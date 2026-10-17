/* ══════════════════════════════════════════════════════════════════════════
   "REVERTED" UNDER A TURN
   packages/web2/src/chat/RevertedNote.tsx

   Rewind put back the files a turn wrote (rewind/revertedMarks.ts keeps which turns). The turn stays in the
   transcript, so it says so. Small and on its own so the boot chat (v3/V3Chat.tsx) draws it without loading the
   agent thread's chunk.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentRun } from '../agents/agentRuns';
import { isRevertedAt, useRevertedMarks } from '../rewind/revertedMarks';

/** Did the run change files (an edit, delete or move call, or a call that carries a diff)? */
export function runWroteFiles(run: Pick<AgentRun, 'items'>): boolean {
  return run.items.some((i) => i.kind === 'tool' && ((i.toolKind != null && ['edit', 'delete', 'move'].includes(i.toolKind)) || (i.diffs?.length ?? 0) > 0 || (i.changes?.length ?? 0) > 0));
}

export function RevertedNote({
  chatId,
  at,
  wrote = true,
}: {
  chatId: string | null | undefined;
  /** When the turn ended. */
  at: number;
  /** The turn changed files: a turn that only read has nothing to have been reverted. */
  wrote?: boolean;
}) {
  useRevertedMarks();
  if (!wrote || !isRevertedAt(chatId, at)) return null;
  return (
    <p className="s2-run-note" data-testid="turn-reverted">
      Reverted. The files this turn changed were put back.
    </p>
  );
}
