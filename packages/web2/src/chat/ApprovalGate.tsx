/* ══════════════════════════════════════════════════════════════════════════
   THE APPROVAL GATE — Allow once Y · Always for <prefix> A · Deny N
   packages/web2/src/chat/ApprovalGate.tsx

   After the Ramp Kit's Approval Gate (usebastion.io/design, "Card"): the
   exact action, then three answers with their keys, the safest yes first.
     Allow once   y   this request only
     Always for   a   this request, and every later command with the same
       <prefix>       prefix in this chat thread (the server keeps the rule;
                      codex hears acceptForSession, an ACP agent allow_always).
                      Offered only for a command, where a prefix exists.
     Deny         n   the agent is told no and carries on without it
   The outcome is written where the question was (EditApprovalCardAgent's
   folded row); nothing here is a modal.

   KEYS. y / a / n answer an approval while its card or toast has focus, or
   anywhere when it is the only approval waiting. Never while the focus is in
   a text field (the composer, a rename box): a letter typed there is a
   letter, not an answer. No modifier keys, no repeats.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { AgentApproval, ApprovalAnswer } from '../agents/runNodeStream';
import { DenyWithReason } from '../composer/DenyWithReason';

/** True when typing in `target` should type, not answer. */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  return el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') !== null;
}

/** The answer a key press means for `approval`, or null. */
export function gateAnswerFor(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat' | 'target' | 'defaultPrevented'>, approval: AgentApproval): ApprovalAnswer | null {
  if (approval.decision !== null || approval.sending !== null) return null;
  if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (isTextEntry(e.target)) return null;
  switch (e.key.toLowerCase()) {
    case 'y':
      return 'allow';
    case 'a':
      return approval.always ? 'always' : null;
    case 'n':
      return 'deny';
    default:
      return null;
  }
}

/** onKeyDown for a card or toast that carries `approval`. */
export function gateKeyHandler(approval: AgentApproval | null, onAnswer: (d: ApprovalAnswer) => void) {
  return (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (!approval) return;
    const d = gateAnswerFor(e.nativeEvent, approval);
    if (!d) return;
    e.preventDefault();
    onAnswer(d);
  };
}

/**
 * The page-wide keys: while exactly ONE approval is waiting, y / a / n answer
 * it from anywhere that is not a text field. Two or more waiting, and a key
 * could mean either, so only a focused card or toast answers.
 */
export function useOnlyPendingKeys(pending: readonly AgentApproval[], onAnswer: (approval: AgentApproval, d: ApprovalAnswer) => void): void {
  const only = pending.length === 1 ? pending[0]! : null;
  useEffect(() => {
    if (!only || typeof document === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent): void => {
      const d = gateAnswerFor(e, only);
      if (!d) return;
      e.preventDefault();
      onAnswer(only, d);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [only, onAnswer]);
}

/* ONE PLACE TO ANSWER. While the composer takeover (shell2/Takeover.tsx) shows an approval it is the one place to
   answer it (Decision 49: "one place"); the card and toast gates stand down so the reader is never shown two sets of
   controls for one question. The takeover says so here when it mounts and when it goes. */
let takeoverShowing = false;
const takeoverListeners = new Set<() => void>();
export function setTakeoverShowing(on: boolean): void {
  if (takeoverShowing === on) return;
  takeoverShowing = on;
  for (const l of [...takeoverListeners]) l();
}
const subscribeTakeover = (fn: () => void): (() => void) => {
  takeoverListeners.add(fn);
  return () => void takeoverListeners.delete(fn);
};
const takeoverNow = (): boolean => takeoverShowing;

/** The three answers, with their keys. */
export function ApprovalGate({
  approval,
  onAnswer,
  compact = false,
  testIdPrefix = 'agent',
  onDenyWithReason,
}: {
  approval: AgentApproval;
  onAnswer: (d: ApprovalAnswer) => void;
  compact?: boolean;
  /** `agent` on a card header and a toast, `agent-approval` in the card body. */
  testIdPrefix?: string;
  /** S5: deny, and send the agent the reason (composer/rejectFeedback.ts). */
  onDenyWithReason?: (reason: string) => void;
}) {
  const takeover = useSyncExternalStore(subscribeTakeover, takeoverNow, takeoverNow);
  if (approval.decision !== null || takeover) return null;
  const busy = approval.sending !== null;
  /* Decision 49: uiarc.dev's answers (BArc.dc.html .da): No, Always, Yes as
     soft pills with their keys, Yes the one solid. */
  const c = compact ? ' is-compact' : '';
  return (
    <span className={`s2-gate${c}`} data-testid={`${testIdPrefix}-gate`}>
      <button type="button" className="s2-btn s2-btn-sm" disabled={busy} data-testid={`${testIdPrefix}-deny`} onClick={() => onAnswer('deny')}>
        Deny <kbd className="s2-kbd">N</kbd>
      </button>
      {approval.always ? (
        <button
          type="button"
          className="s2-btn s2-btn-sm"
          disabled={busy}
          data-testid={`${testIdPrefix}-always`}
          title={`Allow this, and every "${approval.always} …" command in this chat, without asking`}
          onClick={() => onAnswer('always')}
        >
          Always for <span className="s2-mono">{approval.always}</span> <kbd className="s2-kbd">A</kbd>
        </button>
      ) : null}
      <button type="button" className="s2-btn s2-btn-sm s2-blue" disabled={busy} data-testid={`${testIdPrefix}-allow`} onClick={() => onAnswer('allow')}>
        Allow once <kbd className="s2-kbd s2-kbd-on">Y</kbd>
      </button>
      {onDenyWithReason ? <DenyWithReason onDeny={onDenyWithReason} disabled={busy} testIdPrefix={testIdPrefix} /> : null}
    </span>
  );
}
