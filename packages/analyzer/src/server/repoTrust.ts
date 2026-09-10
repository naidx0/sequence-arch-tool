/* ══════════════════════════════════════════════════════════════════════════
   THE REPO TRUST BOUNDARY
   packages/analyzer/src/server/repoTrust.ts

   ── THE HOLE THIS CLOSES ─────────────────────────────────────────────────

   Verified in the code before this file was written
   (`docs/research/trust-boundary-verification.md`, claims 1 and 2):

     1. `readRepoInstructions` reads the first of `.sequence/instructions.md`,
        `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and
        `renderInstructionsSection` renders it under "These are the standing
        instructions for this repository. Follow them unless the code
        contradicts them." NOTHING asked whether the repository was trusted.
        Attaching was enough. A repository you cloned to look at could give
        the assistant its standing orders on the first question.

     2. `VERIFY_COMMAND_ALLOWLIST` is four literal strings, all of them `pnpm`
        indirections. `pnpm test` is not a command; it is a lookup into the
        repository's own `package.json`, which the repository writes. Nothing
        hostile ever had to appear in the command STRING.

   Both are the same failure at root: ATTACHING A REPOSITORY WAS TREATED AS
   TRUSTING IT. This module is the missing question.

   ── THE ONE DESIGN POINT THAT MATTERS ────────────────────────────────────

   A REPO MUST NOT BE ABLE TO MARK ITSELF TRUSTED.

   So the answer cannot live in `.sequence/` — a hostile repo would simply
   commit its own trust file, and cloning it would be consent. It lives in the
   USER-level store (`~/.sequence`, or `SEQUENCE_USER_DIR`), which no scanned
   repository can write.

   This is not a new idea here; it is the split `HOOK_TRUST_FILE` already
   made, and `store.ts` states it in as many words: "a repo cannot write it,
   which is the entire reason the split exists: a repo that could grant itself
   trust would be a repo that runs its own code the first time you open it."
   Hook trust is NARROWER (it governs the six declared lifecycle hooks) and is
   deliberately left alone. This file is the general boundary: instructions,
   commands, and repo-provided configuration.

   ── KEYED BY THE CANONICAL ROOT ──────────────────────────────────────────

   `canonicalRoot` (realpath) is the key, so `C:\repo`, `C:\repo\`, a junction
   pointing at it and a symlinked spelling are ONE decision rather than four
   ways to be trusted — and, more importantly, four ways to dodge a decision
   the user already made. `setHookTrust` normalises with `path.resolve`, which
   collapses the first two and NOT the last two; a symlink is exactly the
   trick a hostile repo has already been caught using here (see the jail's
   dangling-symlink branch, and `readRepoInstructions`' own comment).

   ── WHAT UNTRUSTED MEANS ─────────────────────────────────────────────────

   Untrusted is the DEFAULT, and it means three things:

     1. the instruction file is not fed to the model as binding instruction
        (`renderTrustedInstructionsSection` in `explain/instructions.ts`);
     2. `run_command` is off — nothing spawns under the repo root
        (`runAllowlistedRepoCommand` / `runCommandVerify` in
        `harness/verifyGate.ts`, and `executeRunCommand`'s sandbox branch);
     3. repo-provided configuration is ignored — the `project` scope of
        `loadPermissionPolicy`, which is the one repo-committed file that can
        GRANT the agent power (`allow: ['run_command(*)']`, `default: allow`).

   LOCAL-FIRST IS UNTOUCHED. Trust is a local JSON file. Nothing here reaches
   the network, and an untrusted repo still scans, still draws its graph, still
   answers grounded questions — the boundary removes the repo's ability to give
   ORDERS and to RUN, not the product's ability to work offline with no key.
   A trust prompt that became a login wall would be a worse bug than the one
   being fixed.
   ══════════════════════════════════════════════════════════════════════════ */

import path from 'node:path';

import { canonicalRoot } from './jail.js';
import { readUserJson, userStoreDir, writeUserJson } from './store.js';

/**
 * The user-level trust file: `~/.sequence/repo-trust.json`.
 *
 * A SEPARATE FILE FROM `hook-trust.json`, on purpose. Hook trust answers "may
 * this repo's six declared lifecycle hooks run"; this answers "is this repo's
 * text an instruction and may anything under it execute". Merging them would
 * silently upgrade every repo already on the hook list to the wider grant, and
 * a security boundary that widens itself during a refactor is not a boundary.
 */
export const REPO_TRUST_FILE = 'repo-trust.json';

/** The persisted shape. Canonical roots, sorted, one entry per root. */
export interface RepoTrustFile {
  version: 1;
  /** Canonical (realpath'd) absolute roots the user has explicitly trusted. */
  trusted: string[];
}

/** The empty answer. Absent file ⇒ nothing is trusted — never "everything". */
export const NO_REPO_TRUST: RepoTrustFile = { version: 1, trusted: [] };

/**
 * How two root strings are compared.
 *
 * Windows paths are case-insensitive, so `C:\Repo` and `c:\repo` are the same
 * directory and must be the same decision. POSIX paths are not, and folding
 * case there would trust `/srv/Repo` because `/srv/repo` was trusted. The
 * stored string keeps the real on-disk casing (`realpathSync` gives it); only
 * the COMPARISON folds, and only on win32.
 */
function sameRoot(a: string, b: string): boolean {
  const norm = (p: string): string => {
    const trimmed = p.replace(/[\\/]+$/, '');
    return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
  };
  return norm(a) === norm(b);
}

/**
 * The canonical key for a repo root, or null when there is no such directory.
 *
 * Null is the honest answer for a root that cannot be realpath'd, and every
 * caller reads null as UNTRUSTED. A repo that vanished between the trust
 * decision and the question is not a repo whose instructions should bind.
 */
export function repoTrustKey(repoRoot: string | null | undefined): string | null {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') return null;
  try {
    return canonicalRoot(repoRoot);
  } catch {
    return null;
  }
}

/**
 * Read the user's trust list. A missing, unreadable, malformed or
 * wrong-version file yields {@link NO_REPO_TRUST} — never a throw, and never
 * a default of "trusted". Same hardening as {@link readHookTrust}: a
 * hand-edited file must not be able to crash an attach OR to widen a grant by
 * being broken in an interesting way.
 */
export function readRepoTrust(storeDir: string = userStoreDir()): RepoTrustFile {
  const raw = readUserJson<Partial<RepoTrustFile>>(storeDir, REPO_TRUST_FILE);
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.trusted)) {
    return NO_REPO_TRUST;
  }
  return {
    version: 1,
    trusted: raw.trusted.filter(
      (t): t is string => typeof t === 'string' && t.length > 0 && path.isAbsolute(t),
    ),
  };
}

/**
 * Is this repository trusted?
 *
 * THE DEFAULT IS FALSE AND IT IS FALSE FOR EVERY UNCERTAIN CASE — no root, a
 * root that will not realpath, an unreadable store, a store that is not the
 * shape we wrote. A boundary whose failure mode is "allow" is decoration.
 *
 * `storeDir` defaults to `userStoreDir()` so no caller can forget to pass the
 * user-level location and accidentally key trust off something a repo writes.
 * It is injectable only so a test can point at a temp store (the same reason
 * `SEQUENCE_USER_DIR` exists — see `isolate-user-store.ts`).
 */
export function isRepoTrusted(
  repoRoot: string | null | undefined,
  storeDir: string = userStoreDir(),
): boolean {
  const key = repoTrustKey(repoRoot);
  if (key === null) return false;
  return readRepoTrust(storeDir).trusted.some((t) => sameRoot(t, key));
}

/**
 * Grant or revoke trust for one repository root. Persisted, one entry per
 * canonical root, sorted so two machines that trusted the same repos produce
 * the same file.
 *
 * ONE EXPLICIT ACTION, SCOPED TO A ROOT. There is deliberately no "trust
 * everything under this parent" and no session-only mode: a grant the user
 * cannot see the extent of is a grant they did not really make.
 *
 * A root that does not resolve is a no-op returning the unchanged list rather
 * than an error — the surface would otherwise have to distinguish "we could
 * not trust it" from "it is not trusted", and both mean the same thing to the
 * boundary.
 */
export function setRepoTrust(
  storeDir: string,
  repoRoot: string,
  trusted: boolean,
): RepoTrustFile {
  const current = readRepoTrust(storeDir);
  const key = repoTrustKey(repoRoot);
  if (key === null) return current;
  const rest = current.trusted.filter((t) => !sameRoot(t, key));
  const next: RepoTrustFile = {
    version: 1,
    trusted: (trusted ? [...rest, key] : rest).sort(),
  };
  writeUserJson(storeDir, REPO_TRUST_FILE, next);
  return next;
}

/**
 * The refusal sentence for anything that would EXECUTE under an untrusted
 * repo root, or null when execution is permitted.
 *
 * ONE STRING, ONE PLACE. The model reads this, the SSE receipt carries it and
 * the UI shows it, so all three say the same thing — and it NAMES TRUST rather
 * than blaming the command, because "not allowlisted" would send a model into
 * a retry loop rewriting a command that was never the problem. Honest errors
 * (`docs/vision.md` §5): a turn always ends in words the reader can act on.
 */
export function repoExecutionRefusal(
  repoRoot: string | null | undefined,
  storeDir: string = userStoreDir(),
): string | null {
  if (isRepoTrusted(repoRoot, storeDir)) return null;
  return (
    'this repository is not trusted, so nothing runs in it. A repository controls what its ' +
    'own commands mean (its package.json decides what "pnpm test" is), so running one is ' +
    'running its code. Trust the repository in Sequence to allow commands here.'
  );
}
