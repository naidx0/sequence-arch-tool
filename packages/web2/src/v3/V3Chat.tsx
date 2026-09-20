import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import {
  ContextRing,
  formatContextWindowTokens,
  resolveContextRingUsed,
} from '../chat/ContextRing';
import { Icon, type IconName } from '../chat/Icon';
import { ProseMessage } from '../chat/ProseMessage';
import { ReasoningGlyph } from '../chat/ThinkingMark';
import { stripToolProse, toolCardTitle } from '../chat/stripToolProse';
import { TodoList } from '../chat/TodoList';
import { ToolCallCard } from '../chat/ToolCallCard';
import {
  TOOLBELT,
  chipLabel,
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
import { splitThinking } from '../chat/splitThinking';
import { createSessionsClient, type SessionsClient } from '../sessions/sessionsClient';
import { createModelPicker, type ModelPickerProfile } from '../chat/modelPicker';
import { modelLabel } from '../chat/modelSelection';
import { writeAutoEditEnabled } from '../settings/autonomyPreference';
import { createSettingsClient } from '../settings/settingsClient';
import type {
  AssistantTurn,
  FileEditProposal,
  InFlightTurn,
  ProposalId,
  Turn,
  WorkRow,
} from '../state/types';
import { composerPropsFrom, useAppState, useStore } from '../state';
import { groundedRepoRoot, refreshContextWindow } from '../state/connect';
import { goalPlanProgress, goalRunNowLine, goalRunRestLine } from './goalRunVerdict';
import { useGoalRun } from './useGoalRun';
import '../chat/chat.css';

type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

const EFFORT_ROWS: { key: ReasoningEffort; label: string; description: string }[] = [
  { key: 'none', label: 'Off', description: 'Fastest · no reasoning' },
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

async function hydrateEffortFromProfile(): Promise<ReasoningEffort | null> {
  const client = createSettingsClient();
  const read = await client.read();
  if (read.outcome !== 'ok') return null;
  const body = read.body;
  if (!('profiles' in body) || !Array.isArray(body.profiles)) return null;
  const activeId = body.defaultProfileId ?? body.profiles[0]?.id;
  const pr = body.profiles.find((p) => p.id === activeId);
  const effort = pr?.params?.reasoningEffort;
  if (effort === 'none' || effort === 'low' || effort === 'medium' || effort === 'high') {
    try {
      localStorage.setItem('v3.reasoningEffort', effort);
    } catch {
      /* ignore */
    }
    return effort;
  }
  return null;
}

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

function repoTail(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function TurnTools({
  tools,
  running,
}: {
  tools: { id: string; name: string; text?: string; evidence?: string | null }[];
  running?: boolean;
}) {
  if (tools.length === 0) return null;
  return (
    <div className="v3-tools chat-scope" data-testid="v3-tool-timeline">
      {tools.map((tool) => (
        <ToolCallCard
          key={tool.id}
          tool={{ id: tool.id, name: tool.name }}
          result={tool.text ?? tool.evidence ?? undefined}
          running={running}
        />
      ))}
    </div>
  );
}

function ApprovalCard({
  proposal,
  onDecideAll,
}: {
  proposal: FileEditProposal;
  onDecideAll: (id: ProposalId, decision: 'accepted' | 'rejected') => void;
}) {
  const pending = proposal.files.filter((f) => f.decision === 'pending');
  const settled = proposal.files.length > 0 && pending.length === 0;

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
        <div className="v3-approve-settled">Decision recorded · {proposal.status}</div>
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

function MessageBlock({
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
      <div className="v3-msg v3-msg-user" data-testid="v3-msg-user">
        <div className="v3-msg-meta">You · {formatTime(turn.at)}</div>
        <div className="v3-msg-bubble">
          <ProseMessage text={turn.text} />
        </div>
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
    <div className="v3-msg v3-msg-assistant chat-scope">
      <div className="v3-msg-meta">
        <span className="v3-msg-who">Sequence · {formatTime(turn.at)}</span>
        {usage ? (
          <span
            className="v3-context-chip"
            title="Turn bill — summed input/output across tool rounds (not the context-ring fill)"
            data-testid="v3-turn-bill"
          >
            turn · {formatContextWindowTokens(usage.inputTokens)} in ·{' '}
            {formatContextWindowTokens(usage.outputTokens)} out
          </span>
        ) : null}
      </div>
      {(assistant.todos?.length ?? 0) > 0 ? <TodoList items={assistant.todos} /> : null}
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
        <div className="v3-msg-prose" data-testid="v3-msg-prose">
          <ProseMessage text={stripped} />
        </div>
      ) : null}
      {linked.map((p) => (
        <ApprovalCard key={p.id} proposal={p} onDecideAll={onDecideAll} />
      ))}
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
  const thoughtOpenLive = thoughtSegments.some((s) => s.open);
  const { stripped: answerStripped, tools: streamingTools } = stripToolProse(answerText);
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
  /* Owner walk: one readable line — Working (or tool verb) · time · N running.
     Round / token bill stay in the store; they are not default HUD chrome. */
  const phaseLabel =
    inFlight.phase === 'queued'
      ? 'Queued'
      : inFlight.phase === 'finalizing'
        ? 'Finalizing'
        : toolVerb
          ? toolVerb
          : work > 0
            ? 'Working'
            : 'Working';
  const live =
    inFlight.phase !== 'queued' && inFlight.phase !== 'finalizing';

  return (
    <div className="v3-thinking chat-scope" data-testid="v3-thinking" aria-live="polite">
      {/*
        ── ONE LINE, THREE COLUMNS, NONE OF WHICH MOVE ────────────────────

        Owner, 2026-09-19: "the working - I don't mind the loading symbol, it
        looks good - but the one running, the 38 seconds, the 40 seconds,
        these are all disproportionate, they're all disaligned."

        He is describing three separate faults on one strip. The phase word
        changes as the turn moves (Working → Reading a file → Finalizing) and
        nothing reserved its width, so `margin-left: auto` threw the timer to
        a different place every few seconds. The timer and the count were set
        in two different faces at two different sizes by two rules that
        disagreed. And the row could WRAP, so at a narrow column it was two
        lines of different heights.

        The kit's `status/strip` answers all three the same way, and it is
        worth quoting because the fix is one property: the state word gets
        `min-width: 9ch`. A reserved column cannot jitter. The stylesheet does
        the rest - one size for the row, tabular numerals for both numbers,
        and no wrapping.
      */}
      <div className={`v3-thinking-bar${live ? ' live' : ''}`} data-testid="v3-thinking-bar">
        <ReasoningGlyph active />
        <span className="name" data-testid="v3-thinking-phase">
          {phaseLabel}
        </span>
        {work > 0 ? (
          <span className="v3-thinking-running" data-testid="v3-thinking-running">
            {work} running
          </span>
        ) : null}
        <span className="v3-thinking-elapsed" data-testid="v3-thinking-elapsed">
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
      {thoughtSegments.length > 0 ? (
        <div className="v3-thinking-fold reasonfold sparklefold" data-open={thoughtOpen || undefined}>
          <button
            type="button"
            className={`reasonfold-trigger${thoughtOpenLive ? ' live' : ''}`}
            data-testid="v3-thinking-fold"
            aria-expanded={thoughtOpen}
            onClick={() => setThoughtOpen((v) => !v)}
          >
            <Icon name="spark" size={14} className="sparkfold-mark" />
            <span className="name">{thoughtOpenLive ? 'Thinking' : 'Thought'}</span>
            <span className="sparkfold-time">{elapsed}</span>
            <Icon name={thoughtOpen ? 'chevdown' : 'chevright'} size={12} />
          </button>
          <div className="sparkfold-wrap" data-open={thoughtOpen ? 'yes' : 'no'}>
            <div className="reasonfold-body v3-thinking-thought" aria-hidden={!thoughtOpen}>
              {thoughtSegments.map((segment, index) => (
                <div key={index} className="v3-thinking-thought-chunk">{segment.text}</div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <TurnTools tools={timeline} running={inFlight.phase !== 'finalizing'} />
      {answerStripped.trim() ? (
        <div className="v3-msg-prose">
          <ProseMessage text={answerStripped} />
        </div>
      ) : null}
    </div>
  );
}

type ModeKey = 'plan' | 'build' | 'teach';

const MODE_ROWS: { key: ModeKey; label: string; description: string; icon: IconName }[] = [
  { key: 'plan', label: 'Plan', description: 'Draws and drafts. Changes need your accept.', icon: 'file' },
  { key: 'build', label: 'Build', description: 'Writes files and runs commands. No accept.', icon: 'hammer' },
  { key: 'teach', label: 'Teach', description: 'One concept a turn, drawn. Reads only.', icon: 'book' },
];

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
}

export function V3Chat({ goalRunClient }: V3ChatProps = {}) {
  const store = useStore();
  const state = useAppState();
  const composer = composerPropsFrom(state, store);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
  const [modelOpen, setModelOpen] = useState(false);
  const [profiles, setProfiles] = useState<ModelPickerProfile[]>([]);
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
  /** Which `+` submenu is open. One at a time — two panels over one menu is a maze. */
  const [openSub, setOpenSub] = useState<string | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  /** This workspace's skills (`GET /api/skills`), for the palette and the menu. */
  const [workspaceSkills, setWorkspaceSkills] = useState<{ slug: string; name: string; description: string }[]>([]);
  /** Server names out of `.sequence/mcp.json`, for the MCP submenu. */
  const [mcpServers, setMcpServers] = useState<string[]>([]);
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
  const teach = state.composer.teach;
  const activeMode: ModeKey = teach ? 'teach' : mode === 'build' ? 'build' : 'plan';
  const activeLabel = MODE_ROWS.find((r) => r.key === activeMode)?.label ?? 'Plan';
  const repoRoot = groundedRepoRoot(state);
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
    ...(goalRunClient ? { client: goalRunClient } : {}),
  });
  const goalTitle = goalRun.goal?.trim() || null;
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
  const modelChip = activeProfile?.nickname || modelLabel(state.composer.model) || 'Model';
  const modelChipTitle = activeProfile ? `${activeProfile.nickname} · ${activeProfile.model}` : modelChip;
  /* Five characters and a mark, so the chip is the same width whatever answers
     — see `chipLabel`. The whole name is on the control as its title and its
     accessible name, which is the only place a cut is allowed to put what it
     cut. */
  const modelChipShort = chipLabel(modelChip);
  const effortLabel = EFFORT_ROWS.find((r) => r.key === effort)?.label ?? 'Med';
  const showGoalbar = Boolean(goalTitle && !goalbarDismissed);

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

  useEffect(() => {
    if (!state.session.inFlight) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [state.session.inFlight]);

  useEffect(() => {
    if (state.composer.focusNonce > 0) {
      textareaRef.current?.focus();
    }
  }, [state.composer.focusNonce]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fromProfile = await hydrateEffortFromProfile();
      if (!cancelled && fromProfile) setEffort(fromProfile);
      const answer = await picker.list();
      if (!cancelled && answer.outcome === 'ok') setProfiles(answer.profiles);
    })();
    return () => {
      cancelled = true;
    };
  }, [picker]);

  useEffect(() => {
    if (!toolsOpen && !modelOpen) return undefined;
    const onDoc = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (toolsOpen && toolsWrapRef.current && !toolsWrapRef.current.contains(t)) {
        /* A SUBMENU IS PART OF THE MENU IT HANGS OFF. Closing the menu and
           leaving `openSub` set means the next open draws a panel the reader
           did not ask for, over the rows they came back for. */
        setToolsOpen(false);
        setOpenSub(null);
      }
      if (modelOpen && modelWrapRef.current && !modelWrapRef.current.contains(t)) setModelOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setToolsOpen(false);
        setOpenSub(null);
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
    const answer = await picker.list();
    if (answer.outcome === 'ok') setProfiles(answer.profiles);
    else setModelErr(answer.message);
  }, [picker]);

  const pickModel = useCallback(
    async (id: string) => {
      const answer = await picker.select(id);
      if (answer.outcome === 'ok') {
        store.dispatch({
          type: 'composer/model',
          model: { model: answer.model, origin: 'api-key' },
        });
        void refreshContextWindow(store, answer.model);
        /* Re-list so `active` flips on the row the reader just chose — the
           chip's nickname lookup prefers the active row when two profiles
           share a wire id. */
        const relisted = await picker.list();
        if (relisted.outcome === 'ok') setProfiles(relisted.profiles);
      } else {
        setModelErr(answer.message);
      }
      setModelOpen(false);
    },
    [picker, store],
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
  const onSend = useCallback(() => {
    composer.onSend();
  }, [composer]);

  const enabledModes = state.composer.permission.enabled;
  const pickMode = useCallback(
    (key: ModeKey) => {
      if (key === 'teach') {
        composer.onTeachToggle?.(true);
        composer.onPermissionChange('plan');
      } else {
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
      const session = state.session.sessions.find((s) => s.id === sessionId);
      const alsoTitle = session?.titleEdited !== true;
      await sessionsClient.update(
        sessionId,
        { goal, ...(alsoTitle ? { title: goal } : {}) },
        repoRoot ?? undefined,
      );
      writeGoalbarDismissed(sessionId, false);
      setGoalbarDismissed(false);
      setFocusEditing(false);
      setFocusDraft('');
      store.dispatch({
        type: 'session/index',
        sessions: state.session.sessions.map((s) =>
          s.id === sessionId ? { ...s, goal, ...(alsoTitle ? { title: goal } : {}) } : s,
        ),
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
        MODE_ROWS.map((row) => ({
          mode: row.key,
          label: row.label,
          description: row.description,
          icon: row.icon,
        })),
        TOOLBELT,
        { goal: true, skills: workspaceSkills },
      ),
    [workspaceSkills],
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

  /* The MCP servers are the KEYS of `mcpServers` in `.sequence/mcp.json` —
     the same file the Settings pane edits, read here only to name them. */
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/mcp', { signal: controller.signal, headers: { accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        const text = (body as { text?: unknown } | null)?.text;
        if (typeof text !== 'string') return;
        const parsed = JSON.parse(text) as { mcpServers?: Record<string, unknown> };
        const names = parsed?.mcpServers ? Object.keys(parsed.mcpServers) : [];
        setMcpServers(names);
      })
      .catch(() => {
        /* No mcp.json, or not JSON. The submenu says so rather than guessing. */
      });
    return () => controller.abort();
  }, []);
  const slashText = slashQuery(draft);
  const slashHits = slashText === null ? [] : slashMatches(slashText, slashList);
  const slashOpen = slashText !== null && slashHits.length > 0;
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
  const SUBMENUS: {
    id: string;
    label: string;
    icon: IconName;
    count: string;
    empty: string;
    rows: { id: string; label: string; hint: string; active?: boolean; run: () => void }[];
  }[] = [
    {
      id: 'models',
      label: 'Models',
      icon: 'bot',
      count: profiles.length === 0 ? 'none saved' : `${profiles.length} saved`,
      empty: 'No models saved yet. Add one in Settings → Reasoning.',
      rows: profiles.map((pr) => ({
        id: pr.id,
        label: pr.nickname,
        hint: pr.model,
        active: pr.active,
        run: () => void pickModel(pr.id),
      })),
    },
    {
      id: 'skills',
      label: 'Skills',
      icon: 'skill',
      count: workspaceSkills.length === 0 ? 'none yet' : `${workspaceSkills.length} loaded`,
      empty: 'No skills yet. Add .sequence/skills/<slug>/SKILL.md, or let a Build run distill one.',
      rows: workspaceSkills.map((sk) => ({
        id: sk.slug,
        label: sk.name,
        hint: sk.slug,
        run: () => {
          composer.onDraftChange(`${sk.name}: `);
          textareaRef.current?.focus();
        },
      })),
    },
    {
      id: 'mcp',
      label: 'MCP servers',
      icon: 'plus',
      count: mcpServers.length === 0 ? 'none configured' : `${mcpServers.length} configured`,
      empty: 'No servers in .sequence/mcp.json. Settings → Workspace has the file.',
      rows: mcpServers.map((name) => ({
        id: name,
        label: name,
        hint: 'mcp.json',
        /* NAMING IS ALL THIS CAN HONESTLY DO from here: the tools a server
           exposes are fetched per turn by the engine, and the file that
           configures it is edited in Settings. So the row opens that. */
        run: () =>
          store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'workspace' } }),
      })),
    },
  ];
  const slashActive = slashRows[Math.min(slashIndex, Math.max(0, slashRows.length - 1))] ?? null;

  function runSlash(command: SlashCommand, rest: string): void {
    /* The draft was only ever the command. Clearing it is what closes the menu
       and leaves the field ready for the actual question. */
    composer.onDraftChange('');
    setSlashIndex(0);
    setSlashExpanded(new Set());
    if (command.source.kind === 'toolbelt') pickTool(command.source.id);
    else if (command.source.kind === 'mode') pickMode(command.source.mode);
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
    /* `/goal <text>` starts the long-running task; bare `/goal` opens the form
       the "New goal" row opens, because a goal with no words is a question, not
       an instruction. */
    else if (rest) void startGoalCommand(rest);
    else onNewGoal();
  }

  function onComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    const native = event.nativeEvent as unknown as KeyboardEvent;
    const composing = native.isComposing === true;
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
  const used = resolveContextRingUsed(inFlight?.usage ?? null, composer.contextUsed ?? null);
  const windowTok = composer.contextWindow;
  const queued = composer.queued ?? null;
  const breakdown = inFlight ? null : (composer.contextBreakdown ?? null);
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
      <span className="v3-goalbar-title">{goalTitle}</span>
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
          Working · {activePlanStep.title}
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
      <div className="v3-transcript chat-scope" aria-label="Chat transcript">
        {turns.map((turn) => (
          <MessageBlock
            key={turn.id}
            turn={turn}
            proposals={state.session.proposals}
            onDecideAll={onDecideAll}
          />
        ))}
        {inFlight ? <ThinkingBlock inFlight={inFlight} now={now} /> : null}
      </div>

      <footer className="v3-composer">
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

        {slashOpen ? (
          <div
            className="v3-mode-pop v3-slash-pop"
            role="listbox"
            aria-label="Commands"
            data-testid="v3-slash"
          >
            {slashSectionList.map((section) => (
              <div key={section.group} className="v3-slash-section" data-group={section.group}>
                {/* A HEADING IS NOT AN OPTION. It sits outside the listbox's
                    rows as a presentational label, so a screen reader walking
                    the options does not meet "Skills" as something pickable. */}
                <p className="v3-pop-heading" role="presentation">
                  {section.label}
                </p>
                {section.items.map((command) => {
                  const row = slashRows.indexOf(command);
                  return (
                    <button
                      key={command.name}
                      type="button"
                      role="option"
                      aria-selected={command === slashActive}
                      className={command === slashActive ? 'is-selected' : ''}
                      data-testid="v3-slash-item"
                      data-command={command.name}
                      onMouseEnter={() => setSlashIndex(row)}
                      /* mousedown, not click: the textarea blurs on click and the
                         field would lose the draft before the pick lands — the same
                         reason the old composer's rows use it. */
                      onMouseDown={(event) => {
                        event.preventDefault();
                        runSlash(command, '');
                      }}
                    >
                      {/* `target` alone steps to the 14 rung — it is the one glyph in
                          the set drawn entirely from thin strokes (owner 2026-09-18).
                          MEASURED IN THE APP: `.v3-mode-pop button > .i` already
                          paints every row's glyph at 16px, so today this changes the
                          class and not a pixel. It is here so the rung is right if
                          that rule ever goes, not because it is doing the work — the
                          per-glyph weight in Icon.tsx is what fixes the row now. */}
                      <Icon name={command.icon} size={14} />
                      <span className="v3-mode-pop-label">{command.label}</span>
                    </button>
                  );
                })}
                {/* THE COUNT IS THE POINT. "Show 44 more" tells a reader whether
                    it is worth opening; "Show more" asks them to find out. */}
                {section.hidden > 0 ? (
                  <button
                    type="button"
                    className="v3-slash-more"
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
        ) : null}

        <div className="v3-composer-shell">
          <textarea
            ref={textareaRef}
            className="v3-composer-input"
            rows={2}
            placeholder="Ask about the architecture, request a change, or run an agent task — / for commands"
            aria-label="Message input"
            data-testid="composer-field"
            value={state.composer.draft}
            onChange={(e) => composer.onDraftChange(e.target.value)}
            onKeyDown={onComposerKeyDown}
          />
          <div className="v3-composer-foot">
            {/*
              THE PICKER THE "Attach a file" ROW OPENS. Hidden rather than
              styled, because a file input cannot be restyled reliably and the
              menu row IS the affordance. Text only: `onAttach` posts text.
            */}
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
                    /* Unreadable file. The strip already carries engine
                       failures; a local read that fails is the reader's own
                       file and they can see which one they picked. */
                  });
              }}
            />
            <div className="v3-tools-menu" ref={toolsWrapRef}>
              {/*
                THE PLUS WEARS THE MODE (owner, 2026-09-19).

                "Build modes - just use it from the plus instead of from
                another button. Then I reduce the noise on the actual front
                bar... the only buttons you can really see on the prompt bar
                are the plus, the agent and the send."

                The mode pill is gone from the row, which leaves the question
                the pill was answering: WHICH MODE AM I IN. A mode is not a
                thing you look up, it is a thing you have to be able to see,
                so the control that now OWNS the setting also SHOWS it - the
                same `--mode-*-fill` and `--mode-*-edge` the pill wore, on the
                one button that opens the list. Three controls on the row, and
                no fewer facts on it.
              */}
              <button
                type="button"
                className="v3-tools-trigger"
                aria-haspopup="menu"
                aria-expanded={toolsOpen}
                data-testid="v3-tools-trigger"
                data-mode={activeMode}
                aria-label={`Add agents, context, tools — ${activeLabel} mode`}
                title={`${activeLabel} mode · add agents, context, tools`}
                onClick={() => {
                  setToolsOpen((v) => !v);
                  setOpenSub(null);
                }}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="M8 3.5v9M3.5 8h9" strokeLinecap="round" />
                </svg>
              </button>
              {toolsOpen ? (
                <div className="v3-mode-pop v3-tools-pop" role="menu" aria-label="Add agents, context, tools">
                  {/*
                    ── ONE MENU, THREE SHELVES AND THREE DOORS (Decision 35) ──

                    Owner, 2026-09-19, with a reference shot headed "Add
                    agents, context, tools…": modes at the top, a rule, then
                    Image, and submenus for Models, Skills and MCP Servers.

                    THIS IS STILL ONE KEEPER LIST. `composerModel.TOOLBELT`
                    opens by recording that v1 shipped three competing `+`
                    menus and that item 2.7 names it as a defect. Nothing
                    below is a second list: the modes are `MODE_ROWS`, the
                    actions are `TOOLBELT`, the models are the same profiles
                    the agent chip shows, and the skills are the ones the
                    engine loads. Each is drawn once, here, from its own
                    source.

                    A SUBMENU OPENS A PANEL, IT DOES NOT NAVIGATE. Models and
                    Skills have their answer in this session already; MCP is a
                    door to the file that configures it, and says so rather
                    than drawing an empty shelf.
                  */}
                  <p className="v3-pop-heading" role="presentation">
                    Modes
                  </p>
                  {MODE_ROWS.map((row) => (
                    <button
                      key={row.key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={activeMode === row.key}
                      className={activeMode === row.key ? 'is-selected' : ''}
                      data-mode={row.key}
                      data-testid={`v3-tools-mode-${row.key}`}
                      title={row.description}
                      onClick={() => {
                        pickMode(row.key);
                        setToolsOpen(false);
                      }}
                    >
                      <Icon name={row.icon} size={14} />
                      <span className="v3-mode-pop-label">{row.label}</span>
                    </button>
                  ))}

                  <p className="v3-pop-heading" role="presentation">
                    Do
                  </p>
                  {TOOLBELT.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      title={item.hint}
                      onClick={() => pickTool(item.id)}
                    >
                      <Icon name={item.icon} size={14} />
                      <span className="v3-mode-pop-label">{item.label}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="v3-new-goal"
                    title="Set focus for this chat"
                    onClick={() => onNewGoal()}
                  >
                    <Icon name="target" size={14} />
                    <span className="v3-mode-pop-label">New goal</span>
                  </button>

                  <p className="v3-pop-heading" role="presentation">
                    Add
                  </p>
                  {/*
                    THE REFERENCE SHOT SAYS "Image". OURS SAYS WHAT IT TAKES.

                    `onAttach(name, text)` posts to `/api/attachment`, which
                    stores TEXT — there is no image pipeline behind the
                    composer, and a row labelled Image would be the menu
                    promising something the engine cannot do. `composerModel`
                    already states the rule this follows, about `/goal`: a row
                    that does nothing when picked is worse than no row,
                    because the reader has then been told the product can do
                    something it cannot.
                  */}
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="v3-tools-attach"
                    title="A log, a diff, any text"
                    onClick={() => {
                      setToolsOpen(false);
                      attachInputRef.current?.click();
                    }}
                  >
                    <Icon name="upload" size={14} />
                    <span className="v3-mode-pop-label">Attach a file</span>
                  </button>

                  {SUBMENUS.map((sub) => (
                    <div key={sub.id} className="v3-submenu">
                      <button
                        type="button"
                        role="menuitem"
                        aria-haspopup="menu"
                        aria-expanded={openSub === sub.id}
                        className="v3-submenu-trigger"
                        data-testid={`v3-tools-${sub.id}`}
                        title={`${sub.label} — ${sub.count}`}
                        onClick={() => setOpenSub((cur) => (cur === sub.id ? null : sub.id))}
                      >
                        <Icon name={sub.icon} size={14} />
                        <span className="v3-mode-pop-label">{sub.label}</span>
                        <Icon name="chevright" size={12} className="v3-submenu-chev" />
                      </button>
                      {openSub === sub.id ? (
                        <div className="v3-mode-pop v3-submenu-pop" role="menu" aria-label={sub.label}>
                          {sub.rows.length === 0 ? (
                            <p className="v3-mode-pop-desc v3-submenu-empty">{sub.empty}</p>
                          ) : (
                            sub.rows.map((r) => (
                              <button
                                key={r.id}
                                type="button"
                                role="menuitem"
                                className={r.active ? 'is-selected' : ''}
                                data-testid={`v3-tools-${sub.id}-row`}
                                title={`${r.label} — ${r.hint}`}
                                onClick={() => {
                                  r.run();
                                  setOpenSub(null);
                                  setToolsOpen(false);
                                }}
                              >
                                <span className="v3-mode-pop-label">{r.label}</span>
                              </button>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/*
              THE MODE PILL IS GONE FROM THIS ROW (owner, 2026-09-19).

              It was Decision 34's answer to "modes should be a different type
              of button style", and it was the right answer to that question.
              The question changed: "the only buttons you can really see on the
              prompt bar are the plus, the agent and the send." A composer row
              is the most-looked-at strip in the product and every control on it
              is rent; mode had two homes already (this pill and the `+` menu's
              top shelf), so the one that was only a DUPLICATE went.

              Nothing was lost with it. The setting lives in `+`, where its
              three rows are checkable radios, and the STATE lives on the `+`
              button itself, which now wears the mode's fill and rim.
            */}

            {/*
              ── ONE CONTROL FOR THE AGENT: WHICH MODEL, AND HOW HARD ─────────

              Owner, 2026-09-19: "Model and effort should be in one icon… just
              to condense space… you can look at examples like codex where you
              open model and effort and it's like the model above and then
              effort as kind of a meter."

              They were two chips and two popovers, which spent two slots of a
              row that has to hold at any width — and they are one decision: a
              person picking a model is choosing how much thinking they want,
              and the two were never set apart. The model list is the top half,
              the effort METER is the bottom half, and the bar shows one glyph.

One popover, so one outside-click guard and one Escape: the
              two-ref, two-flag bookkeeping the pair needed is gone with them.
            */}
            <div className="v3-mode-menu" ref={modelWrapRef}>
              <button
                type="button"
                className="v3-mode-trigger v3-agent-chip"
                aria-haspopup="menu"
                aria-expanded={modelOpen}
                data-testid="v3-model-trigger"
                data-effort={effort}
                title={`${modelChipTitle} · ${effortLabel} reasoning`}
                aria-label={`Model: ${modelChip}, reasoning ${effortLabel}`}
                onClick={() => void openModelMenu()}
              >
                {/*
                  `agent`, NOT `bot` (owner, 2026-09-19: "I think it should be
                  a sub-agent icon, plus the model attached"). The two glyphs
                  were competing for one meaning: `bot` is a face, which reads
                  as "a chatbot answers here", and the chip does not open a
                  chatbot - it opens WHICH agent and HOW HARD it thinks. `agent`
                  is the cube with a core, the same solid `skill` is drawn from,
                  so the agent and the things it loads read as one family.
                */}
                <Icon name="agent" size={14} />
                <span className="v3-chip-ellipsis" aria-hidden="true">
                  {modelChipShort}
                </span>
              </button>
              {modelOpen ? (
                <div className="v3-mode-pop v3-agent-pop" role="menu" aria-label="Model and reasoning">
                  <p className="v3-pop-heading">Model</p>
                  {modelErr ? <p className="v3-mode-pop-desc">{modelErr}</p> : null}
                  {profiles.length === 0 && !modelErr ? (
                    <button
                      type="button"
                      role="menuitem"
                      title="No saved profiles yet"
                      onClick={() => {
                        setModelOpen(false);
                        store.dispatch({
                          type: 'shell/overlay',
                          overlay: { kind: 'settings', pane: 'provider' },
                        });
                      }}
                    >
                      <span className="v3-mode-pop-label">Add a model in Settings</span>
                    </button>
                  ) : (
                    profiles.map((pr) => (
                      <button
                        key={pr.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={pr.active}
                        className={pr.active ? 'is-selected' : ''}
                        /*
                          ONE LINE, AND THE WIRE ID ON HOVER (owner,
                          2026-09-19: "under model, just the name - not
                          whatever nickname it has, not the actual sub-name,
                          the path under it").

                          `modelPicker.ts` argues for drawing both: "a menu
                          that shows only the id is a list of wire strings; a
                          menu that shows only the name cannot be checked
                          against what is actually configured." The second half
                          of that is still true, so the id did not go anywhere -
                          it moved to where a check belongs, which is the
                          moment somebody wants to check. Every row is half as
                          tall and the list stopped being a wall of paths.
                        */
                        title={`${pr.nickname} · ${pr.model} · ${pr.provider}`}
                        onClick={() => void pickModel(pr.id)}
                      >
                        <span className="v3-mode-pop-label">{pr.nickname}</span>
                      </button>
                    ))
                  )}

                  {/*
                    ── THE RAIL (owner, 2026-09-19) ──────────────────────────

                    "The reasoning picker looks bad. Look for other reasoning
                    pickers on usebastion.io/design... if you look at progress
                    rail, it's kind of like a model picker because it's like
                    five different modes — off, low, medium, high. You can use
                    progress rail as motivation."

                    Two shapes have now been wrong here, and they were wrong
                    the same way: both tried to be a CONTROL that also reads as
                    a level, and ended up as neither. Dots on a track promised
                    continuous travel; boxes in a track read as four tabs.

                    The rail separates the two jobs. The BARS are the level -
                    flat, 6px, equal, lit up to the chosen one, nothing to
                    grab. The LINE UNDER THEM is the reading, in words, exactly
                    as the kit draws it: `<b>3 / 5</b>` then the name of the
                    step. Ours is `<b>Med</b>` then what Med does. Nothing on
                    screen has to carry two meanings at once.

                    THE HIT TARGET IS NOT THE BAR. Each button is the full
                    22px height with the 6px bar inside it, so the bar can be
                    a pure mark at --r-full (which the ramp reserves for "this
                    is a state or a label", never an interactive container)
                    while the thing a finger lands on is a real target.
                  */}
                  <p className="v3-pop-heading" role="presentation">
                    Reasoning
                  </p>
                  <div className="v3-effort">
                    <div className="v3-effort-rail" role="radiogroup" aria-label="Reasoning strength">
                      {EFFORT_ROWS.map((row, i) => (
                        <button
                          key={row.key}
                          type="button"
                          role="radio"
                          aria-checked={effort === row.key}
                          className="v3-effort-step"
                          data-effort={row.key}
                          data-filled={EFFORT_ROWS.findIndex((r) => r.key === effort) >= i ? 'yes' : 'no'}
                          data-testid={`v3-effort-${row.key}`}
                          title={`${row.label} — ${row.description}`}
                          aria-label={`${row.label} — ${row.description}`}
                          onClick={() => pickEffort(row.key)}
                        >
                          <span className="v3-effort-bar" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                    {/* THE READING, IN WORDS. The kit's rail puts `3 / 5` and
                        the step's name on one line under the bars; this is
                        that line. It is also the only place the chosen level
                        is spelled out, which is why the bars do not need to
                        carry labels and can stay 6px. */}
                    <p className="v3-effort-read" data-testid="v3-effort-read">
                      <b>{effortLabel}</b>
                      <span>{EFFORT_ROWS.find((r) => r.key === effort)?.description}</span>
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <span className="v3-composer-spacer" />
            <span className="chat-scope">
              <ContextRing
                used={used ?? null}
                window={windowTok ?? null}
                breakdown={breakdown}
              />
            </span>
            {/*
              ── STOP IS THE PRIMARY WHILE ANYTHING RUNS ──────────────────────

              Owner, 2026-09-17: "have a way so we can stop chats if they're
              running." `composer.onStop()` aborts the live stream and has been
              wired the whole time; nothing ever drew it here. Queue keeps its
              behaviour — Enter still queues, and the secondary button appears
              the moment there are words to queue — but it is no longer the only
              thing the reader can press while a turn is in flight.
            */}
            {running ? (
              <>
                {hasDraft ? (
                  <button
                    type="button"
                    className="v3-btn-queue"
                    data-testid="composer-queue"
                    onClick={onSend}
                    aria-label="Queue follow-up"
                    title="Send this when the running turn finishes"
                  >
                    <Icon name="clock" size={14} />
                    Queue
                  </button>
                ) : null}
                <button
                  type="button"
                  className="v3-btn-send is-stop"
                  data-testid="composer-stop"
                  data-action="stop"
                  onClick={() => composer.onStop()}
                  aria-label="Stop"
                  title="Stop the running turn"
                >
                  {/*
                    DRAWN HERE, LIKE SEND'S ARROW, AND FILLED.

                    Owner, 2026-09-19: "the stop icon - I'm not the biggest
                    fan of how that looks. I don't know what it is, if it's a
                    centering issue, but the text isn't properly centered."

                    It is not centering: the button is symmetric and the pair
                    is centred. It is OPTICAL WEIGHT. `Icon name="stop"` is a
                    24-grid glyph whose rect runs 6.6→17.4, so its ink fills
                    45% of its box, and `.v3-btn-send svg` then forced that
                    box to 16px - about 7px of mark with 4.5px of air on each
                    side. Beside a word set solid, the mark read as pushed
                    left and the word as pushed right. Send's arrow does not
                    have the problem because it is hand-drawn on a 16 viewBox
                    and spans 9 of it.

                    So the stop mark is drawn on Send's own viewBox at Send's
                    own reach, and FILLED: a hollow rounded square is a
                    checkbox, and the universal mark for stop is solid.
                  */}
                  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <rect x="3.6" y="3.6" width="8.8" height="8.8" rx="2" />
                  </svg>
                  Stop
                </button>
              </>
            ) : (
              <button
                type="button"
                className="v3-btn-send"
                data-testid="composer-send"
                onClick={onSend}
                aria-label="Send"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M8 12.5V3.5" strokeLinecap="round" />
                  <path d="M4.2 7.2L8 3.4l3.8 3.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Send
              </button>
            )}
          </div>
        </div>

        {/*
          THE HOME WORKSPACE IS A PLACE, NOT AN ABSENCE.

          This line used to read "No folder — Open project from the sessions
          rail" whenever nothing was attached, which told the reader they were
          nowhere. They are not: the engine seeds `~/.sequence/workspace`
          (charts/, drawings/, memory/, context/) at boot and every General
          thread already lives under `~/.sequence/sessions`. Owner, 2026-09-17:
          "you don't have to open a project if you're working from the default
          workspace … it has a path to a home workspace where it can save the
          drawings, contacts etc." So the footer names that path the same way
          it names an attached repo, and only says "No folder" when the engine
          could not answer for the workspace at all.
        */}
        <div
          className={`v3-composer-where${repoRoot || workspaceRoot ? '' : ' is-empty'}${
            repoRoot ? '' : ' is-home'
          }`}
          data-testid="v3-composer-where"
          data-where={repoRoot ? 'repo' : workspaceRoot ? 'workspace' : 'none'}
          title={repoRoot ?? (workspaceRoot ? `Home workspace · ${workspaceRoot}` : 'No folder attached')}
        >
          {repoRoot ? (
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M3 4.5h4l1.5 1.5H13v6.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.5 7.5 8 3l5.5 4.5V13a.75.75 0 0 1-.75.75h-3.5V10h-2.5v3.75h-3.5A.75.75 0 0 1 2.5 13z" />
            </svg>
          )}
          {repoRoot ? (
            <span className="v3-where-path" dir="rtl">
              &lrm;{repoRoot}&lrm;
            </span>
          ) : workspaceRoot ? (
            <>
              <span className="v3-where-label">Workspace</span>
              <span className="v3-where-path" dir="rtl">
                &lrm;{workspaceRoot}&lrm;
              </span>
            </>
          ) : (
            <span className="v3-where-path">No folder — Open project from the sessions rail</span>
          )}
          {repoRoot ? <span className="v3-where-tail">{repoTail(repoRoot)}</span> : null}
        </div>
      </footer>
    </>
  );
}
