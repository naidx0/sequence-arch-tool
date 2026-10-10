import type { ReactNode } from 'react';

import './failureNote.css';

/**
 * A failure as one plain sentence, with the server's own words one click away.
 *
 * UX audit R11 #28: a raw body ("the server answered 404", "not mocked
 * /api/ai-config") printed verbatim inside a menu or card reads as a bug report.
 * The reader gets the sentence and a Retry when there is something to retry; the
 * raw text stays in a Details disclosure for whoever needs it.
 */
export function FailureNote({
  message,
  detail,
  onRetry,
  testid,
  className = 'failure-note',
}: {
  message: ReactNode;
  detail?: string | null;
  onRetry?: () => void;
  testid?: string;
  className?: string;
}) {
  return (
    <div className={className} role="alert" data-testid={testid}>
      <span className="failure-note-say">{message}</span>
      {onRetry ? (
        <button type="button" className="failure-note-retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
      {detail ? (
        <details className="failure-note-details">
          <summary>Details</summary>
          <code>{detail}</code>
        </details>
      ) : null}
    </div>
  );
}
