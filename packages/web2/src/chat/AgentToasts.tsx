/* ══════════════════════════════════════════════════════════════════════════
   AGENT TOASTS — bottom-right, at most three
   packages/web2/src/chat/AgentToasts.tsx

   The second place an agent's question appears. The chat card is the record;
   the toast is the one you cannot scroll past. Both answer through the same
   run store, so Allow in one settles the other.

     approval   persists until it is answered (Allow / Deny on the toast)
     question   the agent's question, while its card is out of view:
                Show in chat (its top, below the sticky header) or Cancel
     error      persists until dismissed
     finished   leaves after four seconds

   At most three show. Approvals rank first (oldest first), then errors, then
   finished runs; a fourth approval waits its turn and is never dropped, since
   the toast list is derived from the runs, not kept beside them.

   Drawn into document.body, so it sits over every pane whatever is mounted.
   ══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import type { AgentRunStore, AgentRunsState } from '../agents/agentRuns';
import type { AgentApproval, AgentQuestion, ApprovalAnswer } from '../agents/runNodeStream';
import { useStoreIfAny } from '../state/connect';
import { answerPageQuestion, approvalTitle, ApprovalButtons, useAgentRuns } from './AgentRunThread';
import { gateKeyHandler, isTextEntry, useOnlyPendingKeys } from './ApprovalGate';
import { revealCardTop } from './revealCard';
import { Icon } from './Icon';
import { cardSelector, useToastBottom, useVisibleCards } from './toastPlacement';
import { revealInTranscript } from './transcriptNav';

import './agentRun.css';

export const MAX_TOASTS = 3;
export const TOAST_MS = 4000;

export type ToastSpec =
  | { key: string; kind: 'approval'; runId: string; agent: string; approval: AgentApproval }
  | { key: string; kind: 'question'; runId: string; agent: string; question: AgentQuestion }
  | { key: string; kind: 'error'; runId: string; agent: string; text: string }
  | { key: string; kind: 'done'; runId: string; agent: string; text: string };

/**
 * The toasts to show, in order, capped at {@link MAX_TOASTS}. `seen` drops
 * the ones whose chat card a person can see already; it is applied before
 * the cap, so a visible card never takes a slot from a hidden one.
 */
export function toastsFor(state: AgentRunsState, seen: (spec: ToastSpec) => boolean = () => false, cap = MAX_TOASTS, activeSessionId?: string | null): ToastSpec[] {
  const approvals: ToastSpec[] = [];
  const errors: ToastSpec[] = [];
  const done: ToastSpec[] = [];
  for (const run of state.runs) {
    const agent = run.agentRef ?? 'Agent';
    for (const a of run.approvals) {
      if (a.decision === null) approvals.push({ key: `${run.id}:approval:${a.requestId}`, kind: 'approval', runId: run.id, agent, approval: a });
    }
    /* A question waits on a person like an approval does, and ranks with them. */
    for (const q of run.questions ?? []) {
      if (!q.settled) approvals.push({ key: `${run.id}:question:${q.requestId}`, kind: 'question', runId: run.id, agent, question: q });
    }
    /* Failures and finishes are news about the chat being read, and only about
       what happened this session: another chat's run, or one read back from
       disk when a chat is opened, is history, not an alert (it was toasting
       "run failed, authentication required" on every chat switch). Approvals
       and questions above stay global: they block a run until answered. */
    const inScope = !(activeSessionId && run.sessionId && run.sessionId !== activeSessionId) && !run.restored;
    if (!inScope) continue;
    const errKey = `${run.id}:error`;
    if (run.status === 'failed' && !state.dismissed.has(errKey)) {
      errors.push({ key: errKey, kind: 'error', runId: run.id, agent, text: run.error ?? 'The agent run failed.' });
    }
    const doneKey = `${run.id}:done`;
    if (run.status === 'done' && !state.dismissed.has(doneKey)) {
      done.push({ key: doneKey, kind: 'done', runId: run.id, agent, text: run.nodeLabel ? `Finished: ${run.nodeLabel}` : 'Finished' });
    }
  }
  return [...approvals, ...errors, ...done].filter((t) => !seen(t)).slice(0, cap);
}

function Toast({
  spec,
  store,
  repoRoot,
  onAnswer,
  onShow,
}: {
  spec: ToastSpec;
  store: AgentRunStore;
  repoRoot: string | null;
  onAnswer: (runId: string, requestId: string, d: ApprovalAnswer) => void;
  onShow: (spec: ToastSpec) => void;
}) {
  /* Only the finished toast leaves by itself. */
  useEffect(() => {
    if (spec.kind !== 'done') return undefined;
    const t = setTimeout(() => store.dismiss(spec.key), TOAST_MS);
    return () => clearTimeout(t);
  }, [spec.key, spec.kind, store]);

  if (spec.kind === 'question') {
    const asked = spec.question.questions[0]?.question ?? 'The agent asks a question.';
    return (
      <div className="agtoast" data-kind="question" role="alert" data-testid="agent-toast" aria-label={`${spec.agent} has a question`} tabIndex={-1}>
        <p className="agtoast-hd">
          <Icon name="agent" size={12} />
          <span className="agtoast-title">{spec.agent} has a question</span>
        </p>
        <p className="agtoast-text" title={asked}>
          {asked}
        </p>
        <div className="agtoast-acts">
          <button type="button" className="agbtn agbtn-allow is-primary" data-testid="agent-toast-show" onClick={() => onShow(spec)}>
            Show in chat
          </button>
          <button type="button" className="agbtn agbtn-deny" data-testid="agent-toast-cancel" disabled={spec.question.sending} onClick={() => answerPageQuestion(spec.runId, spec.question.requestId, null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  if (spec.kind === 'approval') {
    return (
      <div
        className="agtoast"
        data-kind="approval"
        role="alert"
        data-testid="agent-toast"
        aria-label={`${spec.agent} needs approval`}
        tabIndex={-1}
        onKeyDown={gateKeyHandler(spec.approval, (d) => onAnswer(spec.runId, spec.approval.requestId, d))}
      >
        <p className="agtoast-hd">
          <Icon name="key" size={12} />
          <span className="agtoast-title">{spec.agent} needs approval</span>
        </p>
        <p className="agtoast-text" title={approvalTitle(spec.approval, repoRoot)}>
          {approvalTitle(spec.approval, repoRoot)}
        </p>
        <div className="agtoast-acts">
          <ApprovalButtons approval={spec.approval} onAnswer={(d) => onAnswer(spec.runId, spec.approval.requestId, d)} />
          <button type="button" className="agbtn agbtn-quiet" onClick={() => onShow(spec)}>
            Show in chat
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="agtoast" data-kind={spec.kind} role={spec.kind === 'error' ? 'alert' : 'status'} data-testid="agent-toast">
      <p className="agtoast-hd">
        <Icon name={spec.kind === 'error' ? 'alert' : 'check'} size={12} />
        <span className="agtoast-title">{spec.kind === 'error' ? `${spec.agent} run failed` : `${spec.agent} finished`}</span>
        <button type="button" className="agtoast-x" aria-label="Dismiss" data-testid="agent-toast-dismiss" onClick={() => store.dismiss(spec.key)}>
          <Icon name="x" size={12} />
        </button>
      </p>
      <p className="agtoast-text" title={spec.text}>
        {spec.text}
      </p>
    </div>
  );
}

/** What a toast stands in for, as cardSelector reads it. */
function specTarget(t: ToastSpec): { kind: string; runId: string; approval?: { requestId: string } } {
  if (t.kind === 'approval') return { kind: t.kind, runId: t.runId, approval: t.approval };
  /* A question's card is found the way an approval's is, by its card id (agcard-<requestId>); the
     boot-path selector (toastPlacement.ts) is not grown for it. */
  if (t.kind === 'question') return { kind: 'approval', runId: t.runId, approval: t.question };
  return t;
}

/**
 * THE QUESTION'S PAGE-WIDE KEYS, the approval gate's rule (useOnlyPendingKeys):
 * while exactly ONE question waits and no approval does, 1-9 / y / n from
 * anywhere that is not a text field go to that question's card, which answers
 * them as its own keys (QuestionCard.tsx). A card not on the page (another
 * view, a long chat's undrawn row) is brought into view first.
 */
export function useOnlyQuestionKeys(waiting: readonly { runId: string; question: AgentQuestion }[], approvalsWaiting: number): void {
  const only = waiting.length === 1 && approvalsWaiting === 0 ? waiting[0]! : null;
  useEffect(() => {
    if (!only || typeof document === 'undefined') return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTextEntry(e.target)) return;
      if (!/^[1-9yn]$/i.test(e.key)) return;
      /* Decision 49: the composer's takeover is where a question is answered; the thread's card otherwise. */
      const card = (document.querySelector('[data-testid="s2-takeover"] [data-testid="agent-question"]') ??
        document.querySelector(`[id="agcard-${only.question.requestId.replace(/["\\]/g, (c) => `\\${c}`)}"] [data-testid="agent-question"]`)) as HTMLElement | null;
      /* The card's own handler has it already. */
      if (card && e.target instanceof Node && card.contains(e.target)) return;
      e.preventDefault();
      if (!card) {
        revealInTranscript({ runId: only.runId, requestId: only.question.requestId, align: 'top' });
        return;
      }
      card.focus({ preventScroll: true });
      card.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true, cancelable: true }));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [only]);
}

export function AgentToasts({
  store,
  repoRoot,
  onShow,
}: {
  store: AgentRunStore;
  repoRoot: string | null;
  onShow?: (spec: ToastSpec) => void;
}) {
  const state = useAgentRuns(store);
  /* y / a / n from anywhere but a text field, while exactly one approval waits. */
  const pending = state.runs.flatMap((r) => r.approvals.filter((a) => a.decision === null));
  const runOf = useCallback((requestId: string) => store.get().runs.find((r) => r.approvals.some((a) => a.requestId === requestId))?.id, [store]);
  useOnlyPendingKeys(
    pending,
    useCallback(
      (a, d) => {
        const runId = runOf(a.requestId);
        if (runId) void store.answer(runId, a.requestId, d);
      },
      [runOf, store],
    ),
  );
  /* 1-9 / y / n from anywhere but a text field, while exactly one question (and no approval) waits. */
  useOnlyQuestionKeys(state.runs.flatMap((r) => (r.questions ?? []).filter((q) => !q.settled).map((q) => ({ runId: r.id, question: q }))), pending.length);
  /* The chat being read, when there is an app store (a specimen has none). */
  const app = useStoreIfAny();
  const none = useCallback(() => () => {}, []);
  const activeSessionId = useSyncExternalStore(app ? app.subscribe : none, () => app?.getState().session.activeId ?? null, () => null);
  const all = toastsFor(state, () => false, Infinity, activeSessionId);
  const visible = useVisibleCards(all.map((t) => ({ key: t.key, selector: cardSelector(specTarget(t)) })));
  const toasts = toastsFor(state, (t) => visible.has(t.key), MAX_TOASTS, activeSessionId);
  const stackRef = useRef<HTMLDivElement>(null);
  const bottom = useToastBottom(stackRef, [toasts.length]);
  if (typeof document === 'undefined' || toasts.length === 0) return null;
  const show =
    onShow ??
    ((spec: ToastSpec) => {
      const selector = cardSelector(specTarget(spec));
      const focus = (el: Element | null): void => {
        if (spec.kind === 'question') {
          /* Its top, below the sticky header; then its answers have the keys. */
          if (el) revealCardTop(el as HTMLElement);
          ((document.querySelector('[data-testid="s2-takeover"] [data-testid="agent-question"]') ?? el?.querySelector('[data-testid="agent-question"]')) as HTMLElement | null)?.focus({ preventScroll: true });
          return;
        }
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        (el?.querySelector('.agcard-toggle') as HTMLElement | null)?.focus();
      };
      const el = document.querySelector(selector);
      if (el) return focus(el);
      /* S6: a long chat draws only the rows near the viewport; the list brings this one in first. */
      const requestId = spec.kind === 'approval' ? spec.approval.requestId : spec.kind === 'question' ? spec.question.requestId : undefined;
      if (revealInTranscript({ runId: spec.runId, ...(requestId ? { requestId } : {}), ...(spec.kind === 'question' ? { align: 'top' as const } : {}) })) {
        setTimeout(() => focus(document.querySelector(selector)), 300);
      }
    });
  return createPortal(
    <div ref={stackRef} className="agtoasts" aria-label="Agent notifications" data-testid="agent-toasts" style={{ bottom }}>
      {toasts.map((t) => (
        <Toast key={t.key} spec={t} store={store} repoRoot={repoRoot} onAnswer={(r, q, d) => void store.answer(r, q, d)} onShow={show} />
      ))}
    </div>,
    document.body,
  );
}
