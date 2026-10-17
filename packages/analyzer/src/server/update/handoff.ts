/**
 * The update handoff: the server verifies an update and WRITES what must run; the desktop's main process runs it.
 *
 * Why not start it here. On quit the desktop ends the server's whole process tree (server-control.ts killTreeWindows,
 * `taskkill /PID <server> /T /F`; a process-group signal on POSIX). An installer or a swap helper started by the server
 * is in that tree, so it died with the server before it could do anything (measured with hidden node processes: a
 * detached child of the server is killed). The main process is not in that tree. So the server leaves
 * `<userDir>/updates/handoff.json`, and main reads it in `will-quit`, after the server has been stopped, validates it
 * (packages/desktop/src/updateHandoff.ts, which mirrors this shape) and starts it detached and hidden.
 */

import fs from 'node:fs';
import path from 'node:path';

export type HandoffKind = 'nsis' | 'portable' | 'mac-swap' | 'appimage-swap';

export interface Handoff {
  v: 2;
  kind: HandoffKind;
  /** The release the update brings; main requires it to be newer than the running app. */
  version: string;
  /** The release asset's name: the key of its line in SHASUMS256.txt, which main fetches itself to verify the file. */
  asset: string;
  /** nsis, portable, mac-swap: the verified installer or zip, inside <userDir>/updates. appimage-swap: the staged file beside $APPIMAGE (main derives the path). */
  staged?: string;
  createdAt: number;
}

export const HANDOFF_NAME = 'handoff.json';

export const handoffPath = (userDir: string): string => path.join(userDir, 'updates', HANDOFF_NAME);

/** Atomic: a half-written file is never read. */
export function writeHandoff(userDir: string, h: Handoff): void {
  const file = handoffPath(userDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(h, null, 2));
  fs.renameSync(tmp, file);
}

export function readHandoff(userDir: string): Handoff | null {
  try {
    const h = JSON.parse(fs.readFileSync(handoffPath(userDir), 'utf8')) as Handoff;
    return h && h.v === 2 && typeof h.kind === 'string' ? h : null;
  } catch {
    return null;
  }
}

export function clearHandoff(userDir: string): void {
  fs.rmSync(handoffPath(userDir), { force: true });
}
