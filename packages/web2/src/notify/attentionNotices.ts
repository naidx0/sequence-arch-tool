/* ══════════════════════════════════════════════════════════════════════════
   WHAT A TURN-END OR APPROVAL NOTIFICATION SAYS (S5)
   packages/web2/src/notify/attentionNotices.ts

   Beside notifyModel.ts rather than in it: notifyModel is in the boot bundle
   (the Settings panel reads it) and these two are only needed by the lazily
   loaded watcher, so keeping them apart keeps them out of first paint. They
   reuse runFinishedNotice's gate, so the rules are one rule.
   ══════════════════════════════════════════════════════════════════════════ */

import { runFinishedNotice, type NotifyState, type RunFinishedNotice } from '../settings/notifyModel';


export interface TurnEndedInput {
  state: NotifyState;
  visible: boolean;
  /** Who ran the turn, in the reader's words ("Codex", "Claude"). */
  agentName: string;
  status: 'done' | 'failed';
  /** The first words of the prompt, so two chats are told apart. */
  prompt?: string | null;
}

/** A short, single-line excerpt, or '' when there is nothing to say. */
function excerpt(text: string | null | undefined, max = 80): string {
  const one = (text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

export function turnEndedNotice(input: TurnEndedInput): RunFinishedNotice | null {
  const gate = runFinishedNotice({
    state: input.state,
    visible: input.visible,
    runName: input.agentName,
    status: input.status === 'done' ? 'completed' : 'failed',
  });
  if (!gate) return null;
  const about = excerpt(input.prompt);
  return {
    title: gate.title,
    body: about ? `“${about}”. Open Sequence to see the answer.` : gate.body,
  };
}

export interface ApprovalWaitingInput {
  state: NotifyState;
  visible: boolean;
  agentName: string;
  /** What the agent asked to do ("Run npm test", "Edit src/a.ts"). */
  title: string | null;
  /** How many are waiting in all, this one included. */
  waiting: number;
}

export interface QuestionWaitingInput {
  state: NotifyState;
  visible: boolean;
  agentName: string;
  /** The (first) question the agent asks. */
  question: string | null;
  waiting: number;
}

/** The agent stopped to ask the person something (codex requestUserInput); the approvals' gate and setting. */
export function questionWaitingNotice(input: QuestionWaitingInput): RunFinishedNotice | null {
  const gate = runFinishedNotice({ state: input.state, visible: input.visible, runName: input.agentName, status: 'paused' });
  if (!gate) return null;
  const more = input.waiting > 1 ? ` (${input.waiting} waiting)` : '';
  const what = excerpt(input.question);
  return {
    title: `${input.agentName} has a question${more}`,
    body: what ? `${what} Open Sequence to answer.` : 'Open Sequence to answer it.',
  };
}

export function approvalWaitingNotice(input: ApprovalWaitingInput): RunFinishedNotice | null {
  const gate = runFinishedNotice({ state: input.state, visible: input.visible, runName: input.agentName, status: 'paused' });
  if (!gate) return null;
  const what = excerpt(input.title) || 'An action';
  const more = input.waiting > 1 ? ` (${input.waiting} waiting)` : '';
  return {
    title: `${input.agentName} needs you${more}`,
    body: `${what} is waiting for Allow or Deny.`,
  };
}
