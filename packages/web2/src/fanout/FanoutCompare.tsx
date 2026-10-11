/* ══════════════════════════════════════════════════════════════════════════
   COMPARING THE SIBLINGS OF A BEST-OF-N SEND
   packages/web2/src/fanout/FanoutCompare.tsx

   Inside a chat's worktree panel when the chat was one of several made from
   one message. Each sibling: the files it changed, and what merging it would
   do (a dry run: clean, or the files it would conflict in; nothing is
   changed). "Merge this one" is the one click, offered once no sibling is
   still working and no one has been merged. Only AFTER a merge does "Discard
   the other N" appear, and only while none of them is running (the server
   checks both). It says first that their edits go with them, and when one has
   commits that were never merged it lists them and asks a second time.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useState } from 'react';

import { activateSession } from '../v3/sessionActions';
import type { Store } from '../state';
import { fanoutApi, type AtRisk, type SiblingView } from './fanoutClient';
import './fanout.css';

/** One line for a sibling's merge dry run. */
export function siblingLine(s: SiblingView): string {
  if (s.removed) return 'Discarded.';
  if (s.merged) return 'Merged.';
  if (s.error) return s.error;
  if (s.running) return 'Still working.';
  if (!s.dryRun) return 'No result yet.';
  const n = s.files.length;
  const files = `${n} ${n === 1 ? 'file' : 'files'} changed`;
  if (n === 0) return 'Changed no files.';
  if (s.dryRun.conflicts.length) return `${files}. Merging would conflict in ${s.dryRun.conflicts.length} ${s.dryRun.conflicts.length === 1 ? 'file' : 'files'}.`;
  if (s.dryRun.mainUncommitted.length) return `${files}. Commit or stash your own changes before merging.`;
  return `${files}. Merges cleanly into ${s.dryRun.target}.`;
}

export function FanoutCompare({ fanoutId, store, thisChat }: { fanoutId: string; store: Store; thisChat: string }) {
  const [sibs, setSibs] = useState<SiblingView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [atRisk, setAtRisk] = useState<AtRisk[] | null>(null);
  /** The server's hash of the list the person is looking at; only it confirms the deletion. */
  const [token, setToken] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const r = await fanoutApi.compare(fanoutId).catch((e: unknown) => ({ ok: false, status: 0, body: { error: String(e) } }) as Awaited<ReturnType<typeof fanoutApi.compare>>);
    if (!r.ok) setError(r.body.error ?? `The comparison failed (${r.status}).`);
    else setSibs(r.body.siblings);
  }, [fanoutId]);
  useEffect(() => {
    void load();
  }, [load]);
  /* While any sibling works, keep asking: Merge and Discard follow what the server says. */
  const working = !!sibs?.some((s) => s.running);
  useEffect(() => {
    if (!working) return undefined;
    const t = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(t);
  }, [working, load]);

  if (error) return <p className="wt-panel-line fo-error" role="alert">{error}</p>;
  if (!sibs) return <p className="wt-panel-line">Comparing the agents…</p>;
  const merged = sibs.find((s) => s.merged);
  const others = sibs.filter((s) => !s.removed && !s.merged);
  const othersRunning = others.some((s) => s.running);

  const choose = async (chatId: string): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await fanoutApi.choose(fanoutId, chatId, 'merge').catch((e: unknown) => ({ ok: false, status: 0, body: { error: String(e) } }) as Awaited<ReturnType<typeof fanoutApi.choose>>);
    setBusy(false);
    if (!r.ok) {
      setError(r.body.error ?? `The merge was refused (${r.status}).`);
      return;
    }
    await load();
  };
  const discard = async (confirmLoss: string | null = null): Promise<void> => {
    if (!merged) return;
    setBusy(true);
    setError(null);
    const r = await fanoutApi.discardOthers(fanoutId, merged.chatId, confirmLoss).catch((e: unknown) => ({ ok: false, status: 0, body: { error: String(e) } }) as Awaited<ReturnType<typeof fanoutApi.discardOthers>>);
    setBusy(false);
    if (!r.ok && r.body.needsConfirm?.length) {
      /* Work that was never merged: say what, and ask again. */
      setAtRisk(r.body.needsConfirm);
      setToken(r.body.confirmToken ?? null);
      if (confirmLoss) setError(r.body.error ?? null);
      return;
    }
    setConfirm(false);
    setAtRisk(null);
    if (!r.ok) setError(r.body.error ?? `Not discarded (${r.status}).`);
    await load();
  };

  return (
    <div className="fo-compare" data-testid="fanout-compare">
      <p className="wt-panel-line"><b>Same message, {sibs.length} agents</b></p>
      <ul className="fo-sibs">
        {sibs.map((s) => (
          <li key={s.chatId} data-testid="fanout-sibling" data-agent={s.agentRef} data-clean={s.dryRun?.clean ? 'true' : 'false'}>
            <div className="fo-sib-hd">
              <b>{s.agentRef}</b>
              {s.chatId === thisChat ? <span className="fo-here">this chat</span> : (
                <button type="button" className="s2-chipbtn" onClick={() => void activateSession(store, s.chatId)}>
                  Open
                </button>
              )}
            </div>
            <div className="fo-sib-line">{siblingLine(s)}</div>
            {!s.removed && !s.merged && !merged ? (
              <button type="button" className="s2-btn s2-btn-sm s2-blue" disabled={busy || !s.dryRun?.clean || sibs.some((x) => x.running)} data-testid="fanout-merge" onClick={() => void choose(s.chatId)}>
                Merge this one
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {merged && others.length > 0 ? (
        confirm ? (
          <div className="wt-removal" role="alertdialog" aria-label="Discard the other agents">
            {atRisk ? (
              <>
                <p className="wt-panel-line fo-warn" data-testid="fanout-at-risk">
                  Some of these never merged what they wrote. Discarding deletes it for good:
                </p>
                <ul className="fo-sibs">
                  {atRisk.map((a) => (
                    <li key={a.chatId}>
                      <b>{a.agentRef}</b>: {a.commits.length} {a.commits.length === 1 ? 'commit' : 'commits'}
                      {a.uncommittedFiles ? `, ${a.uncommittedFiles} unsaved ${a.uncommittedFiles === 1 ? 'file' : 'files'}` : ''}
                      {a.commits.slice(0, 3).map((c) => (
                        <div key={c.sha} className="fo-sib-line">
                          <code>{c.sha.slice(0, 7)}</code> {c.subject}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="wt-panel-line">This removes {others.length} worktrees and their branches, with everything those agents wrote. The chats keep their messages.</p>
            )}
            <div className="wt-actions">
              <button type="button" className="s2-btn s2-btn-sm s2-danger" disabled={busy || othersRunning} data-testid="fanout-discard-confirm" onClick={() => void discard(atRisk ? token : null)}>
                {atRisk ? 'Delete their work' : `Discard ${others.length}`}
              </button>
              <button type="button" className="s2-btn s2-btn-sm" onClick={() => (setConfirm(false), setAtRisk(null), setToken(null))}>
                Keep them
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="s2-btn s2-btn-sm" disabled={othersRunning} title={othersRunning ? 'Some of them are still working.' : undefined} data-testid="fanout-discard" onClick={() => setConfirm(true)}>
            Discard the other {others.length}
          </button>
        )
      ) : null}
    </div>
  );
}
