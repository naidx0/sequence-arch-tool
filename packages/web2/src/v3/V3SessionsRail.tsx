import { useCallback, useEffect, useRef, useState } from 'react';

import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import { Icon } from '../chat/Icon';
import { sessionWhenLabel } from '../sessions/sessionWhen';
import { createSessionsClient, type SessionsClient } from '../sessions/sessionsClient';
import { groundedRepoRoot, useAppState, useStore } from '../state/connect';
import {
  activateSession,
  browseCatalogSession,
  clearSessionPads,
  createChatInRepo,
  createNewChat,
  forkChat,
  listAndHydrateSessions,
} from './sessionActions';

function order(entries: readonly SessionIndexEntry[]): SessionIndexEntry[] {
  return [...entries].sort(
    (a, b) =>
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')) ||
      a.id.localeCompare(b.id),
  );
}

function rowKey(repoPath: string | undefined, id: string): string {
  const repo = repoPath ?? '';
  return `${repo.length}:${repo}${id}`;
}

function parseRowKey(key: string): { id: string; repoPath?: string } {
  const firstColon = key.indexOf(':');
  if (firstColon < 0) return { id: key };
  const len = Number(key.slice(0, firstColon));
  const rest = key.slice(firstColon + 1);
  const repo = rest.slice(0, len);
  const id = rest.slice(len);
  return { id, repoPath: repo || undefined };
}

function sessionTitle(entry: SessionIndexEntry): string {
  return entry.title?.trim() ? entry.title : entry.id;
}

function repoLabel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Sessions that were in-flight when the reader switched away. */
const backgroundWorking = new Set<string>();

/*
 * THE PER-SECTION "+" — start a chat where you are looking.
 *
 * Owner walk 2026-09-17: "there should be a start-chat button near each folder
 * workspace so you can start a chat in that workspace." The rail head's New
 * Chat has only ever meant the ACTIVE root, so a reader looking at ml-harness
 * had to attach it first to start a thread in it.
 *
 * ABSOLUTELY POSITIONED rather than laid out next to the header: the header is
 * a full-width `<button>` (collapse/expand) and a button cannot contain
 * another one, while wrapping it in a flex row would re-layout a control that
 * is already correct. The section box is the positioning context.
 *
 * The hover colour is STATE rather than a `:hover` rule because `v3.css` is
 * another lane's file this round — `.v3-rail-section-new` is on the element so
 * a rule there can take over and this can go, and until then the control is
 * not left without the affordance every other rail glyph has.
 */

function SectionNewChat({
  label,
  testId,
  onStart,
}: {
  label: string;
  testId: string;
  onStart: () => void;
}) {
  /* Styled by `.v3-rail-section-new` in v3.css (quiet ink, accent on hover
     and focus) — the rule the test reads. */
  return (
    <button
      type="button"
      className="v3-rail-section-new"
      data-testid={testId}
      title={`New chat in ${label}`}
      aria-label={`New chat in ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        onStart();
      }}
    >
      <Icon name="plus" size={12} />
    </button>
  );
}


export interface V3SessionsRailProps {
  client?: SessionsClient;
  onOpenProject?: (repoPath: string, sessionId: string) => void;
  onOpenSettings?: () => void;
  /** Traffic lights only when the shell is on macOS (Decision 23). */
  showTraffic?: boolean;
}

export function V3SessionsRail({
  client = createSessionsClient(),
  onOpenProject,
  onOpenSettings,
  showTraffic = false,
}: V3SessionsRailProps) {
  const store = useStore();
  const state = useAppState();
  const attachedRepoPath = groundedRepoRoot(state);
  const [repoSections, setRepoSections] = useState<readonly RepoSessionsSection[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pickMode, setPickMode] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const prevActiveRef = useRef<string | null>(null);
  const live = useRef(true);

  const loadCatalog = useCallback(async (signal?: AbortSignal) => {
    const answer = await client.list(signal);
    if (!live.current) return;
    if (answer.outcome === 'ok') {
      setRepoSections(answer.body.repos ?? []);
    }
  }, [client]);

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    void listAndHydrateSessions(store, client, controller.signal);
    void loadCatalog(controller.signal);
    return () => {
      live.current = false;
      controller.abort();
    };
  }, [store, client, loadCatalog, attachedRepoPath]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function onDocClick() {
      setMenuKey(null);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const generalRows = order(state.session.sessions);
  const activeId = state.session.activeId;
  const inFlight = state.session.inFlight;

  useEffect(() => {
    const prev = prevActiveRef.current;
    if (prev && prev !== activeId && inFlight) {
      backgroundWorking.add(prev);
    }
    prevActiveRef.current = activeId;
    if (!inFlight && activeId) {
      backgroundWorking.delete(activeId);
    }
  }, [activeId, inFlight]);

  const sectionsToRender = repoSections
    .filter((section) => {
      if (!attachedRepoPath) return true;
      const a = attachedRepoPath.replace(/\\/g, '/').toLowerCase();
      const b = section.path.replace(/\\/g, '/').toLowerCase();
      return a !== b;
    })
    .map((section) => ({ section, rows: order(section.index.sessions) }))
    .filter((entry) => entry.rows.length > 0);

  async function onNewChat() {
    await createNewChat(store, client, attachedRepoPath ? 'code' : 'work');
    void loadCatalog();
  }

  async function onNewChatInRepo(repoPath: string) {
    await createChatInRepo(store, repoPath, client, 'code');
    void loadCatalog();
  }

  async function onForkChat(entry: SessionIndexEntry, repoPath?: string) {
    setMenuKey(null);
    /* Fork only on the active sessions root for now (workspace or attached). */
    if (repoPath) {
      /* Soft catalog fork would need repoPath on POST — keep Fork for home/attached. */
      await forkChat(store, entry.id, client, 'code');
    } else {
      await forkChat(store, entry.id, client, attachedRepoPath ? 'code' : 'work');
    }
    void loadCatalog();
  }

  async function onGeneralClick(sessionId: string) {
    await activateSession(store, sessionId, client);
  }

  async function onCatalogClick(repoPath: string, sessionId: string) {
    /* Soft switch — hydrate chat/surfaces without attach/reload. Open project
       (rail foot / attach dialog) still hard-attaches. */
    await browseCatalogSession(store, repoPath, sessionId, client);
  }

  async function pinSession(entry: SessionIndexEntry, repoPath?: string) {
    const next = !entry.pinned;
    await client.update(entry.id, { pinned: next }, repoPath);
    await listAndHydrateSessions(store, client);
    void loadCatalog();
    setMenuKey(null);
  }

  async function deleteSession(entry: SessionIndexEntry, repoPath?: string) {
    if (!window.confirm(`Delete chat “${sessionTitle(entry)}”?`)) return;
    await client.remove(entry.id, repoPath);
    clearSessionPads(entry.id);
    await listAndHydrateSessions(store, client);
    void loadCatalog();
    setMenuKey(null);
  }

  async function deletePicked() {
    const keys = [...picked];
    if (keys.length === 0) return;
    if (!window.confirm(`Delete ${keys.length} chat${keys.length === 1 ? '' : 's'}?`)) return;
    for (const key of keys) {
      const { id, repoPath } = parseRowKey(key);
      await client.remove(id, repoPath);
      clearSessionPads(id);
      backgroundWorking.delete(id);
    }
    setPicked(new Set());
    setPickMode(false);
    await listAndHydrateSessions(store, client);
    void loadCatalog();
  }

  function togglePick(key: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function sessionWorking(entry: SessionIndexEntry): boolean {
    if (entry.id === activeId && inFlight) return true;
    return backgroundWorking.has(entry.id);
  }

  async function commitRename(entry: SessionIndexEntry, repoPath?: string) {
    const title = renameDraft.trim();
    setRenamingKey(null);
    if (!title || title === sessionTitle(entry)) return;
    await client.update(entry.id, { title }, repoPath);
    await listAndHydrateSessions(store, client);
    void loadCatalog();
  }

  function toggleCollapse(path: string) {
    setCollapsed((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  function renderRow(entry: SessionIndexEntry, repoPath?: string) {
    const key = rowKey(repoPath, entry.id);
    /* Soft-browsing a catalog chat must NOT light a Workspace row that happens
       to share an id, and must not make Workspace look like the home of a
       foreign thread (owner walk 2026-09-16). */
    const browsing = state.session.browseRepoPath;
    const loaded = repoPath
      ? entry.id === activeId && browsing === repoPath
      : entry.id === activeId && !browsing;
    const renaming = renamingKey === key;
    const isPicked = picked.has(key);
    const working = sessionWorking(entry);
    const when = sessionWhenLabel(entry.updatedAt, now);

    return (
      <div
        key={key}
        className={[
          'v3-session',
          loaded ? 'is-loaded' : '',
          isPicked ? 'is-picked' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-pinned={entry.pinned ? 'true' : 'false'}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if (renaming) return;
          if (pickMode || e.ctrlKey || e.metaKey) {
            e.preventDefault();
            togglePick(key);
            return;
          }
          setPicked(new Set());
          if (repoPath) void onCatalogClick(repoPath, entry.id);
          else void onGeneralClick(entry.id);
        }}
        onKeyDown={(e) => {
          if (renaming) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (pickMode) {
              togglePick(key);
              return;
            }
            if (repoPath) void onCatalogClick(repoPath, entry.id);
            else void onGeneralClick(entry.id);
          }
        }}
      >
        {pickMode ? (
          <input
            type="checkbox"
            className="v3-session-pick"
            data-testid="v3-session-pick"
            checked={isPicked}
            aria-label={`Select ${sessionTitle(entry)}`}
            onClick={(e) => e.stopPropagation()}
            onChange={() => togglePick(key)}
          />
        ) : null}
        <button
          type="button"
          className="v3-pin"
          title={entry.pinned ? 'Unpin' : 'Pin'}
          aria-label={entry.pinned ? 'Unpin chat' : 'Pin chat'}
          onClick={(e) => {
            e.stopPropagation();
            void pinSession(entry, repoPath);
          }}
        >
          <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" width="12" height="12">
            <path
              d={
                entry.pinned
                  ? 'M6 1l1.5 3 3.3.5-2.4 2.3.6 3.2L6 8.5 3 10l.6-3.2L1.2 4.5 4.5 4 6 1z'
                  : 'M6 1.5l1.2 2.4 2.7.4-2 1.9.5 2.7L6 7.8 3.6 8.9l.5-2.7-2-1.9 2.7-.4L6 1.5z'
              }
              opacity={entry.pinned ? 1 : 0.4}
            />
          </svg>
        </button>
        {renaming ? (
          <input
            className="v3-session-rename"
            value={renameDraft}
            autoFocus
            aria-label="Rename chat"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => void commitRename(entry, repoPath)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitRename(entry, repoPath);
              }
              if (e.key === 'Escape') setRenamingKey(null);
            }}
          />
        ) : (
          <span className="v3-session-title">{sessionTitle(entry)}</span>
        )}
        {working ? (
          <span className="v3-session-working" data-testid="v3-session-working" title="Working" aria-label="Working" />
        ) : null}
        {when ? <span className="v3-time">{when}</span> : null}
        <div className="v3-session-menu">
          <button
            type="button"
            className="v3-session-more"
            aria-label="Chat actions"
            title="Chat actions"
            onClick={(e) => {
              e.stopPropagation();
              setMenuKey(menuKey === key ? null : key);
            }}
          >
            ···
          </button>
          {menuKey === key ? (
            <div className="v3-session-menu-pop" role="menu" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setRenamingKey(key);
                  setRenameDraft(sessionTitle(entry));
                  setMenuKey(null);
                }}
              >
                Rename
              </button>
              <button type="button" role="menuitem" onClick={() => void pinSession(entry, repoPath)}>
                {entry.pinned ? 'Unpin' : 'Pin'}
              </button>
              {!repoPath ? (
                <button
                  type="button"
                  role="menuitem"
                  data-testid="v3-session-fork"
                  onClick={() => void onForkChat(entry, repoPath)}
                >
                  Fork
                </button>
              ) : null}
              {repoPath && onOpenProject ? (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuKey(null);
                    onOpenProject(repoPath, entry.id);
                  }}
                >
                  Open project
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={() => void deleteSession(entry, repoPath)}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <aside className="v3-rail" aria-label="Sessions">
      <div className="v3-rail-head">
        {showTraffic ? (
          <div className="v3-traffic" aria-hidden="true">
            <span className="v3-tl v3-tl-close" />
            <span className="v3-tl v3-tl-min" />
            <span className="v3-tl v3-tl-max" />
          </div>
        ) : null}
        <button type="button" className="v3-door-new" onClick={() => void onNewChat()}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
          New Chat
        </button>
        <button
          type="button"
          className={`v3-rail-pick-toggle${pickMode ? ' is-on' : ''}`}
          data-testid="v3-rail-pick-toggle"
          aria-pressed={pickMode}
          title="Select chats"
          onClick={() => {
            setPickMode((v) => !v);
            if (pickMode) setPicked(new Set());
          }}
        >
          <Icon name="check" size={12} />
          Select
        </button>
      </div>
      <div className="v3-rail-scroll">
        <div
          className={`v3-rail-section${collapsed['__general'] ? ' is-collapsed' : ''}`}
         
        >
          <button
            type="button"
            className="v3-rail-section-label"
            onClick={() => toggleCollapse('__general')}
            aria-expanded={!collapsed['__general']}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 4.5h4l1.5 1.5H13v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
            </svg>
            Workspace
          </button>
          <SectionNewChat
            label="Workspace"
            testId="v3-rail-section-new-workspace"
            onStart={() => void onNewChat()}
          />
          <div className="v3-rail-section-body">{generalRows.map((entry) => renderRow(entry))}</div>
        </div>

        {sectionsToRender.map(({ section, rows }) => (
          <div
            key={section.path}
            className={`v3-rail-section${collapsed[section.path] ? ' is-collapsed' : ''}`}
          >
            <button
              type="button"
              className="v3-rail-section-label"
              onClick={() => toggleCollapse(section.path)}
              aria-expanded={!collapsed[section.path]}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M3 4.5h4l1.5 1.5H13v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
              </svg>
              {repoLabel(section.path)}
            </button>
            <SectionNewChat
              label={repoLabel(section.path)}
              testId={`v3-rail-section-new-${repoLabel(section.path)}`}
              onStart={() => void onNewChatInRepo(section.path)}
            />
            <div className="v3-rail-section-body">{rows.map((entry) => renderRow(entry, section.path))}</div>
          </div>
        ))}
      </div>

      {picked.size > 0 ? (
        <div className="v3-selection-bar" data-testid="v3-selection-bar">
          <span>{picked.size} selected</span>
          <button
            type="button"
            className="v3-selection-delete"
            data-testid="v3-selection-delete"
            onClick={() => void deletePicked()}
          >
            Delete {picked.size}
          </button>
          <button
            type="button"
            className="v3-selection-clear"
            onClick={() => setPicked(new Set())}
          >
            Clear
          </button>
        </div>
      ) : null}

      <div className="v3-rail-foot">
        <button
          type="button"
          className="v3-rail-foot-btn"
          data-testid="v3-rail-open-project"
          aria-label="Open repository"
          onClick={() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } })}
        >
          <Icon name="folder" size={14} />
          Open project
        </button>
        <button
          type="button"
          className="v3-rail-foot-btn"
          data-testid="v3-rail-settings"
          onClick={onOpenSettings}
        >
          <Icon name="gear" size={14} />
          Settings
        </button>
      </div>
    </aside>
  );
}
