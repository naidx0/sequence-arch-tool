/* ══════════════════════════════════════════════════════════════════════════
   THE ASSISTANT'S STATE, IN ONE LINE (round 9)
   packages/web2/src/chat/ChatStatus.tsx

   Jaden: "show the state: thinking, working, calling a tool, stalled ... a
   spinning ASCII working indicator (OpenCode style) and a glimmer while
   working." (Round 9 is newer than Decision 43's "no shimmer", so the glimmer
   is in, on the active status text only.)

   <ChatStatus status={{ kind: 'tool', seconds: 41, label: 'Running Bash: pnpm test' }} />

     thinking  braille spinner, glimmer      "Thinking, 12s"
     tool      braille spinner, glimmer       "Running Bash: pnpm test, 41s"
     waiting   braille spinner, glimmer      "Waiting for Claude, 3s"
     queued    braille spinner, glimmer      "Queued: waiting for Claude, 8s"
     stalled   a still "!" mark, no motion   "Claude has been quiet for 45s"
     error     a still "x" mark, no motion   "Claude stopped: ..."

   The spinner is shell2/AsciiSpinner: text in a monospace cell (quadrant-block frames), stepped
   by a timer, not a CSS rotation. It pauses while the window is hidden and,
   with prefers-reduced-motion, holds one frame; the glimmer is a CSS sweep
   that reduced-motion turns off. Pure props in, no store.
   ══════════════════════════════════════════════════════════════════════════ */

import { AsciiSpinner } from '../shell2/AsciiSpinner';

import './runLive.css';

export type ChatStatusKind = 'thinking' | 'tool' | 'waiting' | 'stalled' | 'queued' | 'error';

export interface ChatStatusValue {
  kind: ChatStatusKind;
  /** Seconds in this state, drawn after the label ("12s", "1m 05s") when given. */
  seconds?: number;
  /** The words; a default per kind when absent. */
  label?: string;
}

/* ONE spinner for the whole product (round 11; the square radar since round 12): the quadrant sweep in shell2/AsciiSpinner. The block variant is gone. */
export { AsciiSpinner, SPINNER_FRAMES, SPINNER_STILL } from '../shell2/AsciiSpinner';

const DEFAULT_LABEL: Record<ChatStatusKind, string> = {
  thinking: 'Thinking',
  tool: 'Working',
  waiting: 'Waiting',
  queued: 'Queued',
  stalled: 'Quiet for a while',
  error: 'Something went wrong',
};

/** Active states move; stalled and error hold still. */
export function isActiveStatus(kind: ChatStatusKind): boolean {
  return kind !== 'stalled' && kind !== 'error';
}

function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** The status as a sentence: its label, then its seconds. */
export function statusText(status: ChatStatusValue): string {
  const label = status.label ?? DEFAULT_LABEL[status.kind];
  return status.seconds === undefined ? label : `${label}, ${formatSeconds(status.seconds)}`;
}

export function ChatStatus({ status, tone, testId = 'chat-status', phase }: { status: ChatStatusValue; tone?: 'calm' | 'warn' | 'quiet'; testId?: string; phase?: string }) {
  const quiet = tone === 'quiet';
  const active = isActiveStatus(status.kind) && !quiet;
  const mark = status.kind === 'stalled' ? '!' : status.kind === 'error' ? '×' : null;
  return (
    <div
      className="s2-live-bar runlive r9-status"
      data-testid={testId}
      data-kind={status.kind}
      data-phase={phase}
      data-tone={tone ?? (status.kind === 'stalled' || status.kind === 'error' ? 'warn' : 'calm')}
      role="status"
    >
      {quiet ? null : mark ? (
        <span className="r9-ascii r9-ascii-mark" aria-hidden="true">
          {mark}
        </span>
      ) : (
        <AsciiSpinner active={active} />
      )}
      <span className={`s2-live-phase${active ? ' shimmer-text' : ''}`} data-glimmer={active || undefined} data-testid="chat-status-text" title={statusText(status)}>
        {statusText(status)}
      </span>
    </div>
  );
}
