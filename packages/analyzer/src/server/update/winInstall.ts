/**
 * Windows update kinds: the per-user NSIS install (Sequence Setup x.exe, updated by running the new installer silently:
 * `/S --force-run`) and the portable zip folder (portableUpdate.ts). Neither is started by the server: both go through
 * the handoff main runs after quit (handoff.ts).
 */

import fs from 'node:fs';
import path from 'node:path';

export type InstallKind = 'nsis' | 'portable';

/**
 * 'nsis' when the app runs from the per-user default (%LOCALAPPDATA%\Programs\sequence) or from a folder that holds the
 * NSIS uninstaller; otherwise 'portable'. SEQUENCE_INSTALL_KIND ("nsis" or "portable") overrides, for the desktop.
 */
export function installKind(execPath: string, env: NodeJS.ProcessEnv, exists: (p: string) => boolean = fs.existsSync): InstallKind {
  const forced = env.SEQUENCE_INSTALL_KIND;
  if (forced === 'nsis' || forced === 'portable') return forced;
  const norm = (p: string): string => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
  const dir = norm(path.win32.dirname(execPath.replace(/\//g, '\\')));
  const local = env.LOCALAPPDATA;
  if (local && dir === norm(path.win32.join(local, 'Programs', 'sequence'))) return 'nsis';
  if (exists(path.win32.join(dir, 'Uninstall Sequence.exe'))) return 'nsis';
  return 'portable';
}

/** The silent NSIS arguments: no wizard, and start the new version when done. */
export const NSIS_SILENT_ARGS: readonly string[] = ['/S', '--force-run'];
