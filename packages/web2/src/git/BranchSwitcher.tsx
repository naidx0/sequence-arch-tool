/* ══════════════════════════════════════════════════════════════════════════
   THE BRANCH SWITCHER — a popover over GET /api/git/branches
   packages/web2/src/git/BranchSwitcher.tsx

   Jaden: "make sure it's easier to change branches and when you do change
   branches like a bit of a git interface workflow ... make sure it updates the
   architecture board accordingly."

   One pill (the current branch) that opens a list: local branches with how far
   ahead/behind, the last commit's subject and its age; remote branches folded
   behind one row; a filter; "New branch from <current>". A switch refused
   because the tree is dirty is explained with the files named. THERE IS NO
   "Stash and switch": stashing is a decision about the reader's work and this
   panel does not make it for them.

   WHEN THE ENGINE HAS NO /api/git/branches THIS RENDERS NOTHING, and the host
   keeps drawing today's static branch name.

   The shell builder mounts this where the branch name is shown. It is also
   mounted in the Files header and the Diff view header.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

import { useStoreIfAny } from '../state/connect';

import { followGitEvents, reloadAfterSwitch } from './boardReload';
import { getBranches, switchBranch } from './gitCalls';
import type { BranchInfo, GitBranchesResponse, GitServerEvent, RemoteBranchInfo } from './gitClient';
import { onGitEvent } from './gitEvents';
import './branchSwitcher.css';

type Fetch = typeof fetch;

/** "3 min ago", "2 d ago": short, because it sits on a compact row. */
export function relativeDate(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} d ago`;
  return `${Math.round(d / 30)} mo ago`;
}

interface Note {
  kind: 'dirty' | 'error';
  text: string;
  files?: string[];
}

export function BranchSwitcher({
  fetchImpl,
  onSwitched,
  followEvents = true,
  fallback = null,
}: {
  fetchImpl?: Fetch;
  /** Called after a switch the engine accepted (the host may refresh its own reads). */
  onSwitched?: (branch: string) => void;
  /** Subscribe to git events so the board follows the head. Default on. */
  followEvents?: boolean;
  /** Drawn in place of the pill while the engine has no branches route. */
  fallback?: ReactNode;
}) {
  const store = useStoreIfAny();
  const doFetch = useMemo<Fetch>(() => fetchImpl ?? ((i, n) => globalThis.fetch(i, n)), [fetchImpl]);
  const [info, setInfo] = useState<GitBranchesResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [remotesOpen, setRemotesOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  /* A switch made here is announced once: its own git:head event is the same fact. */
  const own = useRef<{ branch: string; heard: boolean; sha: string | null } | null>(null);
  const onSwitchedRef = useRef(onSwitched);
  onSwitchedRef.current = onSwitched;

  /* LATEST ANSWER WINS: two overlapping reads (open, then an event) can come
     back out of order, and the older one must not overwrite the newer. */
  const readSeq = useRef(0);
  const refresh = useCallback(async () => {
    const mine = (readSeq.current += 1);
    const answer = await getBranches(doFetch);
    if (mine !== readSeq.current) return;
    setInfo(answer.outcome === 'ok' ? answer.body : null);
  }, [doFetch]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* The board follows the head, whoever moved it (this popover, a terminal, an agent).
     One shared event stream and one shared board follower serve every switcher. */
  useEffect(() => {
    if (!followEvents) return undefined;
    const stopFollow = store === null ? () => undefined : followGitEvents(store, { fetchImpl: doFetch });
    const stopEvents = onGitEvent((event: GitServerEvent) => {
      void refresh();
      if (event.type !== 'git:head') return;
      /* The engine emits git:head BEFORE it answers the POST, so a switch made here is
         marked before the request goes out and its event is swallowed (the answer
         announces it once). After the answer the marker keeps only the sha it
         produced, so a late copy of the same event is dropped and any later head
         move on the same branch is not. */
      const mine = own.current;
      if (mine && mine.branch === (event.branch ?? '') && mine.sha === null) {
        mine.heard = true;
        return;
      }
      if (mine && mine.sha !== null && mine.sha === event.sha) {
        own.current = null;
        return;
      }
      onSwitchedRef.current?.(event.branch ?? '');
    });
    return () => {
      stopFollow();
      stopEvents();
    };
  }, [store, doFetch, followEvents, refresh]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e: PointerEvent) => {
      if (host.current && !host.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const needle = query.trim().toLowerCase();
  const locals = useMemo(
    () => (info?.branches ?? []).filter((b) => needle === '' || b.name.toLowerCase().includes(needle)),
    [info, needle],
  );
  const remotes = useMemo(
    () => (info?.remoteBranches ?? []).filter((b) => needle === '' || b.name.toLowerCase().includes(needle)),
    [info, needle],
  );

  const run = useCallback(
    async (request: { branch: string; create?: boolean; from?: string }) => {
      setBusy(true);
      setNote(null);
      own.current = { branch: request.branch, heard: false, sha: null };
      const answer = await switchBranch(request, doFetch);
      setBusy(false);
      if (answer.outcome === 'ok') {
        /* Without SSE nothing else would tell the board; with it, the engine's
           graph:updated reads again behind this one (single trailing read). */
        const heard = own.current?.heard === true;
        /* The marker keeps the sha only if the event has not already been seen. */
        own.current = heard ? null : { branch: answer.body.branch, heard: false, sha: answer.body.sha };
        if (store !== null && answer.body.changed && answer.body.rescan) void reloadAfterSwitch(store, { fetchImpl: doFetch });
        setOpen(false);
        setCreating(false);
        setNewName('');
        setQuery('');
        await refresh();
        onSwitched?.(answer.body.branch);
        return;
      }
      own.current = null;
      if (answer.outcome === 'refused') {
        if (answer.dirty) {
          setNote({ kind: 'dirty', text: answer.message, files: answer.dirty });
        } else {
          setNote({ kind: 'error', text: answer.refusal?.error || answer.message });
        }
        return;
      }
      setNote({ kind: 'error', text: answer.outcome === 'failed' ? answer.message : 'This engine cannot switch branches.' });
    },
    [doFetch, refresh, onSwitched, store],
  );

  const listKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(host.current?.querySelectorAll<HTMLButtonElement>('[data-branch-item]') ?? [])];
    if (items.length === 0) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]!.focus();
  };

  if (info === null) return <>{fallback}</>;
  const current = info.current;
  const label = current ?? (info.detached ? `detached ${(info.sha ?? '').slice(0, 7)}` : 'no branch');

  return (
    <span className="bsw" ref={host} data-testid="branch-switcher">
      <button
        type="button"
        className="s2-chipbtn bsw-trigger"
        data-testid="branch-switcher-trigger"
        data-on={open ? 'true' : 'false'}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Branch: ${label}. Switch branch`}
        title={info.dirty > 0 ? `${label} (uncommitted changes)` : label}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void refresh();
        }}
      >
        <svg className="bsw-ic" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="4.5" cy="3.5" r="1.7" />
          <circle cx="4.5" cy="12.5" r="1.7" />
          <circle cx="11.5" cy="6" r="1.7" />
          <path d="M4.5 5.2v5.6M11.5 7.7c0 2.4-3 2.2-7 3.4" />
        </svg>
        <span className="bsw-name">{label}</span>
        {info.dirty > 0 ? <span className="bsw-dirty" aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div className="bsw-pop" role="dialog" aria-label="Switch branch" data-testid="branch-switcher-pop" onKeyDown={listKey}>
          <input
            className="bsw-filter"
            data-testid="branch-switcher-filter"
            type="search"
            placeholder="Filter branches"
            aria-label="Filter branches"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          {note ? (
            <div className={`bsw-note is-${note.kind}`} role="alert" data-testid="branch-switcher-note">
              {note.kind === 'dirty' ? (
                <>
                  <p>
                    You have uncommitted changes that this switch would overwrite. Commit them, or put them aside in
                    your terminal, then switch again.
                  </p>
                  {note.files && note.files.length > 0 ? (
                    <ul className="bsw-files" data-testid="branch-switcher-dirty-files">
                      {note.files.slice(0, 8).map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                      {note.files.length > 8 ? <li>{`and ${note.files.length - 8} more`}</li> : null}
                    </ul>
                  ) : null}
                </>
              ) : (
                <p>{note.text}</p>
              )}
            </div>
          ) : null}
          <ul className="bsw-list" role="list" aria-label="Local branches">
            {locals.map((b) => (
              <BranchRow
                key={b.name}
                branch={b}
                current={b.name === current}
                disabled={busy}
                onPick={() => (b.name === current ? setOpen(false) : void run({ branch: b.name }))}
              />
            ))}
            {locals.length === 0 ? <li className="bsw-empty">No local branch matches.</li> : null}
          </ul>
          {(info.remoteBranches ?? []).length > 0 ? (
            <div className="bsw-remotes">
              <button
                type="button"
                className="bview-item bsw-fold"
                data-testid="branch-switcher-remotes"
                aria-expanded={remotesOpen}
                onClick={() => setRemotesOpen((v) => !v)}
              >
                {`${remotesOpen ? '▾' : '▸'} Remote branches (${(info.remoteBranches ?? []).length})`}
              </button>
              {remotesOpen || needle !== '' ? (
                <ul className="bsw-list" role="list" aria-label="Remote branches">
                  {remotes.map((r: RemoteBranchInfo) => (
                    <li key={r.name}>
                      <button
                        type="button"
                        className="bview-item bsw-item"
                        data-branch-item
                        disabled={busy}
                        title={`Create a local branch from ${r.name} and switch to it`}
                        onClick={() => void run({ branch: r.name.replace(/^[^/]+\//, ''), create: true, from: r.name })}
                      >
                        <span className="bsw-item-name">{r.name}</span>
                        <span className="bsw-item-sub">{r.lastCommit?.subject ?? ''}</span>
                        <span className="bsw-item-date">{relativeDate(r.lastCommit?.date)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <div className="bsw-new">
            {creating ? (
              <form
                className="bsw-newform"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newName.trim();
                  if (name && current) void run({ branch: name, create: true, from: current });
                }}
              >
                <input
                  className="bsw-filter"
                  data-testid="branch-switcher-newname"
                  aria-label="New branch name"
                  placeholder={`Name (from ${current ?? 'HEAD'})`}
                  value={newName}
                  autoFocus
                  onChange={(e) => setNewName(e.target.value)}
                />
                <button type="submit" className="s2-btn s2-btn-sm s2-blue bsw-go" data-testid="branch-switcher-create" disabled={busy || newName.trim() === ''}>
                  Create
                </button>
              </form>
            ) : (
              <button
                type="button"
                className="bview-item bsw-item bsw-newrow"
                data-testid="branch-switcher-new"
                data-branch-item
                disabled={current === null}
                onClick={() => setCreating(true)}
              >
                {`New branch from ${current ?? 'HEAD'}`}
              </button>
            )}
          </div>
        </div>
      ) : null}
    </span>
  );
}

function BranchRow({
  branch,
  current,
  disabled,
  onPick,
}: {
  branch: BranchInfo;
  current: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const ahead = branch.ahead > 0 ? `↑${branch.ahead}` : '';
  const behind = branch.behind > 0 ? `↓${branch.behind}` : '';
  return (
    <li>
      <button
        type="button"
        className={`bview-item bsw-item${current ? ' is-current' : ''}`}
        data-branch-item
        data-testid="branch-switcher-item"
        data-branch={branch.name}
        aria-current={current ? 'true' : undefined}
        disabled={disabled}
        onClick={onPick}
      >
        <span className="bsw-item-name">{branch.name}</span>
        <span className="bsw-item-ab mono" data-testid="branch-switcher-ab">
          {[ahead, behind].filter(Boolean).join(' ')}
        </span>
        <span className="bsw-item-sub">{branch.lastCommit?.subject ?? ''}</span>
        <span className="bsw-item-date">{relativeDate(branch.lastCommit?.date)}</span>
      </button>
    </li>
  );
}
