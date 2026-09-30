/**
 * WHICH BUILD IS THIS SERVER ACTUALLY RUNNING?
 *
 * A day-old `sequence app` served 4173 while five changes sat in `dist`
 * unrun — the derived visual, the reasoning narrowing and the one-assembly
 * teach turn among them. A person opened the product, waited two minutes for a
 * turn that wrote no lesson and drew no chart, and every one of those defects
 * had already been fixed. Worse, three seat reads were done against a
 * separately-started instance, so the stale one was never noticed: **a running
 * server that cannot say what it is running will eventually pass for the
 * product.**
 *
 * This reports two facts and draws no conclusion from them:
 *
 *   - `startedAt` — when this process began
 *   - `builtAt`   — the mtime of the entry file it is executing
 *
 * If `builtAt` is NEWER than `startedAt`, the code on disk moved after this
 * process loaded it and the server is stale. That comparison is the caller's,
 * because "stale" during an active rebuild is normal and only a reader knows
 * whether it matters.
 *
 * The mtime of the entry file, not a git commit: the commit says what the
 * WORKING TREE is on, which is not what a running process loaded. A server
 * started before a rebuild reports the same commit as one started after it,
 * and that is exactly the confusion this exists to end.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** One half of the product: a built artefact and the source it was built from. */
export interface HalfStamp {
  /** ISO mtime of the built artefact, or null when it cannot be read. */
  builtAt: string | null;
  /** ISO mtime of the newest source file behind it, or null. */
  sourceAt: string | null;
  /** True when the source is newer than the build — this half needs rebuilding. */
  stale: boolean;
}

export interface BuildStamp {
  /** ISO time this process started. */
  startedAt: string;
  /** ISO mtime of the running entry file, or null when it cannot be read. */
  builtAt: string | null;
  /**
   * True when ANY half is behind: the server process older than its own code,
   * the server build older than its source, or the CLIENT BUNDLE older than
   * its source.
   *
   * The third is the one that was missing, and it cost a real defect. On
   * 2026-09-06 the server ran a build made minutes earlier while the browser was
   * served a bundle from the previous night; the two halves of one commit were
   * in two packages, `stale` reported false, and a refusal that had passed seven
   * planted cases was simply absent from the product. A stale check that knows
   * about one half of a two-half product answers a question nobody asked.
   */
  stale: boolean;
  /** The server half: dist against src. */
  server?: HalfStamp;
  /** The client half: the served bundle against packages/web2/src. */
  client?: HalfStamp;
}

const STARTED_AT = new Date();

/**
 * The newest source file under a directory, or null.
 *
 * Bounded deliberately: source extensions only, `node_modules` and `dist`
 * skipped, and an unreadable tree answers null rather than "nothing is newer",
 * because a walk that fails must not report a stale half as fresh.
 */
function newestSource(dir: string): Date | null {
  let newest: Date | null = null;
  const SRC = /\.(ts|tsx|js|jsx|mjs|cjs|css)$/;
  const walk = (d: string, depth: number): void => {
    if (depth > 12) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const full = `${d}/${e.name}`;
      if (e.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!SRC.test(e.name)) continue;
      try {
        const m = fs.statSync(full).mtime;
        if (newest === null || m.getTime() > newest.getTime()) newest = m;
      } catch {
        /* a file that vanished mid-walk is not evidence about the build */
      }
    }
  };
  walk(dir, 0);
  return newest;
}

/** Compare one built artefact against the source behind it. */
function half(builtPath: string | null, srcDir: string | null): HalfStamp {
  let builtAt: Date | null = null;
  if (builtPath !== null) {
    try {
      builtAt = fs.statSync(builtPath).mtime;
    } catch {
      builtAt = null;
    }
  }
  const sourceAt = srcDir === null ? null : newestSource(srcDir);
  return {
    builtAt: builtAt === null ? null : builtAt.toISOString(),
    sourceAt: sourceAt === null ? null : sourceAt.toISOString(),
    /*
     * CANNOT BE DECIDED IS NOT FRESH. With either side unreadable this reports
     * `false` and says so through the nulls beside it, rather than asserting a
     * staleness it did not measure — the same rule as the lock that must not
     * guess a holder alive.
     */
    stale: builtAt !== null && sourceAt !== null && sourceAt.getTime() > builtAt.getTime(),
  };
}

export function buildStamp(entry?: string, halves?: { serverDist?: string; serverSrc?: string; clientBundle?: string; clientSrc?: string }): BuildStamp {
  let builtAt: Date | null = null;
  try {
    /* `process.argv[1]` is the script node was given — `dist/cli.js` for the
       app. Falling back to this module keeps the answer honest under a test
       runner, where argv[1] is the runner rather than the product. */
    const target = entry ?? process.argv[1] ?? fileURLToPath(import.meta.url);
    builtAt = fs.statSync(target).mtime;
  } catch {
    /* An unreadable entry is reported as null, never guessed at: a wrong
       timestamp here would make a stale server look fresh, which is the failure
       this file exists to prevent. */
    builtAt = null;
  }
  const processStale = builtAt !== null && builtAt.getTime() > STARTED_AT.getTime();
  const server = halves?.serverDist === undefined && halves?.serverSrc === undefined
    ? undefined
    : half(halves.serverDist ?? null, halves.serverSrc ?? null);
  const client = halves?.clientBundle === undefined && halves?.clientSrc === undefined
    ? undefined
    : half(halves.clientBundle ?? null, halves.clientSrc ?? null);
  return {
    startedAt: STARTED_AT.toISOString(),
    builtAt: builtAt === null ? null : builtAt.toISOString(),
    stale: processStale || server?.stale === true || client?.stale === true,
    ...(server === undefined ? {} : { server }),
    ...(client === undefined ? {} : { client }),
  };
}
