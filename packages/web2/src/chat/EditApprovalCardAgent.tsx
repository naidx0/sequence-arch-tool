/* ══════════════════════════════════════════════════════════════════════════
   AN AGENT ASKS — the approval cards for a local agent's requests
   packages/web2/src/chat/EditApprovalCardAgent.tsx

   A local agent driven through run-node (codex app-server, an ACP agent) asks
   before an edit or a command its mode does not cover. The server holds the
   turn and announces the request (`agents/runNodeStream.ts`); these cards are
   where a person answers it.

   THREE SHAPES, ONE QUESTION:
     · a FILE CHANGE is the edit approval card itself, in whole-request mode
       (`wholeOnly`): the agent takes one answer for the request, so per-file
       Accept/Reject would offer an answer it cannot receive. The words are
       Allow / Deny, because that is the agent's question.
     · a COMMAND has no files. It is the command in mono, exactly as the agent
       will run it, with Allow / Deny. Nothing is summarised: the reader is
       approving the text, so the text is what is shown.
     · ANSWERED, either shape folds to ONE ROW saying what was decided and who
       decided it: you, or the server's timeout, or a run that ended first. A
       transcript is a record; the card never vanishes.

   Pure presentation, like EditApprovalCard: everything arrives in props and
   the answer leaves through `onAnswer`.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentApproval, ApprovalAnswer } from '../agents/runNodeStream';
import { ApprovalGate } from './ApprovalGate';
import { approvalFilesFor, relativeIn, type CodexChange } from './codexChanges';
import { EditApprovalCard } from './EditApprovalCard';

import './editApprovalCard.css';

/** The command a request is about: the server titles it `Run <command>`. */
export function commandOf(approval: AgentApproval): string {
  const t = approval.proposal.title ?? approval.title ?? '';
  return t.replace(/^Run\s+/, '');
}

/**
 * The approval as a person reads it: paths relative to the repository root,
 * and codex's change set (the tool call's `changes`, when the stream carried
 * them) drawn as unified diffs, an added file as an add-only diff.
 */
export function agentApprovalView(
  approval: AgentApproval,
  changes: readonly CodexChange[] = [],
  repoRoot: string | null = null,
): AgentApproval {
  const files = approvalFilesFor(approval.proposal.files, changes, repoRoot);
  const title = approval.proposal.title === null ? null : relativeIn(approval.proposal.title, repoRoot);
  return {
    ...approval,
    title: approval.title === null ? null : relativeIn(approval.title, repoRoot),
    proposal: { ...approval.proposal, title, files },
  };
}

/** The folded row's sentence. */
export function answeredSentence(a: AgentApproval): string {
  const verb = a.decision === 'allow' ? 'Allowed' : 'Denied';
  switch (a.answeredBy) {
    case 'timeout':
      return `${verb}: no answer in time, so the mode decided`;
    case 'disconnect':
      return 'Denied: the run ended before anyone answered';
    case 'rule':
      return a.rule ? `Allowed by your rule: always ${a.rule} in this chat` : 'Allowed by your rule';
    default:
      return a.decision === 'allow' && a.rule ? `Allowed by you, and always for ${a.rule} in this chat` : `${verb} by you`;
  }
}

function Folded({ approval }: { approval: AgentApproval }) {
  const what = approval.proposal.files.length > 0 ? approval.proposal.files.map((f) => f.path).join(', ') : commandOf(approval);
  return (
    <section
      className="editapproval editapproval-folded"
      data-testid="agent-approval-folded"
      data-decision={approval.decision ?? 'pending'}
      data-answered-by={approval.answeredBy ?? ''}
      aria-label={answeredSentence(approval)}
    >
      <p className="editapproval-folded-row">
        <span
          className="editapproval-verdict"
          data-testid="agent-approval-answer"
          data-decision={approval.decision === 'allow' ? 'accepted' : 'rejected'}
        >
          {answeredSentence(approval)}
        </span>
        <span className="editapproval-folded-what" title={what}>
          {what}
        </span>
      </p>
    </section>
  );
}

function Sending({ approval }: { approval: AgentApproval }) {
  return (
    <section className="editapproval editapproval-folded" data-testid="agent-approval-sending" aria-busy="true">
      <p className="editapproval-folded-row">
        <span className="editapproval-settled-status">
          {approval.sending === 'deny' ? 'Denying…' : approval.sending === 'always' ? `Allowing, and always for ${approval.always}…` : 'Allowing…'}
        </span>
      </p>
    </section>
  );
}

export function EditApprovalCardCommand({
  approval,
  onAnswer,
}: {
  approval: AgentApproval;
  onAnswer: (requestId: string, decision: ApprovalAnswer) => void;
}) {
  const command = commandOf(approval);
  /* The Ramp Kit's gate, in order: the question, the exact command, the scope
     line (the agent's own reason), the answers with their keys. */
  return (
    <section className="editapproval aggate-card" data-testid="agent-approval-command" aria-label="Run a command">
      <h3 className="aggate-q">Run this command?</h3>
      <pre className="editapproval-cmd aggate-cmd" data-testid="agent-approval-command-text">
        {command}
      </pre>
      {approval.proposal.rationale ? <p className="aggate-scope">{approval.proposal.rationale}</p> : null}
      <div className="editapproval-acts" data-testid="agent-approval-acts">
        <ApprovalGate approval={approval} testIdPrefix="agent-approval" onAnswer={(d) => onAnswer(approval.requestId, d)} />
      </div>
    </section>
  );
}

export function AgentApprovalCard({
  approval: raw,
  onAnswer,
  changes,
  repoRoot = null,
}: {
  approval: AgentApproval;
  onAnswer: (requestId: string, decision: ApprovalAnswer) => void;
  /** The tool call's codex change set, when the stream carried one. */
  changes?: readonly CodexChange[];
  /** Paths are shown relative to this. */
  repoRoot?: string | null;
}) {
  const approval = agentApprovalView(raw, changes, repoRoot);
  if (approval.decision !== null) return <Folded approval={approval} />;
  if (approval.sending !== null) return <Sending approval={approval} />;
  if (approval.proposal.files.length === 0) return <EditApprovalCardCommand approval={approval} onAnswer={onAnswer} />;
  const answer = (d: 'accepted' | 'rejected') => onAnswer(approval.requestId, d === 'accepted' ? 'allow' : 'deny');
  return (
    <EditApprovalCard
      proposalId={approval.proposal.proposalId}
      title={approval.proposal.title}
      rationale={approval.proposal.rationale}
      files={approval.proposal.files.map((f) => ({ path: f.path, diff: f.diff, decision: 'pending' as const }))}
      wholeOnly
      actLabels={{ accept: 'Allow once', reject: 'Deny' }}
      onDecideFile={(_id, _path, d) => answer(d)}
      onDecideAll={(_id, d) => answer(d)}
    />
  );
}

/** Every approval of one run, oldest first. Draws nothing when there are none. */
export function AgentApprovals({
  approvals,
  onAnswer,
}: {
  approvals: AgentApproval[];
  onAnswer: (requestId: string, decision: ApprovalAnswer) => void;
}) {
  if (approvals.length === 0) return null;
  return (
    <div className="editapproval-stack" data-testid="agent-approvals">
      {approvals.map((a) => (
        <AgentApprovalCard key={a.requestId} approval={a} onAnswer={onAnswer} />
      ))}
    </div>
  );
}
