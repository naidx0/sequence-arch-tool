import fs from 'node:fs';
import path from 'node:path';

/**
 * THE PLACE A GENERAL CHAT KEEPS ITS FILES, AND THE ANSWER TO "WHERE".
 *
 * Owner, 2026-09-13: *"It should default to a workspace wherever it's
 * installed, or make one … then we know where it's writing files, its cache,
 * all of that."*
 *
 * Measured before this existed: with no repository attached, `activeRoot()`
 * throws and `executeAskToolUnderModeGates` answers every file tool with
 * `refused: <name> needs an attached repo`. So a General chat could not read a
 * file, could not write one, and could not say where it would have put one. The
 * product's own first law is local-first — "the app boots and delivers its core
 * with no network and no key" — and the commonest thing anybody wants from a
 * local assistant, a place to keep work, was the one thing it had no answer
 * for.
 *
 * ── WHY NOT JUST MAKE IT THE repoRoot ────────────────────────────────────────
 *
 * Because `repoRoot` is load-bearing for a DIFFERENT claim. Non-null repoRoot
 * means "a repository was scanned and the digest below describes it", and every
 * grounding rule in `explain.ts` is written against that. Pointing it at an
 * empty workspace directory would make the prompt assert a repository that does
 * not exist — fabricating structure, which is §12 and the whole product.
 *
 * So the workspace is its OWN root, with its own name in the prompt, and the
 * tools that operate on it say plainly which of the two they are touching.
 *
 * ── WHERE ───────────────────────────────────────────────────────────────────
 *
 * `<user store>/workspace`, beside `ai.json` and `github.json` — the user store
 * is already the answer to "the per-user things that are not per-repo", and it
 * already honours `SEQUENCE_USER_DIR` so a test run cannot touch a real one.
 * `SEQUENCE_WORKSPACE` moves it outright, for someone who wants their work in
 * their own Documents folder rather than in a dotfile directory.
 *
 * CREATED LAZILY AND NEVER ON READ. Resolving the path must not have a side
 * effect: `GET /api/workspace` on a machine that has never used one should say
 * "here is where it will be" and leave the disk alone. {@link ensureWorkspace}
 * is the one function that makes the directory, and only a write calls it.
 */

/** The directory name under the user store. */
export const WORKSPACE_DIR = 'workspace';

/**
 * Where the workspace IS, without touching the disk.
 *
 * A relative `SEQUENCE_WORKSPACE` is ignored rather than resolved against an
 * incidental cwd — the same rule, for the same reason, as `SEQUENCE_USER_DIR`
 * in `store.ts`: a server started from a different directory must not silently
 * keep the user's work somewhere new.
 */
export function workspaceRoot(storeDir: string): string {
  const override = process.env.SEQUENCE_WORKSPACE;
  if (override !== undefined && override !== '' && path.isAbsolute(override)) return override;
  return path.join(storeDir, WORKSPACE_DIR);
}

/** Seeded General-home folders — user files only, not session product state. */
export const WORKSPACE_SEED_DIRS = ['charts', 'drawings', 'memory', 'context'] as const;

const SEED_README: Record<(typeof WORKSPACE_SEED_DIRS)[number], string> = {
  charts: '# Charts\n\nExport or save chart artifacts here.\n',
  drawings: '# Drawings\n\nWhiteboard and sketch exports land here.\n',
  memory: '# Memory\n\nNotes and durable context you want the assistant to keep as files.\n',
  context: '# Context\n\nScratch context packs and pasted references.\n',
};

/**
 * Make the workspace exist and return its REAL path.
 *
 * Real, because `resolveInRepo` canonicalises through `realpath` and compares
 * against the root it was given: on macOS `~` is under `/Users` which is itself
 * reachable through `/private`-style links, and on Windows a user directory can
 * sit behind a junction. A root that is not already canonical makes the jail
 * reject every path inside it — a failure that looks exactly like a security
 * refusal and is actually a path-spelling bug.
 *
 * Also seeds `charts/`, `drawings/`, `memory/`, `context/` once so General
 * Files has an obvious place for local work (owner walk 2026-09-15).
 */
export function ensureWorkspace(storeDir: string): string {
  const root = workspaceRoot(storeDir);
  fs.mkdirSync(root, { recursive: true });
  for (const name of WORKSPACE_SEED_DIRS) {
    const dir = path.join(root, name);
    fs.mkdirSync(dir, { recursive: true });
    const readme = path.join(dir, 'README.md');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, SEED_README[name], 'utf8');
    }
  }
  return fs.realpathSync(root);
}

/** One entry of the workspace, as the UI lists it. */
export interface WorkspaceEntry {
  /** Forward-slashed, workspace-relative. Never absolute — see `jail.ts`. */
  path: string;
  kind: 'file' | 'dir';
  /** Bytes, for a file. Absent on a directory: a directory has no honest size. */
  bytes?: number;
  /** Last write, ISO. Absent when the stat could not be read. */
  modified?: string;
}

/** Enough to be useful, few enough that the listing is one response. */
export const MAX_WORKSPACE_ENTRIES = 500;
/** Deep enough for a project, shallow enough that a stray node_modules cannot hang it. */
const MAX_WORKSPACE_DEPTH = 6;

/**
 * Directories that are never listed.
 *
 * `.sequence` because the user store's own files are not the user's work, and
 * the rest because a workspace someone has run a build in should still list in
 * one response. This is a LISTING rule, not a security one — the jail is the
 * security boundary and it is enforced separately, on every path.
 */
const SKIP_DIRS = new Set(['.git', '.sequence', 'node_modules', '.venv', '__pycache__', 'dist']);

export interface WorkspaceListing {
  /** The absolute path, so the user can find it in their own file manager. */
  root: string;
  /** False when nothing has been written yet — the honest empty state. */
  exists: boolean;
  entries: WorkspaceEntry[];
  /** Entries past the cap. A count, never a silent truncation. */
  omitted: number;
}

/**
 * List the workspace, breadth-first, capped.
 *
 * BREADTH-FIRST so the cap costs the deepest files rather than everything after
 * the first big directory — a depth-first walk that hits the cap inside one
 * subtree reports a workspace that looks like it contains one folder.
 *
 * Does not create the directory. `exists: false` with an empty list is the
 * honest state of a machine that has never written anything, and is what lets
 * the UI say "nothing here yet" and still name the path.
 */
export function listWorkspace(storeDir: string): WorkspaceListing {
  const root = workspaceRoot(storeDir);
  let real: string;
  try {
    real = fs.realpathSync(root);
  } catch {
    return { root, exists: false, entries: [], omitted: 0 };
  }
  const entries: WorkspaceEntry[] = [];
  let omitted = 0;
  /* [absolute dir, relative prefix, depth] */
  const queue: [string, string, number][] = [[real, '', 0]];
  while (queue.length > 0) {
    const [dir, prefix, depth] = queue.shift()!;
    let names: fs.Dirent[];
    try {
      names = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; /* unreadable directory is not a fatal listing */
    }
    names.sort((a, b) => a.name.localeCompare(b.name));
    for (const dirent of names) {
      const rel = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
      if (dirent.isDirectory()) {
        if (SKIP_DIRS.has(dirent.name)) continue;
        if (entries.length >= MAX_WORKSPACE_ENTRIES) {
          omitted += 1;
          continue;
        }
        entries.push({ path: rel, kind: 'dir' });
        if (depth + 1 < MAX_WORKSPACE_DEPTH) {
          queue.push([path.join(dir, dirent.name), rel, depth + 1]);
        }
        continue;
      }
      if (!dirent.isFile()) continue; /* sockets, devices, dangling links */
      if (entries.length >= MAX_WORKSPACE_ENTRIES) {
        omitted += 1;
        continue;
      }
      const entry: WorkspaceEntry = { path: rel, kind: 'file' };
      try {
        const st = fs.statSync(path.join(dir, dirent.name));
        entry.bytes = st.size;
        entry.modified = st.mtime.toISOString();
      } catch {
        /* A file we can see but not stat still EXISTS, and saying so with no
           size is more honest than dropping it from the listing. */
      }
      entries.push(entry);
    }
  }
  return { root: real, exists: true, entries, omitted };
}

/**
 * What the prompt says about the workspace.
 *
 * NAMES IT AS NOT-A-REPOSITORY in its own first line, because that is the whole
 * risk of handing file tools to a repo-less turn: a model that has just read
 * `notes.md` off disk is one sentence away from describing "the repository".
 * The grounding rule in `buildAskPrompt` says never claim a repository; this
 * says what the files it CAN see actually are.
 *
 * Empty ⇒ no section. A line saying "your workspace is empty" on every General
 * turn is a permanent hedge, which `renderScanCoverageSection` already refuses
 * for the same reason.
 */
export function renderWorkspaceSection(listing: WorkspaceListing): string[] {
  if (!listing.exists || listing.entries.length === 0) return [];
  /*
   * Seed READMEs under charts/drawings/memory/context are scaffolding for the
   * Files empty-state, not the user's work. Listing them on every General turn
   * would be a permanent hedge — the same defect an empty-workspace banner is.
   */
  const seedReadme = new Set(WORKSPACE_SEED_DIRS.map((d) => `${d}/README.md`));
  const files = listing.entries.filter((e) => e.kind === 'file' && !seedReadme.has(e.path));
  if (files.length === 0) return [];
  const L: string[] = ['--- YOUR LOCAL WORKSPACE ---'];
  L.push(
    'These files are in the local workspace folder this chat keeps its work in. They are NOT a ' +
      'scanned repository and nothing here describes one: do not call them "the repo", do not ' +
      'infer a project structure from them, and do not claim anything about code you have not ' +
      'read. Paths below are workspace-relative and are the only paths the file tools accept.',
  );
  for (const f of files.slice(0, 60)) {
    L.push(`- ${f.path}${f.bytes === undefined ? '' : ` (${f.bytes} bytes)`}`);
  }
  const hidden = files.length - Math.min(files.length, 60) + listing.omitted;
  if (hidden > 0) L.push(`- (+${hidden} more file(s) not listed here)`);
  return L;
}
