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
import { Fragment, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import { agentActivity, limitsText } from '../agents/agentActivity';
import { activeAgentModel, resolvedModel } from '../agents/activeModel';
import { agentRuns } from '../agents/agentRuns';
import { ContextRing, formatContextWindowTokens, resolveContextRingUsed } from '../chat/ContextRing';
import { tidyModelName } from '../chat/modelNickname';
import { modelLabel } from '../chat/modelSelection';
import { composerPropsFrom, groundedRepoName, groundedRepoRoot, useAppState, useStore } from '../state/connect';
import type { Turn } from '../state/types';
import { branchLabel } from '../worktree/worktreeGroups';
import { ProviderIcon, modelGroupOf, providerLabel, providerOf, type ProviderKey } from './brandIcons';
import { S2Icon } from './icons';
import { liveWorktree } from './sessionGroups';
import { markCut } from './softEdge';

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

export function StatusBar({ align = null }: { align?: StatusBarAlign } = {}) {
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
  const runs = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const sessionId = state.session.activeId;
  const act = agentActivity(runs, sessionId);
  const mine = runs.runs.filter((r) => r.sessionId === sessionId);
  /* Only a live run can wait on anyone: a stopped one's open request is moot. */
  const live = mine.filter((r) => r.status === 'running');
  const waiting =
    live.some((r) => r.approvals.some((a) => a.decision === null)) ||
    mine.some((r) => (r.questions ?? []).some((q) => !q.settled));
  const working = state.session.inFlight !== null || mine.some((r) => r.status === 'running');
  const agentState: AgentState = waiting ? 'waiting' : working ? 'working' : 'idle';
  /* Who answers, by provider: Claude, OpenAI, Local, or the hosted gateway's own name (never "Sequence"
     for a hosted model). The same classifier as the composer chip and the picker, fed the same resolved
     model; with nothing connected there is no provider to name. */
  const sel = state.composer.model;
  const configured = sel.origin !== 'unconfigured' && sel.model !== '';
  const resolved = useSyncExternalStore(resolvedModel.subscribe, resolvedModel.get, resolvedModel.get);
  const identity = resolved && resolved.model === sel.model ? resolved : { model: sel.model, keyed: sel.origin === 'local' ? false : undefined, managed: sel.origin === 'default' };
  const group = configured ? modelGroupOf(identity) : null;
  const agentProvider: ProviderKey | null = act?.agentRef ? providerOf(act.agentRef) : null;
  const agentName: string | null = act?.agentRef
    ? agentProvider === 'other'
      ? act.agentRef.charAt(0).toUpperCase() + act.agentRef.slice(1)
      : providerLabel(agentProvider!)
    : (group?.label ?? null);
  const agentIcon: ProviderKey | null = act?.agentRef
    ? agentProvider === 'codex' ? 'openai' : agentProvider === 'other' || agentProvider === 'ollama' ? 'sequence' : agentProvider
    : (group?.icon ?? null);
  const doing = act?.doing ?? null;
  const stateWord = agentState === 'waiting' ? 'Waiting on you' : agentState === 'working' ? (doing ?? 'Working') : 'Idle';

  const label = modelLabel(state.composer.model);
  /* No model is a fact the composer's pill already offers to fix; the bar names models only.
     An agent's model is the one it said it runs on (round 7, A3), "<Agent> default" until then. */
  const agentModel = act?.agentRef ? activeAgentModel(runs, act.agentRef, sessionId) : null;
  /* A real model name where the agent gave one (a "default" entry resolves through its description, activeModel.ts);
     only when nothing resolves the bar says "Default model": never "<Agent> default". */
  const modelRaw = agentModel ? (agentModel.source === 'unknown' || /^default\b/i.test(agentModel.label) ? 'Default model' : agentModel.label) : resolved && resolved.model === sel.model && configured ? resolved.label : label && !/^connect/i.test(label) ? label : null;
  /* The model's short name ("Sonnet 5.5"), never the wire id. */
  const model = modelRaw ? tidyModelName(modelRaw) : null;

  const composer = composerPropsFrom(state, store);
  /* An agent answers this chat: the meter is that agent's, in this chat. Until it has reported, it is empty;
     the Sequence model's window and counts (and the agent the chat left) are not its context. */
  const used = act?.usage ? act.usage.used : act ? null : resolveContextRingUsed(state.session.inFlight?.usage ?? null, composer.contextUsed ?? null);
  const windowTok = act?.usage ? act.usage.size : act ? null : composer.contextWindow;
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
          {agentState === 'working' ? <AsciiSpinner /> : <span className={`s2-sb-dot is-${agentState}`} aria-hidden="true" />}
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
  ];

  /* A name changes (a model, a branch, the state word) without the bar's own box moving, but not on every streamed
     delta: mark and fit again only when one of the names does (the ResizeObserver above covers the box). */
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
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
