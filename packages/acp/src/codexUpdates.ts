/* ══════════════════════════════════════════════════════════════════════════
   WHAT CODEX SAYS ABOUT A TURN, IN ACP'S WORDS (S2b)
   packages/acp/src/codexUpdates.ts

   Everything downstream (run-node's stream, web2's fold) reads ACP session
   updates, so the codex bridge translates codex's own notifications into
   the ACP update that means the same thing, instead of inventing a second
   vocabulary. Field names are from codex-cli 0.153.4's generated protocol
   types and the S0 recordings:

     turn/plan/updated          -> plan          the todo list (update_plan):
                                                 steps and their status
     thread/goal/updated        -> plan_update   the goal codex set itself
                                  (markdown)     (this codex's plan: "Three-step
                                                 plan: 1) … 2) … 3) …")
     thread/tokenUsage/updated  -> usage_update  context used / window, with
                                                 codex's own token counts
     account/rateLimits/updated -> session_info_update, _meta.sequence.rateLimits
                                                 (ACP has no account update)

   Pure: a frame in, an update or null out. Table-tested.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SessionNotification } from '@agentclientprotocol/sdk';

type Json = Record<string, unknown>;
export type AcpUpdate = SessionNotification['update'];

const STATUS: Record<string, 'pending' | 'in_progress' | 'completed'> = {
  pending: 'pending',
  inProgress: 'in_progress',
  in_progress: 'in_progress',
  completed: 'completed',
};

export interface RateLimitWindow {
  usedPercent: number;
  windowMins: number | null;
  resetsAt: number | null;
}

/** The account's limits as the context ring's popover shows them. */
export interface RateLimits {
  plan: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
}

function win(w: unknown): RateLimitWindow | null {
  const x = w as { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown } | null;
  if (!x || typeof x.usedPercent !== 'number') return null;
  return {
    usedPercent: x.usedPercent,
    windowMins: typeof x.windowDurationMins === 'number' ? x.windowDurationMins : null,
    resetsAt: typeof x.resetsAt === 'number' ? x.resetsAt : null,
  };
}

export function codexUpdate(method: string, p: Json): AcpUpdate | null {
  switch (method) {
    case 'turn/plan/updated': {
      const plan = Array.isArray(p.plan) ? (p.plan as { step?: unknown; status?: unknown }[]) : [];
      return {
        sessionUpdate: 'plan',
        entries: plan
          .filter((s) => typeof s.step === 'string')
          .map((s) => ({ content: s.step as string, status: STATUS[String(s.status)] ?? 'pending', priority: 'medium' as const })),
        ...(typeof p.explanation === 'string' && p.explanation ? { _meta: { codex: { explanation: p.explanation } } } : {}),
      };
    }
    case 'thread/goal/updated': {
      const g = (p.goal ?? {}) as { objective?: unknown; status?: unknown; tokensUsed?: unknown; timeUsedSeconds?: unknown; threadId?: unknown };
      if (typeof g.objective !== 'string' || !g.objective.trim()) return null;
      return {
        sessionUpdate: 'plan_update',
        plan: { type: 'markdown', planId: `goal:${String(g.threadId ?? p.threadId ?? '')}`, content: g.objective },
        _meta: { codex: { goal: { status: g.status ?? null, tokensUsed: g.tokensUsed ?? null, timeUsedSeconds: g.timeUsedSeconds ?? null } } },
      };
    }
    case 'thread/tokenUsage/updated': {
      const u = (p.tokenUsage ?? {}) as { last?: { totalTokens?: unknown }; total?: unknown; modelContextWindow?: unknown };
      const used = typeof u.last?.totalTokens === 'number' ? u.last.totalTokens : null;
      const size = typeof u.modelContextWindow === 'number' ? u.modelContextWindow : null;
      if (used === null || size === null) return null;
      return { sessionUpdate: 'usage_update', used, size, _meta: { codex: { total: u.total ?? null, last: u.last ?? null } } };
    }
    case 'account/rateLimits/updated': {
      const r = (p.rateLimits ?? {}) as { primary?: unknown; secondary?: unknown; planType?: unknown };
      const rateLimits: RateLimits = { plan: typeof r.planType === 'string' ? r.planType : null, primary: win(r.primary), secondary: win(r.secondary) };
      return { sessionUpdate: 'session_info_update', _meta: { sequence: { rateLimits } } };
    }
    default:
      return null;
  }
}

/** Codex notifications {@link codexUpdate} translates. */
export const CODEX_TRANSLATED = ['turn/plan/updated', 'thread/goal/updated', 'thread/tokenUsage/updated', 'account/rateLimits/updated'] as const;
