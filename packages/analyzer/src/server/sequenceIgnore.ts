import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/*
 * `.sequence/` ignore rules, on their own (0.1.8.1 B3). Moved out of
 * snapshot.ts so `store.ts` can make sure git ignores `.sequence/` BEFORE its
 * first write into a repository (the audit's H4: a key written there by a
 * repo whose `.sequence/` was not yet excluded could be committed). No import
 * of store.ts here, so the two never form a cycle.
 */

const SEQUENCE_DIR = '.sequence';

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^GIT_/i.test(k)) env[k] = v;
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

/**
 * The user's own git directory's `info/exclude`, or null when the root is not
 * a git checkout. Handles a linked worktree (`.git` is a file naming the git
 * dir, whose `commondir` holds the shared info/).
 */
export function userExcludeFile(root: string): string | null {
  const dotGit = path.join(root, '.git');
  let st: fs.Stats;
  try {
    st = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (st.isDirectory()) return path.join(dotGit, 'info', 'exclude');
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(fs.readFileSync(dotGit, 'utf8'));
  if (!m) return null;
  const gitDir = path.resolve(root, m[1]!);
  let common = gitDir;
  try {
    common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim());
  } catch {
    /* not a linked worktree */
  }
  return path.join(common, 'info', 'exclude');
}

/** Roots whose `.sequence/` this process has already made sure git ignores. */
const userExcludeChecked = new Set<string>();

/**
 * Review B: roots where there was nothing to do (not a git checkout) or git
 * could not answer, and when. Remembered for NEGATIVE_TTL_MS so every
 * `.sequence/` write does not re-stat and re-spawn git; after that it is asked
 * again, so a folder `git init`ed later is still covered.
 */
const userExcludeSkipped = new Map<string, number>();
export const NEGATIVE_TTL_MS = 60_000;

/** Tests: how many times git was actually asked. */
export const sequenceIgnoreStats = { gitCalls: 0 };

/** Tests: forget which roots were checked, as a new process would. */
export function resetSequenceIgnoredCheck(): void {
  userExcludeChecked.clear();
  userExcludeSkipped.clear();
  sequenceIgnoreStats.gitCalls = 0;
}

/**
 * `.sequence/` IS NEVER COMMITTED BY ACCIDENT. When the user's repository does
 * not already ignore it, `.sequence/` is added to their LOCAL
 * `.git/info/exclude` (once), never to their .gitignore, which is theirs and
 * shared. Read-only git otherwise: `check-ignore` writes nothing.
 */
export function ensureSequenceIgnored(root: string, now: number = Date.now()): void {
  if (userExcludeChecked.has(root)) return;
  const skippedAt = userExcludeSkipped.get(root);
  if (skippedAt !== undefined && now - skippedAt < NEGATIVE_TTL_MS) return;
  const file = userExcludeFile(root);
  if (!file) {
    userExcludeSkipped.set(root, now);
    return;
  }
  sequenceIgnoreStats.gitCalls += 1;
  const r = childProcess.spawnSync('git', ['-C', root, 'check-ignore', '-q', '--no-index', `${SEQUENCE_DIR}/`], {
    env: cleanEnv(),
    windowsHide: true,
  });
  if (r.status === 0) {
    userExcludeChecked.add(root);
    return;
  }
  if (r.status !== 1) {
    /* git could not answer: change nothing, and do not ask again on every write */
    userExcludeSkipped.set(root, now);
    return;
  }
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    text = '';
  }
  const line = `${SEQUENCE_DIR}/`;
  if (!text.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === `/${line}`)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? nl : ''}${line}${nl}`);
  }
  userExcludeChecked.add(root);
}

