/* ══════════════════════════════════════════════════════════════════════════
   FULL ACCESS — one confirmation per project, then no more prompts
   packages/analyzer/src/server/fullAccessConsent.ts

   Owner, 2026-10-05: full access = skip permissions, no needless permission
   locks. So the lock is exactly ONE sentence, asked ONCE per project:

       "Agents can run any command without asking"

   and remembered in that project's gitignored `.sequence/` store. After that
   every Full-access run in the project goes straight through.

   A REPO MUST NOT SHIP ITS OWN YES (`repoTrust.ts` makes the same point about
   trust). `.sequence/*` is gitignored here, but a hostile repo could commit
   the file anyway, so a record only counts when:
     1. it names THIS project's canonical root (a copied or committed file
        names whoever wrote it), and
     2. git does not track it (a committed consent is the repo's, not yours).
   ══════════════════════════════════════════════════════════════════════════ */

import { execFile } from 'node:child_process';
import path from 'node:path';

import { repoTrustKey } from './repoTrust.js';
import { readJson, SEQUENCE_DIR, writeJson } from './store.js';

export const FULL_ACCESS_FILE = 'full-access.json';

/** The one sentence the person confirms. The UI shows it verbatim. */
export const FULL_ACCESS_PROMPT = 'Agents can run any command without asking';

interface FullAccessRecord {
  version: 1;
  confirmed: true;
  /** Canonical root the confirmation was given for. */
  root: string;
  prompt: string;
  confirmedAt: string;
}

/** Whether git tracks `.sequence/full-access.json` under `root`. No git ⇒ not tracked. */
function trackedByGit(root: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-files', '--', `${SEQUENCE_DIR}/${FULL_ACCESS_FILE}`],
      { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true },
      (err, stdout) => resolve(err ? false : String(stdout).trim() !== ''),
    );
  });
}

/** True once this project has confirmed full access (and the record is its own). */
export async function hasFullAccessConsent(projectRoot: string | null | undefined): Promise<boolean> {
  const key = repoTrustKey(projectRoot);
  if (key === null || !projectRoot) return false;
  let rec: Partial<FullAccessRecord> | undefined;
  try {
    rec = readJson<Partial<FullAccessRecord>>(projectRoot, FULL_ACCESS_FILE);
  } catch {
    return false;
  }
  if (!rec || rec.confirmed !== true || typeof rec.root !== 'string') return false;
  // Same comparison as `repoTrust.ts`: case folds only on win32.
  const norm = (p: string): string => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  if (norm(rec.root) !== norm(key)) return false;
  return !(await trackedByGit(projectRoot));
}

/** Record the one-time confirmation for `projectRoot`. Throws when the root does not resolve. */
export function recordFullAccessConsent(projectRoot: string): void {
  const key = repoTrustKey(projectRoot);
  if (key === null) throw new Error(`cannot record full access: ${projectRoot} does not resolve`);
  const rec: FullAccessRecord = {
    version: 1,
    confirmed: true,
    root: key,
    prompt: FULL_ACCESS_PROMPT,
    confirmedAt: new Date().toISOString(),
  };
  writeJson(projectRoot, FULL_ACCESS_FILE, rec);
}
