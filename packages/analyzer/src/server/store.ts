import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validatePolicy, type Policy } from '@sequence/schema';
import { resolveInBrowseRoot } from './browse.js';
import { parseHookFile, type HookFile, type HookTrust } from './hooks.js';

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
  if (!fs.existsSync(p)) return undefined;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

/** Write `value` (pretty JSON) to `.sequence/<file>`, creating parent dirs lazily. */
export function writeJson(repoRoot: string, file: string, value: unknown): void {
  const p = sequencePath(repoRoot, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
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

/** Write a user-level JSON file directly under the store dir (creates it lazily). */
export function writeUserJson(storeDir: string, file: string, value: unknown): void {
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(path.join(storeDir, file), JSON.stringify(value, null, 2));
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
export const MAX_RECENT = 10;

function recentFilePath(storeDir: string): string {
  return path.join(storeDir, RECENT_FILE);
}

/**
 * Read the recent-repos list from `storeDir/recent.json`, most-recent first,
 * de-duplicated, capped at {@link MAX_RECENT}, and PRUNED of any entry that is
 * not an absolute path still resolving to a directory on disk. A missing or
 * malformed file yields an empty list (never throws).
 *
 * When `browseRoot` is supplied (the /api/recent read path passes the current
 * one), entries NOT contained within it are also dropped — reusing the very same
 * browse-jail containment check as GET /api/browse ({@link resolveInBrowseRoot},
 * realpath-based). This closes F3: a hand-edited recent.json pointing at `/etc`
 * (or a stale entry from a differently-scoped run) must not even be LISTED, since
 * it could never be attached through the jail anyway. Omitting `browseRoot`
 * (addRecent's internal de-dup read) applies no extra filtering.
 */
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
 * Prepend `repoPath` to the recent list (de-duplicated, capped, persisted).
 * `repoPath` must be an absolute path (callers pass the canonical repo root).
 * Best-effort: a read-only home must never crash an attach, so a write failure
 * is swallowed and the (in-memory) list is still returned.
 */
export function addRecent(storeDir: string, repoPath: string): string[] {
  if (typeof repoPath !== 'string' || !path.isAbsolute(repoPath)) return readRecent(storeDir);
  const next = [repoPath, ...readRecent(storeDir).filter((p) => p !== repoPath)].slice(0, MAX_RECENT);
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(recentFilePath(storeDir), JSON.stringify(next, null, 2));
  } catch {
    /* read-only home / permissions — attach still succeeds without the memory */
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
