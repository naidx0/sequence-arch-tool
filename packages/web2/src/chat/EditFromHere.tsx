/* ══════════════════════════════════════════════════════════════════════════
   "EDIT FROM HERE" ON A MESSAGE
   packages/web2/src/chat/EditFromHere.tsx

   Under a finished message: a quiet pen icon. It opens one row that says what will
   happen (this message and everything after it leave the chat; the agent
   forgets them too) and offers the files, only when snapshots say some were
   written since. Nothing is done until Edit is pressed. The message text then
   goes back to the composer; an unsent draft there is asked about first, and
   the edit can be undone (EditUndoBar) until the next message is sent.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState, useSyncExternalStore } from 'react';

import { agentRuns, type AgentRun } from '../agents/agentRuns';
import { cutTurnId, editFromHere, filesOffer, undoEdit, type FilesOffer } from '../agents/editFromHere';
import { editUndo } from '../agents/editUndo';
import { useStoreIfAny } from '../state/connect';
import { S2Icon } from '../shell2/icons';
import './editFromHere.css';

export function EditFromHere({ run }: { run: AgentRun }) {
  const app = useStoreIfAny();
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState<FilesOffer | null>(null);
  const [files, setFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    void filesOffer(run, cutTurnId(agentRuns.get().runs, run)).then((o) => live && setOffer(o)).catch(() => {});
    return () => {
      live = false;
    };
  }, [open, run]);

  if (!app || !run.sessionId || run.nodeId || run.status === 'running' || run.queued) return null;

  const go = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const prevDraft = app.getState().composer.draft ?? '';
    const r = await editFromHere({ store: agentRuns, run, ...(files && offer ? { revertFilesTo: offer.seq } : {}) });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    editUndo.set({ sessionId: run.sessionId!, removed: r.removed, prompt: r.prompt, prevDraft, filesReverted: r.filesReverted, at: Date.now() });
    app.dispatch({ type: 'composer/draft', text: r.prompt });
    window.setTimeout(() => {
      const field = document.querySelector<HTMLTextAreaElement>('.v3-composer textarea');
      field?.focus();
      field?.setSelectionRange(r.prompt.length, r.prompt.length);
    }, 0);
  };

  if (!open) {
    return (
      <button type="button" className="s2-ibtn s2-ibtn-sm s2-edit-from" aria-label="Edit from here" title="Edit from here" data-testid="edit-from-here" onClick={() => setOpen(true)}>
        <S2Icon name="pen" small />
      </button>
    );
  }
  const n = offer?.files.length ?? 0;
  const hasDraft = (app.getState().composer.draft ?? '').trim() !== '';
  return (
    <div className="s2-edit-from-row" role="group" aria-label="Edit from here" data-testid="edit-from-here-row">
      <p>This message and everything after it leave the chat, and the agent forgets them too. The message goes back to the composer.</p>
      {offer ? (
        <label>
          <input type="checkbox" checked={files} onChange={(e) => setFiles(e.target.checked)} data-testid="edit-from-here-files" />
          Also put {n} {n === 1 ? 'file' : 'files'} back to how {n === 1 ? 'it was' : 'they were'} before this message
        </label>
      ) : null}
      {hasDraft ? (
        <p className="s2-edit-from-draft" data-testid="edit-from-here-draft">
          The composer has a draft you have not sent. Editing replaces it; Undo brings it back.
        </p>
      ) : null}
      {error ? (
        <p className="s2-edit-from-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="s2-edit-from-actions">
        <button type="button" className="s2-btn s2-btn-sm s2-blue" disabled={busy} onClick={() => void go()} data-testid="edit-from-here-go">
          {busy ? 'Going back' : hasDraft ? 'Replace my draft and edit' : 'Edit'}
        </button>
        <button type="button" className="s2-btn s2-btn-sm" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** What the next turn says about the rewind, or null. */
export function rewoundNote(run: Pick<AgentRun, 'rewound' | 'resumeNote'>): string | null {
  if (run.rewound === 'rolled-back') return 'Went back to here: the agent forgot the later messages.';
  if (run.rewound === 'reseeded') return `Went back to here: this agent cannot undo its thread, so it started again from the kept chat${run.resumeNote ? ` (${run.resumeNote})` : ''}.`;
  return null;
}

/**
 * After an edit: "Undo" until a message is sent. The server keeps the cut turns
 * until then; the page keeps the runs and the composer text it replaced.
 */
export function EditUndoBar({ sessionId }: { sessionId: string | null }) {
  const app = useStoreIfAny();
  const undo = useSyncExternalStore(editUndo.subscribe, editUndo.get, editUndo.get);
  const runs = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!undo || undo.sessionId !== sessionId) return null;
  /* A message sent since ends the window (the server dropped its backup then). */
  if (runs.runs.some((r) => r.sessionId === undo.sessionId && r.startedAt >= undo.at)) return null;
  const go = async (): Promise<void> => {
    setBusy(true);
    const r = await undoEdit({ store: agentRuns, undo });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (app && (app.getState().composer.draft ?? '') === undo.prompt) app.dispatch({ type: 'composer/draft', text: undo.prevDraft });
  };
  return (
    <div className="s2-edit-undo" role="status" data-testid="edit-undo">
      <span>Went back to before that message.{undo.filesReverted > 0 ? ' The files stay as they are.' : ''}</span>
      <button type="button" className="s2-btn s2-btn-sm" disabled={busy} onClick={() => void go()} data-testid="edit-undo-go">
        Undo
      </button>
      {error ? (
        <span className="s2-edit-from-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
