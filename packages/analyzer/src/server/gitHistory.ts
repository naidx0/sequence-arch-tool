/* ══════════════════════════════════════════════════════════════════════════
   GIT HISTORY FOR THE BOARD'S DIFF AND HOTSPOTS VIEWS (read-only)
   packages/analyzer/src/server/gitHistory.ts

   GET /api/git/branch-files?base=<ref>   files this branch changes vs <ref>
   GET /api/git/churn?days=<n>            commits per file before HEAD's date

   Both are reads: git runs with a fixed argv (never a shell), a timeout, and
   no prompt. The churn window ends at the HEAD commit's own date, not at
   today's, so the same commit always gives the same counts.
   ══════════════════════════════════════════════════════════════════════════ */

import childProcess from 'node:child_process';

const GIT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT = 64 * 1024 * 1024;

export class GitHistoryError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'GitHistoryError';
    this.status = status;
  }
}

function git(root: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      'git',
      args,
      { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new GitHistoryError(err.killed ? 504 : 400, `git ${args[0]} failed: ${String(stderr || err.message).trim()}`));
        else resolve(stdout);
      },
    );
  });
}

/** A ref a caller may name: no option-like or shell-ish characters. */
export function isSafeRef(ref: string): boolean {
  return ref.length > 0 && ref.length <= 200 && !ref.startsWith('-') && /^[A-Za-z0-9._/~^@{}-]+$/.test(ref) && !ref.includes('..');
}

export type BranchFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface BranchFiles {
  /** The ref the diff is against (the requested one, or what it fell back to); null when the repo has no base at all. */
  base: string | null;
  /** What the caller asked for, when it could not be used and `base` is a fallback (or null). */
  requested?: string;
  mergeBase: string | null;
  head: string | null;
  files: { path: string; status: BranchFileStatus; from?: string }[];
  /** True when there is nothing to compare against (no commits, or no main/master/upstream/origin HEAD): an empty, calm answer. */
  noBase?: boolean;
}

const STATUS: Record<string, BranchFileStatus> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified' };

/** Parse `git diff --name-status -z` output (renames as R<score>\0old\0new). */
export function parseNameStatus(z: string): BranchFiles['files'] {
  const parts = z.split('\0').filter((p) => p !== '');
  const out: BranchFiles['files'] = [];
  for (let i = 0; i < parts.length; ) {
    const code = parts[i]!;
    const kind = STATUS[code[0]!] ?? 'modified';
    if (code[0] === 'R' || code[0] === 'C') {
      const from = parts[i + 1]!;
      const to = parts[i + 2]!;
      out.push(code[0] === 'R' ? { path: to, status: kind, from } : { path: to, status: kind });
      i += 3;
    } else {
      out.push({ path: parts[i + 1]!, status: kind });
      i += 2;
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** A commit SHA for `ref`, or null when the repo has no such commit (never throws). */
async function resolveCommit(root: string, ref: string): Promise<string | null> {
  try {
    const sha = (await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
    return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
  } catch {
    return null;
  }
}

async function tryGit(root: string, args: string[]): Promise<string | null> {
  try {
    return (await git(root, args)).trim() || null;
  } catch {
    return null;
  }
}

/** The refs a branch diff can be against, in order: what was asked, origin/HEAD's target, main, master, the branch's upstream. */
async function baseCandidates(root: string, requested: string): Promise<string[]> {
  const originHead = await tryGit(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const upstream = await tryGit(root, ['rev-parse', '--abbrev-ref', '@{upstream}']);
  const all = [requested, originHead, 'main', 'master', upstream].filter((r): r is string => !!r && isSafeRef(r));
  return [...new Set(all)];
}

export async function branchFiles(root: string, base: string): Promise<BranchFiles> {
  if (!isSafeRef(base)) throw new GitHistoryError(400, `"base" is not a ref this route accepts: ${base}`);
  const head = await resolveCommit(root, 'HEAD');
  if (!head) return { base: null, requested: base, mergeBase: null, head: null, files: [], noBase: true };
  for (const ref of await baseCandidates(root, base)) {
    if (!(await resolveCommit(root, ref))) continue;
    const mergeBase = await tryGit(root, ['merge-base', ref, 'HEAD']);
    if (!mergeBase) continue; /* unrelated histories: try the next candidate */
    const z = await git(root, ['diff', '--name-status', '-M', '-z', '--no-color', mergeBase, head]);
    return { base: ref, ...(ref !== base ? { requested: base } : {}), mergeBase, head, files: parseNameStatus(z) };
  }
  return { base: null, requested: base, mergeBase: null, head, files: [], noBase: true };
}

export interface Churn {
  days: number;
  /** The HEAD commit's date: the window's end. */
  until: string;
  since: string;
  commits: number;
  /** Commits per repo-relative path in the window. */
  files: Record<string, number>;
}

/** Parse `git log --format=%x1e --name-only` output: one record per commit. */
export function parseChurn(log: string): { commits: number; files: Record<string, number> } {
  const files: Record<string, number> = {};
  let commits = 0;
  for (const record of log.split('\x1e')) {
    const paths = record
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (record.trim() === '' && paths.length === 0) continue;
    commits += 1;
    for (const p of new Set(paths)) files[p] = (files[p] ?? 0) + 1;
  }
  return { commits, files };
}

export async function churn(root: string, days: number): Promise<Churn> {
  const d = Math.max(1, Math.min(Math.floor(days) || 90, 3650));
  const until = (await git(root, ['log', '-1', '--format=%cI'])).trim();
  const since = new Date(Date.parse(until) - d * 86_400_000).toISOString();
  const log = await git(root, ['log', '--no-merges', '--no-renames', `--since=${since}`, `--until=${until}`, '--format=%x1e', '--name-only', 'HEAD']);
  return { days: d, until, since, ...parseChurn(log) };
}
