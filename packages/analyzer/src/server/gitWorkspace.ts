import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveInRepo } from './jail.js';
import { parseNumstat, type FileNumstat } from './runChangeStats.js';

/**
 * The Index-Changes git layer (Wave 3a) — `git status / diff / commit` against
 * the ATTACHED repo root only. Ships no UI itself.
 *
 * JAIL: every caller-supplied path is funnelled through {@link resolveInRepo}
 * (the same repo-root jail the file endpoints use): absolute inputs, `..`
 * traversal and symlink escape are rejected before `git` is ever spawned. The
 * cwd of every subprocess is the attached repo root, so a path that escapes it
 * can never reach outside files. There is NO ambient shell anywhere here —
 * only `git` child_processes with a fixed argv, never a shell, never `sh -c`.
 *
 * Reserved-dir guard: a caller may never stage anything under `.git/` (repo
 * internals). The `.sequence/` API-key file is gitignored by the product's own
 * `.gitignore` carve-out, and a plain `git add` (no `-f`) respects that, so the
 * key is not staged by `git add -A` either.
 */

/** Hard ceiling on any single git subprocess — a disk/CPU DoS guard. */
const GIT_TIMEOUT_MS = 30_000;

/** Max commit-message length we will pass to `git commit`. */
const MAX_COMMIT_MESSAGE_CHARS = 2000;

/** A single dirty file from `git status --porcelain`. */
export interface GitStatusFile {
  /** Repo-relative, forward-slashed path (the destination for a rename). */
  path: string;
  /** Normalised word: added | modified | deleted | renamed | copied | untracked | conflicted | unknown. */
  status: string;
  /**
   * IS THIS CHANGE IN THE INDEX?
   *
   * Porcelain gives TWO letters per file — X for the index, Y for the working
   * tree — and `classifyStatus` collapsed them into one word. So the wire
   * could not express "staged" at all, and the Staged review scope listed the
   * entire dirty tree: every file looked identical to it.
   *
   * Both flags, because a file can be BOTH. Stage a change, edit it again, and
   * git records `MM`: part of it is in the index and part is not. One boolean
   * would have to pick a side and would be wrong about half of them.
   */
  staged: boolean;
  /** Is there a change in the working tree, not yet in the index? */
  unstaged: boolean;
}

export interface GitStatusResult {
  branch: string;
  files: GitStatusFile[];
}

export interface GitDiffResult {
  path: string;
  /** Unified diff text (may be empty for an untracked or unchanged file). */
  diff: string;
}

export interface GitCommitResult {
  ok: boolean;
  /** The new commit SHA when ok, absent on failure. */
  commit?: string;
  /** Honest, token-free reason on failure. */
  error?: string;
}

interface GitProcResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Run `git` with a fixed argv (NEVER a shell) inside `repoRoot`. Resolves with
 * the exit code, stdout and stderr; never throws for an ordinary git failure —
 * a spawn error is surfaced as `code: -1` with the message in `stderr`. A hard
 * timeout SIGKILLs the child so a hostile repo (huge diff, slow hook) cannot
 * pin the server.
 */
function runGit(repoRoot: string, args: string[]): Promise<GitProcResult> {
  return new Promise((resolve) => {
    let child: childProcess.ChildProcess;
    try {
      child = childProcess.spawn('git', args, {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } catch (e) {
      resolve({ code: -1, signal: null, stdout: '', stderr: (e as Error).message });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (r: GitProcResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already exited */
      }
      finish({ code: null, signal: 'SIGKILL', stdout, stderr });
    }, GIT_TIMEOUT_MS);
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', (e) => finish({ code: -1, signal: null, stdout, stderr: stderr + e.message }));
    child.on('close', (code, signal) => finish({ code, signal, stdout, stderr }));
  });
}

/** True when `git rev-parse --verify HEAD` succeeds (a commit exists). */
async function hasHead(repoRoot: string): Promise<boolean> {
  const r = await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD']);
  return r.code === 0;
}

/** Repo-relative, forward-slashed form every result compares in. */
function toRelPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Map a porcelain v1 `XY` pair to a single normalised word. A conflict is when
 * either column is `U` OR both columns are non-space and not `??` (the
 * both-sides markers: UU/AA/DD/AU/UD/UA/DU). A single `D` (one side) is just a
 * delete, NOT a conflict. Otherwise pick the staged (X) code if present, else
 * the unstaged (Y) code.
 */
function classifyStatus(x: string, y: string): string {
  if (x === '?' && y === '?') return 'untracked';
  if (x === 'U' || y === 'U') return 'conflicted';
  if (x !== ' ' && y !== ' ' && x !== '?' && y !== '?') return 'conflicted';
  const c = x !== ' ' ? x : y;
  switch (c) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case '?':
      return 'untracked';
    default:
      return 'unknown';
  }
}

/**
 * Parse one porcelain v1 line into a {@link GitStatusFile}, or `null` for the
 * branch header (`## ...`). Renames/copies are `XY <orig> -> <dest>`; we report
 * the destination. Paths with literal newlines cannot be represented in
 * non-`-z` porcelain and are surfaced verbatim (honest rather than silently
 * wrong for the rare pathological case).
 */
function parsePorcelainLine(line: string): GitStatusFile | null {
  if (line.startsWith('## ')) return null;
  if (line.length < 3) return null;
  const x = line[0];
  const y = line[1];
  const rest = line.slice(3);
  let p = rest;
  if ((x === 'R' || x === 'C') && rest.includes(' -> ')) {
    p = rest.slice(rest.indexOf(' -> ') + ' -> '.length);
  }
  return {
    path: toRelPosix(p),
    status: classifyStatus(x, y),
    /*
     * X is the INDEX column and Y the WORKING TREE column. A space means "no
     * change in this column"; `?` in both means untracked, which is in neither.
     * Read straight off porcelain rather than inferred from the collapsed
     * word, because the collapse is what lost the distinction.
     */
    staged: x !== ' ' && x !== '?',
    unstaged: y !== ' ' && y !== '?',
  };
}

/**
 * GET /api/git/status — `git status --porcelain=v1 -b`. Returns the current
 * branch and the dirty file list. A clean tree yields `files: []`. `repoRoot`
 * must be the realpath-resolved attached root (the caller's jail anchor).
 */
export async function gitStatus(repoRoot: string): Promise<GitStatusResult> {
  const r = await runGit(repoRoot, ['status', '--porcelain=v1', '-b', '--no-renames']);
  // `--no-renames` keeps the parser simple and the file list stable for a UI;
  // a rename is reported as a delete + add, which is honest and unambiguous.
  if (r.code !== 0) {
    throw new Error(`git status failed: ${(r.stderr || '').trim() || `exit ${r.code ?? r.signal}`}`);
  }
  const lines = r.stdout.split('\n');
  let branch = '';
  const files: GitStatusFile[] = [];
  for (const raw of lines) {
    if (raw === '') continue;
    if (raw.startsWith('## ')) {
      // `## main` or `## main...origin/main [ahead 1]` — take the branch name only.
      const head = raw.slice(3);
      const dot = head.indexOf('...');
      branch = dot === -1 ? head : head.slice(0, dot);
      const bracket = branch.indexOf(' (');
      if (bracket !== -1) branch = branch.slice(0, bracket);
      continue;
    }
    const f = parsePorcelainLine(raw);
    if (f) files.push(f);
  }
  return { branch, files };
}

/**
 * GET /api/git/diff?path=<rel> — the unified diff for one repo-relative path.
 * When HEAD exists we diff against it (so both staged and unstaged changes are
 * shown — the "review what will be committed" view); otherwise we fall back to
 * the working-tree-vs-index diff. `rel` is jail-checked first; an escaping or
 * reserved (`.git/`) path is refused before `git` is spawned.
 */
/**
 * WHAT A DIFF IS AGAINST.
 *
 * The review pane draws five scopes and served two, because this function took
 * a path and nothing else: `staged` had no `--cached` form, `commit` had no
 * revision, and `branch` had no merge base. Three of five segments rendered as
 * visibly unavailable, each with an honest note naming the missing route — and
 * these are those routes.
 */
export type GitDiffScope =
  /** HEAD → working tree. Includes staged changes; that is what `git diff HEAD` is. */
  | { kind: 'worktree' }
  /** The index alone — `git diff --cached`. */
  | { kind: 'staged' }
  /** One commit against its parent. */
  | { kind: 'commit'; rev: string }
  /** A branch against where it diverged — `git diff <merge-base>...HEAD`. */
  | { kind: 'branch'; base: string };

/**
 * Resolve a caller-supplied revision to a SHA before it reaches a git argv.
 *
 * THE SAME RULE `gitCreateBranch` STATES AND FOLLOWS: "resolved with
 * `rev-parse --verify` FIRST and the resolved SHA is what reaches git, so a
 * flag-shaped start point never arrives as a flag". A `rev` of
 * `--upload-pack=…` cannot survive this, because what leaves here is forty hex
 * characters or a refusal — never the caller's string.
 *
 * The leading-dash check comes first anyway. `rev-parse` would refuse such a
 * value too, but relying on that means relying on git's argument parsing to
 * protect a call we are about to make into git.
 */
async function resolveCommit(repoRoot: string, rev: string, what: string): Promise<string> {
  if (typeof rev !== 'string' || rev.trim() === '') {
    throw new GitWorkspaceError(400, `${what} must be a non-empty string`);
  }
  if (rev.startsWith('-')) {
    throw new GitWorkspaceError(400, `${what} must not begin with '-'`);
  }
  const r = await runGit(repoRoot, ['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]);
  if (r.code !== 0 || r.stdout.trim() === '') {
    throw new GitWorkspaceError(400, `cannot resolve ${what} ${JSON.stringify(rev)}`);
  }
  return r.stdout.trim();
}

export async function gitDiff(
  repoRoot: string,
  rel: string,
  scope: GitDiffScope = { kind: 'worktree' },
): Promise<GitDiffResult> {
  const abs = resolveInRepo(repoRoot, rel);
  if (abs === null) {
    throw new GitWorkspaceError(403, 'path escapes the repo root');
  }
  if (isGitInternalPath(rel)) {
    throw new GitWorkspaceError(403, 'path targets a reserved git-internal path');
  }
  const relPosix = toRelPosix(path.relative(repoRoot, abs));
  const head = await hasHead(repoRoot);

  let args: string[];
  if (scope.kind === 'staged') {
    /* The index against HEAD. Before the first commit there is no HEAD to
       compare with, so `--cached` alone diffs the index against the empty
       tree — which is the right answer, not an error. */
    args = head
      ? ['diff', '--no-color', '--cached', 'HEAD', '--', relPosix]
      : ['diff', '--no-color', '--cached', '--', relPosix];
  } else if (scope.kind === 'commit') {
    const sha = await resolveCommit(repoRoot, scope.rev, 'rev');
    /*
     * A ROOT COMMIT HAS NO PARENT, and every "commit against its parent"
     * spelling quietly means something else when there is not one:
     * `<sha>^` does not resolve, and `<sha>^!` collapses to a bare `<sha>`,
     * which `git diff` reads as "that commit against the WORKING TREE" — a
     * plausible-looking diff of the wrong thing.
     *
     * So the parent is asked for rather than assumed. `diff-tree -p --root` is
     * git's own answer for the parentless case and prints the commit as the
     * addition it is.
     */
    const parents = await runGit(repoRoot, ['rev-list', '--parents', '-n', '1', sha]);
    const hasParent = parents.code === 0 && parents.stdout.trim().split(/\s+/).length > 1;
    args = hasParent
      ? ['diff', '--no-color', `${sha}^`, sha, '--', relPosix]
      : ['diff-tree', '-p', '--root', '--no-color', sha, '--', relPosix];
  } else if (scope.kind === 'branch') {
    const baseSha = await resolveCommit(repoRoot, scope.base, 'base');
    if (!head) throw new GitWorkspaceError(400, 'this repository has no commits to compare');
    /*
     * THREE DOTS, NOT TWO. `base...HEAD` diffs against the MERGE BASE, so a
     * branch's review does not fill up with changes that landed on the base
     * after the branch was cut — which is the difference between "what I did"
     * and "what has happened since I started".
     */
    args = ['diff', '--no-color', `${baseSha}...HEAD`, '--', relPosix];
  } else {
    args = head
      ? ['diff', '--no-color', 'HEAD', '--', relPosix]
      : ['diff', '--no-color', '--', relPosix];
  }

  const r = await runGit(repoRoot, args);
  if (r.code !== 0) {
    throw new GitWorkspaceError(500, `git diff failed: ${(r.stderr || '').trim() || `exit ${r.code ?? r.signal}`}`);
  }
  return { path: relPosix, diff: r.stdout };
}

/**
 * WHAT A REVIEWER CAN NAME.
 *
 * `GET /api/git/diff` grew `?scope=commit&rev=` and `?scope=branch&base=`, and
 * the review pane still could not use either — it had no way to NAME a revision
 * or a base, and a Commit scope that always meant HEAD is the worktree scope
 * wearing another word. This is the list it picks from.
 *
 * FIELDS ARE NUL-SEPARATED AND RECORDS ARE 0x1e-SEPARATED. A commit subject can
 * contain anything a person can type — tabs, pipes, newlines, the delimiter you
 * were about to choose — and a parser that split on a printable character would
 * mangle exactly the commits whose messages are most worth reading.
 *
 * IT TAKES NO REVISION FROM THE CALLER, so there is nothing here to inject. The
 * only input is a bounded count.
 */
export interface GitRevision {
  sha: string;
  /** The abbreviation a person reads and types. */
  shortSha: string;
  subject: string;
  /** ISO-8601, from git's own %aI — never re-derived from a locale string. */
  at: string;
}

export interface GitRevisionsResult {
  commits: GitRevision[];
  /** Local branch names, sorted. */
  branches: string[];
  /** The branch HEAD is on, or null when detached. */
  head: string | null;
}

export async function gitRevisions(
  repoRoot: string,
  limit = 20,
): Promise<GitRevisionsResult> {
  /* Bounded on the way in: a caller asking for a hundred thousand commits is
     asking for a response nobody scrolls and a spawn nobody waits for. */
  const n = Math.max(1, Math.min(Math.floor(limit) || 20, 100));

  if (!(await hasHead(repoRoot))) {
    /*
     * A repository with no commits has no revisions, which is a real answer
     * rather than an error — it is the state every repo starts in.
     *
     * THE BRANCH IS STILL REPORTED. Before the first commit you ARE on a
     * branch; it just has nothing on it. Returning null here said "detached",
     * which is a different and untrue thing — found by the test.
     */
    const fresh = await runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    return {
      commits: [],
      branches: [],
      head: fresh.code === 0 && fresh.stdout.trim() !== '' ? fresh.stdout.trim() : null,
    };
  }

  const log = await runGit(repoRoot, [
    'log',
    `-n${n}`,
    '--no-color',
    '--format=%H%x00%h%x00%aI%x00%s%x1e',
  ]);
  if (log.code !== 0) {
    throw new GitWorkspaceError(500, `git log failed: ${(log.stderr || '').trim() || 'unknown'}`);
  }
  /* The delimiters `--format` asked for, written as escapes rather than as the
     raw bytes: a NUL in a source file makes it binary to git, to grep and to
     every editor that opens it. */
  const RECORD_SEP = String.fromCharCode(0x1e);
  const FIELD_SEP = String.fromCharCode(0);

  const commits: GitRevision[] = [];
  for (const record of log.stdout.split(RECORD_SEP)) {
    /* git puts a newline after each record; it belongs to the separator, not to
       the sha that follows it. */
    const line = record.replace(/^[\r\n]+/, '');
    if (line.trim() === '') continue;
    const [sha, shortSha, at, ...rest] = line.split(FIELD_SEP);
    if (!sha || !shortSha) continue;
    /* The subject is re-joined rather than taken as `[3]`: a commit message
       containing the field separator would otherwise be silently truncated at
       the one character nobody thought to test. */
    commits.push({ sha, shortSha, at: at ?? '', subject: rest.join(FIELD_SEP) });
  }

  const branchList = await runGit(repoRoot, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads',
  ]);
  const branches =
    branchList.code === 0
      ? branchList.stdout.split(/\r?\n/).map((b) => b.trim()).filter(Boolean).sort()
      : [];

  const current = await runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  /* Detached HEAD is null, not the sha: "on a branch called 4f2a1c" is a
     sentence that would send someone looking for a branch that does not
     exist. */
  const head = current.code === 0 && current.stdout.trim() !== '' ? current.stdout.trim() : null;

  return { commits, branches, head };
}

/**
 * POST /api/git/commit { message, paths?: string[] } — stage then commit.
 *
 * - `paths` present and non-empty: each is jail-checked (escape / `.git/`
 *   refused) and passed to `git add -- <p1> <p2> ...`. A single bad path aborts
 *   the whole request (nothing is staged).
 * - `paths` absent or empty: `git add -A` (stage every change, respecting
 *   `.gitignore` so the API key is never staged).
 *
 * Then `git commit -m <message>`. Returns the new HEAD SHA. "Nothing to
 * commit" is an honest `{ ok: false, error }` rather than a silent success.
 */
export interface GitDiscardResult {
  ok: boolean;
  error?: string;
  /** Paths actually restored. */
  discarded?: string[];
}

/**
 * THROW AWAY A WORKING-TREE CHANGE, one named path at a time.
 *
 * Review could show a change and offer nothing to do about it except accept
 * it: a reader who decided a proposal was wrong had to leave for a terminal.
 *
 * ── WHY IT IS PER-PATH AND NEVER "ALL" ───────────────────────────────────
 *
 * This is the one genuinely destructive operation in the product — the content
 * is not in the index, not in a commit, and not recoverable by git after it
 * goes. A `discard all` button is one mis-click away from deleting an
 * afternoon, so there is no such button and this refuses an empty path list
 * rather than treating it as "everything".
 *
 * ── AND IT REFUSES A PATH GIT DOES NOT ALREADY TRACK ─────────────────────
 *
 * `git checkout --` restores a tracked file from HEAD. For an UNTRACKED file
 * there is nothing to restore to, and the only way to "discard" it is to
 * delete it — which is a different act with a different blast radius, and one
 * this refuses rather than performs silently.
 */
export async function gitDiscard(
  repoRoot: string,
  paths: readonly string[],
): Promise<GitDiscardResult> {
  if (!Array.isArray(paths) || paths.length === 0) {
    /* Never "everything". An empty list is a caller that lost its argument,
       and guessing here would guess destructively. */
    return { ok: false, error: 'discard needs at least one path; it never discards everything' };
  }

  const pathspecs: string[] = [];
  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0) {
      return { ok: false, error: 'every path must be a non-empty string' };
    }
    const abs = resolveInRepo(repoRoot, p);
    if (abs === null) {
      /* The same jail every other path-taking route uses. A discard that
         escaped the repo would delete a file outside it. */
      return { ok: false, error: `path escapes the repository: ${p}` };
    }
    pathspecs.push(p);
  }

  /* TRACKED ONLY, checked BEFORE anything is written. `git ls-files --error-unmatch`
     fails on the first path git does not know, so an untracked file is refused
     with its own name rather than silently skipped. */
  const known = await runGit(repoRoot, ['ls-files', '--error-unmatch', '--', ...pathspecs]);
  if (known.code !== 0) {
    return {
      ok: false,
      error:
        'one or more paths are not tracked by git, so there is nothing to restore them to. ' +
        'Delete them yourself if that is what you meant.',
    };
  }

  const out = await runGit(repoRoot, ['checkout', '--', ...pathspecs]);
  if (out.code !== 0) {
    /* git's own words. A rewritten message hides the one line that says what
       to fix. */
    return { ok: false, error: out.stderr.trim() || 'git checkout failed' };
  }
  return { ok: true, discarded: [...pathspecs] };
}

export async function gitCommit(
  repoRoot: string,
  message: string,
  paths?: string[]
): Promise<GitCommitResult> {
  if (typeof message !== 'string' || message.trim() === '') {
    return { ok: false, error: 'commit message must be a non-empty string' };
  }
  if (message.length > MAX_COMMIT_MESSAGE_CHARS) {
    return { ok: false, error: `commit message exceeds ${MAX_COMMIT_MESSAGE_CHARS} chars` };
  }

  let stageArgs: string[];
  /* Hoisted, because the COMMIT needs these too - see the comment on
     `commitArgs` below. Empty means "no selection", which is the
     stage-everything contract. */
  const pathspecs: string[] = [];
  if (paths && paths.length > 0) {
    for (const p of paths) {
      if (typeof p !== 'string' || p.length === 0) {
        return { ok: false, error: 'every path must be a non-empty string' };
      }
      const abs = resolveInRepo(repoRoot, p);
      if (abs === null) {
        return { ok: false, error: 'path escapes the repo root' };
      }
      if (isGitInternalPath(p)) {
        return { ok: false, error: 'staging a git-internal path is refused' };
      }
      pathspecs.push(toRelPosix(path.relative(repoRoot, abs)));
    }
    // `--` terminates options so a pathspec starting with `-` is never a flag.
    stageArgs = ['add', '--', ...pathspecs];
  } else {
    // No caller pathspecs: stage every change. `-A` must come BEFORE any `--`
    // (a `--` would make it a pathspec). `.gitignore` is respected, so the
    // `.sequence/ai.json` key is never staged.
    stageArgs = ['add', '-A'];
  }

  const stage = await runGit(repoRoot, stageArgs);
  if (stage.code !== 0) {
    return { ok: false, error: `git add failed: ${(stage.stderr || '').trim() || `exit ${stage.code ?? stage.signal}`}` };
  }

  /*
   * THE SELECTION HAS TO REACH THE COMMIT, NOT JUST THE INDEX.
   *
   * This was `git commit -m <message>` with no pathspec, which commits THE
   * WHOLE INDEX. A reader who had staged something themselves - in a terminal,
   * in their editor - and then ticked one file in Review got both, in a commit
   * they believed was limited to what they chose.
   *
   * It is the worst kind of defect to find late: no error, nothing wrong on
   * screen, and the extra work only visible once it is already in history.
   *
   * The `add` above still runs and still has to: `git commit -- <path>` refuses
   * a path git has never seen, so a brand-new file would not be committable
   * without it. The pathspec here narrows what the commit takes; the add is
   * what makes an untracked path nameable in the first place.
   */
  const commitArgs =
    pathspecs.length > 0 ? ['commit', '-m', message, '--', ...pathspecs] : ['commit', '-m', message];
  const commit = await runGit(repoRoot, commitArgs);
  if (commit.code !== 0) {
    const msg = (commit.stderr || '').trim() || (commit.stdout || '').trim();
    // "nothing to commit" is the common non-failure the UI must distinguish.
    return { ok: false, error: msg || `git commit failed (exit ${commit.code ?? commit.signal})` };
  }

  const sha = await runGit(repoRoot, ['rev-parse', 'HEAD']);
  if (sha.code !== 0) {
    // The commit landed but we could not read the SHA — honest partial success.
    return { ok: true };
  }
  return { ok: true, commit: sha.stdout.trim() };
}

/** True when a repo-relative path targets `.git/` internals (never stage/read). */
function isGitInternalPath(rel: string): boolean {
  const norm = toRelPosix(rel);
  return norm === '.git' || norm.startsWith('.git/');
}

/** A thrown error carrying an HTTP status, for the route handler to map. */
export class GitWorkspaceError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitWorkspaceError';
    this.status = status;
  }
}

/* ========================================================================== *
 * P12 — WORKTREE HANDOFF                                                     *
 *                                                                            *
 * Codex has `/worktree` → "create branch here" / "hand off". Before this      *
 * block this module exported three functions (status, diff, commit) and NONE  *
 * of them created a branch, so "the app does the git" stopped being true the  *
 * moment a user wanted to work anywhere but the checkout they attached.       *
 *                                                                            *
 * TWO OPERATIONS, and the split is deliberate:                                *
 *                                                                            *
 *   createBranch — a ref, and nothing else. The attached checkout does not     *
 *                  move: `git branch <name>` never touches HEAD or the        *
 *                  working tree, so asking for a branch cannot cost an        *
 *                  uncommitted edit.                                          *
 *   handoff      — a branch PLUS a second working tree to hand to another      *
 *                  agent (`git worktree add`). Two agents, two directories,   *
 *                  one object store, no stashing.                             *
 *                                                                            *
 * WHERE A WORKTREE GOES IS NOT THE CALLER'S CHOICE. `worktreesRootFor`        *
 * computes it: `<parent-of-repo>/<repo-name>-worktrees/<slug>`. Every other   *
 * caller-supplied path in this file goes through `resolveInRepo`, and a       *
 * worktree is the one thing that must live OUTSIDE the repo root — so rather  *
 * than weaken that jail, the caller supplies no path at all. The removal path *
 * re-derives the same root and refuses anything outside it, which is why      *
 * `DELETE ?path=<tmpdir>` cannot delete a temp dir.                           *
 *                                                                            *
 * NO SHELL, same as everything above: fixed argv to `git`, never `sh -c`.     *
 * `--` terminates options everywhere a name could otherwise be read as a      *
 * flag, and `isValidBranchName` rejects a leading `-` before that.            *
 * ========================================================================== */

/** Longest branch name we will hand to git. */
const MAX_BRANCH_NAME_CHARS = 200;

/**
 * Would `git check-ref-format --branch` accept this?
 *
 * Implemented HERE rather than only by spawning git, because a name beginning
 * with `-` must be refused BEFORE it is ever argv to a git process —
 * `--upload-pack=...` is a flag, not a branch. Everything git's rule list
 * forbids is forbidden here: control characters, space, the punctuation set,
 * a backslash, `..`, `@{`, a bare `@`, a component starting with `.`, a
 * component ending `.lock`, a trailing `.` or `/`, and an empty component.
 *
 * The real `git check-ref-format` still runs inside {@link gitCreateBranch} as
 * defence in depth. This function exists so the refusal is honest and local: a
 * 400 with a reason, not a spawned process whose stderr has to be parsed.
 */
export function isValidBranchName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (name === '' || name.length > MAX_BRANCH_NAME_CHARS) return false;
  if (name.startsWith('-')) return false;
  if (name === '@') return false;
  if (name.includes('..') || name.includes('@{')) return false;
  if (FORBIDDEN_REF_CHARS.test(name)) return false;
  if (name.endsWith('.') || name.endsWith('/')) return false;
  if (name.startsWith('/')) return false;
  for (const part of name.split('/')) {
    if (part === '') return false;
    if (part.startsWith('.')) return false;
    if (part.endsWith('.lock')) return false;
  }
  return true;
}

/**
 * Control characters, DEL, space, and git's forbidden punctuation
 * (`~ ^ : ? * [` and a backslash).
 *
 * The backslash is spelled `String.fromCharCode(92, 92)` — TWO characters, an
 * escaped backslash inside the class. The first draft used a single one and
 * built `[… *[\]` , where the lone backslash escaped the closing bracket and
 * the whole expression threw `Unterminated character class` at module load,
 * taking every import of this file down with it. A char class needs the escape
 * pair, and `isValidBranchName`'s own case list is what caught it.
 */
const FORBIDDEN_REF_CHARS = new RegExp(
  `[\\u0000-\\u001f\\u007f ~^:?*[${String.fromCharCode(92, 92)}]`,
);

/** True when `git rev-parse --verify refs/heads/<name>` resolves. */
async function branchExists(repoRoot: string, name: string): Promise<boolean> {
  const r = await runGit(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
  return r.code === 0 && r.stdout.trim() !== '';
}

/** Result of {@link gitCreateBranch}. */
export interface GitBranchResult {
  ok: boolean;
  /** The branch as git now knows it. Absent on failure. */
  branch?: string;
  /** The commit the branch points at, READ BACK from git. Absent on failure. */
  head?: string;
  /** Honest, token-free reason on failure. */
  error?: string;
  /**
   * The HTTP status a route should map this to: 409 for "already exists" (the
   * request is well-formed, the world already has one), 400 for a bad name or
   * an unresolvable start point, 500 for a git failure.
   */
  status?: number;
}

/**
 * Create a branch in the ATTACHED repo. Does not check it out, does not move
 * HEAD, does not touch the working tree.
 *
 * `from` is an optional start point (a SHA, tag or branch). It is resolved with
 * `rev-parse --verify` FIRST and the resolved SHA is what reaches `git branch`,
 * so a flag-shaped start point never arrives as a flag.
 *
 * "Already exists" is a first-class refusal, not a silent success: a create
 * that quietly reuses somebody else's branch is how two agents end up on one
 * ref. {@link gitHandoffWorktree} opts into reuse EXPLICITLY and reports it.
 */
export async function gitCreateBranch(
  repoRoot: string,
  name: string,
  opts: { from?: string } = {},
): Promise<GitBranchResult> {
  if (!isValidBranchName(name)) {
    return { ok: false, status: 400, error: `not a valid branch name: ${JSON.stringify(name)}` };
  }
  // NO `--` here, and this is the one place in the file without it:
  // `git check-ref-format` does not accept an option terminator — it exits 129
  // with its usage text, which read as "git rejected the name" and refused
  // every legal branch. Safe precisely because `isValidBranchName` above has
  // already refused any name starting with `-`, so nothing flag-shaped can
  // reach this argv. (Verified: git itself rejects `--upload-pack=x` here too.)
  const fmt = await runGit(repoRoot, ['check-ref-format', '--branch', name]);
  if (fmt.code !== 0) {
    return { ok: false, status: 400, error: `git rejected the branch name: ${name}` };
  }
  if (await branchExists(repoRoot, name)) {
    return { ok: false, status: 409, error: `branch '${name}' already exists` };
  }

  let start: string | undefined;
  if (opts.from !== undefined) {
    if (typeof opts.from !== 'string' || opts.from.trim() === '') {
      return { ok: false, status: 400, error: '"from" must be a non-empty string when present' };
    }
    const resolved = await runGit(repoRoot, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${opts.from}^{commit}`,
    ]);
    if (resolved.code !== 0 || resolved.stdout.trim() === '') {
      return { ok: false, status: 400, error: `cannot resolve start point '${opts.from}'` };
    }
    start = resolved.stdout.trim();
  }

  const made = await runGit(
    repoRoot,
    start ? ['branch', '--', name, start] : ['branch', '--', name],
  );
  if (made.code !== 0) {
    const msg = (made.stderr || '').trim() || (made.stdout || '').trim();
    return {
      ok: false,
      status: 500,
      error: msg || `git branch failed (exit ${made.code ?? made.signal})`,
    };
  }

  // Read the head back from GIT rather than echoing the request: the response
  // then states what the repository IS, not what was asked for.
  const head = await runGit(repoRoot, ['rev-parse', `refs/heads/${name}`]);
  if (head.code !== 0) return { ok: true, branch: name };
  return { ok: true, branch: name, head: head.stdout.trim() };
}

/**
 * Where this repo's handed-off worktrees live: a SIBLING directory named after
 * the repo. Pure — computes a path, creates nothing.
 *
 * A sibling and not a subdirectory because a worktree inside the repo shows up
 * in `git status` as an untracked tree and in every scan as a duplicate of the
 * whole repository, which would double this product's own node count on its
 * own repo.
 */
export function worktreesRootFor(repoRoot: string): string {
  return path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-worktrees`);
}

/**
 * The directory name a branch gets inside {@link worktreesRootFor}. Every
 * character outside `[A-Za-z0-9._-]` collapses to `-`, so `feature/handoff`
 * becomes `feature-handoff` and nothing a branch name can contain becomes a
 * path separator.
 */
export function worktreeSlug(branch: string): string {
  return branch.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree';
}

/** One entry from `git worktree list --porcelain`. */
export interface GitWorktreeEntry {
  /** Absolute path git reports for this working tree. */
  path: string;
  /** Short branch name, or `null` for a detached or bare tree. */
  branch: string | null;
  /** The commit it is on, or `null` for a bare tree. */
  head: string | null;
  bare: boolean;
  detached: boolean;
}

/**
 * Every working tree git knows about for this repo, MAIN CHECKOUT INCLUDED
 * (git lists it first). Parsed from `--porcelain`, whose grammar is
 * newline-separated records with a blank line between them — never from the
 * human format, which is column-aligned and moves with terminal width.
 */
export async function gitListWorktrees(repoRoot: string): Promise<GitWorktreeEntry[]> {
  const r = await runGit(repoRoot, ['worktree', 'list', '--porcelain']);
  if (r.code !== 0) {
    throw new GitWorkspaceError(
      500,
      `git worktree list failed: ${(r.stderr || '').trim() || `exit ${r.code ?? r.signal}`}`,
    );
  }
  const out: GitWorktreeEntry[] = [];
  let cur: GitWorktreeEntry | null = null;
  for (const raw of r.stdout.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line === '') {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    if (line.startsWith('worktree ')) {
      if (cur) out.push(cur);
      cur = {
        path: line.slice('worktree '.length),
        branch: null,
        head: null,
        bare: false,
        detached: false,
      };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('HEAD ')) cur.head = line.slice('HEAD '.length);
    else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'bare') cur.bare = true;
    else if (line === 'detached') cur.detached = true;
  }
  if (cur) out.push(cur);
  return out;
}

/** Result of {@link gitHandoffWorktree}. */
export interface GitHandoffResult {
  ok: boolean;
  /** The branch the new tree is checked out on. Absent on failure. */
  branch?: string;
  /** Absolute path of the new working tree. Absent on failure. */
  path?: string;
  /**
   * Did THIS call create the branch? `false` means the branch was already there
   * and the handoff attached a second tree to it. Not cosmetic — it is the
   * difference between starting work and joining it.
   */
  createdBranch?: boolean;
  error?: string;
  status?: number;
}

/**
 * "Hand off": create (or reuse) `branch`, add a second working tree for it
 * beside the repo, and report the absolute path so the caller can point another
 * agent at it.
 *
 * Two agents in two directories share ONE object store, so a handoff costs a
 * checkout and not a clone, and neither has to stash to let the other run.
 *
 * A branch already CHECKED OUT in another tree is refused by git itself, and
 * that refusal is surfaced verbatim rather than retried behind the caller's
 * back.
 */
export async function gitHandoffWorktree(
  repoRoot: string,
  branch: string,
  opts: { from?: string } = {},
): Promise<GitHandoffResult> {
  if (!isValidBranchName(branch)) {
    return { ok: false, status: 400, error: `not a valid branch name: ${JSON.stringify(branch)}` };
  }
  const existed = await branchExists(repoRoot, branch);
  let createdBranch = false;
  if (!existed) {
    const made = await gitCreateBranch(repoRoot, branch, opts);
    if (!made.ok) return { ok: false, status: made.status ?? 500, error: made.error };
    createdBranch = true;
  }

  const root = worktreesRootFor(repoRoot);
  const dir = path.join(root, worktreeSlug(branch));
  if (fs.existsSync(dir)) {
    return { ok: false, status: 409, error: `a worktree directory already exists at ${dir}` };
  }
  fs.mkdirSync(root, { recursive: true });

  const added = await runGit(repoRoot, ['worktree', 'add', '--', dir, branch]);
  if (added.code !== 0) {
    const msg = (added.stderr || '').trim() || (added.stdout || '').trim();
    // Roll the branch back ONLY when this call created it: a branch left behind
    // by a failed handoff makes the retry hit "already exists" and read as a
    // different bug. A pre-existing branch is never touched.
    if (createdBranch) await runGit(repoRoot, ['branch', '-D', '--', branch]);
    return {
      ok: false,
      status: 500,
      error: msg || `git worktree add failed (exit ${added.code ?? added.signal})`,
    };
  }
  return { ok: true, branch, path: dir, createdBranch };
}

/** Result of {@link gitRemoveWorktree}. */
export interface GitWorktreeRemoveResult {
  ok: boolean;
  /** The path that was removed. Absent on failure. */
  path?: string;
  error?: string;
  status?: number;
}

/**
 * Remove a handed-off worktree.
 *
 * THE JAIL, in two gates. First the path must resolve inside
 * {@link worktreesRootFor} for THIS repo — a caller cannot pass `/`, the main
 * checkout, or any directory this module did not create. Containment is judged
 * on the REALPATH of both sides (so a symlinked temp root — macOS `/tmp`, and
 * every `mkdtemp` under it — compares equal) and lexically as a fallback.
 * Second, git's OWN `worktree list` must agree there is a working tree there,
 * before anything is deleted.
 *
 * A dirty worktree is refused unless `force`, because `git worktree remove`
 * DELETES the directory: silently discarding another agent's uncommitted work
 * is exactly the irreversible surprise this product must not ship.
 */
export async function gitRemoveWorktree(
  repoRoot: string,
  target: string,
  opts: { force?: boolean } = {},
): Promise<GitWorktreeRemoveResult> {
  if (typeof target !== 'string' || target.trim() === '') {
    return { ok: false, status: 400, error: 'a worktree path is required' };
  }
  const realOf = (p: string): string => {
    try {
      return fs.realpathSync(p);
    } catch {
      return p;
    }
  };
  const root = worktreesRootFor(repoRoot);
  const realRoot = realOf(root);
  const candidate = path.resolve(target);
  const realCandidate = realOf(candidate);
  const inside = (child: string, parent: string): boolean =>
    child !== parent &&
    child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
  if (!inside(realCandidate, realRoot) && !inside(candidate, root)) {
    return { ok: false, status: 403, error: 'path is not a worktree this repo handed off' };
  }

  const listed = await gitListWorktrees(repoRoot);
  const known = listed.some((w) => {
    const wp = path.resolve(w.path);
    return realOf(wp) === realCandidate || wp === candidate;
  });
  if (!known) {
    return { ok: false, status: 404, error: 'git does not list a worktree at that path' };
  }

  const removed = await runGit(repoRoot, [
    'worktree',
    'remove',
    ...(opts.force ? ['--force'] : []),
    '--',
    candidate,
  ]);
  if (removed.code !== 0) {
    const msg = (removed.stderr || '').trim() || (removed.stdout || '').trim();
    return {
      ok: false,
      status: 409,
      error: msg || `git worktree remove failed (exit ${removed.code ?? removed.signal})`,
    };
  }
  return { ok: true, path: candidate };
}

/**
 * SAMPLE THE WORKING TREE'S LINE COUNTS — the input to a run's change stats.
 *
 * `git diff --numstat HEAD` reports both staged and unstaged work against the
 * last commit, which is the same "what will be committed" frame `gitDiff` uses
 * above. Falling back to the index-only diff when there is no HEAD keeps a
 * fresh repository working rather than throwing on its first run.
 *
 * INCLUDES UNTRACKED FILES, via a second pass. A run whose whole output is new
 * files would otherwise report as having changed nothing — which is exactly
 * the run a reader most wants to see in the list. `--no-renames` matches
 * `gitStatus`: a rename is a delete plus an add, honest and unambiguous.
 *
 * ANSWERS AN EMPTY SNAPSHOT RATHER THAN THROWING when git fails. This feeds a
 * number beside a run; a repository without git, or a git that errored, must
 * not fail the run itself. The cost of the softness is that the delta reads as
 * zero, and {@link deltaOf}'s caller distinguishes "no stats" from "zero".
 */
export async function gitNumstatSnapshot(repoRoot: string): Promise<FileNumstat[] | null> {
  const head = await runGit(repoRoot, ['rev-parse', '--verify', 'HEAD']);
  const args =
    head.code === 0
      ? ['diff', '--numstat', '--no-renames', 'HEAD']
      : ['diff', '--numstat', '--no-renames', '--cached'];
  const tracked = await runGit(repoRoot, args);
  if (tracked.code !== 0) return null;
  const rows = parseNumstat(tracked.stdout);

  /*
   * Untracked files are absent from every `git diff`, and their LINES have
   * to be counted here or the number lies.
   *
   * The first cut of this left them at 0/0 and it was measurably wrong: a
   * run whose whole output is a new file read as "1 file" no matter how
   * much it wrote, and a run that only touched already-untracked files read
   * as "no files changed". That is the under-reporting this module's header
   * calls worse than no number at all - and it was caught by probing the
   * real repository, not by the unit tests, which had no untracked fixture
   * to disagree with.
   *
   * So they are read. UNTRACKED_COUNT_CAP bounds the work, and a file past
   * it is marked `uncounted` rather than counted as zero, because "we did
   * not look" and "there was nothing there" must not render the same.
   */
  const untracked = await runGit(repoRoot, ['ls-files', '--others', '--exclude-standard']);
  if (untracked.code === 0) {
    const seen = new Set(rows.map((r) => r.path));
    for (const raw of untracked.stdout.split('\n')) {
      const rel = raw.trim().replace(/[\\]/g, '/');
      if (rel === '' || seen.has(rel)) continue;
      rows.push(countUntracked(repoRoot, rel));
    }
    rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }
  return rows;
}

/** Bytes. Past this a new file is reported as changed-but-uncounted. */
export const UNTRACKED_COUNT_CAP = 2_000_000;

/**
 * Lines in one untracked file, or a declaration that it was not counted.
 *
 * Every line is an ADDITION: the file did not exist before, so there is
 * nothing it could have removed.
 */
function countUntracked(repoRoot: string, rel: string): FileNumstat {
  const abs = path.join(repoRoot, rel);
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return { path: rel, added: 0, removed: 0, uncounted: true };
    if (stat.size > UNTRACKED_COUNT_CAP) return { path: rel, added: 0, removed: 0, uncounted: true };
    const buf = fs.readFileSync(abs);
    /* A NUL byte in the first block is how git itself decides a file is
       binary, and matching that keeps one answer to "is this text". */
    if (buf.subarray(0, 8000).includes(0)) return { path: rel, added: 0, removed: 0, binary: true };
    const text = buf.toString('utf8');
    if (text === '') return { path: rel, added: 0, removed: 0 };
    /* Git counts a trailing newline as terminating the last line, not as
       starting an empty one. */
    const body = text.endsWith('\n') ? text.slice(0, -1) : text;
    return { path: rel, added: body.split('\n').length, removed: 0 };
  } catch {
    /* Deleted between `ls-files` and here, or unreadable. Not counted, and
       it says so rather than claiming an empty file. */
    return { path: rel, added: 0, removed: 0, uncounted: true };
  }
}
