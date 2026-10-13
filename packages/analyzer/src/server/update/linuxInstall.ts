/**
 * Linux updates.
 *
 * An AppImage updates itself in place: the verified new file is copied beside the running one (same folder, so the final
 * rename is atomic), and main's constant `sh` helper, which waits for Sequence to quit, renames it over the old AppImage
 * and starts it again. A deb is owned by the
 * package manager: Sequence does not replace files under /opt, and says what to run instead.
 */

import fs from 'node:fs';
import path from 'node:path';

export type LinuxKind = 'appimage' | 'deb' | 'other';

/** 'appimage' when the AppImage runtime set APPIMAGE; 'deb' for an install under /opt/Sequence; otherwise 'other'. */
export function linuxInstallKind(execPath: string, env: NodeJS.ProcessEnv): LinuxKind {
  if ((env.APPIMAGE ?? '').trim() !== '' && path.isAbsolute(env.APPIMAGE!)) return 'appimage';
  if (/^\/opt\/Sequence(\/|$)/.test(execPath.replace(/\\/g, '/'))) return 'deb';
  return 'other';
}

/** The words for a deb install: no one-click, and exactly what to run. */
export function debHowto(debName: string): string {
  return `Sequence is installed through your package manager, so it does not replace itself. Download ${debName} from the release page and run: sudo apt install ./${debName}`;
}

export interface AppImageHandoff {
  pid: number;
  /** The verified download. */
  file: string;
  /** The running AppImage ($APPIMAGE). */
  target: string;
}

/**
 * Copy the new file beside the target as `.<name>.update-<pid>` (same folder, so main's final rename is atomic). Main derives
 * that same path from $APPIMAGE and its own pid, hashes it against SHASUMS256.txt and runs its own constant swap script.
 * Throws when the target's folder cannot be written (a read-only mount): the caller falls back to the manual words.
 */
export function stageAppImage(a: AppImageHandoff): { staged: string } {
  const dir = path.dirname(a.target);
  fs.accessSync(dir, fs.constants.W_OK);
  const staged = path.join(dir, `.${path.basename(a.target)}.update-${a.pid}`);
  fs.copyFileSync(a.file, staged);
  fs.chmodSync(staged, 0o755);
  return { staged };
}
