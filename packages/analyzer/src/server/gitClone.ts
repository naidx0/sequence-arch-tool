import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The REAL GitHub repo-import layer (v10 Phase 4) — `git clone` a repository into
 * the workspace. Unlike the connect/list layer ({@link ./github.ts}), a clone is
 * verifiable in this sandbox (git is present + github.com is reachable), so this is
 * built for real, not against a mock.
 *
 * TOKEN HYGIENE (the same discipline as {@link ./github.ts}, made concrete for a
 * subprocess): a private-repo token is supplied to git ONLY through GIT_ASKPASS —
 * a tiny temp script that echoes a token git reads from the ENVIRONMENT. The token
 * therefore never appears in:
 *   - the process ARGV (world-readable via `ps`) — the clone URL carries NO
 *     credentials (`https://github.com/<owner>/<repo>.git`, nothing embedded);
 *   - `<dest>/.git/config` — git records only the clean https remote URL, because
 *     the credential came from askpass, not from the URL;
 *   - any log line — nothing here logs argv, env, or the child's stdio.
 * Configured credential helpers are disabled (`-c credential.helper=`) so the token
 * is never persisted to a system credential store, and `GIT_TERMINAL_PROMPT=0`
 * makes a credential-needing clone FAIL FAST instead of hanging on a missing TTY.
 * The askpass temp script (which itself contains NO token — it only reads the env
 * var) is always removed in a `finally`.
 *
 * SSRF GUARD: {@link validateGithubCloneUrl} pins the host to the FIXED
 * {@link GITHUB_CLONE_HOST} (exact hostname equality, URL-parsed — never a
 * substring match), mirroring github.ts's non-caller-influenced `GITHUB_API_HOST`.
 * Any other scheme/host (ssh/file/git URLs, a look-alike `github.com.evil.tld`) is
 * rejected before a subprocess is ever spawned.
 */

/** GitHub's clone host. FIXED (never caller-influenced) — the SSRF guard's anchor. */
export const GITHUB_CLONE_HOST = 'github.com';

/**
 * A single owner/repo path segment. GitHub allows `[A-Za-z0-9._-]`; we additionally
 * require the first char to be alphanumeric so `.`/`..`/`.git` can never be an owner
 * or repo name (defence-in-depth for the on-disk dest name too).
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Hard ceiling on a single clone — a network + disk DoS guard. */
export const CLONE_TIMEOUT_MS = 120_000;

/** A validated, canonical github.com clone target. */
export interface GithubCloneTarget {
  owner: string;
  repo: string;
  /** "owner/repo". */
  fullName: string;
  /** The canonical https clone URL on the FIXED github.com host (no credentials). */
  cloneUrl: string;
}

function buildTarget(owner: string, repo: string): GithubCloneTarget {
  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    cloneUrl: `https://${GITHUB_CLONE_HOST}/${owner}/${repo}.git`,
  };
}

/**
 * Validate + normalize a candidate GitHub clone URL. Returns the parsed target
 * ONLY when it is an `https://github.com/<owner>/<repo>(.git)` URL. Any other
 * scheme or host — an ssh/file/git URL, an embedded-credentials URL, or a
 * look-alike host like `github.com.evil.tld` (caught because the hostname is judged
 * by exact equality, not `includes`) — returns null. This is the SSRF/rebinding
 * guard the clone endpoint runs BEFORE spawning git.
 */
export function validateGithubCloneUrl(raw: unknown): GithubCloneTarget | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null; // not a URL at all
  }
  if (u.protocol !== 'https:') return null; // no ssh:/git:/file:/http:
  if (u.hostname.toLowerCase() !== GITHUB_CLONE_HOST) return null; // exact host only
  if (u.username || u.password) return null; // no credentials embedded in the URL
  const parts = u.pathname.replace(/^\/+/, '').split('/');
  if (parts.length !== 2) return null; // must be exactly /<owner>/<repo>
  const owner = parts[0];
  let repo = parts[1];
  if (repo.endsWith('.git')) repo = repo.slice(0, -4);
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  return buildTarget(owner, repo);
}

/**
 * Build a validated clone target from a `"owner/repo"` fullName (the picker path).
 * The resulting cloneUrl is always the fixed-host canonical URL — a caller can
 * never influence the host, so this cannot be an SSRF vector either.
 */
export function cloneTargetFromFullName(fullName: unknown): GithubCloneTarget | null {
  if (typeof fullName !== 'string') return null;
  const cleaned = fullName.trim().replace(/^\/+/, '').replace(/\.git$/, '');
  const parts = cleaned.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;
  return buildTarget(owner, repo);
}

/**
 * A filesystem-safe directory name derived from a repo name. `repo` has already
 * passed {@link SEGMENT} when it comes from a validated target, but this sanitizes
 * again (strip separators / leading dots) so a dest name can never traverse or be
 * hidden. Falls back to `repo` when nothing safe remains.
 */
export function safeRepoDirName(repo: string): string {
  const base = repo.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '');
  return base === '' ? 'repo' : base;
}

/** The outcome of a clone attempt. `error` is caller-safe (never the token, never raw git stderr). */
export interface CloneResult {
  ok: boolean;
  error?: string;
}

/** The clone seam the server calls — the DEFAULT is {@link gitClone}; tests inject a local-origin clone. */
export type CloneRepoFn = (
  cloneUrl: string,
  dest: string,
  token: string | undefined
) => Promise<CloneResult>;

/** Injection points for {@link gitClone} — used by tests to capture argv/env and shorten the timeout. */
export interface CloneDeps {
  /** Injectable spawn: a test wraps the real spawn to prove the token is NEVER an argv entry. */
  spawn?: typeof childProcess.spawn;
  /** Injectable timeout (defaults to {@link CLONE_TIMEOUT_MS}). */
  timeoutMs?: number;
}

/**
 * Clone `cloneUrl` into `dest` (which MUST NOT already exist) via
 * `git clone --depth 1`. See the module header for the full token-hygiene
 * contract. Returns `{ ok }` (never throws for an ordinary clone failure); the
 * caller vets `dest`'s realpath containment and attaches on success.
 */
export async function gitClone(
  cloneUrl: string,
  dest: string,
  token: string | undefined,
  deps: CloneDeps = {}
): Promise<CloneResult> {
  const spawn = deps.spawn ?? childProcess.spawn;
  const timeoutMs = deps.timeoutMs ?? CLONE_TIMEOUT_MS;

  // The env carries the token to git's askpass helper — NEVER the argv. Start from
  // the process env so git finds PATH etc., then layer the askpass wiring on top.
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  let askpassDir: string | undefined;
  if (token) {
    // The script FILE holds no secret — it only reads the env var at run time.
    askpassDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-askpass-'));
    const askpassPath = path.join(askpassDir, 'askpass.sh');
    fs.writeFileSync(askpassPath, '#!/bin/sh\nprintf "%s\\n" "$SEQUENCE_GIT_ASKPASS_TOKEN"\n', {
      mode: 0o700,
    });
    env.GIT_ASKPASS = askpassPath;
    env.SEQUENCE_GIT_ASKPASS_TOKEN = token;
  }

  // `-c credential.helper=` neutralizes any configured credential store (no token
  // ever persisted). `--` terminates options so a hostile URL can't smuggle a flag.
  const args = [
    '-c',
    'credential.helper=',
    'clone',
    '--depth',
    '1',
    '--no-tags',
    '--',
    cloneUrl,
    dest,
  ];

  try {
    return await new Promise<CloneResult>((resolve) => {
      let child: childProcess.ChildProcess;
      try {
        child = spawn('git', args, { env, stdio: ['ignore', 'ignore', 'pipe'] });
      } catch (e) {
        resolve({ ok: false, error: `failed to start git: ${(e as Error).message}` });
        return;
      }
      let settled = false;
      const finish = (r: CloneResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL'); // disk/network DoS guard: never let a clone run unbounded
        } catch {
          /* already exited */
        }
        finish({ ok: false, error: `clone timed out after ${timeoutMs}ms` });
      }, timeoutMs);
      // Drain stderr so the pipe never blocks, but NEVER surface/log it — the
      // client only ever sees a generic reason (defence-in-depth token hygiene).
      child.stderr?.on('data', () => {
        /* swallowed on purpose — never logged */
      });
      child.on('error', (e) => finish({ ok: false, error: `git failed: ${(e as Error).message}` }));
      child.on('close', (code, signal) => {
        if (signal) {
          finish({ ok: false, error: `clone terminated (${signal})` });
          return;
        }
        finish(code === 0 ? { ok: true } : { ok: false, error: `git clone failed (exit ${code ?? 'unknown'})` });
      });
    });
  } finally {
    if (askpassDir) {
      try {
        fs.rmSync(askpassDir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
  }
}
