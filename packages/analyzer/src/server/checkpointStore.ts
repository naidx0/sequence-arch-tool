/**
 * P10 — SESSION CHECKPOINT AND REWIND.
 *
 * Claude Code has `/rewind`: 100 checkpoints, restore code or conversation or
 * both. `docs/research/v2-architecture-and-gaps.md` §5.1 measured what Sequence
 * had — board persistence and program-run persistence — and named what it did
 * not: **no session-level file undo and no fork.** This is that.
 *
 * BUILT ON THE RUN LOG'S ARGUMENT, NOT A NEW ONE. `programRunStore.ts` made the
 * case that a durable, id-numbered, append-only log is what makes replay exact
 * *by construction rather than by timing*. A checkpoint is exactly a point in
 * such a log, so the same shape is reused deliberately:
 *
 *   <repo>/.sequence/checkpoints/<sessionId>/
 *     checkpoints.jsonl   one JSON record per line, `seq` ascending
 *     tracked.json        every file this session has written, with its BASELINE
 *     blobs/<sha256>      content-addressed snapshots, deduplicated
 *
 * ONE DELIBERATE DIFFERENCE FROM THE RUN LOG, and it must not be copied back:
 * there the line ORDINAL *is* the `seq`. Here it cannot be, because a
 * checkpoint log is CAPPED at {@link MAX_CHECKPOINTS} and pruning shifts every
 * ordinal. `seq` is therefore a stored, monotonically increasing counter seeded
 * from the highest value on disk. An id that changed when an old checkpoint
 * aged out would silently point a "restore #3" at somebody else's #3.
 *
 * ── THE BASELINE, AND WHY IT EXISTS ──────────────────────────────────────────
 *
 * The obvious design snapshots "the files the session has written" at capture
 * time. It is wrong, and wrong in the direction that destroys data. Consider a
 * file the session first writes AFTER checkpoint #2. It appears in no snapshot
 * at #2, so a naive restore has two choices and both are lies: leave it (the
 * tree is not what it was at #2) or delete it (if it existed before the session
 * ever ran, that is silent data loss of somebody else's file).
 *
 * So {@link trackSessionWrite} runs BEFORE the write lands and records the
 * file's state *as it was before this session ever touched it* — content, or
 * an explicit "did not exist". A restore's target for such a file is that
 * baseline, which is provably its state at every checkpoint before the first
 * touch, because the session did not change it in between.
 *
 * ── HONEST ABOUT WHAT IT TOUCHES ─────────────────────────────────────────────
 *
 * P10 requires a restore to state whether it moves code, conversation, or both
 * BEFORE it acts. {@link planRestore} is PURE — it opens no file for writing
 * and can be called freely — and {@link applyRestore} takes a plan rather than
 * a request, so there is no path that acts without having produced the
 * statement first. A plan whose blobs are missing is `ok:false` and applying it
 * is refused outright: a half-restored tree is worse than none, and this file
 * will not invent the content it lost.
 *
 * NOTHING HERE EXECUTES ANYTHING. It is fs, JSON and sha256.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SEQUENCE_DIR } from './store.js';
import { readSessionChat, readSessionIndex, updateSession } from './sessionsStore.js';

/** The checkpoint root under `.sequence/`. */
export const CHECKPOINTS_DIR = 'checkpoints';

/** The append-only record log inside one session's checkpoint directory. */
export const CHECKPOINT_LOG_FILE = 'checkpoints.jsonl';

/** The tracked-file set (with baselines) inside one session's directory. */
export const TRACKED_FILE = 'tracked.json';

/** Content-addressed snapshot directory inside one session's directory. */
export const BLOBS_DIR = 'blobs';

/**
 * How many checkpoints a session keeps — the same 100 Claude Code keeps.
 *
 * A cap and not unbounded growth because a checkpoint holds file CONTENT: an
 * unbounded log of a session editing one large file is an unbounded copy of
 * that file, inside the user's repo, that nothing ever deletes.
 */
export const MAX_CHECKPOINTS = 100;

/** Largest single file this store will snapshot. */
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/**
 * Is this a session id safe to use as a path segment?
 *
 * A WHITELIST, exactly as `programRunStore.isRunId` is: `.`, `/` and `\` are
 * simply not in the alphabet, so no encoding of a parent directory survives it.
 * Every route that takes a session id calls this before touching the
 * filesystem. `sessionsStore.uniqueSessionId` mints `session-1234` and
 * `session-1234-ab3d`, both of which match.
 */
export function isCheckpointSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function sessionDir(repoRoot: string, sessionId: string): string {
  if (!isCheckpointSessionId(sessionId)) {
    throw new Error(`refusing to resolve a path for a non-session id: ${String(sessionId)}`);
  }
  return path.join(repoRoot, SEQUENCE_DIR, CHECKPOINTS_DIR, sessionId);
}

/** Repo-relative, forward-slashed — the one spelling every record compares in. */
function toRelPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Temp-file + rename, so a concurrent reader never sees a half-written file. */
function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/** One file's captured state. `blob` absent ⇒ the file DID NOT EXIST. */
export interface FileSnapshot {
  /** Repo-relative, forward-slashed. */
  path: string;
  /**
   * sha256 of the content, and the blob's filename. ABSENT means the file did
   * not exist at this point — never the empty string, and never a zero-byte
   * blob standing in for absence, because "empty file" and "no file" are
   * different states of a repository and a restore must reproduce the right one.
   */
  blob?: string;
  /** Byte length. Absent exactly when `blob` is. */
  bytes?: number;
}

/** One conversation turn as the session store holds it. */
export interface CheckpointTurn {
  role: string;
  text: string;
  at?: string;
}

/** One checkpoint. */
export interface CheckpointRecord {
  /** Stable, monotonically increasing id. NOT the line ordinal — see the header. */
  seq: number;
  at: number;
  sessionId: string;
  /** Free-text label the caller supplied (e.g. the turn it followed). */
  label?: string;
  /** Every file this session had written by this point, with its state then. */
  files: FileSnapshot[];
  /**
   * The conversation as the session store held it.
   *
   * ABSENT, never `[]`, when there was no such session on disk to read: an
   * empty array is a real state (a session with no turns yet) and using it to
   * mean "nothing was captured" would make a restore claim it could put the
   * conversation back when it cannot.
   */
  conversation?: CheckpointTurn[];
}

/** A file the session has written, plus the state it was in beforehand. */
export interface TrackedFile {
  path: string;
  /** The file as it was BEFORE this session first wrote it. See the header. */
  baseline: FileSnapshot;
  firstTrackedAt: number;
}

interface TrackedShape {
  version: 1;
  sessionId: string;
  files: TrackedFile[];
}

function blobPath(repoRoot: string, sessionId: string, sha: string): string {
  return path.join(sessionDir(repoRoot, sessionId), BLOBS_DIR, sha);
}

/**
 * Snapshot one file's CURRENT state, writing its content to a blob.
 *
 * Returns a snapshot with no `blob` when the file is absent, is a directory, or
 * is larger than {@link MAX_SNAPSHOT_BYTES}... except that the last case is a
 * lie we refuse to tell: an oversized file throws, so a checkpoint either holds
 * every tracked file or fails loudly. A checkpoint that silently skipped a file
 * would restore a tree the user was told was captured.
 */
function snapshotFile(repoRoot: string, sessionId: string, rel: string): FileSnapshot {
  const relPosix = toRelPosix(rel);
  const abs = path.join(repoRoot, relPosix);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { path: relPosix };
  }
  if (stat.isDirectory()) return { path: relPosix };
  if (stat.size > MAX_SNAPSHOT_BYTES) {
    throw new Error(
      `cannot checkpoint ${relPosix}: ${stat.size} bytes exceeds the ${MAX_SNAPSHOT_BYTES}-byte snapshot limit`,
    );
  }
  const content = fs.readFileSync(abs);
  const sha = crypto.createHash('sha256').update(content).digest('hex');
  const blob = blobPath(repoRoot, sessionId, sha);
  if (!fs.existsSync(blob)) {
    fs.mkdirSync(path.dirname(blob), { recursive: true });
    // Content-addressed: the name IS the hash, so a rewrite would write the
    // same bytes. Writing through a temp name anyway keeps a reader from ever
    // opening a partial blob.
    const tmp = `${blob}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, blob);
  }
  return { path: relPosix, blob: sha, bytes: content.length };
}

function readTracked(repoRoot: string, sessionId: string): TrackedShape {
  const file = path.join(sessionDir(repoRoot, sessionId), TRACKED_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as TrackedShape;
    if (raw && raw.version === 1 && Array.isArray(raw.files)) return raw;
  } catch {
    /* absent or unreadable — a fresh set, never a fabricated one */
  }
  return { version: 1, sessionId, files: [] };
}

/**
 * Record that this session is about to write `rel`, capturing its pre-write
 * BASELINE the first time. Idempotent: a second write to the same path does not
 * move the baseline, because the baseline means "before the session, ever".
 *
 * MUST BE CALLED BEFORE THE WRITE LANDS. Calling it after would record the new
 * content as the baseline and make every rewind past the first touch a no-op —
 * which is the failure mode that looks like the feature working.
 */
export function trackSessionWrite(repoRoot: string, sessionId: string, rel: string): void {
  if (!isCheckpointSessionId(sessionId)) return;
  const relPosix = toRelPosix(rel);
  const tracked = readTracked(repoRoot, sessionId);
  if (tracked.files.some((f) => f.path === relPosix)) return;
  tracked.files.push({
    path: relPosix,
    baseline: snapshotFile(repoRoot, sessionId, relPosix),
    firstTrackedAt: Date.now(),
  });
  writeJsonAtomic(path.join(sessionDir(repoRoot, sessionId), TRACKED_FILE), tracked);
}

/** Every file this session has written, in first-touch order. */
export function listTrackedFiles(repoRoot: string, sessionId: string): TrackedFile[] {
  if (!isCheckpointSessionId(sessionId)) return [];
  return readTracked(repoRoot, sessionId).files;
}

function logFile(repoRoot: string, sessionId: string): string {
  return path.join(sessionDir(repoRoot, sessionId), CHECKPOINT_LOG_FILE);
}

/**
 * Every checkpoint for this session, oldest first.
 *
 * An unparseable line is SKIPPED rather than surfaced as a half-checkpoint: a
 * row in a rewind list is a claim that the server can put the tree back the way
 * that row says, and it cannot.
 */
export function listCheckpoints(repoRoot: string, sessionId: string): CheckpointRecord[] {
  if (!isCheckpointSessionId(sessionId)) return [];
  let text: string;
  try {
    text = fs.readFileSync(logFile(repoRoot, sessionId), 'utf8');
  } catch {
    return [];
  }
  const out: CheckpointRecord[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as CheckpointRecord;
      if (typeof rec.seq === 'number' && Array.isArray(rec.files)) out.push(rec);
    } catch {
      continue;
    }
  }
  out.sort((a, b) => a.seq - b.seq);
  return out;
}

/** One checkpoint by id, or `undefined` when this session has no such id. */
export function readCheckpoint(
  repoRoot: string,
  sessionId: string,
  seq: number,
): CheckpointRecord | undefined {
  return listCheckpoints(repoRoot, sessionId).find((c) => c.seq === seq);
}

/**
 * Drop everything older than the newest {@link MAX_CHECKPOINTS}, then delete
 * every blob no surviving record and no baseline still references.
 *
 * The sweep is what keeps the cap meaningful: pruning records while leaving
 * their content behind would cap the list and not the disk, which is the half
 * of the problem the cap exists for.
 */
function pruneAndSweep(repoRoot: string, sessionId: string): void {
  const all = listCheckpoints(repoRoot, sessionId);
  const keep = all.length > MAX_CHECKPOINTS ? all.slice(all.length - MAX_CHECKPOINTS) : all;
  if (keep.length !== all.length) {
    const file = logFile(repoRoot, sessionId);
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, keep.map((c) => JSON.stringify(c)).join('\n') + '\n');
    fs.renameSync(tmp, file);
  }
  const live = new Set<string>();
  for (const c of keep) for (const f of c.files) if (f.blob) live.add(f.blob);
  for (const t of readTracked(repoRoot, sessionId).files) {
    if (t.baseline.blob) live.add(t.baseline.blob);
  }
  const dir = path.join(sessionDir(repoRoot, sessionId), BLOBS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^[0-9a-f]{64}$/.test(name)) continue;
    if (live.has(name)) continue;
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      /* best effort — a stale blob costs disk, never correctness */
    }
  }
}

/** Options for {@link captureCheckpoint}. */
export interface CaptureOptions {
  /** Free text describing what this point is (e.g. the turn it follows). */
  label?: string;
  /**
   * Extra repo-relative paths this turn touched, unioned into the tracked set
   * before the snapshot. For a write path that has not been wired through
   * {@link trackSessionWrite} — their baseline is captured NOW, which is
   * honest but weaker: a rewind past that point restores what the file holds at
   * capture time, not what it held before the turn.
   */
  files?: readonly string[];
  now?: () => number;
}

/**
 * Take a checkpoint: snapshot every tracked file's current content, and the
 * session's conversation if there is one on disk.
 *
 * The record is appended to the log BEFORE this returns, so a caller that
 * reports a checkpoint to a user cannot report one that is not durable.
 */
export function captureCheckpoint(
  repoRoot: string,
  sessionId: string,
  opts: CaptureOptions = {},
): CheckpointRecord {
  if (!isCheckpointSessionId(sessionId)) {
    throw new Error(`not a usable session id: ${String(sessionId)}`);
  }
  for (const extra of opts.files ?? []) trackSessionWrite(repoRoot, sessionId, extra);

  const now = opts.now ?? Date.now;
  const tracked = readTracked(repoRoot, sessionId);
  const files = tracked.files.map((t) => snapshotFile(repoRoot, sessionId, t.path));

  // THE CONVERSATION IS READ FROM THE SESSION STORE, never from the caller. A
  // caller-supplied transcript could disagree with what the app will show after
  // a restore, and then "restore conversation" would put back a conversation
  // that never happened.
  let conversation: CheckpointTurn[] | undefined;
  const index = readSessionIndex(repoRoot);
  if (index && index.sessions.some((s) => s.id === sessionId)) {
    conversation = readSessionChat(repoRoot, sessionId).turns.map((t) => ({ ...t }));
  }

  const prior = listCheckpoints(repoRoot, sessionId);
  const seq = prior.length > 0 ? prior[prior.length - 1].seq + 1 : 1;
  const record: CheckpointRecord = {
    seq,
    at: now(),
    sessionId,
    ...(opts.label !== undefined ? { label: opts.label } : {}),
    files,
    ...(conversation ? { conversation } : {}),
  };
  const file = logFile(repoRoot, sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  pruneAndSweep(repoRoot, sessionId);
  return record;
}

/** What a restore is allowed to move. */
export type RestoreScope = 'code' | 'conversation' | 'both';

/** One file the plan will rewrite. */
export interface PlannedWrite {
  path: string;
  /** The byte length the file will have afterwards. */
  bytes: number;
  blob: string;
}

/**
 * EXACTLY WHAT A RESTORE WOULD DO, produced without doing any of it.
 *
 * This is P10's honesty requirement in a type: a caller renders `touches`,
 * `writes` and `deletes` to a user, and only then hands the SAME object to
 * {@link applyRestore}. There is no entry point that acts without having
 * produced this first.
 */
export interface RestorePlan {
  ok: boolean;
  sessionId: string;
  seq: number;
  /** What the caller asked to restore. */
  requestedScope: RestoreScope;
  /**
   * What this restore WILL actually move. It can be narrower than
   * `requestedScope` — asking for `both` on a checkpoint that captured no
   * conversation restores code only, and `notes` says so.
   */
  touches: { code: boolean; conversation: boolean };
  /** Files whose content will change. */
  writes: PlannedWrite[];
  /** Files that will be DELETED because they did not exist at the checkpoint. */
  deletes: string[];
  /** Files already byte-identical to the checkpoint — listed, not written. */
  unchanged: string[];
  /**
   * Files the checkpoint references whose blob is gone. Non-empty ⇒ `ok:false`
   * and {@link applyRestore} refuses: a partial restore is worse than none.
   */
  unrecoverable: string[];
  /** How many turns the conversation will be set back to. Absent when untouched. */
  conversationTurns?: number;
  /** Everything the caller should be told that the fields above do not say. */
  notes: string[];
  /** Present only when `ok` is false. */
  error?: string;
}

/** What {@link applyRestore} actually did. */
export interface RestoreResult {
  ok: boolean;
  wrote: string[];
  deleted: string[];
  conversationRestored: boolean;
  error?: string;
}

function sha256File(abs: string): string | null {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Compute the plan. PURE: opens nothing for writing, creates nothing, and is
 * safe to call as often as a UI likes.
 *
 * The target state for a path is the checkpoint's snapshot of it; for a file
 * the session first touched AFTER this checkpoint (so it appears in no
 * snapshot) the target is that file's BASELINE — see the header for why that is
 * the only honest answer.
 */
export function planRestore(
  repoRoot: string,
  sessionId: string,
  seq: number,
  requestedScope: RestoreScope,
): RestorePlan {
  const empty: RestorePlan = {
    ok: false,
    sessionId: String(sessionId),
    seq,
    requestedScope,
    touches: { code: false, conversation: false },
    writes: [],
    deletes: [],
    unchanged: [],
    unrecoverable: [],
    notes: [],
  };
  if (!isCheckpointSessionId(sessionId)) {
    return { ...empty, error: 'not a usable session id' };
  }
  const record = readCheckpoint(repoRoot, sessionId, seq);
  if (!record) {
    return { ...empty, error: `no checkpoint ${seq} for session ${sessionId}` };
  }

  const notes: string[] = [];
  const wantCode = requestedScope === 'code' || requestedScope === 'both';
  const wantConversation = requestedScope === 'conversation' || requestedScope === 'both';

  const writes: PlannedWrite[] = [];
  const deletes: string[] = [];
  const unchanged: string[] = [];
  const unrecoverable: string[] = [];

  if (wantCode) {
    const target = new Map<string, FileSnapshot>();
    for (const f of record.files) target.set(f.path, f);
    for (const t of readTracked(repoRoot, sessionId).files) {
      if (!target.has(t.path)) {
        // First touched AFTER this checkpoint ⇒ its state then was its baseline.
        target.set(t.path, { ...t.baseline, path: t.path });
      }
    }
    for (const snap of [...target.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      const abs = path.join(repoRoot, snap.path);
      if (snap.blob === undefined) {
        // Did not exist at the checkpoint. Delete it if it does now.
        if (fs.existsSync(abs)) deletes.push(snap.path);
        continue;
      }
      if (!fs.existsSync(blobPath(repoRoot, sessionId, snap.blob))) {
        unrecoverable.push(snap.path);
        continue;
      }
      if (sha256File(abs) === snap.blob) {
        unchanged.push(snap.path);
        continue;
      }
      writes.push({ path: snap.path, bytes: snap.bytes ?? 0, blob: snap.blob });
    }
  }

  let conversationTurns: number | undefined;
  let touchesConversation = false;
  if (wantConversation) {
    if (!record.conversation) {
      notes.push(
        'this checkpoint captured no conversation (there was no such session on disk when it was taken) — the conversation will not be touched',
      );
    } else {
      const index = readSessionIndex(repoRoot);
      if (!index || !index.sessions.some((s) => s.id === sessionId)) {
        notes.push(
          'the session is no longer in the session index — the conversation cannot be restored and will not be touched',
        );
      } else {
        touchesConversation = true;
        conversationTurns = record.conversation.length;
      }
    }
  }

  const touchesCode = writes.length > 0 || deletes.length > 0;
  if (wantCode && !touchesCode && unrecoverable.length === 0) {
    notes.push('every tracked file already matches this checkpoint — no file will be written');
  }
  if (unrecoverable.length > 0) {
    return {
      ok: false,
      sessionId,
      seq,
      requestedScope,
      touches: { code: false, conversation: false },
      writes,
      deletes,
      unchanged,
      unrecoverable,
      ...(conversationTurns !== undefined ? { conversationTurns } : {}),
      notes,
      error:
        `${unrecoverable.length} file snapshot(s) are missing from this checkpoint's blob store; ` +
        'nothing was restored rather than restoring part of the tree',
    };
  }

  return {
    ok: true,
    sessionId,
    seq,
    requestedScope,
    touches: { code: touchesCode, conversation: touchesConversation },
    writes,
    deletes,
    unchanged,
    unrecoverable,
    ...(conversationTurns !== undefined ? { conversationTurns } : {}),
    notes,
  };
}

/**
 * Carry out a plan produced by {@link planRestore}.
 *
 * TAKES A PLAN, NOT A REQUEST. That is the whole honesty mechanism: the
 * statement of what will be touched has to exist before anything is touched,
 * because it is the argument. A plan with `ok:false` is refused here too, so a
 * caller that ignored the flag still cannot half-restore a tree.
 *
 * Blob content is verified against its own name before it is written back. A
 * corrupted blob is a refusal, not a file quietly restored to the wrong bytes.
 */
export function applyRestore(repoRoot: string, plan: RestorePlan): RestoreResult {
  if (!plan.ok) {
    return {
      ok: false,
      wrote: [],
      deleted: [],
      conversationRestored: false,
      error: plan.error ?? 'refusing to apply a plan that is not ok',
    };
  }
  const wrote: string[] = [];
  const deleted: string[] = [];

  // Read and verify EVERY blob before touching the tree: an all-or-nothing
  // restore cannot discover a bad blob halfway through.
  const staged: { abs: string; content: Buffer }[] = [];
  for (const w of plan.writes) {
    const blob = blobPath(repoRoot, plan.sessionId, w.blob);
    let content: Buffer;
    try {
      content = fs.readFileSync(blob);
    } catch {
      return {
        ok: false,
        wrote: [],
        deleted: [],
        conversationRestored: false,
        error: `snapshot for ${w.path} is missing; nothing was restored`,
      };
    }
    const actual = crypto.createHash('sha256').update(content).digest('hex');
    if (actual !== w.blob) {
      return {
        ok: false,
        wrote: [],
        deleted: [],
        conversationRestored: false,
        error: `snapshot for ${w.path} is corrupt (hash mismatch); nothing was restored`,
      };
    }
    staged.push({ abs: path.join(repoRoot, w.path), content });
  }

  for (let i = 0; i < staged.length; i += 1) {
    const s = staged[i];
    fs.mkdirSync(path.dirname(s.abs), { recursive: true });
    fs.writeFileSync(s.abs, s.content);
    wrote.push(plan.writes[i].path);
  }
  for (const rel of plan.deletes) {
    try {
      fs.rmSync(path.join(repoRoot, rel), { force: true });
      deleted.push(rel);
    } catch {
      /* already gone — the destination state is what was asked for */
    }
  }

  let conversationRestored = false;
  if (plan.touches.conversation) {
    const record = readCheckpoint(repoRoot, plan.sessionId, plan.seq);
    if (record?.conversation) {
      const updated = updateSession(repoRoot, plan.sessionId, {
        chat: { version: 1, sessionId: plan.sessionId, turns: record.conversation },
      });
      conversationRestored = updated !== null;
    }
  }

  return { ok: true, wrote, deleted, conversationRestored };
}
