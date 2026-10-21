import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePolicy, type Policy } from '@sequence/schema';
import { isContainedInBrowseRoot, resolveInBrowseRoot } from './browse.js';
import { parseHookFile, type HookFile, type HookTrust } from './hooks.js';
import { ensureSequenceIgnoredAsync } from './sequenceIgnore.js';
import { SEQUENCE_CACHE_FILE, writeUnlessTracked } from './trackedSequence.js';
import { dropPending, readPending, scheduleWrite, tmpName } from './asyncWriter.js';

/**
 * The per-project memory layer. Everything the platform remembers about a repo
 * lives under `<repo>/.sequence/` — the design spec it was generated from, the
 * cached explanations/annotations/function graph, and the AI + GitHub configs.
 * The directory is created lazily on the first write and survives across server
 * restarts (that is the whole point: reopen the same repo and what the platform
 * learned about it is still there).
 *
 * `.sequence/` starts with a dot, so the scanner's walk and the file-tree
 * endpoint both skip it — the memory dir never pollutes a scan or a tree.
 */
export const SEQUENCE_DIR = '.sequence';

function sequencePath(repoRoot: string, file: string): string {
  return path.join(repoRoot, SEQUENCE_DIR, file);
}

/** Read and JSON-parse a `.sequence/<file>`; returns undefined when absent. */
export function readJson<T = unknown>(repoRoot: string, file: string): T | undefined {
  const p = sequencePath(repoRoot, file);
  /* A deferred write that has not reached the disk yet is still the truth for this process. */
  const queued = readPending(p);
  if (queued !== undefined) return JSON.parse(queued) as T;
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

/** {@link readJson} without a sync filesystem call: for the request path, where a sync read stalls every other request. */
export async function readJsonAsync<T = unknown>(repoRoot: string, file: string): Promise<T | undefined> {
  const p = sequencePath(repoRoot, file);
  const queued = readPending(p);
  if (queued !== undefined) return JSON.parse(queued) as T;
  let text: string;
  try {
    text = await fs.promises.readFile(p, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw e;
  }
  return JSON.parse(text) as T;
}

/**
 * Write `value` (pretty JSON) to `.sequence/<file>`, creating parent dirs lazily.
 *
 * 0.1.8.1 B3: git is told to ignore `.sequence/` (the repo's LOCAL
 * `.git/info/exclude`, once per root per process) by the first write, not
 * only from the snapshot and worktree paths. The check runs in the BACKGROUND
 * (never git on the event loop) and the write does not wait for it, so a first
 * write to a root lands a moment before the rule does.
 */
export function writeJson(repoRoot: string, file: string, value: unknown, opts: WriteJsonOptions = {}): void {
  kickSequenceIgnored(repoRoot);
  /* A cache file the repo COMMITS is the person's: left as it is (see trackedSequence.ts). */
  if (SEQUENCE_CACHE_FILE.test(file)) {
    /* Not known yet: the write is queued and replayed once git has answered, never dropped. */
    writeUnlessTracked(repoRoot, `${SEQUENCE_DIR}/${file}`, () => writeJsonNow(repoRoot, file, value, opts));
    return;
  }
  writeJsonNow(repoRoot, file, value, opts);
}

function writeJsonNow(repoRoot: string, file: string, value: unknown, opts: WriteJsonOptions): void {
  const p = sequencePath(repoRoot, file);
  const text = opts.compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  if (opts.defer) {
    /* Queued behind the debounced async writer; readJson in this process sees it at once. */
    const merge = opts.merge;
    scheduleWrite(
      p,
      text,
      merge ? (disk) => (opts.compact ? JSON.stringify(merge(JSON.parse(disk))) : JSON.stringify(merge(JSON.parse(disk)), null, 2)) : undefined,
    );
    return;
  }
  dropPending(p);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  atomicWriteFileSync(p, text);
}

/** Roots whose git ignore check is running right now (one at a time per root). */
const ignoreKicked = new Set<string>();

/**
 * Make sure git ignores `.sequence/` in `repoRoot` WITHOUT blocking the event loop: the check runs in the
 * background (once per root, memoised in sequenceIgnore.ts) and the write goes ahead, since the check only
 * ever adds an ignore rule. The sync form spawned git on the loop for the first write to every root.
 */
function kickSequenceIgnored(repoRoot: string): void {
  if (ignoreKicked.has(repoRoot)) return;
  ignoreKicked.add(repoRoot);
  void ensureSequenceIgnoredAsync(repoRoot)
    .catch(() => {
      /* git missing or the exclude unwritable: the write itself still happens */
    })
    .finally(() => ignoreKicked.delete(repoRoot));
}

export interface WriteJsonOptions {
  /** No pretty-printing: for files only the program reads. Files a person may open keep the default. */
  compact?: boolean;
  /**
   * Hand the write to the debounced async writer (it reaches the disk within ~75 ms, or at exit). ONLY for state
   * nobody was told is saved: a write a person has been acknowledged for stays synchronous and fsynced.
   */
  defer?: boolean;
  /**
   * With `defer`: apply this to the file's content at drain time (instead of writing the whole value blind), so a
   * change another process made to the file in the meantime survives. Falls back to the value when the file is absent.
   */
  merge?: (disk: any) => unknown;
}

/** Remove `*.tmp` files a crash left beside the data (older than a minute, so a write in flight is never touched). */
export function sweepStaleTmp(dir: string, now = Date.now()): void {
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.tmp')) continue;
      const p = path.join(dir, name);
      try {
        if (now - fs.statSync(p).mtimeMs > 60_000) fs.unlinkSync(p);
      } catch {
        /* gone or busy */
      }
    }
  } catch {
    /* no folder yet */
  }
}

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Write a file so a crash or a power cut leaves the old one or the new one,
 * never half of either (but see the fallback below): a temp file beside it, flushed, then renamed over it.
 * Windows refuses a rename onto a file another process (a virus scanner, a
 * sync client) has open for a moment: retry briefly (this blocks the event
 * loop for at most ~210 ms), then fall back to a plain write, which is not
 * atomic (the chat store's .bak covers that case) so the data is never lost
 * to the rename.
 */
export function atomicWriteFileSync(p: string, text: string): void {
  const tmp = tmpName(p);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text);
    try {
      fs.fsyncSync(fd);
    } catch {
      /* A filesystem without fsync still gets the rename. */
    }
  } catch (e) {
    /* A full disk leaves no half-written temp behind. */
    try {
      fs.closeSync(fd);
      fs.unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw e;
  }
  fs.closeSync(fd);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, p);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && i < 6) {
        pause(10 * (i + 1));
        continue;
      }
      try {
        fs.writeFileSync(p, text);
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* already gone */
        }
      }
      return;
    }
  }
}

/**
 * The same write as `atomicWriteFileSync`, for a big file: the text arrives in parts and goes to the temp file
 * through the async file API, so the event loop keeps turning while it is written. Same temp name, fsync and
 * rename (with the Windows retry); the rare fallback is a direct write.
 */
export async function atomicWriteFileParts(p: string, parts: readonly string[]): Promise<void> {
  const tmp = tmpName(p);
  const fh = await fs.promises.open(tmp, 'w');
  try {
    for (const part of parts) await fh.write(part);
    try {
      await fh.sync();
    } catch {
      /* A filesystem without fsync still gets the rename. */
    }
  } catch (e) {
    await fh.close().catch(() => undefined);
    await fs.promises.unlink(tmp).catch(() => undefined);
    throw e;
  }
  await fh.close();
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, p);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && i < 6) {
        pause(10 * (i + 1));
        continue;
      }
      try {
        fs.writeFileSync(p, parts.join(''));
      } finally {
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* already gone */
        }
      }
      return;
    }
  }
}

/** Write raw text to `.sequence/<file>`, creating parent dirs lazily. */
export function writeSequenceText(repoRoot: string, file: string, content: string): void {
  const p = sequencePath(repoRoot, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/**
 * The design spec the project was last GENERATED from (written by /api/generate
 * on success; read back by generate, the DDL preview, and the prompt-file
 * conformance diff). r179 removed the never-called GET|PUT /api/spec endpoints:
 * generate is now the only writer, so the file always describes a real design
 * that really produced code — never an unrelated blob a client happened to PUT.
 *
 * (`state.json` — free-form per-project UI state — is GONE as of r179: nothing
 * in any package ever read or wrote it except the endpoint pair no surface
 * called. Nothing writes that filename any more.)
 */
export const SPEC_FILE = 'spec.json';
/**
 * Cached plain-English explanation (the PlainTree) for the currently attached
 * repo, produced by POST /api/explain. Cached under `.sequence/` so re-opening a
 * repo is instant; invalidated on every rescan (the structure it explains
 * changed). Read-only-derived — holds no secrets, just the translation.
 */
export const EXPLAIN_FILE = 'explain.json';
/**
 * Cached per-node plain-English annotation bullets for the currently attached
 * repo, produced by POST /api/annotate. Cached under `.sequence/` so re-opening
 * a repo is instant; invalidated on every rescan (keyed on `scannedAt`). Read-only-
 * derived — holds no secrets, just grounded annotation text.
 */
export const ANNOTATIONS_FILE = 'annotations.json';
/**
 * Cached function-level graph for the currently attached repo, produced by
 * GET /api/functions. Cached under `.sequence/` so re-opening a repo is instant;
 * invalidated on every rescan (keyed on `scannedAt`). Read-only-derived — holds
 * no secrets, just grounded function nodes and intra-file call edges.
 */
export const FUNCTIONS_FILE = 'functions.json';
/**
 * B1 — Sequence-native Task Board state (React Flow nodes/edges + viewport).
 * Git-ignored under `.sequence/` like other platform memory.
 */
export const BOARD_FILE = 'board.json';
/** Cross-session shared product chat transcript (gitignored under .sequence/). */
export const CHAT_MEMORY_FILE = 'chat-memory.json';
/** Per-session chat + board snapshots (gitignored under .sequence/sessions/). */
export const SESSIONS_DIR = 'sessions';
export const SESSIONS_INDEX_FILE = `${SESSIONS_DIR}/index.json`;
/**
 * AI provider config (bring-your-own-key). Kept in its OWN file, separate from
 * the free-form state.json, so the API key never rides along in the UI state
 * blob. `.sequence/` is git-ignored, so this file (key and all) stays out of
 * version control.
 */
export const AI_FILE = 'ai.json';

/* =========================== per-org harness policies ====================== *
 *
 * G-E. `.sequence/policies/*.json` — declarative rules the ORG committed to
 * THEIR repo that customise how the harness judges a proposed change ("no new
 * sync call into the pricing path"). Unlike everything else under `.sequence/`,
 * these are SOURCE: they are carved out of the gitignore in the same commit that
 * added this reader, because a policy that does not survive a fresh clone is not
 * a policy.
 *
 * A DIRECTORY, not one file, so an org can split rules by concern and review
 * them separately — and so two teams editing different concerns never collide in
 * one blob.
 */

/** The policies sub-directory of `.sequence/`. */
export const POLICIES_DIR = 'policies';

export interface LoadedPolicies {
  /** Every file that parsed AND validated, in filename order. */
  policies: Policy[];
  /**
   * One line per file that did NOT, naming the file and what was wrong.
   * NEVER silently dropped: a policy the user believes is enforced but which the
   * server quietly ignored is the worst outcome this feature can produce
   * (HANDOFF §7.5 — "silence is the worst failure mode"). The caller surfaces
   * these; the UI prints them.
   */
  warnings: string[];
}

/**
 * Read every `.sequence/policies/*.json` under `repoRoot`, validating each with
 * {@link validatePolicy}. TOTAL: a missing directory, an unreadable one, a file
 * that is not JSON, and a file that is JSON but not a valid policy all resolve
 * to "no policy from that file, plus a named warning" — never a throw, never a
 * half-loaded set. Deterministic: files are read in sorted filename order, so
 * the composed rule order is the same on every machine.
 *
 * Only `*.json` DIRECT children are considered: no recursion (a nested tree
 * invites a symlink walk for no expressive gain) and no other extension.
 */
export function readPolicies(repoRoot: string): LoadedPolicies {
  const dir = path.join(repoRoot, SEQUENCE_DIR, POLICIES_DIR);
  let names: string[];
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.json'))
      .map((d) => d.name)
      .sort();
  } catch {
    return { policies: [], warnings: [] }; // no policies dir ⇒ honest no-op
  }

  const policies: Policy[] = [];
  const warnings: string[] = [];
  for (const name of names) {
    const rel = `${SEQUENCE_DIR}/${POLICIES_DIR}/${name}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch (err) {
      warnings.push(`${rel}: not readable as JSON (${(err as Error).message})`);
      continue;
    }
    const errors = validatePolicy(parsed);
    if (errors.length > 0) {
      warnings.push(`${rel}: ${errors.join('; ')}`);
      continue;
    }
    const policy = parsed as Policy & { scope?: string };
    /*
     * Filename may carry scope when the JSON omits it, in two spellings.
     *
     * `svc:orders.json` is the original. It cannot exist on Windows: a colon
     * opens an NTFS alternate data stream, so the write SUCCEEDS into a stream
     * hanging off a file named `svc`, readdir lists `svc` (no .json), and the
     * policy is filtered out. The rule silently does not exist, with no error at
     * any layer — measured, not assumed.
     *
     * `svc__orders.json` means the same thing and is a legal filename
     * everywhere. It is the spelling to write in new repos.
     */
    if (!policy.scope) {
      const stem = name.replace(/\.json$/i, '');
      if (stem.includes(':')) policy.scope = stem;
      else if (stem.includes('__')) policy.scope = stem.replace('__', ':');
    }
    policies.push(policy);
  }
  return { policies, warnings };
}

/* ============================ user-level store ============================ *
 *
 * "Recently attached repos" is NOT per-repo memory — it spans repos — so it
 * lives in a USER-level store at `~/.sequence/recent.json`, never inside any
 * scanned repo. The store dir is a fixed, code-controlled join (no caller path
 * ever reaches the filename), and every persisted entry is validated to be an
 * absolute string that still exists as a directory, so a poisoned/hand-edited
 * file can never turn this into an arbitrary-path oracle or crash an attach.
 */

/**
 * The user-level store dir (`~/.sequence`).
 *
 * `SEQUENCE_USER_DIR` moves the ROOT, and exists because a test run must never
 * read - or write - the real person's store. It was not hypothetical: using the
 * app to configure a local Ollama wrote `~/.sequence/ai.json`, and three tests
 * asserting "no provider configured" then found one and turned red. A suite
 * whose result depends on whether the developer has ever used the product is a
 * suite that cannot be trusted in either direction.
 *
 * The security property the callers rely on is unchanged: the FILENAME is still
 * a fixed, code-controlled join and no caller-supplied path reaches it. Only the
 * root moves, and only from the process environment - the same trust level as
 * the process itself, which is how XDG_CONFIG_HOME and friends work. A relative
 * value is ignored rather than resolved against an incidental cwd.
 */
export function userStoreDir(): string {
  const override = process.env.SEQUENCE_USER_DIR;
  if (override !== undefined && override !== '' && path.isAbsolute(override)) return override;
  /*
   * FAIL CLOSED UNDER A TEST RUNNER. The `--import` hook above is the intended
   * isolation, and it works — but only for someone who runs the package's own
   * `test` script. It is a convention, and a convention is not a boundary.
   *
   * MEASURED, 2026-09-02. A hand-rolled `node --test dist/test/*.test.js` — no
   * `--import`, written to skip two slow files — ran the whole analyzer suite
   * against the REAL `~/.sequence`. It wrote five files there, `usage.json`,
   * `usage.alice…`, `usage.bob…`, `recent.json`, and an `ai.json` naming model
   * `claude-test` against `http://127.0.0.1:58209`. Nothing listens on that
   * port, so every `/api/ask` returned `provider request failed` while the UI
   * loaded, the board rendered and the status stayed 200 — a live surface in
   * front of a dead engine, for a day, on the owner's own machine.
   *
   * A test in the suite already DETECTS this and says so, which is how it was
   * eventually found. Detection is not prevention: by the time that assertion
   * reports, the writes have happened. So the resolver refuses instead. Under
   * `node --test` with no explicit override there is no correct answer, and
   * throwing is the only one that cannot damage the person running it.
   *
   * `NODE_TEST_CONTEXT` is set to `child-v8` by the node test runner in every
   * test child and is undefined otherwise — verified, not assumed.
   */
  if (process.env.NODE_TEST_CONTEXT !== undefined) {
    throw new Error(
      'userStoreDir(): refusing to resolve the real ~/.sequence during a test run. ' +
        'Run the package test script, which loads the isolate hook ' +
        '(node --import ./dist/test/isolate-user-store.js --test …), or set ' +
        'SEQUENCE_USER_DIR to a temp directory yourself. A hand-rolled `node --test` ' +
        'once wrote five files into a real user store and left the app answering ' +
        'every question with a provider failure.',
    );
  }
  return path.join(os.homedir(), SEQUENCE_DIR);
}

/**
 * Read a user-level JSON file that lives DIRECTLY under the store dir (e.g.
 * `~/.sequence/ai.json`) — the repo-less fallback for the AI config (v8 Phase B2).
 * `storeDir` is a fixed, code-controlled path (never a caller-supplied path), and
 * a missing / unreadable / malformed file yields undefined (never throws), matching
 * {@link readRecent}'s hardening. Same key hygiene as the per-repo `ai.json`: the
 * caller redacts before returning anything to a client.
 */
export function readUserJson<T = unknown>(storeDir: string, file: string): T | undefined {
  const p = path.join(storeDir, file);
  try {
    if (!fs.existsSync(p)) return undefined;
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/**
 * Write a user-level JSON file directly under the store dir (creates it lazily).
 *
 * 0.1.8.1 B3 (audit H4): the store holds API keys and the GitHub token, so the
 * directory is 0o700 and every file 0o600 — owner only, whatever the umask.
 * `chmod` after the write as well, because `mode` applies only when a file or
 * directory is CREATED and older installs left them 0644 / 0755. (On Windows
 * the modes are close to a no-op; the profile folder's ACL is what protects it.)
 */
export const USER_DIR_MODE = 0o700;
export const USER_FILE_MODE = 0o600;
export function writeUserJson(storeDir: string, file: string, value: unknown): void {
  fs.mkdirSync(storeDir, { recursive: true, mode: USER_DIR_MODE });
  try {
    fs.chmodSync(storeDir, USER_DIR_MODE);
  } catch {
    /* not ours to change (a shared mount): the file mode below still holds */
  }
  const p = path.join(storeDir, file);
  fs.writeFileSync(p, JSON.stringify(value, null, 2), { mode: USER_FILE_MODE });
  fs.chmodSync(p, USER_FILE_MODE);
}

/**
 * Delete a user-level JSON file directly under the store dir (the DELETE path,
 * e.g. disconnecting GitHub removes `~/.sequence/github.json`). Best-effort: an
 * already-absent file or a read-only home is a no-op, never a throw — same
 * hardening as {@link readUserJson}. `storeDir` is a fixed, code-controlled path.
 */
export function deleteUserJson(storeDir: string, file: string): void {
  try {
    fs.rmSync(path.join(storeDir, file), { force: true });
  } catch {
    /* already gone / read-only home — disconnect still succeeds in memory */
  }
}

/**
 * The USER-LEVEL local GitHub token config (v8 Phase D). Kept in its OWN file
 * under `~/.sequence/`, ALWAYS user-level (a GitHub PAT is a user credential, not
 * per-project memory) and never inside a scanned repo. Same key hygiene as
 * {@link AI_FILE}: the raw token is only ever written here and redacted before any
 * client sees it. This is LOCAL only — not hosted OAuth.
 */
export const GITHUB_FILE = 'github.json';

/**
 * The USER-LEVEL registry of LOCAL coding agents the user can drive over ACP
 * (v16 Wave 2a): `~/.sequence/agents.json`. ALWAYS user-level — which agent
 * binaries live on this machine spans every repo, and is a machine/user concern,
 * not per-project memory. Holds NO secret (just a command + args + cwd + label),
 * but is read/written with the SAME hardened {@link readUserJson}/{@link
 * writeUserJson} helpers so a hand-edited / malformed file can never crash a
 * read. See {@link file://./agentsStore.ts} for the typed list/add/remove/get API.
 */
export const AGENTS_FILE = 'agents.json';

/**
 * Per-user metering state for the FREE metered default model (v9 Phase 2). Lives
 * at the USER level (`~/.sequence/usage.json`) — metering is per-user, not
 * per-project — read/written via {@link readUserJson}/{@link writeUserJson}.
 * Holds NO secret: just a monthly call counter, its month, and cumulative spend.
 * api-key mode is never metered, so it never touches this file.
 */
export const USAGE_FILE = 'usage.json';

/**
 * The per-identity usage file name (v10 Phase 4). The metering seam is
 * identity-agnostic in meter.ts; the LOCAL {@link readUserJson}/{@link writeUserJson}
 * impl keys usage per identity by FILE:
 *   - identity `'local'` (the single-user local default) → today's `usage.json`,
 *     byte-for-byte unchanged so the pre-v10 store keeps working;
 *   - any other identity (a future deployed OAuth user) → `usage.<safe-id>.json`.
 * The id is sanitized to a filesystem-safe token (no separators, no leading dots)
 * so it can never traverse out of the store dir. A DEPLOYED build swaps this whole
 * file impl for a per-user DB row behind the same UsageStore interface — meter.ts
 * and this constant are untouched.
 *
 * COLLISION RESISTANCE (v10 review): the sanitizer is LOSSY — e.g. `a@x.com` and
 * `a-x.com` both collapse to the stem `a-x.com` — so distinct deployed identities
 * could otherwise land on the SAME usage file and read/charge each other's quota.
 * For any non-'local' identity we therefore append a short STABLE hash of the RAW
 * identity (first 8 hex of its sha256) to the sanitized stem, so two files are
 * identical only when the raw ids are identical. This also guarantees a non-'local'
 * id can never produce `usage.json`. The `'local'` mapping is kept byte-identical
 * (no hash) because the six CLI gates and the usage tests depend on it exactly.
 */
export function usageFileForIdentity(identity: string): string {
  if (identity === 'local') return USAGE_FILE;
  const safe = identity.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '').slice(0, 80);
  const stem = safe === '' ? 'anon' : safe;
  const hash = createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 8);
  return `usage.${stem}.${hash}.json`;
}

/**
 * The name of the directory, created UNDER the browse root, into which
 * GitHub-imported repos are cloned (v10 Phase 4): `<browseRoot>/sequence-workspaces/`.
 * Not a dot-directory (so the folder picker still lists it) and always a strict
 * descendant of the browse root, so a cloned repo lands inside the same jail every
 * attach is vetted against — never the browse root itself or an ancestor.
 */
export const WORKSPACES_DIR = 'sequence-workspaces';

/**
 * The directory, created UNDER the browse root, that holds the PER-USER browse
 * jails in hosted (auth-on) multi-tenant mode (v13 Finding A): each signed-in
 * user is confined to `<browseRoot>/sequence-users/<hash>/`, an opaque subtree
 * that no other tenant can browse, attach, or clone into. Local/auth-off mode
 * NEVER uses this — it keeps the single shared browse root (`os.homedir()`),
 * byte-identical to pre-v13.
 */
export const USER_WORKSPACES_DIR = 'sequence-users';

/**
 * Resolve a signed-in identity to its dedicated browse-jail directory beneath
 * `baseRoot` (v13 Finding A). The leaf is a STABLE, opaque sha256 prefix of the
 * raw identity — no PII (email / provider id) ever appears in the path, and two
 * users collide only if their raw identities are byte-identical. Pure + lossless
 * over the identity; the caller is responsible for creating it (recursive mkdir).
 */
export function userBrowseSubdir(baseRoot: string, identity: string): string {
  const hash = createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 16);
  return path.join(baseRoot, USER_WORKSPACES_DIR, hash);
}

/**
 * The sub-directory of the recents store dir that holds ONE user's `recent.json`
 * in hosted (auth-on) mode (v13 Finding, round-4): recents are per-user, so one
 * tenant's attaches never appear in another's list — the same leak class as the
 * /api/status fix. The leaf is the same opaque sha256 prefix as
 * {@link userBrowseSubdir} (no PII in the path). Local/auth-off mode NEVER calls
 * this — it keeps the single shared `recent.json` directly under the store dir,
 * byte-identical to pre-v13. Signature-compatible with {@link readRecent}/{@link
 * addRecent}, which both take a store DIR and manage `recent.json` inside it.
 */
export function userRecentStoreDir(baseDir: string, identity: string): string {
  const hash = createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 16);
  return path.join(baseDir, USER_WORKSPACES_DIR, hash);
}

export const RECENT_FILE = 'recent.json';
/** Keep the recent list short — a picker convenience, not a history log. */
/**
 * THE LIST IS MEMBERSHIP, NOT RECENCY — and this is no longer a cap on it.
 *
 * Owner, 2026-09-21: "after opening a new project, my other one's gone ... I
 * click again, ML max, and it gets rid of the T3 code. I don't know where T3
 * code is. That one's gone ... This should only add, it should add to the side
 * rail. It shouldn't substitute different ones."
 *
 * He is describing the rail's project list, and the rail's project list IS this
 * file. It was built as a RECENT-repos convenience — capped at ten, re-sorted
 * by every attach, and (worse, see {@link addRecent}) rewritten on every write
 * to whatever survived a `statSync` at that instant. None of those is wrong for
 * a "recent files" menu. All of them are wrong for the thing a person thinks of
 * as *the projects in my workspace*, which is what the rail made it.
 *
 * So the number stays only as a RUNAWAY BOUND: a guard against a file that
 * grows without limit, not a statement about how many projects he may keep. It
 * is large enough that reaching it means something has gone wrong, rather than
 * that he has been working.
 */
export const MAX_RECENT = 250;

function recentFilePath(storeDir: string): string {
  return path.join(storeDir, RECENT_FILE);
}

/**
 * The VIEWABLE projection of the project list: most-recent first,
 * de-duplicated, and filtered down to entries that are absolute paths still
 * resolving to a directory on disk. A missing or malformed file yields an empty
 * list (never throws).
 *
 * ── THIS IS A VIEW. IT IS NOT THE LIST ──────────────────────────────────
 *
 * What it declines to show, it does not delete — {@link readRecentRaw} is the
 * membership, and {@link addRecent} builds every write from that. The
 * difference is the whole of the 2026-09-21 project-loss defect: while this
 * function fed the writes, a folder that failed one `statSync` (a dehydrated
 * OneDrive directory does) was erased from the file for ever. Now it is absent
 * from one render and back in the next, which is what "I can't reach it right
 * now" should have always looked like.
 *
 * When `browseRoot` is supplied (the /api/recent read path passes the current
 * one), entries NOT contained within it are also dropped — reusing the very same
 * browse-jail containment check as GET /api/browse ({@link resolveInBrowseRoot},
 * realpath-based). This closes F3: a hand-edited recent.json pointing at `/etc`
 * (or a stale entry from a differently-scoped run) must not even be LISTED, since
 * it could never be attached through the jail anyway. Omitting `browseRoot`
 * (addRecent's internal de-dup read) applies no extra filtering.
 */
/**
 * The list AS STORED — absolute paths, de-duplicated, order preserved, and
 * NOTHING removed for being absent from disk.
 *
 * This is the membership list, and it is the one every WRITE must be built
 * from. {@link readRecent} is the viewable projection of it; using that as the
 * basis for a write is what silently deleted the owner's projects, because a
 * projection that drops things is a filter on the way out and a DELETION on the
 * way back in.
 */
export function readRecentRaw(storeDir: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(recentFilePath(storeDir), 'utf8'));
  } catch {
    return []; // absent / unreadable / not JSON
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== 'string' || p.length === 0 || !path.isAbsolute(p)) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

/**
 * {@link resolveInBrowseRoot} with an async realpath, kept HERE so the jail in browse.ts stays as it is. It must answer
 * exactly as the sync one does; test/serve-no-sync-fs.test.ts holds the two together on the same inputs.
 */
export async function resolveInBrowseRootAsync(browseRoot: string, target: string): Promise<string | null> {
  if (typeof target !== 'string') return null;
  if (target.includes('\0')) return null;
  const abs = target === '' ? browseRoot : path.resolve(target);
  if (!isContainedInBrowseRoot(browseRoot, abs)) return null;
  let real: string;
  try {
    real = await fs.promises.realpath(abs);
  } catch {
    return null;
  }
  if (!isContainedInBrowseRoot(browseRoot, real)) return null;
  return real;
}

/** {@link readRecent} with async reads, stats and realpaths: the same list, in the same order. */
export async function readRecentAsync(storeDir: string, browseRoot?: string): Promise<string[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.promises.readFile(recentFilePath(storeDir), 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== 'string' || p.length === 0 || !path.isAbsolute(p)) continue;
    if (seen.has(p)) continue;
    if (browseRoot !== undefined && (await resolveInBrowseRootAsync(browseRoot, p)) === null) continue;
    try {
      if (!(await fs.promises.stat(p)).isDirectory()) continue;
    } catch {
      continue;
    }
    seen.add(p);
    out.push(p);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

export function readRecent(storeDir: string, browseRoot?: string): string[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(recentFilePath(storeDir), 'utf8'));
  } catch {
    return []; // absent / unreadable / not JSON
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== 'string' || p.length === 0 || !path.isAbsolute(p)) continue;
    if (seen.has(p)) continue;
    // F3: drop entries outside the current browse root (same realpath containment
    // as the browse jail). resolveInBrowseRoot also verifies existence, so an
    // out-of-root or vanished entry both fail here.
    if (browseRoot !== undefined && resolveInBrowseRoot(browseRoot, p) === null) continue;
    try {
      if (!fs.statSync(p).isDirectory()) continue; // prune vanished / non-dir paths
    } catch {
      continue;
    }
    seen.add(p);
    out.push(p);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

/**
 * Add `repoPath` to the project list (de-duplicated, persisted, most recent
 * first). `repoPath` must be an absolute path (callers pass the canonical repo
 * root). Best-effort: a read-only home must never crash an attach, so a write
 * failure is swallowed and the (in-memory) list is still returned.
 *
 * ── IT ADDS. THAT IS THE WHOLE OF WHAT IT DOES ──────────────────────────
 *
 * It used to build the next file out of {@link readRecent}, and `readRecent`
 * PRUNES: any entry whose `statSync` did not come back a directory at that
 * instant was dropped. A read that drops is a filter; a write built on it is a
 * DELETE, and this one ran on every attach.
 *
 * On this owner's machine the projects live under OneDrive, where a dehydrated
 * folder can fail a `stat` while being perfectly present — so attaching one
 * project could permanently erase another, which is exactly what he reported:
 * "after opening a new project, my other one's gone." The entry was not
 * hidden. It was gone from the file, and nothing anywhere had said so.
 *
 * The write is now built from {@link readRecentRaw}, which removes nothing. A
 * folder that cannot be seen today is still his tomorrow; `readRecent` will
 * decline to LIST it while it cannot be reached, and list it again the moment
 * it can. Removing a project is now a thing he does — {@link removeRecent} —
 * and not something an unlucky filesystem call does for him.
 */
export function addRecent(storeDir: string, repoPath: string): string[] {
  if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) return readRecentRaw(storeDir);
  const next = [repoPath, ...readRecentRaw(storeDir).filter((p) => p !== repoPath)].slice(
    0,
    MAX_RECENT,
  );
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(recentFilePath(storeDir), JSON.stringify(next, null, 2));
  } catch {
    /* read-only home / permissions — attach still succeeds without the memory */
  }
  return next;
}

/**
 * File `repoPath` at the END of the list, only when it is absent. Never moves
 * or re-adds an existing entry, so it cannot override a dragged order.
 */
export function appendRecentIfAbsent(storeDir: string, repoPath: string): string[] {
  const held = readRecentRaw(storeDir);
  if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath) || held.includes(repoPath)) return held;
  const next = [...held, repoPath].slice(0, MAX_RECENT);
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(recentFilePath(storeDir), JSON.stringify(next, null, 2));
  } catch {
    /* read-only home */
  }
  return next;
}

/**
 * Remove `repoPath` from the project list, and return what is left.
 *
 * THE COUNTERPART TO `addRecent` NOT PRUNING. Once the list stops losing
 * entries by accident, there has to be a way to lose one on purpose — owner,
 * 2026-09-21: "you can also be able to delete it if you don't want to. Like, I
 * just delete the folder, just delete it from that workspace."
 *
 * "Delete it from that workspace" is this function, and it is ONLY this
 * function: it edits a list of paths in `~/.sequence/recent.json`. It does not
 * touch the folder, its files, or anything inside it. Every caller that
 * surfaces it to a person owes them that distinction in the wording, because
 * the word he used for it is "delete".
 */
export function removeRecent(storeDir: string, repoPath: string): string[] {
  const next = readRecentRaw(storeDir).filter((p) => p !== repoPath);
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(recentFilePath(storeDir), JSON.stringify(next, null, 2));
  } catch {
    /* read-only home — the removal is still reported, it just does not stick */
  }
  return next;
}

/**
 * Rewrite the project list in the order given, keeping every project.
 *
 * Owner, 2026-09-21: "you should be able to move the folder, compress the
 * folder ... you can also be able to delete it if you don't want to."
 *
 * ── AN ORDER IS AN OPINION, AND IT SURVIVES A DRAG IT DID NOT MENTION ────
 *
 * `order` is what the reader dragged into place. Anything in the stored list
 * that `order` does not name is KEPT, appended behind in its existing relative
 * order — because the caller is a rail that lists what it can reach, and a
 * project that is unreachable today is missing from that rail through no
 * decision of his (see {@link readRecent}). Dropping the unnamed would turn
 * one drag into a silent delete of every project on a disconnected drive,
 * which is the exact defect {@link addRecent} was just fixed for.
 *
 * Paths `order` names that are not in the list are ignored rather than added:
 * reordering is not a way to attach something.
 */
export function setRecentOrder(storeDir: string, order: string[]): string[] {
  const held = readRecentRaw(storeDir);
  const known = new Set(held);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const p of order) {
    if (typeof p !== 'string' || !known.has(p) || seen.has(p)) continue;
    seen.add(p);
    next.push(p);
  }
  for (const p of held) {
    if (!seen.has(p)) next.push(p);
  }
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(recentFilePath(storeDir), JSON.stringify(next, null, 2));
  } catch {
    /* read-only home — the order is reported, it just does not stick */
  }
  return next;
}

/* ── LIFECYCLE HOOKS ─────────────────────────────────────────────────────
   TWO FILES, AND THE SPLIT IS THE SECURITY POSTURE.

   `.sequence/hooks.json` is COMMITTED and declares what would run.
   `~/.sequence/hook-trust.json` is USER-LEVEL and decides whether it does — a
   repo cannot write it, so cloning a project can never grant itself the right
   to execute its own code. A repo proposes; only the person consents. */

export const HOOKS_FILE = 'hooks.json';
export const HOOK_TRUST_FILE = 'hook-trust.json';

/** The repo's declared hooks, validated. Malformed entries are dropped. */
export function readHookFile(repoRoot: string): HookFile | undefined {
  const raw = readJson(repoRoot, HOOKS_FILE);
  if (raw === undefined) return undefined;
  return parseHookFile(raw).file;
}

/** The user's trust list. Absent ⇒ nothing is trusted. */
export function readHookTrust(storeDir: string): HookTrust | undefined {
  const raw = readUserJson(storeDir, HOOK_TRUST_FILE) as HookTrust | undefined;
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.trusted)) {
    return undefined;
  }
  return { version: 1, trusted: raw.trusted.filter((t): t is string => typeof t === 'string') };
}

/**
 * Grant or revoke this repo's permission to run its own hooks.
 *
 * USER-LEVEL, always. The repo cannot write this file, which is the entire
 * reason the split exists: a repo that could grant itself trust would be a repo
 * that runs its own code the first time you open it.
 *
 * Paths are stored resolved and de-duplicated, so `C:\repo` and `C:/repo/`
 * are one entry rather than two ways to be trusted.
 */
export function setHookTrust(storeDir: string, repoRoot: string, trusted: boolean): HookTrust {
  const current = readHookTrust(storeDir) ?? { version: 1 as const, trusted: [] };
  const norm = (p: string): string => path.resolve(p).replace(/[\/]+$/, '');
  const target = norm(repoRoot);
  const rest = current.trusted.filter((t) => norm(t) !== target);
  const next: HookTrust = {
    version: 1,
    trusted: (trusted ? [...rest, target] : rest).sort(),
  };
  writeUserJson(storeDir, HOOK_TRUST_FILE, next);
  return next;
}
