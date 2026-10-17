/* ══════════════════════════════════════════════════════════════════════════
   A FILE ON A PROPOSAL CARD: THE NAME OPENS IT, A COMPACT DIFF OPENS UNDER IT
   packages/web2/src/chat/ProposalFileRow.tsx

   The Opus walk of 2026-10-15: on the edit card "clicking the file name does
   nothing, there is no diff, the copy reads 'Decision recorded, applied'".
   The name is a button that opens the file in Files (`files/open`, the same
   action every other file mention in the chat dispatches). An applied edit
   offers its diff in place: the working-tree diff Files draws, in the same
   DiffView, capped small. A proposal still waiting has no diff against disk
   yet (the proposal carries whole-file content), so it offers none and says
   to open the file.
   ══════════════════════════════════════════════════════════════════════════ */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';

import { createReviewClient } from '../review/reviewClient';
import { useStoreIfAny } from '../state/connect';
import type { FileEditProposal, ProposedFile } from '../state/types';

const DiffView = lazy(() => import('../files/DiffView').then((m) => ({ default: m.DiffView })));

/** Lines of diff a card shows before "Open in Files" is the way to read the rest. */
export const CARD_DIFF_LINES = 24;

type DiffLoad = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; text: string } | { state: 'failed' };

const baseName = (path: string): string => path.split(/[\/]/).filter(Boolean).pop() ?? path;

/** What a decided proposal says it did, in words about the files (never "Decision recorded"). */
export function proposalOutcome(proposal: Pick<FileEditProposal, 'status' | 'files'>): string {
  const files = proposal.files;
  const one = files.length === 1;
  const name = files[0] ? baseName(files[0].path) : 'the file';
  const accepted = files.filter((f) => f.decision === 'accepted').length;
  switch (proposal.status) {
    case 'applied':
      return one ? `Edited ${name}` : `Edited ${files.length} files`;
    case 'denied':
      return one ? `Rejected the edit to ${name}` : `Rejected ${files.length} edits`;
    case 'partial':
      return `Edited ${accepted} of ${files.length} files`;
    case 'applying':
      return one ? `Applying the edit to ${name}` : `Applying ${files.length} edits`;
    default:
      return one ? `Waiting on the edit to ${name}` : `Waiting on ${files.length} edits`;
  }
}

export function ProposalFileRow({ file, applied }: { file: ProposedFile; applied: boolean }) {
  const store = useStoreIfAny();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<DiffLoad>({ state: 'idle' });
  const client = useMemo(() => createReviewClient((u, i) => fetch(u, i)), []);
  const hasDiff = applied || file.diff !== null;

  useEffect(() => {
    if (!open || !hasDiff) return undefined;
    if (file.diff !== null) {
      setLoad({ state: 'ready', text: file.diff });
      return undefined;
    }
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    void (async () => {
      const answer = await client.diff(file.path, controller.signal);
      if (controller.signal.aborted) return;
      setLoad(answer.outcome === 'ok' && typeof answer.body.diff === 'string' ? { state: 'ready', text: answer.body.diff } : { state: 'failed' });
    })();
    return () => controller.abort();
  }, [open, hasDiff, file.diff, file.path, client]);

  return (
    <div className="v3-approve-filerow" data-testid="v3-approve-file">
      <div className="v3-approve-file">
        <button
          type="button"
          className="v3-approve-open"
          data-testid="v3-approve-open"
          title={`Open ${file.path} in Files`}
          disabled={!store}
          onClick={() => store?.dispatch({ type: 'files/open', path: file.path })}
        >
          {file.path}
        </button>
        {hasDiff ? (
          <button
            type="button"
            className="s2-chipbtn"
            data-testid="v3-approve-diff-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide diff' : 'Diff'}
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="v3-approve-diff" data-testid="v3-approve-diff">
          {load.state === 'loading' || load.state === 'idle' ? (
            <p className="v3-approve-note">Reading the diff…</p>
          ) : load.state === 'failed' ? (
            <p className="v3-approve-note">The diff could not be read. Open the file in Files.</p>
          ) : (
            <Suspense fallback={<p className="v3-approve-note">Reading the diff…</p>}>
              <DiffView text={load.text} path={file.path} lineCap={CARD_DIFF_LINES} />
            </Suspense>
          )}
        </div>
      ) : null}
    </div>
  );
}
