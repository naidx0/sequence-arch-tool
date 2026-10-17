/* ══════════════════════════════════════════════════════════════════════════
   THE NUMBERS BEHIND THE ARCHITECTURE MAP EXAMPLE (first run, map step)
   packages/web2/src/onboarding/mapExample.ts

   Pure. Where each number comes from:
     tokens   the server's own count of the map block it puts in the prompt
              (GET /api/agent-settings -> map.tokens, askAgentMap.ts). When the
              project has no map yet, the budget the map is written at:
              DEFAULT_MAP_BUDGET = 4000 in packages/analyzer/src/agentMap.ts
              ("map.md is the 4k map"). That case is labelled "example".
     window   500,000 tokens: an example window the owner asked the preview to
              use, not any model's real limit. It is always labelled "example".
   ══════════════════════════════════════════════════════════════════════════ */

export const EXAMPLE_WINDOW_TOKENS = 500_000;
/** The default map budget, in tokens (analyzer agentMap.ts DEFAULT_MAP_BUDGET). */
export const DEFAULT_MAP_TOKENS = 4_000;

export interface MapExample {
  /** Tokens the map takes in each turn. */
  tokens: number;
  /** True when the number is the server's count for this project; false when it is the default map budget. */
  measured: boolean;
  window: number;
  /** 0..1 of the window the map fills. */
  share: number;
  /** "0.8%" style, one decimal below 10%. */
  percent: string;
}

export function mapExample(serverTokens: number | null | undefined): MapExample {
  const measured = typeof serverTokens === 'number' && Number.isFinite(serverTokens) && serverTokens > 0;
  const tokens = measured ? (serverTokens as number) : DEFAULT_MAP_TOKENS;
  const share = Math.min(1, tokens / EXAMPLE_WINDOW_TOKENS);
  const pct = share * 100;
  return { tokens, measured, window: EXAMPLE_WINDOW_TOKENS, share, percent: `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%` };
}

export function tokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}
