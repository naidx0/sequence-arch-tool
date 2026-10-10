/* ══════════════════════════════════════════════════════════════════════════
   A TURN THAT GOES QUIET SAYS SO — AND OFFERS A WAY OUT (R10, C1b)
   packages/web2/src/chat/RunWatchdog.tsx

   After 45 s with no events from the agent, one quiet inline line:
     "No response from Claude for 45s    Keep waiting   Stop"
   Keep waiting hides it for another 45 s. After 3 min the turn is marked
   hung: "Claude isn't responding.    Stop   Retry". Stop frees the chat at
   once; Retry stops the turn and asks the same question again. Nothing is
   shown while a person is being asked (approval or question): that wait is
   theirs, not the agent's.
   ══════════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';

import type { AgentRun } from '../agents/agentRuns';
import { S2Icon } from '../shell2/icons';
import { vendorOf } from './RecoveryCard';

export const QUIET_MS = 45_000;
export const HUNG_MS = 3 * 60_000;

export type WatchdogLevel = 'quiet' | 'hung' | 'tool';

/** The turn has not begun: no item yet, and no live phase past the start. Pure. */
export function isStarting(run: AgentRun): boolean {
  return run.status === 'running' && !run.queued && run.items.length === 0 && (!run.live || run.live.phase === 'starting');
}

/** The watchdog's level for a run at `now`, or null while all is well. Pure. */
export function watchdogLevel(run: AgentRun, now: number, snoozedAt = 0): { level: WatchdogLevel; idleMs: number } | null {
  if (run.status !== 'running' || run.queued) return null;
  /* A clock that is not epoch time (a fixed test clock) cannot be measured against. */
  if (run.startedAt < 1e12) return null;
  if (run.approvals.some((a) => a.decision === null) || (run.questions ?? []).some((q) => !q.settled)) return null;
  const last = Math.max(run.lastEventAt ?? 0, run.startedAt);
  const idleMs = Math.max(0, now - last);
  /* The server says a tool is running (a long build, a test run): that is work, not silence, and never Retry,
     unless the server reports it stalled too. Then the run counts as hung and Retry is offered. */
  if (run.waiting?.reason === 'tool') {
    if (idleMs < QUIET_MS) return null;
    return run.stalled ? { level: 'hung', idleMs } : { level: 'tool', idleMs };
  }
  if (idleMs >= HUNG_MS) return { level: 'hung', idleMs };
  if (idleMs >= QUIET_MS && now - snoozedAt >= QUIET_MS) return { level: 'quiet', idleMs };
  return null;
}

export function RunWatchdog({
  run,
  now,
  onStop,
  onRetry,
}: {
  run: AgentRun;
  now: number;
  onStop: (run: AgentRun) => void;
  onRetry?: (run: AgentRun) => void;
}) {
  const [snoozedAt, setSnoozedAt] = useState(0);
  const w = watchdogLevel(run, now, snoozedAt);
  if (!w) return null;
  const who = vendorOf(run);
  const secs = Math.floor(w.idleMs / 1000);
  const starting = isStarting(run);
  if (w.level === 'tool') {
    const running = [...run.items].reverse().find((i) => i.kind === 'tool' && i.status === 'running');
    const what = (running?.kind === 'tool' ? running.title : '') || run.live?.tool?.title || run.waiting?.toolKind || 'a tool';
    const span = secs >= 120 ? `${Math.floor(secs / 60)}m` : `${secs}s`;
    return (
      <div className="agnote" role="status" data-testid="agent-run-watchdog" data-level="tool" data-tone="muted" data-watch="film">
        <div className="agnote-row">
          <span className="agnote-mark" aria-hidden="true">
            <S2Icon name="cpu" small />
          </span>
          <span className="agnote-text" data-testid="agent-run-watchdog-text">{`Running ${what} for ${span}`}</span>
        </div>
      </div>
    );
  }
  const retry = onRetry && run.retry ? onRetry : undefined;
  return (
    <div className="agnote" role="status" data-testid="agent-run-watchdog" data-level={w.level} data-tone="warn" data-watch="film" data-starting={starting ? 'true' : undefined}>
      <div className="agnote-row">
        <span className="agnote-mark" aria-hidden="true">
          <S2Icon name={w.level === 'hung' ? 'bolt' : 'spark'} small />
        </span>
        <span className="agnote-text" data-testid="agent-run-watchdog-text">
          {w.level === 'hung'
            ? `${who} isn't responding.`
            : starting
              ? `${who} is still starting, ${secs}s`
              : `No response from ${who} for ${secs}s`}
        </span>
        <span className="agnote-detail" data-testid="agent-run-watchdog-detail">
          {w.level === 'hung' ? 'Stop the turn, or try it again.' : starting ? 'It may still be warming up.' : 'The turn is still open.'}
        </span>
        <span className="agnote-acts">
          {w.level === 'quiet' ? (
            <button type="button" className="agnote-act" data-testid="agent-run-watchdog-wait" onClick={() => setSnoozedAt(now)}>
              Keep waiting
            </button>
          ) : null}
          <button type="button" className="agnote-act" data-testid="agent-run-watchdog-stop" onClick={() => onStop(run)}>
            Stop
          </button>
          {w.level === 'hung' && retry ? (
            <button
              type="button"
              className="agnote-act is-primary"
              data-testid="agent-run-watchdog-retry"
              onClick={() => {
                onStop(run);
                retry(run);
              }}
            >
              Retry
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}
