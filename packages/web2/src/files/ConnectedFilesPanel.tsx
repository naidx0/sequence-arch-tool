/* ══════════════════════════════════════════════════════════════════════════
   THE FILES PANEL, WIRED — the handback at the top of `files/index.ts`, taken.
   packages/web2/src/files/ConnectedFilesPanel.tsx

   ── WHY THIS FILE EXISTS, WHICH IS A DEFECT AND NOT A FEATURE ─────────────

   `FilesPanel` shipped finished: a tree, a source listing, a diff, a field,
   ninety-two green tests — and NOTHING MOUNTED IT. The one entry named "Files"
   in the workspace menu called `applyHostOpen('files')`, which resolves to the
   ARCHITECTURE surface with the index rail expanded, because "Files" has been
   an alias for the index rail since before this panel existed. So every test
   in `files/` was a statement about a surface no user could reach.

   That is a defect this tree has hit by name three times — `canvas/proposal`
   dispatched by nothing, `SeqChartView` with no caller, and the index rail
   itself, mounted only after the packaged app was measured and found to have
   no `[data-testid="rail-workspace"]` in the DOM at all. The lesson written
   into `BoardRegion`'s comment is the one this file is: a shipped, tested,
   unreachable component is worth nothing, and mounting it is what makes its
   state — including its wrong states — somebody's job.

   ── WHY THE STATE LIVES HERE AND NOT IN THE PANEL ────────────────────────

   `FilesPanel.tsx` argues this at length and it is not re-argued here, only
   honoured: the panel is FULLY CONTROLLED so that the chat, a click, a command
   palette and a test all drive it down ONE path. Two authorities for "which
   file is showing" is how the chat says `packages/acp/src/client.ts` while the
   panel says "the last thing clicked" and whichever renders second wins.

   So every piece of it is a `useState` in this file, and the day the locked
   chat drives this surface (`docs/research/code-canvas-program.md` §2) the
   moves are: lift these seven fields into the store, and hand the panel the
   same props from `connect.tsx`. Nothing in the panel changes. The shape here
   is `ConnectedAiCanvas`'s and `ConnectedIndexRail`'s — read the store with
   `useAppState`, dispatch with `useStore`, hand a surface plain props.

   ── THE ROUTES, AND WHY EACH ONE AND NOT ANOTHER ─────────────────────────

     GET /api/tree                 → the paths the tree holds.
     GET /api/git/status           → `branch`, and path → status.
     GET /api/file?path=           → `content`  (text/plain).
     GET /api/git/diff?path=       → `diff`     ({path, diff}).
     PUT /api/file                 → Save, through `ReviewClient.writeFile`.

   THE TREE COMES FROM `/api/tree`, NOT FROM THE GRAPH'S FILE NODES, and the
   handback in `index.ts` names the graph because that is what the RAIL walks.
   The rail is an index of what the scanner understood; this panel is the
   owner's "like a real ide inside of our app", and an IDE that cannot show you
   `README.md`, `package.json` or a `.css` file because no parser emitted a
   node for it is not one. `/api/tree` is the whole repository minus the
   reserved roots (`.sequence`, `.git`, `.ssh`, `.aws`, `.gnupg`) and minus
   `node_modules`/`dist`, filtered by the server — the same choke point, so
   this panel cannot become a wider door than the rail already is.

   THE GRAPH'S FILE NODES ARE THE FALLBACK AND ARE NEVER MIXED IN. An origin
   that serves a static `/archgraph.json` with no engine behind it answers
   `/api/tree` with a 404, and a panel that then drew nothing would claim the
   repository is empty. It falls back to the file nodes the graph does carry.
   The two lists are never concatenated: the graph's is a SUBSET that goes
   stale, so a file deleted since the scan would come back as a row with no
   status beside a tree that correctly no longer lists it.

   GIT STATUS IS CONCATENATED, ALWAYS, and that is `index.ts`'s point: a file
   created since the tree was read is in status and in no other list, and
   `buildFileTree` dedupes, so concatenating is both correct and the only way
   an untracked new file appears in the tree at all.

   ── THE THREE RULES THE PROPS IMPOSE, EACH WITH ITS OWN FAILURE ──────────

   1. AN EMPTY DIFF IS `ready`, NEVER `idle`. An unchanged or untracked file
      has an empty diff and that is a complete, correct answer — the panel
      renders "unchanged, or untracked" for it. Passing `idle` would print
      "Nothing loaded for … yet" forever, which is a statement about this
      client that is false.

   2. A REFUSAL CARRIES THE SERVER'S OWN SENTENCE, VERBATIM. `/api/file`
      answers "too large", "outside the repo" and "file not found" with three
      different sentences because they are three different fixes, and one
      generic "could not load" deletes the only actionable line in the
      response. `wireMessage` states the same rule for the JSON routes and is
      reused for them rather than restated.

      THE `{error:…}` ENVELOPE IS UNWRAPPED, which `rail/FileView.tsx` does not
      do and should: `sendError` answers `{"error":"file too large (>…)"}`, so
      printing the body raw puts braces and a key name in front of the reader's
      sentence. Unwrapping is not rewriting — the sentence inside is passed
      through untouched, and a body that is not JSON is shown exactly as it
      arrived.

   3. STATUS IS `null` UNTIL THE SERVER ANSWERS, NEVER AN EMPTY MAP. An empty
      Map is the claim "I asked, and nothing in this repository has changed";
      `null` is "I have not been told". They render differently and only one of
      them is true before the request lands — the same third-state rule
      `NetSlice.reachable` and `TrustSlice.root` both record.

   ── WHY EDIT IMPLIES SAVE ────────────────────────────────────────────────

   Passing `onDraft` is what makes the panel editable, and the panel's own
   header says why a caller with no write endpoint must not pass it: "a tab
   that silently discards typing". We HAVE the endpoint, so the field is real
   and a Save rides with it, through `ReviewClient.writeFile` rather than a
   hand-rolled PUT — that method sends the checkpoint `sessionId`, and the
   engine takes a pre-write baseline ONLY when the request names one. A private
   PUT here would write files that Rewind cannot undo.

   A REFUSED SAVE IS RENDERED IN THE STRIP ABOVE THE PANEL, because the panel's
   prop set has nowhere to put one: pushing it into `content` would blank the
   source the reader is still editing, and a `title` on a disabled button is the
   defect `reviewScopes` records by name. The strip is this file's, so the
   sentence has an owner.

   AND THE GRAPH IS STALE THE INSTANT A SAVE LANDS. `PUT /api/file` clears the
   persisted graph cache WITHOUT re-scanning, so every citation the board draws
   is grounded in a file that may no longer say what the citation says.
   `ConnectedReview` dispatches `repo/stale` for exactly this and this does the
   same — one rule, two doors.

   ── THE TREE OPENS COLLAPSED, AND SEEDING IT WAS REFUSED ─────────────────

   A first paint of two or three rows on a monorepo reads thin, and the obvious
   fix is to seed `expanded` with the top-level directories. It is refused
   because the key would be wrong: `buildFileTree` COLLAPSES single-child
   chains, so the row above `packages/web2/src` may be keyed `packages/web2`
   and a key derived by splitting the path on `/` names a row that does not
   exist. `pathToReveal` exists precisely because that string split is wrong,
   and it walks the built tree. Seeding belongs with the caller that also has
   the tree — the day the chat drives this surface, it will.

   ── WHAT THIS FILE IS STILL NOT, AND WHO TAKES IT ────────────────────────

   `app/App.tsx` mounts this over the workspace body rather than as a workspace
   pill, because a pill is a `ChromeTabId` and that union lives in
   `app/chromeTabModel.ts` — a file this lane does not own, and twelve agents
   editing twelve files with no coordination cost this project a full repair
   cycle (CANON §6). The move is mechanical and is written out in App.tsx at
   the mount site.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { TreeNode } from '@sequence/api-types';

import { createReviewClient, wireMessage } from '../review/reviewClient';
import { liveWorktree } from '../shell2/sessionGroups';
import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { baseName, isWithin, joinPath, parentDir, remapPath } from './fileOpsModel';
import type { FileTreeOps } from './fileOpsModel';
import { useAppState, useStore } from '../state';

import { previewKind } from './previewKind';
import { FilesFind } from './FilesFind';
import { FilesPanel } from './FilesPanel';
import type { FileAction, FileLoad, FilesView } from './FilesPanel';
import { agentRuns } from '../agents/agentRuns';
import { getBranchChanges } from '../git/gitCalls';
import type { BranchChangesResponse } from '../git/gitClient';
import { BranchSwitcher } from '../git/BranchSwitcher';
import { requestDiffBoard } from '../git/openDiff';
import { requestHostCommand } from '../app/hostCommands';
import { useCanvasOptional } from '../canvas/canvasChannel';
import { FlowPanel } from '../rail/FlowPanel';
import { buildFunctionIndex, flowForFunction } from '../rail/railModel';
import type { FlowTrace } from '../rail/railModel';
import type { FunctionIndex } from '../state/types';
import { SymbolsUiContext } from './symbolsUi';
import type { SymbolEntry, SymbolsUi } from './symbolsUi';
import { BranchUiContext } from './branchUi';
import type { FilesScope } from './branchUi';
import { agentEditingPaths, asFileStatus, branchRenames, branchStatusMap, toRepoPath } from './filesModel';
import type { FileStatus, RepoPath } from './filesModel';

/**
 * The anchors for the chrome THIS file adds.
 *
 * They are not in `files/anchors.ts` for one reason: that file belongs to the
 * panel lane and this one does not own it. The argument its header makes still
 * holds and is honoured here instead — one frozen object, imported by the test
 * rather than retyped, so a rename is a type error and not a green run against
 * an element that no longer exists.
 */
export const CONNECTED_FILES = {
  /** The whole wired surface: strip plus panel. */
  root: 'connected-files',
  close: 'connected-files-close',
  /** What a save did, in the engine's words when it refused. */
  saveNote: 'connected-files-save-note',
  /** Shown instead of the panel when there is no repository at all. */
  unattached: 'connected-files-unattached',
  worktreeNote: 'connected-files-worktree-note',
} as const;

export interface ConnectedFilesPanelProps {
  /**
   * Injected by tests; nothing in the application passes it.
   *
   * IT IS NOT DEFAULTED AT MODULE SCOPE. `const doFetch = fetchImpl ?? fetch`
   * written once at import time captures whatever `globalThis.fetch` was then,
   * which a test that stubs the global afterwards can never reach — and an
   * inline arrow would be a new identity on every render, re-running every
   * effect below forever. The `useMemo` gives a stable identity that still
   * reads the live global at CALL time.
   */
  fetchImpl?: typeof fetch;
  /** Drawn as the strip's Close control when passed. */
  onClose?: () => void;
}

interface SaveNote {
  tone: 'working' | 'ok' | 'fail';
  text: string;
}

/** The workspace tree's read: waiting, refused (with the engine's reason), or read. */
type TreeLoad = { state: 'loading' } | { state: 'failed'; reason: string } | { state: 'ready' };

export function ConnectedFilesPanel({ fetchImpl, onClose }: ConnectedFilesPanelProps) {
  const state = useAppState();
  const store = useStore();

  const doFetch = useMemo<typeof fetch>(
    () => fetchImpl ?? ((input, init) => globalThis.fetch(input, init)),
    [fetchImpl],
  );
  /* ONE CLIENT PER FETCH IDENTITY, so the effects below can key on it without
     rebuilding a client every render — the reason `App.tsx` builds its clients
     at module scope. It is built FROM `doFetch` so a test drives the real
     client code rather than a stand-in for it. */
  const client = useMemo(() => createReviewClient(doFetch), [doFetch]);

  /* THE GRAPH IS READ OFF THE PHASE'S OWN PAYLOAD, never off an optional field
     a failed scan could leave stale behind an `unattached` phase — the rule
     `ConnectedIndexRail` states and the store documents. During a rescan the
     phase is `scanning` and `previous` still carries what is on screen. */
  const repo =
    state.repo.phase === 'attached' || state.repo.phase === 'stale'
      ? state.repo.repo
      : state.repo.phase === 'scanning' && state.repo.previous
        ? state.repo.previous
        : null;
  /* Workspace home: Files still works unattached against ~/.sequence/workspace. */
  const repoKey =
    repo === null ? 'workspace' : `${repo.root}@${repo.scannedAt}`;
  const filesFocus = state.session.filesFocus;
  /* A worktree chat edits its own checkout, but Files reads the attached
     project. Moving or deleting there would change the wrong tree, so the
     organising gestures are withheld and the panel says why. */
  const activeEntry = state.session.sessions.find((entry) => entry.id === state.session.activeId);
  const worktreeChat = activeEntry !== undefined && liveWorktree(activeEntry) !== null;

  const [tree, setTree] = useState<TreeNode | null>(null);
  /* Only the unattached branch shows this: loading, a failure with its reason
     and a Retry, or (once a tree arrives) the tree itself. "No files yet." is
     said only of a folder that was read and is empty. */
  const [treeLoad, setTreeLoad] = useState<TreeLoad>({ state: 'loading' });
  const [branch, setBranch] = useState<string | null>(null);
  const [status, setStatus] = useState<ReadonlyMap<RepoPath, FileStatus> | null>(null);
  /* THIS BRANCH (E1/E2): what the branch changed against its base. `null` is
     "not served or not asked", and then the toggle is not drawn at all. */
  const [scope, setScope] = useState<FilesScope>('worktree');
  const [branchChanges, setBranchChanges] = useState<BranchChangesResponse | null>(null);
  /* Bumped after a write, because the file the reader just saved is dirty now
     and the tree must say so. A poll would re-read a repository that changes a
     few times an hour; keying on the act that changes it is the rail's rule
     for its own workspace listing. */
  const [statusNonce, setStatusNonce] = useState(0);
  /* Bumped after a move / rename / create / delete so the tree is read again. */
  const [treeNonce, setTreeNonce] = useState(0);

  const [selected, setSelected] = useState<RepoPath | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<RepoPath>>(() => new Set<RepoPath>());
  const [query, setQuery] = useState('');
  /* The project search that opened the current file: the editor's own find starts on it. */
  const [findSeed, setFindSeed] = useState<{ text: string; nonce: number } | null>(null);
  /* Preview first (round 7, B8): a file with a rendered form opens rendered;
     one without falls back to its code (FilesPanel resolves the mode). */
  const [view, setView] = useState<FilesView>('preview');

  const [content, setContent] = useState<FileLoad>({ state: 'idle' });
  const [diff, setDiff] = useState<FileLoad>({ state: 'idle' });

  /* DRAFTS ARE KEYED BY PATH, NOT ONE STRING. A single draft would be silently
     thrown away the moment the reader clicked a second file to check something
     — data loss with no message, which is the one failure mode this product
     cannot ship. Keyed, the unsaved edit is still there (and the panel's header
     still says "unsaved") when they come back. */
  const [drafts, setDrafts] = useState<ReadonlyMap<RepoPath, string>>(() => new Map());
  const [saveNote, setSaveNote] = useState<SaveNote | null>(null);

  /* ── the tree ────────────────────────────────────────────────────────── */
  useEffect(() => {
    const controller = new AbortController();
    setTreeLoad({ state: 'loading' });
    void (async () => {
      let answer: Response;
      try {
        answer = await doFetch('/api/tree', { signal: controller.signal });
      } catch {
        if (controller.signal.aborted) return;
        /* Offline, or no engine on this origin: with no repository there is no
           graph to fall back on, so the reader is told and can retry. */
        setTreeLoad({ state: 'failed', reason: 'the engine did not answer' });
        return;
      }
      if (controller.signal.aborted) return;
      if (!answer.ok) {
        /* The engine says why (a 409 names the missing workspace); a body
           without a reason falls back to the status. */
        let reason = `HTTP ${answer.status}`;
        try {
          const body = (await answer.json()) as { error?: unknown } | null;
          if (typeof body?.error === 'string' && body.error.trim() !== '') reason = body.error.trim();
        } catch {
          /* keep the status */
        }
        if (!controller.signal.aborted) setTreeLoad({ state: 'failed', reason });
        return;
      }
      let body: unknown;
      try {
        body = await answer.json();
      } catch {
        if (!controller.signal.aborted) setTreeLoad({ state: 'failed', reason: 'the reply was not a file tree' });
        return;
      }
      if (controller.signal.aborted) return;
      /* Shape-checked before it is trusted: a static host answers every
         unknown path with index.html and a 200, so `ok` is not evidence that
         what came back is a tree. */
      const node = body as TreeNode | null;
      if (node === null || typeof node.path !== 'string' || !Array.isArray(node.children)) {
        setTreeLoad({ state: 'failed', reason: 'the reply was not a file tree' });
        return;
      }
      setTree(node);
      setTreeLoad({ state: 'ready' });
    })();
    return () => controller.abort();
  }, [doFetch, repoKey, treeNonce]);

  /* Chat lock: edit:proposal selects the file and opens diff without wiping scroll on repeat. */
  useEffect(() => {
    if (!filesFocus) return;
    setSelected(filesFocus.path as RepoPath);
    setView(filesFocus.view);
    if (filesFocus.proposedContent != null) {
      setDiff({ state: 'ready', text: filesFocus.proposedContent });
    }
  }, [filesFocus]);

  /* ── git status ──────────────────────────────────────────────────────── */
  useEffect(() => {
    if (repo === null) {
      setStatus(null);
      setBranch(null);
      return undefined;
    }
    const controller = new AbortController();
    void (async () => {
      const answer = await client.status(controller.signal);
      if (controller.signal.aborted || answer.outcome !== 'ok') return;
      const map = new Map<RepoPath, FileStatus>();
      for (const file of answer.body.files ?? []) {
        /* `asFileStatus` is what keeps a porcelain letter off the screen: a
           word this build does not know becomes `unknown` and draws a quiet
           mark rather than a character the reader has to decode. */
        map.set(toRepoPath(file.path), asFileStatus(file.status));
      }
      setStatus(map);
      setBranch(typeof answer.body.branch === 'string' ? answer.body.branch : null);
    })();
    return () => controller.abort();
  }, [client, repoKey, statusNonce]);

  useEffect(() => {
    if (repo === null) {
      setBranchChanges(null);
      return undefined;
    }
    const controller = new AbortController();
    void (async () => {
      const answer = await getBranchChanges(undefined, doFetch, controller.signal);
      if (controller.signal.aborted) return;
      setBranchChanges(answer.outcome === 'ok' ? answer.body : null);
    })();
    return () => controller.abort();
  }, [doFetch, repoKey, statusNonce, branch]);
  const shownStatus = useMemo(
    () => (scope === 'branch' && branchChanges !== null ? branchStatusMap(branchChanges.files, status) : status),
    [scope, branchChanges, status],
  );
  /* ── functions under a file (I6) ───────────────────────────────────────
     The store's index first; else GET /api/functions once. A refusal is silence:
     no index, no function rows, today's tree. */
  const canvasChannel = useCanvasOptional();
  const [fetchedFns, setFetchedFns] = useState<FunctionIndex | null>(null);
  const fnIndex = repo?.functions ?? fetchedFns;
  /* The index belongs to one scan of one repository: a rescan or a switch reads it again. */
  useEffect(() => {
    setFetchedFns(null);
    setTrace(null);
    setUntracedId(null);
  }, [repoKey]);
  useEffect(() => {
    if (repo === null || fnIndex !== null) return undefined;
    const controller = new AbortController();
    void (async () => {
      const answer = await client.functions(controller.signal);
      if (controller.signal.aborted || answer.outcome !== 'ok') return;
      /* A 200 that is not a function graph is no index (never a throw in this effect). */
      const g = (answer.body as { functionGraph?: { nodes?: unknown; edges?: unknown } } | null)?.functionGraph;
      if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) return;
      setFetchedFns(buildFunctionIndex({ functionGraph: answer.body.functionGraph, warnings: [] }));
    })();
    return () => controller.abort();
  }, [client, repo, fnIndex]);
  const [symbolsOpen, setSymbolsOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [trace, setTrace] = useState<FlowTrace | null>(null);
  const [untracedId, setUntracedId] = useState<string | null>(null);
  const symbolsByFile = useMemo(() => {
    const map = new Map<string, readonly SymbolEntry[]>();
    if (fnIndex === null) return map;
    for (const [file, ids] of Object.entries(fnIndex.byFile)) {
      const entries: SymbolEntry[] = [];
      for (const id of ids) {
        const node = fnIndex.byId[id];
        /* Boundary nodes (service, datastore, topic) are not functions in a file. */
        if (node && (node.kind === undefined || node.kind === 'function')) entries.push({ id, name: node.name, line: node.startLine });
      }
      if (entries.length > 0) map.set(file, entries);
    }
    return map;
  }, [fnIndex]);
  const playbackNow = canvasChannel && canvasChannel.canvas.view.state === 'S3' ? canvasChannel.canvas.view.playback : null;
  const symbolsUi = useMemo<SymbolsUi | null>(() => {
    if (symbolsByFile.size === 0) return null;
    return {
      byFile: symbolsByFile,
      open: symbolsOpen,
      onToggle: (path) =>
        setSymbolsOpen((prev) => {
          const next = new Set(prev);
          if (!next.delete(path)) next.add(path);
          return next;
        }),
      onPlay: (id) => {
        if (!repo || !canvasChannel) return;
        const next = flowForFunction(id, fnIndex, repo.graph);
        if (!next.traced) {
          /* Sheet 11.6: a function whose calls stay inside its file does not play. */
          setTrace(null);
          setUntracedId(id);
          /* ...and a flow that was playing stops: the board must not keep lighting another function's path. */
          if (playbackNow) canvasChannel.dispatch({ type: 'canvas/flow-clear' });
          return;
        }
        setUntracedId(null);
        setTrace(next);
        canvasChannel.dispatch({ type: 'canvas/flow', playback: { functionId: id, hops: next.hops, cursor: 0, playing: true } });
        /* The board is where it plays: put it on stage. */
        requestHostCommand('canvas.board');
      },
      playingId: playbackNow?.functionId ?? null,
      untracedId,
      footer:
        repo && canvasChannel && (trace !== null || playbackNow !== null) ? (
          <FlowPanel
            trace={trace}
            playback={playbackNow}
            graph={repo.graph}
            onPlaybackChange={(n) => canvasChannel.dispatch({ type: 'canvas/flow-cursor', cursor: n.cursor, playing: n.playing })}
            onClear={() => {
              setTrace(null);
              canvasChannel.dispatch({ type: 'canvas/flow-clear' });
            }}
          />
        ) : undefined,
    };
  }, [symbolsByFile, symbolsOpen, repo, canvasChannel, fnIndex, trace, untracedId, playbackNow]);

  const branchUi = useMemo(
    () => ({
      showScope: branchChanges !== null,
      scope,
      onScope: setScope,
      renamedFrom: scope === 'branch' && branchChanges !== null ? branchRenames(branchChanges.files) : undefined,
      changed: branchChanges?.files.length ?? 0,
      base: branchChanges?.base ?? 'main',
      onViewDiff: requestDiffBoard,
      /* Drawn only when /api/git/branches answers; renders nothing otherwise. */
      switcher: (
        <BranchSwitcher
          fetchImpl={doFetch}
          onSwitched={() => {
            setStatusNonce((n) => n + 1);
            setTreeNonce((n) => n + 1);
          }}
        />
      ),
    }),
    [branchChanges, scope, doFetch],
  );

  /* A different repository is a different tree, a different selection and a
     different set of unsaved edits. Carrying any of them across would put one
     repository's draft over another repository's file. */
  useEffect(() => {
    setSelected(null);
    setContent({ state: 'idle' });
    setDiff({ state: 'idle' });
    setDrafts(new Map());
    setSaveNote(null);
  }, [repoKey]);

  /* ── the file ────────────────────────────────────────────────────────────
   *
   * FETCHED ON SELECTION, WHICH IS ALSO WHAT ARROW KEYS CHANGE. That is the
   * preview behaviour of every editor's tree, and it is the one behaviour that
   * treats a click and a keyboard move as the same act — wiring the fetch to
   * `onOpen` instead would mean Enter loads the file and Down does not, from
   * one selection model. Held arrow keys are bounded by the abort below: a
   * superseded request is cancelled, and the guard after the await is what
   * stops a slow first answer landing on top of a fast second one. */
  useEffect(() => {
    if (selected === null) {
      setContent({ state: 'idle' });
      return undefined;
    }
    const controller = new AbortController();
    setContent({ state: 'loading' });
    void (async () => {
      const load = await readFileText(doFetch, selected, controller.signal);
      if (controller.signal.aborted) return;
      setContent(load);
    })();
    return () => controller.abort();
  }, [doFetch, selected]);

  /* ── the diff ────────────────────────────────────────────────────────────
   *
   * ASKED FOR WHEN THE DIFF IS WHAT IS SHOWING, and asked for AGAIN on each
   * entry rather than cached. A diff is a live reading of the working tree —
   * the reader switches to Code, edits, saves, and switches back precisely to
   * see what changed, and a cached answer would show them the diff from before
   * their own edit. `statusNonce` is in the dependency list for that last case
   * and only that case: a save through this panel changes the working tree, so
   * a diff already on screen when it lands is answering the old question. */
  const wantsDiff = view === 'diff' && selected !== null;
  useEffect(() => {
    if (!wantsDiff || selected === null) return undefined;
    const controller = new AbortController();
    setDiff({ state: 'loading' });
    void (async () => {
      const answer = await client.diff(selected, controller.signal);
      if (controller.signal.aborted) return;
      if (answer.outcome !== 'ok') {
        setDiff({ state: 'failed', message: wireMessage(answer) });
        return;
      }
      /* THE EMPTY STRING IS A `ready` ANSWER. An unchanged or untracked file
         has no diff, the panel has a sentence for exactly that, and `idle`
         here would say "nothing loaded yet" about a question that was asked
         and answered. */
      setDiff({ state: 'ready', text: typeof answer.body.diff === 'string' ? answer.body.diff : '' });
    })();
    return () => controller.abort();
  }, [client, selected, wantsDiff, statusNonce]);

  /* ── the paths ───────────────────────────────────────────────────────── */
  const paths = useMemo(() => {
    const listed = tree === null ? graphFilePaths(repo?.graph.nodes) : treeFilePaths(tree);
    const changed: string[] = [];
    if (shownStatus !== null) for (const path of shownStatus.keys()) changed.push(path);
    /* Concatenated, never merged by hand: `buildFileTree` dedupes, and a file
       created since the tree was read is in status and in nothing else. */
    return [...listed, ...changed];
  }, [tree, repo, shownStatus]);


  /* ── organising the tree (round 9, ask 20) ───────────────────────────────
   * Every gesture is one POST /api/file/op, jailed to the project root on the
   * server. What the reader has open follows the file: a selection, a draft and
   * an expanded folder under a renamed or moved path are re-keyed, not lost. */
  const afterFileChange = useCallback(
    (paths: string[]) => {
      setTreeNonce((n) => n + 1);
      setStatusNonce((n) => n + 1);
      store.dispatch({ type: 'repo/stale', reason: 'file-written', changedPaths: paths, at: Date.now() });
    },
    [store],
  );

  /* Folders with no file in them: ones the engine lists empty, plus the ones
     just made here (so a new folder is a row you can drop into at once). */
  const [createdDirs, setCreatedDirs] = useState<ReadonlySet<string>>(() => new Set());
  const emptyDirs = useMemo(() => {
    const out = new Set<string>(createdDirs);
    if (tree !== null) {
      const walk = (node: TreeNode): boolean => {
        if (node.type === 'file') return true;
        let any = false;
        for (const child of node.children ?? []) if (walk(child)) any = true;
        if (!any && node.path !== '') out.add(node.path);
        return any;
      };
      walk(tree);
    }
    return [...out];
  }, [tree, createdDirs]);

  const fileOps = useMemo<FileTreeOps>(() => {
    const run = async (
      op: 'create' | 'mkdir' | 'rename' | 'move' | 'duplicate' | 'delete' | 'reveal',
      path: string,
      to?: string,
    ): Promise<{ error: string | null; to?: string }> => {
      const answer = await client.fileOp(op, path, to);
      if (answer.outcome !== 'ok') return { error: wireMessage(answer) };
      return { error: null, to: answer.body.to };
    };
    const relocate = (from: string, to: string) => {
      setSelected((cur) => (cur === null ? cur : (remapPath(cur, from, to) as RepoPath)));
      setDrafts((prev) => {
        const next = new Map<RepoPath, string>();
        for (const [k, v] of prev) next.set(remapPath(k, from, to) as RepoPath, v);
        return next;
      });
      setExpanded((prev) => {
        const next = new Set<RepoPath>();
        for (const k of prev) next.add(remapPath(k, from, to) as RepoPath);
        return next;
      });
      setCreatedDirs((prev) => {
        const next = new Set<string>();
        for (const k of prev) next.add(remapPath(k, from, to));
        return next;
      });
    };
    return {
      async move(from, toDir) {
        const dest = joinPath(toDir, baseName(from));
        const r = await run('move', from, dest);
        if (r.error !== null) return r.error;
        relocate(from, dest);
        if (toDir !== '') setExpanded((prev) => new Set(prev).add(toDir as RepoPath));
        afterFileChange([from, dest]);
        return null;
      },
      async rename(path, newName) {
        const dest = joinPath(parentDir(path), newName);
        const r = await run('rename', path, dest);
        if (r.error !== null) return r.error;
        relocate(path, dest);
        afterFileChange([path, dest]);
        return null;
      },
      async create(parent, name, kind) {
        const dest = joinPath(parent, name);
        const r = await run(kind === 'folder' ? 'mkdir' : 'create', dest);
        if (r.error !== null) return r.error;
        if (kind === 'folder') {
          setExpanded((prev) => new Set(prev).add(dest as RepoPath));
          setCreatedDirs((prev) => new Set(prev).add(dest));
        } else {
          setSelected(dest as RepoPath);
        }
        if (parent !== '') setExpanded((prev) => new Set(prev).add(parent as RepoPath));
        afterFileChange([dest]);
        return null;
      },
      async duplicate(path) {
        const r = await run('duplicate', path);
        if (r.error !== null) return r.error;
        afterFileChange(r.to ? [r.to] : [path]);
        return null;
      },
      async remove(path) {
        const r = await run('delete', path);
        if (r.error !== null) return r.error;
        setSelected((cur) => (cur !== null && isWithin(cur, path) ? null : cur));
        setDrafts((prev) => {
          const next = new Map(prev);
          for (const k of prev.keys()) if (isWithin(k, path)) next.delete(k);
          return next;
        });
        setCreatedDirs((prev) => {
          const next = new Set(prev);
          for (const k of prev) if (isWithin(k, path)) next.delete(k);
          return next;
        });
        afterFileChange([path]);
        return null;
      },
      copyPath(path) {
        try {
          void navigator.clipboard?.writeText(path);
        } catch {
          /* No clipboard permission: the path is also in the row's title. */
        }
      },
      async reveal(path) {
        const r = await run('reveal', path);
        return r.error;
      },
    };
  }, [client, afterFileChange]);

  /* IN PROGRESS = an agent's running edit (agentRuns: a running tool call with
     diffs or changes naming the file) OR the reader's own unsaved buffer. */
  const runsState = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const progress = useMemo(() => {
    const set = agentEditingPaths(runsState.runs, new Set<RepoPath>(paths), repo === null ? null : repo.root);
    for (const path of drafts.keys()) set.add(path);
    return set;
  }, [runsState.runs, paths, drafts, repo]);

  const draft = selected === null ? null : (drafts.get(selected) ?? null);
  const dirty =
    selected !== null && draft !== null && content.state === 'ready' && draft !== content.text;

  const actions: FileAction[] = [
    {
      id: 'save',
      label: 'Save',
      disabled: !dirty,
      /* THE REASON RIDES WITH THE REFUSAL — a greyed control with no
         explanation is the defect `reviewScopes` records by name. */
      note: dirty
        ? 'Write this file to disk. The architecture graph goes stale until the next scan.'
        : 'Nothing to save — the field matches the file on disk.',
    },
    {
      id: 'discard',
      label: 'Discard edits',
      disabled: !dirty,
      note: dirty
        ? 'Throw away what is typed here. The file on disk is not touched.'
        : 'Nothing has been typed into this file.',
    },
  ];

  const onAction = (id: string, path: RepoPath) => {
    if (id === 'discard') {
      setDrafts((prev) => dropped(prev, path));
      setSaveNote(null);
      return;
    }
    if (id !== 'save') return;
    const text = drafts.get(path);
    if (text === undefined) return;

    setSaveNote({ tone: 'working', text: `Writing ${path}…` });
    void client.writeFile(path, text).then((answer) => {
      if (answer.outcome !== 'ok') {
        /* 415, 400, 403 and 409 are four different refusals with four
           different fixes, and `wireMessage` hands back the engine's own
           sentence for each. */
        setSaveNote({ tone: 'fail', text: wireMessage(answer) });
        return;
      }
      /* The file on disk IS the draft now, so the draft stops existing —
         leaving it would keep the header's "unsaved" mark on a saved file. */
      setContent({ state: 'ready', text });
      setDrafts((prev) => dropped(prev, path));
      setSaveNote({ tone: 'ok', text: `Saved ${path}.` });
      setStatusNonce((n) => n + 1);
      /*
       * THE GRAPH IS NOW OUT OF DATE, AND THE APP SAYS SO. `PUT /api/file`
       * clears the persisted graph cache WITHOUT re-scanning, so from this
       * instant every claim the board makes is grounded in a file that may no
       * longer say what the citation says. `ConnectedReview` dispatches this
       * for the same write through the other door.
       */
      store.dispatch({
        type: 'repo/stale',
        reason: 'file-written',
        changedPaths: [path],
        at: Date.now(),
      });
    });
  };

  return (
    <div
      data-testid={CONNECTED_FILES.root}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        /* OPAQUE, because this is drawn OVER the workspace panes and a
           transparent surface would print the board through the source. The
           panel's own sheet paints itself the same ground. */
        background: 'var(--bg-base)',
      }}
    >
      {saveNote === null && onClose === undefined ? null : (
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-8)',
          padding: 'var(--sp-4) var(--sp-8) 0',
          color: 'var(--ink-2)',
          minWidth: 0,
        }}
      >
        {saveNote === null ? null : (
          <span
            data-testid={CONNECTED_FILES.saveNote}
            role="status"
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: saveNote.tone === 'fail' ? 'var(--wont)' : 'var(--ink-3)',
            }}
          >
            {saveNote.text}
          </span>
        )}
        {onClose === undefined ? null : (
          <button
            type="button"
            className="shell-btn"
            data-testid={CONNECTED_FILES.close}
            aria-label="Close Files"
            title="Close Files"
            style={{ marginLeft: 'auto' }}
            onClick={onClose}
          >
            Close
          </button>
        )}
      </div>
      )}

      {repo === null && tree === null ? null : (
        <FilesFind
          fetchImpl={doFetch}
          onOpen={(path, line, text) => {
            store.dispatch({ type: 'files/open', path, line });
            /* Tied to THIS open: a later files/open (a chat path link) carries a new nonce and so no query. */
            setFindSeed({ text, nonce: store.getState().session.filesFocus?.nonce ?? -1 });
          }}
        />
      )}

      {repo === null && tree === null ? (
        /* NO REPOSITORY AND NO WORKSPACE TREE YET: waiting on /api/tree, refused,
           or read (an empty folder). The line sits on the header's text edge. */
        <div
          className="files-scope"
          data-testid={CONNECTED_FILES.unattached}
          data-load={treeLoad.state}
          style={{ display: 'block', height: 'auto' }}
        >
          {treeLoad.state === 'loading' ? (
            <p className="files-note files-note-quiet files-note-line" role="status">
              <AsciiSpinner /> Loading files…
            </p>
          ) : treeLoad.state === 'failed' ? (
            <p className="files-note files-note-quiet files-note-line" role="status">
              Files are unavailable: {treeLoad.reason}.{' '}
              <button
                type="button"
                className="files-retry"
                data-testid="connected-files-retry"
                onClick={() => setTreeNonce((n) => n + 1)}
              >
                Retry
              </button>
            </p>
          ) : (
            <p className="files-note files-note-quiet files-note-line">No files yet.</p>
          )}
        </div>
      ) : (
        <div style={{ flex: '1 1 auto', minWidth: 0, minHeight: 0 }}>
          {worktreeChat ? (
            <p className="files-note" role="status" data-testid={CONNECTED_FILES.worktreeNote}>
              Files show the attached project{repo === null ? '' : ` (${repo.repoName})`}, not this
              chat&apos;s worktree. Moving, renaming and deleting are disabled in a worktree chat.
            </p>
          ) : null}
          <SymbolsUiContext.Provider value={symbolsUi}>
          <BranchUiContext.Provider value={branchUi}>
          <FilesPanel
            focusLine={filesFocus?.path === selected ? filesFocus.line : undefined}
            focusKey={filesFocus?.nonce}
            findSeed={filesFocus?.path === selected && findSeed !== null && findSeed.nonce === filesFocus.nonce ? findSeed.text : undefined}
            paths={paths}
            emptyDirs={emptyDirs}
            ops={worktreeChat ? undefined : fileOps}
            status={shownStatus}
            progress={progress}
            branch={branch}
            repoName={repo === null ? 'workspace' : repo.repoName}
            selected={selected}
            onSelect={(path) => {
              setSelected(path);
              /* A file with a rendered form (Markdown, HTML, SVG, an image)
                 opens RENDERED, whatever mode the last file was left in. Left
                 in Edit, a README opened as source and the reader never saw
                 its markdown. */
              setView((current) =>
                current !== 'diff' && previewKind(path) !== null
                  ? /* A file with unsaved edits reopens in Edit, showing the draft,
                       not as a preview of the disk text that hides it. */
                    drafts.has(path)
                    ? 'edit'
                    : 'preview'
                  : current,
              );
              if (filesFocus) store.dispatch({ type: 'files/focus-clear' });
            }}
            expanded={expanded}
            onToggle={(path) =>
              setExpanded((prev) => {
                const next = new Set(prev);
                if (!next.delete(path)) next.add(path);
                return next;
              })
            }
            query={query}
            onQuery={setQuery}
            view={view}
            onView={(next) => {
              if (repo === null && next === 'diff') return;
              setView(next);
            }}
            diffEnabled={repo !== null}
            content={content}
            diff={diff}
            draft={draft}
            /*
             * PASSING THIS IS WHAT DRAWS THE EDIT TAB. It is passed because
             * there is a write endpoint behind it and a Save in the row above
             * — the panel's rule is that a caller with no endpoint passes
             * nothing rather than offering a field that discards typing.
             */
            onDraft={(text) => {
              if (selected === null) return;
              /* Typed back to what is on disk: there is nothing to save or
                 discard, so the draft stops existing (else the file would stay
                 "in progress" with both buttons disabled and no way out). */
              if (content.state === 'ready' && text === content.text) {
                setDrafts((prev) => dropped(prev, selected));
                return;
              }
              setDrafts((prev) => new Map(prev).set(selected, text));
            }}
            actions={actions}
            onAction={onAction}
          />
          </BranchUiContext.Provider>
          </SymbolsUiContext.Provider>
        </div>
      )}
    </div>
  );
}

/* ── the wire ────────────────────────────────────────────────────────────── */

/**
 * `GET /api/file?path=` — the file's TEXT, or the reason there is none.
 *
 * NOT THROUGH `ReviewClient`, and that is not an oversight: its `request`
 * helper decides JSON by PARSING the body, and this route answers
 * `text/plain`. Every source file in the repository would come back as
 * `not-json`. The four-outcome ladder still applies, it is just spelled out
 * here against a text body.
 */
async function readFileText(
  doFetch: typeof fetch,
  path: RepoPath,
  signal: AbortSignal,
): Promise<FileLoad> {
  let response: Response;
  try {
    response = await doFetch(`/api/file?path=${encodeURIComponent(path)}`, { signal });
  } catch (error) {
    return { state: 'failed', message: `nothing answered on this origin — ${errorText(error)}` };
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    return { state: 'failed', message: `nothing answered on this origin — ${errorText(error)}` };
  }

  if (!response.ok) return { state: 'failed', message: serverSentence(body, response.status) };
  return { state: 'ready', text: body };
}

/**
 * The engine's own words, out of the envelope it sends them in.
 *
 * `sendError` answers `{"error":"file too large (>…)"}`, so the raw body is the
 * sentence wrapped in braces and a key name. Unwrapping is not rewriting: the
 * sentence inside is passed through untouched, a body that is not JSON is shown
 * exactly as it arrived, and a refusal with no sentence at all falls back to the
 * status — which is `wireMessage`'s ladder, applied to a text route.
 */
function serverSentence(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown } | null;
    if (parsed !== null && typeof parsed.error === 'string' && parsed.error.trim() !== '') {
      return parsed.error;
    }
  } catch {
    /* Not JSON. The body is then the sentence, which is the older shape and
       still the honest one. */
  }
  const trimmed = body.trim();
  return trimmed === '' ? `the engine refused with HTTP ${status}` : trimmed;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every file path in a `/api/tree` answer. The root's own `''` is not a file
 *  and is never listed. */
function treeFilePaths(root: TreeNode): string[] {
  const out: string[] = [];
  const walk = (node: TreeNode) => {
    if (node.type === 'file') {
      if (node.path !== '') out.push(node.path);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return out;
}

/**
 * The scan's file nodes, normalised — the fallback when `/api/tree` is not
 * served.
 *
 * `toRepoPath` is not optional here. The engine sends NATIVE separators
 * (`packages\web2\src\files\index.ts` on this machine) and every path this
 * panel compares against — git status, the selection, the tree's own keys — is
 * forward-slashed. A missing normalisation makes the same file two rows.
 */
function graphFilePaths(nodes: readonly { kind: string; path?: string }[] | undefined): string[] {
  const out: string[] = [];
  for (const node of nodes ?? []) {
    if (node.kind !== 'file') continue;
    const path = toRepoPath(node.path);
    if (path !== '') out.push(path);
  }
  return out;
}

function dropped(
  drafts: ReadonlyMap<RepoPath, string>,
  path: RepoPath,
): ReadonlyMap<RepoPath, string> {
  const next = new Map(drafts);
  next.delete(path);
  return next;
}
