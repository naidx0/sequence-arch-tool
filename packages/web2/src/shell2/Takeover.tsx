/* ══════════════════════════════════════════════════════════════════════════
   THE COMPOSER TAKEOVER (Decision 49) — an agent's approval, in B's dialog style
   packages/web2/src/shell2/Takeover.tsx

   DeepSeek's logic: while the agent waits on the person, the question takes
   the composer's place (the draft is kept underneath), so the answer is where
   the eye already is. Drawn as uiarc.dev's dialog card (BArc.dc.html .dlg):
   the icon chip, the question, one sentence of why, the files with their
   counts, and No / Always / Yes with their keys (N / A / Y). The oldest
   waiting approval of this chat comes first. Loaded only when one waits.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useSyncExternalStore } from 'react';

import { changesForApproval } from '../agents/agentRunFold';
import { answerPageQuestion } from '../chat/AgentRunThread';
import { QuestionCard } from '../chat/QuestionCard';
import type { AgentQuestion } from '../agents/runNodeStream';
import { agentRuns, type AgentRunStore } from '../agents/agentRuns';
import type { AgentApproval, ApprovalAnswer } from '../agents/runNodeStream';
import { gateAnswerFor, setTakeoverShowing } from '../chat/ApprovalGate';
import { DenyWithReason } from '../composer/DenyWithReason';
import { denyWithReasonFor } from '../composer/rejectFeedback';
import { approvalFilesFor, relativeIn, relativePath } from '../chat/codexChanges';
import { unwrapShell } from '../chat/commandLabel';
import { parseUnifiedDiff } from '../review/diffModel';
import { S2Icon } from './icons';

/** This chat's oldest question the agent still waits on, with its run. */
export function pendingQuestionFor(sessionId: string | null, store: AgentRunStore = agentRuns): { runId: string; question: AgentQuestion; agent: string } | null {
  for (const run of store.get().runs) {
    /* A question waits until the server settles it (answered, cancelled, the turn's end). */
    if (run.sessionId !== sessionId) continue;
    const open = (run.questions ?? []).find((q) => !q.settled);
    if (open) return { runId: run.id, question: open, agent: run.agentRef ?? 'The agent' };
  }
  return null;
}

/** This chat's oldest approval that still waits for a person, with its run. */
export function pendingApprovalFor(sessionId: string | null, store: AgentRunStore = agentRuns): { runId: string; approval: AgentApproval; agent: string } | null {
  const state = store.get();
  for (const run of state.runs) {
    if (run.sessionId !== sessionId || run.status !== 'running') continue;
    const open = run.approvals.find((a) => a.decision === null);
    if (open) return { runId: run.id, approval: open, agent: run.agentRef ?? 'The agent' };
  }
  return null;
}

function counts(diff: string | null, path: string): { added: number; removed: number; isNew: boolean } | null {
  if (!diff) return null;
  const f = parseUnifiedDiff(diff).find((x) => x.path.endsWith(path) || path.endsWith(x.path)) ?? parseUnifiedDiff(diff)[0];
  if (!f) return null;
  return { added: f.added, removed: f.removed, isNew: f.change === 'added' };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function Takeover({
  sessionId,
  repoRoot,
  draftKept,
  store = agentRuns,
  onQuestion = answerPageQuestion,
}: {
  sessionId: string | null;
  repoRoot: string | null;
  draftKept: boolean;
  /** The page's run store; injected by tests. */
  store?: AgentRunStore;
  /** Answer (or, with null, skip) a question; the page's by default. */
  onQuestion?: (runId: string, requestId: string, answers: Parameters<typeof answerPageQuestion>[2]) => void;
}) {
  useSyncExternalStore(store.subscribe, store.get, store.get);
  const asked = pendingQuestionFor(sessionId, store);
  const pending = asked ? null : pendingApprovalFor(sessionId, store);
  /* While the takeover shows, the page's toasts for it stand down (edits.css). */
  const taking = Boolean(asked || pending);
  useEffect(() => {
    if (!taking || typeof document === 'undefined') return undefined;
    document.body.classList.add('s2-taking');
    /* A question is not an approval: only an approval's gates stand down. */
    setTakeoverShowing(pending !== null);
    return () => {
      document.body.classList.remove('s2-taking');
      setTakeoverShowing(false);
    };
  }, [taking, pending !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  /* The question's keys (1-9, Y, N) work from the start: the card takes focus when it arrives. */
  const askedId = asked?.question.requestId ?? null;
  useEffect(() => {
    if (!askedId) return;
    const el = document.querySelector<HTMLElement>('[data-testid="s2-takeover"] [data-testid="agent-question"]');
    if (el && !el.contains(document.activeElement)) el.focus();
  }, [askedId]);
  /* An approval takes focus too, on its safe default (Yes is the answer the
     card is asking for; N and Esc are one key away). Answering gives focus back
     to the composer. */
  const pendingId = pending?.approval.requestId ?? null;
  useEffect(() => {
    if (!pendingId) return undefined;
    const el = document.querySelector<HTMLElement>('[data-testid="s2-takeover-yes"]');
    if (el && !el.closest('[data-testid="s2-takeover"]')?.contains(document.activeElement)) el.focus();
    return () => {
      /* The card is going: the composer is where the reader goes next. */
      const field = document.querySelector<HTMLElement>('[data-testid="composer-field"]');
      const lost = !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;
      if (field && lost) field.focus();
    };
  }, [pendingId]);
  /* Y / A / N from anywhere that is not a text field (the gate's own rule). */
  useEffect(() => {
    if (!pending) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const d = gateAnswerFor(e, pending.approval);
      if (!d) return;
      e.preventDefault();
      void store.answer(pending.runId, pending.approval.requestId, d);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [pending?.runId, pending?.approval]); // eslint-disable-line react-hooks/exhaustive-deps
  if (asked) {
    return (
      <section className="s2-take s2-take-q" role="dialog" aria-label={`${cap(asked.agent)} needs a decision`} data-testid="s2-takeover" data-kind="question" data-approval-id={asked.question.requestId}>
        <div className="s2-take-h">
          <span className="s2-dic s2-dic-sm">
            <S2Icon name="spark" />
          </span>
          <h3 className="s2-grow">{cap(asked.agent)} needs a decision</h3>
          {draftKept ? <span className="s2-meta">Draft kept</span> : null}
        </div>
        <QuestionCard question={asked.question} onAnswer={(a) => onQuestion(asked.runId, asked.question.requestId, a)} />
      </section>
    );
  }
  if (!pending) return null;
  const { runId, approval, agent } = pending;
  const run = store.get().runs.find((r) => r.id === runId)!;
  const files = approvalFilesFor(approval.proposal.files, changesForApproval(run, approval), repoRoot);
  const plan = approval.proposal.plan ?? null;
  const command = files.length === 0 && !plan ? unwrapShell((approval.proposal.title ?? approval.title ?? '').replace(/^Run\s+/, '')) : null;
  const who = cap(agent);
  const title = plan
    ? `${who} has a plan`
    : files.length > 0
      ? `Let ${who} edit ${files.length === 1 ? '1 file' : `${files.length} files`}?`
      : 'Run a command?';
  /* What the agent is told was denied is the thing itself (the command, the files), as the card names it, not this panel's heading. */
  const reasonTitle = command ? `Run ${command}` : files.length > 0 ? `Edit ${files.map((f) => relativePath(f.path, repoRoot)).join(', ')}` : title;
  const sending = approval.sending !== null;
  const answer = (d: ApprovalAnswer) => {
    if (sending) return;
    void store.answer(runId, approval.requestId, d);
  };
  return (
    <section
      className="s2-take"
      role="dialog"
      aria-label={title}
      data-testid="s2-takeover"
      data-approval-id={approval.requestId}
      data-kind={plan ? 'plan' : files.length ? 'edit' : 'command'}
      aria-busy={sending || undefined}
    >
      <div className="s2-take-h">
        <span className="s2-dic s2-dic-sm">
          <S2Icon name={plan ? 'plan' : files.length ? 'pen' : 'term'} />
        </span>
        <h3 className="s2-grow">{title}</h3>
        {draftKept ? <span className="s2-meta">Draft kept</span> : null}
      </div>
      {approval.proposal.rationale ? <p className="s2-take-p">{relativeIn(approval.proposal.rationale, repoRoot)}</p> : null}
      {plan ? <div className="s2-take-plan">{plan}</div> : null}
      {files.length > 0 ? (
        <div className="s2-files">
          {files.map((f) => {
            const c = counts(f.diff, f.path);
            return (
              <div key={f.path} className="s2-fl" data-testid="s2-takeover-file">
                <S2Icon name="file" small />
                <span className="s2-t s2-mono">{relativePath(f.path, repoRoot)}</span>
                {c?.isNew ? <span className="s2-mono s2-ok">new</span> : null}
                {c && !c.isNew && c.added > 0 ? <span className="s2-mono s2-ok">+{c.added}</span> : null}
                {c && !c.isNew && c.removed > 0 ? <span className="s2-mono s2-del">−{c.removed}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {command ? (
        <pre className="s2-cmd" data-testid="s2-takeover-command">
          {command}
        </pre>
      ) : null}
      <div className="s2-da">
        <button type="button" className="s2-btn" data-testid="s2-takeover-no" disabled={sending} onClick={() => answer('deny')}>
          {plan ? 'Keep planning' : 'No'}
          <span className="s2-kbd">N</span>
        </button>
        {approval.always && !plan ? (
          <button type="button" className="s2-btn" data-testid="s2-takeover-always" disabled={sending} title={`Always allow ${approval.always} in this chat`} onClick={() => answer('always')}>
            Always
            <span className="s2-kbd">A</span>
          </button>
        ) : null}
        <button type="button" className="s2-btn s2-blue" data-testid="s2-takeover-yes" disabled={sending} onClick={() => answer('allow')}>
          {sending ? (approval.sending === 'deny' ? 'Denying' : 'Allowing') : plan ? 'Build it' : 'Yes'}
          <span className="s2-kbd s2-kbd-on">Y</span>
        </button>
      </div>
      {!plan ? (
        <div className="s2-take-reason">
          <DenyWithReason
            testIdPrefix="s2-takeover"
            disabled={sending}
            onDeny={(reason) => void denyWithReasonFor(run, { requestId: approval.requestId, title: reasonTitle }, (r, q, d) => store.answer(r, q, d))(reason)}
          />
        </div>
      ) : null}
    </section>
  );
}

export default Takeover;
