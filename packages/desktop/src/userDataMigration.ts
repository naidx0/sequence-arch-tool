import fs from 'node:fs';
import path from 'node:path';

/*
 * THE APP'S DATA FOLDER IS "Sequence" (audit P2-13). The app NAME is left alone (see prepareUserData).
 *
 Electron names userData after the package name, so the folder was
 * <appData>/@sequence/desktop (Windows %APPDATA%\@sequence\desktop, macOS
 * ~/Library/Application Support/@sequence/desktop, Linux ~/.config/@sequence/desktop).
 * It is now <appData>/Sequence. The folder is set explicitly with
 * `app.setPath('userData', ...)` before anything reads it, and this runs
 * first of all (bootUserData.ts is main.ts's first import). The
 * engine's own user store is ~/.sequence (or SEQUENCE_USER_DIR), which never
 * depended on userData, so only the files the shell keeps here move: logs,
 * the sealed AI key file, the proxy cache, the V8 code cache, Chromium's profile.
 *
 * NEVER LOSE DATA. The old folder is renamed whole; if that cannot be done it
 * stays exactly where it is and is used for this run. Both folders holding data
 * is never merged and never overwritten: the new one wins, the old one is left.
 */

export const APP_NAME = 'Sequence';
export const LEGACY_SEGMENTS = ['@sequence', 'desktop'] as const;

export interface NameApp {
  getPath(name: 'appData' | 'userData'): string;
  setPath(name: 'userData', value: string): void;
  /** Electron's command line; absent in a test facade that passes no switches. */
  commandLine?: { hasSwitch(name: string): boolean };
}

export type MigrationOutcome =
  | 'fresh' // no old folder, nothing to do
  | 'current' // new folder already holds data, no old folder
  | 'migrated' // old folder moved to the new place
  | 'copied' // moved across volumes: copied, verified, old removed
  | 'copied-old-kept' // copied and verified, but the old folder could not be removed
  | 'both-exist' // both hold data: nothing touched, new one used
  | 'locked' // the old folder could not be moved: it is used for this run
  | 'explicit'; // --user-data-dir was passed: that folder is used, nothing is moved or set

export interface MigrationResult {
  outcome: MigrationOutcome;
  /** The folder this run uses as userData. */
  userData: string;
  from: string;
  to: string;
  detail?: string;
}

export interface MigrationFs {
  rename(from: string, to: string): void;
}

const realFs: MigrationFs = { rename: (a, b) => fs.renameSync(a, b) };

function hasData(dir: string): boolean {
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** Every file under `dir` as "relative path:size", sorted: what "contents identical" is checked against. */
function manifest(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(`${r}/`, ...manifest(dir, r));
    } else {
      out.push(`${r}:${fs.statSync(path.join(dir, r)).size}`);
    }
  }
  return out.sort();
}

function copyThenRemove(from: string, to: string): 'copied' | 'copied-old-kept' {
  const staging = `${to}.migrating`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    fs.cpSync(from, staging, { recursive: true, errorOnExist: true });
    const a = manifest(from);
    const b = manifest(staging);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) throw new Error('copy verification failed');
    fs.rmSync(to, { recursive: true, force: true }); // an empty folder, checked by the caller
    fs.renameSync(staging, to);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }
  try {
    fs.rmSync(from, { recursive: true });
    return 'copied';
  } catch {
    return 'copied-old-kept';
  }
}

/** Name the app, then settle which folder is userData, moving the old one over once. */
export function prepareUserData(app: NameApp, io: MigrationFs = realFs): MigrationResult {
  /* NOT app.setName: safeStorage's OS secret (macOS Keychain, libsecret, kwallet) is named from the app name, and renaming could strand ai-keys.sealed. Only the folder moves. */
  /* An explicit --user-data-dir is the caller's choice (the release smoke, a portable launch, a test): never override it,
     and never move the owner's data folder on its behalf. Found by the 0.1.8.2 release smoke, whose isolation control reads that folder. */
  if (app.commandLine?.hasSwitch('user-data-dir')) {
    const userData = app.getPath('userData');
    return { outcome: 'explicit', userData, from: userData, to: userData };
  }
  const appData = app.getPath('appData');
  const to = path.join(appData, APP_NAME);
  const from = path.join(appData, ...LEGACY_SEGMENTS);
  const done = (outcome: MigrationOutcome, userData: string, detail?: string): MigrationResult => {
    app.setPath('userData', userData);
    return { outcome, userData, from, to, detail };
  };

  const oldHasData = hasData(from);
  if (hasData(to)) return done(oldHasData ? 'both-exist' : 'current', to);
  if (!oldHasData) return done('fresh', to);

  try {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (fs.existsSync(to)) fs.rmdirSync(to); // empty: replaced by the rename
    io.rename(from, to);
    return done('migrated', to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      try {
        return done(copyThenRemove(from, to), to);
      } catch (copyErr) {
        return done('locked', from, `copy failed: ${(copyErr as Error).message}`);
      }
    }
    return done('locked', from, `${code ?? 'error'}: ${(err as Error).message}`);
  }
}

export function describeMigration(r: MigrationResult): string {
  return `outcome=${r.outcome} userData=${r.userData} from=${r.from} to=${r.to}${r.detail ? ` detail=${r.detail}` : ''}`;
}
