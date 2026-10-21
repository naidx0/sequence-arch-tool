/* The board menu's file exports (plan 3.6, I7): the server renders the scanned graph as Mermaid, a
   dependency matrix or an architecture note, and this saves what it sent under the name it gave. */

import { useState } from 'react';

import { EXPORT_FORMATS, fetchExport, type ExportFormat } from './exportClient.js';

const ROW_TEXT: Record<ExportFormat, string> = {
  'mermaid-flow': 'Mermaid flowchart',
  'matrix-csv': 'Dependency matrix (CSV)',
  'arch-md': 'Architecture note (Markdown)',
};

/** Hand `content` to the browser as a download named `filename`. */
export function saveText(filename: string, mime: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.split(/[\\/]/).pop() || 'export.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportRows() {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (format: ExportFormat) => {
    setBusy(true);
    setNote(null);
    const r = await fetchExport(format);
    setBusy(false);
    if (!r.ok) {
      setNote(r.status === 409 ? 'Scan the project first.' : `Not exported: ${r.message}`);
      return;
    }
    saveText(r.file.filename, r.file.mime, r.file.content);
    setNote(`Saved ${r.file.filename}.`);
  };
  return (
    <div className="bm-row" data-testid="board-export-files">
      <span className="bm-cap">Export</span>
      {EXPORT_FORMATS.map((f) => (
        <button key={f} type="button" className="bpill" data-testid={`board-export-${f}`} disabled={busy} onClick={() => void run(f)}>
          {ROW_TEXT[f]}
        </button>
      ))}
      {note ? (
        <span className="bm-note" role="status" data-testid="board-export-file-note">
          {note}
        </span>
      ) : null}
    </div>
  );
}
