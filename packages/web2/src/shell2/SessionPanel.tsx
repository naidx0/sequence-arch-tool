/* ══════════════════════════════════════════════════════════════════════════
   THE SESSION PANEL (Decision 49; round 7, B5) — uiarc.dev's panel, the only sidebar
   packages/web2/src/shell2/SessionPanel.tsx

   Round 7 (Jaden: "Top left... It should just be Sequence, and then the
   workspaces and the projects are on the side rail." "It should show all
   your projects, like in Codex."): the title row reads Sequence (the mark and
   the name), then the solid oval New chat, then Projects (every project the
   reader opened, the current one marked and first, one click to switch, each
   one's chats under it, collapsible; the home workspace is one of them), then
   Worktrees as before. Settings sits at the foot.
   Data and actions are the old rail's: one `GET /api/sessions` read per root
   (projectList.ts says what each part of the answer is), `activateSession`,
   `createNewChat`, and a project opens in its own repo.
   ══════════════════════════════════════════════════════════════════════════ */

import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import { sessionsClient, type ChatSearchHit, type SessionsClient } from '../sessions/sessionsClient';
import { groundedRepoName, groundedRepoRoot, useAppState, useStore } from '../state/connect';
import { agentRuns } from '../agents/agentRuns';
import { useChatRunMarks, useRailRuns } from '../agents/railRuns';
import { activateSession, clearSessionPads, createNewChat, listAndHydrateSessions, warmRecentSnapshots, warmSnapshot, WARM_HOVER_REST_MS } from '../v3/sessionActions';
import { createSettingsClient, type SkillsView } from '../settings/settingsClient';
import { branchLabel } from '../worktree/worktreeGroups';
import { chatIconFor } from '../chat/chatIcon';
import { openCommandPalette } from '../shell/paletteEvent';
import { paletteHint, shortcutById, shortcutChord } from '../shell/shortcuts';
import { ConfirmDialog } from './ConfirmDialog';
import { S2Icon, type S2IconName } from './icons';
import { RailRow } from './RailRow';
import { SubagentSubRows, SubagentTwist, useSubagentFolds } from './SubagentRows';
import { subagentsOf, revealSubagent } from '../agents/subagents';
import { activityMs, liveWorktree } from './sessionGroups';
import { useMenuKeys } from './menuKeys';
import { HOME_KEY, buildProjects, capChats, chatCountLabel, moveWorkspace, orderWorkspaces, workspaceKey, worktreeChats, type ProjectNode } from './projectList';

import './workspacesRail.css';

/* Loaded when the Workspaces header's import button is pressed; the sidebar asks the server nothing about it at boot. */
const ImportHistory = lazy(() => import('./ImportHistory'));

const ID_DERIVED_TITLE = /^session[ -]\d+[\w-]*$/i;

function sessionTitle(entry: SessionIndexEntry): string {
  const written = entry.title?.trim();
  if (!written) return 'New chat';
  if (!entry.titleEdited && ID_DERIVED_TITLE.test(written)) return 'New chat';
  return written;
}

/**
 * The agent a chat talks to (round 8: a row's icon says what the chat is): the
 * live run's agent, else the agent the chat kept a thread with on disk
 * (`agentThreads`, keyed by agent). Null for a Sequence chat.
 */
export function chatAgent(entry: SessionIndexEntry, live: Readonly<Record<string, string>> | undefined): string | null {
  const kept = Object.keys((entry as SessionIndexEntry & { agentThreads?: Record<string, unknown> }).agentThreads ?? {});
  return live?.[entry.id] ?? kept[0] ?? null;
}

/**
 * A chat row's glyph: its worktree's branch, else its brand (round 9,
 * chat/chatIcon.tsx): Claude, Codex or Sequence, never a generic bubble.
 */
export function ChatGlyph({ entry, agent, model }: { entry: SessionIndexEntry; agent: string | null; model?: string | null }) {
  if (liveWorktree(entry)) return <S2Icon name="branch" small />;
  return <>{chatIconFor(entry, { agents: agent ? { [entry.id]: agent } : undefined, model: model ?? null })}</>;
}

const ADD_MENU_KEY = 'workspaces|add';
const projectMenuKey = (p: ProjectNode): string => `project|${workspaceKey(p)}`;

const samePath = (a: string) => a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** A project row's glyph (round 12): the folder, for the workspace and every project; a worktree adds the branch badge. */
export function projectGlyph(p: ProjectNode, branch: string | null, worktreePaths: ReadonlySet<string>): { icon: S2IconName; worktree: boolean } {
  const worktree = p.path !== null && worktreePaths.has(samePath(p.path));
  /* Round 12: one glyph for every project, the workspace and an opened repository alike (the book beside the
     folder read as two kinds of thing, and drew at different optical sizes). A worktree keeps its branch badge. */
  void branch;
  return { icon: 'folder', worktree };
}

/** Which projects the reader has folded or unfolded; the current one starts open, the rest folded. */
const FOLD_KEY = 's2.projectsOpen';

function readFolds(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FOLD_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeFolds(folds: Record<string, boolean>): void {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify(folds));
  } catch {
    /* the fold still holds for this session */
  }
}

/** The order the reader met the workspaces in (projectList.orderWorkspaces). */
const ORDER_KEY = 's2.workspaceOrder';
/** The workspace the engine was on when the rail was last drawn. */
const LANDED_KEY = 's2.workspaceLanded';

function readOrder(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null') as unknown;
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeOrder(order: readonly string[]): void {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  } catch {
    /* the order still holds for this session */
  }
}

/* ── the sections (round 9, DeepSeek's sidebar) ─────────────────────────
   Jaden: "follow DeepSeek: the harness name at top, then the folders you're
   working in, chats, skills and so on. Everything transparent, scrollable
   and animated." Projects, Chats and Skills are sections of one scroller;
   each header folds its section (remembered), and the fold animates. */
export type PanelSection = 'messages' | 'pinned' | 'workspaces' | 'projects' | 'chats' | 'skills' | 'worktrees';
const SECTIONS_KEY = 's2.sections';

export function readSectionFolds(): Partial<Record<PanelSection, boolean>> {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Record<PanelSection, boolean>>) : {};
  } catch {
    return {};
  }
}

function writeSectionFolds(folds: Partial<Record<PanelSection, boolean>>): void {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(folds));
  } catch {
    /* the fold still holds for this session */
  }
}

/** One foldable section: a quiet header (its name, a count, its own action) over its rows. */
function PanelGroup({
  id,
  label,
  count,
  folded,
  onFold,
  action,
  children,
}: {
  id: PanelSection;
  label: string;
  count?: number;
  folded: boolean;
  onFold: () => void;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="s2-grp s2-sec" data-testid={`s2-group-${id}`} data-folded={folded ? 'true' : undefined} role="group" aria-label={label}>
      <div className="s2-gh">
        <button
          type="button"
          className="s2-sec-h"
          aria-expanded={!folded}
          aria-controls={`s2-sec-${id}`}
          data-testid={`s2-section-${id}`}
          onClick={onFold}
        >
          <span className="s2-sec-chev" aria-hidden="true">
            <S2Icon name="chev" small />
          </span>
          <span className="s2-grow">{label}</span>
          {count !== undefined && count > 0 ? <span className="s2-meta s2-mono">{count}</span> : null}
        </button>
        {action}
      </div>
      <div className="s2-sec-body" id={`s2-sec-${id}`} aria-hidden={folded ? 'true' : undefined} {...(folded ? { inert: '' } : {})}>
        <div className="s2-sec-in">{children}</div>
      </div>
    </div>
  );
}

/** Where a row menu opens: its anchor point, and the edge it hangs from. */
interface MenuAt {
  x: number;
  /** Below the anchor (a button's bottom, or the pointer). */
  y: number;
  /** Above the anchor, for when there is no room below. */
  yAbove: number;
  align: 'right' | 'left';
  /** A row menu opens BESIDE its row: `x` is the row's right edge, `xLeft` its left edge (where it flips to), `y` the row's top, `yAbove` its bottom. */
  beside?: { xLeft: number; /** Where it hangs when neither side has room: below the button, right edges together. */ below: { x: number; y: number; yAbove: number } };
  host: Element;
  /** What the menu hangs from: a scroll of anything that holds it takes the menu with it. */
  anchor: Element | null;
}

/**
 * A row menu, drawn above the scroller. The sections clip their rows (the fold animates by clipping), so a menu
 * drawn inside the row was cut off by the section's edge; it is fixed to the window and placed from its anchor,
 * flipped above or pulled in so the whole menu is always on screen.
 */
function FloatingMenu({ at, menuRef, label, children }: { at: MenuAt; menuRef: RefObject<HTMLDivElement>; label: string; children: ReactNode }) {
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const room = 8;
    let left = at.align === 'right' ? at.x - box.width : at.x;
    let top = at.y;
    if (top + box.height > window.innerHeight - room) top = Math.max(room, at.yAbove - box.height);
    if (at.beside) {
      /* To the right of the row (over the chat column is fine); no room there, to its left. */
      left = at.x + BESIDE_GAP;
      if (left + box.width > window.innerWidth - room) left = at.beside.xLeft - BESIDE_GAP - box.width;
      if (left < room) {
        /* No room on either side (a narrow window): below the button, never over its own row. */
        left = at.beside.below.x - box.width;
        top = at.beside.below.y;
        if (top + box.height > window.innerHeight - room) top = Math.max(room, at.beside.below.yAbove - box.height);
      }
    }
    if (left + box.width > window.innerWidth - room) left = window.innerWidth - room - box.width;
    setPos({ left: Math.max(room, left), top });
  }, [at, menuRef]);
  return createPortal(
    <div ref={menuRef} className="s2-menu s2-menu-row" role="menu" aria-label={label} style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>,
    at.host,
  );
}

const BESIDE_GAP = 4;

/** A chat row's menu anchor: beside the row it belongs to, its top aligned with the row's top. */
function anchorBeside(button: HTMLElement): MenuAt {
  const row = button.closest('.s2-rail-row') ?? button;
  const r = row.getBoundingClientRect();
  const b = button.getBoundingClientRect();
  return { x: r.right, y: r.top, yAbove: r.bottom, align: 'left', beside: { xLeft: r.left, below: { x: b.right, y: b.bottom + 4, yAbove: b.top - 4 } }, host: button.closest('.s2') ?? document.body, anchor: button };
}

export interface SessionPanelProps {
  client?: SessionsClient;
  /** Where the Skills section reads `.sequence/skills` (GET /api/skills). */
  skillsSource?: () => Promise<SkillsView | null>;
  onOpenProject?: (repoPath: string, sessionId: string) => void;
  onOpenWorkspace?: (sessionId: string) => void;
  onOpenSettings?: () => void;
  /** The title row's collapse button (Mod+B does the same). */
  onCollapse?: () => void;
  /** The shell's failed-open notice: while it is set the sidebar is no longer opening anything, so a click may try again. */
  openFailure?: unknown;
}

const defaultSkills = async (): Promise<SkillsView | null> => {
  const answer = await createSettingsClient().skills();
  return answer.outcome === 'ok' ? answer.body : null;
};

export function SessionPanel({ client = sessionsClient, skillsSource = defaultSkills, onOpenProject, onOpenWorkspace, onOpenSettings, onCollapse, openFailure }: SessionPanelProps) {
  const store = useStore();
  const state = useAppState();
  const repoPath = groundedRepoRoot(state);
  const [repos, setRepos] = useState<readonly RepoSessionsSection[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [chatNote, setChatNote] = useState<{ kind: 'error' | 'setup'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null);
  /* Only one of the panel's menus is open at a time; this is it. */
  const menuRef = useRef<HTMLDivElement | null>(null);
  useMenuKeys(menu !== null, menuRef, () => setMenu(null));
  const [deleting, setDeleting] = useState<{ entry: SessionIndexEntry; repoPath?: string } | null>(null);
  /* The project the reader asked to take off the sidebar's list (right-click, or Shift+F10 / the menu key). */
  const [removing, setRemoving] = useState<ProjectNode | null>(null);
  /* The workspace being opened across a reload, so the click is seen to have landed. */
  const [switching, setSwitching] = useState<{ key: string; name: string; id: string } | null>(null);
  useEffect(() => {
    if (openFailure) setSwitching(null);
  }, [openFailure]);
  useEffect(() => {
    if (!switching) return undefined;
    const t = window.setTimeout(() => setSwitching(null), 10_000);
    return () => window.clearTimeout(t);
  }, [switching]);
  const [order, setOrder] = useState<string[]>(() => readOrder());
  /* A folder being dragged: which one, and the folder it would land before (null: last). */
  const [drag, setDrag] = useState<{ key: string; before: string | null } | null>(null);
  /* Where a keyboard move left focus, and what to tell a screen reader about it. */
  const refocus = useRef<string | null>(null);
  const [moved, setMoved] = useState('');
  const justDragged = useRef(false);
  const [folds, setFolds] = useState<Record<string, boolean>>(() => readFolds());
  const [sections, setSections] = useState(() => readSectionFolds());
  const foldSection = (id: PanelSection) =>
    setSections((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeSectionFolds(next);
      return next;
    });
  const [importing, setImporting] = useState(false);
  /* A chat's load in flight, and chats whose last open failed (an optimistic switch set activeId, so the row must stay clickable to retry). */
  const openingId = useRef<string | null>(null);
  const openFailed = useRef<Set<string>>(new Set());
  /* Projects whose whole chat list the reader asked for ("Show all N"); the rest list their newest ten. */
  const [allShown, setAllShown] = useState<ReadonlySet<string>>(new Set());
  /* Chats whose last agent turn a restart cut off: a dot on the row. */
  const [cut, setCut] = useState<ReadonlySet<string>>(new Set());
  const [skills, setSkills] = useState<SkillsView | null>(null);
  const live = useRef(true);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRest = () => {
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = null;
  };
  /* The ONE hover read-ahead: a pointer resting WARM_HOVER_REST_MS on a chat in the workspace being read warms its
     snapshot; sweeping past reads nothing. Another workspace's row reloads the page, so there is nothing to warm. */
  const warmOnRest = (id: string) => {
    stopRest();
    restTimer.current = setTimeout(() => warmSnapshot(store, id, client), WARM_HOVER_REST_MS);
  };
  useEffect(() => stopRest, []);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const answer = await listAndHydrateSessions(store, client, signal);
      if (live.current && answer.outcome === 'ok') {
        setRepos(answer.body.repos ?? []);
        setCut(new Set(answer.body.interrupted ?? []));
        warmRecentSnapshots(store, client);
      }
    },
    [store, client],
  );

  const booted = state.net.reachable !== null;
  useEffect(() => {
    live.current = true;
    const c = new AbortController();
    void refresh(c.signal);
    return () => {
      live.current = false;
      c.abort();
    };
  }, [refresh, repoPath, booted]);

  /* The Skills section: this project's `.sequence/skills` (a repository's; the home workspace has none to read). */
  useEffect(() => {
    if (!repoPath) {
      setSkills(null);
      return undefined;
    }
    let gone = false;
    void skillsSource().then((view) => {
      if (!gone) setSkills(view);
    });
    return () => {
      gone = true;
    };
  }, [repoPath, skillsSource]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    document.addEventListener('click', close);
    /* A menu is fixed to the window: the scroll of whatever holds its anchor (the sidebar) would leave it behind. A
       scroll elsewhere (a streaming transcript) leaves it be. */
    const onScroll = (ev: Event) => {
      const t = ev.target;
      if (t === document || (t instanceof Node && menuAt?.anchor && t.contains(menuAt.anchor))) setMenu(null);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('click', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [menu, menuAt]);

  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  const runs = useRailRuns();
  const [subOpen, toggleSub] = useSubagentFolds();
  const branch = state.session.git.branch?.trim() || null;
  const activeId = state.session.activeId;
  const inFlight = state.session.inFlight;
  /* Every chat's agent run (running, or finished while the reader was elsewhere), not only the open chat's. */
  const runMarks = useChatRunMarks(activeId || null);
  const needle = query.trim().toLowerCase();
  /* Words inside chats: asked of the server once the query is three letters long and has rested for a moment. */
  const [found, setFound] = useState<ChatSearchHit[]>([]);
  const [cutShort, setCutShort] = useState(false);
  useEffect(() => {
    /* Hits belong to the workspace they were found in: a switch (or a new query) drops them at once. */
    setFound([]);
    setCutShort(false);
    if (needle.length < 3 || !client.search) return;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => {
      void client.search!(needle, ctl.signal).then((r) => {
        if (ctl.signal.aborted) return;
        setFound(r.outcome === 'ok' ? r.body.hits : []);
        setCutShort(r.outcome === 'ok' && r.body.truncated);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [needle, client, repoPath]);
  const matches = (e: SessionIndexEntry) =>
    !needle || sessionTitle(e).toLowerCase().includes(needle) || (e.goal ?? '').toLowerCase().includes(needle);
  /* The newest agent run per chat: a run's reply does not stamp the chat's `updatedAt` on the server (only a sent
     message, the plan or the canvas does), so the order also counts when the page last saw the chat's agent work. */
  const runAtMap = new Map<string, number>();
  for (const r of agentRuns.get().runs) {
    if (!r.sessionId || r.restored) continue;
    runAtMap.set(r.sessionId, Math.max(runAtMap.get(r.sessionId) ?? 0, r.endedAt ?? r.startedAt));
  }
  const runAt = (id: string) => runAtMap.get(id) ?? 0;
  const projects = orderWorkspaces(buildProjects({ repoPath, repoName: groundedRepoName(state), sessions: state.session.sessions, repos, runAt }), order);
  const orderSig = projects.map(workspaceKey).join('\n');
  const keysNow = projects.map(workspaceKey);
  const dragRef = useRef({ keys: keysNow, drop: (_key: string, _before: string | null) => {} });

  /** Put the folders in this order for good (and for the next launch). */
  const applyOrder = (next: readonly string[]) => {
    if (next.join('\n') === keysNow.join('\n')) return;
    writeOrder(next);
    setOrder([...next]);
  };
  dragRef.current = { keys: keysNow, drop: (key, before) => applyOrder(moveWorkspace(keysNow, key, before)) };

  /** Hand focus back to the folder that was moved by key, once it is in its new place. */
  useLayoutEffect(() => {
    const key = refocus.current;
    if (!key) return;
    refocus.current = null;
    [...document.querySelectorAll<HTMLElement>('.s2-proj[data-ws-key]')].find((b) => b.dataset.wsKey === key)?.querySelector<HTMLElement>('[data-testid="s2-project-switch"]')?.focus();
  }, [order]);

  /**
   * DRAG A FOLDER (pointer). Press on a folder's row and move: past 4 px it is a drag, the folder under the pointer
   * says where it would land (a line on its edge, drawn over the layout, so nothing moves), and letting go files
   * it there. Escape cancels. The Workspace is not draggable and nothing lands above it (moveWorkspace).
   */
  function startDrag(e: ReactPointerEvent<HTMLElement>, p: ProjectNode) {
    if (e.button !== 0 || p.home) return;
    const key = workspaceKey(p);
    const startY = e.clientY;
    let live = false;
    let before: string | null = null;
    const blocks = () => [...document.querySelectorAll<HTMLElement>('.s2-proj[data-ws-key]')].filter((b) => b.dataset.wsKey !== key);
    const where = (y: number): string | null => {
      for (const b of blocks()) {
        const row = b.querySelector('.s2-proj-row') ?? b;
        const r = row.getBoundingClientRect();
        if (y < r.top + r.height / 2) return b.dataset.wsKey ?? null;
      }
      return null;
    };
    const move = (ev: PointerEvent) => {
      if (!live) {
        if (Math.abs(ev.clientY - startY) < 4) return;
        live = true;
      }
      before = where(ev.clientY);
      /* Nothing lands above the Workspace, so a pointer over its upper half means "right after it": the line is drawn there. */
      if (before === HOME_KEY) {
        const rest = dragRef.current.keys.filter((k) => k !== key);
        before = rest[rest.indexOf(HOME_KEY) + 1] ?? null;
      }
      setDrag({ key, before });
    };
    const end = (ev: Event) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('keydown', esc, true);
      if (!live) return;
      justDragged.current = true;
      window.setTimeout(() => {
        justDragged.current = false;
      }, 60);
      setDrag(null);
      if (ev.type === 'pointerup') dragRef.current.drop(key, before);
    };
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      end(new Event('pointercancel'));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('keydown', esc, true);
  }

  /** The keyboard's way to move a folder: Alt+Up / Alt+Down on its focused row. */
  function moveByKey(p: ProjectNode, dir: -1 | 1) {
    const key = workspaceKey(p);
    const keys = dragRef.current.keys;
    const i = keys.indexOf(key);
    if (i < 0 || p.home) return;
    if (dir < 0 && i === 0) return;
    const before = dir < 0 ? keys[i - 1]! : (keys[i + 2] ?? null);
    const next = moveWorkspace(keys, key, before);
    if (next.join('\n') === keys.join('\n')) return;
    refocus.current = key;
    applyOrder(next);
    setMoved(`${p.name} moved to position ${next.indexOf(key) + 1} of ${next.length}`);
  }
  useEffect(() => {
    const keys = orderSig ? orderSig.split('\n') : [];
    const merged = [...order, ...keys.filter((k) => !order.includes(k))];
    if (merged.length !== order.length) {
      writeOrder(merged);
      setOrder(merged);
    }
  }, [orderSig, order]);

  /* WHAT THE READER SAW STAYS. A folder drawn open because the engine was on it must still be open when the engine
     moves to another one, so the default is written down the first time a folder is drawn; and the folder the
     engine has just moved TO is opened once, so the chat the reader landed on is in view. */
  const currentKey = projects.find((p) => p.current)?.key ?? '';
  const foldSig = projects.map((p) => `${workspaceKey(p)}=${p.current ? 1 : 0}`).join('\n');
  useEffect(() => {
    if (!foldSig) return;
    setFolds((prev) => {
      const next = { ...prev };
      for (const entry of foldSig.split('\n')) {
        const [key, cur] = entry.split('=') as [string, string];
        if (!(key in next)) next[key] = cur === '1';
      }
      let landed = '';
      try {
        landed = localStorage.getItem(LANDED_KEY) ?? '';
      } catch {
        /* no storage */
      }
      const now = foldSig.split('\n').find((e) => e.endsWith('=1'))?.split('=')[0] ?? '';
      if (now && landed !== currentKey) {
        next[now] = true;
        try {
          localStorage.setItem(LANDED_KEY, currentKey);
        } catch {
          /* no storage */
        }
      }
      if (JSON.stringify(next) === JSON.stringify(prev)) return prev;
      writeFolds(next);
      return next;
    });
  }, [foldSig, currentKey]);
  /* PINNED, AT THE VERY TOP, FROM EVERY PROJECT (owner, 0.1.6). A pinned chat is drawn here AND stays in its own
     project (or Worktrees): the same chat, one id, two rows ("Pinned doesn't have to leave the project"). Each row keeps
     its own project (chatRow(p, ...)), so opening, deleting and unpinning go to the folder the chat is in, exactly as
     they do from the project's own list; Unpin takes it out of this group only. Newest activity first. */
  const pinnedRows = projects
    .flatMap((p) => [...p.chats, ...(p.current ? worktreeChats(state.session.sessions, runAt) : [])].filter((e) => e.pinned && matches(e)).map((entry) => ({ p, entry })))
    .sort((a, b) => activityMs(b.entry, b.p.current ? runAt(b.entry.id) : 0) - activityMs(a.entry, a.p.current ? runAt(a.entry.id) : 0) || a.entry.id.localeCompare(b.entry.id));
  const worktrees = worktreeChats(state.session.sessions, runAt).filter(matches);

  /* Every workspace folds on its own; the one the engine is on starts open, and what the reader does is remembered per folder. */
  const isOpen = (p: ProjectNode) => (needle ? true : folds[workspaceKey(p)] ?? p.current);
  const toggle = (p: ProjectNode) => {
    setFolds((prev) => {
      const next = { ...prev, [workspaceKey(p)]: !(prev[workspaceKey(p)] ?? p.current) };
      writeFolds(next);
      return next;
    });
  };

  /** The workspace the open chat is in: the one browsed softly, else the one the engine is on. */
  const browsing = state.session.browseRepoPath;
  const openWorkspaceNode = (browsing ? projects.find((p) => p.path !== null && samePath(p.path) === samePath(browsing)) : undefined) ?? projects.find((p) => p.current);

  /** New chat in a workspace: the open one's own, or a folder's "+". Another workspace's is made there, then opened there. */
  async function newChatIn(p: ProjectNode | undefined, inWorktree = false) {
    if (!p || p.current) return newChat(inWorktree);
    if (creating || !p.section) return;
    setCreating(true);
    setChatNote(null);
    try {
      const made = await client.create(p.home ? 'work' : 'code', p.section.path);
      if (made.outcome !== 'ok') setChatNote({ kind: 'error', text: made.message });
      else {
        clearSessionPads(made.body.session.id);
        openIn(p, made.body.session.id);
      }
    } catch (error) {
      setChatNote({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setCreating(false);
    }
  }

  async function newChat(inWorktree = false) {
    if (creating) return;
    setCreating(true);
    setChatNote(null);
    try {
      const made = await createNewChat(store, client, repoPath ? 'code' : 'work');
      if (made.outcome === 'error') setChatNote({ kind: 'error', text: made.message });
      else if (inWorktree && repoPath) {
        setChatNote(await (await import('../worktree/newChatWorktree')).startChatWorktree(store, made.sessionId));
      }
    } catch (error) {
      setChatNote({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setCreating(false);
    }
  }

  /** Switch to a project: its own chat when one is named, else its most recent. */
  function openIn(p: ProjectNode, sessionId?: string) {
    setMenu(null);
    const section = p.section;
    if (!section) return;
    const id = sessionId ?? p.chats[0]?.id;
    if (!id) return;
    /* The project is already opening (this chat's twin row was just clicked): one switch, not two. */
    if (switching?.key === workspaceKey(p) && switching.id === id) return;
    setSwitching({ key: workspaceKey(p), name: p.name, id });
    if (section.home && onOpenWorkspace) onOpenWorkspace(id);
    else onOpenProject?.(section.path, id);
  }

  async function pin(entry: SessionIndexEntry, at?: string) {
    setMenu(null);
    await client.update(entry.id, { pinned: !entry.pinned }, at);
    await refresh();
  }

  /** Take a project off Sequence's list. `DELETE /api/recent` edits a list of paths: the folder and its files are never touched. */
  async function removeProject(p: ProjectNode) {
    setRemoving(null);
    if (!p.path) return;
    const done = await client.removeRepo(p.path);
    if (done.outcome !== 'ok') setChatNote({ kind: 'error', text: `Could not remove ${p.name} from the sidebar: ${done.message}` });
    await refresh();
  }

  async function remove(entry: SessionIndexEntry, at?: string) {
    setDeleting(null);
    await client.remove(entry.id, at);
    clearSessionPads(entry.id);
    await refresh();
  }

  /**
   * One chat row, in any workspace. In the workspace the engine is on it
   * activates in place; in another it opens that workspace on that chat (the
   * engine attaches the folder, then the page reloads: V3App.openProject).
   * Pin and delete reach the chat's own folder either way.
   */
  const chatRow = (p: ProjectNode, entry: SessionIndexEntry, nested = true, projectTag = false) => {
    const wt = p.current ? liveWorktree(entry) : null;
    const on = p.current && entry.id === activeId && !browsing;
    const mark = runMarks[entry.id];
    const working = (on && inFlight !== null) || mark === 'running' || mark === 'attention';
    const subs = p.current ? subagentsOf(runs.runs, entry.id) : [];
    const at = p.current ? undefined : p.section?.path;
    /* The pinned row and the project row of one chat are two rows with one id: each owns its menu. */
    const menuKey = `${workspaceKey(p)}|${entry.id}${projectTag ? '|pinned' : ''}`;
    const opening = switching?.key === workspaceKey(p);
    return (
      <Fragment key={menuKey}>
      <RailRow
        depth={nested ? 1 : 0}
        selected={on}
        twist={subs.length ? <SubagentTwist count={subs.length} open={!!subOpen[entry.id]} onToggle={() => toggleSub(entry.id)} title={sessionTitle(entry)} /> : undefined}
        className="s2-it"
        data-testid="s2-session"
        data-session-id={entry.id}
        data-agent-run={mark}
        data-pinned={entry.pinned ? 'true' : undefined}
        data-workspace={p.name}
        data-pinned-group={projectTag ? 'true' : undefined}
        icon={<ChatGlyph entry={entry} agent={chatAgent(entry, runs.agents)} model={on ? state.composer.model.model : null} />}
      >
        <button
          type="button"
          className="s2-it-hit s2-rail-hit"
          aria-current={on ? 'true' : undefined}
          aria-busy={opening ? 'true' : undefined}
          title={projectTag ? `${wt ? branchLabel(wt.branch) : sessionTitle(entry)} (${p.name})` : undefined}
          onPointerEnter={p.current ? () => warmOnRest(entry.id) : undefined}
          onPointerLeave={p.current ? stopRest : undefined}
          onFocus={p.current ? () => warmSnapshot(store, entry.id, client) : undefined}
          onClick={() => {
            if (!p.current) return openIn(p, entry.id);
            /* Already the open chat (this row or its twin in Pinned/the project): nothing to load a second time. */
            if (openingId.current === entry.id) return; /* its twin row was just clicked: that load is under way */
            if (store.getState().session.activeId === entry.id && !store.getState().session.browseRepoPath && !openFailed.current.has(entry.id)) return;
            openingId.current = entry.id;
            void activateSession(store, entry.id, client)
              .then((done) => {
                if (done.outcome === 'ok') openFailed.current.delete(entry.id);
                else openFailed.current.add(entry.id);
              })
              .catch(() => openFailed.current.add(entry.id))
              .finally(() => {
                if (openingId.current === entry.id) openingId.current = null;
              });
          }}
        >
          <span className={`s2-t${working ? ' shimmer-text' : ''}`}>{wt ? branchLabel(wt.branch) : sessionTitle(entry)}</span>
          {entry.pinned && !projectTag ? <S2Icon name="pin" className="s2-pin-mark" /> : null}
          {projectTag ? (
            <span className="s2-meta s2-pin-proj" data-testid="s2-pinned-project" title={p.path ?? 'Local workspace'}>
              {p.name}
            </span>
          ) : null}
          {mark === 'attention' ? (
            <span className="s2-badge" aria-label="Waiting for you" title="Its agent is waiting for your answer." data-testid="s2-attention">
              Needs you
            </span>
          ) : working ? (
            <span className="s2-badge" aria-label="Working">1</span>
          ) : null}
          {mark === 'unseen' && !working ? <span className="s2-proj-dot" role="img" aria-label="Finished, not read yet" title="Its agent finished while you were in another chat." data-testid="s2-unseen" /> : null}
          {wt?.merged && !working ? <span className="s2-mono s2-meta">merged</span> : null}
          {cut.has(entry.id) && !working ? <span className="s2-proj-dot" role="img" aria-label="Interrupted by a restart" title="Interrupted by a restart. Open the chat to continue." data-testid="s2-interrupted" /> : null}
        </button>
        <button
          type="button"
          className="s2-it-more"
          aria-label={`Actions for ${sessionTitle(entry)}`}
          aria-haspopup="menu"
          aria-expanded={menu === menuKey}
          onClick={(e) => {
            e.stopPropagation();
            setMenuAt(anchorBeside(e.currentTarget));
            setMenu(menu === menuKey ? null : menuKey);
          }}
        >
          <S2Icon name="more" small />
        </button>
        {menu === menuKey && menuAt ? (
          <FloatingMenu at={menuAt} menuRef={menuRef} label={`Actions for ${sessionTitle(entry)}`}>
            <button type="button" role="menuitem" className="s2-mi" onClick={() => void pin(entry, at)}>
              <S2Icon name="pin" />
              <span className="s2-mi-d">{entry.pinned ? 'Unpin' : 'Pin'}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="s2-mi s2-mi-danger"
              onClick={() => {
                setMenu(null);
                setDeleting({ entry, ...(at ? { repoPath: at } : {}) });
              }}
            >
              <S2Icon name="trash" />
              <span className="s2-mi-d">Delete</span>
            </button>
          </FloatingMenu>
        ) : null}
      </RailRow>
      {subs.length && subOpen[entry.id] ? (
        <SubagentSubRows
          refs={subs}
          depth={nested ? 2 : 1}
          onPick={(ref) => {
            /* The chat first (when it is not the open one), then the subthread inside it. */
            void (on ? Promise.resolve() : activateSession(store, entry.id, client)).then(() => revealSubagent(ref));
          }}
        />
      ) : null}
      </Fragment>
    );
  };

  /* Where every known chat worktree lives, so a project opened at one wears the branch badge. */
  const worktreePaths = new Set(
    [...state.session.sessions, ...repos.flatMap((r) => r.index.sessions)].flatMap((e) => {
      const wt = liveWorktree(e);
      return wt?.path ? [samePath(wt.path)] : [];
    }),
  );

  /** Which edge of a folder the drop line is drawn on: before the folder it would land ahead of, else after the last one. */
  const dropEdge = (key: string): 'before' | 'after' | undefined => {
    if (!drag) return undefined;
    const settled = moveWorkspace(keysNow, drag.key, drag.before);
    if (settled.join('\n') === keysNow.join('\n')) return undefined;
    if (drag.before === key) return 'before';
    if (drag.before === null && key === keysNow[keysNow.length - 1] && key !== drag.key) return 'after';
    return undefined;
  };

  const anyChat = projects.some((p) => p.chats.some(matches)) || worktrees.length > 0;

  return (
    <aside className="s2-panel" aria-label="Sessions" data-testid="s2-panel">
      <div className="s2-ph">
        {/* Round 8 (Jaden: "remove the icon to keep it simple"): the word alone. */}
        <span className="s2-brandrow" data-testid="s2-brand">
          <span className="s2-ph-name">Sequence</span>
        </span>
        <button
          type="button"
          className="s2-ibtn s2-g"
          aria-label="Search chats"
          title={`Search chats. ${paletteHint()}`}
          aria-pressed={searching}
          data-testid="s2-search-toggle"
          onClick={() => {
            setSearching((v) => !v);
            if (searching) setQuery('');
          }}
        >
          <S2Icon name="search" />
        </button>
        {onCollapse ? (
          <button type="button" className="s2-ibtn s2-g" aria-label="Hide sidebar" title="Hide sidebar" data-testid="s2-sidebar-collapse" onClick={onCollapse}>
            <S2Icon name="sidebar" />
          </button>
        ) : null}
      </div>
      {searching ? (
        <label className="s2-field">
          <S2Icon name="search" small />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search chats"
            aria-label="Search chats"
            data-testid="s2-search"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('');
                setSearching(false);
              }
            }}
          />
        </label>
      ) : null}
      <button type="button" disabled={creating} className="s2-btn s2-solid s2-wide" data-testid="s2-new-chat" onClick={() => void newChatIn(openWorkspaceNode)}>
        <S2Icon name="plus" />
        New chat
      </button>
      <div className="s2-groups" data-testid="s2-groups" data-dragging={drag ? 'true' : undefined}>
        <p className="s2-live-note" role="status" aria-live="polite">
          {moved}
        </p>
        {needle.length >= 3 && (found.length > 0 || cutShort) ? (
          <PanelGroup id="messages" label="In messages (this project)" count={found.length} folded={!!sections.messages} onFold={() => foldSection('messages')}>
            {found.map((hit) => (
              <RailRow key={hit.chatId} className="s2-it" data-testid="s2-hit" data-session-id={hit.chatId}>
                <button type="button" className="s2-it-hit s2-rail-hit" title={hit.snippet} onClick={() => void activateSession(store, hit.chatId, client)}>
                  <span className="s2-t">{hit.title}</span>
                  <span className="s2-meta" data-testid="s2-hit-snippet">{hit.snippet}</span>
                </button>
              </RailRow>
            ))}
            {cutShort ? <p className="s2-empty" data-testid="s2-hits-truncated">Searched the newest chats. Refine the search to look further back.</p> : null}
          </PanelGroup>
        ) : null}
        {pinnedRows.length > 0 ? (
          <PanelGroup id="pinned" label="Pinned" count={chatCountLabel(pinnedRows.length) ?? undefined} folded={!needle && !!sections.pinned} onFold={() => foldSection('pinned')}>
            {pinnedRows.map(({ p, entry }) => chatRow(p, entry, false, true))}
          </PanelGroup>
        ) : null}
        <PanelGroup
          id="workspaces"
          label="Workspaces"
          folded={!needle && !!sections.workspaces}
          onFold={() => foldSection('workspaces')}
          action={
            <>
              {/* ONE + with a menu (owner 0.1.6: "I don't know what this download button is. Don't need."): the import
                  icon is gone from the header, its action is a labelled item here. */}
              <button
                type="button"
                className="s2-ibtn s2-ibtn-xs"
                aria-label="Add to Workspaces"
                title="Open a project or import chats"
                aria-haspopup="menu"
                aria-expanded={menu === ADD_MENU_KEY}
                data-testid="s2-workspaces-add"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuAt(anchorBeside(e.currentTarget));
                  setMenu(menu === ADD_MENU_KEY ? null : ADD_MENU_KEY);
                }}
              >
                <S2Icon name="plus" small />
              </button>
              {menu === ADD_MENU_KEY && menuAt ? (
                <FloatingMenu at={menuAt} menuRef={menuRef} label="Add to Workspaces">
                  <button
                    type="button"
                    role="menuitem"
                    className="s2-mi"
                    data-testid="s2-open-project"
                    onClick={() => {
                      setMenu(null);
                      store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } });
                    }}
                  >
                    <S2Icon name="folder" />
                    <span className="s2-mi-d">Open a project…</span>
                  </button>
                  {repoPath ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="s2-mi"
                      data-testid="s2-import-toggle"
                      title="Import chats from Claude Code or Codex"
                      onClick={() => {
                        setMenu(null);
                        setImporting((v) => !v);
                      }}
                    >
                      <S2Icon name="import" />
                      <span className="s2-mi-d">Import chats…</span>
                    </button>
                  ) : null}
                </FloatingMenu>
              ) : null}
            </>
          }
        >
          {projects.map((p) => {
            const open = isOpen(p);
            const listed = p.chats;
            const matched = listed.filter(matches);
            if (needle && matched.length === 0) return null;
            const { shown: chats, hidden } = capChats(matched, needle !== '' || allShown.has(workspaceKey(p)), p.current && !browsing ? activeId : null);
            const count = chatCountLabel(listed.length);
            const glyph = projectGlyph(p, branch, worktreePaths);
            const opening = switching?.key === workspaceKey(p);
            return (
              <div
                key={workspaceKey(p)}
                className="s2-proj"
                data-testid="s2-project"
                data-ws-key={workspaceKey(p)}
                data-current={p.current ? 'true' : undefined}
                data-open={open ? 'true' : 'false'}
                data-project={p.name}
                data-dragging={drag?.key === workspaceKey(p) ? 'true' : undefined}
                data-drop={dropEdge(workspaceKey(p))}
              >
                <RailRow
                  className="s2-it s2-proj-row s2-ws-row"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuAt({ x: e.clientX, y: e.clientY, yAbove: e.clientY, align: 'left', host: e.currentTarget.closest('.s2') ?? document.body, anchor: e.currentTarget });
                    setMenu(projectMenuKey(p));
                  }}
                  onKeyDown={(e) => {
                    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                      e.preventDefault();
                      moveByKey(p, e.key === 'ArrowUp' ? -1 : 1);
                      return;
                    }
                    /* The keyboard's way to the same menu: Shift+F10, or the context-menu key, on a focused row. */
                    if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
                    e.preventDefault();
                    const hit = e.currentTarget.querySelector<HTMLElement>('.s2-rail-hit') ?? e.currentTarget;
                    const r = hit.getBoundingClientRect();
                    setMenuAt({ x: r.left + 16, y: r.bottom, yAbove: r.top, align: 'left', host: e.currentTarget.closest('.s2') ?? document.body, anchor: e.currentTarget });
                    setMenu(projectMenuKey(p));
                  }}
                  data-glyph={glyph.icon}
                  data-worktree={glyph.worktree ? 'true' : undefined}
                  twist={
                    <button
                      type="button"
                      className="s2-proj-fold"
                      aria-label={`${open ? 'Fold' : 'Unfold'} ${p.name}`}
                      aria-expanded={open}
                      data-testid="s2-project-fold"
                      onClick={() => toggle(p)}
                    >
                      <S2Icon name={open ? 'chev' : 'chevr'} small />
                    </button>
                  }
                  icon={<S2Icon name={glyph.icon} small />}
                  badge={glyph.worktree ? <S2Icon name="branch" small /> : null}
                >
                  {/* A folder: a click opens or closes it. Nothing is chosen, and nothing is attached by looking. */}
                  <button
                    type="button"
                    className="s2-it-hit s2-rail-hit"
                    aria-expanded={open}
                    aria-busy={opening ? 'true' : undefined}
                    title={p.path ?? 'Local workspace'}
                    data-testid="s2-project-switch"
                    aria-keyshortcuts={p.home ? undefined : 'Alt+ArrowUp Alt+ArrowDown'}
                    onPointerDown={(e) => startDrag(e, p)}
                    onClick={() => {
                      if (!justDragged.current) toggle(p);
                    }}
                  >
                    <span className="s2-t">{p.name}</span>
                    {count !== null ? (
                      <span className="s2-meta s2-mono s2-proj-count" data-testid="s2-project-count">
                        {count}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="s2-ws-new"
                    aria-label={`New chat in ${p.name}`}
                    title={`New chat in ${p.name}`}
                    data-testid="s2-project-new"
                    disabled={creating}
                    onClick={(e) => {
                      e.stopPropagation();
                      void newChatIn(p);
                    }}
                  >
                    <S2Icon name="plus" small />
                  </button>
                </RailRow>
                {menu === projectMenuKey(p) && menuAt ? (
                  <FloatingMenu at={menuAt} menuRef={menuRef} label={`Actions for ${p.name}`}>
                    <button
                      type="button"
                      role="menuitem"
                      className="s2-mi"
                      data-testid="s2-project-menu-new"
                      disabled={creating}
                      onClick={() => {
                        setMenu(null);
                        void newChatIn(p);
                      }}
                    >
                      <S2Icon name="plus" />
                      <span className="s2-mi-d">New chat</span>
                    </button>
                    {p.home ? null : p.current ? (
                      <button type="button" role="menuitem" className="s2-mi s2-mi-muted" data-testid="s2-project-menu-remove" disabled title="The open project cannot be taken off the list. Open another project first.">
                        <S2Icon name="x" />
                        <span className="s2-mi-d">
                          Remove from sidebar
                          <span>Open another project first</span>
                        </span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        role="menuitem"
                        className="s2-mi s2-mi-danger"
                        data-testid="s2-project-menu-remove"
                        onClick={() => {
                          setMenu(null);
                          setRemoving(p);
                        }}
                      >
                        <S2Icon name="x" />
                        <span className="s2-mi-d">Remove from sidebar</span>
                      </button>
                    )}
                  </FloatingMenu>
                ) : null}
                {open ? (
                  <div className="s2-proj-chats">
                    {chats.map((e) => chatRow(p, e))}
                    {hidden > 0 ? (
                      <button
                        type="button"
                        className="s2-fold s2-empty s2-empty-nest s2-showall"
                        data-testid="s2-show-all"
                        onClick={() => setAllShown((prev) => new Set(prev).add(workspaceKey(p)))}
                      >
                        Show all {listed.length}
                      </button>
                    ) : null}
                    {chats.length === 0 ? <p className="s2-empty s2-empty-nest">No chats yet</p> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </PanelGroup>
        {importing && repoPath && !needle ? (
          <Suspense fallback={null}>
            <ImportHistory
              onOpened={async (chatId) => {
                await refresh();
                await activateSession(store, chatId, client);
                setImporting(false);
              }}
            />
          </Suspense>
        ) : null}
        {switching ? (
          <p className="s2-switch-note" role="status" data-testid="s2-switching">
            Opening {switching.name}…
          </p>
        ) : null}
        {repoPath || worktrees.length > 0 ? (
          /* Folds like Skills (owner 0.1.5, G5: the section was always open). A search unfolds it, as it does Workspaces. */
          <PanelGroup
            id="worktrees"
            label="Worktrees"
            count={worktrees.length}
            folded={!needle && !!sections.worktrees}
            onFold={() => foldSection('worktrees')}
            action={
              repoPath ? (
                <button type="button" disabled={creating} className="s2-ibtn s2-ibtn-xs" aria-label="New chat in a worktree" onClick={() => void newChat(true)}>
                  <S2Icon name="plus" small />
                </button>
              ) : null
            }
          >
            {worktrees.map((e) => chatRow(projects.find((p) => p.current)!, e, false))}
            {worktrees.length === 0 ? <p className="s2-empty">No worktrees yet</p> : null}
          </PanelGroup>
        ) : null}
        {needle ? null : (
          <PanelGroup id="skills" label="Skills" count={skills?.skills.length ?? 0} folded={!!sections.skills} onFold={() => foldSection('skills')}>
            {(skills?.skills ?? []).map((sk) => (
              <RailRow key={sk.slug} className="s2-it" data-testid="s2-skill" icon={<S2Icon name="bolt" small />} title={sk.description}>
                {/* A skill is used by name: the click puts its command in the composer. */}
                <button
                  type="button"
                  className="s2-it-hit s2-rail-hit"
                  onClick={() => {
                    store.dispatch({ type: 'composer/draft', text: `/${sk.slug} ` });
                    document.querySelector<HTMLTextAreaElement>('[data-testid="s2-chat"] textarea')?.focus();
                  }}
                >
                  <span className="s2-t">{sk.name}</span>
                </button>
              </RailRow>
            ))}
            {(skills?.skills.length ?? 0) === 0 ? (
              <p className="s2-empty" data-testid="s2-skills-empty">
                {repoPath ? 'No skills yet. Add one in .sequence/skills.' : 'Open a project to use its skills.'}
              </p>
            ) : null}
          </PanelGroup>
        )}
        {needle && !anyChat && found.length === 0 ? <p className="s2-empty">No chat matches</p> : null}
        {chatNote ? <p className="s2-empty" data-testid="s2-new-chat-note" role={chatNote.kind === 'error' ? 'alert' : 'status'}>{chatNote.text}</p> : null}
      </div>
      {removing ? (
        <ConfirmDialog
          icon="folder"
          title={`Remove “${removing.name}” from the sidebar?`}
          body="This only takes the project off Sequence's list. The folder and its files on disk are not touched. Open it again any time from Open project."
          confirmLabel="Remove from sidebar"
          testId="s2-confirm-remove-project"
          onConfirm={() => void removeProject(removing)}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          icon="trash"
          danger
          title="Delete this chat?"
          body={`“${sessionTitle(deleting.entry)}” and its transcript are deleted. The files it changed stay as they are.`}
          confirmLabel="Delete"
          testId="s2-confirm-delete"
          onConfirm={() => void remove(deleting.entry, deleting.repoPath)}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
      <div className="s2-panel-foot">
        <button
          type="button"
          className="s2-it s2-it-foot"
          data-testid="v3-rail-open-project"
          aria-label="Open project"
          onClick={() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } })}
        >
          <S2Icon name="folder" />
          <span className="s2-t">Open project</span>
        </button>
        <button type="button" className="s2-it s2-it-foot" data-testid="v3-rail-settings" onClick={onOpenSettings}>
          <S2Icon name="sliders" />
          <span className="s2-t">Settings</span>
        </button>
        <button type="button" className="s2-it s2-it-foot" data-testid="s2-rail-commands" title="Every command, search, review and help" onClick={() => openCommandPalette()}>
          <S2Icon name="bolt" />
          <span className="s2-t">Commands</span>
          <kbd className="s2-kbd">{shortcutChord(shortcutById('palette'))}</kbd>
        </button>
      </div>
    </aside>
  );
}
