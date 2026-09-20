/* ══════════════════════════════════════════════════════════════════════════
   WHICH SITTING A WRITE BELONGS TO
   packages/web2/src/review/writeSession.ts

   The engine has carried a complete checkpoint store the whole time:
   `PUT /api/file` takes a PRE-write baseline of every file it is about to
   change, `POST /api/checkpoint` freezes the set, `/api/checkpoints` lists
   them and `/api/rewind` puts the tree back. All of it is reachable. All of it
   is tested. And none of it ever ran, because the store files everything under
   a `sessionId` and THE CLIENT NEVER SENT ONE.

   `isCheckpointSessionId(undefined)` is false, so the write endpoint skipped
   tracking silently — by design, so that callers written before checkpoints
   existed behave byte-identically. The result on screen was the worst kind of
   nothing: every write succeeded, every checkpoint list came back empty, and
   there was no error anywhere to explain why undo had nothing to undo.

   This module is the missing sentence. It is thirty lines.

   ── WHY IT PERSISTS ACROSS RELOADS ───────────────────────────────────────

   `sessionStorage` would be the tidier grouping — one tab, one sitting — but
   it is wrong for THIS feature. You reach for undo *after* something went
   wrong, and "something went wrong" very often includes reloading the page.
   An id that dies with the tab means the checkpoints on disk are still there
   and nothing can name them. So: `localStorage`, and a sitting is a browser
   profile against this origin rather than a tab.

   ── AND WHY IT REVALIDATES WHAT IT READS ─────────────────────────────────

   The id becomes a DIRECTORY NAME under `.sequence/checkpoints/`. The server
   validates it and throws otherwise — but that throw is caught at the write
   site and written to stderr, so a bad id degrades to exactly the silent
   no-capture this module exists to fix. Anything that fails the contract is
   replaced here, where the replacement is visible, rather than sent.
   ══════════════════════════════════════════════════════════════════════════ */

/** Where the id lives. Exported so a test can plant a hostile one. */
export const WRITE_SESSION_KEY = 'sequence.writeSession';

/**
 * The server's rule, `checkpointStore.isCheckpointSessionId`, restated.
 *
 * Restated and not imported: this package must not depend on the analyzer's
 * server internals. A test asserts the two agree, so a change on either side
 * that breaks the other fails rather than silently stops capturing.
 */
const CONTRACT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Optional resolver for the active chat session id (B3.3).
 *
 * Conversation restore only works when checkpoint `sessionId` matches a real
 * chat session on disk. The Review/Rewind client used to mint a separate
 * `sequence.writeSession` UUID, so Files restore could work while Conversation
 * never could. App wires this to `store.session.activeId`.
 */
let sessionIdResolver: (() => string | null | undefined) | null = null;

export function setCheckpointSessionIdResolver(
  fn: (() => string | null | undefined) | null,
): void {
  sessionIdResolver = fn;
}

/**
 * Session id for checkpoint capture / list / restore.
 *
 * Prefers the active chat session when wired and valid; otherwise the
 * persistent write-session id (code-only undo still works).
 */
export function checkpointSessionId(storage: Storage | null = defaultStorage()): string {
  const resolved = sessionIdResolver?.();
  if (typeof resolved === 'string' && CONTRACT.test(resolved)) return resolved;
  return writeSessionId(storage);
}

function mint(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  /* No secure context. This id is a grouping key, never a secret — it names a
     directory the user already owns — so collision, not guessability, is the
     only property that matters, and two of these is plenty. */
  return `s-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 64);
}

/**
 * The id every write from this browser is filed under.
 *
 * Takes its storage rather than reaching for `localStorage`, so a test can run
 * it without a DOM and so the locked-down-browser path is a value, not a mock.
 * Null storage answers with a fresh id: a write that cannot be checkpointed is
 * still a write the user asked for, and refusing it would trade a real edit
 * for a hypothetical undo.
 */
export function writeSessionId(storage: Storage | null = defaultStorage()): string {
  if (!storage) return mint();
  let existing: string | null = null;
  try {
    existing = storage.getItem(WRITE_SESSION_KEY);
  } catch {
    /* Storage access throws outright under some privacy settings. */
    return mint();
  }
  if (typeof existing === 'string' && CONTRACT.test(existing)) return existing;

  const fresh = mint();
  try {
    storage.setItem(WRITE_SESSION_KEY, fresh);
  } catch {
    /* Full, or refused. The id still works for this page's writes; it just
       will not be the same one after a reload. Better than not writing. */
  }
  return fresh;
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
