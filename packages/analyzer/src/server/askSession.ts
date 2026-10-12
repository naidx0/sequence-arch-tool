/**
 * WHICH CONVERSATION IS THIS ASK PART OF?
 *
 * The teach contract promises one concept per turn built on what came before,
 * and `lesson.json` exists to carry that across turns. It is keyed by session —
 * so a lesson is only as real as the ask handler's ability to say which session
 * it is in.
 *
 * I reported that `/ask` has no session identity and that adding one meant a new
 * request field plus a client change. **That was wrong.** The identity is
 * already there: `PUT /api/sessions/active` persists `SessionIndex.activeId`,
 * the web client sets it when a conversation is activated, and `readSessionIndex`
 * hands it back. The ask handler simply never read it.
 *
 * `sessionId` in `repoServer.ts` is the AUTHENTICATED USER — a different thing
 * wearing the same word, which is what sent me looking for something that did
 * not exist. That file already warns about the collision in one place
 * ("`threadId`, not `sessionId`"); this module uses `threadId` for the same
 * reason.
 *
 * ── WHAT THIS CANNOT DO, STATED BEFORE IT IS BUILT ON ─────────────────────
 *
 * The active session is whichever conversation was activated LAST. Two windows
 * on one repository share it, so a turn typed in the older window is attributed
 * to the newer one. An explicit `threadId` on the request is therefore always
 * preferred and the active id is the fallback — which is also why the fallback
 * is worth having at all: it works today, with no client change, for the single
 * window that is the actual case.
 */
import { readSessionIndex } from './sessionsStore.js';

/** A thread id is one path segment — it names a directory under `sessions/`. */
const THREAD_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export interface AskSessionResolution {
  threadId?: string;
  /** How it was decided, so a caller can log or test the path taken. */
  source: 'request' | 'active' | 'none';
  /** Present when a supplied id was rejected, so the caller can say why. */
  rejected?: string;
}

/**
 * Resolve the conversation an ask belongs to.
 *
 * An id supplied on the request wins; the workspace's active session is the
 * fallback; and neither being available is reported as `none` rather than as an
 * empty string, because "no conversation" and "a conversation called nothing"
 * are different and only one of them is safe to key a file by.
 */
export function resolveAskThreadId(
  requested: unknown,
  sessionsRoot: string | null,
): AskSessionResolution {
  if (typeof requested === 'string' && requested.trim() !== '') {
    const trimmed = requested.trim();
    /*
     * VALIDATED, because this becomes a PATH SEGMENT under `sessions/`. A
     * traversal here would let a request read or write a lesson outside the
     * workspace, and `..` passes every "is it a non-empty string" check.
     */
    if (!THREAD_ID.test(trimmed) || trimmed === '.' || trimmed === '..') {
      return { source: 'none', rejected: `not a usable thread id: ${JSON.stringify(trimmed)}` };
    }
    return { threadId: trimmed, source: 'request' };
  }
  if (sessionsRoot === null) return { source: 'none' };
  const index = readSessionIndex(sessionsRoot);
  const activeId = index?.activeId;
  if (typeof activeId !== 'string' || activeId.trim() === '') return { source: 'none' };
  const trimmed = activeId.trim();
  /* The stored id gets the same check: a workspace file is not more trusted than
     a request just because it is on disk. */
  if (!THREAD_ID.test(trimmed) || trimmed === '.' || trimmed === '..') {
    return { source: 'none', rejected: `stored activeId is not usable: ${JSON.stringify(trimmed)}` };
  }
  return { threadId: trimmed, source: 'active' };
}
