/* ══════════════════════════════════════════════════════════════════════════
   AN AGENT RUN, IN THE CHAT THREAD
   packages/web2/src/chat/AgentRunThread.tsx

   One run-node turn (agents/agentRuns.ts) drawn where the person is already
   reading: a header naming the agent and the board node it was pinned to,
   the question, then the agent's text and its work in arrival order.

   EVERY PIECE OF WORK IS ONE CARD, AND EVERY CARD FOLDS. Tool calls, diffs,
   the plan and approval requests share one shape: a 32 px header that says
   what it is, its status and how long it took, and a body that opens in
   place. A pending approval keeps Allow and Deny on its header, so answering
   never needs the card open; opening it shows the diff (or the command)
   being approved, with the answer buttons inside.

   Pure presentation: runs and the answer callback arrive in props.
   ══════════════════════════════════════════════════════════════════════════ */

import { followUpPrompt, stripAskLine } from '@sequence/schema';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

import { changesForApproval } from '../agents/agentRunFold';
import { agentRuns, type AgentRun, type AgentRunStore, type AgentRunsState, type RunItem, type RunPlan, type RunThought, type RunTool } from '../agents/agentRuns';
import { denyWithReasonFor } from '../composer/rejectFeedback';
import { formatElapsed } from '../agents/agentStream';
import { answerQuestion, type AgentApproval, type AgentQuestion, type ApprovalAnswer, type QuestionAnswers, type RunNodeEvent } from '../agents/runNodeStream';
import { parseUnifiedDiff } from '../review/diffModel';
import { relativeIn, relativePath, replacementDiff, unifiedDiffFor } from './codexChanges';
import { ApprovalGate, gateKeyHandler } from './ApprovalGate';
import { agentApprovalView, answeredSentence, commandOf } from './EditApprovalCardAgent';
import { EditFromHere, rewoundNote } from './EditFromHere';
import { ProseMessage } from './ProseMessage';
import { RecoveryCard, vendorOf, type RetryFn } from './RecoveryCard';
import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { ChatStatus } from './ChatStatus';
import { keptOpen, resetKeptOpen } from './keptOpen';
import { RunLiveStatus } from './RunLiveStatus';
import { ShowWhatItRead } from './ShowWhatItRead';
import { isStarting, RunWatchdog, watchdogLevel } from './RunWatchdog';
import { byteSize, fetchStreamBody, withStringAt, type CappedBody } from './cappedBody';
import { anchorRowTop } from './transcriptNav';
import { CliPlanCard } from './cliPlan';
import { QuestionCard, questionStatus, questionTitle } from './QuestionCard';
import { revealCardTop } from './revealCard';
import { S2Icon } from '../shell2/icons';
import { splitSubagent, SUBAGENT_REVEAL_EVENT, subagentAnchor } from '../agents/subagents';
import { subagentLabel } from './subagentLabel';
import { foldSummary, splitToolTitle, unwrapShell } from './commandLabel';

import { coverageFromRun, type GraphFacts } from './coverageLine';
import './agentRun.css';
import './toolRows.css';
import './subagent.css';

export function useAgentRuns(store: AgentRunStore): AgentRunsState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** Re-render every half second while something runs, so durations move. */
export function useTicking(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return active ? now : Date.now();
}

/**
 * S6: WHAT IS OPEN STAYS OPEN. The transcript is virtualized, so a card
 * scrolled out of view is unmounted; its open state lives here, by key, so it
 * comes back the way it was left.
 */
export { resetKeptOpen };
export function useKeptOpen(key: string, initial: boolean): [boolean, (fn: (open: boolean) => boolean) => void] {
  const [open, setOpenState] = useState(() => keptOpen.get(key) ?? initial);
  const setOpen = useCallback(
    (fn: (open: boolean) => boolean) =>
      setOpenState((was) => {
        const next = fn(was);
        keptOpen.set(key, next);
        return next;
      }),
    [key],
  );
  return [open, setOpen];
}

export type CardKind = 'tool' | 'diff' | 'plan' | 'approval' | 'question';

/** S6: fold one more event into a run (a "Show all" puts a whole body back). */
export type ApplyEvent = (runId: string, e: RunNodeEvent) => void;
const applyToPageRuns: ApplyEvent = (runId, e) => agentRuns.apply(runId, e);

/** Answer (or, with null, cancel) the agent's question. */
export type OnQuestion = (runId: string, requestId: string, answers: QuestionAnswers | null) => void;

/** The page's: shown as sending at once, given back if the server no longer holds it. */
export const answerPageQuestion: OnQuestion = (runId, requestId, answers) => {
  agentRuns.apply(runId, { type: 'acp:question', requestId, sending: true });
  void answerQuestion(requestId, answers).then((ok) => {
    if (!ok) agentRuns.apply(runId, { type: 'acp:question', requestId, sending: false });
  });
};


const TOOL_ICON: Record<string, 'file' | 'pen' | 'term' | 'search' | 'globe' | 'trash' | 'bolt'> = {
  read: 'file',
  edit: 'pen',
  move: 'pen',
  delete: 'trash',
  execute: 'term',
  search: 'search',
  fetch: 'globe',
};

/** One folding card: a 32 px header, a body that opens in place. */
export function AgentCard({
  kind,
  id,
  title,
  status,
  statusWord,
  durationMs,
  toolKind,
  verb,
  actions,
  defaultOpen = false,
  approvalId,
  onKeyDown,
  keepKey,
  children,
}: {
  kind: CardKind;
  id: string;
  /** Where the open state is kept (S6); the kind and id by default. */
  keepKey?: string;
  title: string;
  /** For styling: running, done, failed, waiting, allowed, denied. */
  status: string;
  statusWord: string;
  durationMs: number | null;
  toolKind?: string | null;
  /** The quiet word before the title ("Read", "Run"); the title is then what it acted on. */
  verb?: string | null;
  /** Shown on the header while the card is closed (an approval's Allow / Deny). */
  actions?: ReactNode;
  defaultOpen?: boolean;
  /** The approval this card carries, so a toast can find it. */
  approvalId?: string;
  /** The gate's keys (y / a / n) while an approval in this card is open. */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLElement>) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useKeptOpen(keepKey ?? `card:${id}`, defaultOpen);
  /* A card drawn before its question arrived (ExitPlanMode's plan) opens when it does. */
  useEffect(() => {
    if (defaultOpen) setOpen(() => true);
  }, [defaultOpen, setOpen]);
  const bodyId = `agcard-body-${id}`;
  /* Decision 49: B's step row. The state at the left (a spinner while it
     runs, a check, a cross, the accent dot while it waits on you), the step,
     its word and its time, and the body folded until asked for. */
  const rowIcon = kind === 'tool' || kind === 'diff' ? TOOL_ICON[toolKind ?? ''] ?? (kind === 'diff' ? 'pen' : 'bolt') : null;
  const mark =
    status === 'running' ? (
      <span data-testid="agent-card-loader" className="s2-spin-slot">
        <AsciiSpinner />
      </span>
    ) : status === 'failed' || status === 'denied' ? (
      <S2Icon name="x" small className="s2-del" />
    ) : status === 'waiting' ? (
      <span className="s2-dot" aria-hidden="true" />
    ) : rowIcon ? (
      <S2Icon name={rowIcon} small className="r9-kindicon" />
    ) : (
      <S2Icon name="check" small className="s2-ok" />
    );
  return (
    <section
      className="s2-agcard"
      id={`agcard-${id}`}
      data-approval-id={approvalId}
      data-kind={kind}
      data-status={status}
      data-open={open ? 'true' : 'false'}
      data-testid={`agent-card-${kind}`}
      {...(onKeyDown ? { tabIndex: -1, onKeyDown } : {})}
    >
      <div className="s2-agcard-hd">
        <button
          type="button"
          className="s2-st-row"
          aria-expanded={open}
          aria-controls={bodyId}
          data-testid="agent-card-toggle"
          title={verb ? `${verb} ${title}` : title}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="s2-agmark" data-testid="agent-card-dot" aria-hidden="true">
            {mark}
          </span>
          {verb ? (
            <span className="r9-verb" data-testid="agent-card-verb">
              {verb}{' '}
            </span>
          ) : null}
          <span className={`s2-t${verb ? ' r9-target' : ''}${status === 'running' ? ' shimmer-text' : ''}`} data-testid="agent-card-title">{title}</span>
          <span className="s2-meta r9-stword" data-testid="agent-card-status">
            {statusWord}
          </span>
          {visibleDuration(durationMs) !== null ? (
            <span className="s2-meta s2-mono" data-testid="agent-card-duration">
              {visibleDuration(durationMs)}
            </span>
          ) : null}
          <S2Icon name={open ? 'chev' : 'chevr'} small className="s2-st-chev" />
        </button>
        {actions && !open ? <span className="s2-agcard-acts">{actions}</span> : null}
      </div>
      {open ? (
        <div className="s2-agcard-body" id={bodyId} data-testid="agent-card-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** A unified diff, drawn line by line with its signs. */
export function DiffLines({ diff, testId = 'agent-diff' }: { diff: string; testId?: string }) {
  const files = useMemo(() => parseUnifiedDiff(diff), [diff]);
  if (files.length === 0) return <p className="s2-empty">No diff to show.</p>;
  return (
    <div className="s2-agdiff" data-testid={testId}>
      {files.map((f, fi) => (
        <div key={fi} className="s2-agdiff-file">
          <p className="s2-fold s2-fold-static">
            <S2Icon name="file" small />
            <span className="s2-t s2-mono">{f.path}</span>
            {f.added ? <span className="s2-mono s2-ok">+{f.added}</span> : null}
            {f.removed ? <span className="s2-mono s2-del">−{f.removed}</span> : null}
          </p>
          <div className="s2-code s2-mono">
            {f.hunks.flatMap((h, hi) =>
              h.lines.map((l, li) => (
                <div key={`${hi}-${li}`} className={`s2-cl${l.kind === 'add' ? ' a' : l.kind === 'del' ? ' d' : ''}`} data-kind={l.kind}>
                  <i>{l.kind === 'del' ? l.oldLine : l.newLine}</i>
                  <span>{l.text || ' '}</span>
                </div>
              )),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The unified diffs a tool call carries: codex's change set, or ACP diff blocks. */
export function toolDiffs(tool: RunTool, repoRoot: string | null): string[] {
  if (tool.changes.length) return tool.changes.map((c) => unifiedDiffFor(c, repoRoot));
  return tool.diffs.map((d) =>
    d.oldText === null
      ? unifiedDiffFor({ path: d.path, kind: 'add', diff: d.newText, movePath: null }, repoRoot)
      : replacementDiff(d.path, d.oldText, d.newText, repoRoot),
  );
}

const TOOL_WORD: Record<RunTool['status'], string> = { running: 'running', done: 'done', failed: 'failed' };

/**
 * ONE CARD PER TOOL CALL. A file change or command the agent has to ask about
 * arrives twice on the wire (the tool call, then the approval for the same
 * call id); it is drawn once. While the question is open the card says
 * "needs you", carries Allow / Deny on its header, and shows the change once,
 * inside the approval. Once answered, the card goes back to the call's own
 * status, with the verdict as its first line.
 */
/**
 * S6: "SHOW ALL". The server cut a body of this call to its first 8 KB and
 * named it (capped[], chat/cappedBody.ts). The button fetches the whole body
 * and puts it back where it was cut, in the call's own update, which is
 * folded again: the card then shows the whole output or diff. The card's top
 * stays where it is on screen while it grows (anchorRowTop).
 */
function ShowAll({ run, tool, onApply }: { run: AgentRun; tool: RunTool; onApply: ApplyEvent }) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<(() => void) | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useLayoutEffect(() => {
    restore.current?.();
    restore.current = null;
  }, [tool.output, tool.diffs]);
  const capped = tool.capped ?? [];
  if (capped.length === 0) return null;
  const show = (c: CappedBody): void => {
    setBusy(c.id);
    setError(null);
    fetchStreamBody(c.id, run.sessionId).then(
      (text) => {
        restore.current = ref.current ? anchorRowTop(ref.current) : null;
        const whole = withStringAt(tool.capSource, c.at, text) as Record<string, unknown>;
        /* Only the body comes back: the call's status and title stay as they are now. */
        const inner = (whole.update as { update?: Record<string, unknown> } | undefined)?.update;
        if (inner) {
          delete inner.status;
          delete inner.title;
        }
        onApply(run.id, { ...whole, capped: capped.filter((x) => x.id !== c.id) } as unknown as RunNodeEvent);
        setBusy(null);
      },
      (e: unknown) => {
        setBusy(null);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
  };
  return (
    <div ref={ref} className="agcard-capped" data-testid="agent-card-capped">
      {capped.map((c) => (
        <button
          key={c.id}
          type="button"
          className="agbtn agbtn-quiet"
          data-testid="agent-card-show-all"
          aria-label={`Show all of this output (${byteSize(c.bytes)})`}
          disabled={busy !== null}
          onClick={() => show(c)}
        >
          {busy === c.id ? 'Loading…' : `Show all (${byteSize(c.bytes)})`}
        </button>
      ))}
      {error ? (
        <p className="agcard-note" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ToolItem({
  run,
  tool,
  approvals,
  now,
  repoRoot,
  onAnswer,
  onApply,
}: {
  run: AgentRun;
  tool: RunTool;
  approvals: AgentApproval[];
  now: number;
  repoRoot: string | null;
  onAnswer: (requestId: string, d: ApprovalAnswer) => void;
  onApply: ApplyEvent;
}) {
  const diffs = toolDiffs(tool, repoRoot);
  const kind: CardKind = diffs.length ? 'diff' : 'tool';
  const open = approvals.find((x) => x.decision === null) ?? null;
  const asked = open ?? approvals[approvals.length - 1] ?? null;
  const verdict = asked && asked.decision !== null ? approvalStatus(asked) : null;
  const denied = verdict !== null && verdict.status === 'denied';
  const status = open ? 'waiting' : denied ? 'denied' : tool.status;
  const word = open ? approvalStatus(open).word : denied ? verdict.word : TOOL_WORD[tool.status];
  const output = diffs.length ? (
    diffs.map((d, i) => <DiffLines key={i} diff={d} />)
  ) : tool.output ? (
    <pre className="s2-st-body">{tool.output}</pre>
  ) : asked ? null : (
    <p className="s2-empty">{tool.toolKind ? `${tool.toolKind} call` : 'Tool call'}; the agent reported no output.</p>
  );
  const parts = splitToolTitle(relativeIn(tool.title, repoRoot), tool.toolKind);
  return (
    <AgentCard
      kind={kind}
      id={tool.id}
      keepKey={`card:${run.id}:${tool.id}`}
      approvalId={asked?.requestId}
      verb={parts.verb}
      title={parts.target}
      defaultOpen={!!open?.proposal.plan}
      status={status}
      statusWord={word}
      durationMs={(tool.endedAt ?? now) - tool.startedAt}
      toolKind={tool.toolKind}
      actions={open ? <ApprovalButtons approval={open} run={run} compact onAnswer={(d) => onAnswer(open.requestId, d)} /> : undefined}
      onKeyDown={open ? gateKeyHandler(open, (d) => onAnswer(open.requestId, d)) : undefined}
    >
      {/* Open: the approval card is the body, and it holds the diff. Answered:
          the verdict row, then the call's own diff or output. */}
      {/* An open ExitPlanMode is the plan card: Build allows, Keep planning denies. */}
      {open?.proposal.plan ? (
        <CliPlanCard
          content={open.proposal.plan}
          busy={open.sending !== null}
          onBuild={() => onAnswer(open.requestId, 'allow')}
          onKeepPlanning={() => onAnswer(open.requestId, 'deny')}
        />
      ) : asked ? (
        <ApprovalBody approval={asked} run={run} repoRoot={repoRoot} onAnswer={onAnswer} />
      ) : null}
      {open ? null : output}
      {open ? null : <ShowAll run={run} tool={tool} onApply={onApply} />}
    </AgentCard>
  );
}

/**
 * Decision 49: an approval inside the thread. While it waits, the composer's
 * takeover asks it (DeepSeek), so the thread says so in one line; once
 * answered, the verdict in one line; the change itself opens below.
 */
function ApprovalBody({
  approval,
  run,
  repoRoot,
  onAnswer,
}: {
  approval: AgentApproval;
  run: AgentRun;
  repoRoot: string | null;
  onAnswer: (requestId: string, d: ApprovalAnswer) => void;
}) {
  void onAnswer;
  const view = agentApprovalView(approval, changesForApproval(run, approval), repoRoot);
  return (
    <div className="s2-agappr" data-testid={approval.decision === null ? 'agent-approval-waiting' : 'agent-approval-folded'} data-decision={approval.decision ?? 'pending'} data-answered-by={approval.answeredBy ?? ''}>
      <p className="s2-agappr-line">
        {approval.decision === null ? (
          <>
            <span className="s2-dot" aria-hidden="true" />
            <span>{approval.sending ? 'Sending your answer' : 'Waiting for you, answer in the composer'}</span>
          </>
        ) : (
          <span data-testid="agent-approval-answer" data-decision={approval.decision === 'allow' ? 'accepted' : 'rejected'}>
            {answeredSentence(view)}
          </span>
        )}
      </p>
      {/* While it waits, the change it asks about; once answered, the call's own diff tells it (drawn once). */}
      {approval.decision === null ? view.proposal.files.map((f) => (f.diff ? <DiffLines key={f.path} diff={f.diff} testId="chat-edit-approval-diff" /> : null)) : null}
      {view.proposal.files.length === 0 && approval.proposal.title ? (
        <pre className="s2-cmd" data-testid="agent-approval-command-text">
          {commandOf(view)}
        </pre>
      ) : null}
    </div>
  );
}

function PlanItem({ runId, plan, now }: { runId: string; plan: RunPlan; now: number }) {
  const done = plan.entries.filter((e) => e.status === 'completed').length;
  return (
    <AgentCard
      kind="plan"
      id={plan.id}
      keepKey={`plan:${runId}:${plan.id}`}
      title="Plan"
      status={plan.endedAt ? 'done' : 'running'}
      statusWord={`${done} of ${plan.entries.length} done`}
      durationMs={(plan.endedAt ?? now) - plan.startedAt}
    >
      <ol className="s2-plan">
        {plan.entries.map((e, i) => (
          <li key={i} className="s2-plan-step" data-status={e.status}>
            {e.status === 'completed' ? <S2Icon name="check" small className="s2-ok" /> : e.status === 'in_progress' ? <AsciiSpinner /> : <span className="s2-ring" aria-hidden="true" />}
            <span>{e.content}</span>
          </li>
        ))}
      </ol>
    </AgentCard>
  );
}

/** "1.9 s" under a minute, then the run clock's own "2m 05s". */
/** A step or subagent under 100 ms is too quick to time: it shows no "0ms" or "1ms" (R10). */
export function visibleDuration(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) && ms >= 100 ? formatElapsed(ms) : null;
}

export function thoughtTime(ms: number): string {
  return ms < 60_000 ? `${(Math.max(0, ms) / 1000).toFixed(1)} s` : formatElapsed(ms);
}

/**
 * S2b, THE THINKING FOLD. "Thinking" with its clock while the agent thinks;
 * "Thought for 12.2 s" once the first answer token or tool call arrives. The
 * text (when the agent sends any) opens in place; codex's reasoning carries
 * none, so its fold is the time alone.
 */
function ThoughtItem({ runId, thought, now }: { runId: string; thought: RunThought; now: number }) {
  const [open, setOpen] = useKeptOpen(`thought:${runId}:${thought.id}`, false);
  const live = thought.endedAt === null;
  const ms = thought.ms ?? (thought.endedAt ?? now) - thought.startedAt;
  const text = thought.text.trim();
  /* Codex can stamp a reasoning item with one time for start and end: no text and no time is nothing to show. */
  if (!live && !text && ms < 100) return null;
  return (
    <section className="s2-think" data-testid="agent-thought" data-live={live || undefined} data-open={open || undefined}>
      <button type="button" className={`s2-think-h${live ? ' live' : ''}`} aria-expanded={text ? open : undefined} disabled={!text} onClick={() => setOpen((o) => !o)}>
        {live ? <AsciiSpinner /> : <S2Icon name="spark" small className="r9-kindicon" />}
        <span className={`s2-grow${live ? ' shimmer-text' : ''}`} data-glimmer={live || undefined} data-testid="agent-thought-label">{live ? 'Thinking' : `Thought for ${thoughtTime(ms)}`}</span>
        {live ? <span className="s2-meta s2-mono">{thoughtTime(ms)}</span> : null}
        {text ? <S2Icon name={open ? 'chev' : 'chevr'} small /> : null}
      </button>
      {open && text ? <p className="s2-think-b" data-testid="agent-thought-text">{text}</p> : null}
    </section>
  );
}

export function approvalStatus(a: AgentApproval): { status: string; word: string } {
  if (a.decision === null) return a.sending ? { status: 'waiting', word: a.sending === 'deny' ? 'denying' : 'allowing' } : { status: 'waiting', word: 'needs you' };
  if (a.answeredBy === 'rule') return { status: 'allowed', word: 'allowed by your rule' };
  if (a.answeredBy === 'timeout') return { status: a.decision === 'allow' ? 'allowed' : 'denied', word: `${a.decision === 'allow' ? 'allowed' : 'denied'}, timed out` };
  if (a.answeredBy === 'disconnect') return { status: 'denied', word: 'denied, run ended' };
  return { status: a.decision === 'allow' ? 'allowed' : 'denied', word: a.decision === 'allow' ? 'allowed' : 'denied' };
}

/** "Edit hello.txt" / "Run npm test": what the agent is asking to do. */
export function approvalTitle(a: AgentApproval, repoRoot: string | null): string {
  if (a.proposal.files.length === 0) return `Run ${unwrapShell(commandOf(a))}`;
  return `Edit ${a.proposal.files.map((f) => relativePath(f.path, repoRoot)).join(', ')}`;
}

/** The gate's three answers (ApprovalGate.tsx): the card header and the toast both use it. */
export function ApprovalButtons({
  approval,
  onAnswer,
  compact = false,
  run,
}: {
  approval: AgentApproval;
  onAnswer: (d: ApprovalAnswer) => void;
  compact?: boolean;
  /** S5: with its run, the gate also offers "Deny with reason…" (the reason reaches the agent). */
  run?: AgentRun;
}) {
  return (
    <ApprovalGate
      approval={approval}
      onAnswer={onAnswer}
      compact={compact}
      onDenyWithReason={run ? (r) => void denyWithReasonFor(run, { requestId: approval.requestId, title: approvalTitle(approval, null) }, agentRuns.answer)(r) : undefined}
    />
  );
}

function ApprovalItem({
  run,
  approval,
  at,
  settledAt,
  now,
  repoRoot,
  onAnswer,
}: {
  run: AgentRun;
  approval: AgentApproval;
  at: number;
  settledAt: number | null;
  now: number;
  repoRoot: string | null;
  onAnswer: (requestId: string, d: ApprovalAnswer) => void;
}) {
  const { status, word } = approvalStatus(approval);
  return (
    <AgentCard
      kind="approval"
      id={approval.requestId}
      keepKey={`card:${run.id}:${approval.requestId}`}
      title={approvalTitle(approval, repoRoot)}
      status={status}
      statusWord={word}
      durationMs={(settledAt ?? now) - at}
      actions={<ApprovalButtons approval={approval} run={run} compact onAnswer={(d) => onAnswer(approval.requestId, d)} />}
      onKeyDown={approval.decision === null ? gateKeyHandler(approval, (d) => onAnswer(approval.requestId, d)) : undefined}
    >
      <ApprovalBody approval={approval} run={run} repoRoot={repoRoot} onAnswer={onAnswer} />
    </AgentCard>
  );
}

/** Approvals that belong to a tool call in this run, by the call's id. */
export function mergedApprovals(run: AgentRun): { byTool: Map<string, AgentApproval[]>; inCard: Set<string> } {
  const tools = new Set(run.items.filter((i) => i.kind === 'tool').map((i) => i.id));
  const byTool = new Map<string, AgentApproval[]>();
  const inCard = new Set<string>();
  for (const a of run.approvals) {
    if (!a.toolCallId || !tools.has(a.toolCallId)) continue;
    byTool.set(a.toolCallId, [...(byTool.get(a.toolCallId) ?? []), a]);
    inCard.add(a.requestId);
  }
  return { byTool, inCard };
}

/** The ids of the run's subagent (Task) calls. */
function subagentIds(run: AgentRun): Set<string> {
  return new Set(run.items.filter((i): i is RunTool => i.kind === 'tool' && !!i.subagent).map((i) => i.id));
}

const RUN_WORD: Record<AgentRun['status'], string> = { running: 'Running', done: 'Finished', failed: 'Failed' };

/**
 * RUNS OF SETTLED TOOL CALLS FOLD INTO ONE ROW (S2b). Consecutive tool
 * items, none still running or waiting on a person, become one group; every
 * other item stands alone. A group of one is not folded.
 */
export function foldRuns(run: AgentRun, merged: { byTool: Map<string, AgentApproval[]>; inCard: Set<string> }): RunItem[][] {
  const settled = (i: RunItem): boolean =>
    i.kind === 'tool' && i.status !== 'running' && !(merged.byTool.get(i.id) ?? []).some((a) => a.decision === null) && !i.subagent;
  const out: RunItem[][] = [];
  const subagents = subagentIds(run);
  for (const item of run.items) {
    /* An approval drawn inside its call's card takes no place of its own. */
    if (item.kind === 'approval' && merged.inCard.has(item.id)) continue;
    /* A subagent's own steps are drawn inside its subthread card. */
    if (item.kind === 'tool' && item.parentId && subagents.has(item.parentId)) continue;
    const last = out[out.length - 1];
    if (settled(item) && last && settled(last[0]!)) last.push(item);
    else out.push([item]);
  }
  return out;
}

/** "Ran 3 commands, edited 2 files", opening onto the calls. */
function ToolFold({ keepKey, items, children }: { keepKey: string; items: RunItem[]; children: ReactNode }) {
  const [open, setOpen] = useKeptOpen(keepKey, false);
  const tools = items.filter((i): i is RunTool => i.kind === 'tool');
  const failed = tools.filter((t) => t.status === 'failed').length;
  /* The timeline's span: first step started to last step ended. */
  const startedAt = Math.min(...items.map((i) => i.kind === 'tool' || i.kind === 'thought' ? i.startedAt : Infinity));
  const endedAt = Math.max(...items.map((i) => (i.kind === 'tool' || i.kind === 'thought' ? (i.endedAt ?? i.startedAt) : 0)));
  const span = Number.isFinite(startedAt) && endedAt > startedAt ? endedAt - startedAt : null;
  return (
    <div className="s2-agfold" data-testid="agent-tool-fold" data-open={open ? 'true' : 'false'}>
      <button type="button" className="s2-st-row" aria-expanded={open} data-testid="agent-tool-fold-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="s2-agmark" aria-hidden="true">
          {failed ? <S2Icon name="x" small className="s2-del" /> : <S2Icon name="check" small className="s2-ok" />}
        </span>
        <span className="s2-t" data-testid="agent-tool-fold-summary">
          {foldSummary(tools.map((t) => ({ toolKind: t.toolKind, files: t.changes.length || t.diffs.length })))}
        </span>
        {failed ? <span className="s2-meta s2-del">{failed} failed</span> : null}
        {visibleDuration(span) !== null ? <span className="s2-meta s2-mono" data-testid="agent-tool-fold-span">{visibleDuration(span)}</span> : null}
        <S2Icon name={open ? 'chev' : 'chevr'} small className="s2-st-chev" />
      </button>
      {open ? <div className="s2-agfold-body">{children}</div> : null}
    </div>
  );
}

/** The agent's question as a card: open while it waits, one folded row once settled. */
/** Questions already brought into view once: a card the virtualized list draws again is not scrolled to again. */
const revealedQuestions = new Set<string>();
/** Tests: forget which questions were revealed. */
export function resetRevealedQuestions(): void {
  revealedQuestions.clear();
}

function QuestionItem({ run, question, at, settledAt, now, onQuestion }: { run: AgentRun; question: AgentQuestion; at: number; settledAt: number | null; now: number; onQuestion: OnQuestion }) {
  const { status, word } = questionStatus(question);
  /* A question that arrives is brought into view by its top, below the sticky header (revealCard.ts). */
  useEffect(() => {
    if (question.settled || revealedQuestions.has(question.requestId) || typeof document === 'undefined') return;
    const card = document.getElementById(`agcard-${question.requestId}`);
    if (!card) return;
    revealedQuestions.add(question.requestId);
    revealCardTop(card);
  }, [question.requestId, question.settled]);
  return (
    <AgentCard
      kind="question"
      id={question.requestId}
      keepKey={`card:${run.id}:${question.requestId}`}
      title={questionTitle(question)}
      status={status}
      statusWord={word}
      durationMs={(settledAt ?? now) - at}
      defaultOpen={!question.settled}
    >
      {/* Decision 49: the composer's takeover asks it; the thread says so, then keeps the answer. */}
      {question.settled ? (
        <QuestionCard question={question} onAnswer={(a) => onQuestion(run.id, question.requestId, a)} />
      ) : (
        <p className="s2-agappr-line" data-testid="agent-question-waiting">
          <span className="s2-dot" aria-hidden="true" />
          <span>{question.sending ? 'Sending your answer' : 'Waiting for you, answer in the composer'}</span>
        </p>
      )}
    </AgentCard>
  );
}

type Merged = ReturnType<typeof mergedApprovals>;
type OnAnswer = (runId: string, requestId: string, d: ApprovalAnswer) => void;

/**
 * A SUBAGENT IS A SUBTHREAD (R10, C4). The Task call is a nested, collapsible
 * card: the agent type and what it was asked, its own steps inside (the calls
 * the bridge tagged with this call as their parent), its state and how long it
 * ran. Open while it runs or waits on a person; the rail's sub-row opens it
 * and scrolls here (agents/subagents.ts).
 */
function SubagentThread({ run, tool, merged, now, repoRoot, onAnswer, onApply }: { run: AgentRun; tool: RunTool; merged: Merged; now: number; repoRoot: string | null; onAnswer: OnAnswer; onApply: ApplyEvent }) {
  const [open, setOpen] = useKeptOpen(`sub:${run.id}:${tool.id}`, tool.status === 'running');
  const kids = run.items.filter((i): i is RunTool => i.kind === 'tool' && i.parentId === tool.id);
  /* A subagent inside a subagent is a nested subthread: its steps count and its questions surface here too. */
  const within = (id: string, seen = new Set<string>()): RunTool[] =>
    run.items.filter((i): i is RunTool => i.kind === 'tool' && i.parentId === id && !seen.has(i.id)).flatMap((k) => [k, ...within(k.id, seen.add(k.id))]);
  const asking = within(tool.id).some((k) => (merged.byTool.get(k.id) ?? []).some((a) => a.decision === null));
  const { name, description } = splitSubagent(tool.subagent);
  const label = subagentLabel(name, description);
  const anchor = subagentAnchor(run.id, tool.id);
  useEffect(() => {
    if (asking) setOpen(() => true);
  }, [asking, setOpen]);
  useEffect(() => {
    const on = (e: Event): void => {
      const d = (e as CustomEvent<{ runId?: string; toolId?: string }>).detail;
      if (d?.runId !== run.id || d?.toolId !== tool.id) return;
      setOpen(() => true);
      requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView?.({ block: 'nearest' }));
    };
    window.addEventListener(SUBAGENT_REVEAL_EVENT, on);
    return () => window.removeEventListener(SUBAGENT_REVEAL_EVENT, on);
  }, [anchor, run.id, tool.id, setOpen]);
  const state = asking ? 'waiting' : tool.status;
  const word = asking ? 'needs you' : TOOL_WORD[tool.status];
  const subDuration = visibleDuration((tool.endedAt ?? now) - tool.startedAt);
  const bodyId = `${anchor}-body`;
  return (
    <section className="agsub" id={anchor} data-testid="agent-subagent" data-status={state} data-open={open ? 'true' : 'false'}>
      <button type="button" className="agsub-hd" aria-expanded={open} aria-controls={bodyId} data-testid="agent-subagent-toggle" onClick={() => setOpen((o) => !o)}>
        <S2Icon name={open ? 'chev' : 'chevr'} small className="agsub-chev" />
        <span className="agsub-dot" data-state={state} aria-hidden="true">
          {state === 'running' ? <AsciiSpinner /> : null}
        </span>
        <span className={`agsub-name${state === 'running' ? ' shimmer-text' : ''}`} data-testid="agent-subagent-name">{label.title}</span>
        {label.detail ? <span className="agsub-desc" data-testid="agent-subagent-desc" title={label.detail}>{label.detail}</span> : null}
        <span className="agsub-meta">
          {kids.length ? `${kids.length} step${kids.length === 1 ? '' : 's'}, ` : ''}
          <span data-testid="agent-subagent-status">{word}</span>
          {subDuration !== null ? (
            <>
              {', '}
              <span className="s2-mono" data-testid="agent-subagent-duration">{subDuration}</span>
            </>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="agsub-body" id={bodyId} data-testid="agent-subagent-body">
          {kids.length === 0 && !tool.output ? <p className="agsub-empty">{tool.status === 'running' ? 'Starting' : 'No steps reported'}</p> : null}
          {kids.map((k) => k.subagent ? (
            <SubagentThread key={k.id} run={run} tool={k} merged={merged} now={now} repoRoot={repoRoot} onAnswer={onAnswer} onApply={onApply} />
          ) : (
            <ToolItem key={k.id} run={run} tool={k} approvals={merged.byTool.get(k.id) ?? []} now={now} repoRoot={repoRoot} onAnswer={(rid, d) => onAnswer(run.id, rid, d)} onApply={onApply} />
          ))}
          {tool.output && tool.status !== 'running' ? (
            <div className="agsub-result" data-testid="agent-subagent-result">
              <ProseMessage text={tool.output} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** One item of a run, as the thread draws it. */
function renderRunItem(run: AgentRun, item: RunItem, merged: Merged, now: number, repoRoot: string | null, onAnswer: OnAnswer, onApply: ApplyEvent, onQuestion: OnQuestion): ReactNode {
  /* The block cursor sits at the end of the text while it is the run's
     latest item and the turn streams. Plan, usage and limit updates change
     records in place, so they do not move it; a thought or a call does. */
  if (item.kind === 'message') {
    const streaming = run.status === 'running' && item === run.items[run.items.length - 1];
    /* Only a run sent with the ask ledger loses its closing line, and only a well-formed one at the very end. */
    return <ProseMessage key={item.id} className="s2-answer" text={run.askLedgerOn ? stripAskLine(item.text, streaming) : item.text} streaming={streaming} drawing={{ chat: run.sessionId, turn: run.id, repoRoot, at: run.startedAt, prompt: run.prompt }} />;
  }
  if (item.kind === 'thought') return <ThoughtItem key={item.id} runId={run.id} thought={item} now={now} />;
  if (item.kind === 'tool' && item.subagent)
    return <SubagentThread key={item.id} run={run} tool={item} merged={merged} now={now} repoRoot={repoRoot} onAnswer={onAnswer} onApply={onApply} />;
  if (item.kind === 'tool')
    return (
      <ToolItem
        key={item.id}
        run={run}
        tool={item}
        approvals={merged.byTool.get(item.id) ?? []}
        now={now}
        repoRoot={repoRoot}
        onAnswer={(rid, d) => onAnswer(run.id, rid, d)}
        onApply={onApply}
      />
    );
  if (item.kind === 'plan') return <PlanItem key={item.id} runId={run.id} plan={item} now={now} />;
  if (item.kind === 'note')
    return (
      <p key={item.id} className="agrun-note" data-testid="agent-run-note">
        {item.text}
      </p>
    );
  if (item.kind === 'question') {
    const q = run.questions?.find((x) => x.requestId === item.id);
    return q ? <QuestionItem key={item.id} run={run} question={q} at={item.at} settledAt={item.settledAt} now={now} onQuestion={onQuestion} /> : null;
  }
  const a = run.approvals.find((x) => x.requestId === item.id);
  /* Drawn inside its tool call's card. */
  if (a && merged.inCard.has(a.requestId)) return null;
  return a ? (
    <ApprovalItem
      key={item.id}
      run={run}
      approval={a}
      at={item.at}
      settledAt={item.settledAt}
      now={now}
      repoRoot={repoRoot}
      onAnswer={(rid, d) => onAnswer(run.id, rid, d)}
    />
  ) : null;
}

/**
 * S6: A RUN IS SEVERAL ROWS. The virtualized transcript draws a run as its
 * head, one row per item group (runGroups) and its foot, so a run of two
 * thousand calls is not one row the list has to draw whole. AgentRunView
 * draws the same three parts inside one article.
 */
export function runGroups(run: AgentRun, merged: Merged = mergedApprovals(run)): { key: string; group: RunItem[] }[] {
  return foldRuns(run, merged).map((g) => ({ key: g.length > 1 ? `fold-${g[0]!.id}` : g[0]!.id, group: g }));
}

export function RunHead({ run, now }: { run: AgentRun; now: number }) {
  return (
    <>
      <span className="s2-sr" data-testid="agent-run-status" title={formatElapsed((run.endedAt ?? now) - run.startedAt)}>
        {RUN_WORD[run.status]}
      </span>
      {run.nodeId ? (
        <span className="s2-pill s2-pill-static s2-run-node" data-testid="agent-run-node" title={`Context: ${run.nodeId}`}>
          <S2Icon name="box" small />
          {run.nodeLabel ?? run.nodeId}
        </span>
      ) : null}
      <div className="s2-user s2-run-prompt">{run.prompt}</div>
      {run.refs?.map((ref, i) => (
        <span key={i} className="ask-ref-chip" data-testid="chat-user-ref" title={ref.block}>
          <S2Icon name="box" small />
          <span className="ask-ref-chip-label">{ref.label}</span>
        </span>
      ))}
      <EditFromHere run={run} />
      {rewoundNote(run) ? (
        <p className="s2-run-note" data-testid="agent-run-rewound">
          {rewoundNote(run)}
        </p>
      ) : null}
      {run.resumed === false && run.resumeNote && !run.rewound ? (
        <p className="s2-run-note" data-testid="agent-run-resume-note">
          New conversation: {run.resumeNote}
        </p>
      ) : null}
    </>
  );
}

export function RunGroup({
  run,
  group,
  merged,
  now,
  repoRoot,
  onAnswer,
  onApply = applyToPageRuns,
  onQuestion = answerPageQuestion,
}: {
  run: AgentRun;
  group: RunItem[];
  merged: Merged;
  now: number;
  repoRoot: string | null;
  onAnswer: OnAnswer;
  onApply?: ApplyEvent;
  onQuestion?: OnQuestion;
}) {
  if (group.length > 1)
    return (
      <ToolFold keepKey={`fold:${run.id}:${group[0]!.id}`} items={group}>
        {group.map((i) => renderRunItem(run, i, merged, now, repoRoot, onAnswer, onApply, onQuestion))}
      </ToolFold>
    );
  return <>{renderRunItem(run, group[0]!, merged, now, repoRoot, onAnswer, onApply, onQuestion)}</>;
}

/**
 * THE ASK LEDGER'S ONE LINE (t3gap/asks). Drawn only when the agent's own
 * closing line marked a request not done: a reply that closed them all, or
 * had no closing line, adds nothing. Ask again sends one follow-up naming them.
 */
export function AskLedgerChip({ run, onAskAgain }: { run: AgentRun; onAskAgain?: (run: AgentRun, text: string) => void }) {
  const ledger = run.askLedger;
  if (run.status !== 'done' || !ledger) return null;
  const open = ledger.closures.filter((c) => !c.done);
  if (open.length === 0) return null;
  return (
    <div className="s2-asks-open" role="status" data-testid="asks-open">
      <span className="s2-asks-open-label">The agent reports not done:</span>
      <ul>
        {open.map((c) => (
          <li key={c.n}>
            {c.text || `request ${c.n}`}
            {c.reason ? <span className="s2-asks-why"> ({c.reason})</span> : null}
          </li>
        ))}
      </ul>
      {run.askedAgain ? (
        <span className="s2-asks-asked" data-testid="asks-asked">
          Asked again
        </span>
      ) : onAskAgain ? (
        <button type="button" className="s2-btn s2-btn-sm" data-testid="asks-again" onClick={() => onAskAgain(run, followUpPrompt(open))}>
          Ask again
        </button>
      ) : null}
    </div>
  );
}

export function RunFoot({ run, onRetry, onBuild, onAskAgain, onStop = (r) => agentRuns.stop(r.id) }: { run: AgentRun; onRetry?: RetryFn; onBuild?: (run: AgentRun) => void; onAskAgain?: (run: AgentRun, text: string) => void; onStop?: (run: AgentRun) => void }) {
  const now = useTicking(run.status === 'running');
  const quiet = watchdogLevel(run, now) !== null;
  const [planAnswered, setPlanAnswered] = useKeptOpen(`plan-answered:${run.id}`, false);
  const showPlan = !!run.cliPlan && run.intent === 'plan' && run.status === 'done' && !planAnswered && !!onBuild;
  /* The turn has not started yet: no item and no live phase. The start line says so, and the watchdog's note sits under it. */
  const starting = isStarting(run);
  const startLine = run.status === 'running' && run.items.length === 0 && !run.live && !run.queued;
  return (
    <>
      {showPlan ? (
        <CliPlanCard
          content={run.cliPlan!.content}
          onBuild={() => {
            setPlanAnswered(() => true);
            onBuild!(run);
          }}
          onKeepPlanning={() => setPlanAnswered(() => true)}
        />
      ) : null}
      {/* Round 7 (A2): while the process starts and while it connects, the
          run says so, by name; nothing in the chat is ever silent. */}
      {/* Round 9: what the turn is doing and for how long, from the server's status (RunLiveStatus.tsx). */}
      {/* A turn quiet for 45 s says so, with Keep waiting / Stop; hung at 3 min with Retry (RunWatchdog.tsx). */}
      {starting ? null : <RunWatchdog run={run} now={now} onStop={onStop} onRetry={onRetry} />}
      <RunLiveStatus run={run} quietHidden={quiet} />
      {startLine ? (
        <ChatStatus
          testId="agent-run-starting"
          phase={run.resumed === undefined ? 'starting' : 'connected'}
          status={{ kind: 'waiting', label: run.resumed === undefined ? `Starting ${vendorOf(run)}` : `Waiting for ${vendorOf(run)}` }}
        />
      ) : null}
      {starting ? <RunWatchdog run={run} now={now} onStop={onStop} onRetry={onRetry} /> : null}
      {run.error && run.status !== 'failed' ? (
        <p className="s2-run-error" role="alert" data-testid="agent-run-error">
          {run.error}
        </p>
      ) : null}
      <RecoveryCard run={run} onRetry={onRetry} />
      <AskLedgerChip run={run} onAskAgain={onAskAgain} />
      <ShowWhatItRead run={run} />
    </>
  );
}

export function AgentRunView({
  run,
  now,
  repoRoot,
  onAnswer,
  onRetry,
  onBuild,
  onAskAgain,
  onApply,
  onQuestion,
  graph,
}: {
  run: AgentRun;
  /** The scanned services, for the coverage line under a finished run. */
  graph?: GraphFacts | null;
  onAskAgain?: (run: AgentRun, text: string) => void;
  now: number;
  repoRoot: string | null;
  onAnswer: OnAnswer;
  onApply?: ApplyEvent;
  onQuestion?: OnQuestion;
  /** Ask the same question again in the same chat (the server resumes the agent's thread). */
  onRetry?: RetryFn;
  /** S2b: the CLI's plan was approved: switch the agent to Build and carry on. */
  onBuild?: (run: AgentRun) => void;
}) {
  const merged = mergedApprovals(run);
  const coverage = coverageFromRun(run, graph ?? null);
  return (
    <article id={`agrun-${run.id}`} className="s2-run" data-status={run.status} data-testid="agent-run" aria-label={`Agent run: ${run.prompt}`}>
      <RunHead run={run} now={now} />
      {runGroups(run, merged).map(({ key, group }) => (
        <RunGroup key={key} run={run} group={group} merged={merged} now={now} repoRoot={repoRoot} onAnswer={onAnswer} onApply={onApply} onQuestion={onQuestion} />
      ))}
      {coverage ? (
        <p className="coverage" data-testid="chat-coverage">
          {coverage}
        </p>
      ) : null}
      <RunFoot run={run} onRetry={onRetry} onBuild={onBuild} onAskAgain={onAskAgain} />
    </article>
  );
}

/** Every run of one chat thread, oldest first. */
export function AgentRunsList({
  runs,
  repoRoot,
  onAnswer,
  onRetry,
  onBuild,
  onAskAgain,
  onApply,
  graph,
}: {
  runs: readonly AgentRun[];
  graph?: GraphFacts | null;
  onAskAgain?: (run: AgentRun, text: string) => void;
  repoRoot: string | null;
  onAnswer: (runId: string, requestId: string, d: ApprovalAnswer) => void;
  onRetry?: RetryFn;
  onBuild?: (run: AgentRun) => void;
  onApply?: ApplyEvent;
}) {
  const now = useTicking(runs.some((r) => r.status === 'running'));
  if (runs.length === 0) return null;
  return (
    <>
      {runs.map((r) => (
        <AgentRunView key={r.id} run={r} now={now} repoRoot={repoRoot} onAnswer={onAnswer} onRetry={onRetry} onBuild={onBuild} onAskAgain={onAskAgain} onApply={onApply} graph={graph} />
      ))}
    </>
  );
}
