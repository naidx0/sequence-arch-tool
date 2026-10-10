/* ══════════════════════════════════════════════════════════════════════════
   WHERE THE READER WAS WHEN THEY CLOSED IT
   packages/analyzer/src/server/lastPlace.ts

   Owner, 2026-09-21: "there should be client wide memory, remember the last
   prompt, project, folder, mode, everything, in workspaces, sometimes across
   different projects."

   The desktop shell has always opened on nothing. `main.ts` calls
   `controller.start()` with no argument and says so in its own comment —
   "no-repo start → the web app's home screen takes over" — so every launch
   put the reader back at the beginning regardless of where they had been.
   The project list survived (that is `recent.json`); the PLACE did not.

   ── WHY THIS IS A FILE AND NOT localStorage ───────────────────────────────

   The web app already keeps its own layout in `localStorage` — pane widths,
   which surfaces are open — and that is right for those: they are facts about
   a window. This is not. The desktop shell has to know which repository to
   start the engine on BEFORE any window exists to read `localStorage` from,
   so the answer has to be on disk where a cold process can reach it.

   It sits beside `recent.json` in the user store, for the same reason that
   does: it is a fact about the person, not about a repository, and a
   repository-local file would be lost the moment they opened a different one.

   ── WHAT IT DELIBERATELY DOES NOT HOLD ────────────────────────────────────

   No transcript, no draft text, no model output. A crash-safe record of
   *where* someone was is a few short strings; a record of what they were
   saying is a second copy of the conversation, with its own staleness and its
   own way of disagreeing with `chat.json`. Drafts belong to the chat and are
   restored from it.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';

/** The file, beside `recent.json` in the user store. */
export const LAST_PLACE_FILE = 'last-place.json';

/**
 * Where the reader was.
 *
 * Every field is optional and every reader of this must cope with all of them
 * being absent: this file is a convenience, and a launch that ignores it is
 * still a correct launch. A missing field means "we do not know", never a
 * default — a default written here would be this module deciding something
 * the surfaces already decide for themselves.
 */
export interface LastPlace {
  /** Absolute path of the repository that was attached, if one was. */
  repo?: string;
  /** The chat that was open in it. */
  sessionId?: string;
  /** Plan / Build / Teach, as the composer names them. */
  mode?: string;
  /** ISO, so a reader can tell a stale record from a fresh one. */
  at?: string;
}

function filePath(storeDir: string): string {
  return path.join(storeDir, LAST_PLACE_FILE);
}

/**
 * Read the record. A missing, unreadable or malformed file is an empty place,
 * never an error: this is a convenience, and failing a launch because of it
 * would make the convenience the most dangerous thing in the boot path.
 */
export function readLastPlace(storeDir: string): LastPlace {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath(storeDir), 'utf8'));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim() !== '' ? v : undefined;

  const place: LastPlace = {};
  /* The repo is the one field with a correctness consequence — the shell
     starts the engine on it — so it is also checked against the disk. A path
     that is no longer a directory is not "where they were", it is a folder
     they have since moved or deleted, and starting on it would fail the
     launch to honour a memory. */
  const repo = str(row.repo);
  if (repo !== undefined && path.isAbsolute(repo)) {
    try {
      if (fs.statSync(repo).isDirectory()) place.repo = repo;
    } catch {
      /* gone, or unreachable right now — either way, not a place to open on */
    }
  }
  const sessionId = str(row.sessionId);
  if (sessionId !== undefined) place.sessionId = sessionId;
  const mode = str(row.mode);
  if (mode !== undefined) place.mode = mode;
  const at = str(row.at);
  if (at !== undefined) place.at = at;
  return place;
}

/**
 * Record where the reader is now, merging into what is already known.
 *
 * MERGING, NOT REPLACING. The three facts are learned at different moments by
 * different callers — a repo on attach, a chat on activate, a mode when it is
 * switched — and a write that replaced the record would mean whichever fired
 * last erased the other two. Passing `null` for a field forgets it, which is
 * how a detach says "no repository" without also forgetting the mode.
 *
 * Best-effort: a read-only home must never break an attach, so a failed write
 * is swallowed. The cost of losing this file is opening on the home screen.
 */
export function writeLastPlace(
  storeDir: string,
  patch: { repo?: string | null; sessionId?: string | null; mode?: string | null },
): LastPlace {
  const current = readLastPlace(storeDir);
  const next: LastPlace = { ...current, at: new Date().toISOString() };

  for (const key of ['repo', 'sessionId', 'mode'] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null || value === undefined || value === '') delete next[key];
    else next[key] = value;
  }

  try {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(filePath(storeDir), JSON.stringify(next, null, 2));
  } catch {
    /* read-only home — the place is reported, it just does not stick */
  }
  return next;
}
