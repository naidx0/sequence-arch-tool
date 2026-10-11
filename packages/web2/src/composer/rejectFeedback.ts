/* ══════════════════════════════════════════════════════════════════════════
   DENY, AND SAY WHY (S5)
   packages/web2/src/composer/rejectFeedback.ts

   A bare Deny tells the agent "no" and nothing it can act on, so it often
   tries the same thing again. A reason goes back with it:

     Codex   the protocol's decline carries no message
             (CommandExecutionApprovalDecision / FileChangeApprovalDecision are
             accept | acceptForSession | decline | cancel), so the approval is
             declined and the reason is STEERED into the same turn
             (`turn/steer`), which codex reads before its next step.
     ACP     the approval is answered reject_once (the existing Deny), and the
             reason is queued at the FRONT as the follow-up prompt, sent the
             moment the turn settles. ACP has no steer, so the steer call
             answers no and `steerOrQueue` queues it.

   Deny is answered FIRST, always: the agent is blocked on that answer, and a
   reason that arrived before it would sit behind the question it explains.
   "Allow always" is untouched.
   ══════════════════════════════════════════════════════════════════════════ */

import { chatSessionKey, steerOrQueue, type SteerOrQueueInput, type SteerResult } from './steerClient';

/** Longest reason sent; the agent needs a sentence, not an essay. */
export const FEEDBACK_MAX = 500;

/** The line the agent reads. */
export function feedbackLine(reason: string, approvalTitle: string | null): string {
  const why = reason.replace(/\s+/g, ' ').trim().slice(0, FEEDBACK_MAX);
  const what = (approvalTitle ?? '').replace(/\s+/g, ' ').trim();
  return what ? `I denied “${what}”. ${why}` : `I denied that. ${why}`;
}

export interface DenyWithFeedbackDeps {
  /** The existing Deny: agentRuns.answer(runId, requestId, 'deny'). */
  deny: () => Promise<void>;
  /** Where the reason goes; defaults to steerOrQueue. */
  steerOrQueue?: (input: SteerOrQueueInput) => Promise<SteerResult>;
}

export interface DenyWithFeedbackInput {
  reason: string;
  approvalTitle: string | null;
  queueKey: string;
  /** The live agent session (run-node key), or null. */
  sessionKey: string | null;
}

/** Returns how the reason travelled, or null when there was no reason (a plain Deny). */
export async function denyWithFeedback(deps: DenyWithFeedbackDeps, input: DenyWithFeedbackInput): Promise<SteerResult | null> {
  await deps.deny();
  if (input.reason.trim() === '') return null;
  const send = deps.steerOrQueue ?? steerOrQueue;
  return send({ queueKey: input.queueKey, sessionKey: input.sessionKey, text: feedbackLine(input.reason, input.approvalTitle), front: true });
}

/**
 * The one-liner a card passes to the gate: `onDenyWithReason={denyWithReasonFor(run, approval, agentRuns.answer)}`.
 * The queue key is the chat (as the composer's queue is keyed), the session
 * key the run-node one the agent's live session is kept under.
 */
export function denyWithReasonFor(
  run: { id: string; sessionId: string | null; agentRef: string | null },
  approval: { requestId: string; title: string | null },
  answer: (runId: string, requestId: string, decision: 'deny') => Promise<void>,
  deps: Pick<DenyWithFeedbackDeps, 'steerOrQueue'> = {},
): (reason: string) => Promise<SteerResult | null> {
  return (reason) =>
    denyWithFeedback(
      { deny: () => answer(run.id, approval.requestId, 'deny'), ...deps },
      {
        reason,
        approvalTitle: approval.title,
        queueKey: run.sessionId ?? 'none',
        sessionKey: run.agentRef ? chatSessionKey(run.sessionId, run.agentRef) : null,
      },
    );
}
