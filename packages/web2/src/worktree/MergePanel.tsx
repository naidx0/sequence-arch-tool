/* ══════════════════════════════════════════════════════════════════════════
   S7 — MERGE A CHAT'S WORKTREE BACK, OR DISCARD IT
   packages/web2/src/worktree/MergePanel.tsx

   Opened from the chat header's worktree chip (v3/V3Chat.tsx), loaded then.
   It asks the server for a dry run first and says what Merge would do
   (worktreeModel.mergeVerdict):
     can merge     the files, then "Merge into <target>" / "Squash into <target>"
     cannot        the one line why (your checkout has uncommitted changes, it
                   would conflict, nothing changed), the conflicting files, and
                   no merge button
   "Discard worktree" removes it; when its branch holds commits yours does
   not, the server refuses (409) and the panel names every one of them
   (removalDialog) before it will confirm.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';

import './worktree.css';
import { branchLabel, mergeVerdict, removalDialog, worktreeApi, type ChatWorktree, type MergeMode, type MergeVerdict, type RemovalDialog } from './worktreeModel';
import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { PrSection } from './PrSection';
import { FanoutCompare } from '../fanout/FanoutCompare';
import { useStoreIfAny } from '../state/connect';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export default function MergePanel({
  sessionId,
  worktree,
  onClose,
  onChanged,
  fetchImpl,
  fanoutId,
}: {
  sessionId: string;
  worktree: ChatWorktree;
  onClose: () => void;
  /** Merged or removed: the chat header re-reads the binding. */
  onChanged: () => void;
  fetchImpl?: Fetch;
  /** Best of N: this chat is one of several made from one message. */
  fanoutId?: string;
}) {
  const app = useStoreIfAny();
  const f: Fetch = fetchImpl ?? ((i, init) => fetch(i, init));
  const [verdict, setVerdict] = useState<(MergeVerdict & { target: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RemovalDialog | null>(null);

  useEffect(() => {
    let live = true;
    void worktreeApi
      .dryRun(sessionId, f)
      .then((r) => {
        if (!live) return;
        if (!r.ok) setError(r.body.error ?? `The dry run failed (${r.status}).`);
        else setVerdict({ ...mergeVerdict(r.body), target: r.body.target });
      })
      .catch((e: unknown) => live && setError(`The dry run failed: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const merge = async (mode: MergeMode): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await worktreeApi.merge(sessionId, mode, f).catch((e: unknown) => ({ ok: false, status: 0, body: { error: String(e instanceof Error ? e.message : e) } }) as Awaited<ReturnType<typeof worktreeApi.merge>>);
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error ?? `The merge was refused (${r.status}).`);
      return;
    }
    setDone(`${mode === 'squash' ? 'Squashed' : 'Merged'} ${r.body.files.length} ${r.body.files.length === 1 ? 'file' : 'files'} into ${r.body.into}.`);
    onChanged();
  };

  const discard = async (confirm: readonly string[] = []): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await worktreeApi.remove(sessionId, confirm, f).catch((e: unknown) => ({ ok: false, status: 0, body: { error: String(e instanceof Error ? e.message : e) } }) as Awaited<ReturnType<typeof worktreeApi.remove>>);
    setBusy(false);
    if (r.status === 409 && r.body.unmerged?.length) {
      setRemoval(removalDialog(worktree.branch, r.body.unmerged));
      return;
    }
    if (!r.ok) {
      setError(r.body.error ?? `The worktree was not removed (${r.status}).`);
      return;
    }
    onChanged();
    onClose();
  };

  return (
    <section className="wt-panel" role="dialog" aria-label={`Worktree ${branchLabel(worktree.branch)}`} data-testid="worktree-panel">
      <header className="wt-panel-hd">
        <b>{branchLabel(worktree.branch)}</b>
        <button type="button" className="wt-panel-x" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      {fanoutId && app ? <FanoutCompare fanoutId={fanoutId} store={app} thisChat={sessionId} /> : null}
      {error ? (
        <p className="wt-panel-line" role="alert" data-testid="worktree-error">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="wt-panel-line" role="status" data-testid="worktree-done">
          {done}
        </p>
      ) : null}
      {!verdict && !error ? <p className="wt-panel-line"><AsciiSpinner /> Checking what a merge would do…</p> : null}
      {verdict && !done ? (
        verdict.can ? (
          <>
            <p className="wt-panel-line" data-testid="worktree-summary">
              {verdict.summary}
            </p>
            <ul className="wt-files" data-testid="worktree-files">
              {verdict.files.map((file) => (
                <li key={file.path} data-status={file.status}>
                  <span className="wt-file-status">{file.status}</span> {file.path}
                </li>
              ))}
            </ul>
            {fanoutId ? (
              <p className="wt-panel-line" data-testid="worktree-fanout-merge-note">
                This chat is one of several from one message: merge the one you pick from the list above.
              </p>
            ) : (
            <div className="wt-actions">
              <button type="button" className="wt-btn is-primary" disabled={busy} data-testid="worktree-merge" onClick={() => void merge('merge')}>
                Merge into {verdict.target}
              </button>
              <button type="button" className="wt-btn" disabled={busy} data-testid="worktree-squash" onClick={() => void merge('squash')}>
                Squash into {verdict.target}
              </button>
            </div>
            )}
          </>
        ) : (
          <>
            <p className="wt-panel-line" data-testid="worktree-cannot">
              {verdict.line}
            </p>
            {verdict.conflicts.length ? (
              <ul className="wt-files" data-testid="worktree-conflicts">
                {verdict.conflicts.map((p) => (
                  <li key={p} data-status="conflict">
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )
      ) : null}
      {!done ? <PrSection sessionId={sessionId} {...(fetchImpl ? { fetchImpl } : {})} /> : null}
      {removal ? (
        <div className="wt-removal" role="alertdialog" aria-label={removal.title} data-testid="worktree-removal">
          <p className="wt-panel-line">
            <b>{removal.title}</b>
          </p>
          <p className="wt-panel-line">{removal.body}</p>
          <ul className="wt-files">
            {removal.commits.map((c) => (
              <li key={c.sha}>
                <code>{c.sha.slice(0, 7)}</code> {c.subject}
              </li>
            ))}
          </ul>
          <div className="wt-actions">
            <button type="button" className="wt-btn is-danger" disabled={busy} data-testid="worktree-removal-confirm" onClick={() => void discard(removal.confirm)}>
              {removal.confirmLabel}
            </button>
            <button type="button" className="wt-btn" disabled={busy} onClick={() => setRemoval(null)}>
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="wt-actions wt-actions-end">
          <button type="button" className="wt-btn" disabled={busy} data-testid="worktree-discard" onClick={() => void discard()}>
            Discard worktree
          </button>
        </div>
      )}
    </section>
  );
}
