/* ══════════════════════════════════════════════════════════════════════════
   THE CONFIRMATION (Decision 49) — uiarc.dev's centred dialog
   packages/web2/src/shell2/ConfirmDialog.tsx

   BArc.dc.html `.scrim` + `.dlg`: an icon chip, the question, one sentence,
   the things it touches, and the answers with their keys. Used only for real
   confirmations (switching on Full access, deleting, reverting, discarding a
   worktree); an agent's approvals and questions take the composer instead.
   Focus starts on the safe answer; Escape cancels; Enter confirms.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { trapFocus } from '../shell/focusTrap';
import { S2Icon, type S2IconName } from './icons';

export interface ConfirmDialogProps {
  icon?: S2IconName;
  title: string;
  body?: ReactNode;
  /** The files or lines it touches, drawn as B's file rows. */
  items?: { label: string; meta?: ReactNode }[];
  confirmLabel: string;
  cancelLabel?: string;
  /** A confirm that destroys something is drawn in the verdict ink. */
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  testId?: string;
  /** The answers' own ids where a surface already names them (Full access: allow / cancel). */
  okTestId?: string;
  cancelTestId?: string;
  errorTestId?: string;
}

export function ConfirmDialog({
  icon = 'shield',
  title,
  body,
  items,
  confirmLabel,
  cancelLabel = 'Cancel',
  danger = false,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
  testId = 's2-confirm',
  okTestId,
  cancelTestId,
  errorTestId,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dlgRef = useRef<HTMLDivElement>(null);
  /* Modal for real: focus starts on the safe answer, Tab stays inside, and
     closing gives focus back to what opened it (shell/focusTrap.ts). */
  useEffect(() => {
    const root = dlgRef.current;
    if (!root) return undefined;
    const release = trapFocus(root);
    cancelRef.current?.focus();
    return release;
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="s2 s2-scrim" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={dlgRef} className="s2-dlg" role="alertdialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <span className={`s2-dic${danger ? ' is-danger' : ''}`}>
          <S2Icon name={icon} />
        </span>
        <h3>{title}</h3>
        {body ? <p>{body}</p> : null}
        {items && items.length > 0 ? (
          <div className="s2-files">
            {items.map((it) => (
              <div key={it.label} className="s2-fl">
                <S2Icon name="file" small />
                <span className="s2-t s2-mono">{it.label}</span>
                {it.meta}
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="s2-dlg-err" role="alert" data-testid={errorTestId}>
            {error}
          </p>
        ) : null}
        <div className="s2-da">
          <button ref={cancelRef} type="button" className="s2-btn" data-testid={cancelTestId ?? `${testId}-cancel`} onClick={onCancel}>
            {cancelLabel}
            <span className="s2-kbd">Esc</span>
          </button>
          <button
            type="button"
            className={`s2-btn ${danger ? 's2-danger' : 's2-blue'}`}
            data-testid={okTestId ?? `${testId}-ok`}
            disabled={busy}
            onClick={onConfirm}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
