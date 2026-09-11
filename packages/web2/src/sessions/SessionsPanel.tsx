/* ══════════════════════════════════════════════════════════════════════════
   SESSIONS — the threads this repo already has
   packages/web2/src/sessions/SessionsPanel.tsx

   `Ctrl-K → Sessions` said "Built in a later wave" while the engine kept a full
   index on disk the whole time: `.sequence/sessions/index.json`, with a title,
   a mode, and an `activeId`. Work the user had already done was reachable by
   the server and not by them.

   THE LIST IS THE PANEL. Sessions are ordered newest-first with pinned ones
   above, and the active one is marked rather than merely highlighted — a colour
   alone would leave a keyboard or screen-reader user unable to tell which
   thread they are in.

   IT NEVER INVENTS A TITLE. `SessionIndexEntry.title` is what the store wrote;
   an untitled session shows its id, because a panel that made up "Untitled
   conversation 3" would be inventing the one thing a user scans this list for.

   SWITCHING RELOADS, and that is stated on the control rather than discovered.
   The chat, the board and the scan all hang off the active session, and this
   package has no cross-slice reload path — pretending otherwise would leave a
   reader looking at one session's transcript beside another's board, which is
   worse than a reload they were told about.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { RepoSessionsSection, SessionIndex, SessionIndexEntry } from '@sequence/api-types';
import { Icon } from '../chat/Icon';
import { migrateLegacyWorkspaceScratch, scratchStorage } from '../canvas/localScratch';
import type { OpenRepoSessionResult } from './openRepoSession';
import { clearSessionFlush, flushSessionMemory } from './sessionPersist';
import type { SessionsClient } from './sessionsClient';
import { sessionWhenLabel } from './sessionWhen';
import './sessions.css';

export interface SessionsPanelProps {
  client: SessionsClient;
  /**
   * Bumps when the attached repo (or workspace-without-repo) changes so the
   * list refetches. Without this, attach/detach leaves stale workspace rows
   * visible while the server reads a different sessions root → "session not found".
   */
  repoRevision?: string;
  /** Called after the active session changes, so the host can reload. */
  onSwitched?: (id: string) => void;
  /**
   * Blank-workspace catalog: attach this repo and switch to the session, then
   * the host reloads so chat/board match the repo thread.
   */
  onOpenRepoSession?: (
    repoPath: string,
    sessionId: string,
  ) => void | Promise<void | OpenRepoSessionResult>;
}

/** Pinned first, then newest-updated. Deterministic on ties, by id. */
function order(entries: readonly SessionIndexEntry[]): SessionIndexEntry[] {
  return [...entries].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) ||
      a.id.localeCompare(b.id),
  );
}

function when(iso: string | undefined, now: number): string {
  return sessionWhenLabel(iso, now);
}

/**
 * A row's identity in THIS panel: the repo it belongs to plus the session id.
 *
 * The workspace catalog renders rows from several repos in one panel, and
 * session ids are only unique WITHIN a repo — so `session-0001` can appear in
 * the General list and in two repo sections at once. Anything the panel keys
 * per row (today: which row's rename field is open) keys on this, never on the
 * bare id. The join is LENGTH-PREFIXED rather than delimited: a Windows path
 * contains spaces and a POSIX path can contain nearly anything else, so there is
 * no character safe to separate on.
 */
function rowKey(repoPath: string | undefined, id: string): string {
  const repo = repoPath ?? '';
  return `${repo.length}:${repo}${id}`;
}

export function SessionsPanel({
  client,
  repoRevision,
  onSwitched,
  onOpenRepoSession,
}: SessionsPanelProps) {
  const [index, setIndex] = useState<SessionIndex | null>(null);
  const [scope, setScope] = useState<'workspace' | 'repo' | null>(null);
  const [repoSections, setRepoSections] = useState<readonly RepoSessionsSection[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* Which ROW is being renamed, and the field's own draft. One at a time: two
     open rename fields in one list is a list nobody can read.

     Keyed by {@link rowKey}, not by bare id. Session ids are minted per repo
     (`sessionsStore.uniqueSessionId` only sees one index), so two repos can
     mint `session-0001` — a bare-id key would open the rename field on both
     rows at once, in two different sections. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  /* Which ROW has an ARMED delete, keyed by {@link rowKey} like `renaming`.
     One at a time, for the same reason: two rows asking "delete this?" at once
     is a question nobody can answer. */
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [collapsedRepos, setCollapsedRepos] = useState<ReadonlySet<string>>(() => new Set());
  const live = useRef(true);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const answer = await client.list(signal);
      if (!live.current) return;
      if (answer.outcome === 'ok') {
        setIndex(answer.body.index);
        setScope(answer.body.scope ?? 'repo');
        setRepoSections(answer.body.repos ?? []);
        setFailure(null);
      } else if (answer.message !== 'cancelled') {
        setFailure(answer.message);
      }
    },
    [client],
  );

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      live.current = false;
      controller.abort();
    };
  }, [load, repoRevision]);

  /* Relative labels refresh on a minute tick while the list is visible. */
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  async function create() {
    setBusy(true);
    /* Pin legacy workspace scratch to the outgoing session before activeId flips. */
    const storage = scratchStorage();
    if (storage && index?.activeId) migrateLegacyWorkspaceScratch(storage, index.activeId);
    /* Flush the *current* session before create flips activeId — otherwise
       flush-on-reload writes this transcript into the brand-new blank session. */
    await flushSessionMemory();
    clearSessionFlush();
    const answer = await client.create(scope === 'workspace' ? 'work' : 'code');
    if (!live.current) return;
    setBusy(false);
    if (answer.outcome === 'ok') {
      setIndex(answer.body.index);
      setFailure(null);
      onSwitched?.(answer.body.session.id);
    } else {
      setFailure(answer.message);
    }
  }

  async function activate(id: string) {
    setBusy(true);
    const storage = scratchStorage();
    if (storage && index?.activeId) migrateLegacyWorkspaceScratch(storage, index.activeId);
    await flushSessionMemory();
    clearSessionFlush();
    const answer = await client.activate(id);
    if (!live.current) return;
    setBusy(false);
    if (answer.outcome === 'ok') {
      setIndex(answer.body.index);
      setFailure(null);
      onSwitched?.(id);
    } else {
      setFailure(answer.message);
      if (answer.message === 'session not found') {
        void load();
      }
    }
  }

  /*
   * G1 TAIL — RENAME, PIN, DELETE. The backend has served all three since the
   * index existed (`PUT /api/sessions/:id` takes `title` / `pinned`;
   * `DELETE /api/sessions/:id` re-homes `activeId` itself), so this wires what
   * the server actually does and invents nothing client-side.
   *
   * EVERY ANSWER IS THE NEW INDEX. The server owns the ordering, the active
   * pointer and the pin flags; keeping a local copy of any of them would be a
   * second opinion that drifts the first time a delete re-homes `activeId`.
   */
  const patch = useCallback(
    async (id: string, body: { title?: string; pinned?: boolean }, repoPath?: string) => {
      setBusy(true);
      const answer = await client.update(id, body, repoPath);
      if (!live.current) return;
      setBusy(false);
      if (answer.outcome !== 'ok') {
        setFailure(answer.message);
        return;
      }
      setFailure(null);
      if (repoPath) {
        /* OWNER, 2026-09-02: "let you edit any type of chat session without
           actually being in that chat session". A catalog row belongs to
           ANOTHER repo, so the index the server hands back is THAT repo's — not
           the workspace one this panel's General list renders. Writing it into
           `index` would replace the General list with a foreign repo's threads
           while the section that was edited stayed stale, which is two lies in
           one paint. Re-read instead: `load()` refetches the workspace index
           AND every section from the one route that owns both. */
        await load();
        return;
      }
      setIndex(answer.body.index);
    },
    [client, load],
  );

  const destroy = useCallback(
    async (id: string, repoPath?: string) => {
      /* FINDING F12 → REVIEW ROUND 2, FINDING G2 — BOTH POINTERS ARE SERVER
         ANSWERS, AND THE QUIET DELETE IS BACK. F12 removed a heuristic that
         compared against a possibly-stale captured pointer, and in doing so
         made every successful delete report — which, with the host's reload
         handler, rebooted the whole SPA because someone deleted a thread that
         was not open. The rule now compares the server's RETURNED pointer
         against the one this panel's own last SERVER index load carries — no
         separate cache, no local belief, both sides answers the server gave:
         same pointer → the workspace this panel knows about did not move, say
         nothing; different → report it, exactly as a switch would. The stale-
         load case is still caught: if the server re-homes onto anything other
         than what this panel loaded, the difference reports it.

         THE CATALOG CASE KEEPS THAT GUARANTEE BY NOT PLAYING. `repoPath` names
         a repo the user is NOT in, so the `activeId` the server re-homes is
         that repo's pointer — comparing it against this workspace's pointer
         would differ every time and fire `onSwitched`, rebooting the SPA for a
         thread the user never opened, which is precisely the bug the rule above
         exists to prevent. A foreign delete reports nothing and re-reads. */
      setBusy(true);
      setConfirmingDelete(null);
      const loadedActiveId = index?.activeId ?? null;
      const answer = await client.remove(id, repoPath);
      if (!live.current) return;
      setBusy(false);
      if (answer.outcome !== 'ok') {
        setFailure(answer.message);
        return;
      }
      setFailure(null);
      if (repoPath) {
        await load();
        return;
      }
      const returned = answer.body.index.activeId ?? null;
      setIndex(answer.body.index);
      if (returned !== null && returned !== loadedActiveId) {
        onSwitched?.(returned);
      }
    },
    [client, index, load, onSwitched],
  );

  function beginRename(s: SessionIndexEntry, repoPath?: string) {
    /* The stored title, or the id the panel would have shown — never an
       invented "Untitled conversation N". */
    setRenameDraft(s.title?.trim() ? s.title : s.id);
    setConfirmingDelete(null);
    setRenaming(rowKey(repoPath, s.id));
  }

  async function commitRename(id: string, repoPath?: string) {
    const title = renameDraft.trim();
    setRenaming(null);
    /* An empty title is refused here rather than sent: the store ignores one
       but still bumps `updatedAt`, which would silently reorder the list. */
    if (title !== '') await patch(id, { title }, repoPath);
  }

  const rows = index ? order(index.sessions) : [];
  const workspaceMode = scope === 'workspace';

  async function openRepo(repoPath: string, sessionId: string) {
    if (!onOpenRepoSession) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await onOpenRepoSession(repoPath, sessionId);
      if (result && typeof result === 'object' && 'outcome' in result && result.outcome === 'error') {
        setFailure(result.message);
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }

  function renderRows(
    entries: readonly SessionIndexEntry[],
    activeId: string | undefined,
    opts?: { repoPath?: string; repoName?: string },
  ) {
    const repoPath = opts?.repoPath;
    const fromCatalog = typeof repoPath === 'string';
    /* The SERVER named this repo (`RepoSessionsSection.name`). Deriving a
       label from the path client-side got it wrong on the owner's machine:
       `'C:\\Users\\dev\\Projects\\realapp'.split('/').pop()` is the whole
       path, because a Windows path has no forward slashes to split on. */
    const repoLabel = opts?.repoName ?? repoPath;
    return entries.map((s) => {
      /*
       * ONLY THE SESSION YOU ARE IN is marked active.
       *
       * Workspace catalog rows carry each repo's own `activeId` (last thread
       * in THAT repo). Highlighting those too painted three "current" rows —
       * General + SEQUENCE + SCHWAI — and confused which thread is loaded.
       * Catalog is browse/attach; it never owns the live transcript.
       */
      const active = !fromCatalog && s.id === activeId;
      const key = rowKey(repoPath, s.id);
      const named = s.title?.trim() ? s.title : s.id;
      const armed = confirmingDelete === key;
      return (
        <li key={s.id} className="sessions-item">
          {renaming === key ? (
            <span className="sessions-rename">
              <input
                className="settings-input sessions-rename-field"
                data-testid="sessions-rename-field"
                value={renameDraft}
                autoFocus
                aria-label="Session title"
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void commitRename(s.id, repoPath);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setRenaming(null);
                  }
                }}
              />
              <button
                type="button"
                className="sessions-act"
                data-testid="sessions-rename-commit"
                aria-label="Save this title"
                disabled={busy || renameDraft.trim() === ''}
                onClick={() => void commitRename(s.id, repoPath)}
              >
                <Icon name="check" size={12} />
              </button>
              <button
                type="button"
                className="sessions-act"
                data-testid="sessions-rename-cancel"
                aria-label="Keep the previous title"
                disabled={busy}
                onClick={() => setRenaming(null)}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ) : armed ? (
            /* REVIEW ROUND 3 — A DELETE IS THE ONE ROW ACTION THAT CANNOT BE
               UNDONE. The server `rmSync`s the session directory: transcript,
               canvas, meta, gone from disk. Every other control in this
               cluster is reversible (rename back, unpin), and the three sit
               side by side in a 3-icon overlay that only appears on hover —
               so the click that destroys a thread cost exactly as much as the
               click that pins one. Worse for a CATALOG row, which is a repo
               the reader is NOT in: deleting its last thread now correctly
               removes the whole section (see `keepOneLiveThread` in the
               analyzer's `deleteSession`), so a mis-click makes an entire repo
               disappear from the panel with nothing on screen to say why.
               Arming is the message: it names the thread, and for a foreign
               row it names the repo the thread will leave. */
            <span
              className="sessions-confirm"
              data-testid="sessions-delete-confirm-strip"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setConfirmingDelete(null);
                }
              }}
            >
              <span className="sessions-confirm-text" data-testid="sessions-delete-prompt">
                {fromCatalog ? `Delete “${named}” from ${repoLabel}?` : `Delete “${named}”?`}
              </span>
              <button
                type="button"
                className="sessions-act sessions-act-destroy"
                data-testid="sessions-delete-confirm"
                aria-label={`Delete ${named} permanently`}
                disabled={busy}
                title="Delete permanently"
                onClick={() => void destroy(s.id, repoPath)}
              >
                <Icon name="trash" size={12} />
              </button>
              <button
                type="button"
                className="sessions-act"
                data-testid="sessions-delete-cancel"
                aria-label={`Keep ${named}`}
                /* FOCUS LANDS ON CANCEL, NOT ON THE DESTRUCTIVE HALF: a
                   keyboard reader who arms this and hits Enter must keep the
                   thread, not lose it. */
                autoFocus
                disabled={busy}
                title="Keep it"
                onClick={() => setConfirmingDelete(null)}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                className="sessions-row"
                data-testid="sessions-row"
                data-id={s.id}
                data-active={active ? 'true' : 'false'}
                aria-current={active ? 'true' : undefined}
                disabled={busy || (fromCatalog ? false : active)}
                title={fromCatalog ? `Attach ${repoLabel} and open this session` : undefined}
                onClick={() => (fromCatalog ? void openRepo(repoPath, s.id) : void activate(s.id))}
              >
                {s.pinned ? <Icon name="pin" size={12} className="sessions-pin-mark" /> : null}
                <span className="sessions-name">{s.title?.trim() ? s.title : s.id}</span>
                <span className="sessions-when">{when(s.updatedAt, now)}</span>
              </button>
              {/* OWNER, 2026-09-02: "Should also let you edit any type of chat
                  session without actually being in that chat session, just
                  whenever you want." This cluster used to render only when
                  `!fromCatalog`, so another repo's thread could be opened and
                  never renamed, pinned or deleted — the one thing the catalog
                  put in front of the user was the one thing it would not let
                  them touch. Every handler now carries `repoPath`, which the
                  server validates against this same catalog. */}
              <span className="sessions-acts" data-testid="sessions-acts" data-repo={repoPath}>
                <button
                  type="button"
                  className="sessions-act"
                  data-testid="sessions-pin"
                  aria-label={s.pinned ? `Unpin ${s.title || s.id}` : `Pin ${s.title || s.id}`}
                  aria-pressed={s.pinned === true}
                  disabled={busy}
                  title={s.pinned ? 'Unpin' : 'Pin'}
                  onClick={() => void patch(s.id, { pinned: !s.pinned }, repoPath)}
                >
                  <Icon name="pin" size={12} />
                </button>
                <button
                  type="button"
                  className="sessions-act"
                  data-testid="sessions-rename"
                  aria-label={`Rename ${s.title || s.id}`}
                  disabled={busy}
                  title="Rename"
                  onClick={() => beginRename(s, repoPath)}
                >
                  <Icon name="pen" size={12} />
                </button>
                <button
                  type="button"
                  className="sessions-act"
                  data-testid="sessions-delete"
                  aria-label={`Delete ${s.title || s.id}`}
                  disabled={busy}
                  title="Delete"
                  /* ARMS the row; the destroy call lives on the confirm half
                     above. This click must never reach the server. */
                  onClick={() => {
                    setRenaming(null);
                    setConfirmingDelete(key);
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </span>
            </>
          )}
        </li>
      );
    });
  }

  return (
    <div className="sessions-scope sessionspanel" data-testid="sessions-panel">
      <header className="sessions-head">
        <button
          type="button"
          className="sessions-new-chat"
          data-testid="sessions-new"
          disabled={busy || index === null}
          onClick={() => void create()}
        >
          <Icon name="newthread" size={14} />
          New chat
        </button>
      </header>

      <div className="sessions-scroll">
        {index === null && failure === null ? (
          <p className="sessions-note" data-testid="sessions-loading">
            Reading sessions…
          </p>
        ) : null}

        {failure === null ? null : (
          <p className="sessions-failure" data-testid="sessions-failure" role="alert">
            {failure}
          </p>
        )}

        {index !== null && rows.length === 0 ? (
          <p className="sessions-note" data-testid="sessions-empty">
            No sessions yet. The first question you ask starts one.
          </p>
        ) : null}

        {rows.length > 0 ? (
          <div className="sessions-group" data-testid="sessions-group-general">
            {workspaceMode ? (
              <p className="sessions-group-label" data-testid="sessions-group-general-label">
                <Icon name="gpu" size={14} className="sessions-group-general-mark" />
                <span className="sessions-group-label-text">General</span>
              </p>
            ) : null}
            <ul className="sessions-list" data-testid="sessions-list">
              {renderRows(rows, index?.activeId)}
            </ul>
          </div>
        ) : null}

        {workspaceMode && repoSections.length > 0
          ? repoSections.map((section) => {
              const sectionRows = order(section.index.sessions);
              if (sectionRows.length === 0) return null;
              const collapsed = collapsedRepos.has(section.path);
              return (
                <div
                  key={section.path}
                  className="sessions-group"
                  data-testid="sessions-group-repo"
                  data-repo={section.path}
                  data-collapsed={collapsed ? 'true' : 'false'}
                >
                  <button
                    type="button"
                    className="sessions-group-label"
                    data-testid="sessions-group-repo-toggle"
                    aria-expanded={!collapsed}
                    onClick={() =>
                      setCollapsedRepos((prev) => {
                        const next = new Set(prev);
                        if (next.has(section.path)) next.delete(section.path);
                        else next.add(section.path);
                        return next;
                      })
                    }
                  >
                    <Icon name={collapsed ? 'chevright' : 'chevdown'} size={12} />
                    <Icon name="folder" size={14} className="sessions-group-folder" />
                    <span className="sessions-group-label-text">{section.name}</span>
                  </button>
                  {collapsed ? null : (
                    <ul className="sessions-list" data-testid="sessions-list-repo">
                      {renderRows(sectionRows, section.index.activeId, {
                        repoPath: section.path,
                        repoName: section.name,
                      })}
                    </ul>
                  )}
                </div>
              );
            })
          : null}
      </div>
    </div>
  );
}
