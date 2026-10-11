import type { EditLedgerSummary } from './editLedgerModel';

export interface EditsLedgerProps {
  summary: EditLedgerSummary;
}

export function EditsLedger({ summary }: EditsLedgerProps) {
  return (
    <div className="edits-ledger" data-testid="chat-edits-ledger">
      <div className="edits-ledger-hd">
        <span>Edited {summary.fileCount} file{summary.fileCount === 1 ? '' : 's'}</span>
        <span className="edits-ledger-stats">
          <span className="stat-add">+{summary.added}</span>{' '}
          <span className="stat-del">−{summary.removed}</span>
        </span>
      </div>
      <ul className="edits-ledger-list">
        {summary.files.map((file) => (
          <li key={file.path}>
            <span>{file.path}</span>
            <span className="stat-add">+{file.added}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
