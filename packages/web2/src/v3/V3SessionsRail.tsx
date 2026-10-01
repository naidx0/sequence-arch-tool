import { useCallback, useEffect, useRef, useState } from 'react';

import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import { Icon } from '../chat/Icon';
import { sessionWhenLabel } from '../sessions/sessionWhen';
import { sessionsClient, type SessionsClient } from '../sessions/sessionsClient';
import { groundedRepoName, groundedRepoRoot, useAppState, useStore } from '../state/connect';
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

/**
 * What the row is called.
 *
 * ── NEVER AN IDENTIFIER (after Codex) ───────────────────────────────────
 *
 * Codex's picker renders `thread_name ?? preview`: the person's own name for
 * the thread, or the opening words of it, and never the id. Ours fell back to
 * `session 8573` — a fact about our filing system that answers nothing a
 * reader is asking — and the owner's rail was a column of them.
 *
 * The server no longer mints those (`titleFromChat`), but the ones already on
 * his disk are still there, so this recognises the shape and says the same
 * words as a fresh chat would. Only when `titleEdited` is false: a title he
 * typed himself is his, whatever it looks like, and rewriting that would be
 * the surface overruling him.
 *
 * Two untitled chats are told apart by the timestamp beside them, which is how
 * Codex tells them apart too.
 */
const UNTITLED_CHAT = 'New chat';
const ID_DERIVED_TITLE = /^session[ -]\d+[\w-]*$/i;

function sessionTitle(entry: SessionIndexEntry): string {
  const written = entry.title?.trim();
  if (!written) return UNTITLED_CHAT;
  if (!entry.titleEdited && ID_DERIVED_TITLE.test(written)) return UNTITLED_CHAT;
  return written;
}

function repoLabel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * WHAT A SECTION IS CALLED - the server's name, or the path's last segment.
 *
 * `repoLabel` was the only rule, and the server has been sending a `name` the
 * whole time. That was harmless while every section was a repository checkout,
 * where the two agree. It stopped being harmless when the HOME WORKSPACE
 * joined the catalog (owner, 2026-09-21: "where do workspace go?"): its root
 * is the reader's home directory, so a basename gives their USERNAME.
 *
 * A field the wire carries and the client re-derives is a second answer
 * waiting to disagree with the first.
 */
function sectionLabel(section: RepoSessionsSection): string {
  return section.name?.trim() ? section.name : repoLabel(section.path);
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
  /**
   * Open a chat that belongs to the home workspace rather than a repository.
   *
   * SEPARATE FROM `onOpenProject` because the verb is different: that one
   * attaches a folder, and being in the workspace is being attached to
   * nothing. Routing a workspace row through the attach door is what made
   * every one of them unclickable.
   */
  onOpenWorkspace?: (sessionId: string) => void;
  onOpenSettings?: () => void;
  /** Traffic lights only when the shell is on macOS (Decision 23). */
  showTraffic?: boolean;
}

export function V3SessionsRail({
  /* THE SHARED CLIENT, NOT A FRESH ONE PER RENDER. A default parameter is
     re-evaluated on every render, so `createSessionsClient()` here made this
     component's `client` a new object each time and re-ran the mount effect
     below with it. See `sessionsClient.ts`. */
  client = sessionsClient,
  onOpenProject,
  onOpenWorkspace,
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
  /* C3. `dragPath` is the project under the pointer; `overPath` is the one it
     is currently hovering, which is the only thing the drawn order depends on
     — the list is not written until the drop, so an abandoned drag costs
     nothing. `confirmRemove` holds the project whose removal is being
     confirmed, because "delete" is his word for this and a single press is too
     cheap for a word that means something else everywhere else. */
  /*
   * ── ONE RAIL, ALWAYS SHOWING EVERY PROJECT ─────────────────────────────
   *
   * Owner, 2026-09-21, correcting the version before this one:
   *
   *   "side rail should be simple, always show one wide scope of rails. in
   *    these rails you have projects, either started from scratch (project
   *    folder workspace made at runtime there) or started in a project folder
   *    in path from somewhere else like ML-Max or Sequence ... each project
   *    has chats under it that refer to it in specific."
   *
   * THE SCOPE PAIR WAS THE WRONG READING. He had said he was "not a fan of
   * that format", and the format he was looking at was a rail whose sections
   * could not be opened — a stylesheet fault, fixed separately. Codex scopes
   * to one working directory because a terminal has one; this window has a
   * rail, and the rail is where every project lives at once.
   *
   * So there is no filter mode. There is the list, and `query` narrows it.
   * What a project needs is on the project — expand, collapse, reorder,
   * remove, and a "+" that starts a chat in it — and what a chat needs is on
   * the chat: fork, move to another project, rename, delete.
   */
  const [query, setQuery] = useState('');
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [overPath, setOverPath] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  /**
   * ── ONE READ OF `GET /api/sessions`, FEEDING BOTH HALVES OF THE RAIL ─────
   *
   * The response carries `index` (the active root's threads, which go to the
   * store) and `repos` (every catalogued root's, which go in local state).
   * This component wanted both and asked twice: `listAndHydrateSessions` took
   * the first and dropped the rest, then `loadCatalog` fetched the same route
   * again for the half that had just been thrown away.
   *
   * Twice at mount, and twice again after every rename, pin and delete — five
   * more places. Measured at boot on 2026-09-20 before any of this: SEVEN
   * `GET /api/sessions` before the reader had done anything, each one the
   * whole index of every catalogued repo, parsed and discarded.
   *
   * NOT A CACHE. There is no stored answer here and no rule about when it goes
   * stale: every call still reads the server, and the only change is that one
   * response now answers both questions it was always answering.
   */
  /*
   * ── TWO CALLERS, TWO JOBS, ONE READ EACH ────────────────────────────────
   *
   * `refreshSessions` also puts the server's index in the STORE, which moves
   * `activeId`. That is right after a rename, a pin or a delete, where the
   * server's view is the new truth.
   *
   * It is WRONG after a create or a fork. Those have just landed the reader in
   * a freshly minted thread optimistically, and the server's `activeId` is
   * still the previous one for the moment it takes the next request to
   * arrive — so hydrating the index there throws the reader out of the chat
   * they just made and back into the one before it. Found by
   * `railWorkspaceNewChat.test.tsx` when these two were briefly one function:
   * "expected 'session-home' to be 'session-minted'".
   *
   * Both read the route ONCE. The difference is not how much is fetched, it
   * is what is allowed to move afterwards — which is why this is two named
   * functions and not one with a flag: the name is the reason.
   */
  const refreshCatalog = useCallback(
    async (signal?: AbortSignal) => {
      const answer = await client.list(signal);
      if (!live.current) return;
      if (answer.outcome === 'ok') setRepoSections(answer.body.repos ?? []);
    },
    [client],
  );

  const refreshSessions = useCallback(
    async (signal?: AbortSignal) => {
      const answer = await listAndHydrateSessions(store, client, signal);
      if (!live.current) return;
      if (answer.outcome === 'ok') setRepoSections(answer.body.repos ?? []);
    },
    [store, client],
  );

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    void refreshSessions(controller.signal);
    return () => {
      live.current = false;
      controller.abort();
    };
    /* `attachedRepoPath` IS A REAL DEPENDENCY and not churn: the server keys
       this route on the attached root, so a different root is a different
       answer and must be read again. The three runs this effect used to make
       at boot were not that — they were a new `client` object per render. */
  }, [refreshSessions, attachedRepoPath]);

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

  /**
   * ── THE FIRST SECTION IS NOT ALWAYS "Workspace" ────────────────────────
   *
   * Owner, 2026-09-20: "it doesn't import the workspace, it shows on my
   * session workspace still as default."
   *
   * This heading was the word `Workspace`, hard-coded, whatever was attached -
   * while `sectionsToRender` below filters the ATTACHED repo out of the
   * catalogue list, so its chats land in this section. Attach `sequence` and
   * its threads appear under a heading saying Workspace, in a rail whose other
   * headings all name their repo.
   *
   * The heading is the only thing on screen claiming which root a chat belongs
   * to, so for the attached root it was the one label that had to be right and
   * was the one that was wrong.
   *
   * `Workspace` is kept for the case it is true of: nothing attached, chats in
   * the local scratch root. `groundedRepoName` is the repo's own name from the
   * scan; the path's last segment is the fallback for a scan that has not
   * named it yet, never a guess at a different repo.
   */
  const attachedRepoName = groundedRepoName(state);
  const homeLabel = attachedRepoName ?? (attachedRepoPath ? repoLabel(attachedRepoPath) : 'Workspace');
  const homeTitle = attachedRepoPath ?? 'Local workspace - no repository attached';

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

  /*
   * ── A PROJECT HE OPENED IS IN THE RAIL, CHATS OR NO CHATS ──────────────
   *
   * This used to end in `.filter((entry) => entry.rows.length > 0)`, so a
   * project with no threads in it was not drawn at all. That is defensible for
   * a list of CONVERSATIONS and wrong for a list of PROJECTS, which is what he
   * reads this as: "it should add to the side rail."
   *
   * It also made the first minutes after an attach look exactly like the
   * project-loss he reported — open a folder, write nothing in it yet, and the
   * rail shows no sign you ever did. The section carries its own "+" to start
   * the first chat, so an empty one is not an empty gesture; it is the place
   * the first chat comes from.
   */
  /**
   * Does this chat match what has been typed?
   *
   * Codex matches on the preview, the thread's name, its id AND its git
   * branch — `Row::matches_query`. The first three are what a person
   * remembers about a conversation; the branch is what they remember about
   * the work. Ours has no per-row branch yet, so this matches the three it
   * has and says so rather than pretending to a fourth.
   */
  function matchesQuery(entry: SessionIndexEntry, q: string): boolean {
    if (q === '') return true;
    const needle = q.toLowerCase();
    if (entry.title.toLowerCase().includes(needle)) return true;
    if (entry.id.toLowerCase().includes(needle)) return true;
    /* The goal is the person's own sentence about what the chat is for, which
       is at least as memorable as its title. */
    if ((entry.goal ?? '').toLowerCase().includes(needle)) return true;
    return false;
  }

  const sectionsToRender = repoSections
    .filter((section) => {
      if (!attachedRepoPath) return true;
      const a = attachedRepoPath.replace(/\\/g, '/').toLowerCase();
      const b = section.path.replace(/\\/g, '/').toLowerCase();
      return a !== b;
    })
    .map((section) => ({ section, rows: order(section.index.sessions) }));

  /*
   * THE ORDER ON SCREEN WHILE A DRAG IS IN FLIGHT. Nothing is written until
   * the drop, so this is a preview and an abandoned drag is free.
   */
  const draggedOrder = (() => {
    if (!dragPath || !overPath || dragPath === overPath) return sectionsToRender;
    const from = sectionsToRender.findIndex((e) => e.section.path === dragPath);
    const to = sectionsToRender.findIndex((e) => e.section.path === overPath);
    if (from < 0 || to < 0) return sectionsToRender;
    const next = [...sectionsToRender];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  })();

  /**
   * Commit the order on screen.
   *
   * THE BODY IS WHAT THE RAIL CAN SEE, which is never every project — the
   * attached repo is filtered out above, and `readRecent` withholds anything
   * it cannot reach. The server keeps what this does not name (`setRecentOrder`),
   * so those survive a drag that was never about them.
   */
  async function commitOrder(next: typeof sectionsToRender): Promise<void> {
    /* THE HOME WORKSPACE IS NOT IN THE FILE. It is synthesised by the server on
       every read, so naming it in an order is naming a path `recent.json` does
       not contain. `setRecentOrder` ignores unknown paths, so sending it would
       have been harmless and dishonest — a request that says something about a
       project that does not exist. */
    const order = next.filter((e) => !e.section.home).map((e) => e.section.path);
    await client.reorderRepos(order);
    void refreshCatalog();
  }

  /** Take a project out of the list. The folder is not touched. */
  async function removeProject(repoPath: string): Promise<void> {
    setConfirmRemove(null);
    await client.removeRepo(repoPath);
    void refreshCatalog();
  }

  async function onNewChat() {
    await createNewChat(store, client, attachedRepoPath ? 'code' : 'work');
    /* CATALOG ONLY: the new thread is already active here, optimistically. */
    void refreshCatalog();
  }

  /* THE SAME RULE FOR THE SECTION "+": a chat created in another root is
     opened in that root. Creating one and landing in it softly is the same
     defect as clicking one and landing in it softly - the reader is in a
     thread that belongs to a repo the engine is not attached to. */
  async function onNewChatInRepo(repoPath: string) {
    const made = await createChatInRepo(store, repoPath, client, 'code');
    void refreshCatalog();
    /* Same fork as `onCatalogClick`: a chat created in the home workspace is
       opened by DETACHING, not by attaching a folder that the browse jail
       refuses. The "+" on the Workspace section had the identical fault. */
    if (made.outcome !== 'ok') return;
    if (isHomeSection(repoPath) && onOpenWorkspace) onOpenWorkspace(made.sessionId);
    else if (onOpenProject) onOpenProject(repoPath, made.sessionId);
  }

  /**
   * Where this chat could go — every project except the one holding it.
   *
   * `repoPath` is undefined for a row in the ACTIVE root's section, so its
   * home is the attached repository (or the home workspace when nothing is
   * attached). Comparing against the wrong one would offer a move into the
   * project the chat is already in, which the server refuses — correctly, and
   * after the reader has pressed something that looked like it would work.
   */
  function moveTargets(repoPath?: string): { path: string; label: string }[] {
    const home = repoPath ?? attachedRepoPath ?? '';
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
    return repoSections
      .filter((section) => norm(section.path) !== norm(home))
      .map((section) => ({ path: section.path, label: sectionLabel(section) }));
  }

  /**
   * Move a chat, then re-read.
   *
   * NO OPTIMISTIC MOVE. Every other edit in this rail can be drawn before the
   * server answers because the worst case is a row in the wrong place for a
   * moment. This one writes two projects' indexes and a directory on disk, and
   * drawing a chat as moved before that lands would show it in a place it may
   * never reach.
   */
  async function onMoveChat(entry: SessionIndexEntry, from: string | undefined, to: string) {
    setMenuKey(null);
    const source = from ?? attachedRepoPath;
    if (!source) return;
    const answer = await client.moveChat(entry.id, source, to);
    if (answer.outcome !== 'ok') return;
    void refreshSessions();
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
    void refreshCatalog();
  }

  async function onGeneralClick(sessionId: string) {
    await activateSession(store, sessionId, client);
  }

  /**
   * ── A CHAT IS OPENED IN ITS OWN REPOSITORY, ALWAYS ─────────────────────
   *
   * Owner, 2026-09-20: "every time you switch on the session rail it should
   * switch to that folder ... each chat has a different path. If it doesn't
   * match the path then there's no point of showing it in the session rail.
   * That's a big problem."
   *
   * He is right, and the half he could see was the smaller half. This used to
   * SOFT-BROWSE: read the foreign thread's transcript with `?repoPath=` and
   * paint it, leaving the engine attached to whatever it was attached to
   * before. So the path under the composer did not move, which is what he
   * reported.
   *
   * WHAT HE COULD NOT SEE IS THAT THE ASK DID NOT MOVE EITHER.
   * `/api/ask/stream` carries no `repoPath` - the field does not exist on the
   * route - so the attached root is the only root a question can be answered
   * against. Typing into a soft-browsed thread put ML-Harness's transcript on
   * screen and an answer about `sequence` underneath it, with nothing saying
   * so. A wrong path is a cosmetic defect; a right transcript beside a wrong
   * answer is not.
   *
   * ONE ROOT, ONE TRUTH. Opening the chat attaches its repo, so the path, the
   * graph, the anatomy, the tools and the ask agree because there is only one
   * of them. That costs a reload on a cross-repo switch (`openRepoSession`
   * attaches, activates, and the host re-hydrates) and it buys the property
   * that the rail cannot show you a thread it will not actually answer as.
   *
   * THE FALLBACK IS FOR A HOST THAT CANNOT ATTACH, and only that. Without
   * `onOpenProject` this component has no attach to call - the transport lives
   * in `V3App`. Soft-browse is then the most it can honestly do, and it is not
   * a second way to open a chat: no shipping host mounts the rail without the
   * prop, and the tests that do are reading rows, not sending asks.
   */
  async function onCatalogClick(repoPath: string, sessionId: string) {
    /*
     * THE HOME WORKSPACE IS NOT A REPOSITORY TO OPEN.
     *
     * `onOpenProject` attaches the path first, and the workspace's path is the
     * reader's home directory, which the browse jail refuses by name: "Pick a
     * project folder inside your home directory, not the home directory
     * itself." Every Workspace row was therefore dead — a 400 in the console
     * and nothing at all on screen.
     *
     * Going to the workspace IS detaching, so it has its own door.
     */
    if (isHomeSection(repoPath) && onOpenWorkspace) {
      onOpenWorkspace(sessionId);
      return;
    }
    if (onOpenProject) {
      onOpenProject(repoPath, sessionId);
      return;
    }
    await browseCatalogSession(store, repoPath, sessionId, client);
  }

  /** Is this the synthesised home workspace rather than a folder someone opened? */
  function isHomeSection(repoPath: string): boolean {
    const norm = (v: string) => v.replace(/\\/g, '/').toLowerCase();
    return repoSections.some(
      (section) => section.home === true && norm(section.path) === norm(repoPath),
    );
  }

  async function pinSession(entry: SessionIndexEntry, repoPath?: string) {
    const next = !entry.pinned;
    await client.update(entry.id, { pinned: next }, repoPath);
    await refreshSessions();
    setMenuKey(null);
  }

  async function deleteSession(entry: SessionIndexEntry, repoPath?: string) {
    if (!window.confirm(`Delete chat “${sessionTitle(entry)}”?`)) return;
    await client.remove(entry.id, repoPath);
    clearSessionPads(entry.id);
    await refreshSessions();
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
    await refreshSessions();
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
    await refreshSessions();
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
      >
        {/* NO CONTROL INSIDE A CONTROL. The row used to be a `div[role=button]`
            holding the pin, the actions button and the rename field, which axe
            rates serious (nested-interactive) and which took Enter from every
            one of them: Enter on the pin or on "Chat actions" opened the chat
            instead. The row keeps its mouse click; the keyboard and screen
            reader control is this button, laid over the row with
            `pointer-events: none` so a pointer still lands where it did, and
            sitting beside the other controls rather than around them. */}
        <button
          type="button"
          className="v3-session-hit"
          data-testid="v3-session-hit"
          aria-label={sessionTitle(entry)}
          aria-current={loaded ? 'true' : undefined}
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
        />
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
              {/*
                ── MOVE IT TO ANOTHER PROJECT (owner, 2026-09-21) ───────────
                "from there you can fork chats, move chats, delete chats, etc."

                The ordinary case is a conversation that began in the workspace
                and turned out to be about a repository. Every project except
                the one it is already in is offered; there is nothing to move
                to when that list is empty, so the row is absent rather than
                opening onto nothing.
              */}
              {moveTargets(repoPath).length > 0 ? (
                <div className="v3-session-menu-sub" data-testid="v3-session-move">
                  <span className="v3-session-menu-cap">Move to</span>
                  {moveTargets(repoPath).map((target) => (
                    <button
                      key={target.path}
                      type="button"
                      role="menuitem"
                      data-testid={`v3-session-move-${target.label}`}
                      onClick={() => void onMoveChat(entry, repoPath, target.path)}
                    >
                      {target.label}
                    </button>
                  ))}
                </div>
              ) : null}
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
      {/*
        ── TWO FILTER LAYERS, ONE LIST (Codex's `resume_picker`) ───────────

        "Filtering happens in two layers: 1. Provider, source, and eligible
        working-directory filtering at the backend. 2. Typed search filtering
        over loaded rows in the picker." Ours are the scope control and this
        field — the same two questions, asked in the same order.

        The scope control is a pair, not a checkbox, because the two answers
        are equally ordinary and a checkbox labelled "all" makes one of them
        the exception. It is absent when nothing is attached: with no
        repository there is no project to scope TO, and a toggle whose two
        positions do the same thing is a control that lies.
      */}
      <div className="v3-rail-filters">
        <label className="v3-rail-search">
          <Icon name="search" size={12} />
          <input
            type="search"
            value={query}
            data-testid="v3-rail-search"
            placeholder="Search chats"
            aria-label="Search chats"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="v3-rail-search-clear"
              data-testid="v3-rail-search-clear"
              aria-label="Clear the search"
              onClick={() => setQuery('')}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          ) : null}
        </label>
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
            data-testid="v3-rail-section-home"
            title={homeTitle}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 4.5h4l1.5 1.5H13v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
            </svg>
            {homeLabel}
          </button>
          <SectionNewChat
            label={homeLabel}
            testId="v3-rail-section-new-workspace"
            onStart={() => void onNewChat()}
          />
          <div className="v3-rail-section-body">
            {generalRows
              .filter((entry) => matchesQuery(entry, query))
              .map((entry) => renderRow(entry))}
          </div>
        </div>

        {/*
          ── HIS PROJECTS, IN HIS ORDER, AND HIS TO REMOVE ──────────────────
          Owner, 2026-09-21: "you should be able to move the folder, compress
          the folder ... you can also be able to delete it if you don't want
          to. Like, I just delete the folder, just delete it from that
          workspace."

          Drag reorders and does not write until the drop. Remove takes the
          project out of the list — see the confirm's wording, which is the
          only place a reader is told what the word does not mean.
        */}
        {draggedOrder.map(({ section, rows }) => (
          <div
            key={section.path}
            className={[
              'v3-rail-section',
              collapsed[section.path] ? 'is-collapsed' : '',
              dragPath === section.path ? 'is-dragging' : '',
              dragPath && overPath === section.path && dragPath !== section.path ? 'is-drop-target' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            data-testid={`v3-rail-project-${sectionLabel(section)}`}
            /* The home workspace is synthesised by the server on every read, so
               there is no list entry to move — dragging it would write an order
               naming a path that is not in the file, which `setRecentOrder`
               correctly ignores, leaving a control that does nothing. */
            draggable={!section.home}
            onDragStart={(e) => {
              setDragPath(section.path);
              e.dataTransfer.effectAllowed = 'move';
              /* Firefox refuses to start a drag with no payload. The path is
                 already in component state; this is only the handshake. */
              e.dataTransfer.setData('text/plain', section.path);
            }}
            onDragOver={(e) => {
              if (!dragPath) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOverPath(section.path);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragPath) void commitOrder(draggedOrder);
              setDragPath(null);
              setOverPath(null);
            }}
            onDragEnd={() => {
              /* An abandoned drag writes nothing — the preview simply ends. */
              setDragPath(null);
              setOverPath(null);
            }}
          >
            <button
              type="button"
              className="v3-rail-section-label"
              onClick={() => toggleCollapse(section.path)}
              aria-expanded={!collapsed[section.path]}
              title={section.path}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M3 4.5h4l1.5 1.5H13v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
              </svg>
              {sectionLabel(section)}
            </button>
            <SectionNewChat
              label={sectionLabel(section)}
              testId={`v3-rail-section-new-${sectionLabel(section)}`}
              onStart={() => void onNewChatInRepo(section.path)}
            />
            {/* Quiet until the section is hovered — `.v3-rail-project-remove`
                in v3.css. A control that removes something does not compete
                for attention with the one that opens it.

                NOT ON THE HOME WORKSPACE. It is not a project he opened and
                there is no list entry behind it; the first build of this
                offered him "Remove Workspace from the workspace", which is
                both meaningless and a control that could not have worked. */}
            {section.home ? null : (
            <button
              type="button"
              className="v3-rail-project-remove"
              data-testid={`v3-rail-project-remove-${sectionLabel(section)}`}
              aria-label={`Remove ${sectionLabel(section)} from the workspace`}
              title="Remove from the workspace — the folder stays on disk"
              onClick={() => setConfirmRemove(section.path)}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
            )}
            {confirmRemove === section.path ? (
              /*
               * THE ONE PLACE THE WORD IS EXPLAINED. He says "delete", and the
               * list this edits is paths, not files. Saying so in the sentence
               * he reads before pressing is cheaper than any amount of care
               * afterwards, and the destructive-looking verb is NOT the button
               * label — "Remove" is what it does.
               */
              <div className="v3-rail-project-confirm" data-testid="v3-rail-project-confirm" role="dialog">
                <p>
                  Remove <strong>{sectionLabel(section)}</strong> from the workspace?
                </p>
                <p className="v3-rail-project-confirm-note">
                  Its chats and the folder on disk are untouched. Open it again any time.
                </p>
                <div className="v3-rail-project-confirm-row">
                  <button type="button" onClick={() => setConfirmRemove(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="is-primary"
                    data-testid="v3-rail-project-confirm-remove"
                    onClick={() => void removeProject(section.path)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : null}
            <div className="v3-rail-section-body">
              {rows.filter((entry) => matchesQuery(entry, query)).length > 0 ? (
                rows
                  .filter((entry) => matchesQuery(entry, query))
                  .map((entry) => renderRow(entry, section.path))
              ) : (
                /* An attached project with nothing written in it yet. Saying so
                   is the difference between "empty" and "gone", and the "+"
                   above is the way out of it. */
                <p className="v3-rail-section-empty" data-testid="v3-rail-section-empty">
                  No chats yet
                </p>
              )}
            </div>
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
