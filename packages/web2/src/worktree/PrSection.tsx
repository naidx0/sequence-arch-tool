/* ══════════════════════════════════════════════════════════════════════════
   OPEN A PULL REQUEST FROM THE WORKTREE PANEL
   packages/web2/src/worktree/PrSection.tsx

   Both buttons ("Open a pull request", and "Push newer commits" when one is
   linked) first fetch the preview: the generated title and body, and EVERY
   file that would go (nothing is changed yet). Files that look like secrets
   (.env, keys, credentials) are listed apart and left out unless ticked. The
   plan says exactly what will happen (commit N files on <branch>, push to
   <remote>, open a PR into <base>), and one press does it. A failure after
   the push says the branch is pushed, with the compare link when there is
   one.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface PrLink {
  url: string;
  number: number | null;
  title: string;
  branch: string;
  base: string;
}

export interface PrPreview {
  commitMessage: string;
  title: string;
  body: string;
  /** Every file the pull request carries (already committed, then the ones that will be committed now), secrets held back excluded. */
  files: { path: string; status: string }[];
  /** Uncommitted files; `flagged` says why one looks like a secret. */
  pending: { path: string; status: string; flagged: string | null }[];
  /** Files already committed on the branch; a flagged one is sent by pushing it, so it must be ticked. */
  committed?: { path: string; status: string; flagged: string | null }[];
  dirty: boolean;
  remote: string | null;
  base: string;
  branch: string;
  pr: PrLink | null;
}

/** What pressing the button will do, in one sentence. `ticked`: held-back files the person chose to include. */
/** Everything held back: uncommitted and already-committed files that look like secrets. */
export function heldFiles(p: Pick<PrPreview, 'pending' | 'committed'>): { path: string; flagged: string; committed: boolean }[] {
  const pend = p.pending.filter((f) => f.flagged).map((f) => ({ path: f.path, flagged: f.flagged!, committed: false }));
  const done = (p.committed ?? []).filter((f) => f.flagged && !pend.some((x) => x.path === f.path)).map((f) => ({ path: f.path, flagged: f.flagged!, committed: true }));
  return [...pend, ...done];
}

export function prPlan(p: Pick<PrPreview, 'pending' | 'remote' | 'base' | 'branch' | 'pr'>, ticked: ReadonlySet<string> = new Set()): string {
  const n = p.pending.filter((f) => !f.flagged || ticked.has(f.path)).length;
  const commit = n > 0 ? `Commit ${n} ${n === 1 ? 'file' : 'files'} on ${p.branch}, push` : `Push ${p.branch}`;
  const end = p.pr ? 'The pull request updates.' : `and open a pull request into ${p.base}.`;
  return p.pr ? `${commit} to ${p.remote ?? 'a remote'}. ${end}` : `${commit} to ${p.remote ?? 'a remote'}, ${end}`;
}

const json = async (r: Response): Promise<Record<string, unknown>> => {
  try {
    return (await r.json()) as Record<string, unknown>;
  } catch {
    return { error: `The server answered ${r.status}.` };
  }
};

export function PrSection({ sessionId, fetchImpl }: { sessionId: string; fetchImpl?: Fetch }) {
  const f: Fetch = fetchImpl ?? ((i, init) => fetch(i, init));
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/pr`;
  const [linked, setLinked] = useState<PrLink | null>(null);
  const [preview, setPreview] = useState<PrPreview | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let live = true;
    void f(base)
      .then(json)
      .then((j) => live && setLinked((j.pr as PrLink | null) ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const open = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const r = await f(`${base}/preview`, { method: 'POST' }).catch(() => null);
    const j = r ? await json(r) : { error: 'Could not reach the server.' };
    setBusy(false);
    if (!r || !r.ok) {
      setError(String(j.error ?? 'The preview failed.'));
      return;
    }
    const p = j as unknown as PrPreview;
    setPreview(p);
    setTitle(p.title);
    setBody(p.body);
    setTicked(new Set());
  };

  const go = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setCompare(null);
    const r = await f(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, body, includeFlagged: [...ticked], ...(preview ? { commitMessage: preview.commitMessage } : {}) }) }).catch(() => null);
    const j = r ? await json(r) : { error: 'Could not reach the server.' };
    setBusy(false);
    if (!r || !r.ok) {
      setError(String(j.error ?? 'The pull request was not opened.'));
      setCompare(typeof j.compareUrl === 'string' ? j.compareUrl : null);
      return;
    }
    setLinked(j.pr as PrLink);
    setPreview(null);
    setNote(j.existing ? 'Pushed the newer commits to it.' : null);
  };

  return (
    <div className="wt-pr" data-testid="worktree-pr">
      {linked ? (
        <p className="wt-panel-line" data-testid="worktree-pr-linked">
          <a href={linked.url} target="_blank" rel="noopener noreferrer">
            Pull request{linked.number ? ` #${linked.number}` : ''}
          </a>{' '}
          into {linked.base}. {note}
        </p>
      ) : null}
      {error ? (
        <p className="wt-panel-line" role="alert" data-testid="worktree-pr-error">
          {error}{' '}
          {compare ? (
            <a href={compare} target="_blank" rel="noopener noreferrer">
              Open it on GitHub
            </a>
          ) : null}
        </p>
      ) : null}
      {preview ? (
        <div className="wt-pr-form">
          <label className="wt-pr-field">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="worktree-pr-title" />
          </label>
          <label className="wt-pr-field">
            Description
            <textarea value={body} rows={6} onChange={(e) => setBody(e.target.value)} data-testid="worktree-pr-body" />
          </label>
          <p className="wt-panel-line" data-testid="worktree-pr-plan">
            {prPlan(preview, ticked)}
          </p>
          <ul className="wt-files" data-testid="worktree-pr-files">
            {preview.files.map((file) => (
              <li key={file.path} data-status={file.status}>
                <span className="wt-file-status">{file.status}</span> {file.path}
              </li>
            ))}
          </ul>
          {heldFiles(preview).length > 0 ? (
            <div className="wt-pr-held" data-testid="worktree-pr-held">
              <p className="wt-panel-line">They look like secrets. Uncommitted ones are left out unless ticked. Ones already committed on the branch go with the push, so the push waits until each is ticked or removed from the branch.</p>
              {heldFiles(preview)
                .map((f) => (
                  <label key={f.path} className="wt-pr-hold">
                    <input
                      type="checkbox"
                      checked={ticked.has(f.path)}
                      data-testid="worktree-pr-hold"
                      onChange={(e) => setTicked((t) => (e.target.checked ? new Set([...t, f.path]) : new Set([...t].filter((x) => x !== f.path))))}
                    />
                    {f.path} <span className="wt-file-status">({f.flagged}{f.committed ? ', already committed' : ''})</span>
                  </label>
                ))}
            </div>
          ) : null}
          <div className="wt-actions">
            <button type="button" className="wt-btn is-primary" disabled={busy || title.trim() === '' || !preview.remote || heldFiles(preview).some((f) => f.committed && !ticked.has(f.path))} data-testid="worktree-pr-go" onClick={() => void go()}>
              {busy ? 'Working…' : preview.pr ? 'Commit and push' : 'Commit, push and open'}
            </button>
            <button type="button" className="wt-btn" disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="wt-actions">
          <button type="button" className="wt-btn" disabled={busy} data-testid="worktree-pr-open" onClick={() => void open()}>
            {linked ? 'Push newer commits' : 'Open a pull request'}
          </button>
        </div>
      )}
    </div>
  );
}
