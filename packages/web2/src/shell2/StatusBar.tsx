/* ══════════════════════════════════════════════════════════════════════════
   THE STATUS BAR (Decision 49) — A's thin bar at the foot of the window
   packages/web2/src/shell2/StatusBar.tsx

   Jaden: "I like the bottom left where it shows like the codex editing". One
   quiet line, in this order: the agent's state (working, waiting on you,
   idle) with its dot, the model (its brand icon and its nickname, no
   provider word), the context ring (always drawn, empty until something is sent; hover or focus opens the breakdown), the
   workspace or worktree, the branch. Thin dividers, never a "·". Toggled in Settings
   ("Status bar", statusBarPref.ts); when it is off the composer still shows
   the context and the mode.
   ══════════════════════════════════════════════════════════════════════════ */

import { AsciiSpinner } from './AsciiSpinner';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { agentActivity, limitsText } from '../agents/agentActivity';
import { chatContext } from '../agents/contextMeter';
import { activeAgentModel, resolvedModel } from '../agents/activeModel';
import { agentDisplayName } from '../agents/agentLabels';
import { agentRuns } from '../agents/agentRuns';
import { goalRunLive } from '../agents/goalRunLive';
import { ContextRing, formatContextWindowTokens, resolveContextRingUsed } from '../chat/ContextRing';
import { tidyModelName } from '../chat/modelNickname';
import { modelLabel } from '../chat/modelSelection';
import { getBranches } from '../git/gitCalls';
import { onGitEvent } from '../git/gitEvents';
import { composerPropsFrom, groundedRepoName, groundedRepoRoot, useAppState, useStore } from '../state/connect';
import type { Turn } from '../state/types';
import { branchLabel } from '../worktree/worktreeGroups';
import { ProviderIcon, brandOf, modelGroupOf, providerLabel, providerOf, type ProviderKey } from './brandIcons';
import { S2Icon } from './icons';
import { liveWorktree } from './sessionGroups';
import { useUpdateAvailable, type UpdatePillDeps } from './updatePill';
import { markCut } from './softEdge';
import { useRescanState } from '../app/rescanRun';
import { useSwitchProgress } from '../sessions/attachProgress';

/** Input / output / cache of the turn in flight or the last answered one; "—" where nothing was metered. */
function tokenLine(inFlight: { inputTokens: number; outputTokens: number } | null | undefined, turns: readonly Turn[]): string {
  let u = inFlight ?? null;
  for (let i = turns.length - 1; !u && i >= 0; i -= 1) {
    const t = turns[i]!;
    if (t.role === 'assistant' && t.usage) u = t.usage;
  }
  const f = (n: number | null | undefined) => (typeof n === 'number' ? formatContextWindowTokens(n) : '—');
  /* No provider here reports cache reads on the wire, so it is always "—" until one does. */
  return `Input ${f(u?.inputTokens)}, Output ${f(u?.outputTokens)}, Cache —`;
}

export type AgentState = 'working' | 'waiting' | 'idle';

/** Where the bar's content sits: under the chat box (left/width in px from the
 *  window's left edge), or null for the bottom-left when no chat box is shown. */
export type StatusBarAlign = { left: number; width: number } | null;

/** The branch goes last: it fades when it is cut, and is hidden (with its divider) only when even a faded stub (BRANCH_MIN_PX) does not fit. */
export const BRANCH_MIN_PX = 48;
export function fitBranch(bar: HTMLElement): void {
  bar.removeAttribute('data-nobranch');
  const text = bar.querySelector<HTMLElement>("[data-testid='s2-status-branch']");
  /* A long branch fades out at its box (softEdge.ts); it is hidden only when even the faded minimum does not fit. */
  if (text && text.scrollWidth > text.clientWidth + 1 && text.clientWidth < BRANCH_MIN_PX) bar.setAttribute('data-nobranch', 'true');
}

export function StatusBar({ align = null, update: updateDeps }: { align?: StatusBarAlign; update?: UpdatePillDeps } = {}) {
  const barRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return undefined;
    if (typeof ResizeObserver === 'undefined') return undefined;
    /* Created once: a streamed delta re-renders this bar many times a second. */
    const ro = new ResizeObserver(() => {
      fitBranch(bar);
      markCut(bar);
    });
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  const state = useAppState();
  const store = useStore();
  /* A branch switch made outside the in-app switcher (a terminal checkout) is announced only by git:head: the chip
     follows it at once, not on the next status read. */
  /* THE STREAM IS THE ENGINE'S: it opens only once the engine has answered for the attached repository (the branches
     read returned a body), never on mount. A graph served from a static host has no /api/git/events, and an EventSource
     there logs a MIME error. BranchSwitcher and ConnectedBoard gate theirs the same way. */
  const groundedRoot = groundedRepoRoot(state);
  const [engineAnswered, setEngineAnswered] = useState(false);
  useEffect(() => {
    setEngineAnswered(false);
    if (groundedRoot === null) return undefined;
    const controller = new AbortController();
    void getBranches(undefined, controller.signal).then((answer) => {
      if (!controller.signal.aborted && answer.outcome === 'ok') setEngineAnswered(true);
    });
    return () => controller.abort();
  }, [groundedRoot]);
  useEffect(() => {
    if (!engineAnswered) return undefined;
    return onGitEvent((event) => {
      if (event.type === 'git:head') store.dispatch({ type: 'session/git-branch', branch: event.branch });
    });
  }, [store, engineAnswered]);
  /* A newer release this install can take: one read after first idle (updatePill.ts). */
  const update = useUpdateAvailable(updateDeps);
  /* A project being opened, or the project being read again: the bar says it is busy with the project. */
  const opening = useSwitchProgress();
  const rescan = useRescanState();
  const busyWord =
    opening?.kind === 'attaching'
      ? `Opening ${opening.path.split(/[\\/]/).filter(Boolean).pop() ?? opening.path}`
      : rescan.kind === 'running'
        ? 'Refreshing the board'
        : null;
  const runs = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const sessionId = state.session.activeId;
  const act = agentActivity(runs, sessionId);
  const mine = runs.runs.filter((r) => r.sessionId === sessionId);
  /* Only a live run can wait on anyone: a stopped one's open request is moot. */
  const live = mine.filter((r) => r.status === 'running');
  const waiting =
    live.some((r) => r.approvals.some((a) => a.decision === null)) ||
    mine.some((r) => (r.questions ?? []).some((q) => !q.settled));
  /* A goal run on this chat: its turns are the server's, so the window's own runs do not show them. */
  const goalLive = useSyncExternalStore(goalRunLive.subscribe, goalRunLive.get, goalRunLive.get);
  const goal = sessionId ? (goalLive[sessionId] ?? null) : null;
  const working = state.session.inFlight !== null || mine.some((r) => r.status === 'running') || goal !== null;
  const agentState: AgentState = waiting ? 'waiting' : working ? 'working' : 'idle';
  /* Who answers, by provider: Claude, OpenAI, Local, or the hosted gateway's own name (never "Sequence"
     for a hosted model). The same classifier as the composer chip and the picker, fed the same resolved
     model; with nothing connected there is no provider to name. */
  const sel = state.composer.model;
  const configured = sel.origin !== 'unconfigured' && sel.model !== '';
  const resolved = useSyncExternalStore(resolvedModel.subscribe, resolvedModel.get, resolvedModel.get);
  const identity = resolved && resolved.model === sel.model ? resolved : { model: sel.model, keyed: sel.origin === 'local' ? false : undefined, managed: sel.origin === 'default' };
  const group = configured ? modelGroupOf(identity) : null;
  /* The agent in charge: the one answering a turn here, else the one working a goal run. */
  const agentRefNow = act?.agentRef ?? goal?.agentRef ?? null;
  const agentProvider: ProviderKey | null = agentRefNow ? providerOf(agentRefNow) : null;
  const agentName: string | null = agentRefNow
    ? agentProvider === 'other'
      ? agentDisplayName(agentRefNow, runs.agentLabels)
      : providerLabel(agentProvider!)
    : (group?.label ?? null);
  /* The agent's own mark (Claude, OpenAI for Codex, Cursor, Gemini, Hermes...); Sequence's only for Sequence's own agent; the neutral glyph for one with none. */
  const agentIconOf = (ref: string): ProviderKey => {
    const b = brandOf(ref);
    return b === 'codex' ? 'openai' : b;
  };
  const agentIcon: ProviderKey | null = agentRefNow
    ? agentIconOf(agentRefNow)
    : (group?.icon ?? null);
  const doing = act?.doing ?? (goal ? `Working on goal, turn ${goal.turns + 1}` : null);
  const stateWord = agentState === 'waiting' ? 'Waiting on you' : agentState === 'working' ? (doing ?? 'Working') : 'Idle';

  const label = modelLabel(state.composer.model);
  /* No model is a fact the composer's pill already offers to fix; the bar names models only.
     An agent's model is the one it said it runs on (round 7, A3), "<Agent> default" until then. */
  const agentModel = act?.agentRef ? activeAgentModel(runs, act.agentRef, sessionId) : null;
  /* A real model name where the agent gave one (a "default" entry resolves through its description, activeModel.ts);
     only when nothing resolves the bar says "Default model": never "<Agent> default". */
  const modelRaw0 = agentModel ? (agentModel.source === 'unknown' || /^default\b/i.test(agentModel.label) ? 'Default model' : agentModel.label) : resolved && resolved.model === sel.model && configured ? resolved.label : label && !/^connect/i.test(label) ? label : null;
  /* A goal run's agent that has not said which model it runs on: the bar names the agent rather than "Default model". */
  const modelRaw = goal?.agentRef && agentName && (!act || modelRaw0 === 'Default model') ? agentName : modelRaw0;
  /* The model's short name ("Sonnet 5.5"), never the wire id. */
  const model = modelRaw ? tidyModelName(modelRaw) : null;

  const composer = composerPropsFrom(state, store);
  /* An agent answers this chat: the meter is that agent's, in this chat. Until it has reported, it is empty;
     the Sequence model's window and counts (and the agent the chat left) are not its context. */
  /* The agent this chat is on now: a window an earlier agent reported is not this one's (contextMeter.ts scopes it). */
  const agentCtx = chatContext(runs.runs, sessionId, act?.agentRef ?? null);
  const used = act ? agentCtx.used : resolveContextRingUsed(state.session.inFlight?.usage ?? null, composer.contextUsed ?? null);
  const windowTok = act ? agentCtx.size : composer.contextWindow;
  const inFlightUsage = state.session.inFlight?.usage ?? null;
  const ringNote = (act?.limits ? limitsText(act.limits) : null) ?? (act ? null : tokenLine(inFlightUsage, state.session.turns));
  const breakdown = act || state.session.inFlight ? null : (composer.contextBreakdown ?? null);

  const entry = state.session.sessions.find((s) => s.id === sessionId);
  const worktree = entry ? liveWorktree(entry) : null;
  const repoRoot = groundedRepoRoot(state);
  const workspace = worktree ? branchLabel(worktree.branch) : (groundedRepoName(state) ?? (repoRoot ? repoRoot.replace(/\\/g, '/').split('/').filter(Boolean).pop() : null) ?? 'Workspace');
  const branch = state.session.git.branch?.trim() || null;
  /* The fit only changes when the text it measures does (or the bar resizes: the observer above). */
  useLayoutEffect(() => {
    if (barRef.current) fitBranch(barRef.current);
  }, [branch, workspace, worktree]);

  const items: { key: string; node: ReactNode; title?: string }[] = [
    {
      key: 'state',
      title: stateWord,
      node: (
        <>
          <span className="s2-sb-sym" data-testid="s2-status-symbol" aria-hidden="true">
            {agentState === 'working' ? <AsciiSpinner /> : <span className={`s2-sb-dot is-${agentState}`} />}
          </span>
          <span className={`s2-sb-state${agentState === 'working' ? ' shimmer-text' : ''}`} data-testid="s2-status-state" data-state={agentState}>
            {stateWord}
          </span>
        </>
      ),
    },
    ...(model
      ? [
          {
            key: 'model',
            /* The model's name only: the provider word is not shown on hover either. */
            title: model,
            node: (
              <>
                {agentIcon ? (
                  <span className="s2-sb-icon" data-testid="s2-status-agent" data-provider={agentIcon} data-provider-name={agentName ?? ''}>
                    <ProviderIcon provider={agentIcon} />
                  </span>
                ) : null}
                <span data-testid="s2-status-model">{model}</span>
              </>
            ),
          },
        ]
      : []),
    {
      key: 'ctx',
      node: (
        /* Always there: with no window or no usage yet it is an empty ring whose panel says nothing has been sent. */
        <span className="chat-scope s2-ctx s2-sb-ring" data-testid="s2-status-context" data-unknown={windowTok ? undefined : 'true'}>
          <ContextRing used={used ?? null} window={windowTok ?? null} breakdown={breakdown} note={ringNote} showEmpty />
        </span>
      ),
    },
    {
      key: 'ws',
      title: worktree ? `Worktree ${worktree.branch}` : (repoRoot ?? 'Home workspace'),
      node: (
        <>
          <S2Icon name={worktree ? 'branch' : 'folder'} small />
          <span data-testid="s2-status-workspace">{workspace}</span>
        </>
      ),
    },
    ...(branch && !worktree ? [{ key: 'branch', title: `Branch ${branch}`, node: <><S2Icon name="branch" small /><span className="s2-mono" data-testid="s2-status-branch">{branch}</span></> }] : []),
    ...(busyWord
      ? [
          {
            key: 'busy',
            title: busyWord,
            node: (
              <>
                <span className="s2-sb-sym" aria-hidden="true">
                  <AsciiSpinner />
                </span>
                <span data-testid="s2-status-busy">{busyWord}</span>
              </>
            ),
          },
        ]
      : []),
    /* The update notice: a status item that opens Settings > General at the version row, where Update (and then Restart) is. */
    ...(update
      ? [
          {
            key: 'update',
            title: `Version ${update.version} is ready to install`,
            node: (
              <button type="button" className="s2-sb-update" data-testid="s2-status-update" onClick={() => store.dispatch({ type: 'shell/overlay', overlay: { kind: 'settings', pane: 'app' } })}>
                Update to v{update.version}
              </button>
            ),
          },
        ]
      : []),
  ];

  /* A name changes (a model, a branch, the state word) without the bar's own box moving, but not on every streamed
     delta: mark and fit again only when one of the names does (the ResizeObserver above covers the box). */
  const marked = useRef(false);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    /* The first pass is the observer's: it reports once when it starts watching, before the first paint, so doing it
       here as well forced a layout in the middle of boot. Without an observer (jsdom) it stays here. */
    const first = !marked.current;
    marked.current = true;
    if (first && typeof ResizeObserver !== 'undefined') return;
    fitBranch(bar);
    markCut(bar);
  }, [branch, workspace, worktree?.branch, stateWord, model, agentName]);

  return (
    <footer
      ref={barRef}
      className={`s2-status ${align ? 'is-under-chat' : 'is-left'}`}
      role="status"
      aria-label="Status"
      data-testid="s2-status"
      data-align={align ? 'chat' : 'left'}
      style={align ? { marginLeft: align.left, width: align.width } : undefined}
    >
      {items.map((it, i) => (
        <Fragment key={it.key}>
          {i > 0 ? <span className="s2-vb" aria-hidden="true" /> : null}
          <span className="s2-sb-x" title={it.title}>
            {it.node}
          </span>
        </Fragment>
      ))}
    </footer>
  );
}
