/**
 * P2.5 — AI may open at most three views (chat + two others) without replacing.
 *
 * Chat is always view 1. Secondary slots (shipped):
 *   - board — Architecture XOR Whiteboard (one pane; kind switches in-slot)
 *   - files — index rail expanded on Architecture
 *   - terminal — chrome pill (C1.7); does not consume a secondary slot here
 *   - browser — chrome pill (C2.5); does not consume a secondary slot here
 *
 * Human tab clicks bypass the cap; this algebra gates host/AI opens only.
 */

export type BoardKind = 'architecture' | 'whiteboard';

export type OpenRequest =
  | 'architecture'
  | 'whiteboard'
  | 'files'
  | 'browser'
  | 'terminal'
  | 'ai-canvas';

export interface WorkspaceViewState {
  boardKind: BoardKind;
  /** Board pane wanted (Architecture / Whiteboard selected). */
  boardOpen: boolean;
  /** Files & functions index expanded. */
  filesOpen: boolean;
  boardMinimized: boolean;
}

export type OpenResult =
  | { ok: true; state: WorkspaceViewState; changed: 'opened' | 'switched' | 'already' }
  | { ok: false; state: WorkspaceViewState; reason: string };

/** Chat + this many secondaries. */
export const MAX_SECONDARY = 2;

const UNSHIPPED: ReadonlySet<OpenRequest> = new Set([]);

export const INITIAL_WORKSPACE_VIEWS: WorkspaceViewState = {
  boardKind: 'architecture',
  boardOpen: false,
  filesOpen: false,
  boardMinimized: false,
};

export function secondaryCount(state: WorkspaceViewState): number {
  let n = 0;
  if (state.boardOpen) n += 1;
  if (state.filesOpen) n += 1;
  return n;
}

/**
 * Ask to open a secondary view for the agent / host command path.
 * Never closes chat. Never drops an open secondary to make room — refuses instead.
 * Architecture ↔ Whiteboard shares the board slot (kind switch, not a new view).
 * Terminal is chrome-tab owned — ok here signals the host to open that pill.
 */
export function requestOpen(state: WorkspaceViewState, req: OpenRequest): OpenResult {
  if (UNSHIPPED.has(req)) {
    return {
      ok: false,
      state,
      reason: `${req} is not shipped yet — open Architecture, Whiteboard, Files, Terminal, or Browser instead.`,
    };
  }

  if (req === 'terminal') {
    return { ok: true, state, changed: 'opened' };
  }

  if (req === 'browser') {
    return { ok: true, state, changed: 'opened' };
  }

  if (req === 'ai-canvas') {
    return { ok: true, state, changed: 'opened' };
  }

  if (req === 'architecture' || req === 'whiteboard') {
    if (state.boardOpen) {
      const same = state.boardKind === req && !state.boardMinimized;
      return {
        ok: true,
        state: { ...state, boardKind: req, boardMinimized: false },
        changed: same ? 'already' : 'switched',
      };
    }
    if (secondaryCount(state) >= MAX_SECONDARY) {
      return {
        ok: false,
        state,
        reason:
          'Already showing two views beside chat — close or minimise one before opening another.',
      };
    }
    return {
      ok: true,
      state: {
        ...state,
        boardOpen: true,
        boardKind: req,
        boardMinimized: false,
      },
      changed: 'opened',
    };
  }

  /* files */
  if (state.filesOpen && state.boardOpen && !state.boardMinimized) {
    return { ok: true, state, changed: 'already' };
  }

  if (!state.boardOpen) {
    if (secondaryCount(state) >= MAX_SECONDARY) {
      return {
        ok: false,
        state,
        reason:
          'Already showing two views beside chat — close or minimise one before opening Files.',
      };
    }
    return {
      ok: true,
      state: {
        ...state,
        boardOpen: true,
        boardKind: 'architecture',
        filesOpen: true,
        boardMinimized: false,
      },
      changed: 'opened',
    };
  }

  if (state.filesOpen) {
    return {
      ok: true,
      state: { ...state, boardKind: 'architecture', boardMinimized: false },
      changed: 'switched',
    };
  }

  if (secondaryCount(state) >= MAX_SECONDARY) {
    return {
      ok: false,
      state,
      reason:
        'Already showing two views beside chat — close or minimise one before opening Files.',
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      boardKind: 'architecture',
      filesOpen: true,
      boardMinimized: false,
    },
    changed: 'opened',
  };
}

/** Human tab: Chat alone / Architecture / Whiteboard — always allowed. */
export function selectHumanSurface(
  state: WorkspaceViewState,
  surface: 'chat' | 'architecture' | 'whiteboard',
): WorkspaceViewState {
  if (surface === 'chat') {
    return {
      ...state,
      boardOpen: false,
      boardMinimized: false,
      filesOpen: false,
    };
  }
  return {
    ...state,
    boardOpen: true,
    boardKind: surface,
    boardMinimized: false,
  };
}

export function minimizeBoard(state: WorkspaceViewState): WorkspaceViewState {
  if (!state.boardOpen) return state;
  return { ...state, boardMinimized: true };
}

export function restoreBoard(state: WorkspaceViewState): WorkspaceViewState {
  if (!state.boardOpen) return state;
  return { ...state, boardMinimized: false };
}

export function setFilesOpen(state: WorkspaceViewState, open: boolean): WorkspaceViewState {
  return { ...state, filesOpen: open };
}
