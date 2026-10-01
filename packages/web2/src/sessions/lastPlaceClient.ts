/* ══════════════════════════════════════════════════════════════════════════
   TELLING THE ENGINE WHERE THE READER IS
   packages/web2/src/sessions/lastPlaceClient.ts

   Owner, 2026-09-21: "there should be client wide memory, remember the last
   prompt, project, folder, mode, everything, in workspaces, sometimes across
   different projects."

   ── WHY THIS IS NOT `localStorage` ────────────────────────────────────────

   The app already keeps plenty in `localStorage` — pane widths, which surfaces
   are open, the composer mode — and none of it ever came back, because the
   desktop shell asked for a FREE PORT on every launch. `localStorage` is keyed
   by origin, so every launch was `http://127.0.0.1:<new>` with an empty
   drawer. That is fixed separately (the shell now re-uses its port), and it is
   still the wrong home for this one fact: the shell has to know which
   repository to start the engine on BEFORE a window exists to read storage
   from.

   So the place goes to the engine, which writes it beside `recent.json`, and
   the shell reads that file cold at launch.

   ── FIRE AND FORGET, DELIBERATELY ─────────────────────────────────────────

   Every call here is best-effort and returns nothing. This is a convenience:
   a reader whose mode did not get recorded has lost nothing they can see, and
   a failed write must never interrupt what they were actually doing. Nothing
   in the product may branch on whether this succeeded.
   ══════════════════════════════════════════════════════════════════════════ */

/** Late-bound, like `sessionsClient`: a module-load capture breaks every test
 *  that installs its own `fetch` after import. */
const liveFetch: typeof fetch = (...args) => globalThis.fetch(...args);

/**
 * Record one or more facts about where the reader is.
 *
 * MERGED by the server, never replaced, so a caller that knows only the mode
 * does not erase the project — see `lastPlace.ts`. Pass `null` to forget a
 * fact, which is how a detach says "no repository" without also forgetting
 * which mode they were in.
 */
export function rememberPlace(
  patch: { repo?: string | null; sessionId?: string | null; mode?: string | null },
  fetchImpl: typeof fetch = liveFetch,
): void {
  try {
    void fetchImpl('/api/last-place', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {
      /* An engine that is starting, stopping, or does not have this route is
         an ordinary state. The reader loses a convenience, not their work. */
    });
  } catch {
    /* no fetch at all (a test host, a torn-down jsdom) */
  }
}
