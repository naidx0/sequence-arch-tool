/* ══════════════════════════════════════════════════════════════════════════
   THE AGENTS PANEL — roster, tree, timeline: three views of one model
   packages/web2/src/agents/AgentsPanel.tsx

   The roster lists every agent and sub-agent (status dot, current tool,
   elapsed). Below it the SAME AgentNode tree is drawn two ways, the Langfuse /
   LangGraph Studio shape: a collapsible tree and a swimlane timeline (a row per
   agent, its tool calls as bars by kind). Selecting a step in either focuses
   it in the store, and the board overlay holds that step's files lit.

   Mount: `<AgentsPanel />` anywhere the shell opens a panel. It needs no
   props; it subscribes to the page's one agent stream.
   ══════════════════════════════════════════════════════════════════════════ */

import { cutLeft, readableToolTitle } from '../chat/commandLabel';
import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import './agents.css';
import { agentStore, agentsOf, callsOf, childrenOf, currentCall, formatElapsed, type AgentStore, type AgentStreamState } from './agentStream.js';
import { describeStep, formatTokens, rollup, stallOf, sumUsage, usageText, type Stall } from './agentSteps.js';
import { agentRuns, type AgentRun } from './agentRuns';
import type { AgentNode } from './agentTypes.js';
import { useActiveSessionIdIfAny, useSessionsIfAny } from '../state/connect';
import { branchLabel, type SessionLike } from '../worktree/worktreeGroups';
import { chatIconFor } from '../chat/chatIcon';

function useAgentState(store: AgentStore): AgentStreamState {
  /*
   * ONE SUBSCRIPTION FOR THE LIFE OF THE PANEL (round 7, A7 follow-up).
   * This was an arrow written inline, so a new subscribe function every render,
   * and useSyncExternalStore resubscribes whenever that identity changes. The
   * store closes its EventSource when its last listener leaves and opens a new
   * one on the next subscribe, and each open emits, which re-rendered, which
   * closed and reopened again: measured in the built app, hundreds of GET
   * /api/agent-events in 3 s, and hook events lost when a source closed
   * before its replay arrived (the empty dock in r7-agents-7).
   */
  const subscribe = useCallback((cb: () => void) => store.subscribe(() => cb()), [store]);
  return useSyncExternalStore(subscribe, store.get, store.get);
}

/** Re-render once a second while anything runs, so elapsed times move. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return active ? now : Date.now();
}

/* UX audit: a tool row is the command the agent ran, not its shell launcher
   ("Run "C:\WINDOWS\System32\WindowsPowerShell\..." -Command ..."), cut
   from the left when long; the whole title stays in the row's title. */
const shown = (n: AgentNode): string => (n.kind === 'tool_call' ? cutLeft(readableToolTitle(n.title, n.toolKind ?? null), 72) : n.title);

const STATUS_WORD: Record<AgentNode['status'], string> = { pending: 'queued', running: 'running', completed: 'done', failed: 'failed' };
const elapsedOf = (n: AgentNode, now: number): number => (n.endedAt ?? now) - n.startedAt;

export function AgentRoster({ state, now, sessions = [] }: { state: AgentStreamState; now: number; sessions?: readonly ChatLike[] }): JSX.Element {
  /* Round 9 (ask 28): the roster is the main agent. Sub-agents are counted
     here and nested, collapsed, inside the turn that started them. */
  const all = agentsOf(state.nodes);
  const main = all.filter((a) => a.kind !== 'subagent');
  const subs = all.length - main.length;
  /* Round 10: with runs from several chats, each main-agent row carries its
     chat's title, so the rows can be told apart; an untitled chat is named
     "New chat, HH:MM" by the same fallback as the tree. One chat keeps
     "Main agent". */
  const roots = childrenOf(state.nodes, null);
  const severalChats = new Set(roots.map((r) => r.sessionId)).size > 1;
  return (
    <ul className="ag-roster" data-testid="agents-roster">
      {main.map((a) => {
        const call = currentCall(state.nodes, a);
        const stall = [...state.nodes.values()].filter((n) => n.rootId === a.id && (n.kind === 'turn' || n.kind === 'tool_call')).map((t) => stallOf(state.nodes, t, now)).find((x) => x !== null) ?? null;
        const name = severalChats ? chatTitleOf(a.sessionId, roots, sessions) : 'Main agent';
        return (
          <li key={a.id} className="ag-row" data-status={a.status} data-flag={stall ? 'stalled' : undefined} data-testid="agents-roster-row">
            <span className="ag-dot" aria-label={stall ? 'stalled' : STATUS_WORD[a.status]} />
            <span className="ag-name" title={name}>{name}</span>
            <span className="ag-tool">{stall ? 'stalled' : call ? (call.toolKind ?? call.title) : STATUS_WORD[a.status]}</span>
            <span className="ag-elapsed">{formatElapsed(elapsedOf(a, now))}</span>
          </li>
        );
      })}
      {subs > 0 ? (
        <li className="ag-subnote" data-testid="agents-subnote">
          {subs === 1 ? '1 sub-agent, nested in its turn' : `${subs} sub-agents, nested in their turns`}
        </li>
      ) : null}
    </ul>
  );
}

const metaOf = (parts: (string | null | false | undefined)[]): string => parts.filter(Boolean).join(', ');

/** What a row says under its sentence: the failure, the stall, else what the step printed. */
function whyOf(node: AgentNode, stall: Stall | null, summary: { steps: number; failed: number; running: number } | null): { kind: 'error' | 'stalled' | 'result'; text: string } | null {
  if (stall) return { kind: 'stalled', text: stall.text };
  if (node.status === 'failed') {
    if (node.error) return { kind: 'error', text: node.error };
    if (summary && summary.failed) return { kind: 'error', text: summary.failed === 1 ? '1 step failed' : `${summary.failed} steps failed` };
    return { kind: 'error', text: node.kind === 'tool_call' ? 'Failed, and the agent gave no reason' : 'Ended with an error' };
  }
  if (summary && summary.failed) return { kind: 'error', text: summary.failed === 1 ? '1 step failed inside' : `${summary.failed} steps failed inside` };
  if (node.kind === 'tool_call' && node.result) return { kind: 'result', text: node.result };
  return null;
}

function TreeItem({ node, state, now, store, isOpen, toggle }: { node: AgentNode; state: AgentStreamState; now: number; store: AgentStore; isOpen: (n: AgentNode) => boolean; toggle: (id: string) => void }): JSX.Element {
  const kids = childrenOf(state.nodes, node.id);
  const expanded = kids.length > 0 && isOpen(node);
  const stall = stallOf(state.nodes, node, now);
  const grouped = node.kind === 'turn' || node.kind === 'subagent';
  const summary = grouped ? rollup(state.nodes, node.id) : null;
  const why = whyOf(node, stall, summary);
  const flag = stall ? 'stalled' : node.status === 'failed' || (summary && summary.failed > 0) ? 'failed' : undefined;
  const word = stall ? 'stalled' : STATUS_WORD[node.status];
  return (
    <li role="treeitem" aria-expanded={kids.length ? expanded : undefined} data-kind={node.kind}>
      <button
        type="button"
        className="ag-node"
        data-status={node.status}
        data-flag={flag}
        data-testid="agents-tree-node"
        aria-current={state.focusId === node.id ? 'true' : undefined}
        onClick={() => {
          if (node.kind === 'tool_call') store.focus(state.focusId === node.id ? null : node.id);
          else if (kids.length) toggle(node.id);
        }}
      >
        <span className="ag-caret" aria-hidden="true">{kids.length ? (expanded ? '▾' : '▸') : ''}</span>
        <span className="ag-dot" aria-label={word} />
        <span className={`ag-name${node.kind === 'tool_call' && splitPathLabel(describeStep(node)) ? ' is-path' : ''}`} title={node.kind === 'session' ? undefined : node.title}>
          {node.kind === 'session' ? 'Main agent' : node.kind === 'tool_call' ? <NameText text={describeStep(node)} /> : node.kind === 'subagent' ? `Sub-agent: ${node.title}` : node.title}
        </span>
        <span className="ag-elapsed">
          {metaOf([
            summary && `${summary.steps} ${summary.steps === 1 ? 'step' : 'steps'}`,
            formatElapsed(elapsedOf(node, now)),
            node.kind !== 'turn' && node.tokens !== undefined ? `${formatTokens(node.tokens)} tok` : null,
          ])}
        </span>
        {node.kind === 'turn' && node.usage ? (
          <span className="ag-tokens" data-testid="agents-turn-tokens">
            {usageText(node.usage)}
          </span>
        ) : null}
        {why ? (
          <span className="ag-why" data-why={why.kind} data-testid="agents-why">
            {why.text}
          </span>
        ) : null}
      </button>
      {expanded && (
        <ul role="group">
          {kids.map((k) => (
            <TreeItem key={k.id} node={k} state={state} now={now} store={store} isOpen={isOpen} toggle={toggle} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A chat as the tree needs it: the worktree-grouping fields plus what names it. */
export type ChatLike = SessionLike & { title?: string | null; titleEdited?: boolean; agentThreads?: Record<string, unknown>; model?: string | null };

const ID_DERIVED_TITLE = /^session[ -]\d+[\w-]*$/i;
function chatTitle(c: ChatLike | undefined, fallback: string): string {
  const written = c?.title?.trim();
  if (!written || (!c?.titleEdited && ID_DERIVED_TITLE.test(written))) return fallback;
  return written;
}

/** HH:MM of a chat's first event, for telling untitled chats apart. */
function clockOf(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * A chat's title as the panel shows it: its written title, else the fallback.
 * The fallback is the chat's own session title when the engine gave one (a
 * session node's default title is "Session <id>", which is not a title), else
 * "New chat" plus the chat's start time, so two untitled chats stay apart.
 * Turn nodes carry only "Turn n", so the session node is the one to read.
 */
function chatTitleOf(sid: string, roots: readonly AgentNode[], sessions: readonly ChatLike[], fallback?: string): string {
  const first = roots.find((r) => r.sessionId === sid);
  const engineTitle = first && first.title !== `Session ${sid.slice(0, 8)}` ? first.title : null;
  const untitled = first ? `New chat, ${clockOf(first.startedAt)}` : 'New chat';
  return chatTitle(sessions.find((c) => c.id === sid), fallback ?? engineTitle ?? untitled);
}

export function AgentTree({ state, now, store, sessions = [], activeSessionId = null, agents }: { state: AgentStreamState; now: number; store: AgentStore; sessions?: readonly ChatLike[]; activeSessionId?: string | null; agents?: Readonly<Record<string, string>> }): JSX.Element {
  /* Round 9 (ask 28): the main agent's latest turn is open, sub-agents start
     collapsed (their failures still show on the collapsed row), older turns
     fold up unless they failed. `flipped` holds what the person toggled. */
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  /* Round 10: which chats the reader folded. Every chat starts open, so a
     failure in one is never hidden by default. */
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
  const toggleChat = (id: string): void =>
    setFolded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggle = (id: string): void =>
    setFlipped((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const latestTurn = useMemo(() => {
    const by = new Map<string, string>();
    for (const n of state.nodes.values()) {
      if (n.kind !== 'turn') continue;
      const have = by.get(n.sessionId);
      if (!have || (state.nodes.get(have)?.startedAt ?? 0) <= n.startedAt) by.set(n.sessionId, n.id);
    }
    return new Set(by.values());
  }, [state.nodes]);
  const isOpen = (n: AgentNode): boolean => {
    const byDefault = n.kind === 'session' ? true : n.kind === 'turn' ? latestTurn.has(n.id) || n.status === 'failed' : false;
    return byDefault !== flipped.has(n.id);
  };
  /* ONE SESSION, NO SESSION ROW. The roster above already names the main
     agent; a tree that opens on a second "Main agent" row repeats it and
     spends an indent on nothing. With several sessions the rows stay, named
     by the session's own title, so they can be told apart. */
  const roots = childrenOf(state.nodes, null);
  /* ROUND 10 (Jaden: "hard to track across several chats"): with runs from more
     than one chat, group by CHAT first. Each chat gets a sticky header (its
     brand icon, its title, its branch when it works in a worktree, and its run
     count and state), the open chat first and marked, the others foldable.
     One chat draws as it always has. (S7's worktree grouping is carried by the
     header's branch label: a chat is bound to one worktree.) */
  const chatIds = [...new Set(roots.map((r) => r.sessionId))];
  if (chatIds.length > 1) {
    const ordered = [...chatIds].sort((x, y) => Number(y === activeSessionId) - Number(x === activeSessionId));
    return (
      <ul className="ag-tree ag-chats" role="tree" aria-label="Agent steps" data-testid="agents-tree">
        {ordered.map((sid) => {
          const chat = sessions.find((c) => c.id === sid);
          const rootsOf = roots.filter((r) => r.sessionId === sid);
          const title = chatTitleOf(sid, roots, sessions);
          const mine = [...state.nodes.values()].filter((n) => n.sessionId === sid);
          const runCount = mine.filter((n) => n.kind === 'turn').length || rootsOf.length;
          const runningN = mine.filter((n) => n.status === 'running').length;
          const failedN = mine.filter((n) => n.status === 'failed').length;
          const tone = runningN > 0 ? 'running' : failedN > 0 ? 'failed' : 'done';
          const stateWord = runningN > 0 ? 'running' : failedN > 0 ? `${failedN} failed` : 'idle';
          const active = sid === activeSessionId;
          const open = !folded.has(sid);
          const wt = chat?.worktree ?? null;
          const runs = rootsOf.flatMap((r) => childrenOf(state.nodes, r.id));
          return (
            <li key={sid} role="group" aria-label={title} className="ag-chat" data-active={active ? 'true' : undefined} data-open={open ? 'true' : 'false'} data-testid="agents-chat-group">
              <button type="button" className="ag-chat-head" aria-expanded={open} data-testid="agents-chat-head" onClick={() => toggleChat(sid)}>
                <span className="ag-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
                <span className="ag-chat-ic">{chatIconFor({ id: sid, agentThreads: chat?.agentThreads, model: chat?.model ?? null }, { agents })}</span>
                <span className="ag-chat-title" title={title}>{title}</span>
                {active ? <span className="ag-chat-open" data-testid="agents-chat-active">Open chat</span> : null}
                {wt ? <span className="ag-chat-branch" title={wt.branch}>{branchLabel(wt.branch)}{wt.merged ? ' (merged)' : ''}</span> : null}
                <span className="ag-chat-meta" data-tone={tone} data-testid="agents-chat-meta">
                  <span className="ag-chat-dot" aria-hidden="true" />
                  {runCount === 1 ? '1 run' : `${runCount} runs`}, {stateWord}
                </span>
              </button>
              {open ? (
                <ul role="group">
                  {runs.map((node) => (
                    <TreeItem key={node.id} node={node} state={state} now={now} store={store} isOpen={isOpen} toggle={toggle} />
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }
  const top = roots.length === 1 ? childrenOf(state.nodes, roots[0].id) : roots;
  return (
    <ul className="ag-tree" role="tree" aria-label="Agent steps" data-testid="agents-tree">
      {top.map((node) => (
        <TreeItem key={node.id} node={node} state={state} now={now} store={store} isOpen={isOpen} toggle={toggle} />
      ))}
    </ul>
  );
}

/**
 * Round 9 (ask 30): TOKENS PER TURN AND FOR THE SESSION. Read from the chat's
 * runs, which the server saves with the chat, so the numbers are still here
 * after a relaunch. A turn the agent gave no usage for is left out, and a
 * session with none shows nothing: no estimates.
 */
export function UsageStrip({ runs }: { runs: readonly AgentRun[] }): JSX.Element | null {
  const rows = runs.filter((r) => r.turnUsage);
  if (!rows.length) return null;
  const total = sumUsage(rows.map((r) => r.turnUsage));
  if (!total) return null;
  return (
    <section className="ag-usage" data-testid="agents-usage" aria-label="Token usage">
      <p className="ag-usage-total" data-testid="agents-usage-total">
        <span className="ag-usage-label">Session total</span>
        <span className="ag-usage-num">{usageText(total)}</span>
      </p>
      <ol className="ag-usage-turns" data-testid="agents-usage-turns">
        {rows.map((r, i) => (
          <li key={r.id} data-testid="agents-usage-turn">
            <span className="ag-usage-label" title={r.prompt}>{`Turn ${i + 1}`}</span>
            <span className="ag-usage-num">{usageText(r.turnUsage!)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Tick spacing for a span: the smallest round step that keeps six ticks or fewer. */
const TICK_STEPS = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];

export function axisTicks(spanMs: number, maxTicks = 6): number[] {
  const span = Math.max(1, spanMs);
  const step = TICK_STEPS.find((s) => span / s <= maxTicks - 1) ?? Math.ceil(span / (maxTicks - 1));
  const out: number[] = [];
  for (let t = 0; t <= span + 1e-9; t += step) out.push(t);
  return out;
}

/** "0s", "1.5s", "2m", "1m 30s": a tick label, as short as the step allows. */
export function tickLabel(ms: number): string {
  if (ms === 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Number((ms / 1000).toFixed(1))}s`;
  const m = Math.floor(ms / 60000);
  if (m >= 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
  const s = Math.round((ms % 60000) / 1000);
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** How deep an agent sits under the main agent (0 for the main agent). */
function depthOf(nodes: ReadonlyMap<string, AgentNode>, n: AgentNode): number {
  let d = 0;
  let cur: AgentNode | undefined = n;
  const seen = new Set<string>();
  while (cur && cur.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = nodes.get(cur.parentId);
    if (cur?.kind === 'subagent') d += 1;
  }
  return n.kind === 'subagent' ? d + 1 : 0;
}

export function AgentTimeline({ state, now, store }: { state: AgentStreamState; now: number; store: AgentStore }): JSX.Element {
  const agents = agentsOf(state.nodes);
  const lanes = agents.map((a) => ({ agent: a, calls: callsOf(state.nodes, a) }));
  const all = lanes.flatMap((l) => l.calls);
  const t0 = Math.min(...agents.map((a) => a.startedAt), ...all.map((c) => c.startedAt));
  const t1 = Math.max(t0 + 1, ...all.map((c) => c.endedAt ?? now), ...agents.map((a) => a.endedAt ?? now));
  const pct = (t: number): number => ((t - t0) / (t1 - t0)) * 100;
  const ticks = axisTicks(t1 - t0);
  /* The bar under the pointer (or keyboard focus) shows its label. */
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div data-testid="agents-timeline">
      <div className="ag-lanes" role="list" aria-label="Agent timeline">
        <span className="ag-axis-name" aria-hidden="true" />
        <div className="ag-axis" data-testid="agents-axis" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="ag-tick" data-testid="agents-tick" style={{ left: `${(t / (t1 - t0)) * 100}%` }}>
              {tickLabel(t)}
            </span>
          ))}
        </div>
        {lanes.map(({ agent, calls }) => (
          <div key={agent.id} role="listitem" style={{ display: 'contents' }}>
            <span
              className="ag-lane-name"
              data-testid="agents-lane-name"
              style={{ paddingLeft: `${depthOf(state.nodes, agent) * 8}px` }}
              title={agent.kind === 'subagent' ? agent.title : 'Main agent'}
            >
              {agent.kind === 'subagent' ? agent.title : 'Main agent'}
            </span>
            <div className="ag-lane" data-testid="agents-lane">
              {ticks.map((t) => (
                <span key={t} className="ag-gridline" aria-hidden="true" style={{ left: `${(t / (t1 - t0)) * 100}%` }} />
              ))}
              {calls.map((c) => {
                const left = pct(c.startedAt);
                const width = Math.max(0, pct(c.endedAt ?? now) - left);
                const label = `${c.toolKind ?? shown(c)}, ${formatElapsed(elapsedOf(c, now))}`;
                return (
                  <Fragment key={c.id}>
                    <button
                      type="button"
                      className="ag-bar"
                      data-testid="agents-bar"
                      data-step={c.stepKind ?? 'other'}
                      data-status={c.status}
                      aria-current={state.focusId === c.id ? 'true' : undefined}
                      aria-label={`${c.title}, ${formatElapsed(elapsedOf(c, now))}${c.tokens !== undefined ? `, ${c.tokens} tokens` : ''}, ${STATUS_WORD[c.status]}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      onMouseEnter={() => setHover(c.id)}
                      onMouseLeave={() => setHover((h) => (h === c.id ? null : h))}
                      onFocus={() => setHover(c.id)}
                      onBlur={() => setHover((h) => (h === c.id ? null : h))}
                      onClick={() => store.focus(state.focusId === c.id ? null : c.id)}
                    />
                    {hover === c.id ? (
                      <span
                        className="ag-tip"
                        role="tooltip"
                        data-testid="agents-bar-label"
                        data-side={left > 60 ? 'left' : 'right'}
                        style={left > 60 ? { right: `${100 - left}%` } : { left: `${left}%` }}
                      >
                        {label}
                        <span className="ag-tip-sub">{shown(c)}</span>
                      </span>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="ag-legend" aria-hidden="true">
        <span><span className="ag-bar" data-step="edit" />edit</span>
        <span><span className="ag-bar" data-step="read" />read / search</span>
        <span><span className="ag-bar" data-step="execute" />run</span>
        <span><span className="ag-bar" data-step="other" />other</span>
      </div>
    </div>
  );
}

export type AgentView = 'tree' | 'timeline';

/** A step label that ends in a path ("Edited a/b/c.ts"): the folders in front, and the file name, which tells two rows apart. */
export function splitPathLabel(text: string): { head: string; tail: string } | null {
  const i = Math.max(text.lastIndexOf('/'), text.lastIndexOf(String.fromCharCode(92)));
  /* Only a label that ends in a path splits: "Ran git log origin/main --oneline" ends in arguments, not a file. */
  if (i < 0 || i === text.length - 1 || /\s/.test(text.slice(i + 1))) return null;
  return { head: text.slice(0, i + 1), tail: text.slice(i + 1) };
}

/* 0.1.8: a long path is cut in the MIDDLE (the folders give way, the file name stays), the full text on the title. */
function NameText({ text }: { text: string }) {
  const p = splitPathLabel(text);
  if (!p) return <>{text}</>;
  return (
    <>
      <span className="ag-name-head">{p.head}</span>
      <span className="ag-name-tail">{p.tail}</span>
    </>
  );
}

/** S2b: the empty panel's one action, loaded only while the panel is empty (startWithHooks.tsx). */
const StartWithHooks = lazy(() => import('./startWithHooks'));

export function AgentsPanel({
  store = agentStore,
  initialView = 'tree',
  onClose,
}: {
  store?: AgentStore;
  initialView?: AgentView;
  /** Round 7: the dock's close (x), drawn in the header when given. */
  onClose?: () => void;
}): JSX.Element {
  const state = useAgentState(store);
  /* S7: the chats, for grouping agents by the worktree their chat works in. */
  const chatSessions = useSessionsIfAny();
  /* Round 9 (ask 30): the open chat's saved runs, for the token strip. */
  const activeChat = useActiveSessionIdIfAny();
  const runsState = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const chatRuns = useMemo(() => (activeChat ? runsState.runs.filter((r) => r.sessionId === activeChat) : []), [runsState.runs, activeChat]);
  const [view, setView] = useState<AgentView>(initialView);
  const running = useMemo(() => [...state.nodes.values()].some((n) => n.status === 'running'), [state.nodes]);
  const now = useNow(running);
  const focused = state.focusId ? state.nodes.get(state.focusId) : undefined;
  const empty = state.nodes.size === 0;
  return (
    <section className="ag-scope" data-testid="agents-panel" aria-label="Agents">
      <header className="ag-head" data-testid="agents-head">
        <h2 className="ag-title">Agents</h2>
        <span className="ag-conn" data-live={state.connected ? 'true' : 'false'} title={state.connected ? 'Receiving agent activity' : 'Not connected to agent activity'}>
          <span className="ag-conn-dot" aria-hidden="true" />
          {state.connected ? 'Live' : 'Offline'}
        </span>
        <span className="ag-grow" />
        <div className="ag-seg" role="tablist" aria-label="Agent view">
          {(['tree', 'timeline'] as const).map((v) => (
            <button key={v} type="button" role="tab" className="ag-seg-btn" data-testid={`agents-view-${v}`} aria-selected={view === v} onClick={() => setView(v)}>
              {v === 'tree' ? 'Tree' : 'Timeline'}
            </button>
          ))}
        </div>
        {onClose ? (
          <button type="button" className="ag-close" aria-label="Close Agents" title="Close (Esc)" data-testid="agents-close" onClick={onClose}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        ) : null}
      </header>
      <UsageStrip runs={chatRuns} />
      {empty ? (
        <Suspense fallback={null}>
          <StartWithHooks />
        </Suspense>
      ) : (
        <>
          <AgentRoster state={state} now={now} sessions={chatSessions as readonly ChatLike[]} />
          <div className="ag-body" data-testid="agents-body">{view === 'tree' ? <AgentTree state={state} now={now} store={store} sessions={chatSessions as readonly ChatLike[]} activeSessionId={activeChat} agents={runsState.agents} /> : <AgentTimeline state={state} now={now} store={store} />}</div>
          {focused && (
            <p className="ag-detail" data-testid="agents-detail">
              {shown(focused)}, {STATUS_WORD[focused.status]}, {formatElapsed(elapsedOf(focused, now))}
              {focused.tokens !== undefined ? `, ${focused.tokens} tokens` : ''}
              {focused.error ? `; ${focused.error}` : focused.result ? `; ${focused.result}` : ''}
              {focused.locations.length ? `; ${focused.locations.map((l) => (l.serviceLabel ? `${l.path} (${l.serviceLabel})` : l.path)).join(', ')}` : ''}
            </p>
          )}
        </>
      )}
    </section>
  );
}
