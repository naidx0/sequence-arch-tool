import fs from 'node:fs';
import type { LessonShape } from './lessonState.js';
import path from 'node:path';
import {
  readJson,
  writeJson,
  writeSequenceText,
  CHAT_MEMORY_FILE,
  SEQUENCE_DIR,
  SESSIONS_INDEX_FILE,
} from './store.js';

export interface SessionIndexEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  titleEdited?: boolean;
  /** Work (planning) or Code (repo). Missing → work. */
  mode?: 'work' | 'code';
  clonedFromId?: string;
  /**
   * THE COMMIT THIS SESSION WAS OPENED AT — a 40-hex SHA, not a branch name.
   *
   * A branch is a NAME, and a name resolves to a different tree every hour. A
   * session's answers cite `path:line`; auditing those citations later means
   * resolving them against the tree the agent was actually looking at, and
   * `HEAD` does not say which tree that was. That is the whole reason, and it
   * needs no incident to justify it.
   *
   * IT IS NOT "CITATIONS DRIFT UNDER CHURN" — that was proposed and then
   * measured false, and the correction is recorded here rather than dropped. A
   * hand-labelled audit of an eight-day transcript from this repository found
   * **0 fabricated citations of 40**, with 1 unknowable because it falls in a
   * region the scan never visits. The six that first looked unresolved were the
   * INSTRUMENT: three were its own regex matching `ts` before `tsx` and
   * truncating `.tsx` paths that exist, and three were a package-name citation
   * form (`acp/src/index.ts` without the `packages/` prefix) that resolves
   * uniquely once the package name is kept.
   *
   * So this field is not a fix for an observed drift. It is the third law
   * (`docs/how-to-verify.md`) applied to provenance in advance: a measurement
   * carries the commit it was taken at, or it is a claim — and an audit that
   * resolves at the wrong commit cannot tell you which it was looking at.
   */
  commit?: string;
  /**
   * Why `commit` is absent, so absence is never read as "nothing was missed".
   *
   * `no-git` the directory is not a git checkout · `unreadable` it is, and HEAD
   * could not be resolved (a packed ref, or the NUL-filled ref file OneDrive has
   * produced here before). Absent on entries written before this field existed,
   * which is a third state and honestly distinct from both.
   */
  commitState?: 'recorded' | 'no-git' | 'unreadable';
}

/**
 * The SHA at HEAD, read from the ref files rather than by spawning git.
 *
 * No subprocess: this runs on the session-creation path, and a store module that
 * can hang on a child process is a store module that can hang the app. Reading
 * two small files cannot.
 *
 * TOTAL, and validated. It returns a SHA only for 40 hex characters — a packed
 * ref, a symref chain, or a corrupt file all yield `unreadable` rather than a
 * guess. That last one is not hypothetical here: `.git/refs/heads/main` in this
 * repository was once 41 bytes of NUL after a OneDrive sync, and a reader that
 * trusted its contents would have written a session pinned to garbage.
 */
export function headCommit(repoRoot: string): { commit?: string; state: SessionIndexEntry['commitState'] } {
  const gitDir = path.join(repoRoot, '.git');
  if (!fs.existsSync(gitDir)) return { state: 'no-git' };
  const sha = (text: string): string | null => {
    const v = text.trim();
    return /^[0-9a-f]{40}$/i.test(v) ? v.toLowerCase() : null;
  };
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    /* Detached HEAD is the SHA itself. */
    const direct = sha(head);
    if (direct) return { commit: direct, state: 'recorded' };
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1]?.trim();
    if (!ref) return { state: 'unreadable' };
    const refPath = path.join(gitDir, ...ref.split('/'));
    if (!fs.existsSync(refPath)) return { state: 'unreadable' };
    const resolved = sha(fs.readFileSync(refPath, 'utf8'));
    return resolved ? { commit: resolved, state: 'recorded' } : { state: 'unreadable' };
  } catch {
    return { state: 'unreadable' };
  }
}

export interface SessionIndex {
  version: 1;
  activeId: string;
  sessions: SessionIndexEntry[];
}

export interface SessionMeta {
  boardPath?: string;
  boardFileName?: string;
  boardSource?: string;
}

export interface ChatMemoryShape {
  version: 1 | 2;
  sessionId: string;
  turns: Array<{
    role: string;
    text: string;
    at?: string;
    work?: unknown[];
    evidence?: unknown;
    coverage?: unknown;
  }>;
}

/** Persisted AI Canvas blocks for a session — `.sequence/sessions/<id>/canvas.json`. */
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
  /* Charts the model or the product proposed for this session. Typed so the
     round trip is visible; the write already spreads the client's body, and the
     read returns it verbatim. */
  charts?: unknown[];
  storyRoute?: {
    title: string;
    steps: Array<{ blockId: string; caption: string }>;
  };
}

function emptyCanvas(id: string): CanvasDocShape {
  return { version: 1, sessionId: id, blocks: [] };
}

function sessionRel(id: string, leaf: string): string {
  return `sessions/${id}/${leaf}`;
}

function sessionBoardRel(id: string): string {
  return sessionRel(id, 'board.seqd');
}

function sessionBoardDisk(repoRoot: string, id: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, sessionBoardRel(id));
}

export function defaultSessionId(): string {
  return `session-${String(Math.floor(Date.now() / 1000) % 10_000).padStart(4, '0')}`;
}

export function uniqueSessionId(existing: Set<string>): string {
  let id = defaultSessionId();
  while (existing.has(id)) {
    id = `${defaultSessionId()}-${Math.random().toString(36).slice(2, 6)}`;
  }
  return id;
}

export function summarizeSessionTitle(text: string): string {
  let t = text.trim().replace(/\s+/g, ' ');
  if (!t) return t;
  /* Strip polite ask fluff so titles read as topic summaries, not prompts. */
  const fluff =
    /^(?:hey|hi|hello|ok|okay|please|pls|can you|could you|would you|will you|just|also|so)\b[,!]?\s*/i;
  for (let i = 0; i < 8; i++) {
    const next = t.replace(fluff, '');
    if (next === t) break;
    t = next.trim();
  }
  t = t
    .replace(/^(?:break down for me how I (?:can|could|should|might)\b)/i, '')
    .replace(/^(?:break down(?: for me)?(?: how)?)\b/i, '')
    .replace(/^(?:explain(?: to me)?(?: how| what| why)?)\b/i, '')
    .replace(/^(?:tell me(?: about| how| what| why)?)\b/i, '')
    .replace(/^(?:help me(?: (?:to|with))?)\b/i, '')
    .replace(/^(?:I want to(?: know| understand)?)\b/i, '')
    .replace(/^(?:how (?:can|do|would|should) I)\b/i, '')
    .replace(/^(?:what(?:'s| is| are)\b)/i, '')
    .replace(/^(?:show me)\b/i, '')
    .trim();
  t = t.replace(/^[,:.\-\s]+/, '').trim();
  if (!t) t = text.trim().replace(/\s+/g, ' ');
  /* Capitalize first letter. */
  t = t.charAt(0).toUpperCase() + t.slice(1);
  const max = 48;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const boundary = cut.lastIndexOf(' ');
  const base = boundary >= 24 ? cut.slice(0, boundary) : cut;
  return `${base.replace(/[,:;.\-–—]+$/, '')}…`;
}

export function titleFromChat(chat: ChatMemoryShape): string {
  const firstUser = chat.turns.find((t) => t.role === 'user' && t.text?.trim());
  if (firstUser) {
    return summarizeSessionTitle(firstUser.text);
  }
  const m = /session-(\d+)/i.exec(chat.sessionId);
  if (m) return `session ${m[1]}`;
  return chat.sessionId;
}

/** Fingerprint of user-prompt activity — bumps session time only when this changes. */
function userPromptFingerprint(chat: ChatMemoryShape): string {
  return chat.turns
    .filter((t) => t.role === 'user')
    .map((t) => t.text ?? '')
    .join('\u0000');
}

/**
 * Fingerprint of GENERATED canvas content. Built field by field into JSON
 * rather than stringifying the doc, because the client re-serializes the whole
 * canvas on every session switch and a different key order would read as a
 * change and stamp a session nobody worked in.
 */
function canvasFingerprint(canvas: CanvasDocShape): string {
  /* TOTAL ON PURPOSE. Neither end of this call is a validated shape: the PUT
     route narrows a canvas on `version`/`sessionId`/`Array.isArray(blocks)`
     only, and {@link readSessionCanvas} returns whatever is on disk after the
     same three checks. So a `blocks: [null]` — a hand edit, a torn write, a
     OneDrive sync conflict — used to reach `b.id` and throw, and because the
     PREV side reads from disk that turned into a 500 on every later canvas save
     for that session, with no repair path: the write that would have healed the
     file could never land. A fingerprint is a comparison, not a validator; it
     must answer for junk instead of poisoning the session. */
  const blocks = canvas.blocks.map((b) => {
    const el = (b ?? {}) as Partial<CanvasDocShape['blocks'][number]>;
    return [el.id ?? '', el.type ?? '', el.title ?? '', el.payload ?? '', el.status ?? ''];
  });
  const steps = canvas.storyRoute?.steps;
  const route = Array.isArray(steps)
    ? [
        canvas.storyRoute?.title ?? '',
        steps.map((s) => {
          const st = (s ?? {}) as Partial<{ blockId: string; caption: string }>;
          return [st.blockId ?? '', st.caption ?? ''];
        }),
      ]
    : null;
  return JSON.stringify([blocks, route]);
}

function titleFromBoardSeqd(boardSeqd?: string): string | null {
  if (!boardSeqd) return null;
  try {
    const parsed = JSON.parse(boardSeqd) as { title?: unknown };
    if (typeof parsed.title !== 'string') return null;
    const t = parsed.title.trim().replace(/\.seqd$/i, '').trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

export function readSessionIndex(repoRoot: string): SessionIndex | undefined {
  const raw = readJson(repoRoot, SESSIONS_INDEX_FILE);
  if (
    !raw ||
    typeof raw !== 'object' ||
    (raw as SessionIndex).version !== 1 ||
    typeof (raw as SessionIndex).activeId !== 'string' ||
    !Array.isArray((raw as SessionIndex).sessions)
  ) {
    return undefined;
  }
  return raw as SessionIndex;
}

function emptyChat(id: string): ChatMemoryShape {
  return { version: 1, sessionId: id, turns: [] };
}

const CHAT_MEMORY_MIGRATED = `${CHAT_MEMORY_FILE}.migrated`;
const SESSIONS_MIGRATE_LOCK = 'sessions/.migrate.lock';

/** Quarantine legacy blob so stale readers cannot treat it as the live transcript. */
function archiveLegacyChatMemory(repoRoot: string): void {
  const live = path.join(repoRoot, SEQUENCE_DIR, CHAT_MEMORY_FILE);
  if (!fs.existsSync(live)) return;
  const dest = path.join(repoRoot, SEQUENCE_DIR, CHAT_MEMORY_MIGRATED);
  try {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(live, dest);
  } catch {
    /* best-effort — sessions index is already the source of truth */
  }
}

/**
 * Exclusive create of a lock file. Concurrent `ensureSessionsMigrated` callers
 * (SessionsPanel list + chat-memory hydrate on first attach) used to each mint
 * a session titled from the first "hi" — the seat-walk three-session bug.
 */
function tryAcquireMigrateLock(repoRoot: string): number | null {
  const lockPath = path.join(repoRoot, SEQUENCE_DIR, SESSIONS_MIGRATE_LOCK);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    return fs.openSync(lockPath, 'wx');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return null;
    throw err;
  }
}

function releaseMigrateLock(repoRoot: string, fd: number): void {
  const lockPath = path.join(repoRoot, SEQUENCE_DIR, SESSIONS_MIGRATE_LOCK);
  try {
    fs.closeSync(fd);
  } catch {
    /* already closed */
  }
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* best-effort */
  }
}

function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* spin — migrate is rare and short; avoid async reshape of every caller */
  }
}

function mintFirstSession(repoRoot: string): SessionIndex {
  const legacy = readJson(repoRoot, CHAT_MEMORY_FILE) as ChatMemoryShape | undefined;
  const now = new Date().toISOString();
  const id =
    legacy && typeof legacy.sessionId === 'string' && legacy.sessionId.trim()
      ? legacy.sessionId.trim()
      : defaultSessionId();

  const chat: ChatMemoryShape =
    legacy &&
    (legacy.version === 1 || legacy.version === 2) &&
    typeof legacy.sessionId === 'string' &&
    Array.isArray(legacy.turns)
      ? { ...legacy, sessionId: id }
      : emptyChat(id);

  const title = titleFromChat(chat);
  const index: SessionIndex = {
    version: 1,
    activeId: id,
    sessions: [{ id, title, createdAt: now, updatedAt: now }],
  };

  writeJson(repoRoot, sessionRel(id, 'chat.json'), chat);
  writeJson(repoRoot, sessionRel(id, 'meta.json'), {});
  writeJson(repoRoot, SESSIONS_INDEX_FILE, index);
  archiveLegacyChatMemory(repoRoot);
  return index;
}

/** Migrate legacy chat-memory.json into the first session when index is absent. */
export function ensureSessionsMigrated(repoRoot: string): SessionIndex {
  const existing = readSessionIndex(repoRoot);
  if (existing) {
    // Index already owns sessions — archive leftover shared blob if present.
    archiveLegacyChatMemory(repoRoot);
    return existing;
  }

  /* Race: two first-touch callers. Winner mints; loser re-reads. */
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const again = readSessionIndex(repoRoot);
    if (again) {
      archiveLegacyChatMemory(repoRoot);
      return again;
    }
    const fd = tryAcquireMigrateLock(repoRoot);
    if (fd === null) {
      sleepSync(5 + attempt);
      continue;
    }
    try {
      const afterLock = readSessionIndex(repoRoot);
      if (afterLock) {
        archiveLegacyChatMemory(repoRoot);
        return afterLock;
      }
      return mintFirstSession(repoRoot);
    } finally {
      releaseMigrateLock(repoRoot, fd);
    }
  }

  /* Last resort — prefer a readable index over throwing mid-ask. */
  const fallback = readSessionIndex(repoRoot);
  if (fallback) return fallback;
  return mintFirstSession(repoRoot);
}

export function readSessionChat(repoRoot: string, id: string): ChatMemoryShape {
  const raw = readJson(repoRoot, sessionRel(id, 'chat.json')) as ChatMemoryShape | undefined;
  /*
   * Client `toChatMemory` writes version 2 (work/evidence/coverage). Accepting
   * only version 1 made every modern PUT look like a blank thread on GET —
   * disk had the transcript; hydrate returned emptyChat. That is the "sessions
   * aren't saving" report from the user seat.
   */
  if (
    raw &&
    (raw.version === 1 || raw.version === 2) &&
    typeof raw.sessionId === 'string' &&
    Array.isArray(raw.turns)
  ) {
    return raw;
  }
  return emptyChat(id);
}

export function readSessionMeta(repoRoot: string, id: string): SessionMeta {
  const raw = readJson(repoRoot, sessionRel(id, 'meta.json'));
  if (!raw || typeof raw !== 'object') return {};
  return raw as SessionMeta;
}

export function readSessionBoard(repoRoot: string, id: string): string | undefined {
  const p = sessionBoardDisk(repoRoot, id);
  if (!fs.existsSync(p)) return undefined;
  return fs.readFileSync(p, 'utf8');
}

export function readSessionCanvas(repoRoot: string, id: string): CanvasDocShape {
  const raw = readJson(repoRoot, sessionRel(id, 'canvas.json')) as CanvasDocShape | undefined;
  if (
    raw &&
    raw.version === 1 &&
    typeof raw.sessionId === 'string' &&
    Array.isArray(raw.blocks)
  ) {
    return raw;
  }
  return emptyCanvas(id);
}

export function writeSessionBoard(repoRoot: string, id: string, content: string): void {
  writeSequenceText(repoRoot, sessionBoardRel(id), content);
}

export function createSession(
  repoRoot: string,
  opts?: { mode?: 'work' | 'code' },
): {
  index: SessionIndex;
  id: string;
  chat: ChatMemoryShape;
  meta: SessionMeta;
} {
  const index = ensureSessionsMigrated(repoRoot);
  const now = new Date().toISOString();
  const ids = new Set(index.sessions.map((s) => s.id));
  const id = uniqueSessionId(ids);
  const chat = emptyChat(id);
  const title = titleFromChat(chat);
  const entry: SessionIndexEntry = { id, title, createdAt: now, updatedAt: now };
  /* Pin the LOCATION, not the name — see SessionIndexEntry.commit. */
  const head = headCommit(repoRoot);
  if (head.commit !== undefined) entry.commit = head.commit;
  entry.commitState = head.state;
  if (opts?.mode === 'work' || opts?.mode === 'code') entry.mode = opts.mode;
  const next: SessionIndex = {
    version: 1,
    activeId: id,
    sessions: [entry, ...index.sessions],
  };
  writeJson(repoRoot, sessionRel(id, 'chat.json'), chat);
  writeJson(repoRoot, sessionRel(id, 'meta.json'), {});
  writeJson(repoRoot, sessionRel(id, 'canvas.json'), emptyCanvas(id));
  writeJson(repoRoot, SESSIONS_INDEX_FILE, next);
  return { index: next, id, chat, meta: {} };
}

export function setActiveSession(repoRoot: string, activeId: string): SessionIndex | null {
  const index = ensureSessionsMigrated(repoRoot);
  if (!index.sessions.some((s) => s.id === activeId)) return null;
  const next = { ...index, activeId };
  writeJson(repoRoot, SESSIONS_INDEX_FILE, next);
  return next;
}

export function updateSession(
  repoRoot: string,
  id: string,
  body: {
    chat?: ChatMemoryShape;
    meta?: SessionMeta;
    boardSeqd?: string;
    canvas?: CanvasDocShape;
    title?: string;
    pinned?: boolean;
    mode?: 'work' | 'code';
    clonedFromId?: string;
  },
): SessionIndex | null {
  const index = ensureSessionsMigrated(repoRoot);
  const entry = index.sessions.find((s) => s.id === id);
  if (!entry) return null;

  /*
   * THE RULE, ONE PLACE: `updatedAt` advances only when this write CHANGES
   * persisted content that represents ACTIVITY INSIDE THE THREAD. Every
   * trigger below therefore compares against what is already on disk. Never
   * add an unconditional one.
   *
   * Owner 2026-09-02: "it also only updates the time when the last activity
   * was within the actual thread, not the last time you opened it. Activity
   * means any type of AI call or tool call, or actual generation apart from
   * just loading the memory of the session in context."
   *
   * THIS IS THE SECOND REPORT OF THIS DEFECT. FINDING F10 + owner 2026-08-27
   * fixed it for `chat` only — pin / title-only / identical chat re-PUT
   * (activate → hydrate) stopped bumping — but `boardSeqd` and `meta` were
   * left as unconditional bumps. SessionsPanel flushes the staged board on
   * every activate/create, so merely opening a session re-wrote the identical
   * board and stamped the row: exactly the complaint F10 was meant to end.
   *
   * NOT activity:
   *  - `title` / `pinned`: a rename or a pin is a click, not a turn (F10).
   *  - `meta`: `SessionMeta` is board-pointer state (`boardPath`,
   *    `boardFileName`, `boardSource`) — where a board came from, never what
   *    the thread did. No field in it records a turn, so it is not a trigger.
   *  - `mode` / `clonedFromId`: they describe the session, not work inside it,
   *    so they are kept only as CHANGE triggers.
   *    They are stamped once by the caller that just created the row (whose
   *    `createdAt`/`updatedAt` are already now), so they are compared against
   *    the entry and a repeat stamp on a later PUT cannot re-bump.
   */
  let bumpUpdatedAt = false;
  if (typeof body.boardSeqd === 'string' && readSessionBoard(repoRoot, id) !== body.boardSeqd) {
    bumpUpdatedAt = true;
  }
  if (body.mode !== undefined && body.mode !== entry.mode) bumpUpdatedAt = true;
  if (typeof body.clonedFromId === 'string' && body.clonedFromId !== entry.clonedFromId) {
    bumpUpdatedAt = true;
  }
  if (body.canvas) {
    /* A canvas block is "actual generation" by the owner's definition, so a
       changed canvas IS activity — but the client re-flushes the identical
       canvas on switch, which is not. */
    const prevCanvas = canvasFingerprint(readSessionCanvas(repoRoot, id));
    const nextCanvas = canvasFingerprint({ ...body.canvas, sessionId: id });
    if (prevCanvas !== nextCanvas) bumpUpdatedAt = true;
  }
  if (body.chat) {
    const existing = readSessionChat(repoRoot, id);
    const prevFp = userPromptFingerprint(existing);
    const nextFp = userPromptFingerprint({ ...body.chat, sessionId: id });
    if (prevFp !== nextFp) bumpUpdatedAt = true;
  }
  /*
   * A REAL EDIT MUST SORT ABOVE THE PREVIOUS ROW — SO COMPARE, DO NOT EQUATE.
   *
   * Same-ms ISO strings are possible under a fast suite, and this used to
   * advance one ms only when `now === entry.updatedAt`. That is the wrong test,
   * and it made `updatedAt` run BACKWARDS on two rapid edits: the first edit
   * lands at T and, colliding with createdAt, is pushed to T+1; the second
   * edit's wall clock still reads T, which is not EQUAL to the stored T+1, so
   * the guard stayed silent and the row was stamped T — older than the edit
   * before it. The rail sorts on `updatedAt`, so a burst of real edits could
   * push a session DOWN the list, which is the sorting the owner reported on
   * 2026-09-02 in the first place.
   *
   * Windows hid it: the calls are slow enough that the wall clock escapes T+1
   * on its own. Linux CI is fast enough that it does not, which is why
   * `sessions-pin`'s "a real board edit must still advance updatedAt" passed
   * locally and failed on the runner.
   *
   * Derive the floor from the STORED value rather than from `now`: whenever we
   * are bumping and the clock has not yet passed the row's own timestamp,
   * continue from that timestamp. ISO-8601 UTC strings of one fixed format
   * compare lexicographically in timestamp order, which is what `<=` relies on.
   */
  let now = new Date().toISOString();
  if (bumpUpdatedAt && now <= entry.updatedAt) {
    now = new Date(Date.parse(entry.updatedAt) + 1).toISOString();
  }
  let title = entry.title;
  let titleEdited = entry.titleEdited === true;
  let pinned = entry.pinned === true;

  if (typeof body.title === 'string' && body.title.trim()) {
    title = body.title.trim();
    titleEdited = true;
  }
  if (typeof body.pinned === 'boolean') {
    pinned = body.pinned;
  }

  if (body.chat) {
    const chat: ChatMemoryShape = { ...body.chat, sessionId: id };
    writeJson(repoRoot, sessionRel(id, 'chat.json'), chat);
    if (!titleEdited) title = titleFromChat(chat);
  }
  if (body.meta) {
    writeJson(repoRoot, sessionRel(id, 'meta.json'), body.meta);
  }
  if (typeof body.boardSeqd === 'string') {
    writeSessionBoard(repoRoot, id, body.boardSeqd);
    if (!titleEdited) {
      const fromBoard = titleFromBoardSeqd(body.boardSeqd);
      if (fromBoard) title = fromBoard;
    }
  }
  if (body.canvas) {
    const canvas: CanvasDocShape = { ...body.canvas, sessionId: id };
    writeJson(repoRoot, sessionRel(id, 'canvas.json'), canvas);
  }

  const sessions = index.sessions.map((s) =>
    s.id === id
      ? {
          ...s,
          title,
          updatedAt: bumpUpdatedAt ? now : entry.updatedAt,
          ...(titleEdited ? { titleEdited: true as const } : { titleEdited: undefined }),
          ...(pinned ? { pinned: true as const } : { pinned: undefined }),
          ...(body.mode === 'work' || body.mode === 'code' ? { mode: body.mode } : {}),
          ...(typeof body.clonedFromId === 'string' ? { clonedFromId: body.clonedFromId } : {}),
        }
      : s,
  );
  const next: SessionIndex = { ...index, sessions };
  writeJson(repoRoot, SESSIONS_INDEX_FILE, next);
  return next;
}

/**
 * Recent repos that already have a sessions index (for blank-workspace catalog).
 * Skips repos with no index or an empty session list.
 */
export function listRepoSessionSections(
  repoPaths: readonly string[],
): Array<{ path: string; name: string; index: SessionIndex }> {
  const out: Array<{ path: string; name: string; index: SessionIndex }> = [];
  for (const repoPath of repoPaths) {
    const index = readSessionIndex(repoPath);
    if (!index || index.sessions.length === 0) continue;
    const name = path.basename(repoPath) || repoPath;
    out.push({ path: repoPath, name, index });
  }
  return out;
}

/**
 * Remove one thread.
 *
 * `keepOneLiveThread` (default true) is the rule for the repo the user is IN:
 * there must always be an active thread to type into, so emptying the list
 * mints a replacement. It is WRONG for a repo the user is not attached to —
 * reachable since the catalog grew a delete control — because the replacement
 * re-appears as a row in that repo's catalog section, so the delete wipes the
 * transcript while visibly no-opping: same section, same count, title silently
 * reverted to the id-derived default, and the repo's `activeId` moved to an
 * empty thread the user never asked for. Pass `false` for a foreign repo: the
 * index file is REMOVED, not left empty, so the repo reads as never-opened —
 * the catalog drops the section (see {@link listRepoSessionSections}) and the
 * next real attach mints a first session through {@link ensureSessionsMigrated}
 * rather than landing the user in a zero-session index with a dangling pointer.
 */
export function deleteSession(
  repoRoot: string,
  id: string,
  opts?: { keepOneLiveThread?: boolean },
): SessionIndex | null {
  const index = ensureSessionsMigrated(repoRoot);
  if (!index.sessions.some((s) => s.id === id)) return null;
  const remaining = index.sessions.filter((s) => s.id !== id);
  const dir = path.join(repoRoot, SEQUENCE_DIR, 'sessions', id);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  if (remaining.length === 0) {
    if (opts?.keepOneLiveThread === false) {
      try {
        fs.rmSync(path.join(repoRoot, SEQUENCE_DIR, SESSIONS_INDEX_FILE), { force: true });
      } catch {
        /* best-effort */
      }
      /* Answered, never written: an empty list with no pointer is what the
         caller must render — the section is gone. */
      return { version: 1, activeId: '', sessions: [] };
    }
    const empty: SessionIndex = { version: 1, activeId: id, sessions: [] };
    writeJson(repoRoot, SESSIONS_INDEX_FILE, empty);
    return createSession(repoRoot).index;
  }
  const pinned = remaining.filter((s) => s.pinned);
  const recent = remaining
    .filter((s) => !s.pinned)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const fallback = (pinned[0] ?? recent[0])!.id;
  const activeId = index.activeId === id ? fallback : remaining.some((s) => s.id === index.activeId)
    ? index.activeId
    : fallback;
  const next: SessionIndex = { version: 1, activeId, sessions: remaining };
  writeJson(repoRoot, SESSIONS_INDEX_FILE, next);
  return next;
}

/* ------------------------------------------------------------- lesson state -- */

/**
 * The lesson beside the transcript: `.sequence/sessions/<id>/lesson.json`.
 *
 * NOT inside `chat.json`. The turns are the transcript — what was said — and a
 * reload must be able to rebuild what the lesson IS without re-parsing prose.
 * Keeping the concept queue in the same file as the words would mean deriving
 * state from text on every load, which is how the state and the transcript come
 * to disagree.
 *
 * WRITE THIS BEFORE THE TRANSCRIPT. If `chat.json` lands and the process dies
 * before `lesson.json`, the transcript is one turn ahead of the state and the
 * next "continue" re-teaches a concept the learner just heard. Ahead-of-state is
 * the recoverable direction: a lesson written first and a transcript that never
 * arrives costs one repeated turn, which the learner can see and redirect.
 */
export function readLesson(repoRoot: string, id: string): LessonShape | undefined {
  const raw = readJson(repoRoot, sessionRel(id, 'lesson.json')) as LessonShape | undefined;
  if (raw === undefined || typeof raw !== 'object') return undefined;
  if (raw.version !== 1 || !Array.isArray(raw.queue) || !Array.isArray(raw.taught)) {
    /* A shape we do not recognise is not a lesson. Returning undefined puts the
       session back to today's behaviour rather than feeding the belt garbage. */
    return undefined;
  }
  return raw;
}

export function writeLesson(repoRoot: string, id: string, lesson: LessonShape): void {
  writeJson(repoRoot, sessionRel(id, 'lesson.json'), lesson);
}
