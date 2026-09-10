/**
 * Gateway configuration, loaded from the environment with sane defaults.
 *
 * Every knob has a default so the service never crash-loops on a missing var.
 * The ONE thing that has no default is `OPENROUTER_API_KEY` (the funded secret):
 * when it is absent the service still boots and serves `/healthz`, but every
 * proxy call returns a clean 500 "gateway misconfigured" instead of throwing at
 * startup. That keeps a bad deploy observable rather than a restart loop.
 */

/** The app's DEFAULT_MODEL id (analyzer `provider.ts`). Remapped to the real model. */
export const APP_DEFAULT_MODEL = 'deepseek-v4-flash';

export interface GatewayConfig {
  /** The funded OpenRouter key. `null` ⇒ misconfigured ⇒ proxy returns 500. Never logged. */
  openrouterApiKey: string | null;
  /**
   * Allowlist of accepted caller bearer tokens (from `SEQUENCE_GATEWAY_TOKEN`,
   * comma-separated). `null` ⇒ UNSET ⇒ accept all callers (dev only; a loud
   * warning is logged at startup). Never logged or returned.
   */
  callerTokens: string[] | null;
  /** OpenRouter API base, no trailing slash. Default `https://openrouter.ai/api/v1`. */
  openrouterBaseUrl: string;
  /** The real model requested downstream. Default `deepseek/deepseek-chat`. */
  defaultModel: string;
  /**
   * Allowlist of models the funded key may EVER be spent on. Anything not in
   * this list (including the app placeholder / empty) is coerced to
   * `defaultModel`. Default: just `defaultModel`.
   */
  allowedModels: string[];
  /** Global monthly spend ceiling in USD. At/over ⇒ 402. Default 50. */
  globalSpendBackstopUsd: number;
  /** Flat estimated cost added per successful call. Default 0.0018. */
  estCostPerCall: number;
  /** Listen port. Default 8787. */
  port: number;
  /** Optional OpenRouter-recommended attribution headers. */
  httpReferer?: string;
  xTitle?: string;
  /** Reject request bodies larger than this (bytes) with 413. Default 256 KiB. */
  maxRequestBytes: number;
  /** Cap the upstream response we buffer (bytes). Default 20 MiB. */
  maxResponseBytes: number;
  /** Server-imposed `max_tokens` on every downstream call (bounds cost). Default 2048. */
  serverMaxTokens: number;
  /** Best-effort per-caller-token sliding-window limit (requests/min). Default 60. */
  rateLimitPerMin: number;
  /** Directory for the durable spend counter file. Default `os.tmpdir()`. */
  stateDir: string;
}

function num(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, '');
}

/** Parse a `GatewayConfig` from an env bag (defaults to `process.env`). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const key = env.OPENROUTER_API_KEY?.trim();
  const tokensRaw = env.SEQUENCE_GATEWAY_TOKEN;
  const callerTokens =
    tokensRaw == null
      ? null
      : tokensRaw
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);

  const defaultModel = env.GATEWAY_DEFAULT_MODEL?.trim() || 'deepseek/deepseek-chat';
  const allowedRaw = env.GATEWAY_ALLOWED_MODELS?.trim();
  const allowedModels = allowedRaw
    ? allowedRaw
        .split(',')
        .map((m) => m.trim())
        .filter((m) => m.length > 0)
    : [defaultModel];
  // The default model is always implicitly allowed (it is the coercion target).
  if (!allowedModels.includes(defaultModel)) allowedModels.push(defaultModel);

  return {
    openrouterApiKey: key && key.length > 0 ? key : null,
    // An empty (all-whitespace) SEQUENCE_GATEWAY_TOKEN yields [] ⇒ nothing is
    // accepted (fail closed), NOT accept-all. Accept-all requires the var UNSET.
    callerTokens,
    openrouterBaseUrl: stripTrailingSlash(env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1'),
    defaultModel,
    allowedModels,
    globalSpendBackstopUsd: num(env.GLOBAL_SPEND_BACKSTOP_USD, 50),
    estCostPerCall: num(env.EST_COST_PER_CALL, 0.0018),
    port: num(env.PORT, 8787),
    httpReferer: env.OPENROUTER_HTTP_REFERER?.trim() || undefined,
    xTitle: env.OPENROUTER_X_TITLE?.trim() || undefined,
    maxRequestBytes: num(env.GATEWAY_MAX_REQUEST_BYTES, 256 * 1024),
    maxResponseBytes: num(env.GATEWAY_MAX_RESPONSE_BYTES, 20 * 1024 * 1024),
    serverMaxTokens: num(env.GATEWAY_MAX_TOKENS, 2048),
    rateLimitPerMin: num(env.GATEWAY_RATE_LIMIT_PER_MIN, 60),
    stateDir: env.GATEWAY_STATE_DIR?.trim() || '',
  };
}

/** `YYYY-MM` for the given date (UTC) — the spend-counter bucket key. */
export function currentMonthYear(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Coerce an incoming model id to the model actually sent downstream — a STRICT
 * allowlist so the funded key can only ever be spent on approved models,
 * whatever the client sends. Empty, the app placeholder (`deepseek-v4-flash`),
 * or any id NOT in `allowedModels` is coerced to `defaultModel` (never rejected,
 * so the app keeps working). An allowlisted id passes through unchanged.
 */
export function remapModel(model: unknown, config: GatewayConfig): string {
  if (typeof model !== 'string') return config.defaultModel;
  const trimmed = model.trim();
  if (trimmed === '' || trimmed === APP_DEFAULT_MODEL) return config.defaultModel;
  return config.allowedModels.includes(trimmed) ? trimmed : config.defaultModel;
}
