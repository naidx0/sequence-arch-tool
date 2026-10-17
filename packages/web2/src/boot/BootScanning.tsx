/* ══════════════════════════════════════════════════════════════════════════
   THE ENGINE IS READING THE PROJECT (0.1.8.1 B1)
   packages/web2/src/boot/BootScanning.tsx

   The server answers before it has read its startup `--repo`. A tab opened in
   that window used to land on the no-project home and offer to open the very
   project being read. It now says what is happening, with the count the
   server reports, over everything, until the read is done (useBoot polls).
   The loader is the app's own (shell2/ActivityLoader).
   ══════════════════════════════════════════════════════════════════════════ */

import { ActivityLoader } from '../shell2/ActivityLoader';
import { scanningLine, type BootScanning as Scanning } from './bootSequence';
import './boot.css';

/** The last folder of a path, either separator. */
const folderName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function BootScanning({ scanning }: { scanning: Scanning }) {
  const pct = scanning.total > 0 ? Math.min(1, scanning.done / scanning.total) : null;
  return (
    <div className="startup-scan" role="status" aria-live="polite" data-testid="boot-scanning">
      <div className="startup-scan-box">
        <ActivityLoader variant="radar" />
        <p className="startup-scan-t">{scanning.path ? `Opening ${folderName(scanning.path)}` : 'Opening the project'}</p>
        <p className="startup-scan-n" data-testid="boot-scanning-line">
          {scanningLine(scanning)}
        </p>
        {pct !== null ? <progress className="startup-scan-bar" max={1} value={pct} aria-label="Files read" /> : null}
      </div>
    </div>
  );
}
