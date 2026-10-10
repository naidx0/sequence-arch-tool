/* ══════════════════════════════════════════════════════════════════════════
   WHAT A PERSON CAN DO ABOUT A FAILED TURN
   packages/acp/src/recovery.ts

   A failed agent turn is one of a few things, and each has one useful next
   step (build spec Part 5, row 23):
     signIn   the agent is signed out (codex `unauthorized`, ACP
              `auth_required` -32000, or the agent saying so): run the vendor's
              own login, then try again.
     retry    anything else that can be tried again on the same thread: the
              agent process died, the turn hung, a dropped connection.
              Retrying resumes the thread, so nothing the agent knew is lost.
     wait     a usage limit (codex `usageLimitExceeded`), or a rate, usage or
              quota error that says when it resets. Retrying before then fails
              the same way, so the person is told when it resets and offered
              no Retry. `resetsAt` is that moment (epoch ms) when it is known.
     install  the agent binary is not there (ENOENT): nothing to retry until it
              is installed.
   ══════════════════════════════════════════════════════════════════════════ */

export type RecoveryKind = 'signIn' | 'retry' | 'install' | 'wait';

/**
 * WHY a turn failed, finer than what to do about it. `bridgeExit` is the agent
 * process dying (its message carries the exit code and last stderr line);
 * `timeout` is no output for too long.
 */
export type FailureCause = 'notInstalled' | 'signedOut' | 'usageLimit' | 'bridgeExit' | 'timeout' | 'network' | 'unknown';

/** The next step, with the reset time for `wait` when one is known (epoch ms). */
export interface Recovery {
  kind: RecoveryKind;
  resetsAt?: number;
  cause?: FailureCause;
}

/** A failed codex turn, with codex's own error code (`CodexErrorInfo`) kept. */
export class AgentTurnError extends Error {
  readonly info: unknown;
  /** When the limit that failed the turn resets (epoch ms), from codex's own rate-limit windows. */
  readonly resetsAt?: number;
  constructor(message: string, info: unknown, resetsAt?: number) {
    super(message);
    this.name = 'AgentTurnError';
    this.info = info;
    if (typeof resetsAt === 'number' && Number.isFinite(resetsAt)) this.resetsAt = resetsAt;
  }
}

/** The turn sat still past the idle watchdog (see turnWatchdog.ts). */
export class TurnHungError extends Error {
  readonly idleMs: number;
  constructor(idleMs: number) {
    super(`The agent made no progress for ${Math.round(idleMs / 1000)} s and was stopped.`);
    this.name = 'TurnHungError';
    this.idleMs = idleMs;
  }
}

const SIGNED_OUT = /not (?:logged|signed) in|log ?in (?:again|required)|please (?:log|sign) ?in|unauthori[sz]ed|\b401\b|authentication required|auth_required|invalid api key|token (?:has )?expired/i;

function codeOf(e: unknown): unknown {
  return e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
}

/** Codex's error code says a usage limit was hit (`CodexErrorInfo`: a string, or an object keyed by it). */
export function isUsageLimit(info: unknown): boolean {
  if (info === 'usageLimitExceeded') return true;
  return Boolean(info && typeof info === 'object' && 'usageLimitExceeded' in info);
}

const LIMIT_WORDS = /\b(?:usage|rate|quota)[ -]?limit|\bquota\b|too many requests|\b429\b/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The reset moment an error message names, as codex words it ("try again at
 * Oct 12th, 2026 4:36 PM."). The time is the local time of the machine the
 * agent runs on, which is this one. Null when the message names none.
 */
export function resetTimeInMessage(message: string): number | null {
  const m = /try again (?:at|after|on)\s+([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4}),?\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*([AaPp][Mm])?/.exec(message);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (month < 0) return null;
  let hour = Number(m[4]);
  const ampm = m[6]?.toLowerCase();
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  const at = new Date(Number(m[3]), month, Number(m[2]), hour, Number(m[5])).getTime();
  return Number.isFinite(at) ? at : null;
}

const NETWORK_CODES = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'];
const NETWORK = /\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)\b|fetch failed|network (?:error|is unreachable)|socket hang up|getaddrinfo|connection (?:was )?(?:lost|reset|refused)/i;
const TIMED_OUT = /timed? ?out|no (?:output|response|progress)|\bETIMEDOUT\b/i;
const EXITED = /process exited|exited \(|exit code|\bsignal SIG[A-Z]+\b|connection closed/i;

/** Why a failed turn failed, in the person's terms. */
export function causeOf(e: unknown): FailureCause {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const kind = recoveryBase(e).kind;
  if (kind === 'wait') return 'usageLimit';
  if (kind === 'install') return 'notInstalled';
  if (kind === 'signIn') return 'signedOut';
  if (e instanceof TurnHungError || TIMED_OUT.test(message)) return 'timeout';
  if (e instanceof Error && e.name === 'AgentExitedError') return 'bridgeExit';
  if (NETWORK.test(message) || NETWORK_CODES.includes(String(codeOf(e)))) return 'network';
  if (EXITED.test(message)) return 'bridgeExit';
  return 'unknown';
}

/** The next step for a failed turn, with the reset time when it is a limit that resets, and why it failed. */
export function recoveryOf(e: unknown): Recovery {
  return { ...recoveryBase(e), cause: causeOf(e) };
}

function recoveryBase(e: unknown): Recovery {
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const usage = e instanceof AgentTurnError && isUsageLimit(e.info);
  if (usage || LIMIT_WORDS.test(message)) {
    const resetsAt = (e instanceof AgentTurnError ? e.resetsAt : undefined) ?? resetTimeInMessage(message) ?? undefined;
    /* A usage limit is a wait even without a time; any other limit only when it says when it resets. */
    if (usage || resetsAt !== undefined) return resetsAt !== undefined ? { kind: 'wait', resetsAt } : { kind: 'wait' };
  }
  return { kind: baseRecovery(e) };
}

/** The next step for a failed turn. */
export function recoveryFor(e: unknown): RecoveryKind {
  return recoveryBase(e).kind;
}

/** Everything but a limit that resets: sign in, install, or retry. */
function baseRecovery(e: unknown): Exclude<RecoveryKind, 'wait'> {
  if (e instanceof TurnHungError) return 'retry';
  if (e instanceof AgentTurnError && e.info === 'unauthorized') return 'signIn';
  const code = codeOf(e);
  if (code === 'ENOENT') return 'install';
  /* ACP reserves -32000 for auth_required. */
  if (code === -32000) return 'signIn';
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  if (/\bENOENT\b|is not recognized as an internal or external command|command not found/i.test(message)) return 'install';
  if (SIGNED_OUT.test(message)) return 'signIn';
  return 'retry';
}
