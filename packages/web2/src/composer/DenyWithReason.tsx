/* ══════════════════════════════════════════════════════════════════════════
   "DENY WITH A REASON" ON AN APPROVAL (S5)
   packages/web2/src/composer/DenyWithReason.tsx

   A quiet "Deny with reason…" beside the gate's three buttons. It opens a
   one-line field; Enter denies and sends the reason (rejectFeedback.ts says
   where it goes for Codex and for ACP), Escape closes it with nothing sent.
   chat/ApprovalGate.tsx mounts it; the exact line is in the S5 report.

   The field takes its keys: y / a / n typed into it are letters, not
   answers (ApprovalGate's page-wide keys skip text fields).
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import './promptQueue.css';
import { FEEDBACK_MAX } from './rejectFeedback';

export function DenyWithReason({ onDeny, disabled = false, testIdPrefix = 'agent' }: { onDeny: (reason: string) => void; disabled?: boolean; testIdPrefix?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const fieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) fieldRef.current?.focus();
  }, [open]);

  if (!open) {
    return (
      <button type="button" className="pq-btn" disabled={disabled} data-testid={`${testIdPrefix}-deny-reason`} onClick={() => setOpen(true)}>
        Deny with reason…
      </button>
    );
  }
  const submit = (): void => {
    if (reason.trim() === '') return;
    setOpen(false);
    onDeny(reason.trim());
    setReason('');
  };
  return (
    <span className="dwr" data-testid={`${testIdPrefix}-deny-reason-form`}>
      <input
        ref={fieldRef}
        className="pq-edit"
        type="text"
        maxLength={FEEDBACK_MAX}
        aria-label="Why deny? This is sent to the agent"
        placeholder="Why? The agent reads this"
        value={reason}
        onChange={(e) => setReason(e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            setReason('');
          }
        }}
      />
      <button type="button" className="pq-btn" disabled={disabled || reason.trim() === ''} data-testid={`${testIdPrefix}-deny-reason-send`} onClick={submit}>
        Deny
      </button>
    </span>
  );
}
