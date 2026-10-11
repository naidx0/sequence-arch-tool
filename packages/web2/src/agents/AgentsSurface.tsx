/* ══════════════════════════════════════════════════════════════════════════
   THE AGENTS SURFACE (round 11)
   packages/web2/src/agents/AgentsSurface.tsx

   Jaden 10-08: "agent traces can pop up as a surface: your agent workflow,
   subagents running, the trees, timelines, tokens per session, tokens total,
   next to Terminal". Per chat: its runs and the subagents they started (a
   tree), or a timeline of the same on one clock. Tokens are the ones the
   agents reported; where none were, the cell says "—". The Agents popup
   (AgentsDock) stays as it was.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { formatElapsed } from '../chat/workRowModel';
import { AsciiSpinner } from '../shell2/AsciiSpinner';
import { useSessionsIfAny } from '../state/connect';
import { agentRuns } from './agentRuns';
import { subscribeAgentsViewRequest, takeAgentsViewRequest, type AgentsSurfaceView } from './agentsSection';
import { buildAgentsOverview, knownStart, spanMs, type OverviewChat, type OverviewStatus } from './agentsOverview';
import { formatTokens } from './agentSteps';

import './agentsSurface.css';

export type { AgentsSurfaceView };

/* Workflows are the program runs (the old Activity overlay): its list, its detail and its start form, in this surface. */
function EmbeddedActivity() {
  const [Connected, setConnected] = useState<null | (typeof import('../activity/ConnectedActivity'))['ConnectedActivity']>(null);
  useEffect(() => {
    let live = true;
    void import('../activity/ConnectedActivity').then((m) => live && setConnected(() => m.ConnectedActivity));
    return () => {
      live = false;
    };
  }, []);
  return Connected ? <Connected embedded /> : null;
}

/* The tab glyphs (round 13): the tree is Octicons' list-tree shape (a parent row with indented children), redrawn in this app's
   16 grid and 1.5 stroke; Workflows is the architecture board's glyph turned upside down (one box over two). */
function TabGlyph({ view }: { view: AgentsSurfaceView }) {
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', focusable: false, 'aria-hidden': true, className: 'ags-seg-ico' } as const;
  if (view === 'workflows') {
    return (
      <svg {...common}>
        <rect x="5.5" y="1.8" width="5" height="3.6" rx="1" />
        <rect x="1.5" y="10.6" width="5" height="3.6" rx="1" />
        <rect x="9.5" y="10.6" width="5" height="3.6" rx="1" />
        <path d="M8 5.4v2.6M4 10.6V8h8v2.6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M2 3.2h5M3.5 3.2v9.6M3.5 8h2.8M3.5 12.8h2.8M8.6 8h5.4M8.6 12.8h5.4" />
    </svg>
  );
}

const TAB_WORD: Record<'tree' | 'workflows', string> = { tree: 'Tree', workflows: 'Workflows' };

const tok = (n: number | null): string => (n === null ? '—' : formatTokens(n));

/* A duration, or nothing at all when the start is unknown (a zero start must not read as 29 million minutes). */
function Time({ start, end, now }: { start: number | null | undefined; end: number | null | undefined; now: number }) {
  const ms = spanMs(start, end, now);
  return ms === null ? null : <span className="ags-meta ags-time">{formatElapsed(ms)}</span>;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return active ? now : Date.now();
}

function Mark({ status }: { status: OverviewStatus }) {
  return (
    <span className="ags-mark" data-state={status} aria-hidden="true">
      {status === 'running' ? <AsciiSpinner /> : null}
    </span>
  );
}

function Label({ text, status }: { text: string; status: OverviewStatus }) {
  return <span className={`ags-label${status === 'running' ? ' shimmer-text' : ''}`} title={text}>{text}</span>;
}

const clock = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* The timeline of one row, folded into the tree (round 13): where it sat on the chat's clock, when it started, how long it ran. */
function Detail({ start, end, from, to, now, status, extra }: { start: number; end: number | null; from: number; to: number; now: number; status: OverviewStatus; extra?: string }) {
  const known = knownStart(start);
  const span = Math.max(1, to - from);
  const a = known ? ((start - from) / span) * 100 : 0;
  const b = known ? (((end ?? now) - from) / span) * 100 : 0;
  const ms = spanMs(start, end, now);
  const line = `${known ? `Started ${clock(start)}` : 'Start time unknown'}${ms !== null ? `, ran ${formatElapsed(ms)}` : ''}${extra ? `, ${extra}` : ''}`;
  return (
    <div className="ags-detail" data-testid="agents-surface-detail">
      <div className="ags-track" aria-hidden="true">
        {known ? <span className="ags-bar" data-state={status} style={{ left: `${a}%`, width: `${Math.max(0.8, b - a)}%` }} /> : null}
      </div>
      <p className="ags-detail-t" title={line}>
        {line}
      </p>
    </div>
  );
}

function Twist({ open, onToggle, label }: { open: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className="ags-twist" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} timeline of ${label}`} title="Timeline" data-testid="agents-surface-twist" onClick={onToggle}>
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
    </button>
  );
}

function TreeView({ chats, now }: { chats: readonly OverviewChat[]; now: number }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const flip = (k: string) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (!n.delete(k)) n.add(k);
      return n;
    });
  return (
    <ul className="ags-tree" data-testid="agents-surface-tree">
      {chats.map((c) => {
        const from = knownStart(c.startedAt) ? c.startedAt : now;
        const to = c.endedAt ?? now;
        return (
          <li key={c.sessionId} className="ags-chat" data-testid="agents-surface-chat" data-state={c.status}>
            <div className="ags-row ags-row-chat">
              <Twist open={open.has(`c${c.sessionId}`)} onToggle={() => flip(`c${c.sessionId}`)} label={c.title} />
              <Mark status={c.status} />
              <Label text={c.title} status={c.status} />
              <span className="ags-meta" data-testid="agents-surface-chat-tokens" title={c.processed === null ? 'The agent reported no usage for this chat' : `Output tokens generated in this chat. Input processed across ${c.reported} turn${c.reported === 1 ? '' : 's'}: ${formatTokens(c.processed - (c.output ?? 0))} (every turn re-sends the context, mostly from cache)`}>{c.output === null ? '—' : `${tok(c.output)} out`}</span>
              <Time start={c.startedAt} end={c.endedAt} now={now} />
            </div>
            {open.has(`c${c.sessionId}`) ? <Detail start={c.startedAt} end={c.endedAt} from={from} to={to} now={now} status={c.status} extra={`${c.runs.length} turn${c.runs.length === 1 ? '' : 's'}`} /> : null}
            <ul className="ags-kids">
              {c.runs.map((r) => (
                <li key={r.id} data-testid="agents-surface-run" data-state={r.status}>
                  <div className="ags-row">
                    <Twist open={open.has(`r${r.id}`)} onToggle={() => flip(`r${r.id}`)} label={r.label} />
                    <Mark status={r.status} />
                    <Label text={r.label} status={r.status} />
                    <span className="ags-meta" title={r.context === null ? 'The agent reported no usage for this turn' : `Output tokens generated this turn. Context sent: ${formatTokens(r.context)}`}>{r.output === null ? '—' : `${tok(r.output)} out`}</span>
                    <Time start={r.startedAt} end={r.endedAt} now={now} />
                  </div>
                  {open.has(`r${r.id}`) ? <Detail start={r.startedAt} end={r.endedAt} from={from} to={to} now={now} status={r.status} extra={r.subagents.length ? `${r.subagents.length} subagent${r.subagents.length === 1 ? '' : 's'}` : undefined} /> : null}
                  {r.subagents.length ? (
                    <ul className="ags-kids">
                      {r.subagents.map((s) => (
                        <li key={s.toolId} data-testid="agents-surface-subagent" data-state={s.status}>
                          <div className="ags-row">
                            <Twist open={open.has(`s${s.toolId}`)} onToggle={() => flip(`s${s.toolId}`)} label={s.name} />
                            <Mark status={s.status} />
                            <Label text={s.name} status={s.status} />
                            {s.description ? <span className="ags-desc" title={s.description}>{s.description}</span> : null}
                            <span className="ags-meta">{s.steps} step{s.steps === 1 ? '' : 's'}</span>
                            <Time start={s.startedAt} end={s.endedAt} now={now} />
                          </div>
                          {open.has(`s${s.toolId}`) ? <Detail start={s.startedAt} end={s.endedAt} from={from} to={to} now={now} status={s.status} /> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

export function AgentsSurface({ initialView = 'tree' }: { initialView?: AgentsSurfaceView }) {
  const runsState = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const sessions = useSessionsIfAny();
  const fold = (v: AgentsSurfaceView): 'tree' | 'workflows' => (v === 'workflows' ? 'workflows' : 'tree');
  const [view, setView] = useState<'tree' | 'workflows'>(() => fold(takeAgentsViewRequest() ?? initialView));
  useEffect(
    () =>
      subscribeAgentsViewRequest(() => {
        const asked = takeAgentsViewRequest();
        if (asked) setView(fold(asked));
      }),
    [],
  );
  const running = runsState.runs.some((r) => r.status === 'running');
  const now = useNow(running);
  const overview = useMemo(
    () => buildAgentsOverview(runsState.runs, sessions.map((s) => ({ id: s.id, title: (s as { title?: string | null }).title ?? null })), now),
    [runsState.runs, sessions, now],
  );
  return (
    <section className="ags" data-testid="agents-surface" aria-label="Agents">
      <div className="ags-col" data-testid="agents-surface-col">
      <header className="ags-head">
        <h2 className="ags-title">Agents</h2>
        <p
          className="ags-total"
          data-testid="agents-surface-total"
          title={
            overview.totalProcessed === null
              ? 'Usage: the agents reported none yet'
              : `Context: size of the newest turn's input, cache included. Output: tokens generated across every chat. Input processed across ${overview.reportedTurns} turn${overview.reportedTurns === 1 ? '' : 's'}: ${formatTokens(overview.totalProcessed - (overview.totalOutput ?? 0))} (every turn re-sends the whole context, mostly from cache, so this is not a count of new work)`
          }
        >
          <span>Context</span>
          <span className="ags-total-num" data-testid="agents-surface-context">{tok(overview.context)}</span>
          <span>Output</span>
          <span className="ags-total-num" data-testid="agents-surface-output">{tok(overview.totalOutput)}</span>
        </p>
        <div className="ags-seg" role="tablist" aria-label="Agents view">
          {(['tree', 'workflows'] as const).map((v) => (
            <button key={v} type="button" role="tab" className="ags-seg-btn" aria-selected={view === v} aria-label={TAB_WORD[v]} title={TAB_WORD[v]} data-testid={`agents-surface-tab-${v}`} onClick={() => setView(v)}>
              <TabGlyph view={v} />
              <span className="ags-seg-t">{TAB_WORD[v]}</span>
            </button>
          ))}
        </div>
      </header>
      {view === 'workflows' ? (
        <div className="ags-workflows" data-testid="agents-surface-workflows">
          <EmbeddedActivity />
        </div>
      ) : overview.chats.length === 0 ? (
        <p className="ags-empty" data-testid="agents-surface-empty">No agent has run yet. Ask one in the chat and its runs and subagents appear here.</p>
      ) : (
        <TreeView chats={overview.chats} now={now} />
      )}
      </div>
    </section>
  );
}

export default AgentsSurface;
