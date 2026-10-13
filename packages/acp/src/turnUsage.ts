/* ══════════════════════════════════════════════════════════════════════════
   TOKEN USAGE OF ONE TURN, AS THE AGENT REPORTS IT (round 9, ask 30)
   packages/acp/src/turnUsage.ts

   Two agents, two ways of saying it:

     ACP (Claude)   the `session/prompt` response carries `usage`
                    { inputTokens, outputTokens, cachedReadTokens,
                      cachedWriteTokens, thoughtTokens, totalTokens }.
     codex          `thread/tokenUsage/updated` becomes a `usage_update`
                    whose `_meta.codex.last` is ONE model request's usage
                    { inputTokens, cachedInputTokens, outputTokens,
                      reasoningOutputTokens, totalTokens }; a turn is the sum
                    of its requests.

   Both are folded into one TurnUsage. Nothing here estimates: a turn the
   agent never reported usage for has `null`, not a guess.

   A TurnUsage is PROCESSED tokens: a sum over the turn's requests (cache reads
   counted on every one). It is never the context window's fill; that is the
   agent's `usage_update` (`used` of `size`), read by web2's contextMeter.
   ══════════════════════════════════════════════════════════════════════════ */

export interface TurnUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Reasoning tokens, when the agent counts them apart. */
  thought: number;
  /** The agent's own total when it gave one, else the sum of the parts. */
  total: number;
}

export const emptyUsage = (): TurnUsage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thought: 0, total: 0 });

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function normalise(o: Record<string, unknown>): TurnUsage | null {
  const input = n(o.inputTokens);
  const output = n(o.outputTokens);
  const cacheRead = n(o.cachedReadTokens) || n(o.cachedInputTokens);
  const cacheWrite = n(o.cachedWriteTokens);
  const thought = n(o.thoughtTokens) || n(o.reasoningOutputTokens);
  const total = n(o.totalTokens) || input + output;
  if (!input && !output && !cacheRead && !cacheWrite && !total) return null;
  return { input, output, cacheRead, cacheWrite, thought, total };
}

/** ACP `PromptResponse.usage`, or null when the agent sent none. */
export function usageFromPrompt(usage: unknown): TurnUsage | null {
  const o = obj(usage);
  return o ? normalise(o) : null;
}

export function addUsage(a: TurnUsage, b: TurnUsage): TurnUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    thought: a.thought + b.thought,
    total: a.total + b.total,
  };
}

/**
 * Sums a turn's codex requests as their updates stream by. `final` (ACP's
 * prompt-response usage) wins over the running sum when the agent gave it.
 */
export class TurnUsageMeter {
  private sum: TurnUsage | null = null;

  /** Feed one session/update notification; true when the running sum changed. */
  update(notification: unknown): boolean {
    const u = obj(obj(notification)?.update);
    if (!u || u.sessionUpdate !== 'usage_update') return false;
    const last = obj(obj(obj(u._meta)?.codex)?.last);
    const one = last ? normalise(last) : null;
    if (!one) return false;
    this.sum = this.sum ? addUsage(this.sum, one) : one;
    return true;
  }

  /** The turn's usage: the agent's final report, else the sum so far, else null. */
  current(final?: TurnUsage | null): TurnUsage | null {
    return final ?? this.sum;
  }
}
