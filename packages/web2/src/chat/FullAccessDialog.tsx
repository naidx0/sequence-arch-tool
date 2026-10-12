/* ══════════════════════════════════════════════════════════════════════════
   THE ONE-TIME FULL ACCESS QUESTION — packages/web2/src/chat/FullAccessDialog.tsx

   Base UI AlertDialog (focus trap, Escape, return focus come from the
   library). Its own chunk: AccessControl.tsx imports it lazily, so Base UI is
   never on the boot path. Default export, for React.lazy.
   ══════════════════════════════════════════════════════════════════════════ */

import { AlertDialog } from '@base-ui/react/alert-dialog';

export interface FullAccessDialogProps {
  prompt: string;
  error: string | null;
  onAccept: () => void;
  onCancel: () => void;
}

export default function FullAccessDialog({ prompt, error, onAccept, onCancel }: FullAccessDialogProps) {
  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="v3-access-backdrop" />
        <AlertDialog.Popup className="v3-access-confirm" data-testid="v3-full-access-confirm">
          <AlertDialog.Title className="v3-access-confirm-title">Full access for this project</AlertDialog.Title>
          <AlertDialog.Description className="v3-access-confirm-body">
            {prompt}. You are asked once per project.
          </AlertDialog.Description>
          {error ? (
            <p className="v3-access-confirm-error" role="alert" data-testid="v3-full-access-error">
              {error}
            </p>
          ) : null}
          <div className="v3-access-confirm-actions">
            <AlertDialog.Close className="v3-access-btn" data-testid="v3-full-access-cancel">
              Cancel
            </AlertDialog.Close>
            <button type="button" className="v3-access-btn is-primary" data-testid="v3-full-access-allow" onClick={onAccept}>
              Allow full access
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
