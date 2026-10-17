/* ══════════════════════════════════════════════════════════════════════════
   WHAT THE AGENT IS DOING, AND FOR HOW LONG — NEVER A SILENT STALL (round 9)
   packages/web2/src/chat/RunLiveStatus.tsx

   Jaden: "The spinner stops, with no error, no retry and no reason ...
   always show what happened." The server sends the turn's status every few
   seconds (acp:status); this draws it under the run, counting the seconds
   between reports:

     Queued: waiting for Claude to finish the last turn, 8s
     Waiting for Claude, 3s          Thinking, 12s
     Running Bash: pnpm test, 41s    Waiting for your answer
     Claude has been quiet for 45s (warning tone)

   An answered run whose bridge still holds the turn says so once, quietly.
   The turn's log (no words) opens from "Turn details".
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useState } from 'react';

import type { AgentRun } from '../agents/agentRuns';
import { ChatStatus, type ChatStatusKind } from './ChatStatus';
import { vendorOf } from './RecoveryCard';

import './runLive.css';

function secs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

const TOOL_WORD: Record<string, string> = {
  read: 'Reading',
  edit: 'Editing',
  delete: 'Deleting',
  move: 'Moving',
  search: 'Searching',
  execute: 'Running',
  fetch: 'Fetching',
  think: 'Thinking',
};

export interface LivePhrase {
  text: string;
  tone: 'calm' | 'warn' | 'quiet';
  /** The state the line is in, for the spinner and the glimmer (ChatStatus). */
  kind: ChatStatusKind;
}

/** The live line for a run, or null when there is nothing to say. Pure. */
export function livePhrase(run: AgentRun, now: number): LivePhrase | null {
  const who = vendorOf(run);
  if (run.status === 'done' && run.answered && run.turn !== 'ended' && run.turn !== 'settled' && (run.live?.openTools ?? 0) > 0) {
    return { text: `Answered. ${who} is finishing background work`, tone: 'quiet', kind: 'waiting' };
  }
  if (run.status !== 'running') return null;
  const live = run.live;
  if (!live) return run.queued ? { text: `Queued: waiting for ${who} to finish the last turn`, tone: 'calm', kind: 'queued' } : null;
  const span = secs(live.forMs + Math.max(0, now - live.at));
  switch (live.phase) {
    case 'queued':
      return { text: `Queued: waiting for ${who} to finish the last turn, ${span}`, tone: 'calm', kind: 'queued' };
    case 'starting':
      return { text: `Starting ${who}, ${span}`, tone: 'calm', kind: 'waiting' };
    case 'waiting':
      return { text: `Waiting for ${who}, ${span}`, tone: 'calm', kind: 'waiting' };
    case 'thinking':
      return { text: `Thinking, ${span}`, tone: 'calm', kind: 'thinking' };
    case 'writing':
      return { text: `Writing, ${span}`, tone: 'calm', kind: 'thinking' };
    case 'tool': {
      const verb = TOOL_WORD[live.tool?.kind ?? ''] ?? 'Using a tool';
      const what = live.tool?.title ? `: ${live.tool.title}` : '';
      return { text: `${verb}${what}, ${span}`, tone: 'calm', kind: 'tool' };
    }
    case 'approval':
      return { text: 'Waiting for your answer', tone: 'calm', kind: 'waiting' };
    case 'quiet':
      return { text: `${who} has been quiet for ${span}. Stop frees the chat`, tone: 'warn', kind: 'stalled' };
    default:
      return null;
  }
}

function TurnDetails({ run }: { run: AgentRun }) {
  const log = run.log;
  if (!log) return null;
  const entries = (log.entries ?? []).slice(-24);
  return (
    <details className="runlive-log" data-testid="agent-run-log">
      <summary>
        Turn details: {log.outcome ?? 'ended'}
        {typeof log.ms === 'number' ? `, ${secs(log.ms)}` : ''}
        {log.tools ? `, ${log.tools} tool${log.tools === 1 ? '' : 's'}` : ''}
      </summary>
      <ol>
        {entries.map((e, i) => (
          <li key={i}>
            <span className="runlive-t">+{(e.t / 1000).toFixed(1)}s</span> {e.ev}
            {Object.entries(e)
              .filter(([k]) => k !== 't' && k !== 'ev')
              .map(([k, v]) => ` ${k}=${String(v)}`)
              .join('')}
          </li>
        ))}
      </ol>
      {log.error ? <p className="runlive-err">{log.error}</p> : null}
    </details>
  );
}

/** Re-render every half second while the run is live, so the seconds count between reports. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return active ? now : Date.now();
}

export function RunLiveStatus({ run, now: fixed, quietHidden = false }: { run: AgentRun; now?: number; quietHidden?: boolean }) {
  const ticking = useNow(fixed === undefined && run.status === 'running');
  const line = quietHidden && run.live?.phase === 'quiet' ? null : livePhrase(run, fixed ?? ticking);
  return (
    <>
      {line ? (
        <ChatStatus
          testId="agent-run-live"
          phase={run.live?.phase ?? (run.queued ? 'queued' : '')}
          tone={line.tone}
          status={{ kind: line.kind, label: line.text }}
        />
      ) : null}
      {run.status !== 'running' ? <TurnDetails run={run} /> : null}
    </>
  );
}
