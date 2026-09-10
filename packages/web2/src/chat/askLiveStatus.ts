import type { InFlightTurn } from '../state/types';
import { formatElapsed } from './workRowModel';

/** Everyday tool-loop ceiling — mirrors `askTools.MAX_ASK_TOOL_ROUNDS`. */
export const DEFAULT_MAX_ASK_ROUNDS = 8;

/** Design / no-repo draw questions — mirrors `DESIGN_DRAW_ASK_TOOL_ROUNDS`. */
export const DESIGN_DRAW_ASK_TOOL_ROUNDS = 2;

/** Calm stall line after this long without provider/tool progress. */
export const PROVIDER_STALL_THRESHOLD_MS = 30_000;

export const PROVIDER_STALL_MESSAGE = 'Provider is slow…';

/** Draw / diagram intent — keep in sync with `packages/analyzer/src/server/askIntent.ts`. */
export function isDrawishAskQuestion(question: string): boolean {
  return /\b(draw|diagram|mermaid|flowchart|visuali[sz]e|map out|sketch|chart|mockup|wireframe|ai[\s-]?canvas|on the (board|canvas)|tui|show (it |this )?on the board)\b/i.test(
    question,
  );
}

/** True when the design draw short path applies (lower round cap). */
export function isDesignShortPathAsk(input: {
  designMode: boolean;
  question: string;
}): boolean {
  void input.designMode;
  return isDrawishAskQuestion(input.question);
}

/** Client-side round cap for live `Round k/n` — honour design short path. */
export function resolveAskRoundCap(input: {
  maxRounds?: number;
  designMode: boolean;
  question: string;
}): number {
  const requested = input.maxRounds;
  const base =
    typeof requested === 'number' && Number.isFinite(requested) && requested >= 1
      ? Math.min(Math.floor(requested), DEFAULT_MAX_ASK_ROUNDS)
      : DEFAULT_MAX_ASK_ROUNDS;
  if (isDesignShortPathAsk(input)) return Math.min(base, DESIGN_DRAW_ASK_TOOL_ROUNDS);
  return base;
}

export function formatRoundTimer(current: number, max: number, elapsedMs: number): string {
  return `Round ${current}/${max} · ${formatElapsed(elapsedMs)}`;
}

const PROGRESS_EVENTS = new Set([
  'delta',
  'file:read',
  'file:done',
  'tool:start',
  'tool:done',
  'intent:start',
  'intent:done',
  'step:start',
  'step:done',
  'provider:start',
  'provider:done',
  'command:log',
  'canvas:block',
  'canvas:story',
  'edit:proposal',
  'topology:proposal',
  'advisor',
]);

export function isAskProgressEvent(type: string): boolean {
  return PROGRESS_EVENTS.has(type);
}

export function shouldShowProviderStall(
  lastActivityAt: number,
  now: number,
  live: boolean,
): boolean {
  if (!live) return false;
  if (lastActivityAt <= 0 || now <= lastActivityAt) return false;
  return now - lastActivityAt >= PROVIDER_STALL_THRESHOLD_MS;
}

export interface AskLiveRoundTimer {
  current: number;
  max: number;
  elapsedMs: number;
}

export interface DerivedAskLiveStatus {
  roundTimer: AskLiveRoundTimer | null;
  stallNotice: string | null;
}

export function deriveAskLiveStatus(inFlight: InFlightTurn, now: number): DerivedAskLiveStatus {
  const elapsedMs = Math.max(0, now - inFlight.startedAt);
  const roundTimer =
    inFlight.providerRound > 0
      ? {
          current: inFlight.providerRound,
          max: inFlight.roundCap,
          elapsedMs,
        }
      : null;
  const stallNotice = shouldShowProviderStall(inFlight.lastActivityAt, now, true)
    ? PROVIDER_STALL_MESSAGE
    : null;
  return { roundTimer, stallNotice };
}
