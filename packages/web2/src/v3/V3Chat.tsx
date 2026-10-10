import { PlanApprovalCard } from './PlanApprovalCard';
import { requestHostCommand } from '../app/hostCommands';
import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import { formatContextWindowTokens } from '../chat/ContextRing';
import { Icon } from '../chat/Icon';
import { ProseMessage } from '../chat/ProseMessage';
import { stripToolProse, toolCardTitle } from '../chat/stripToolProse';
import { TodoList } from '../chat/TodoList';
import { ChatTranscript } from '../chat/ChatTranscript';
import { takeStaticComposer, type StaticComposerState } from '../chat/staticHandoff';
import { agentRuns, type RunAttachment } from '../agents/agentRuns';
import { composerKeyIntent, lastPrompt } from '../composer/composerKeys';
import { promptQueue } from '../composer/promptQueue';
import { chatQueueKey } from '../composer/promptQueue';
import { useQueueDrain, useQueuedPrompts } from '../composer/useQueue';
import type { ChatWorktree } from '../worktree/worktreeModel';
import '../worktree/worktree.css';
import {
  COMPOSER_PLACEHOLDER,
  TOOLBELT,
  chipLabel,
  CONNECT_AGENT_LABEL,
  slashCommands,
  slashInvocation,
  autosizeHeight,
  slashMatches,
  slashQuery,
  slashSections,
  slashVisible,
  type SlashCommand,
  type SlashGroup,
  type ToolbeltId,
} from '../chat/composerModel';
import { ASK_NOW_PLAN_NOTE, COMPOSER_MODE_COPY, COMPOSER_MODE_KEYS, MODE_NOTE_KEY, modeOf, nextComposerMode, wireOf, type ComposerModeKey } from '../chat/composerModelModes';
import { splitThinking } from '../chat/splitThinking';
import { rememberPlace } from '../sessions/lastPlaceClient';
import { createSessionsClient, type SessionsClient } from '../sessions/sessionsClient';
import {
  AI_CONFIG_ROUTE,
  createModelPicker,
  rawProfilesFromConfig,
  type ModelPickerPort,
  type ModelPickerProfile,
  type ReasoningEffort as PickerReasoningEffort,
} from '../chat/modelPicker';
import { modelLabel } from '../chat/modelSelection';
import { useDefaultAgent } from '../shell2/defaultAgent';
import { writeAutoEditEnabled } from '../settings/autonomyPreference';
import { createSettingsClient } from '../settings/settingsClient';
import type {
  AccessMode,
  AssistantTurn,
  FileEditProposal,
  InFlightTurn,
  ProposalId,
  Turn,
  WorkRow,
} from '../state/types';
import { composerPropsFrom, useAppState, useStore } from '../state';
import { applyContextWindowFromConfig, bumpModelGen, currentModelGen } from '../state/connect';
import {
  preloadFullAccessDialog,
  useAccessSwitch,
} from '../chat/AccessControl';
import { ACCESS_STORAGE_KEY, accessOf, type FullAccessClient } from '../chat/accessMode';
import { groundedRepoRoot, refreshContextWindow } from '../state/connect';
import { goalPlanProgress, goalRunNowLine, goalRunRestLine } from './goalRunVerdict';
import { useGoalRun } from './useGoalRun';
import '../chat/chat.css';
import { StepList } from '../shell2/StepList';
import { S2Icon, type S2IconName } from '../shell2/icons';
import { useStatusBar } from '../shell2/statusBarPref';
import { ConfirmDialog } from '../shell2/ConfirmDialog';
import { ModelMenu, profileName, type ModelMenuProfile } from '../shell2/ModelMenu';
import { resolvedModel, type ResolvedModel } from '../agents/activeModel';
import { sharedGet } from '../api/sharedGet';
import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { registerBoardAskSender } from '../askInPlace/boardAskBus';

/* ONE DEFINITION OF THE FOUR RUNGS. This file declared its own copy of the
   union while `modelPicker` declared another, so a fifth level would have had
   to be added in two places and would have compiled with only one. */
type ReasoningEffort = PickerReasoningEffort;

const EFFORT_ROWS: { key: ReasoningEffort; label: string; description: string }[] = [
  { key: 'none', label: 'Off', description: 'Fastest, no reasoning' },
  { key: 'low', label: 'Low', description: 'Light reasoning' },
  { key: 'medium', label: 'Med', description: 'Balanced (default)' },
  { key: 'high', label: 'High', description: 'Deepest reasoning' },
];

function readEffort(): ReasoningEffort {
  try {
    const raw = localStorage.getItem('v3.reasoningEffort');
    if (raw === 'none' || raw === 'low' || raw === 'medium' || raw === 'high') return raw;
  } catch {
    /* ignore */
  }
  return 'medium';
}

/**
 * The saved models, each with what the picker's rows do not carry: its endpoint and whether it holds a
 * key. That is what tells a keyless loopback model (Local) from a hosted gateway (its own group). The
 * read is the same route the picker just asked, so it shares that request.
 */
async function listModels(picker: ModelPickerPort): Promise<{ outcome: 'ok'; profiles: ModelMenuProfile[]; body: unknown } | { outcome: 'error'; message: string }> {
  let body: unknown = null;
  const [answer, raw] = await Promise.all([
    picker.list(),
    sharedGet(AI_CONFIG_ROUTE)
      .then((r) => r.json() as Promise<unknown>)
      .then((b) => {
        body = b;
        return rawProfilesFromConfig(b);
      })
      .catch(() => []),
  ]);
  if (answer.outcome !== 'ok') return answer;
  const byId = new Map(raw.map((r) => [r.id, r]));
  return {
    outcome: 'ok',
    body,
    profiles: answer.profiles.map((p) => {
      const r = byId.get(p.id);
      return r ? { ...p, baseUrl: r.baseUrl, keyed: r.apiKey !== undefined } : p;
    }),
  };
}

async function persistEffort(effort: ReasoningEffort): Promise<void> {
  try {
    localStorage.setItem('v3.reasoningEffort', effort);
  } catch {
    /* ignore */
  }
  const client = createSettingsClient();
  const read = await client.read();
  if (read.outcome !== 'ok') return;
  const body = read.body;
  if (!body.configured) return;
  if ('mode' in body && body.mode === 'default') return;
  if (!('profiles' in body) || !Array.isArray(body.profiles) || body.profiles.length === 0) return;
  const activeId = body.defaultProfileId ?? body.profiles[0]?.id;
  if (!activeId) return;
  await client.write({
    profiles: body.profiles.map((pr) =>
      pr.id === activeId
        ? {
            ...pr,
            params: { ...(pr.params ?? {}), reasoningEffort: effort },
          }
        : pr,
    ),
    defaultProfileId: activeId,
  });
}

/**
 * The effort the ACTIVE profile is set to, out of the list the picker already
 * read — and remembered, so the rail is right on the next boot before the
 * server answers.
 *
 * ── IT USED TO FETCH, AND IT WAS THE SECOND FETCH OF ONE EFFECT ──────────
 *
 * This called `createSettingsClient().read()` — `GET /api/ai-config` — and the
 * next line of its one caller called `picker.list()`, which reads the same
 * route for the same body. Two identical requests, back to back, in the same
 * effect, at every boot.
 *
 * Pure now: the caller does one read and passes the rows in. `null` when the
 * active profile names no effort, which leaves whatever the reader last chose
 * in place rather than overwriting it with a guess.
 */
function effortFromProfiles(profiles: readonly ModelPickerProfile[]): ReasoningEffort | null {
  const active = profiles.find((p) => p.active) ?? profiles[0];
  const effort = active?.reasoningEffort ?? null;
  if (effort === null) return null;
  try {
    localStorage.setItem('v3.reasoningEffort', effort);
  } catch {
    /* ignore */
  }
  return effort;
}

/* One formatter for the page. `toLocaleTimeString(undefined, opts)` builds a new Intl formatter on
   every call: ~1.2 ms a turn, 25 ms on every chat switch (speed lane, tools/measure/switch-bench.mjs). */
let timeFormat: Intl.DateTimeFormat | null | undefined;
export function formatTime(at: number): string {
  /* An invalid time is that one label's problem, not the page's: it is checked first, so a bad
     stamp cannot reach `format` (which throws) and take every later label with it. */
  if (!Number.isFinite(at)) return '';
  if (timeFormat === undefined) {
    try {
      timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch {
      timeFormat = null;
    }
  }
  try {
    return timeFormat ? timeFormat.format(new Date(at)) : '';
  } catch {
    return '';
  }
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function TurnTools({
  tools,
  running,
}: {
  tools: { id: string; name: string; text?: string; evidence?: string | null }[];
  running?: boolean;
}) {
  /* Decision 49: uiarc.dev's step list (shell2/StepList.tsx). */
  return <StepList tools={tools} running={running} />;
}

export function ApprovalCard({
  proposal,
  onDecideAll,
}: {
  proposal: FileEditProposal;
  onDecideAll: (id: ProposalId, decision: 'accepted' | 'rejected') => void;
}) {
  const pending = proposal.files.filter((f) => f.decision === 'pending');
  const settled = proposal.files.length > 0 && pending.length === 0;
  const [open, setOpen] = useState(false);

  /* A DECIDED CARD FOLDS to one 32px row — title, count, the decision — and
     opens in place. A pending one stays open: it is waiting for the reader. */
  if (settled && !open) {
    return (
      <div className="v3-approve is-folded" data-testid="v3-approve" data-folded="true">
        <button
          type="button"
          className="v3-approve-fold"
          data-testid="v3-approve-fold"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          <Icon name="chevright" size={12} />
          <span className="v3-approve-title">{proposal.title ?? 'Proposed file edits'}</span>
          <span className="v3-approve-count">
            {proposal.files.length === 1 ? '1 file' : `${proposal.files.length} files`}
          </span>
          <span className="v3-approve-verdict" data-status={proposal.status}>
            {proposal.status}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="v3-approve" data-testid="v3-approve">
      <div className="v3-approve-hd">
        <div className="v3-approve-title">{proposal.title ?? 'Proposed file edits'}</div>
        <div className="v3-approve-count">
          {proposal.files.length === 1 ? '1 file' : `${proposal.files.length} files`}
        </div>
      </div>
      {proposal.files.slice(0, 4).map((file) => (
        <div key={file.path} className="v3-approve-file" title={file.path}>
          {file.path}
        </div>
      ))}
      {settled ? (
        <div className="v3-approve-settled">Decision recorded, {proposal.status}</div>
      ) : (
        <div className="v3-approve-acts">
          <button
            type="button"
            className="v3-approve-act accept"
            onClick={() => onDecideAll(proposal.id, 'accepted')}
          >
            Accept all
          </button>
          <button
            type="button"
            className="v3-approve-act reject"
            onClick={() => onDecideAll(proposal.id, 'rejected')}
          >
            Reject all
          </button>
        </div>
      )}
    </div>
  );
}

function chartWorkRow(work: readonly WorkRow[] | undefined): WorkRow | null {
  return work?.find((row) => row.from === 'chart:proposal') ?? null;
}

function toolsFromWork(work: readonly WorkRow[] | undefined): { id: string; name: string; text?: string; evidence?: string | null }[] {
  if (!work) return [];
  const out: { id: string; name: string; text?: string; evidence?: string | null }[] = [];
  for (const row of work) {
    const called = /^Called (\S+)$/.exec(row.verb)?.[1];
    if (!called) continue;
    out.push({
      id: row.id,
      name: called,
      text: row.identifier ?? undefined,
      evidence: row.identifier,
    });
  }
  return out;
}

/* Memoised: a turn that has not changed is not drawn again when the list around it re-renders
   (every store change, every stream chunk, every chat switch). */
const MessageBlock = memo(function MessageBlock({
  turn,
  proposals,
  onDecideAll,
}: {
  turn: Turn;
  proposals: Record<ProposalId, FileEditProposal>;
  onDecideAll: (id: ProposalId, decision: 'accepted' | 'rejected') => void;
}) {
  if (turn.role === 'user') {
    if (!turn.text.trim()) return null;
    return (
      <div className="s2-user" data-testid="v3-msg-user" title={`You, ${formatTime(turn.at)}`}>
        <ProseMessage text={turn.text} />
        {/* What the reader pointed at on a board (askInPlace/): the chip they saw in the popover, on the message that carried it. */}
        {turn.chips
          .filter((chip) => chip.kind === 'board-ref')
          .map((chip) => (
            <span key={chip.id} className="ask-ref-chip" data-testid="chat-user-ref" title={chip.detail ?? chip.label}>
              <Icon name="board" size={12} />
              <span className="ask-ref-chip-label">{chip.label}</span>
            </span>
          ))}
      </div>
    );
  }

  const assistant = turn as AssistantTurn;
  const linked = Object.values(proposals).filter((p) => p.turnId === assistant.id);
  const usage = assistant.usage;
  const { stripped, tools: proseTools } = stripToolProse(turn.text ?? '');
  const evidenceTools = assistant.evidence.tools;
  const workTools = toolsFromWork(assistant.work);
  const chartRow = chartWorkRow(assistant.work);
  const timelineTools =
    evidenceTools.length > 0
      ? evidenceTools
      : workTools.length > 0
        ? workTools
        : proseTools.map((t) => ({ id: t.id, name: t.name, text: undefined, evidence: null }));
  const showChartTool =
    chartRow !== null && !timelineTools.some((t) => t.name === 'propose_chart');

  return (
    <div className="s2-asst chat-scope" title={`Sequence, ${formatTime(turn.at)}`}>
      {(assistant.todos?.length ?? 0) > 0 ? <TodoList items={assistant.todos} /> : null}
      {assistant.reasoning?.trim() ? <ThoughtFold text={assistant.reasoning.trim()} ms={assistant.thoughtMs} /> : null}
      <TurnTools
        tools={
          showChartTool
            ? [
                ...timelineTools,
                {
                  id: chartRow!.id,
                  name: 'propose_chart',
                  text: chartRow!.verb,
                  evidence: null,
                },
              ]
            : timelineTools
        }
      />
      {/* Tool row already names the chart — no second "open the AI Canvas" line. */}
      {stripped.trim() ? (
        <div className="s2-answer" data-testid="v3-msg-prose">
          <ProseMessage text={stripped} />
        </div>
      ) : null}
      {usage ? (
        <div
          className="s2-bill s2-mono"
          title="Turn bill: summed input and output across tool rounds (not the context fill)"
          data-testid="v3-turn-bill"
        >
          <span>{formatContextWindowTokens(usage.inputTokens)} in</span>
          <span className="s2-vb" aria-hidden="true" />
          <span>{formatContextWindowTokens(usage.outputTokens)} out</span>
        </div>
      ) : null}
      {linked.map((p) => (
        <ApprovalCard key={p.id} proposal={p} onDecideAll={onDecideAll} />
      ))}
    </div>
  );
});

/**
 * A CLICK ON THE THINKING FOLDS IT (owner, 2026-09-22: "you should be able to
 * click anywhere on the live thinking text to actually minimize and expand it
 * … instead of scrolling up again"). A drag that selected some of it is a
 * reader copying a sentence, not asking to fold, so that click is left alone.
 */
function foldClickIsNotASelection(): boolean {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  return !sel || sel.isCollapsed || sel.toString().trim() === '';
}

/**
 * THE THINKING, KEPT ON THE TURN — closed, one press away.
 *
 * A finished turn that only thought used to read as an empty bubble (Bastion
 * turns 5 and 11, 2026-09-22). With its thinking kept, the reader can see what
 * it was doing even when it wrote nothing — and on a turn that did answer, why
 * it called what it called. Closed by default: the answer is the thing read
 * first.
 */
function ThoughtFold({ text, ms }: { text: string; ms?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="s2-think" data-open={open || undefined}>
      <button
        type="button"
        className="s2-think-h"
        data-testid="v3-turn-thought"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <S2Icon name="spark" small />
        <span className="s2-grow" data-testid="v3-turn-thought-label">{ms === undefined ? 'Thought' : `Thought for ${(ms / 1000).toFixed(1)} s`}</span>
        <S2Icon name={open ? 'chev' : 'chevr'} small />
      </button>
      <div className="s2-think-wrap" data-open={open ? 'yes' : 'no'}>
        <div
          className="s2-think-b"
          aria-hidden={!open}
          data-testid="v3-turn-thought-body"
          onClick={() => {
            if (!foldClickIsNotASelection()) return;
            setOpen((v) => !v);
          }}
        >
          <div className="v3-thinking-thought-chunk">{text}</div>
        </div>
      </div>
    </div>
  );
}

function readGoalbarDismissed(sessionId: string | null): boolean {
  if (!sessionId) return false;
  try {
    const raw = localStorage.getItem('v3.goalbar.dismissed');
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return Boolean(map[sessionId]);
  } catch {
    return false;
  }
}

function writeGoalbarDismissed(sessionId: string, dismissed: boolean): void {
  try {
    const raw = localStorage.getItem('v3.goalbar.dismissed');
    const map: Record<string, boolean> = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    if (dismissed) map[sessionId] = true;
    else delete map[sessionId];
    localStorage.setItem('v3.goalbar.dismissed', JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/*
 * ── IS THE PLAN LIST OPEN, FOR THIS SESSION ────────────────────────────────
 *
 * CLOSED IS THE DEFAULT (walk-4-white-glass-plan.md §2). The owner read the bar
 * in a narrow window with a plan under it and a `Last run:` row under that, and
 * what he was looking at was four stacked lines of chrome above the box he
 * wanted to type in. The plan is a thing you open when you are working the
 * plan, not a thing that sits between you and the composer all day.
 *
 * ONE KEY PER SESSION, and that is the point rather than tidiness: two sessions
 * are two different jobs, and the one you left open is not a preference about
 * the other one. Same shape as the dismissed map above, a key per session
 * rather than one map, because the plan named the key: `sequence.goal.open.<id>`.
 *
 * A DENIED OR CORRUPT STORAGE READS AS CLOSED. Failing toward the default is
 * the only direction that cannot surprise somebody.
 */
function goalOpenKey(sessionId: string): string {
  return `sequence.goal.open.${sessionId}`;
}

function readGoalOpen(sessionId: string | null): boolean {
  if (!sessionId) return false;
  try {
    return localStorage.getItem(goalOpenKey(sessionId)) === '1';
  } catch {
    return false;
  }
}

function writeGoalOpen(sessionId: string, open: boolean): void {
  try {
    if (open) localStorage.setItem(goalOpenKey(sessionId), '1');
    else localStorage.removeItem(goalOpenKey(sessionId));
  } catch {
    /* ignore */
  }
}

function ThinkingBlock({ inFlight, now }: { inFlight: InFlightTurn; now: number }) {
  const [thoughtOpen, setThoughtOpen] = useState(true);
  const elapsed = formatElapsed(now - inFlight.startedAt);
  const workRunning = inFlight.work.filter((w) => w.status === 'running');
  const work = workRunning.length;
  const segments = splitThinking(inFlight.text ?? '');
  const thoughtSegments = segments.filter((s) => s.kind === 'thinking');
  const answerText = segments
    .filter((s) => s.kind === 'answer')
    .map((s) => s.text)
    .join('');
  const { stripped: answerStripped, tools: streamingTools } = stripToolProse(answerText);
  /* Two sources of thinking: the provider's own channel (`reasoning` frames)
     and <think> tags inside the text. The channel comes first — it is what the
     model thought before it wrote anything. It reads as live until the answer
     starts arriving. */
  const streamedThought = inFlight.reasoning?.trim() ?? '';
  const thoughtChunks = [
    ...(streamedThought ? [streamedThought] : []),
    ...thoughtSegments.map((s) => s.text),
  ];
  const thoughtOpenLive =
    thoughtSegments.some((s) => s.open) ||
    (streamedThought.length > 0 && !answerStripped.trim() && inFlight.phase !== 'finalizing');
  const liveTools = inFlight.evidence.tools;
  const workTools = toolsFromWork(inFlight.work);
  const timeline =
    liveTools.length > 0
      ? liveTools
      : workTools.length > 0
        ? workTools
        : streamingTools.map((t) => ({ id: t.id, name: t.name, text: undefined as string | undefined }));
  const latestTool = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const runningCalled = workRunning
    .map((r) => /^Called (\S+)$/.exec(r.verb)?.[1])
    .find((n): n is string => Boolean(n));
  const toolVerb = runningCalled
    ? toolCardTitle(runningCalled)
    : latestTool
      ? toolCardTitle(latestTool.name)
      : null;
  /* Owner walk: one readable line — Working · time · N running. Round /
     token bill stay in the store; they are not default HUD chrome.
     S2b ruling (2026-10-06): only one place names the active tool. Its row
     below says "Calling search"; the bar does not say it again. */
  const toolRowShown = timeline.length > 0 && toolVerb !== null;
  const phaseLabel =
    inFlight.phase === 'queued'
      ? 'Queued'
      : inFlight.phase === 'finalizing'
        ? 'Finalizing'
        : toolVerb && !toolRowShown
          ? toolVerb
          : 'Working';
  /* "Thought for N s": the thinking's clock stops at the first answer token
     (`firstTokenAt`, set by the first `delta`; reasoning frames do not set it). */
  const thoughtMs = Math.max(0, (inFlight.firstTokenAt ?? now) - inFlight.startedAt);
  const live =
    inFlight.phase !== 'queued' && inFlight.phase !== 'finalizing';

  return (
    <div className="s2-live chat-scope" data-testid="v3-thinking" aria-live="polite">
      {/* Decision 49: one quiet row, B's step shape: spinner, phase, then the
          spend and the clock in reserved columns (no dot separators). */}
      <div className={`s2-live-bar${live ? ' live' : ''}`} data-testid="v3-thinking-bar">
        <AsciiSpinner />
        <span className="s2-live-phase" data-testid="v3-thinking-phase">
          {phaseLabel}
        </span>
        {work > 0 ? (
          <span className="s2-meta" data-testid="v3-thinking-running">
            {work} running
          </span>
        ) : null}
        {inFlight.usage ? (
          <span
            className="s2-live-tokens s2-mono"
            data-testid="v3-thinking-tokens"
            title="Tokens accounted so far this turn: input into the last provider call, plus output produced"
          >
            {formatContextWindowTokens(inFlight.usage.inputTokens)} in
            <span className="s2-vb" aria-hidden="true" />
            {formatContextWindowTokens(inFlight.usage.outputTokens)} out
          </span>
        ) : null}
        <span className="s2-live-elapsed s2-mono" data-testid="v3-thinking-elapsed">
          {elapsed}
        </span>
      </div>
      {(inFlight.todos?.length ?? 0) > 0 ? (
        <TodoList items={inFlight.todos} streaming />
      ) : null}
      {/*
        ── THE SPARKLE FOLD (owner, 2026-09-19) ──────────────────────────

        "Thinking process, for the most part I'm okay with — I see where
        you're guiding it from the fold and it looks good on the fold, it's
        just the way it's output right now is a little bit unclear at first
        glance. Sparkle fold's a little bit more intuitive and I kind of like
        it a little bit more."

        THE KIT'S SPARKLE FOLD DIFFERS IN THREE WAYS AND ONLY ONE OF THEM IS
        THE SPARKLE.

        It ANIMATES OPEN, `grid-template-rows: 0fr → 1fr`. Ours appeared and
        vanished, so a reader who pressed it could not tell whether the text
        had been revealed or had just arrived — which is exactly "unclear at
        first glance" on a surface where text IS arriving all the time.

        It carries a TIMER, so a fold that is still filling says how long it
        has been filling.

        And its mark turns rather than spins. A spinner means "waiting on
        something"; this is not waiting, it is working, and a slow quarter
        turn is the difference.

        THE BODY IS ALWAYS MOUNTED NOW, which is what makes the transition
        possible at all: you cannot animate the height of an element that
        does not exist yet. `hidden` on the wrapper keeps it out of the
        accessibility tree while it is closed.
      */}
      {thoughtChunks.length > 0 ? (
        <div className="s2-think" data-open={thoughtOpen || undefined}>
          <button
            type="button"
            className={`s2-think-h${thoughtOpenLive ? ' live' : ''}`}
            data-testid="v3-thinking-fold"
            aria-expanded={thoughtOpen}
            onClick={() => setThoughtOpen((v) => !v)}
          >
            <S2Icon name="spark" small />
            <span className="s2-grow" data-testid="v3-thinking-fold-label">
              {thoughtOpenLive ? 'Thinking' : `Thought for ${(thoughtMs / 1000).toFixed(1)} s`}
            </span>
            {thoughtOpenLive ? <span className="s2-mono s2-meta">{elapsed}</span> : null}
            <S2Icon name={thoughtOpen ? 'chev' : 'chevr'} small />
          </button>
          <div className="s2-think-wrap" data-open={thoughtOpen ? 'yes' : 'no'}>
            <div
              className="s2-think-b"
              aria-hidden={!thoughtOpen}
              data-testid="v3-thinking-body"
              onClick={() => {
                if (!foldClickIsNotASelection()) return;
                setThoughtOpen((v) => !v);
              }}
            >
              {thoughtChunks.map((chunk, index) => (
                <div key={index} className="v3-thinking-thought-chunk">{chunk}</div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <TurnTools tools={timeline} running={inFlight.phase !== 'finalizing'} />
      {answerStripped.trim() ? (
        <div className="s2-answer">
          <ProseMessage text={answerStripped} streaming={inFlight.phase !== 'finalizing'} />
        </div>
      ) : null}
    </div>
  );
}

type ModeKey = 'plan' | 'build';

/* ── THE THREE MODES (round 11; the names and mapping are chat/composerModelModes.ts) ──
   Plan, Smart and Full auto live in the model popup and nowhere else in the
   composer. They are the existing intent and access, read together: Plan is
   the plan intent; Smart is Build at auto-edit; Full auto is Build at Full
   access. Teach is gone as a mode: Plan carries its teaching and discussion. */
const MODE_ICON: Record<ComposerModeKey, S2IconName> = { plan: 'plan', smart: 'shield', full: 'bolt' };
const B_MODES: { key: ComposerModeKey; label: string; desc: string; icon: S2IconName }[] = COMPOSER_MODE_KEYS.map((key) => ({
  key,
  label: COMPOSER_MODE_COPY[key].label,
  desc: COMPOSER_MODE_COPY[key].desc,
  icon: MODE_ICON[key],
}));
/* What each command does, in words a reader acts on (Jaden: the hints read
   oddly, "/models Reasoning connected"). */
const SLASH_DESC: Record<string, string> = {
  models: 'Choose model and reasoning',
  workflow: 'Start an agent run from a starter workflow',
  breakdown: 'Show what is inside the selected part',
  whatbreaks: 'Show what breaks if the selected part changes',
  goal: 'Set a goal and let the agent work it down',
  draw: 'Write the request to draw the board from the code',
};
/* The modes as commands: the same three as the popup, the same effect. */
const B_SLASH_MODES: SlashCommand[] = [
  { name: 'plan', label: 'Plan', hint: COMPOSER_MODE_COPY.plan.desc, icon: 'map' as never, source: { kind: 'mode', mode: 'plan' } },
  { name: 'smart', label: 'Smart', hint: COMPOSER_MODE_COPY.smart.desc, icon: 'pen', source: { kind: 'mode', mode: 'build' } },
  { name: 'full', label: 'Full auto', hint: COMPOSER_MODE_COPY.full.desc, icon: 'hammer', source: { kind: 'mode', mode: 'build' } },
];
const B_SLASH_TO_MODE: Record<string, ComposerModeKey> = { plan: 'plan', smart: 'smart', full: 'full' };
const SLASH_GLYPH: Partial<Record<string, S2IconName>> = {
  file: 'file', board: 'board', pen: 'pen', terminal: 'term', run: 'term', module: 'grid', alert: 'flame',
  key: 'cpu', target: 'spark', skill: 'box', book: 'layers', hammer: 'bolt', map: 'map', branch: 'branch', flow: 'nodes',
};


export interface V3ChatProps {
  /**
   * The sessions client this seat talks to — the goalbar's reads AND the "New
   * goal" write. Injected only by tests.
   *
   * `sessionsClient` below is already created per-instance with `useRef`, which
   * is a seam of the same kind; this one is explicit because the goalbar's
   * behaviour is defined by what the server answers — a run that is running, a
   * plan with a parked step, a start that is refused — and none of those can be
   * produced by dispatching into the store. Omitted in the app, where the real
   * client is built exactly as before.
   */
  goalRunClient?: SessionsClient;
  /** The Full access confirm route. Injected only by tests. */
  fullAccessClient?: FullAccessClient;
}

/* Decision 49: the takeover and the changed-files line load with the first agent run. */
const Takeover = lazy(() => import('../shell2/Takeover'));
const ChangedFiles = lazy(() => import('../shell2/ChangedFiles'));
/* S5: the queue list (and its stylesheet) loads the first time something is queued. */
const PromptQueueList = lazy(() => import('../composer/PromptQueueList').then((m) => ({ default: m.PromptQueueList })));
/* S7: the merge-back panel loads when the worktree chip is opened. */
const MergePanel = lazy(() => import('../worktree/MergePanel'));
/* S7: the chip loads with the first chat that has a worktree. */
const FanoutMenu = lazy(() => import('../fanout/FanoutMenu').then((m) => ({ default: m.FanoutMenu })));
const WorktreeChip = lazy(() => import('../worktree/WorktreeChip').then((m) => ({ default: m.WorktreeChip })));

export function V3Chat({ goalRunClient, fullAccessClient }: V3ChatProps = {}) {
  const store = useStore();
  const state = useAppState();
  const composer = composerPropsFrom(state, store);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /*
   * THE STATIC COMPOSER HANDS OVER (chat/staticHandoff.ts). index.html's
   * prerendered shell took typing while React booted; on mount its text,
   * caret, focus and a pending Send move here and the static shell goes, all
   * before the first paint. The second effect waits for the draft to reach
   * the field, then puts the caret back and carries out the Send.
   */
  const handoff = useRef<StaticComposerState | null>(null);
  useLayoutEffect(() => {
    const taken = takeStaticComposer();
    if (!taken) return;
    handoff.current = taken;
    if (taken.text !== '') store.dispatch({ type: 'composer/draft', text: taken.text });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useLayoutEffect(() => {
    const taken = handoff.current;
    const el = textareaRef.current;
    if (!taken || !el || el.value !== taken.text) return;
    handoff.current = null;
    if (taken.focused) el.focus();
    el.setSelectionRange(taken.selectionStart, taken.selectionEnd);
    if (taken.pendingSend && taken.text.trim() !== '') {
      /* After this commit, from the store as it then is. */
      queueMicrotask(() => composerPropsFrom(store.getState(), store).onSend());
    }
  }, [state.composer.draft, store]);

  /*
   * THE FIELD GROWS WITH THE DRAFT — up to eight lines, then scrolls.
   *
   * V3 had `rows={2}`, `max-height: 120px`, `resize: none` and never called
   * `autosizeHeight`, which `chat/composerModel.ts` has carried (and tested)
   * since the old composer. A pasted prompt was confined to two visible lines
   * with no grab handle, and the owner read that as "it won't let me type"
   * (2026-09-17). A line height we cannot measure is not a number we act on:
   * the field then stays at its declared height, exactly as the old composer.
   */
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const view = el.ownerDocument.defaultView;
    if (!view) return;
    const lineHeight = parseFloat(view.getComputedStyle(el).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
    el.style.height = 'auto';
    el.style.height = `${autosizeHeight(el.scrollHeight, lineHeight, 8)}px`;
  }, [state.composer.draft]);
  const toolsWrapRef = useRef<HTMLDivElement>(null);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const picker = useRef(createModelPicker()).current;
  const [now, setNow] = useState(() => Date.now());
  const [toolsOpen, setToolsOpen] = useState(false);
  /* The turn whose Plan-ready card the reader answered (Build it / Keep
     planning), so the card does not come back for the same plan. */
  const [planCardAnswered, setPlanCardAnswered] = useState<string | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  /* Decision 49: B's mode pill and its menu. */
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [profiles, setProfiles] = useState<ModelMenuProfile[]>([]);
  const [modelErr, setModelErr] = useState<string | null>(null);
  const [effort, setEffort] = useState<ReasoningEffort>(() => readEffort());
  const [goalbarDismissed, setGoalbarDismissed] = useState(() =>
    readGoalbarDismissed(state.session.activeId),
  );
  const [goalOpen, setGoalOpen] = useState(() => readGoalOpen(state.session.activeId));
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [focusDraft, setFocusDraft] = useState('');
  const [focusEditing, setFocusEditing] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashExpanded, setSlashExpanded] = useState<ReadonlySet<SlashGroup>>(new Set());
  const attachInputRef = useRef<HTMLInputElement>(null);
  /** This workspace's skills (`GET /api/skills`), for the palette and the menu. */
  const [workspaceSkills, setWorkspaceSkills] = useState<{ slug: string; name: string; description: string }[]>([]);
  /*
   * ONE CLIENT FOR THE WHOLE SEAT, and the injected one wins.
   *
   * Lazy rather than `useRef(goalRunClient ?? createSessionsClient())`, which
   * would build a real client on every render and throw it away. More
   * importantly it is ONE client: the goalbar reads the goal through it and
   * "New goal" writes the goal through it, and two clients here would mean a
   * test could stub the read and silently miss the write — which is exactly
   * what happened on the first attempt at this.
   */
  const clientRef = useRef<SessionsClient | null>(null);
  if (clientRef.current === null) clientRef.current = goalRunClient ?? createSessionsClient();
  const sessionsClient = clientRef.current;

  const mode = state.composer.permission.mode;
  const onAccess = useCallback(
    (access: AccessMode) => {
      store.dispatch({ type: 'composer/access', access });
      try {
        localStorage.setItem(ACCESS_STORAGE_KEY, access);
      } catch {
        /* ignore */
      }
    },
    [store],
  );
  const accessSwitch = useAccessSwitch({
    access: accessOf(state.composer.permission),
    onAccess,
    projectKey: groundedRepoRoot(state) ?? workspaceRoot,
    client: fullAccessClient,
  });
  const activeMode: ModeKey = mode === 'build' ? 'build' : 'plan';
  const repoRoot = groundedRepoRoot(state);
  /* The branch the footer pins to the right — see the note at the row. Null
     until `/api/git/status` answers, and null for a root with no git, which is
     a different fact from "main" and must not be drawn as one. */
  const branch = state.session.git.branch?.trim() ? state.session.git.branch : null;
  /*
   * ── THE GOALBAR IS A DASHBOARD NOW, NOT A LABEL ──────────────────────────
   *
   * Owner, 2026-09-17: "Goal right now just sets you a personal goal. If you
   * look at ML Harness, the goals there are more straightforward: once you
   * create a goal, you can tell the agent to work on the goal, and that way we
   * can enforce long-running tasks even with weaker models."
   *
   * What was here read `activeSession.title` — the label on a rail row, which
   * the server rewrites from the transcript whenever the person has not edited
   * it. It reached nothing: not the prompt, not a plan, not a loop. The goal is
   * now a field of its own on the session, the plan beside it survives the
   * turn, and `useGoalRun` owns both plus the run that works them down.
   *
   * ── AND THE TITLE IS NO LONGER A FALLBACK ────────────────────────────────
   *
   * It was, "so a session that predates the goal field looks exactly as it did
   * — there is no migration and no empty bar". That reasoning optimised for the
   * bar existing. Owner, 2026-09-17, walking the installed app, reading a bar
   * that said `session 7316 · working towards this focus`: a session TITLE
   * shown as a goal is meaningless. The server re-derives that title from the
   * transcript on every chat write, so the bar was quoting a label back at him
   * and calling it his objective, and the progress line under it claimed work
   * was being done toward it.
   *
   * An empty bar is not the failure — a bar that is WRONG is. A goal is a thing
   * the reader states (`/goal …`, or the New goal form); until they have, there
   * is no goal and therefore no goalbar.
   */
  const goalRun = useGoalRun({
    sessionId: state.session.activeId,
    repoPath: repoRoot ?? undefined,
    /* The SAME value the mode chip shows. A second derivation here could
       disagree with the control the person is looking at, and the disabled
       tooltip says "switch to Build" — advice that has to be about the chip
       they can see. */
    mode: activeMode,
    booted: state.net.reachable !== null,
    ...(goalRunClient ? { client: goalRunClient } : {}),
  });
  const goalTitle = goalRun.goal?.trim() || null;
  /* What the bar SHOWS: the goal's name, not its whole text (owner,
     2026-09-22 — "The goal name should be summarized by the task"). The full
     goal stays in the tooltip and in the editor, because it is the instruction. */
  const goalLabel = goalRun.goalName?.trim() || goalTitle;
  /*
   * A TURN THAT LANDED MAY HAVE CHANGED THE GOAL OR ITS PLAN — `write_plan`
   * persists server-side, and a Plan turn that writes one also makes the goal
   * (repoServer `askGoalContextFor`). The bar used to re-read only on a thread
   * switch, so a plan written in front of the reader stayed invisible until
   * they left and came back. Re-read when the committed turn count moves.
   */
  const committedTurns = state.session.turns.length;
  const goalRefreshRef = useRef(goalRun.refresh);
  goalRefreshRef.current = goalRun.refresh;
  useEffect(() => {
    if (committedTurns > 0) void goalRefreshRef.current();
  }, [committedTurns]);
  /*
   * THE RING ASKS AGAIN WHEN IT DOES NOT KNOW (owner, 2026-09-22: "the context
   * window is nowhere to be seen … huge problem").
   *
   * The window was probed once at boot and again only on a model switch. That
   * day the app booted while Ollama was down, the probe failed, and the ring
   * stayed empty for the whole session — although the same engine reported
   * 131,072 the moment the model was up. A turn that landed is proof the model
   * is up, so a landed turn with no window re-asks. Once known, it stops.
   */
  const windowUnknown = state.composer.contextWindow === null;
  const probeModel = state.composer.model?.model;
  useEffect(() => {
    if (committedTurns > 0 && windowUnknown) void refreshContextWindow(store, probeModel ?? undefined);
  }, [committedTurns, windowUnknown, probeModel, store]);
  /*
   * ── NOTHING RUNS WITHOUT A STOP ──────────────────────────────────────────
   *
   * Owner, 2026-09-17: "have a way so we can stop chats if they're running."
   * There was none. `composerPropsFrom` has exposed `onStop` — which aborts the
   * live stream — since the seat was wired, and this foot never drew a control
   * for it: the only button was Send, which turned into "Queue" mid-stream, so
   * the one gesture the reader had during a turn was to add MORE work to it.
   *
   * Sheet 12.4's rule is that "the control that started the work is the control
   * that ends it", and that is what the primary button does now. Queue does not
   * disappear — a follow-up typed mid-stream is still held — it stops being the
   * PRIMARY, and appears beside Stop only when there are words to queue.
   */
  const running = state.session.inFlight !== null;
  const hasDraft = state.composer.draft.trim().length > 0;
  /*
   * THE CHIP SAYS WHAT THE READER CALLS THE MODEL, NOT ITS WIRE ID.
   *
   * Saved profiles carry a nickname (`AiProfileView.name`, ported from
   * ml-harness), and the menu rows already draw it — but the trigger read
   * `modelLabel()`, which only ever knew the wire id, so the seat showed
   * `minicpm5-he…` while the row underneath it said the name the reader gave
   * it (owner, 2026-09-17: "make sure in the chat box it shows the model
   * nickname, not the full model name"). `chat/Composer.tsx` had already
   * solved this the same way; V3 never ported it. The wire id stays in the
   * tooltip so the fact the nickname stands for is one hover away.
   */
  const activeWireId = state.composer.model.model;
  const activeProfile =
    profiles.find((p) => p.active && p.model === activeWireId) ??
    profiles.find((p) => p.model === activeWireId) ??
    null;
  const modelChip = (activeProfile ? profileName(activeProfile) : '') || modelLabel(state.composer.model) || 'Model';
  const modelChipTitle = activeProfile ? `${profileName(activeProfile)}, ${activeProfile.model}` : state.composer.model.model && state.composer.model.model !== modelChip ? `${modelChip}, ${state.composer.model.model}` : modelChip;
  /* Five characters and a mark, so the chip is the same width whatever answers
     — see `chipLabel`. The whole name is on the control as its title and its
     accessible name, which is the only place a cut is allowed to put what it
     cut. */
  const modelChipShort = chipLabel(modelChip, Number.MAX_SAFE_INTEGER);
  /* The chip, the status bar and the send path read ONE model. When the selection is still empty but the
     list says which saved model answers (the server answers sends with its default profile), the selection
     is set to that model, so the chip never shows a model the bar and the send path call unconfigured. */
  const unselectedActive = activeWireId === '' ? profiles.find((p) => p.active) : undefined;
  useEffect(() => {
    if (unselectedActive) {
      store.dispatch({
        type: 'composer/model',
        model: { model: unselectedActive.model, origin: unselectedActive.keyed === false ? 'local' : 'api-key' },
      });
    }
  }, [unselectedActive, store]);
  /* THE ONE RESOLVED MODEL: the chip's icon and text, and the status bar's provider, all read this record.
     A saved model brings its provider, endpoint and key; a selection with no saved row (the hosted default,
     a bare key) is identified by its id and origin alone. */
  const selected = state.composer.model;
  const chipIdentity: ResolvedModel | null = activeProfile
    ? { model: activeProfile.model, provider: activeProfile.provider, baseUrl: activeProfile.baseUrl, keyed: activeProfile.keyed, label: modelChip }
    : selected.model !== '' && selected.origin !== 'unconfigured'
      ? { model: selected.model, keyed: selected.origin === 'local' ? false : undefined, managed: selected.origin === 'default', label: modelChip }
      : null;
  const resolvedKey = chipIdentity ? `${chipIdentity.model}|${chipIdentity.provider ?? ''}|${chipIdentity.baseUrl ?? ''}|${String(chipIdentity.keyed)}|${String(chipIdentity.managed)}|${modelChip}` : '';
  useEffect(() => {
    resolvedModel.set(chipIdentity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedKey]);
  /* The composer follows a model the list does not hold yet (one just added in Settings): ask again, once per change. */
  useEffect(() => {
    if (activeWireId === '' || state.composer.model.origin === 'default' || profiles.some((p) => p.model === activeWireId)) return undefined;
    let cancelled = false;
    void listModels(picker).then((answer) => {
      if (!cancelled && answer.outcome === 'ok') setProfiles(answer.profiles);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWireId]);
  /* THE AGENT THIS CHAT TALKS TO OWNS THE CHIP (S2b): "Codex · Ask" (the
     capital is CSS) once an agent has run here, and the composer sends to it,
     until the person picks a model. Inline and small: this is the boot path
     and the perf ratchet counts its bytes. */
  const runsState = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const agentRun = runsState.agents?.[state.session.activeId ?? ''];
  const agentCaps = agentRun ? runsState.caps?.[agentRun] : undefined;
  useDefaultAgent(state.session.activeId, !agentRun && modelChipShort === CONNECT_AGENT_LABEL);
  /* S5: a turn runs in this chat when Sequence's does, or this chat's agent's does. */
  const agentRunning = runsState.runs.some((r) => r.status === 'running' && r.sessionId === state.session.activeId);
  const busy = running || agentRunning;
  /* An agent waiting on the person takes the composer's place (Decision 49). */
  const mineRuns = runsState.runs.filter((r) => r.sessionId === state.session.activeId);
  const hasPendingApproval = mineRuns.some((r) => (r.status === 'running' && r.approvals.some((a) => a.decision === null)) || (r.questions ?? []).some((q) => !q.settled));
  const agentTurnsKey = mineRuns.filter((r) => r.status !== 'running').length;
  /* Per project and chat: a queue made with no chat open in one project is never another project's. */
  const queueKey = chatQueueKey(groundedRepoRoot(state), state.session.activeId);
  const statusBarOn = useStatusBar();
  const effortLabel = EFFORT_ROWS.find((r) => r.key === effort)?.label ?? 'Med';
  const showGoalbar = Boolean(goalTitle && !goalbarDismissed);

  /*
   * S7: THE WORKTREE THIS CHAT WORKS IN. The server puts it on the chat's
   * session index entry, so it is read from there (no request at boot); after
   * a merge or a discard the panel re-reads it (GET …/worktree) until the next
   * index read catches up.
   */
  const indexWorktree = repoRoot ? ((state.session.sessions.find((s) => s.id === state.session.activeId) as { worktree?: ChatWorktree | null } | undefined)?.worktree ?? null) : null;
  const [reread, setReread] = useState<{ id: string; worktree: ChatWorktree | null } | null>(null);
  const worktree = reread && reread.id === state.session.activeId ? reread.worktree : indexWorktree;
  /* Best of N: the set of chats this one was sent with, read from the same index entry. */
  const fanoutId = (state.session.sessions.find((s) => s.id === state.session.activeId) as { fanout?: { id?: string } } | undefined)?.fanout?.id;
  const [fanoutOpen, setFanoutOpen] = useState(false);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  useEffect(() => setWorktreeOpen(false), [state.session.activeId]);
  const rereadWorktree = (): void => {
    const id = state.session.activeId;
    if (!id) return;
    void import('../worktree/worktreeModel')
      .then((m) => m.worktreeApi.get(id))
      .then((r) => r.ok && setReread({ id, worktree: r.body.worktree ?? null }))
      .catch(() => {});
  };

  useEffect(() => {
    setGoalbarDismissed(readGoalbarDismissed(state.session.activeId));
    /* The disclosure is per session, so switching sessions re-reads it rather
       than carrying the last one's state across. */
    setGoalOpen(readGoalOpen(state.session.activeId));
  }, [state.session.activeId]);

  const toggleGoalOpen = useCallback(() => {
    const sessionId = state.session.activeId;
    setGoalOpen((wasOpen) => {
      const next = !wasOpen;
      if (sessionId) writeGoalOpen(sessionId, next);
      return next;
    });
  }, [state.session.activeId]);

  /* The home workspace's real path, read once — `GET /api/workspace` has no
     side effect and answers with the absolute root the engine seeded. Only
     asked for when nothing is attached, since an attached repo IS the place. */
  useEffect(() => {
    if (repoRoot) return undefined;
    const controller = new AbortController();
    void fetch('/api/workspace', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { root?: unknown } | null) => {
        if (controller.signal.aborted || !body) return;
        setWorkspaceRoot(typeof body.root === 'string' && body.root.trim() ? body.root : null);
      })
      .catch(() => {
        /* No workspace answer — the footer keeps its honest "No folder" line. */
      });
    return () => controller.abort();
  }, [repoRoot]);

  /*
   * THE CLOCK KEYS ON WHETHER A TURN IS LIVE, NOT ON THE TURN OBJECT (owner,
   * 2026-09-22: "timer is also not working"). `inFlight` is replaced on every
   * stream frame; with the model's thinking streaming, that was many times a
   * second, and each replacement cleared this interval before it could fire.
   */
  const turnLive = state.session.inFlight !== null;
  useEffect(() => {
    if (!turnLive) return undefined;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [turnLive]);

  useEffect(() => {
    if (state.composer.focusNonce > 0) {
      textareaRef.current?.focus();
    }
  }, [state.composer.focusNonce]);

  /* ONE READ OF `/api/ai-config` for both the rows and the rail — see
     `effortFromProfiles`. It was two, in this effect, one line apart. */
  useEffect(() => {
    let cancelled = false;
    const gen = currentModelGen();
    void (async () => {
      const answer = await listModels(picker);
      if (cancelled || answer.outcome !== 'ok') return;
      setProfiles(answer.profiles);
      applyContextWindowFromConfig(store, answer.body, undefined, gen);
      const fromProfile = effortFromProfiles(answer.profiles);
      if (fromProfile) setEffort(fromProfile);
    })();
    return () => {
      cancelled = true;
    };
  }, [picker, store]);

  useEffect(() => {
    if (!toolsOpen && !modelOpen) return undefined;
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (toolsOpen && toolsWrapRef.current && !toolsWrapRef.current.contains(t)) {
        /* A SUBMENU IS PART OF THE MENU IT HANGS OFF. Closing the menu and
           leaving `openSub` set means the next open draws a panel the reader
           did not ask for, over the rows they came back for. */
        setToolsOpen(false);
      }
      if (modelOpen && modelWrapRef.current && !modelWrapRef.current.contains(t)) setModelOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setToolsOpen(false);
        setModelOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [toolsOpen, modelOpen]);

  const openModelMenu = useCallback(async () => {
    setModelOpen((v) => !v);
    setToolsOpen(false);
    setModelErr(null);
    const gen = currentModelGen();
    const answer = await listModels(picker);
    if (answer.outcome === 'ok') {
      setProfiles(answer.profiles);
      applyContextWindowFromConfig(store, answer.body, undefined, gen);
    } else setModelErr(answer.message);
  }, [picker, store]);

  const pickModel = useCallback(
    async (id: string) => {
      const answer = await picker.select(id);
      if (answer.outcome === 'ok') {
        /* A local switch: any ai-config read that started before now describes the old model. */
        bumpModelGen();
        store.dispatch({
          type: 'composer/model',
          model: { model: answer.model, origin: 'api-key' },
        });
        void refreshContextWindow(store, answer.model);
        /* S2b: picking a model is choosing it over the agent this chat talked to. */
        agentRuns.patch((s) => ({ ...s, agents: { ...s.agents, [state.session.activeId ?? '']: '' } }));
        /* Re-list so `active` flips on the row the reader just chose — the
           chip's nickname lookup prefers the active row when two profiles
           share a wire id. */
        const relisted = await listModels(picker);
        if (relisted.outcome === 'ok') setProfiles(relisted.profiles);
      } else {
        setModelErr(answer.message);
      }
      setModelOpen(false);
    },
    [picker, store, state.session.activeId],
  );


  /* The panel STAYS OPEN on a pick: the meter is the answer to "how much",
     and a control that closes the moment you touch it cannot be compared. */
  const pickEffort = useCallback((key: ReasoningEffort) => {
    setEffort(key);
    void persistEffort(key);
  }, []);

  /*
   * ── THE FIELD IS CONTROLLED. NOTHING ELSE MAY WRITE TO IT. ────────────────
   *
   * This used to be `composer.onSend(); textareaRef.current.value = ''`, and
   * the second line is a hand reaching past React into the DOM of a `value=`
   * textarea. It looks like belt and braces. It is a desync generator, and the
   * reason is that `onSend` does not always clear the store's draft:
   *
   *   · a whitespace-only draft — `composerPropsFrom.onSend` returns on
   *     `if (!question) return` before dispatching anything;
   *   · a queue the reducer refuses — `onSend` decides to queue from the
   *     RENDER'S snapshot of `inFlight`, and `turn/queue` re-checks against
   *     live state (`store.ts`: "if (text === '' || inFlight === null) return
   *     state"), so a turn that settled between the render and the keystroke
   *     leaves the draft exactly where it was.
   *
   * In both cases the store still holds the words and the box has been blanked
   * behind React's back. React then re-renders with an UNCHANGED `value` prop,
   * skips writing to the DOM because nothing changed from its point of view,
   * and the reader is left looking at an empty field that will send text they
   * cannot see. Deleting the line costs nothing: `turn/send` and `turn/queue`
   * both clear `composer.draft`, which is what empties the field, through the
   * one path that keeps the two in step.
   */
  /* S2b: a chat that talks to an agent sends to it, in the composer's mode and access. */
  /*
   * S2a: THE TURN CARRIES WHAT THE COMPOSER SHOWS. Images and pasted text as
   * stored ids, board nodes as their ids (the server cuts each one's map
   * slice), files and functions as repo paths; then the chips go, as a sent
   * question's do. The server resolves every one (run-node `attachments`).
   */
  const toAgent = (question: string, from: typeof state = state): void => {
    const attachments: RunAttachment[] = [
      ...from.composer.attachments.map((a): RunAttachment => (a.kind === 'image' ? { kind: 'image', id: a.id } : { kind: 'text', id: a.id })),
      ...from.composer.chips.flatMap((c): RunAttachment[] =>
        c.kind === 'node' ? [{ kind: 'node', nodeId: c.ref }] : c.kind === 'file' ? [{ kind: 'file', path: c.ref }] : c.kind === 'function' && /^fn:([^#]+)#/.test(c.ref) ? [{ kind: 'file', path: /^fn:([^#]+)#/.exec(c.ref)![1]! }] : [],
      ),
    ];
    /* askInPlace/: what the person pointed at on a board rides on the run as chips plus the block the agent receives. */
    const refs = from.composer.chips.filter((c) => c.kind === 'board-ref').map((c) => ({ label: c.label, block: c.detail ?? c.label }));
    void agentRuns.start({ agentRef: agentRun, question, sessionId: state.session.activeId, access: accessSwitch.access, intent: mode, ...(attachments.length ? { attachments } : {}), ...(refs.length ? { refs } : {}) });
    for (const a of from.composer.attachments) composer.onRemoveAttachment?.(a.id);
    for (const c of from.composer.chips) composer.onRemoveChip(c.id);
  };
  /* A board's ask-in-place (askInPlace/sendBoardAsk.ts) sends through THIS chat, agent or not, from the store as it is now. */
  const boardSend = (text: string): void => {
    if (agentRun) {
      toAgent(text, store.getState());
      return;
    }
    /* The reducer reads the draft from the store, so the words go there first (as Retry and the toolbelt do). */
    store.dispatch({ type: 'composer/draft', text });
    composerPropsFrom(store.getState(), store).onSend();
  };
  const boardSendRef = useRef(boardSend);
  boardSendRef.current = boardSend;
  useEffect(() => {
    registerBoardAskSender((text) => boardSendRef.current(text));
    return () => registerBoardAskSender(null);
  }, []);
  /* S2a: images for the agent; their handling loads when the first one arrives. */
  const takeImages = (files: File[]): void => void import('../chat/composerImages').then((m) => m.takeImageFiles(files, { agent: Boolean(agentRun), dispatch: store.dispatch, sessionId: state.session.activeId ?? '' }));
  const onSend = useCallback(() => {
    const text = state.composer.draft.trim();
    if (agentRun && text) {
      composer.onDraftChange('');
      toAgent(text);
    } else composer.onSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composer, agentRun, state.composer.draft, state.session.activeId, accessSwitch.access, mode]);

  /*
   * S5: THE QUEUE SENDS ONE PROMPT EACH TIME THIS CHAT'S TURN SETTLES. An
   * agent chat sends to its agent; otherwise the prompt is written into the
   * field and sent on the first render where the field holds it (the
   * composer's send reads the draft from its render, as `sendWhenPlanned`).
   */
  const sendQueued = useRef<string | null>(null);
  useEffect(() => {
    const want = sendQueued.current;
    if (want === null || state.composer.draft !== want) return;
    sendQueued.current = null;
    composer.onSend();
  }, [state.composer.draft, composer]);
  const queuedPrompts = useQueuedPrompts(queueKey);
  useQueueDrain(queueKey, busy, (text) => {
    if (agentRun) toAgent(text);
    else if (state.composer.draft === text) composer.onSend();
    else {
      sendQueued.current = text;
      composer.onDraftChange(text);
    }
  });

  /*
   * `/plan <task>` SENDS ONCE THE COMPOSER SAYS WHAT WAS CHOSEN (2026-09-22).
   *
   * `composer.onSend` reads the draft and the mode from the render it was made
   * in, so a send in the same tick as the mode switch would go out under the
   * mode the reader just left. The command writes the draft and the mode, and
   * this sends on the first render in which both are true.
   */
  const sendWhenPlanned = useRef<string | null>(null);
  useEffect(() => {
    const want = sendWhenPlanned.current;
    if (want === null) return;
    if (state.composer.draft !== want || state.composer.permission.mode !== 'plan') return;
    sendWhenPlanned.current = null;
    composer.onSend();
  }, [state.composer.draft, state.composer.permission.mode, composer]);

  const enabledModes = state.composer.permission.enabled;
  const currentBMode: ComposerModeKey = modeOf(mode, accessSwitch.access);
  function chooseBMode(key: ComposerModeKey): void {
    if (key === 'plan') {
      pickMode('plan');
      return;
    }
    if (activeMode !== 'build') pickMode('build');
    /* Smart is auto-edit; Full auto is Full access, confirmed once per project. */
    accessSwitch.request(wireOf(key).access!);
  }
  /* A SAVED ASK LOADED AS PLAN (V3App hydrate does the carry-over, once, and leaves this flag): say so once, quietly. */
  const [modeNote, setModeNote] = useState<string | null>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem(MODE_NOTE_KEY) !== '1') return;
      localStorage.removeItem(MODE_NOTE_KEY);
      setModeNote(ASK_NOW_PLAN_NOTE);
    } catch {
      /* no storage: no note */
    }
  }, []);
  const pickMode = useCallback(
    (key: ModeKey) => {
      {
        /* Teach is folded into Plan: the flag is always off now. */
        composer.onTeachToggle?.(false);
        /*
         * PICKING BUILD IS THE ENABLING ACT.
         *
         * Build used to be gated on a Settings toggle, and the menu offered it
         * anyway: picking it dispatched a mode the reducer refused, the chip
         * stayed on Plan, and nothing said why (found on the owner walk
         * 2026-09-17, where "Work on goal" said "switch to Build" and Build
         * could not be switched to). The reader choosing the row IS the
         * opt-in — the same one-click rule `connectLocal` records — so the
         * pick writes the preference and widens the ladder before it moves.
         */
        if (key === 'build' && !enabledModes.includes('build')) {
          writeAutoEditEnabled(true);
          store.dispatch({ type: 'composer/permission-enabled', enabled: ['plan', 'build'] });
        }
        composer.onPermissionChange(key);
      }
      try {
        localStorage.setItem('v3.composer.mode', key);
      } catch {
        /* ignore */
      }
      /* AND ON DISK, where a cold launch can reach it. `localStorage` is keyed
         by origin and the desktop used to take a new port every launch, so
         this was being written into a drawer the next launch never opened. */
      rememberPlace({ mode: key });
      setToolsOpen(false);
    },
    [composer, enabledModes, store],
  );

  const pickTool = useCallback(
    (id: ToolbeltId) => {
      setToolsOpen(false);
      composer.onToolbeltPick?.(id);
    },
    [composer],
  );

  const dismissGoalbar = useCallback(() => {
    const sessionId = state.session.activeId;
    if (!sessionId) return;
    writeGoalbarDismissed(sessionId, true);
    setGoalbarDismissed(true);
    setFocusEditing(false);
  }, [state.session.activeId]);

  /**
   * "New goal" NOW SETS THE GOAL, which it did not before.
   *
   * It used to PUT `{ title }` and nothing else, so the thing the person typed
   * into a box labelled Focus became the label on a rail row and reached
   * nothing: not the prompt, not a plan, not any loop. `goal` is a field of its
   * own now, it is rendered into every prompt this session assembles, and the
   * run aims at it.
   *
   * THE TITLE FOLLOWS ONLY WHILE IT IS STILL OURS. `titleEdited` is the store's
   * record of whether a person has ever renamed the thread; until they have,
   * the server is already re-deriving the title from the transcript on every
   * chat write, so writing the goal into it as well is a better label from a
   * better source. Once they HAVE renamed it, the name is theirs and setting a
   * goal must not quietly rename their thread — two different things wearing
   * one name is exactly what this change exists to separate.
   */
  const saveFocus = useCallback(
    async (raw: string) => {
      const sessionId = state.session.activeId;
      if (!sessionId) return;
      const goal = raw.trim();
      if (!goal) return;
      /* THE TITLE IS NO LONGER WRITTEN FROM HERE. Sending `title: goal` marked
         the thread as renamed by the person and pinned the rail row to the
         goal's raw text for good (Bastion, 2026-09-22). The server now names
         the goal and moves the title to that name while the title is still
         ours — see `updateSession`. */
      const res = await sessionsClient.update(sessionId, { goal }, repoRoot ?? undefined);
      writeGoalbarDismissed(sessionId, false);
      setGoalbarDismissed(false);
      setFocusEditing(false);
      setFocusDraft('');
      const fromServer = res.outcome === 'ok' ? res.body.index?.sessions : undefined;
      store.dispatch({
        type: 'session/index',
        sessions: fromServer
          ? state.session.sessions.map((s) => {
              const next = fromServer.find((n) => n.id === s.id);
              return next ? { ...s, title: next.title, goal: next.goal, goalName: next.goalName } : s;
            })
          : state.session.sessions.map((s) => (s.id === sessionId ? { ...s, goal } : s)),
        activeId: sessionId,
      });
      /* The bar reads the goal from the SERVER (`useGoalRun`), so the local
         dispatch above is not enough on its own — a re-read is what makes the
         bar show what was actually stored rather than what we hoped was. */
      await goalRun.refresh();
    },
    [goalRun, repoRoot, sessionsClient, state.session.activeId, state.session.sessions, store],
  );

  const onNewGoal = useCallback(() => {
    setToolsOpen(false);
    setFocusDraft(goalTitle ?? '');
    setFocusEditing(true);
  }, [goalTitle]);

  /**
   * `/goal <text>` — THE WHOLE COMMAND, in the order that makes each step true.
   *
   * Owner, 2026-09-17: "The goal should be a skill you call by doing /goal or
   * something, and invoking it begins this long-running task." Three acts, and
   * none of them is optional if the sentence is to be honest:
   *
   *   1. BUILD. A goal run is a long-running task that writes files, and the
   *      server refuses to start one in Plan. `pickMode('build')` is the
   *      enabling act (see `pickMode`), so invoking the command IS the consent
   *      — the reader typed the thing that only Build can do.
   *   2. THE GOAL IS STORED. `saveFocus` is the same write "New goal" performs;
   *      calling it rather than repeating it is what keeps the two doors to one
   *      behaviour instead of two that drift.
   *   3. THE RUN STARTS, and is told `'build'` explicitly. `useGoalRun` captured
   *      the mode when this render began, which still says Plan — the dispatch
   *      in step 1 has not been rendered yet — so without the override the run
   *      would be started under the permission the reader has just left, and
   *      the server would refuse it for a reason that is no longer true.
   */
  const startGoalCommand = useCallback(
    async (raw: string) => {
      const goal = raw.trim();
      if (!goal) return;
      if (activeMode !== 'build') pickMode('build');
      await saveFocus(goal);
      await goalRun.start('build');
    },
    [activeMode, goalRun, pickMode, saveFocus],
  );

  /*
   * ── THE SLASH MENU, CONSUMED AT LAST ─────────────────────────────────────
   *
   * `slashCommands()` has existed since Decision 4 and only the retired
   * `chat/Composer.tsx` ever read it, so V3 advertised nothing and offered
   * nothing. It is DERIVED — one registry, from the toolbelt and the permission
   * modes — and every row here calls the exact handler the `+` menu and the
   * mode chip already call. This adds a way in, not a second answer to "what
   * can I do here", which is the v1 defect item 2.7 names.
   */
  const draft = state.composer.draft;
  const slashList = useMemo<SlashCommand[]>(
    /* The skills come from disk, so the registry has to be rebuilt when they
       arrive — it is still DERIVED, from one more source than before. */
    /*
     * THE COMPOSER'S MODES, NOT THE PERMISSION MODES (owner, 2026-09-19:
     * "when you go to slash mode, you can't really find Teach anywhere,
     * which is kind of annoying").
     *
     * `PERMISSION_MODES` is plan and build, because Teach is not a permission
     * value on the wire - it is its own flag that refuses every mutating tool
     * by itself. That distinction is real and it stays in `pickMode`, which
     * is the one place that has to know it. It was never a reason for the
     * PALETTE to offer two of the three modes the bar offers: `/` and `+`
     * were answering the same question differently, which is the v1 defect
     * item 2.7 names.
     *
     * MODE_ROWS is still the one list. This maps its field names onto the
     * shape `slashCommands` takes rather than declaring a second one.
     */
    () =>
      slashCommands(
        /* Decision 49: the modes are B's four, added below with their real
           effect; the composer's intent rows are not offered twice. */
        [],
        TOOLBELT,
        /* `board: true` — V3 owns the architecture pane, so `/draw` here can
           actually be carried out. `chat/Composer.tsx` owns no board and must
           not offer it, same rule as `goal`. */
        { goal: true, board: true, skills: workspaceSkills },
        /* S2b: the agent this chat talks to: its own commands and skills, as typed (rows built lazily, agentSlash). */
      )
        .map((c) => (SLASH_DESC[c.name] ? { ...c, hint: SLASH_DESC[c.name]! } : c))
        .concat(B_SLASH_MODES)
        .concat(agentCaps?.slash ?? []),
    [workspaceSkills, agentCaps],
  );

  /*
   * ── WHAT THE `+` MENU AND THE PALETTE BOTH NEED FROM DISK ────────────────
   *
   * One read, once, for both surfaces. `/api/skills` is the route the Settings
   * pane already reads; asking for it here as well is the same answer to the
   * same question rather than a second one. Failures are silent by design: a
   * composer that cannot list skills still composes, and a menu that says
   * "none" because the engine was busy would be a worse lie than a short menu.
   */
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/skills', { signal: controller.signal, headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        const raw = body as { skills?: unknown } | null;
        if (!raw || !Array.isArray(raw.skills)) return;
        setWorkspaceSkills(
          raw.skills.filter(
            (sk): sk is { slug: string; name: string; description: string } =>
              !!sk && typeof (sk as { slug?: unknown }).slug === 'string',
          ),
        );
      })
      .catch(() => {
        /* No skills listed. The composer works without them. */
      });
    return () => controller.abort();
  }, []);

  const slashText = slashQuery(draft);
  const slashHits = slashText === null ? [] : slashMatches(slashText, slashList);
  /* An outside press closes the menu (UX audit #14); the next change to the draft reopens it. Dismissed FOR a draft,
     cleared at render the moment the draft differs (a set during render re-renders in place, no extra commit; an
     effect that reset a boolean after every keystroke cost a second commit per character: perf ratchet). Clearing
     it, not just comparing, is what lets retyping the dismissed text reopen the menu. */
  const [slashDismissedFor, setSlashDismissedFor] = useState<string | null>(null);
  if (slashDismissedFor !== null && slashDismissedFor !== draft) setSlashDismissedFor(null);
  const slashDismissed = slashDismissedFor === draft;
  const slashShown = slashText !== null && slashHits.length > 0;
  useEffect(() => {
    if (!slashShown || slashDismissed) return undefined;
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.s2-comp')) setSlashDismissedFor(draft);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [slashShown, slashDismissed, draft]);
  const slashOpen = slashShown && !slashDismissed;
  /*
   * ── THE SHELVES (Decision 35) ───────────────────────────────────────────
   *
   * The palette is Skills over Commands over Modes, three rows each, then a
   * count. `slashSections` owns the rule and is tested without React; this
   * holds only which shelves the reader has opened, which is view state and
   * nothing else. A fresh `/` forgets them, because the expansion was about
   * the last search and not about this one.
   *
   * THE KEYBOARD COUNTS VISIBLE ROWS, and the shelves decide what is visible,
   * so the flat list comes from the SAME call that drew them — otherwise the
   * highlight lands on a row nobody can see.
   */
  const slashSectionList = slashSections(slashHits, {
    expanded: slashExpanded,
    searching: (slashText ?? '') !== '',
  });
  const slashRows = slashVisible(slashSectionList);

  /*
   * ── THE THREE SUBMENUS, DERIVED ──────────────────────────────────────────
   *
   * Each one is a view of something this component already holds or has
   * already read: the model profiles the agent chip lists, the skills the
   * engine loads, the servers named in `.sequence/mcp.json`. None of them is
   * a hand-written list, which is the rule `composerModel.TOOLBELT` states at
   * length and the reason v1's three `+` menus are named as a defect.
   *
   * A SUBMENU WITH NOTHING IN IT SAYS SO AND SAYS WHERE TO PUT SOMETHING.
   * "No skills yet" plus the path is actionable; an empty panel is a dead end.
   */
  const slashActive = slashRows[Math.min(slashIndex, Math.max(0, slashRows.length - 1))] ?? null;

  function runSlash(command: SlashCommand, rest: string): void {
    /* The draft was only ever the command. Clearing it is what closes the menu
       and leaves the field ready for the actual question. */
    composer.onDraftChange('');
    setSlashIndex(0);
    setSlashExpanded(new Set());
    if (command.source.kind === 'toolbelt') pickTool(command.source.id);
    /* S2b: the CLI's own command: with words after it, it goes to the agent as typed; bare, it waits in the field. */
    else if (command.source.kind === 'agent') {
      if (rest && agentRun) toAgent(`${command.source.text} ${rest}`);
      else composer.onDraftChange(`${command.source.text} `);
      textareaRef.current?.focus();
    }
    /*
     * `/plan <task>` IS A PLANNING TURN, NOT ONLY A MODE (owner, 2026-09-22:
     * "once people have something difficult to do, like in cursor, they can
     * use slash plan"). Bare `/plan` still just switches the mode. With a task,
     * the mode switches and the task is sent with its prefix, which is how the
     * engine knows to plan it (analyzer `planTurn.ts`): a goal, the steps, and
     * the plan on the AI Canvas's Plan tab.
     */
    else if (command.source.kind === 'mode' && B_SLASH_TO_MODE[command.name] && !(command.name === 'plan' && rest)) {
      chooseBMode(B_SLASH_TO_MODE[command.name]!);
    } else if (command.source.kind === 'mode' && command.source.mode === 'plan' && rest) {
      pickMode('plan');
      const text = `/plan ${rest}`;
      sendWhenPlanned.current = text;
      composer.onDraftChange(text);
    } else if (command.source.kind === 'mode') pickMode(command.source.mode === 'build' ? 'build' : 'plan');
    /*
     * A SKILL IS NOT A BUTTON — it is a sentence the reader was going to type.
     * The agent already loads every skill's summary and pulls in the body of
     * the one that matches the question, so the honest thing `/onboard` can do
     * is put the skill's own words in the field and let the person add to
     * them. Sending it for them would be the palette deciding what was asked.
     */
    else if (command.source.kind === 'skill') {
      composer.onDraftChange(`${command.label}: `);
      textareaRef.current?.focus();
    }
    /*
     * `/goal <text>` starts the long-running task; bare `/goal` opens the form
     * the "New goal" row opens, because a goal with no words is a question, not
     * an instruction.
     *
     * ── NAMED, NOT REACHED BY ELIMINATION ──────────────────────────────────
     *
     * This branch used to be a bare `else`. It was correct, and it was correct
     * BY ACCIDENT: `SlashSource` happens to have four members and the other
     * three are handled above, so whatever fell through here was a goal. A
     * fifth kind added to that union next month would have fallen in here and
     * STARTED A LONG-RUNNING TASK THAT WRITES FILES — silently, under Build,
     * because that is what this branch does.
     *
     * The cost of naming it is one comparison. The cost of not naming it is
     * paid once, by whoever adds the fifth kind, in the worst way this menu
     * has available. `never` makes it a compile error instead.
     */
    else if (command.source.kind === 'goal') {
      if (rest) void startGoalCommand(rest);
      else onNewGoal();
    }
    /*
     * `/draw` WRITES THE REQUEST. IT DOES NOT SEND IT.
     *
     * Owner, 2026-09-21: "it shouldn't also auto implement." The canvas has
     * held this rule since `onGenerate` — a gesture proposes, a person sends —
     * and a command that drew the board the instant it was picked would be the
     * auto-implement he is objecting to, reached through the palette instead
     * of through an attach.
     *
     * `rest` is kept when he typed some: "/draw the data flow" is a more
     * specific request than the default, and discarding his words to
     * substitute ours is the thing `a-door-the-model-takes-one-time-in-three`
     * is about.
     */
    else if (command.source.kind === 'board') {
      composer.onDraftChange(
        rest
          ? `Draw the architecture board for this project: ${rest}`
          : 'Draw the architecture board for this project from what is actually in the code.',
      );
      textareaRef.current?.focus();
    } else {
      const unreachable: never = command.source;
      void unreachable;
    }
  }

  function onComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    const native = event.nativeEvent as unknown as KeyboardEvent;
    const composing = native.isComposing === true;
    /* SHIFT+TAB CYCLES THE MODES (Decision 49, B's "Cycle modes"): Ask ->
       Auto-edit -> Full access -> Plan -> Ask. Full access asks once per
       project first (chat/AccessControl.tsx). */
    if (event.key === 'Tab' && event.shiftKey && !composing) {
      event.preventDefault();
      chooseBMode(nextComposerMode(currentBMode));
      return;
    }
    /*
     * WHILE THE MENU IS OPEN IT OWNS ARROWS, ENTER AND ESCAPE — a reader with a
     * list in front of them who presses Enter meant the list. Letting it fall
     * through would post "/plan" to the model as a question, which is the
     * product advertising `/` in its most-read line and then ignoring it.
     */
    if (slashOpen && !composing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        event.preventDefault();
        setSlashIndex((i) => (i + delta + slashRows.length) % slashRows.length);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        composer.onDraftChange('');
        setSlashIndex(0);
        setSlashExpanded(new Set());
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && slashActive) {
        event.preventDefault();
        runSlash(slashActive, '');
        return;
      }
    }
    /*
     * ── AND THE `@` PICKER OWNS THEM AFTER THE SLASH MENU ──────────────────
     *
     * Second, not first: the two cannot both be open (a draft is either inside
     * a slash token or inside an `@` token, never both), but the order states
     * which wins if that ever stops being true, rather than leaving it to
     * whichever branch happens to be written above the other.
     *
     * ESCAPE CLOSES BY PROBING AT A CARET THE TOKEN CANNOT CONTAIN, which is
     * how `chat/Composer.tsx` does it. There is no "close the picker" action —
     * the picker's existence IS the probe's answer — so inventing a second way
     * to clear it would be a second source of truth for one piece of state.
     */
    const picker = state.composer.mention;
    if (picker !== null && !composing) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        composer.onMentionMove?.(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        composer.onMentionProbe?.(state.composer.draft, -1);
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey && picker.results.length > 0) {
        event.preventDefault();
        const chosen = picker.results[picker.activeIndex] ?? picker.results[0];
        if (chosen) composer.onMentionPick?.(chosen);
        return;
      }
    }
    /*
     * S5, AFTER THE MENUS AND BEFORE ENTER-SENDS: while a turn runs, Enter
     * steers the words into it (codex; anything that cannot steer queues
     * them) and Tab queues them; Up in an empty field brings back the last
     * prompt. One table (shell/shortcuts.ts) names these chords.
     *
     * NOT WHILE A `/` OR `@` POPUP IS OPEN: its keys are its own. A Tab that
     * queued from inside a popup would also trap keyboard focus; outside a
     * running turn with words, Tab keeps its default (it moves focus).
     */
    const popupOpen = slashOpen || picker !== null;
    const s5 = popupOpen ? null : composerKeyIntent(event, { running: busy, draft: state.composer.draft, composing });
    if (s5 === 'recall') {
      const last = lastPrompt(state.session.turns);
      if (last) {
        event.preventDefault();
        composer.onDraftChange(last);
      }
      return;
    }
    if (s5) {
      event.preventDefault();
      const text = state.composer.draft;
      composer.onDraftChange('');
      /* The running agent run's own run-node key (agentRunner.ts builds it the same way). */
      const r = s5 === 'steer' ? runsState.runs.find((x) => x.status === 'running' && x.sessionId === state.session.activeId && x.agentRef) : undefined;
      /* Nothing to steer (Tab, or Sequence's own turn): it waits in the queue. */
      if (!r) promptQueue.add(queueKey, text);
      else {
        const sessionKey = r.nodeId ? `ask-node::${r.nodeId}::${r.agentRef}` : `chat::${r.sessionId ?? 'none'}::${r.agentRef}`;
        void import('../composer/steerClient').then((m) => m.steerOrQueue({ queueKey, sessionKey, text }));
      }
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !composing) {
      event.preventDefault();
      /*
       * `/goal ship the parser guard` — a command WITH an argument. The menu
       * closed the instant a space was typed, and that is correct for a menu;
       * it would be wrong here, because the words after the name ARE the goal.
       * `slashInvocation` is the second reader that exists for exactly this.
       */
      const invoked = slashInvocation(draft);
      const command = invoked ? (slashList.find((c) => c.name === invoked.name) ?? null) : null;
      if (invoked && command) {
        runSlash(command, invoked.rest);
        return;
      }
      onSend();
    }
  }

  const onDecideAll = useCallback(
    (proposalId: ProposalId, decision: 'accepted' | 'rejected') => {
      const proposal = state.session.proposals[proposalId];
      if (!proposal) return;
      for (const file of proposal.files) {
        if (file.decision !== 'pending') continue;
        store.dispatch({
          type: 'proposal/file-decide',
          proposalId,
          path: file.path,
          decision,
        });
      }
    },
    [state.session.proposals, store],
  );

  const turns = state.session.turns;
  const inFlight = state.session.inFlight;
  /*
   * PLAN READY (owner, 2026-09-22) — see PlanApprovalCard. Shown under the
   * turn that wrote the plan, in Plan mode, when the plan has open steps and
   * no run is going; answered once, then gone.
   */
  const lastAssistant = [...turns].reverse().find((t): t is AssistantTurn => t.role === 'assistant');
  const lastWrotePlan =
    lastAssistant !== undefined &&
    (lastAssistant.evidence.tools.some((t) => t.name === 'write_plan') ||
      lastAssistant.work.some((w) => w.verb === 'Called write_plan'));
  const planDocumentLanded = state.session.canvasDoc.blocks.some(
    (b) => b.surface === 'plan' && b.type === 'markdown',
  );
  const planReady =
    !inFlight &&
    activeMode === 'plan' &&
    lastWrotePlan &&
    lastAssistant !== undefined &&
    planCardAnswered !== lastAssistant.id &&
    !goalRun.run.running &&
    goalRun.plan.some((step) => step.status === 'open')
      ? { turnId: lastAssistant.id }
      : null;
  const queued = composer.queued ?? null;
  const planTodos =
    (inFlight?.todos?.length ?? 0) > 0
      ? inFlight!.todos
      : (
          [...turns]
            .reverse()
            .find(
              (t): t is AssistantTurn =>
                t.role === 'assistant' && (t.todos?.length ?? 0) > 0,
            )?.todos ?? []
        );
  const activePlanStep = planTodos.find((t) => t.status === 'active') ?? null;
  const planDone = planTodos.filter((t) => t.status === 'done').length;
  const planBlocked = planTodos.filter((t) => t.status === 'blocked').length;
  /*
   * ── THE SESSION'S PLAN OUTRANKS THE TURN'S TODO LIST ─────────────────────
   *
   * `planTodos` above is `update_todos` — a list that is initialised empty at
   * the top of every turn and thrown away with it (`todoList.ts` says so in its
   * own first paragraph). It is a good progress display for a reader watching
   * sixteen tool rounds go by, and it is not a plan.
   *
   * `goalRun.plan` survives the turn, and is what a run works down. So when one
   * exists it owns the progress count and the track; when there is none, this
   * whole block is inert and the bar behaves exactly as it did before, which is
   * what keeps every existing goalbar test meaningful rather than merely green.
   */
  const goalPlan = goalRun.plan;
  const goalProgress = goalPlanProgress(goalPlan);
  const goalNowLine = goalRunNowLine(goalRun.run, goalPlan);
  /* The bar's second line when nothing is running — the outcome folded in, or
     the step a run would start at. The `Last run: …` ROW it replaces is gone
     (walk-4-white-glass-plan.md §2). */
  const goalRestLine = goalRunRestLine(goalRun.run, goalPlan);
  const goalNextOpenId = goalPlan.find((s) => s.status === 'open')?.id ?? null;
  /* The disclosure only means anything when there is a list under it. */
  const goalStepsOpen = goalOpen && goalPlan.length > 0;
  const progressDone = goalPlan.length > 0 ? goalProgress.done : planDone;
  const progressTotal = goalPlan.length > 0 ? goalProgress.total : planTodos.length;

  /*
   * THE BAR'S COPY — the goal, one line about it, and the track.
   *
   * Lifted out of the JSX because it is rendered inside a BUTTON when there is
   * a plan to disclose and inside a plain box when there is not, and two copies
   * of five branches would be two things to keep in step. Phrasing content
   * only, for the same reason: a <div> inside a <button> is invalid, so the
   * track is a span the stylesheet makes a block.
   */
  const goalCopy = (
    <>
      <span className="v3-goalbar-title" title={goalTitle ?? undefined}>
        {goalLabel}
      </span>
      {goalNowLine ? (
        /* A RUN IS WORKING. It names WHERE IN THE PLAN the run is — "step 2 of
           4" — and then the turn it is on, because "it is on turn 19" is the
           difference between waiting and intervening. The safety ceiling lives
           in `title` and nowhere else: printed in the line it reads as the
           plan's length (owner, 2026-09-18: "why is there 24 turns… if it's a
           four-part plan"). This line OUTRANKS the per-turn todo line below,
           which describes one turn of that run. */
        <span className="v3-goalbar-step" data-testid="v3-goalbar-run" title={goalNowLine.title}>
          {goalNowLine.text}
        </span>
      ) : inFlight && activePlanStep ? (
        <span className="v3-goalbar-step" data-testid="v3-goalbar-step">
          Working, {activePlanStep.title}
        </span>
      ) : inFlight ? (
        <span className="v3-goalbar-step" data-testid="v3-goalbar-working">
          Working toward this focus…
        </span>
      ) : goalRestLine ? (
        /* NOTHING IS RUNNING AND THERE IS A PLAN. The outcome of the last run
           is folded in here rather than printed as a `Last run: …` row of its
           own (walk-4-white-glass-plan.md §2): the row sat under a list that is
           now closed by default, which is nowhere near the eye. When there is
           no outcome to fold, the line names the step a run would start at, so
           a closed list still costs the reader nothing. */
        <span
          className="v3-goalbar-step"
          data-testid="v3-goalbar-step"
          data-tone={goalRestLine.tone}
          title={goalRestLine.text}
        >
          {goalRestLine.text}
        </span>
      ) : activePlanStep ? (
        <span className="v3-goalbar-step" data-testid="v3-goalbar-step">
          Now: {activePlanStep.title}
        </span>
      ) : planTodos.length > 0 ? (
        <span className="v3-goalbar-step" data-testid="v3-goalbar-step">
          {planDone} of {planTodos.length} done
          {planBlocked > 0 ? `, ${planBlocked} blocked` : ''}
        </span>
      ) : null}
      {progressTotal > 0 ? (
        <span className="v3-goalbar-track" data-testid="v3-goalbar-track" aria-hidden="true">
          <span
            className="v3-goalbar-fill"
            style={{ transform: `scaleX(${progressDone / progressTotal})` }}
          />
        </span>
      ) : null}
    </>
  );

  return (
    <>
      {/* S6: plain while short, virtualized when long; pinned to the end within 40 px (chat/ChatTranscript.tsx). */}
      <ChatTranscript
        head={null}
        turns={turns}
        renderTurn={(turn) => <MessageBlock key={turn.id} turn={turn} proposals={state.session.proposals} onDecideAll={onDecideAll} />}
        empty={turns.length === 0 && !inFlight}
        tail={[
          ...(planReady
            ? [
                {
                  key: 'plan-ready',
                  node: (
          <PlanApprovalCard
            goalName={goalLabel}
            steps={goalRun.plan}
            hasDocument={planDocumentLanded}
            busy={goalRun.busy}
            onBuild={() => {
              setPlanCardAnswered(planReady.turnId);
              if (activeMode !== 'build') pickMode('build');
              void goalRun.start('build');
            }}
            onKeepPlanning={() => setPlanCardAnswered(planReady.turnId)}
            onOpenPlan={() => {
              store.dispatch({ type: 'session/canvas-surface', surface: 'plan' });
              requestHostCommand('canvas.ai');
            }}
          />
                  ),
                },
              ]
            : []),
          ...(inFlight ? [{ key: 'thinking', node: <ThinkingBlock inFlight={inFlight} now={now} /> }] : []),
        ]}
        foot={
          !inFlight && !agentRunning && agentTurnsKey > 0 && state.session.activeId
            ? [
                {
                  key: 'changed-files',
                  node: (
                    <Suspense fallback={null}>
                      <ChangedFiles sessionId={state.session.activeId} refreshKey={agentTurnsKey} />
                    </Suspense>
                  ),
                },
              ]
            : []
        }
      />

      <footer
        className="s2-compwrap v3-composer"
        /* S2a: an image dropped on the composer goes to the agent; a text file attaches as text. */
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer?.files ?? []);
          if (files.length === 0) return;
          e.preventDefault();
          void import('../chat/composerImages').then((m) => m.takeDroppedFiles(files, { agent: Boolean(agentRun), dispatch: store.dispatch, sessionId: state.session.activeId ?? '', attachText: composer.onAttach }));
        }}
      >
        {fanoutOpen ? (
          <Suspense fallback={null}>
            <FanoutMenu store={store} draft={state.composer.draft} start={{ access: accessSwitch.access, intent: mode }} onClose={() => setFanoutOpen(false)} />
          </Suspense>
        ) : null}
        {/* S7: the chat's worktree, beside the goal; a click opens merge-back. */}
        {worktree ? (
          <div className="v3-wt-row" style={{ position: 'relative' }}>
            <Suspense fallback={null}>
              <WorktreeChip worktree={worktree} onOpen={() => setWorktreeOpen((o) => !o)} />
              {worktreeOpen && state.session.activeId ? (
                <MergePanel sessionId={state.session.activeId} worktree={worktree} fanoutId={fanoutId} onClose={() => setWorktreeOpen(false)} onChanged={rereadWorktree} />
              ) : null}
            </Suspense>
          </div>
        ) : null}
        {showGoalbar && !focusEditing ? (
          <div className="v3-goal" data-testid="v3-goal">
          <div
            className="v3-goalbar"
            data-testid="v3-goalbar"
            aria-label={`Goal: ${goalTitle!}`}
            title={goalTitle!}
          >
            {/*
              THE TITLE ROW IS THE DISCLOSURE (walk-4-white-glass-plan.md §2).
              A button, not a click handler on the bar: the bar already holds
              two real buttons (Work on goal, Dismiss) and nesting them inside a
              third is invalid HTML and unreachable from a keyboard. So the
              glyph and the copy — the part of the bar that is not a control —
              become the control, and `aria-expanded` says which way it is.

              A bar with NO PLAN under it is not a disclosure, and rendering a
              button that opens nothing would be a control that lies. It stays a
              plain span in that case.
            */}
            {goalPlan.length > 0 ? (
              <button
                type="button"
                className="v3-goalbar-disclosure"
                data-testid="v3-goalbar-disclosure"
                aria-expanded={goalStepsOpen}
                aria-controls="v3-goal-steps"
                title={goalStepsOpen ? 'Hide the plan' : 'Show the plan'}
                onClick={toggleGoalOpen}
              >
                <span className="v3-goalbar-target" aria-hidden="true">
                  <Icon name="target" size={14} />
                </span>
                <span className="v3-goalbar-copy">{goalCopy}</span>
                <span className="v3-goalbar-caret" aria-hidden="true">
                  <Icon name={goalStepsOpen ? 'chevdown' : 'chevright'} size={12} />
                </span>
              </button>
            ) : (
              <>
                <span className="v3-goalbar-target" aria-hidden="true">
                  {/* 14, not 12 (owner 2026-09-18: "it renders very small and
                      rough on the gold little toolbar"). The mark is a ring with
                      four ticks around it; at 12px the ring's diameter is 6.5
                      device pixels and there is no room left for the ticks to be
                      anything but grey. 14 is the same rung the chrome tabs
                      use. */}
                  <Icon name="target" size={14} />
                </span>
                <div className="v3-goalbar-copy">{goalCopy}</div>
              </>
            )}
            {progressTotal > 0 ? (
              <span
                className="v3-goalbar-progress"
                data-testid="v3-goalbar-progress"
                title={`${progressDone} of ${progressTotal} done`}
              >
                {progressDone}/{progressTotal}
              </span>
            ) : null}
            <span
              className="v3-goalbar-status"
              data-testid="v3-goalbar-status"
              data-status={
                goalRun.run.running
                  ? 'running'
                  : inFlight
                    ? inFlight.phase === 'queued'
                      ? 'started'
                      : inFlight.phase === 'finalizing'
                        ? 'finished'
                        : 'running'
                    : turns.some((t) => t.role === 'assistant')
                      ? 'finished'
                      : 'idle'
              }
            >
              {goalRun.run.running
                ? 'Running'
                : inFlight
                  ? inFlight.phase === 'queued'
                    ? 'Started'
                    : inFlight.phase === 'finalizing'
                      ? 'Finishing'
                      : 'Running'
                  : turns.some((t) => t.role === 'assistant')
                    ? 'Finished'
                    : 'Idle'}
            </span>
            {/*
              WORK ON GOAL / STOP — the control this whole feature exists for.

              `goalRunVerdict.goalRunButton` decides the label, whether it is
              disabled, and the reason; none of that decision lives here,
              because a rule inside a render can only be checked by rendering
              the component, so the states nobody thought to render are the
              states nobody checks.

              `title` is never empty. A disabled control with no explanation is
              a bug report, and both things that can disable this one are fixed
              in a single move by the person reading the tooltip.
            */}
            <button
              type="button"
              className="v3-goalbar-work"
              data-testid="v3-goalbar-work"
              data-action={goalRun.button.action}
              disabled={goalRun.button.disabled || goalRun.busy}
              title={goalRun.button.title}
              aria-label={goalRun.button.title}
              onClick={() => {
                if (goalRun.button.action === 'start') void goalRun.start();
                else if (goalRun.button.action === 'stop') void goalRun.stop();
              }}
            >
              {goalRun.button.label}
            </button>
            <button
              type="button"
              className="v3-goalbar-dismiss"
              data-testid="v3-goalbar-dismiss"
              aria-label="Dismiss goal"
              title="Dismiss goal"
              onClick={dismissGoalbar}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
          {goalStepsOpen ? (
            <ol className="v3-goal-steps" id="v3-goal-steps" data-testid="v3-goal-steps">
              {goalPlan.map((step) => (
                <li
                  key={step.id}
                  className="v3-goal-step"
                  data-testid={`v3-goal-step-${step.id}`}
                  data-state={step.status}
                  /* The step the next turn will aim at, marked so a reader can
                     see where a run would resume without counting rows. */
                  data-next={step.id === goalNextOpenId ? 'yes' : undefined}
                >
                  <span className="v3-goal-step-mark" aria-hidden="true">
                    {step.status === 'done' ? '✓' : step.status === 'parked' ? '!' : '○'}
                  </span>
                  <span className="v3-goal-step-text" title={step.text}>
                    {step.text}
                  </span>
                  {step.status === 'parked' ? (
                    <>
                      {/* A PARKED STEP SHOWS ITS REASON. A step that stopped
                          and does not say why is indistinguishable from one
                          nobody started — and the reason is the agent's own
                          last words, which is what the person needs in order
                          to decide between rewriting the step and retrying it. */}
                      <span
                        className="v3-goal-step-why"
                        data-testid={`v3-goal-why-${step.id}`}
                        title={`parked: ${step.why ?? 'no reason recorded'}`}
                      >
                        {step.why ?? 'no reason recorded'}
                      </span>
                      <button
                        type="button"
                        className="v3-goal-step-unpark"
                        data-testid={`v3-goal-unpark-${step.id}`}
                        title="Put this step back on the list, so a run tries it again"
                        onClick={() => {
                          void goalRun.savePlan(
                            goalPlan.map((s) =>
                              s.id === step.id
                                ? { id: s.id, text: s.text, status: 'open' as const }
                                : s,
                            ),
                          );
                        }}
                      >
                        Unpark
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
          {goalRun.error ? (
            <div className="v3-goal-error" data-testid="v3-goal-error" role="status">
              {goalRun.error}
            </div>
          ) : null}
          </div>
        ) : focusEditing ? (
          <form
            className="v3-focus-form"
            data-testid="v3-focus-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveFocus(focusDraft);
            }}
          >
            <Icon name="target" size={12} />
            <input
              className="v3-focus-input"
              data-testid="v3-focus-input"
              aria-label="Focus for this chat"
              placeholder="Name what this chat is for"
              value={focusDraft}
              autoFocus
              onChange={(e) => setFocusDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setFocusEditing(false);
                  setFocusDraft('');
                }
              }}
            />
            <button type="submit" className="v3-focus-save" data-testid="v3-focus-save">
              Save
            </button>
            <button
              type="button"
              className="v3-focus-cancel"
              data-testid="v3-focus-cancel"
              onClick={() => {
                setFocusEditing(false);
                setFocusDraft('');
              }}
            >
              Cancel
            </button>
          </form>
        ) : null}

        {queued ? (
          <div className="v3-queued" role="status" data-testid="composer-queued">
            <Icon name="clock" size={12} />
            <span className="v3-queued-text">Sending when this finishes: {queued}</span>
            <button
              type="button"
              className="v3-queued-cancel"
              data-testid="composer-unqueue"
              onClick={() => composer.onUnqueue?.()}
            >
              Cancel
            </button>
          </div>
        ) : null}

        {/* Decision 49: the composer is uiarc.dev's (BArc.dc.html .comp): a 22px
            floating box, the field, and one row of pills with a round send. */}
        {hasPendingApproval ? (
          <Suspense fallback={null}>
            <Takeover sessionId={state.session.activeId} repoRoot={repoRoot} draftKept={hasDraft} />
          </Suspense>
        ) : null}
        {/* A REFUSED TURN IS NEVER SILENT (UX audit): the server's own sentence,
            above the composer, with its route out. No model configured offers
            both ways to get one: an agent (the model menu's Connect list) or a
            model (Settings). */}
        {modeNote ? (
          <div className="s2-modenote" role="status" data-testid="s2-mode-note">
            <span className="s2-modenote-t">{modeNote}</span>
            <button type="button" className="s2-ibtn s2-ibtn-sm" aria-label="Dismiss" data-testid="s2-mode-note-dismiss" onClick={() => setModeNote(null)}>
              <S2Icon name="x" small />
            </button>
          </div>
        ) : null}
        {composer.failure && !hasPendingApproval ? (
          <div className="s2-notice" role="alert" data-testid="s2-failure" data-fix={composer.failure.fix ?? undefined}>
            <span className="s2-notice-mark" aria-hidden="true">
              <S2Icon name="bolt" small />
            </span>
            <p className="s2-notice-text" data-testid="s2-failure-text">
              {composer.failure.fix === 'provider' ? 'No model is set up to answer yet.' : composer.failure.message}
              {composer.failure.fix === 'provider' ? <span>{composer.failure.message}</span> : null}
            </p>
            <div className="s2-notice-acts">
              {composer.failure.fix === 'provider' ? (
                <>
                  <button
                    type="button"
                    className="s2-btn s2-btn-sm s2-blue"
                    data-testid="s2-failure-connect"
                    onClick={() => {
                      if (!modelOpen) void openModelMenu();
                    }}
                  >
                    Connect an agent
                  </button>
                  <button
                    type="button"
                    className="s2-btn s2-btn-sm"
                    data-testid="s2-failure-model"
                    onClick={() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'provider' } })}
                  >
                    Add a model
                  </button>
                </>
              ) : composer.failure.retryable && composer.onRetry ? (
                <button type="button" className="s2-btn s2-btn-sm" data-testid="s2-failure-retry" onClick={composer.onRetry}>
                  Retry
                </button>
              ) : null}
              {composer.onDismissFailure ? (
                <button type="button" className="s2-ibtn s2-ibtn-sm" aria-label="Dismiss" data-testid="s2-failure-dismiss" onClick={composer.onDismissFailure}>
                  <S2Icon name="x" small />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="s2-comp" hidden={hasPendingApproval}>
          {slashOpen ? (
            <div className="s2-menu s2-slash" role="listbox" aria-label="Commands" data-testid="v3-slash">
              <div className="s2-slash-scroll">
                {slashSectionList.map((section) => (
                  <div key={section.group} className="s2-menu-sec" data-group={section.group}>
                    <p className="s2-gh s2-menu-gh" role="presentation">
                      {section.group === 'agent' && agentRun ? agentRun.charAt(0).toUpperCase() + agentRun.slice(1) : section.label}
                    </p>
                    {section.items.map((command) => {
                      const row = slashRows.indexOf(command);
                      const q = (slashText ?? '').toLowerCase();
                      const at = q ? command.name.toLowerCase().indexOf(q) : -1;
                      return (
                        <button
                          key={command.name}
                          type="button"
                          role="option"
                          aria-selected={command === slashActive}
                          className={`s2-mi s2-mi-line${command === slashActive ? ' is-on' : ''}`}
                          data-testid="v3-slash-item"
                          data-command={command.name}
                          onMouseEnter={() => setSlashIndex(row)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            runSlash(command, '');
                          }}
                        >
                          <span className="s2-chipicon">
                            <S2Icon name={SLASH_GLYPH[command.icon] ?? (command.name === 'plan' ? 'map' : 'spark')} small />
                          </span>
                          <span className="s2-mono s2-slash-name">
                            /
                            {at >= 0 ? (
                              <>
                                {command.name.slice(0, at)}
                                <mark>{command.name.slice(at, at + q.length)}</mark>
                                {command.name.slice(at + q.length)}
                              </>
                            ) : (
                              command.name
                            )}
                          </span>
                          <span className="s2-slash-desc">{command.hint || command.label}</span>
                        </button>
                      );
                    })}
                    {section.hidden > 0 ? (
                      <button
                        type="button"
                        className="s2-mi s2-mi-more"
                        data-testid={`v3-slash-more-${section.group}`}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          setSlashExpanded((prev) => {
                            const next = new Set(prev);
                            next.add(section.group);
                            return next;
                          });
                        }}
                      >
                        Show {section.hidden} more
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <div className="s2-mi s2-mi-foot" role="presentation">
                <span className="s2-grow">Move, run, close</span>
                <span className="s2-kbd">↑↓</span>
                <span className="s2-kbd">Enter</span>
                <span className="s2-kbd">Esc</span>
              </div>
            </div>
          ) : null}
          {state.composer.mention !== null ? (
            <div className="s2-menu s2-mention" data-testid="composer-mentions" role="listbox">
              {state.composer.mention.results.length === 0 ? (
                <div className="s2-empty" data-testid="composer-mentions-empty">
                  No grounded matches
                </div>
              ) : (
                state.composer.mention.results.map((r, i) => (
                  <button
                    key={`${r.kind}:${r.ref}`}
                    type="button"
                    role="option"
                    aria-selected={i === state.composer.mention!.activeIndex}
                    className={`s2-mi${i === state.composer.mention!.activeIndex ? ' is-on' : ''}`}
                    data-testid="composer-mention"
                    data-kind={r.kind}
                    data-active={i === state.composer.mention!.activeIndex ? 'true' : 'false'}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      composer.onMentionPick?.(r);
                    }}
                  >
                    <S2Icon name={r.kind === 'file' ? 'file' : r.kind === 'function' ? 'term' : 'box'} />
                    <span className="s2-mi-d">
                      {r.label}
                      {r.detail === null ? null : <span>{r.detail}</span>}
                    </span>
                    <span className="s2-kbd">{r.kind}</span>
                  </button>
                ))
              )}
            </div>
          ) : null}
          {state.composer.chips.length > 0 || state.composer.attachments.length > 0 ? (
            <div className="s2-attach">
              {state.composer.chips.length > 0 ? (
                <span className="s2-attach-group" data-testid="composer-chips">
                  {state.composer.chips.map((chip) => (
                    <span key={chip.id} className="s2-chip" data-testid="composer-chip" data-kind={chip.kind} title={`Grounded ask context: ${chip.kind} ${chip.ref}`}>
                      <S2Icon name={chip.kind === 'file' ? 'file' : chip.kind === 'node' ? 'box' : 'term'} small />
                      <span className="s2-chip-l">{chip.label}</span>
                      <button type="button" className="s2-chip-x" data-testid="composer-chip-remove" aria-label={`Remove ${chip.label}`} onClick={() => composer.onRemoveChip(chip.id)}>
                        <S2Icon name="x" small />
                      </button>
                    </span>
                  ))}
                </span>
              ) : null}
              {state.composer.attachments.length > 0 ? (
                <span className="s2-attach-group" data-testid="composer-attachments">
                  {state.composer.attachments.map((a) => (
                    <span key={a.id} className="s2-chip" data-testid="composer-attachment" data-kind={a.kind ?? 'text'} title={a.kind === 'image' ? `An image for the agent, ${a.width} by ${a.height}` : a.truncated ? 'Attached text, cut short' : 'Attached text, supplied by you'}>
                      <S2Icon name={a.kind === 'image' ? 'canvas' : 'file'} small />
                      <span className="s2-chip-l">{a.name}</span>
                      {a.kind === 'image' ? <span className="s2-mono s2-meta">{a.width} × {a.height}</span> : a.truncated ? <span className="s2-meta">cut</span> : null}
                      <button type="button" className="s2-chip-x" data-testid="composer-attachment-remove" aria-label={`Remove ${a.name}`} onClick={() => composer.onRemoveAttachment?.(a.id)}>
                        <S2Icon name="x" small />
                      </button>
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          ) : null}
          {queuedPrompts.length ? (
            <Suspense fallback={null}>
              <PromptQueueList queueKey={queueKey} />
            </Suspense>
          ) : null}
          <textarea
            ref={textareaRef}
            className="s2-ta"
            rows={2}
            placeholder={COMPOSER_PLACEHOLDER}
            aria-label="Message input"
            data-testid="composer-field"
            value={state.composer.draft}
            onChange={(e) => {
              composer.onDraftChange(e.target.value);
              composer.onMentionProbe?.(e.target.value, e.target.selectionStart ?? 0);
            }}
            onSelect={(e) => {
              const el = e.target as HTMLTextAreaElement;
              composer.onMentionProbe?.(el.value, el.selectionStart ?? 0);
            }}
            onKeyDown={onComposerKeyDown}
            onPaste={(e) => {
              const images = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
              if (images.length === 0) return;
              e.preventDefault();
              takeImages(images);
            }}
          />
          <div className="s2-cb">
            <input
              ref={attachInputRef}
              type="file"
              accept=".txt,.md,.log,.json,.csv,.diff,.patch,text/*"
              hidden
              data-testid="v3-attach-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                void file
                  .text()
                  .then((text) => composer.onAttach?.(file.name, text))
                  .catch(() => {
                    /* The reader's own unreadable file; they can see which one they picked. */
                  });
              }}
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              data-testid="s2-image-input"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (files.length) takeImages(files);
              }}
            />
            {/* THE + HOLDS EVERYTHING ADDABLE (Jaden): files, images, board
                nodes, an @-mention and the / skills. */}
            <div className="s2-anchor" ref={toolsWrapRef}>
              <button
                type="button"
                className="s2-ibtn s2-g s2-round"
                aria-haspopup="menu"
                aria-expanded={toolsOpen}
                data-testid="v3-tools-trigger"
                aria-label="Add files, images, board nodes or skills"
                title="Add files, images, board nodes or skills"
                onClick={() => {
                  setToolsOpen((v) => !v);
                            setModelOpen(false);
                }}
              >
                <S2Icon name="plus" />
              </button>
              {toolsOpen ? (
                <div className="s2-menu s2-menu-up" role="menu" aria-label="Add to the message">
                  <button type="button" role="menuitem" className="s2-mi" data-testid="v3-tools-attach" onClick={() => { setToolsOpen(false); attachInputRef.current?.click(); }}>
                    <S2Icon name="file" />
                    <span className="s2-mi-d">Attach a file<span>A log, a diff, any text</span></span>
                  </button>
                  <button type="button" role="menuitem" className="s2-mi" data-testid="s2-tools-image" onClick={() => { setToolsOpen(false); imageInputRef.current?.click(); }}>
                    <S2Icon name="canvas" />
                    <span className="s2-mi-d">Image<span>A screenshot for the agent</span></span>
                  </button>
                  {agentRun ? (
                    <button type="button" role="menuitem" className="s2-mi" data-testid="v3-tools-board-png" onClick={() => { setToolsOpen(false); void import('../chat/composerImages').then((m) => m.takeBoardImage(store.dispatch, state.session.activeId ?? '')); }}>
                      <S2Icon name="board" />
                      <span className="s2-mi-d">Board nodes<span>The board, as an image, for the agent</span></span>
                    </button>
                  ) : null}
                  <button type="button" role="menuitem" className="s2-mi" data-testid="s2-tools-mention" onClick={() => { setToolsOpen(false); const d = state.composer.draft; const next = `${d}${d && !d.endsWith(' ') ? ' ' : ''}@`; composer.onDraftChange(next); composer.onMentionProbe?.(next, next.length); textareaRef.current?.focus(); }}>
                    <S2Icon name="search" />
                    <span className="s2-mi-d">Mention a file or node<span>@ looks it up on the map</span></span>
                  </button>
                  <button type="button" role="menuitem" className="s2-mi" data-testid="s2-tools-slash" onClick={() => { setToolsOpen(false); composer.onDraftChange('/'); textareaRef.current?.focus(); }}>
                    <S2Icon name="spark" />
                    <span className="s2-mi-d">Skills and commands<span>/ lists them</span></span>
                  </button>
                  {repoRoot ? (
                    <button type="button" role="menuitem" className="s2-mi" data-testid="v3-tools-fanout" onClick={() => { setToolsOpen(false); setFanoutOpen(true); }}>
                      <S2Icon name="layers" />
                      <span className="s2-mi-d">Several agents at once<span>One message, a worktree for each, then pick</span></span>
                    </button>
                  ) : null}
                  <button type="button" role="menuitem" className="s2-mi" data-testid="v3-new-goal" onClick={() => { setToolsOpen(false); onNewGoal(); }}>
                    <S2Icon name="target" />
                    <span className="s2-mi-d">New goal<span>Set the focus for this chat</span></span>
                  </button>
                  {agentRun ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="s2-mi"
                      data-testid="agent-compact"
                      disabled={agentRunning}
                      onClick={() => {
                        setToolsOpen(false);
                        void agentRuns.start({ agentRef: agentRun, sessionId: state.session.activeId, compact: true, question: 'Compact the conversation', access: accessSwitch.access, intent: mode });
                      }}
                    >
                      <S2Icon name="layers" />
                      <span className="s2-mi-d">Compact the conversation<span>Summarise it to free the context window</span></span>
                    </button>
                  ) : null}
                  <div className="s2-menu-sep" role="separator" />
                  <button type="button" role="menuitem" className="s2-mi" data-testid="v3-tools-customize" onClick={() => { setToolsOpen(false); store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'workspace' } }); }}>
                    <S2Icon name="sliders" />
                    <span className="s2-mi-d">Customize<span>Models, skills, MCP servers</span></span>
                  </button>
                </div>
              ) : null}
            </div>
            {/* THE MODE PILL (B): icon, mode, chevron; its menu has one line per mode. */}
            {accessSwitch.confirm ? (
              <ConfirmDialog
                icon="bolt"
                title="Switch on Full access?"
                body={accessSwitch.confirm.prompt}
                error={accessSwitch.confirm.error}
                confirmLabel="Allow Full access"
                testId="v3-full-access-confirm"
                okTestId="v3-full-access-allow"
                cancelTestId="v3-full-access-cancel"
                errorTestId="v3-full-access-error"
                onConfirm={accessSwitch.accept}
                onCancel={accessSwitch.cancel}
              />
            ) : null}
            <span className="s2-grow" />
            <ModelMenu
              wrapRef={modelWrapRef}
              open={modelOpen}
              onTrigger={() => void openModelMenu()}
              onClose={() => setModelOpen(false)}
              sessionId={state.session.activeId ?? ''}
              agentRun={agentRun}
              profiles={profiles}
              pickModel={pickModel}
              modelErr={modelErr}
              effort={effort}
              effortRows={EFFORT_ROWS}
              pickEffort={pickEffort}
              modelChip={modelChip}
              modelChipShort={modelChipShort}
              modelChipTitle={modelChipTitle}
              chipIdentity={chipIdentity}
              effortLabel={effortLabel}
              modes={B_MODES}
              currentMode={currentBMode}
              onMode={(key) => {
                setModelOpen(false);
                chooseBMode(key as ComposerModeKey);
              }}
              onModeIntent={(key) => {
                if (key === 'full') preloadFullAccessDialog();
              }}
            />
            {/* The context ring lives in the status bar under the chat (s2-status-context), not on this row. */}
            {busy ? (
              <>
                {hasDraft ? (
                  <button
                    type="button"
                    className="s2-pill"
                    data-testid="composer-queue"
                    onClick={() => {
                      promptQueue.add(queueKey, state.composer.draft);
                      composer.onDraftChange('');
                    }}
                    aria-label="Queue follow-up"
                    title="Send this when the running turn finishes"
                  >
                    Queue
                  </button>
                ) : null}
                <button
                  type="button"
                  className="s2-send is-stop"
                  data-testid="composer-stop"
                  data-action="stop"
                  onClick={() => {
                    if (running) composer.onStop();
                    /* An agent's turn stops through its run (Decision 49: one Stop, the send button's place). */
                    const live = mineRuns.filter((r) => r.status === 'running').at(-1);
                    if (live) void agentRuns.stop(live.id);
                  }}
                  aria-label="Stop"
                  title="Stop the running turn"
                >
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <rect x="4" y="4" width="8" height="8" rx="2" />
                  </svg>
                </button>
              </>
            ) : (
              <button
                type="button"
                className="s2-send"
                data-testid="composer-send"
                onClick={onSend}
                disabled={composer.composer.send !== 'ready'}
                aria-label="Send"
                title="Send"
              >
                <S2Icon name="up" />
              </button>
            )}
          </div>
        </div>
        {/* With the status bar off, the composer keeps the place it answers in. */}
        {statusBarOn ? null : (
          <div
            className="s2-where"
            data-testid="v3-composer-where"
            data-where={repoRoot ? 'repo' : workspaceRoot ? 'workspace' : 'none'}
            title={repoRoot ?? (workspaceRoot ? `Home workspace ${workspaceRoot}` : 'No folder attached')}
          >
            <S2Icon name="folder" small />
            <span className="s2-where-path" dir="rtl">
              &lrm;{repoRoot ?? workspaceRoot ?? 'No folder'}&lrm;
            </span>
            {branch ? (
              <span className="s2-where-branch" data-testid="v3-composer-branch" title={`On branch ${branch}`}>
                <S2Icon name="branch" small />
                {branch}
              </span>
            ) : null}
          </div>
        )}
      </footer>
    </>
  );
}
