/**
 * Sessions / memory / board / trajectory — the `/api/sessions/*` routes in
 * `server/repoServer.ts`.
 *
 * Repo-attached sessions live under `<repo>/.sequence/sessions/`. With no repo,
 * workspace sessions live under `~/.sequence/sessions/` (general / home threads).
 */

import type { SequenceBoardDoc } from '@sequence/schema';
import type { OkPathResponse } from './common.js';

/* -------------------------------- the store ------------------------------- */

/** `sessionsStore.ts:12-21`. */
export interface SessionIndexEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  titleEdited?: boolean;
  /** Work (planning) or Code (repo). Missing ⇒ work. */
  mode?: 'work' | 'code';
  clonedFromId?: string;
}

/** `sessionsStore.ts:23-27`. */
export interface SessionIndex {
  version: 1;
  activeId: string;
  sessions: SessionIndexEntry[];
}

/** `sessionsStore.ts:29-33`. All fields optional; `{}` is the normal empty value. */
export interface SessionMeta {
  boardPath?: string;
  boardFileName?: string;
  boardSource?: string;
}

/** `role` is an unconstrained string on disk, unlike the ask history's narrowed union. */
export interface ChatMemoryTurn {
  role: string;
  text: string;
  at?: string;
  /**
   * P3 v2 — optional grounded fields on assistant turns. Absent on v1 prose
   * files and on user turns. Opaque on the wire so the server does not
   * re-validate WorkRow shape (client parses defensively on restore).
   */
  work?: unknown[];
  evidence?: unknown;
  coverage?: unknown;
}

/**
 * `ChatMemoryShape` (`sessionsStore.ts`). v1 = prose only; v2 may carry work /
 * evidence / coverage on assistant turns so a reload does not invent an
 * empty-work answer.
 */
export interface ChatMemoryShape {
  version: 1 | 2;
  sessionId: string;
  turns: ChatMemoryTurn[];
}

/* --------------------------- /api/sessions — :1245 ------------------------ */

export type GetSessionsRequest = void;

/** Where the returned `index` is stored. */
export type SessionsScope = 'workspace' | 'repo';

/** Recent repos that have at least one session on disk (blank-workspace catalog). */
export interface RepoSessionsSection {
  path: string;
  name: string;
  index: SessionIndex;
}

export interface GetSessionsResponse {
  index: SessionIndex;
  scope?: SessionsScope;
  /** Present when `scope` is `workspace` — per-repo sections from recent attach list. */
  repos?: RepoSessionsSection[];
}

/** Body is optional; a missing or invalid body means the mode-less default. */
export interface PostSessionsRequest {
  mode?: 'work' | 'code';
}

export interface PostSessionsResponse {
  index: SessionIndex;
  session: {
    id: string;
    chat: ChatMemoryShape;
    meta: SessionMeta;
  };
}

/* ----------------------- PUT /api/sessions/active — :1277 ----------------- */

export interface PutActiveSessionRequest {
  /** Must name an existing session, else 404. */
  activeId: string;
}

export interface PutActiveSessionResponse {
  index: SessionIndex;
}

/* ------------------------ /api/sessions/:id — :1302 ----------------------- */

export type GetSessionRequest = void;

/**
 * `boardSeqd` is the raw `.seqd` TEXT of the session's board snapshot, not a
 * parsed document — absent when the session has none.
 */
export interface GetSessionResponse {
  chat: ChatMemoryShape;
  meta: SessionMeta;
  boardSeqd?: string;
  canvas?: CanvasDocShape;
}

/** `.sequence/sessions/<id>/canvas.json` — AI Canvas block document. */
export interface CanvasDocShape {
  version: 1;
  sessionId: string;
  blocks: Array<{
    id: string;
    type: 'markdown' | 'mermaid' | 'html' | 'react' | 'svg';
    title?: string;
    payload: string;
    status?: 'live' | 'landed';
  }>;
  storyRoute?: {
    title: string;
    steps: Array<{ blockId: string; caption: string }>;
  };
}

/**
 * A PATCH, despite the verb: only the fields present are applied. A `chat` whose
 * `sessionId` does not match the path id is a 400, not a silent re-key.
 */
export interface PutSessionRequest {
  chat?: ChatMemoryShape;
  meta?: SessionMeta;
  boardSeqd?: string;
  canvas?: CanvasDocShape;
  title?: string;
  pinned?: boolean;
  mode?: 'work' | 'code';
  clonedFromId?: string;
  /**
   * Which repo owns this session. ABSENT ⇒ the active root, byte-identical to
   * before this field existed.
   *
   * Owner, 2026-09-02: "Should also let you edit any type of chat session
   * without actually being in that chat session." The workspace catalog lists
   * OTHER repos' threads, so renaming or pinning one has to name its repo.
   *
   * It is validated against {@link GetSessionsResponse.repos} AS THE CALLING
   * IDENTITY WOULD RECEIVE IT — the write fence is exactly the catalog the read
   * route would disclose to this caller, never a wider one. So in `scope:'repo'`,
   * where the GET omits `repos` entirely, the ONLY accepted path is the attached
   * repo (identical to omitting the field); and under auth the list is the
   * caller's own recents, not the machine's. An unknown path is a **400**, never
   * a silent write into the active repo.
   */
  repoPath?: string;
}

export interface PutSessionResponse {
  ok: true;
  index: SessionIndex;
}

/**
 * DELETE carries no body, so its repo travels in the QUERY STRING:
 * `DELETE /api/sessions/:id?repoPath=…`. Same field name and same validation as
 * {@link PutSessionRequest.repoPath} — absent ⇒ the active root; unknown ⇒ 400.
 */
export interface DeleteSessionQuery {
  repoPath?: string;
}

export type DeleteSessionRequest = void;

export interface DeleteSessionResponse {
  ok: true;
  index: SessionIndex;
}

/* ------------------------- /api/chat-memory — :1405 ----------------------- */

/**
 * A compat shim over the ACTIVE session — there is no shared
 * `.sequence/chat-memory.json` any more.
 */
export type GetChatMemoryResponse = ChatMemoryShape;

/**
 * The server OVERWRITES `sessionId` with the active session's id before storing,
 * so whatever a client sends in that field is advisory.
 */
export type PutChatMemoryRequest = ChatMemoryShape;

/** `{ ok, path }` where `path` is `.sequence/sessions/<activeId>/chat.json`. */
export type PutChatMemoryResponse = OkPathResponse;

/* ------------------------- /api/canvas-doc — active session canvas ------- */

/** Compat shim → active session `canvas.json`. */
export type GetCanvasDocResponse = CanvasDocShape;

export type PutCanvasDocRequest = CanvasDocShape;

export type PutCanvasDocResponse = OkPathResponse;

/* ---------------------------- /api/board — :1215 -------------------------- */

export type GetBoardRequest = void;

/**
 * The Sequence-native Task Board doc (`sequenceBoard.ts:55`). ALWAYS 200: no
 * board yet ⇒ an empty document, never a 404.
 */
export type GetBoardResponse = SequenceBoardDoc;

/** Schema-validated on the way in; anything that fails to parse is a 400. */
export type PutBoardRequest = SequenceBoardDoc;

/** `{ ok, path }` where `path` is `.sequence/board.json`. */
export type PutBoardResponse = OkPathResponse;

/* ------------------------- trajectory — :3149, :3173 ---------------------- */

export interface TrajectoryGraphNode {
  id: string;
  kind: 'decision' | 'action' | 'tool' | 'correction' | 'start' | 'end';
  title: string;
  order: number;
  status: 'idle' | 'queued' | 'running' | 'done' | 'error';
  evidence?: string;
  error?: string;
}

export interface TrajectoryGraphEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface TrajectoryGraph {
  runId: string;
  programId?: string;
  nodes: TrajectoryGraphNode[];
  edges: TrajectoryGraphEdge[];
}

/** A per-run status transition recorded alongside the graph (program runs). */
export interface TrajectoryRunEvent {
  nodeId: string;
  status: string;
  at?: number;
  error?: string;
}

/**
 * `TrajectoryDoc` (`trajectoryStore.ts:56`). `askTrace` holds the streamed events
 * verbatim as loose records — ONLY events that really fired, never fabricated tool
 * calls. `askTerminal.text` is truncated to 2,000 chars when it is a `result`.
 */
export interface TrajectoryDoc {
  version: 1;
  runId: string;
  kind: 'ask' | 'program';
  startedAt: string;
  finishedAt?: string;
  programId?: string;
  /** The user's ask question (ask runs only). */
  question?: string;
  askTrace: Array<Record<string, unknown>>;
  askTerminal?: { type: 'result' | 'error' } & Record<string, unknown>;
  graph: TrajectoryGraph;
  runEvents?: TrajectoryRunEvent[];
}

export type GetTrajectoryRequest = void;

/** The doc itself, not a wrapper. 404 when the run id is unknown. */
export type GetTrajectoryResponse = TrajectoryDoc;

/** `kind` must be `'program'` or `'ask'`; anything else is a 400. */
export type PostTrajectoryRequest = TrajectoryDoc;

export interface PostTrajectoryResponse {
  runId: string;
}

/* ================= P10 — session checkpoints and rewind ==================== *
 *
 * Claude Code has `/rewind`: 100 checkpoints, restore code or conversation or
 * both. Sequence had board and program-run persistence and no session-level
 * file undo at all. These four routes are that, built on the same durable,
 * id-numbered log argument `programs.ts` documents for runs.
 *
 * ALL FOUR ARE REPO-SCOPED (409 with no repo attached) and owner-gated. Storage
 * is `.sequence/checkpoints/<sessionId>/` — records, a tracked-file set with
 * baselines, and content-addressed blobs.
 *
 * THE HONESTY CONTRACT, which is the point of the split between the two POSTs:
 * `/api/checkpoint/plan` computes what a restore WOULD touch and touches
 * nothing; `/api/checkpoint/restore` returns the same plan alongside what it
 * then did. There is no route that acts without stating first.
 */

/** One file's captured state. `blob` ABSENT ⇒ the file did not exist. */
export interface CheckpointFileSnapshot {
  /** Repo-relative, forward-slashed. */
  path: string;
  /**
   * sha256 of the content. Absent means ABSENT — never `""`, and never a
   * zero-byte blob standing in for "no file", because "empty file" and "no
   * file" are different states of a repository.
   */
  blob?: string;
  bytes?: number;
}

/** One conversation turn, exactly as the session store holds it. */
export interface CheckpointTurn {
  role: string;
  text: string;
  at?: string;
}

/** `checkpointStore.ts` — one checkpoint. */
export interface CheckpointRecord {
  /**
   * The checkpoint's stable id. NOT the log's line ordinal: the log is capped at
   * 100 and pruning shifts ordinals, so an ordinal-as-id would silently
   * re-point a "restore #3" at a different checkpoint.
   */
  seq: number;
  at: number;
  sessionId: string;
  label?: string;
  /** Every file the session had written by this point, with its state then. */
  files: CheckpointFileSnapshot[];
  /**
   * ABSENT, never `[]`, when there was no session on disk to read — an empty
   * array is the real state of a session with no turns yet, and using it for
   * "not captured" would let a restore claim it can put back a conversation it
   * never had.
   */
  conversation?: CheckpointTurn[];
}

/* --------------------------- POST /api/checkpoint ------------------------- */

export interface PostCheckpointRequest {
  /** The session to checkpoint. Whitelisted `[A-Za-z0-9_-]{1,64}` — no `.` or `/`. */
  sessionId: string;
  /** Free text describing the point (e.g. the turn it follows). */
  label?: string;
  /**
   * Extra repo-relative paths this turn touched. Unioned into the tracked set
   * before the snapshot, for a write path not routed through
   * `PUT /api/file`'s own `sessionId`.
   */
  files?: string[];
}

/** The record as it was committed — the log write happens before this answers. */
export interface PostCheckpointResponse {
  checkpoint: CheckpointRecord;
}

/* ------------------- GET /api/checkpoints?sessionId=… --------------------- */

export interface GetCheckpointsQuery {
  sessionId: string;
}

/** Oldest first. At most 100 — older checkpoints, and their blobs, are swept. */
export interface GetCheckpointsResponse {
  checkpoints: CheckpointRecord[];
  /** Every file this session has written, in first-touch order. */
  tracked: string[];
}

/* ------------- POST /api/checkpoint/plan · /api/checkpoint/restore -------- */

/** What a restore is allowed to move. */
export type RestoreScope = 'code' | 'conversation' | 'both';

export interface PostCheckpointRestoreRequest {
  sessionId: string;
  /** The `seq` of the checkpoint to go back to. */
  seq: number;
  /** Defaults to `'both'`. */
  scope?: RestoreScope;
}

export interface PlannedRestoreWrite {
  path: string;
  /** The byte length the file will have afterwards. */
  bytes: number;
  blob: string;
}

/**
 * EXACTLY WHAT A RESTORE WOULD DO, computed without doing any of it.
 *
 * `touches` may be NARROWER than `requestedScope` — asking for `'both'` on a
 * checkpoint that captured no conversation restores code only, and `notes`
 * says why. Render `touches`, `writes` and `deletes` before offering the
 * restore; that is the whole reason the plan route exists separately.
 */
export interface RestorePlan {
  ok: boolean;
  sessionId: string;
  seq: number;
  requestedScope: RestoreScope;
  touches: { code: boolean; conversation: boolean };
  /** Files whose content will change. */
  writes: PlannedRestoreWrite[];
  /** Files that will be DELETED — they did not exist at the checkpoint. */
  deletes: string[];
  /** Already byte-identical to the checkpoint. Listed, not written. */
  unchanged: string[];
  /**
   * Files whose snapshot blob is gone. Non-empty ⇒ `ok:false`, and the restore
   * route refuses outright: a partially restored tree is worse than none, and
   * the server will not invent the content it lost.
   */
  unrecoverable: string[];
  /** How many turns the conversation goes back to. Absent when untouched. */
  conversationTurns?: number;
  notes: string[];
  error?: string;
}

/** `POST /api/checkpoint/plan` — the plan alone. Writes nothing, ever. */
export interface PostCheckpointPlanResponse {
  plan: RestorePlan;
}

/**
 * `POST /api/checkpoint/restore` — the plan AND what was carried out.
 *
 * `applied` is absent when the plan was not ok (a **409**, with the plan still
 * in the body so the client can render exactly what stopped it).
 */
export interface PostCheckpointRestoreResponse {
  plan: RestorePlan;
  applied?: {
    ok: boolean;
    wrote: string[];
    deleted: string[];
    conversationRestored: boolean;
    error?: string;
  };
}
