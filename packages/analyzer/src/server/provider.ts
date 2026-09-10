/**
 * The provider layer: a small, honest abstraction over "send a prompt+brief,
 * get files back" for a bring-your-own-key AI subscription.
 *
 * This is the CLIENT of two chat-completion wire formats (Anthropic Messages and
 * OpenAI-compatible chat/completions). It is deliberately minimal — plain
 * `fetch`, no SDKs — and it is the single place the user's API key is put onto
 * the wire. Key hygiene rules enforced here:
 *
 *   - the key travels only in the request headers this module builds
 *     (`x-api-key` for Anthropic, `authorization: Bearer` for OpenAI); it is
 *     never placed in a URL, a log line, or a thrown error;
 *   - a {@link ProviderError} carries only the provider's *response* status and
 *     body — never the request headers — and the response body is authored by
 *     the provider, so it cannot contain the key we sent;
 *   - {@link redactAiConfig} is the only shape ever returned to a client.
 *
 * HONEST TESTING BOUNDARY: no real provider key exists in this build
 * environment. The end-to-end gate points `baseUrl` at a local mock server that
 * speaks the Anthropic wire shape. The real-key path is exactly this code with
 * the mock `baseUrl` omitted (so Anthropic's default host is used) — it is
 * shipped behind this same interface and is documented as verified-against-mock
 * only, never against a live subscription.
 */

export type ProviderKind = 'anthropic' | 'openai-compatible';

// ADR-013 Phase A/B: typed route selection + prompt envelope (wire adapters unchanged below).
export {
  routeFromAiConfig,
  routeToAiConfig,
  redactRoute,
  maskSecret,
  MODEL_SUBSCRIPTION_OAUTH_UNAVAILABLE_MSG,
  LOCAL_OPENAI_CONSENT_REQUIRED_MSG,
  assertSubscriptionOAuthAvailable,
  assertLocalOpenAiRoute,
  isLoopbackHost,
  isLoopbackOrPrivateHost,
  routeCapabilities,
  routePrivacyBoundary,
  type ModelRoute,
  type ModelRouteKind,
  type ModelRequest,
  type ModelUsageRecord,
  type RouteDiagnostic,
  type PrivacyBoundary,
  ModelRouteError,
} from '../llm/modelRoutes.js';
export {
  PROMPT_ENVELOPE_VERSION,
  assemblePromptEnvelope,
  buildStablePrefix,
  buildVolatileSuffix,
  computeSnapshotHash,
  normalizeEnvelopeText,
  stablePrefixHash,
  type PromptEnvelopeSections,
  type PromptEnvelopeDiagnostics,
} from '../llm/promptEnvelope.js';
export {
  canFailover,
  isTransientProviderFailure,
  failoverBlockedDiagnostic,
  type FailoverContext,
} from '../llm/failover.js';
export {
  COMPACTION_VERSION,
  compactSessionTurns,
  serializeCompactedState,
  hashTurn,
  formatRecentTurns,
  deterministicSummarizer,
  ContextLimitError,
  CompactionFailedError,
  type SessionTurn,
  type CompactedSessionRecord,
  type CompactionDiagnostics,
  type TurnSummarizer,
} from '../llm/compaction.js';
export {
  createModelSessionService,
  MODEL_SESSION_IDLE_TTL_MS,
  MODEL_SESSION_MAX,
  SessionCapacityError,
  SessionTurnTimeoutError,
  type ModelSessionService,
  type ModelSessionDiagnostics,
  type ModelSessionServiceDiagnostics,
  type SessionTurnRequest,
  type SessionTurnResult,
  type ModelSessionLimits,
} from '../llm/modelSessionService.js';
export {
  extractProviderUsage,
  type ExtractedProviderUsage,
  type CacheOutcome,
} from '../llm/usageExtraction.js';
export {
  COST_ESTIMATE_VERSION,
  estimateCostUsd,
  reserveEstimateUsd,
  FLAT_ESTIMATE_USD,
} from '../llm/costEstimate.js';
export {
  summarizeUsageDiagnostics,
  type UsageDiagnosticsSummary,
  type UsageAttemptDiagnostics,
} from '../llm/usageDiagnostics.js';
export {
  createSpendLedger,
  canReserveSpend,
  type SpendLedger,
  type SpendLedgerPolicy,
  type SpendReservation,
  type SpendLedgerDiagnostics,
} from './spendLedger.js';

import { parseAiRoles, type AiRoleBinding, type AiRoleId } from './modelRoles.js';
import { approxTokens } from '../llm/tokenBudget.js';
import {
  routeToAiConfig,
  redactRoute,
  routePrivacyBoundary,
  assertLocalOpenAiRoute,
  assertSubscriptionOAuthAvailable,
  isLoopbackHost,
  type ModelRequest,
  type ModelRoute,
  type ModelUsageRecord,
  type RouteDiagnostic,
} from '../llm/modelRoutes.js';
import {
  assemblePromptEnvelope,
  type PromptEnvelopeSections,
  type PromptEnvelopeDiagnostics,
} from '../llm/promptEnvelope.js';
import {
  canFailover,
  failoverBlockedDiagnostic,
  type FailoverContext,
} from '../llm/failover.js';
import {
  type ModelSessionService,
  type ModelSessionDiagnostics,
  type SessionTurnRequest,
} from '../llm/modelSessionService.js';
import {
  extractProviderUsage,
  type ExtractedProviderUsage,
} from '../llm/usageExtraction.js';
import { estimateCostUsd, reserveEstimateUsd } from '../llm/costEstimate.js';
import type { SpendLedger } from './spendLedger.js';

/**
 * How this config authenticates its request (v9 Phase 2).
 *
 *   - `'api-key'` (or ABSENT — a mode-less config MIGRATES to api-key for
 *     backward-compat) — today's bring-your-own-key path, byte-for-byte
 *     unchanged. The user's key rides in the header this module builds.
 *   - `'default'` — the free metered default: the request is routed to a HOSTED
 *     model gateway ({@link DEFAULT_GATEWAY_URL}) that holds OUR funded DeepSeek
 *     key + a per-user meter. NO user secret and NO funded key ever lives in
 *     this local config — the gateway holds it. Authenticated (if at all) by a
 *     coarse APP/instance token from the environment, never a user credential.
 */
export type AiMode = 'api-key' | 'default';

/**
 * THE KNOBS AROUND THE MODEL.
 *
 * Before this the ENTIRE request body was `{model, messages}` (+ `max_tokens`
 * on the anthropic wire, + `tools` when supplied). A reader could not make the
 * model deterministic for a repeatable audit, could not raise the output cap for
 * a long refactor, and — the one that actually hurt — could not put a DEADLINE on
 * a local generation. The only `AbortSignal` in the ask chain was
 * `requestAbort(res)`, whose sole trigger is the browser tab closing, so a
 * stalled Ollama hung until the user closed the tab. `doctor.ts` has used
 * `AbortSignal.timeout(20_000)` for its probe the whole time.
 *
 * EVERY FIELD IS OPTIONAL AND OMITTED WHEN UNSET. That is not tidiness: several
 * openai-compatible servers (llama.cpp, LM Studio, older vLLM) reject unknown or
 * unexpected request fields with a 400, and the existing body comments record
 * that we already trade measurement for "this local model answers at all". A
 * config with no `params` therefore puts BYTE-IDENTICAL bytes on the wire to the
 * build before this existed, and `maxRetries` defaults to 0 — today's behaviour.
 */
export interface AiParams {
  /** Sampling temperature. 0 is the deterministic end; range 0–2. */
  temperature?: number;
  /** Nucleus sampling. Range 0–1. */
  topP?: number;
  /** Output cap. On the anthropic wire this REPLACES the hardcoded 8192. */
  maxTokens?: number;
  /**
   * How much hidden reasoning the model may do before it answers. Absent puts
   * NOTHING on the wire, so a config without it is byte-identical to before.
   *
   * `granite42-hermes`'s chat template sets `enable_thinking = True` unless the
   * request defines it otherwise, so every Teach turn opened a reasoning block
   * the reader never sees. Measured on this machine, one short question:
   * 1,200 ms with 316 characters of unseen reasoning, 343 ms with none — first
   * content at 921 ms against 21 ms.
   *
   * `reasoning_effort` and NOT `think`: this is the OpenAI-shaped wire, where
   * Ollama accepts and IGNORES the native `think` option — measured, the same
   * way it accepts and ignores `num_ctx` there. `chat_template_kwargs` is
   * ignored too. Only `reasoning_effort` took effect, and it has the further
   * merit of being a standard field rather than a vendor extension, which is
   * what the `stream_options` note further down is careful about.
   */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  /**
   * Wall-clock deadline for one provider call, in milliseconds.
   *
   * Absent ⇒ NO deadline, which is exactly what shipped. Present ⇒ the call is
   * aborted and reported as a timeout rather than hanging on a stalled
   * generation. 1_000–3_600_000.
   */
  timeoutMs?: number;
  /**
   * How many times a TRANSIENT failure may be re-sent. 0–5, default 0.
   *
   * Deliberately narrow: a retry is only ever taken when NOT ONE DELTA has been
   * handed to the caller. A delta already handed over has already been shown to
   * someone, and appending a second generation to a first the reader watched
   * appear would store a turn no model ever produced — the same rule
   * `ModelRequestOptions.onDelta` states for failover.
   */
  maxRetries?: number;
}

/**
 * ONE SAVED MODEL IN A LIST OF THEM.
 *
 * Owner question, 2026-08-28: "can we save different models to switch between?
 * can you set a default model?" The answer was no on both counts — the whole
 * persisted model state was one flat {@link AiConfig}, so changing your mind
 * meant retyping provider + model + baseUrl + key.
 *
 * A profile is that flat shape plus the two things a list needs: a stable `id`
 * and a name a human chose. Nothing else about a model call changed — the
 * ACTIVE profile is resolved back into the flat config every reader already
 * takes ({@link validateAiConfig}), so "switch model" is a one-field write and
 * the next ask uses it.
 */
export interface AiProfile {
  /** Stable, url/file-safe. Never shown; it is what `defaultProfileId` points at. */
  id: string;
  /** What the reader calls it. Shown in the composer's picker and in Settings. */
  name: string;
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  /** Persisted ONLY to ai.json; masked by {@link redactAiConfig} like any key. */
  apiKey?: string;
  params?: AiParams;
}

export interface AiConfig {
  /**
   * OPTIONAL. Absent ⇒ `'api-key'` — a mode-less config behaves EXACTLY as it
   * did before v9 (every pre-v9 call site + `@sequence/mcp` builds `AiConfig`
   * without `mode`, and must keep compiling and behaving identically).
   */
  mode?: AiMode;
  provider: ProviderKind;
  /** Override host. Optional for anthropic (defaults to the public API); required for openai-compatible. */
  baseUrl?: string;
  model: string;
  /**
   * The bring-your-own key. Persisted ONLY to .sequence/ai.json; never returned
   * unredacted. Required for remote direct providers; absent is the explicit
   * representation of a keyless loopback OpenAI-compatible provider and is
   * also required for `'default'` mode (the hosted gateway holds our key).
   */
  apiKey?: string;
  /**
   * RUNTIME-ONLY stamp (never persisted): set by repoServer's loadAiConfig when a
   * gateway URL was actually configured (SEQUENCE_GATEWAY_URL on a real deploy, or
   * the test injection). Default mode refuses BEFORE any fetch unless this is true
   * — deliberately not a URL comparison, so a real deploy at the placeholder's own
   * hostname works (v18 review round 1).
   */
  gatewayLive?: boolean;
  /**
   * OPTIONAL model-role bindings (MADR `docs/decisions/model-roles.md`). Each
   * role (`advisor` / `vision` / `plan`) MAY bind its own model / host / key so
   * a local default can pair with a frontier advisor. Roles are ADDITIVE: no
   * binding ⇒ the worker handles the role. Only attached on the api-key path
   * (default mode is unchanged); persisted verbatim, redacted on read.
   */
  roles?: Partial<Record<AiRoleId, AiRoleBinding>>;
  /**
   * OPTIONAL sampling / runtime knobs. See {@link AiParams}. Absent ⇒ the
   * request body is byte-identical to the build before knobs existed.
   */
  params?: AiParams;
  /**
   * OPTIONAL saved models. When present, the fields ABOVE are the resolved
   * {@link defaultProfileId} entry — {@link validateAiConfig} flattens the
   * active profile into them so no downstream reader has to know profiles
   * exist. A config written before profiles is unchanged: no list, no default.
   */
  profiles?: AiProfile[];
  /** Which profile answers. Always one of {@link profiles} when that is set. */
  defaultProfileId?: string;
}

/**
 * The default free-tier model id. OpenAI-compatible; chosen in
 * docs/AI_CONNECT_RESEARCH.md (~$1.82 per 1,000 explains). The hosted gateway
 * forwards to DeepSeek; the local app only ever names the model.
 */
export const DEFAULT_MODEL = 'deepseek-v4-flash';

/**
 * The hosted model gateway that fronts our funded DeepSeek key + the per-user
 * meter, exposing an OpenAI-compatible `/v1/chat/completions`.
 *
 * PLACEHOLDER — the funded hosted gateway is NOT deployed in this build. The
 * `'default'`-mode path is verified end-to-end against a MOCK gateway (see
 * ai-gateway.test.ts) and is flagged unverified-until-deployed. Standing up the
 * real funded gateway is a DEPLOY step OUTSIDE this sandbox (the ONE unverified
 * seam of Phase 2). Our secret DeepSeek key lives ONLY inside that gateway and
 * is NEVER shipped in this local app.
 */
export const DEFAULT_GATEWAY_URL = 'https://gateway.sequence.dev';

/**
 * DeepSeek direct-routing seam (the "make the FREE assistant work on first run"
 * round — fixes usability finding U6). DeepSeek is OpenAI-compatible: base
 * {@link DEEPSEEK_BASE_URL}, path `/v1/chat/completions`, model
 * {@link DEEPSEEK_DEFAULT_MODEL}, auth `Authorization: Bearer <key>`.
 *
 * When the OWNER sets `DEEPSEEK_API_KEY` on the deploy, repoServer's loadAiConfig
 * routes `mode:'default'` STRAIGHT to DeepSeek with this funded SERVER key and
 * stamps `gatewayLive:true`, so a KEYLESS user's assistant works with no BYO key.
 *
 * SECURITY (non-negotiable): the funded key is a SERVER secret. It is read from
 * the environment at WIRE time only ({@link deepSeekServerKey}, used in
 * {@link resolveEndpoint}) — it is NEVER placed in an {@link AiConfig}, so it can
 * never reach {@link redactAiConfig}, a client response, an error, or a log. A
 * default-mode config still carries NO key field at all. `DEEPSEEK_BASE_URL` is a
 * test/deploy override (tests point it at a mock); it defaults to the real host.
 */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat';

/**
 * The funded SERVER key for DeepSeek direct-routing, read from the env at wire
 * time ONLY. Undefined when unset/blank ⇒ the free default is not routed to
 * DeepSeek (loadAiConfig leaves the honest FREE_TIER_NOT_LIVE gate in place).
 * NEVER stored in a config, redacted, or logged — mirrors {@link gatewayAppToken}.
 */
export function deepSeekServerKey(): string | undefined {
  const k = (process.env.DEEPSEEK_API_KEY ?? '').trim();
  return k === '' ? undefined : k;
}
/** True when the owner configured a DeepSeek server key ⇒ the free default is LIVE. */
export function deepSeekConfigured(): boolean {
  return deepSeekServerKey() !== undefined;
}
/** DeepSeek base host — `DEEPSEEK_BASE_URL` override (tests/deploy) else the real host. */
export function deepSeekBaseUrl(): string {
  const b = (process.env.DEEPSEEK_BASE_URL ?? '').trim();
  return b === '' ? DEEPSEEK_BASE_URL : b;
}
/** DeepSeek model — `DEEPSEEK_MODEL` override else {@link DEEPSEEK_DEFAULT_MODEL}. */
export function deepSeekModel(): string {
  const m = (process.env.DEEPSEEK_MODEL ?? '').trim();
  return m === '' ? DEEPSEEK_DEFAULT_MODEL : m;
}

/**
 * The HONEST free-tier failure message (v18 Wave 2). The hosted gateway above is
 * a placeholder that is NOT deployed, so a `mode:'default'` request that still
 * points at {@link DEFAULT_GATEWAY_URL} can never succeed — a raw
 * "provider request failed: fetch failed" against a non-existent host is a lie
 * about why chat is down. {@link requestModelText} throws this BEFORE any fetch
 * in that case, and remaps a default-mode network failure to it too, so the web
 * layer can render a "add your key in Settings" nudge instead of red noise.
 *
 * SCOPING: this only ever fires for `mode:'default'` configs whose baseUrl is the
 * undeployed placeholder. A BYO-key config, or a default-mode config whose baseUrl
 * was overridden to a real/mock gateway (the test/deploy seam in repoServer's
 * loadAiConfig), is never affected — those keep their real diagnostics.
 */
/**
 * A request URL as it may appear in an error: scheme, host, port and path, with
 * the query string dropped because credentials live there on some providers.
 * Falls back to a fixed marker rather than echoing an unparseable string.
 */
function describeEndpoint(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return 'unparseable endpoint';
  }
}

export const FREE_TIER_NOT_LIVE_MSG =
  'the free assistant is not live yet — add your own API key in Settings to chat';

/**
 * The honest message for a CONFIGURED gateway that is unreachable right now (a
 * default-mode network failure past the live-gate). Distinct from "not live yet"
 * so a real deploy outage never masquerades as "never deployed".
 */
export const FREE_TIER_UNREACHABLE_MSG =
  'the free assistant is temporarily unreachable — try again in a moment, or add your own API key in Settings';

/**
 * The honest message when a user hits their PER-DAY free-tier cap (see
 * repoServer's daily limiter + freeTierLimit.ts). Surfaced as an HTTP 429 by the
 * server; the web free-tier classifier renders the "add your key" nudge for it.
 */
export const FREE_TIER_DAILY_LIMIT_MSG =
  "You've hit today's free limit — add your own API key in Settings for unlimited, or try again tomorrow.";

/**
 * Optional APP/instance token authenticating THIS app to the hosted gateway. It
 * is NOT a user secret and NOT our DeepSeek key — it is a coarse app credential
 * the deployed gateway MAY require. Read from the environment so it never ships
 * in source; absent ⇒ the gateway is called with no auth header (the mock
 * gateway accepts that). The funded key is never here — the gateway holds it.
 */
function gatewayAppToken(): string | undefined {
  const t = (process.env.SEQUENCE_GATEWAY_TOKEN ?? '').trim();
  return t === '' ? undefined : t;
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ProviderReply {
  files: GeneratedFile[];
  notes?: string;
  /** Raw model text. Key-free by construction: it is the model's *output*, not our request. */
  raw: string;
}

const ANTHROPIC_DEFAULT_HOST = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 8192;

/**
 * Hard cap on how many bytes we will read from a provider response body. The
 * `baseUrl` is attacker-influenced (a user can point it at any openai-compatible
 * host), so a hostile or misconfigured endpoint could stream a multi-GB body and
 * OOM the process / fill the disk. We stream with this budget and abort the read
 * the moment it is exceeded, surfacing a clean provider error instead.
 */
const MAX_PROVIDER_RESPONSE_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * A provider-boundary failure. `status`/`body` describe the provider's
 * *response* only — the request (and thus the key) is never captured here.
 */
export class ProviderError extends Error {
  status?: number;
  body?: string;
  /**
   * OPTIONAL HTTP status the SERVER should return for this failure. Absent ⇒ the
   * caller's default (502 for a provider-boundary failure). {@link RateLimitError}
   * sets it to 429 so an over-cap free-tier request surfaces honestly, not as a
   * provider outage.
   */
  httpStatus?: number;
  /**
   * WHAT WOULD FIX THIS, when the failure has a route out.
   *
   * Set at the THROW SITE, which is the only place that knows why. The
   * alternative is a caller matching this error's wording to decide whether a
   * fix exists, and prose is what gets edited.
   */
  fix?: 'provider';
  constructor(
    message: string,
    opts?: { status?: number; body?: string; httpStatus?: number; fix?: 'provider' },
  ) {
    super(message);
    this.name = 'ProviderError';
    this.status = opts?.status;
    this.body = opts?.body;
    this.httpStatus = opts?.httpStatus;
    if (opts?.fix !== undefined) this.fix = opts.fix;
  }
}

/**
 * A per-user free-tier DAILY cap breach. A ProviderError subclass (so every
 * existing `instanceof ProviderError` catch still handles it) that carries
 * `httpStatus:429` and the honest {@link FREE_TIER_DAILY_LIMIT_MSG}. It carries
 * NO provider body — the gateway/DeepSeek is never even contacted.
 */
export class RateLimitError extends ProviderError {
  constructor(message: string = FREE_TIER_DAILY_LIMIT_MSG) {
    super(message, { httpStatus: 429 });
    this.name = 'RateLimitError';
  }
}

/**
 * The BOUNDS each knob is validated against, in one table so the server's
 * refusal and the surface's help text cannot drift apart. Exported because the
 * settings pane's Advanced section states these numbers to the reader, and a
 * second copy of a number is a second answer.
 */
export const AI_PARAM_BOUNDS = {
  temperature: { min: 0, max: 2, integer: false },
  topP: { min: 0, max: 1, integer: false },
  maxTokens: { min: 1, max: 1_000_000, integer: true },
  timeoutMs: { min: 1_000, max: 3_600_000, integer: true },
  maxRetries: { min: 0, max: 5, integer: true },
} as const satisfies Record<NumericAiParam, { min: number; max: number; integer: boolean }>;

/**
 * The numeric half of {@link AiParams}, derived rather than written down — so a
 * new numeric param still cannot be added without stating its bounds, which is
 * the guarantee this table made before a string-valued param joined the shape.
 */
type NumericAiParam = {
  [K in keyof AiParams]-?: NonNullable<AiParams[K]> extends number ? K : never;
}[keyof AiParams];

/** Params validated against an allowed-value list rather than bounds. */
const AI_PARAM_ENUMS = {
  reasoningEffort: ['none', 'low', 'medium', 'high'],
} as const satisfies Partial<Record<keyof AiParams, readonly string[]>>;

/**
 * Strict shape-validation of {@link AiParams}.
 *
 * REFUSED, NEVER CLAMPED. A temperature of 9 silently rewritten to 2 is the
 * product deciding what the reader meant; a 400 that names the field and its
 * range is the reader deciding. An ABSENT `params` is not an empty one — the
 * empty object is dropped, so a config that carries `params:{}` still puts the
 * pre-knobs bytes on the wire.
 */
export function parseAiParams(x: unknown): { params?: AiParams; error?: string } {
  if (x === undefined || x === null) return {};
  if (typeof x !== 'object' || Array.isArray(x)) return { error: 'params must be a JSON object' };
  const o = x as Record<string, unknown>;
  const out: AiParams = {};
  for (const [key, bound] of Object.entries(AI_PARAM_BOUNDS)) {
    const v = o[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return { error: `params.${key} must be a finite number` };
    }
    if (bound.integer && !Number.isInteger(v)) {
      return { error: `params.${key} must be a whole number` };
    }
    if (v < bound.min || v > bound.max) {
      return { error: `params.${key} must be between ${bound.min} and ${bound.max}` };
    }
    (out as Record<string, number>)[key] = v;
  }
  /* Object.hasOwn, NOT `in`: `in` walks the prototype chain, so params like
     {toString: 1} or {constructor: 2} answered "known", skipped the bounds loop
     above (it iterates AI_PARAM_BOUNDS, not the input) and were dropped in silence —
     a knob the reader believes they set, which is the exact failure this refusal
     exists to remove. */
  for (const [key, allowed] of Object.entries(AI_PARAM_ENUMS)) {
    const v = o[key];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      return { error: `params.${key} must be one of: ${allowed.join(', ')}` };
    }
    (out as Record<string, string>)[key] = v;
  }
  const unknown = Object.keys(o).filter(
    (k) => !Object.hasOwn(AI_PARAM_BOUNDS, k) && !Object.hasOwn(AI_PARAM_ENUMS, k),
  );
  if (unknown.length > 0) {
    /* Named, not ignored. A knob we silently drop is a knob the reader believes
       they set — the exact failure this whole lane exists to remove. */
    return { error: `params has unsupported field(s): ${unknown.sort().join(', ')}` };
  }
  return Object.keys(out).length > 0 ? { params: out } : {};
}

/**
 * The direct-provider field rules, in ONE place.
 *
 * `validateAiConfig` used to hold these inline. A saved-profile list needs the
 * IDENTICAL rules per entry — the keyless-loopback boundary above all, since a
 * profile is just as capable of pointing repository context at another machine —
 * and a second copy of that reasoning is how the two drift. `where` prefixes the
 * message so a rejected profile says WHICH one; for the top-level config it is
 * empty, so every message is byte-identical to the one this was extracted from.
 */
function parseDirectAiFields(
  o: Record<string, unknown>,
  where = '',
): { config?: AiConfig; error?: string } {
  if (o.provider !== 'anthropic' && o.provider !== 'openai-compatible') {
    return { error: `${where}provider must be 'anthropic' or 'openai-compatible'` };
  }
  if (typeof o.model !== 'string' || o.model.trim() === '') {
    return { error: `${where}model must be a non-empty string` };
  }
  if (o.baseUrl !== undefined && typeof o.baseUrl !== 'string') {
    return { error: `${where}baseUrl must be a string when present` };
  }
  const baseUrl = typeof o.baseUrl === 'string' ? o.baseUrl.trim() : '';
  if (o.provider === 'openai-compatible' && baseUrl === '') {
    return { error: `${where}baseUrl is required for an openai-compatible provider` };
  }
  if (o.apiKey !== undefined && (typeof o.apiKey !== 'string' || o.apiKey.trim() === '')) {
    /* Absence is the keyless representation. An empty string is not: keeping
       those distinct means no later reader can mistake a placeholder or a
       cleared credential for an intentional local configuration. */
    return { error: `${where}apiKey must be a non-empty string when present` };
  }
  if (o.apiKey === undefined) {
    let keylessLoopback = false;
    if (o.provider === 'openai-compatible') {
      try {
        const url = new URL(baseUrl);
        keylessLoopback =
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          isLoopbackHost(url.hostname);
      } catch {
        /* An invalid URL is not loopback. The provider call will never see it. */
      }
    }
    if (!keylessLoopback) {
      /* Only loopback earns a keyless direct-provider config. A private-LAN
         address is still another machine and therefore a wider disclosure
         boundary for repository context. Remote providers keep requiring a
         real credential. */
      return {
        error: `${where}apiKey must be a non-empty string unless openai-compatible baseUrl points at loopback`,
      };
    }
  }
  // Model roles (MADR `docs/decisions/model-roles.md`). Parsed ONLY on the
  // api-key path — default mode is byte-identical and carries no roles. An
  // error here is caller-safe and never echoes a key.
  const parsed = parseAiRoles(o.roles);
  if (parsed.error) return { error: `${where}${parsed.error}` };
  const knobs = parseAiParams(o.params);
  if (knobs.error) return { error: `${where}${knobs.error}` };
  const config: AiConfig = {
    provider: o.provider,
    model: o.model.trim(),
  };
  if (typeof o.apiKey === 'string') {
    config.apiKey = o.apiKey; // stored verbatim; the caller writes it only to ai.json
  }
  if (baseUrl !== '') config.baseUrl = baseUrl;
  if (parsed.roles) config.roles = parsed.roles;
  if (knobs.params) config.params = knobs.params;
  return { config };
}

/** `id` characters a profile may use — url/file safe, so an id is never a trap. */
const PROFILE_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * A SAVED MODEL, BY NAME.
 *
 * Before this there was exactly one model on disk. Changing your mind meant
 * retyping the provider, the model id, the base URL and (for a remote provider)
 * the whole API key — every time. There was no memory of the model you used ten
 * minutes ago, no default to come back to, and nothing to switch BETWEEN.
 *
 * A profile is the single-config shape plus an `id` and a human `name`, and it
 * is validated by the SAME {@link parseDirectAiFields} rules — a profile earns a
 * keyless config only on loopback, exactly as a lone config does.
 */
function parseAiProfiles(o: Record<string, unknown>): { config?: AiConfig; error?: string } {
  const raw = o.profiles;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'profiles must be a non-empty array' };
  }
  const profiles: AiProfile[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    const where = `profiles[${i}]: `;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { error: `${where}must be a JSON object` };
    }
    const e = entry as Record<string, unknown>;
    const id = typeof e.id === 'string' ? e.id.trim() : '';
    if (!PROFILE_ID_RE.test(id)) {
      return { error: `${where}id must be 1-64 characters of A-Z a-z 0-9 . _ -` };
    }
    if (seen.has(id)) return { error: `${where}duplicate id '${id}'` };
    seen.add(id);
    const name = typeof e.name === 'string' ? e.name.trim() : '';
    if (name === '' || name.length > 80) {
      return { error: `${where}name must be a non-empty string of at most 80 characters` };
    }
    const parsed = parseDirectAiFields(e, where);
    if (!parsed.config) return { error: parsed.error ?? `${where}invalid profile` };
    const profile: AiProfile = {
      id,
      name,
      provider: parsed.config.provider,
      model: parsed.config.model,
    };
    if (parsed.config.baseUrl !== undefined) profile.baseUrl = parsed.config.baseUrl;
    if (parsed.config.apiKey !== undefined) profile.apiKey = parsed.config.apiKey;
    if (parsed.config.params !== undefined) profile.params = parsed.config.params;
    profiles.push(profile);
  }
  let defaultProfileId = profiles[0]!.id;
  if (o.defaultProfileId !== undefined) {
    if (typeof o.defaultProfileId !== 'string') {
      return { error: 'defaultProfileId must be a string when present' };
    }
    const wanted = o.defaultProfileId.trim();
    if (!seen.has(wanted)) {
      /* REFUSED, not silently re-pointed at the first profile. A default that
         quietly moved is the product choosing which model answers. */
      return { error: `defaultProfileId '${wanted}' names no profile` };
    }
    defaultProfileId = wanted;
  }
  const active = profiles.find((pr) => pr.id === defaultProfileId)!;
  /*
   * THE RESOLVED PROFILE *IS* THE CONFIG. Every reader downstream —
   * resolveEndpoint, both ask routes, the label pipeline — keeps seeing the flat
   * shape it always saw, so changing which profile is default changes who
   * answers the next question with no second code path to keep in step. That is
   * also why the switch is a one-field write and not a new route.
   */
  const config: AiConfig = {
    provider: active.provider,
    model: active.model,
    profiles,
    defaultProfileId,
  };
  if (active.baseUrl !== undefined) config.baseUrl = active.baseUrl;
  if (active.apiKey !== undefined) config.apiKey = active.apiKey;
  if (active.params !== undefined) config.params = active.params;
  const roles = parseAiRoles(o.roles);
  if (roles.error) return { error: roles.error };
  if (roles.roles) config.roles = roles.roles;
  return { config };
}

/**
 * The ONE-WAY migration off the single-config shape.
 *
 * A config written before profiles existed is read, used and displayed exactly
 * as before; it becomes a profile the first time anything saves a list. This is
 * what that first list looks like, so the migration is the same wherever it
 * happens.
 */
export function migrateAiConfigToProfiles(cfg: AiConfig): {
  profiles: AiProfile[];
  defaultProfileId: string;
} {
  if (cfg.profiles && cfg.profiles.length > 0) {
    return {
      profiles: cfg.profiles,
      defaultProfileId: cfg.defaultProfileId ?? cfg.profiles[0]!.id,
    };
  }
  const profile: AiProfile = {
    id: 'saved-1',
    /* The model id is the only name the reader has ever given this config, so it
       is the honest first name. They can rename it; we do not invent one. */
    name: cfg.model,
    provider: cfg.provider,
    model: cfg.model,
  };
  if (cfg.baseUrl !== undefined) profile.baseUrl = cfg.baseUrl;
  if (cfg.apiKey !== undefined) profile.apiKey = cfg.apiKey;
  if (cfg.params !== undefined) profile.params = cfg.params;
  return { profiles: [profile], defaultProfileId: profile.id };
}

/**
 * Strict shape-validation of a candidate AI config (a PUT body or an on-disk
 * ai.json). Returns `{ config }` on success or `{ error }` with a caller-safe
 * message (never echoing the key).
 */
export function validateAiConfig(x: unknown): { config?: AiConfig; error?: string } {
  if (!x || typeof x !== 'object') return { error: 'config must be a JSON object' };
  const o = x as Record<string, unknown>;
  // `mode` is OPTIONAL. Absent ⇒ api-key (the pre-v9 path, validated + stored
  // byte-identically below — NO mode field is ever added to an api-key config,
  // so every existing on-disk ai.json and every mode-less PUT is unchanged).
  if (o.mode !== undefined && o.mode !== 'api-key' && o.mode !== 'default') {
    return { error: "mode must be 'api-key' or 'default' when present" };
  }
  if (o.mode === 'default') {
    // The free metered default carries NO user key and NO user-chosen host: the
    // gateway is fixed ({@link DEFAULT_GATEWAY_URL}) and holds our funded key.
    // Only the model is (optionally) overridable, defaulting to DEFAULT_MODEL.
    if (o.model !== undefined && (typeof o.model !== 'string')) {
      return { error: 'model must be a string when present' };
    }
    const model = typeof o.model === 'string' && o.model.trim() !== '' ? o.model.trim() : DEFAULT_MODEL;
    return { config: { mode: 'default', provider: 'openai-compatible', baseUrl: DEFAULT_GATEWAY_URL, model } };
  }
  if (Array.isArray(o.profiles)) {
    /* A LIST OF SAVED MODELS. Checked before the single-config path so a config
       that carries both cannot half-apply: the list is the file's meaning. */
    return parseAiProfiles(o);
  }
  return parseDirectAiFields(o);
}

/**
 * The redacted view returned by every GET — full key never crosses the wire back
 * to a client. Mode-aware: a `'default'` config redacts to `{configured, mode,
 * model, gatewayLive}` with NO key field at all (there is no user key to mask —
 * the funded key lives only in the hosted gateway). A keyed direct config
 * redacts exactly as before (no `mode` field, `••••`+last4 mask). A keyless
 * loopback config has no `apiKey` field at all, preserving the distinction
 * between no credential and a real credential.
 *
 * `gatewayLive` is the SAME server-side knowledge {@link requestModelText} gates
 * on: true only when a gateway/DeepSeek seam was actually configured for this
 * process (the stamp repoServer's loadAiConfig applies). The web's free-tier
 * honesty check reads it, so without it a genuinely deployed gateway still read
 * "not live" in the UI — and a dead one could read live. It is a BOOLEAN ONLY:
 * never the funded key, never the gateway URL, never any user secret.
 */
/** A profile as it leaves the server: same fields, `apiKey` masked or absent. */
export interface RedactedAiProfile {
  id: string;
  name: string;
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  /** Masked when the profile stores a key; ABSENT for a keyless loopback profile. */
  apiKey?: string;
  params?: AiParams;
}

export function redactAiConfig(
  cfg: AiConfig
):
  | { configured: true; mode: 'default'; model: string; gatewayLive: boolean }
  | {
      configured: true;
      provider: ProviderKind;
      baseUrl?: string;
      model: string;
      /** Masked when configured; absent for an intentional keyless loopback config. */
      apiKey?: string;
      roles?: Partial<Record<AiRoleId, { model: string; provider?: ProviderKind; baseUrl?: string; apiKey?: string }>>;
      /** The knobs, verbatim — {@link AiParams} holds no secret. */
      params?: AiParams;
      /** Every saved model, keys masked. Absent when none were ever saved. */
      profiles?: RedactedAiProfile[];
      defaultProfileId?: string;
    } {
  if ((cfg.mode ?? 'api-key') === 'default') {
    return { configured: true, mode: 'default', model: cfg.model, gatewayLive: cfg.gatewayLive === true };
  }
  const out: {
    configured: true;
    provider: ProviderKind;
    baseUrl?: string;
    model: string;
    apiKey?: string;
    roles?: Partial<Record<AiRoleId, { model: string; provider?: ProviderKind; baseUrl?: string; apiKey?: string }>>;
    params?: AiParams;
    profiles?: RedactedAiProfile[];
    defaultProfileId?: string;
  } = {
    configured: true,
    provider: cfg.provider,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
  };
  if (cfg.apiKey !== undefined) {
    out.apiKey = maskApiKey(cfg.apiKey);
  }
  if (cfg.roles) {
    const redacted: Partial<Record<AiRoleId, { model: string; provider?: ProviderKind; baseUrl?: string; apiKey?: string }>> = {};
    for (const [id, binding] of Object.entries(cfg.roles) as [AiRoleId, AiRoleBinding][]) {
      const r: { model: string; provider?: ProviderKind; baseUrl?: string; apiKey?: string } = { model: binding.model };
      if (binding.provider !== undefined) r.provider = binding.provider;
      if (binding.baseUrl !== undefined) r.baseUrl = binding.baseUrl;
      if (binding.apiKey !== undefined) {
        r.apiKey = maskApiKey(binding.apiKey);
      }
      redacted[id] = r;
    }
    out.roles = redacted;
  }
  /* Carried, not masked: a temperature is not a credential, and a settings pane
     that cannot read back what it stored is a form the reader has to remember
     for. Absent stays absent — an empty `params` would read as "knobs set". */
  if (cfg.params && Object.keys(cfg.params).length > 0) out.params = { ...cfg.params };
  /*
   * THE LIST GOES OUT; THE KEYS DO NOT. Same asymmetry the single config has
   * always had — a client can see WHICH models are saved and which one answers,
   * and can never read a credential back. A picker needs exactly this and
   * nothing more.
   */
  if (cfg.profiles && cfg.profiles.length > 0) {
    out.profiles = cfg.profiles.map((pr) => {
      const view: RedactedAiProfile = {
        id: pr.id,
        name: pr.name,
        provider: pr.provider,
        model: pr.model,
      };
      if (pr.baseUrl !== undefined) view.baseUrl = pr.baseUrl;
      if (pr.apiKey !== undefined) view.apiKey = maskApiKey(pr.apiKey);
      if (pr.params && Object.keys(pr.params).length > 0) view.params = { ...pr.params };
      return view;
    });
    out.defaultProfileId = cfg.defaultProfileId ?? cfg.profiles[0]!.id;
  }
  return out;
}

/** The prefix every masked key carries. One definition, so the writer and the
    reader of a mask can never disagree about what one looks like. */
export const API_KEY_MASK_PREFIX = '••••';

/**
 * Is this string a REDACTED key rather than a real one?
 *
 * GET returns every key masked, so the Settings panel only ever holds masks. When it
 * PUTs a profile list back, a mask arrives where a credential used to be — and a mask
 * is a non-empty string, so "did the client send a key?" answered YES and wrote
 * "••••9f3a" over a working credential. Editing a profile’s NAME silently
 * destroyed its key. Treat a mask as "no key supplied" and re-attach the stored one.
 */
export function isMaskedApiKey(value: string): boolean {
  return value.startsWith(API_KEY_MASK_PREFIX);
}

function maskApiKey(key: string): string {
  return API_KEY_MASK_PREFIX + (key.length >= 4 ? key.slice(-4) : '');
}

/** Build the generate prompt: the brief plus the strict return-shape contract. */
export function buildGeneratePrompt(brief: string, userPrompt?: string): string {
  const L: string[] = [];
  L.push('You are a code-scaffolding agent. Implement the architecture described by the brief below by producing source files.');
  L.push('');
  L.push('Return ONLY a single JSON object, and nothing else — no prose, no markdown code fences. The object must have this exact shape:');
  L.push('{"files": [{"path": "<repo-relative path>", "content": "<full file contents>"}], "notes": "<optional summary>"}');
  L.push('');
  L.push('Hard rules for `path`: it is relative to the repo root, uses forward slashes, is never absolute, never contains ".." segments, and never writes into ".sequence/" or ".git/".');
  if (userPrompt && userPrompt.trim() !== '') {
    L.push('');
    L.push('Additional instructions from the user (apply within the constraints above):');
    L.push(userPrompt.trim());
  }
  L.push('');
  L.push('--- BRIEF ---');
  L.push(brief);
  return L.join('\n');
}

/** Build the "point at a file and prompt" prompt: the file plus the same return contract. */
export function buildPromptFilePrompt(filePath: string, fileContent: string, userPrompt: string): string {
  const L: string[] = [];
  L.push('You are editing files in a repository. Apply the user\'s instruction to the file below.');
  L.push('');
  L.push('Return ONLY a single JSON object, and nothing else — no prose, no markdown code fences — with this exact shape:');
  L.push('{"files": [{"path": "<repo-relative path>", "content": "<full new file contents>"}], "notes": "<optional summary>"}');
  L.push('Usually you will return just the one file below with updated content, but you may return several if the change requires it.');
  L.push('');
  L.push('Hard rules for `path`: relative to the repo root, forward slashes, never absolute, never containing ".." segments, never writing into ".sequence/" or ".git/".');
  L.push('');
  L.push('User instruction:');
  L.push(userPrompt.trim());
  L.push('');
  L.push(`--- FILE: ${filePath} ---`);
  L.push(fileContent);
  return L.join('\n');
}

/** Structured tool_calls from an openai-compatible buffered reply (B2.2). */
export interface ProviderToolRequest {
  id: string;
  name: string;
  args?: Record<string, unknown>;
}

function extractOpenAiToolRequests(parsed: unknown): ProviderToolRequest[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return [];
  const msg = (choices[0] as { message?: { tool_calls?: unknown } })?.message;
  const calls = msg?.tool_calls;
  if (!Array.isArray(calls)) return [];
  const out: ProviderToolRequest[] = [];
  for (const raw of calls) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as {
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const id = typeof c.id === 'string' && c.id.trim() ? c.id.trim() : '';
    const name =
      typeof c.function?.name === 'string' && c.function.name.trim()
        ? c.function.name.trim()
        : '';
    if (!id || !name) continue;
    let args: Record<string, unknown> | undefined;
    const argRaw = c.function?.arguments;
    if (typeof argRaw === 'string' && argRaw.trim()) {
      try {
        const parsedArgs = JSON.parse(argRaw) as unknown;
        if (parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)) {
          args = parsedArgs as Record<string, unknown>;
        }
      } catch {
        /* malformed args — still surface the call; executor will refuse */
      }
    } else if (argRaw && typeof argRaw === 'object' && !Array.isArray(argRaw)) {
      args = argRaw as Record<string, unknown>;
    }
    out.push(args ? { id, name, args } : { id, name });
  }
  return out;
}

/**
 * The SAME tool registry, on the Anthropic Messages wire.
 *
 * Why this exists. Native tool definitions were attached ONLY on the
 * openai-compatible wire, and Anthropic `tool_use` blocks were never parsed. So
 * a user on claude-sonnet — the model most reliable at structured tool calling —
 * ran the whole agent loop on regex fence salvage, while a user on a local
 * granite4 got first-class native calls. Model-agnosticism was inverted: which
 * harness you got depended on a provider choice made for unrelated reasons.
 *
 * ONE REGISTRY, TWO SHAPES. Nothing here invents a tool. The input is exactly
 * the `openaiAskToolDefinitions()` array repoServer already builds for every
 * attached repo (and then dropped on the floor for anthropic); this is the
 * field rename Anthropic's schema asks for — `function.parameters` is
 * `input_schema`, and the `type:'function'` envelope goes away.
 *
 * `tool_choice` is deliberately NOT sent: absent means auto on this wire, and
 * an omitted field is one fewer thing a proxy can reject.
 */
/**
 * The anthropic `content` for one user prompt, split at the caching breakpoint.
 *
 * No breakpoint ⇒ the plain string, byte-identical to the pre-caching body.
 * A breakpoint at or past the end marks the WHOLE prompt cacheable — that is
 * round 1 of a tool loop, whose job is to WRITE the cache the later rounds
 * read; returning a plain string there would mean no round ever pays the
 * write and no round ever gets the read. Anthropic ignores markers on
 * prefixes below its own minimum (1,024 tokens), which is the right failure:
 * a too-small cache is declined by the provider, not mis-billed by us.
 */
export function anthropicPromptContent(
  prompt: string,
  breakpointChars?: number,
):
  | string
  | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> {
  if (breakpointChars === undefined || breakpointChars <= 0) return prompt;
  if (breakpointChars >= prompt.length) {
    return [{ type: 'text', text: prompt, cache_control: { type: 'ephemeral' } }];
  }
  return [
    { type: 'text', text: prompt.slice(0, breakpointChars), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: prompt.slice(breakpointChars) },
  ];
}

export function anthropicToolDefinitions(
  tools: ReadonlyArray<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>,
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/**
 * Structured `tool_use` blocks from an Anthropic buffered reply.
 *
 * The mirror of {@link extractOpenAiToolRequests}, and deliberately as strict:
 * a block missing an id or a name is SKIPPED rather than repaired, and a
 * non-object `input` yields no args rather than a guessed shape — the executor
 * refuses a bad shape honestly, which is the behaviour we want to reach.
 */
function extractAnthropicToolRequests(parsed: unknown): ProviderToolRequest[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const content = (parsed as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const out: ProviderToolRequest[] = [];
  for (const raw of content) {
    if (!raw || typeof raw !== 'object') continue;
    const b = raw as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
    if (b.type !== 'tool_use') continue;
    const id = typeof b.id === 'string' && b.id.trim() ? b.id.trim() : '';
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : '';
    if (!id || !name) continue;
    const input = b.input;
    const args =
      input && typeof input === 'object' && !Array.isArray(input)
        ? (input as Record<string, unknown>)
        : undefined;
    out.push(args && Object.keys(args).length > 0 ? { id, name, args } : { id, name });
  }
  return out;
}

/** Tool requests off a buffered reply, whichever wire produced it. */
function extractToolRequests(wire: ProviderKind, parsed: unknown): ProviderToolRequest[] {
  return wire === 'anthropic'
    ? extractAnthropicToolRequests(parsed)
    : extractOpenAiToolRequests(parsed);
}

/** Pull the assistant's text out of either wire shape's response body. */
function extractModelText(provider: ProviderKind, parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const o = parsed as Record<string, unknown>;
  if (provider === 'anthropic') {
    const content = o.content;
    if (!Array.isArray(content)) return undefined;
    const parts = content
      .filter((c): c is { type: string; text: string } =>
        !!c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' &&
        typeof (c as { text?: unknown }).text === 'string')
      .map((c) => c.text);
    return parts.length > 0 ? parts.join('') : undefined;
  }
  // openai-compatible
  const choices = o.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const msg = (choices[0] as { message?: { content?: unknown } })?.message;
  if (!msg) return undefined;
  if (typeof msg.content === 'string') return msg.content;
  /*
   * Some OpenAI-compatible gateways (measured: OpenRouter free-tier backends,
   * 2026-08-29, two SWE-bench turns lost to it) return `content` as an array
   * of typed parts rather than a string. That is still assistant text; refusing
   * it killed the whole turn. Reasoning-only replies stay unread on purpose —
   * see the streaming path's reasoning_content note.
   */
  if (Array.isArray(msg.content)) {
    const parts = msg.content
      .filter((c): c is { type: string; text: string } =>
        !!c && typeof c === 'object' && (c as { type?: unknown }).type === 'text' &&
        typeof (c as { text?: unknown }).text === 'string')
      .map((c) => c.text);
    if (parts.length > 0) return parts.join('');
  }
  return undefined;
}

/**
 * Read a fetch response body as text, aborting once `max` bytes have been seen.
 * Streaming (rather than `res.text()`) is what bounds memory: an unbounded body
 * can never be fully buffered. Throws a {@link ProviderError} on breach.
 */
async function readCappedText(res: Response, max: number): Promise<string> {
  const body = res.body;
  // No stream available (shouldn't happen for a real fetch response). Fall back
  // to text() only when there is genuinely nothing to stream, so we never call
  // the unbounded reader on an attacker-influenced body.
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.length;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new ProviderError(`provider response exceeded the ${max}-byte cap`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/* -------------------------------------------------------------------------- */
/* TOKEN STREAMING (v2 build item 1.2 — gap G2 / PAR P1)                       */
/* -------------------------------------------------------------------------- */

/**
 * Why this exists. Before this, every provider call was `await fetch(...)` then
 * `await readCappedText(...)`: the caller saw nothing at all until generation
 * finished, so **time-to-first-token was time-to-last-token on every ask**. That
 * was measured, not assumed — against a mock that stalled 400 ms mid-answer, the
 * unmodified path produced 0 delta callbacks and its first observable moment was
 * 416 ms of a 416 ms call.
 *
 * THE INVARIANT THIS CODE IS BUILT AROUND:
 *
 *     the text returned IS the concatenation, in emission order, of the deltas
 *     already handed to the caller.
 *
 * Not "equal if you check at the end" — the same string, accumulated exactly
 * once, in {@link StreamDeltaAccumulator.emit}. Nothing here reconstructs the
 * answer from a second source (a terminal `message` frame, a re-join of the
 * per-index parts), because a second source is a second answer, and the two can
 * disagree about what the user actually watched appear. That single property is
 * what makes a transcript replayable from deltas a client already rendered —
 * ml-harness gets replay for free because its stored assistant message is
 * `"".join(text_parts)` (ml-harness-adoption.md §1.1).
 *
 * Frames are reassembled by an INDEX-KEYED accumulator rather than by arrival
 * order alone. Both wires number their parts (`content_block_*.index`,
 * `choices[].index`) and both may interleave; the index is how we know what a
 * fragment *is* — prose, a tool call's arguments, or a second sampled choice.
 * We still *emit* in arrival order, because arrival order is what the reader
 * sees. A tool call's `input_json_delta` is never emitted as prose: "we never
 * emulate tool calling by parsing JSON out of prose" (ibid. §1.2).
 *
 * Nothing is guessed. A malformed frame is counted and skipped, never repaired.
 * An `error` frame on the stream is raised as a {@link ProviderError}, never
 * returned as an empty answer. A provider that ignores `stream:true` and sends
 * an ordinary JSON body is parsed the ordinary way (see the fallback in
 * {@link requestModelTextWithUsage}) rather than reported as silence.
 */

/** Options for a single provider wire call. */
export interface ProviderStreamOptions {
  /**
   * Called with each text delta as it arrives, in order.
   *
   * PRESENCE OF THIS CALLBACK IS WHAT TURNS STREAMING ON. A caller that does not
   * pass it sends byte-identical request bytes to the pre-streaming build — no
   * `stream` field, no `accept: text/event-stream` — so every existing call site
   * is unchanged by construction rather than by review.
   */
  onDelta?: (delta: string) => void;
  /**
   * When aborted, the outbound `fetch` is cancelled and the call rejects with an
   * `AbortError`. Callers that race an HTTP request's abort signal (repoServer's
   * `raceAbort`) pass the same signal here so the provider stops generating.
   */
  signal?: AbortSignal;
  /**
   * Function tools, in the OpenAI shape, for EITHER wire.
   *
   * B2.2 attached these only when the wire was openai-compatible. They are now
   * attached on both: the anthropic branch reshapes them through
   * {@link anthropicToolDefinitions} (same registry, `input_schema` instead of
   * `function.parameters`) and its `tool_use` blocks are parsed back into
   * {@link ProviderToolRequest} on both the buffered and streamed paths.
   *
   * Absent ⇒ request body matches the pre-tools shape (local servers that
   * reject unknown fields keep working).
   */
  tools?: ReadonlyArray<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  /**
   * PROMPT CACHING — where the turn's INVARIANT PREFIX ends, in characters.
   *
   * The ask loop rebuilds its prompt each round as `stable prefix + this
   * round's tool results`, so an eight-round question re-sends the same ~10k
   * tokens eight times. On the anthropic wire this offset becomes a
   * `cache_control: ephemeral` breakpoint (round 1 writes the cache, rounds
   * 2+ read it at a tenth of the input price). The openai-compatible wire
   * caches identical prefixes automatically server-side, so nothing is added
   * to that body — the field is simply ignored there.
   *
   * Absent ⇒ the request body is byte-identical to the pre-caching shape.
   */
  cacheBreakpointChars?: number;
}

/**
 * A minimal, correct SSE frame reassembler (WHATWG event-stream framing).
 *
 * It exists rather than a `split('\n\n')` because the three things that break a
 * naive splitter all occur on real provider streams: a frame arrives split
 * across two TCP reads, lines arrive CRLF-terminated, and one logical payload
 * may span several `data:` lines which the spec joins with `\n`. Fields other
 * than `data` (`event:`, `id:`, `retry:`) and `:` comment keep-alives carry no
 * payload for either wire we speak — both put a `type`/`object` discriminator
 * inside the JSON — so they are dropped rather than interpreted.
 */
export class SseFrameParser {
  private buf = '';
  private data: string[] = [];
  private out: string[] = [];

  /** Feed decoded text; returns the `data` payloads completed by this chunk. */
  push(chunk: string): string[] {
    this.out = [];
    this.buf += chunk;
    for (;;) {
      const nl = this.buf.indexOf('\n');
      if (nl < 0) break;
      let line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.line(line);
    }
    return this.out;
  }

  /**
   * Flush at end-of-body. Some servers close without the terminating blank line;
   * dropping that last frame would silently lose the tail of an answer.
   */
  end(): string[] {
    this.out = [];
    if (this.buf !== '') {
      let line = this.buf;
      this.buf = '';
      if (line.endsWith('\r')) line = line.slice(0, -1);
      this.line(line);
    }
    this.dispatch();
    return this.out;
  }

  private line(line: string): void {
    if (line === '') {
      this.dispatch();
      return;
    }
    if (line.startsWith(':')) return; // comment / keep-alive
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    if (field !== 'data') return;
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1); // one optional space, per spec
    this.data.push(value);
  }

  private dispatch(): void {
    if (this.data.length === 0) return;
    const payload = this.data.join('\n');
    this.data = [];
    if (payload !== '') this.out.push(payload);
  }
}

/** Provider-authored error text off a stream frame. Never contains our request. */
function streamErrorDetail(e: unknown): string {
  if (typeof e === 'string' && e.trim() !== '') return e;
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim() !== '') return m;
    try {
      return JSON.stringify(e);
    } catch {
      /* fall through */
    }
  }
  return 'the provider reported an error on the stream';
}

/**
 * Reassemble one provider stream into text + usage. See the module note above
 * for the invariant; `text` is only ever appended to inside {@link emit}.
 */
export class StreamDeltaAccumulator {
  private readonly wire: ProviderKind;
  /** index → the kind of content block that index carries (anthropic). */
  private readonly blockKind = new Map<number, string>();
  /** index → text seen for that part. Index-keyed so parts cannot cross-contaminate. */
  private readonly parts = new Map<number, string>();
  private rawUsage: Record<string, unknown> = {};
  private sawUsage = false;
  private out = '';
  private frameCount = 0;
  private badFrames = 0;
  private streamError: string | undefined;
  private textPartSeen = false;
  /**
   * Tool calls assembled by stream index — openai `tool_calls` (B2.2) AND
   * anthropic `tool_use` content blocks, which arrive as a `content_block_start`
   * carrying `{id,name}` followed by `input_json_delta` fragments of the
   * arguments. ONE map because the assembly is the same problem: an id, a name,
   * and a JSON string arriving in pieces. The getter below is unchanged and is
   * the only place either wire's parts become a request.
   */
  private toolCallParts = new Map<
    number,
    { id: string; name: string; arguments: string }
  >();

  constructor(wire: ProviderKind) {
    this.wire = wire;
  }

  /** The answer: exactly the concatenation of every delta {@link push} returned. */
  get text(): string {
    return this.out;
  }
  /** JSON frames understood. `[DONE]` is a sentinel, not a frame, and is not counted. */
  get frames(): number {
    return this.frameCount;
  }
  /** Frames that were not parseable JSON. Counted so silence can be explained. */
  get malformedFrames(): number {
    return this.badFrames;
  }
  /** An `error` frame the provider put on the stream, if any. */
  get error(): string | undefined {
    return this.streamError;
  }
  /**
   * Whether the stream ever carried a TEXT part at all — an opened text block, or
   * a string `content` on choice 0, even an empty one.
   *
   * This is what keeps the two paths from disagreeing about a wordless turn. The
   * buffered reader throws "could not locate assistant text" when a reply has no
   * text part (openai sends `content: null` on a tool-calls-only turn; anthropic
   * sends no text block). Without this flag the streamed path would return `''`
   * for exactly that reply — an empty answer with no explanation, which is the
   * silent-turn failure ml-harness names. An empty string is a different fact
   * from no text at all, and only this distinguishes them.
   */
  get sawTextPart(): boolean {
    return this.textPartSeen;
  }
  /** Structured tool_calls accumulated from openai stream deltas (B2.2). */
  get toolRequests(): ProviderToolRequest[] {
    const out: ProviderToolRequest[] = [];
    const indices = [...this.toolCallParts.keys()].sort((a, b) => a - b);
    for (const i of indices) {
      const part = this.toolCallParts.get(i)!;
      if (!part.id || !part.name) continue;
      let args: Record<string, unknown> | undefined;
      if (part.arguments.trim()) {
        try {
          const parsed = JSON.parse(part.arguments) as unknown;
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          /* leave args undefined — executor refuses bad shapes honestly */
        }
      }
      out.push(args ? { id: part.id, name: part.name, args } : { id: part.id, name: part.name });
    }
    return out;
  }
  /** Provider-reported usage assembled from the stream's usage frames. */
  get usage(): ExtractedProviderUsage | undefined {
    if (!this.sawUsage) return undefined;
    return extractProviderUsage(this.wire, { usage: this.rawUsage });
  }

  /** Feed one SSE payload; returns the text deltas it produced (usually 0 or 1). */
  push(payload: string): string[] {
    const s = payload.trim();
    if (s === '' || s === '[DONE]') return [];
    let frame: unknown;
    try {
      frame = JSON.parse(s);
    } catch {
      // Skipped, not repaired. Repairing a truncated frame would be inventing
      // content, which is the failure this whole layer exists to avoid.
      this.badFrames++;
      return [];
    }
    if (!frame || typeof frame !== 'object') {
      this.badFrames++;
      return [];
    }
    this.frameCount++;
    return this.wire === 'anthropic'
      ? this.pushAnthropic(frame as Record<string, unknown>)
      : this.pushOpenAi(frame as Record<string, unknown>);
  }

  /** The ONLY place `text` grows. Returns exactly what the caller will be handed. */
  private emit(index: number, text: string): string[] {
    if (text === '') return [];
    this.parts.set(index, (this.parts.get(index) ?? '') + text);
    this.out += text;
    return [text];
  }

  private mergeUsage(u: unknown): void {
    if (!u || typeof u !== 'object') return;
    for (const [k, v] of Object.entries(u as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      this.rawUsage[k] = v;
    }
    this.sawUsage = true;
  }

  private pushAnthropic(f: Record<string, unknown>): string[] {
    const type = typeof f.type === 'string' ? f.type : '';
    if (type === 'error') {
      this.streamError = streamErrorDetail(f.error);
      return [];
    }
    if (type === 'message_start') {
      const msg = f.message;
      if (msg && typeof msg === 'object') this.mergeUsage((msg as Record<string, unknown>).usage);
      return [];
    }
    if (type === 'message_delta') {
      // Carries the FINAL output_tokens; merging lets it overwrite message_start's
      // provisional count rather than leaving a number that is wrong by design.
      this.mergeUsage(f.usage);
      return [];
    }
    const index = typeof f.index === 'number' && Number.isInteger(f.index) ? f.index : 0;
    if (type === 'content_block_start') {
      const block = f.content_block;
      const kind =
        block && typeof block === 'object' ? (block as { type?: unknown }).type : undefined;
      const blockKind = typeof kind === 'string' ? kind : 'text';
      this.blockKind.set(index, blockKind);
      if (blockKind === 'text') this.textPartSeen = true;
      if (blockKind === 'tool_use' && block && typeof block === 'object') {
        // The id and the name arrive HERE and nowhere else on this wire; the
        // arguments follow as `input_json_delta` fragments against this index.
        const b = block as { id?: unknown; name?: unknown };
        const prev = this.toolCallParts.get(index) ?? { id: '', name: '', arguments: '' };
        if (typeof b.id === 'string' && b.id) prev.id = b.id;
        if (typeof b.name === 'string' && b.name) prev.name = b.name;
        this.toolCallParts.set(index, prev);
      }
      return [];
    }
    if (type === 'content_block_delta') {
      const d = f.delta;
      if (!d || typeof d !== 'object') return [];
      const delta = d as Record<string, unknown>;
      // A tool call's arguments are ACCUMULATED, never emitted. They are not
      // prose and must never reach `onDelta`: "we never emulate tool calling by
      // parsing JSON out of prose" cuts both ways. Gated on the block kind we
      // recorded at content_block_start as well as on the delta's own type, so a
      // server that mislabels one of the two still cannot leak arguments as text.
      if (delta.type === 'input_json_delta' || this.blockKind.get(index) === 'tool_use') {
        if (typeof delta.partial_json === 'string' && this.blockKind.get(index) === 'tool_use') {
          const prev = this.toolCallParts.get(index) ?? { id: '', name: '', arguments: '' };
          prev.arguments += delta.partial_json;
          this.toolCallParts.set(index, prev);
        }
        return [];
      }
      // Two independent gates on the same fact. `input_json_delta` (a tool call's
      // arguments) fails the first; a server that mislabels its delta type still
      // fails the second, because we recorded what block this index opened.
      if (delta.type !== 'text_delta' || typeof delta.text !== 'string') return [];
      const kind = this.blockKind.get(index);
      if (kind !== undefined && kind !== 'text') return [];
      this.textPartSeen = true;
      return this.emit(index, delta.text);
    }
    return [];
  }

  private pushOpenAi(f: Record<string, unknown>): string[] {
    if (f.error) {
      this.streamError = streamErrorDetail(f.error);
      return [];
    }
    if (f.usage) this.mergeUsage(f.usage);
    const choices = f.choices;
    if (!Array.isArray(choices)) return [];
    const emitted: string[] = [];
    for (let i = 0; i < choices.length; i++) {
      const c = choices[i];
      if (!c || typeof c !== 'object') continue;
      const choice = c as Record<string, unknown>;
      const index = typeof choice.index === 'number' && Number.isInteger(choice.index) ? choice.index : i;
      const d = choice.delta;
      if (!d || typeof d !== 'object') continue;
      const delta = d as Record<string, unknown>;
      // B2.2 — accumulate tool_calls by their own index (not choice index).
      const toolCalls = delta.tool_calls;
      if (Array.isArray(toolCalls)) {
        for (const raw of toolCalls) {
          if (!raw || typeof raw !== 'object') continue;
          const tc = raw as {
            index?: unknown;
            id?: unknown;
            function?: { name?: unknown; arguments?: unknown };
          };
          const tcIndex =
            typeof tc.index === 'number' && Number.isInteger(tc.index) ? tc.index : 0;
          const prev = this.toolCallParts.get(tcIndex) ?? { id: '', name: '', arguments: '' };
          if (typeof tc.id === 'string' && tc.id) prev.id = tc.id;
          if (typeof tc.function?.name === 'string' && tc.function.name) {
            prev.name = tc.function.name;
          }
          if (typeof tc.function?.arguments === 'string') {
            prev.arguments += tc.function.arguments;
          }
          this.toolCallParts.set(tcIndex, prev);
        }
      }
      const content = delta.content;
      // `reasoning_content` (DeepSeek-R1 and friends) is deliberately NOT read:
      // the non-streaming extractor returns `message.content` alone, so folding
      // reasoning in here would make the two paths answer differently.
      if (typeof content !== 'string') continue; // `null` on a tool-calls-only turn
      if (index === 0) this.textPartSeen = true;
      if (content === '') continue;
      if (index !== 0) {
        // A second sampled choice is recorded but never emitted: `extractModelText`
        // reads `choices[0]`, and the streamed answer must be the same answer.
        this.parts.set(index, (this.parts.get(index) ?? '') + content);
        continue;
      }
      emitted.push(...this.emit(index, content));
    }
    return emitted;
  }
}

/**
 * Read an SSE response body, handing each text delta to `onDelta` as it arrives,
 * under the same {@link MAX_PROVIDER_RESPONSE_BYTES} budget the buffered reader
 * enforces — a hostile `baseUrl` must not be able to stream us to death either.
 *
 * `raw` is retained ONLY until the first real frame proves this is a stream. A
 * provider that ignored `stream:true` needs its whole body to be parsed the
 * ordinary way; a provider that is streaming does not, so we stop keeping it.
 */
async function readCappedStream(
  res: Response,
  wire: ProviderKind,
  onDelta: (delta: string) => void,
  max: number,
): Promise<{ acc: StreamDeltaAccumulator; raw: string }> {
  const acc = new StreamDeltaAccumulator(wire);
  const parser = new SseFrameParser();
  const body = res.body;
  if (!body) return { acc, raw: '' };
  const reader = body.getReader();
  // `stream: true` on decode is what stops a multi-byte character that straddles
  // a chunk boundary from decoding to U+FFFD — a corruption no assertion on the
  // final text would explain, since the bytes on the wire were correct.
  const decoder = new TextDecoder('utf-8');
  let raw = '';
  let keepRaw = true;
  let size = 0;
  // Set only on a clean end-of-body. Anything else — a cap breach, a caller's
  // onDelta throwing — leaves a half-read response holding its socket open, so
  // the abnormal exit cancels rather than merely unlocking.
  let drained = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.length;
      if (size > max) {
        await reader.cancel().catch(() => {});
        throw new ProviderError(`provider response exceeded the ${max}-byte cap`);
      }
      const text = decoder.decode(value, { stream: true });
      if (text === '') continue;
      if (keepRaw) raw += text;
      for (const payload of parser.push(text)) {
        for (const delta of acc.push(payload)) onDelta(delta);
      }
      if (keepRaw && acc.frames > 0) {
        keepRaw = false;
        raw = '';
      }
    }
    const tail = decoder.decode();
    if (tail !== '') {
      if (keepRaw) raw += tail;
      for (const payload of parser.push(tail)) {
        for (const delta of acc.push(payload)) onDelta(delta);
      }
    }
    for (const payload of parser.end()) {
      for (const delta of acc.push(payload)) onDelta(delta);
    }
    drained = true;
  } finally {
    if (!drained) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return { acc, raw: acc.frames > 0 ? '' : raw };
}

/**
 * Join an OpenAI-compatible base with `/chat/completions` without doubling `/v1`.
 * Docs (and Connect AI) use bases like `https://openrouter.ai/api/v1` — appending
 * `/v1/chat/completions` again yields HTTP 404. Bases without `/v1` (DeepSeek,
 * many local servers) still get `/v1/chat/completions`.
 */
export function openaiCompatChatUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** True when `baseUrl` points at OpenRouter (BYO aggregator). */
export function isOpenRouterBase(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.replace(/^www\./, '').toLowerCase() === 'openrouter.ai';
  } catch {
    return /openrouter\.ai/i.test(baseUrl);
  }
}

/**
 * OpenRouter wants namespaced ids (`deepseek/deepseek-v4-flash`). Sequence's free
 * default alias `deepseek-v4-flash` is remapped so a pasted OpenRouter key + the
 * Connect AI default model string still hit a real model (bare id → HTTP 404).
 */
export function openRouterModelId(model: string): string {
  const m = model.trim();
  if (m === '' || m === DEFAULT_MODEL || m === 'deepseek-v4-flash') {
    return 'deepseek/deepseek-v4-flash';
  }
  return m;
}

/**
 * Optional Connect-AI form prefill from process env. NEVER includes the key —
 * only provider/base/model + which env var holds the secret. Checked in order:
 *   - `OPENROUTER_API_KEY` (+ optional `OPENROUTER_BASE_URL`, `OPENROUTER_MODEL` / `SEQUENCE_AI_MODEL`)
 *   - `SEQUENCE_AI_KEY` (+ optional `SEQUENCE_AI_PROVIDER`, `SEQUENCE_AI_BASE_URL`, `SEQUENCE_AI_MODEL`)
 */
export interface AiEnvPrefill {
  provider: ProviderKind;
  baseUrl?: string;
  model: string;
  /** Env var name that holds the key — never the key value. */
  keyEnv: string;
}

export function readAiEnvPrefill(env: NodeJS.ProcessEnv = process.env): AiEnvPrefill | undefined {
  const orKey = (env.OPENROUTER_API_KEY ?? '').trim();
  if (orKey !== '') {
    const base = (env.OPENROUTER_BASE_URL ?? '').trim() || 'https://openrouter.ai/api/v1';
    const model =
      (env.SEQUENCE_AI_MODEL ?? '').trim() ||
      (env.OPENROUTER_MODEL ?? '').trim() ||
      'deepseek/deepseek-v4-flash';
    return { provider: 'openai-compatible', baseUrl: base.replace(/\/+$/, ''), model, keyEnv: 'OPENROUTER_API_KEY' };
  }
  const seqKey = (env.SEQUENCE_AI_KEY ?? '').trim();
  if (seqKey === '') return undefined;
  const provider: ProviderKind =
    (env.SEQUENCE_AI_PROVIDER ?? '').trim() === 'openai-compatible' ? 'openai-compatible' : 'anthropic';
  const baseUrl = (env.SEQUENCE_AI_BASE_URL ?? '').trim() || undefined;
  if (provider === 'openai-compatible' && !baseUrl) return undefined;
  const model =
    (env.SEQUENCE_AI_MODEL ?? '').trim() ||
    (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'deepseek/deepseek-v4-flash');
  const out: AiEnvPrefill = { provider, model, keyEnv: 'SEQUENCE_AI_KEY' };
  if (baseUrl) out.baseUrl = baseUrl.replace(/\/+$/, '');
  return out;
}

/** Build a full AiConfig from env (server-side only — carries the real key). */
/**
 * AN UNSERVABLE FREE TIER DOES NOT OUTRANK A KEY THE USER ACTUALLY GAVE US.
 *
 * `mode: 'default'` means "use the free assistant". When neither DeepSeek nor a
 * gateway is configured, that assistant DOES NOT EXIST and the only thing left
 * to do is refuse — with "add your own API key in Settings to chat". If
 * `SEQUENCE_AI_KEY` and friends are set, that sentence is false: the user added
 * a key and is being told to add a key.
 *
 * FOUND BY DRIVING THE REAL CLI. `sequence ask` says "no AI provider configured
 * — set SEQUENCE_AI_KEY (with SEQUENCE_AI_PROVIDER / SEQUENCE_AI_BASE_URL /
 * SEQUENCE_AI_MODEL)". Setting exactly those four turned the refusal into a
 * DIFFERENT refusal, because the env fallback was gated on "is there any config
 * at all" and a default-mode file — whose whole meaning is "I have not chosen a
 * provider" — counted as one.
 *
 * IT LIVES HERE BECAUSE IT WAS ABOUT TO LIVE IN TWO PLACES. `repoServer.ts`'s
 * `loadAiConfig` and `askCli.ts`'s `loadAskAiConfig` each implement this
 * precedence, and the CLI's own comment concedes the duplication: "Restated here
 * rather than imported because `loadAiConfig` is a closure inside
 * `createRepoServer`... but the ORDER is the contract, and a headless answer
 * that used a different key from the app's would be a genuinely confusing bug."
 * That is exactly what happened when the server half was fixed alone — the app
 * worked and the CLI still refused. One rule, one function, both callers.
 *
 * NARROW ON PURPOSE. An `api-key` config is a real choice and is never
 * overridden: a stray environment variable must not silently redirect a user's
 * own key or host. Only an unservable default falls through, and that is a state
 * which could otherwise ONLY refuse — so this turns a guaranteed failure into an
 * answer and turns nothing else into anything else.
 */
export function preferEnvOverUnservableDefault(
  cfg: AiConfig | undefined,
  opts: { defaultIsServable: boolean },
  env: NodeJS.ProcessEnv = process.env,
): AiConfig | undefined {
  if (!cfg) return aiConfigFromEnv(env);
  if ((cfg.mode ?? 'api-key') !== 'default') return cfg;
  if (opts.defaultIsServable) return cfg;
  return aiConfigFromEnv(env) ?? cfg;
}

export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | undefined {
  const pre = readAiEnvPrefill(env);
  if (!pre) return undefined;
  const key = (env[pre.keyEnv] ?? '').trim();
  if (key === '') return undefined;
  const cfg: AiConfig = { provider: pre.provider, model: pre.model, apiKey: key };
  if (pre.baseUrl) cfg.baseUrl = pre.baseUrl;
  /*
   * SEQUENCE_AI_MAX_RETRIES — the headless benchmarking knob. A shared free
   * pool (OpenRouter :free models) answers 429 in weather-like bursts; the
   * retry machinery has always existed (`params.maxRetries`, clamped 0–5 by
   * AI_PARAM_BOUNDS) but the env path — the only config a container run has —
   * could not reach it, so one gust failed the instance. Invalid or absent ⇒
   * exactly the old behaviour (no params at all).
   */
  const retries = Number.parseInt((env.SEQUENCE_AI_MAX_RETRIES ?? '').trim(), 10);
  if (Number.isInteger(retries) && retries >= 0) {
    cfg.params = { maxRetries: Math.min(5, retries) };
  }
  /*
   * SEQUENCE_AI_TEMPERATURE — the other headless benchmarking knob. Measured
   * across mini-50 runs v8/v10 (same harness, same model): 21 and 20 resolved
   * with only 14 stable — a 27-instance union sampled down by decoding
   * randomness. pass@1 benchmarks pin temperature; the env path could not.
   * Out-of-range values are REFUSED by the same bounds as the settings pane
   * (AI_PARAM_BOUNDS), never clamped; absent means provider default.
   */
  const temp = Number.parseFloat((env.SEQUENCE_AI_TEMPERATURE ?? '').trim());
  if (Number.isFinite(temp) && temp >= 0 && temp <= 2) {
    cfg.params = { ...(cfg.params ?? {}), temperature: temp };
  }
  return cfg;
}

/**
 * The SINGLE credential→endpoint chokepoint. Given a config, return the request
 * `url` + `headers` — the ONLY place any credential (a user key OR the app's
 * gateway token) is put onto a header. Three cases:
 *
 *   - `'default'` mode  ⇒ the hosted gateway's OpenAI-compatible
 *     `/v1/chat/completions`, authenticating the APP (an optional gateway token
 *     from the environment) — NEVER a user secret, NEVER our funded key.
 *   - api-key `anthropic` ⇒ EXACTLY the pre-v9 branch (`x-api-key` + `/v1/messages`).
 *   - api-key `openai-compatible` ⇒ `Bearer` + chat/completions (no doubled `/v1`).
 *
 * A mode-less config takes the api-key path, so the bytes on the wire are
 * identical to before v9. The api-key guards below can only fire for a config
 * {@link validateAiConfig} would have rejected, so real flows are unchanged.
 */
export function resolveEndpoint(cfg: AiConfig): { url: string; headers: Record<string, string> } {
  const mode = cfg.mode ?? 'api-key';
  if (mode === 'default') {
    const base = (cfg.baseUrl ?? DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    // The Bearer token for the free default. When the owner set DEEPSEEK_API_KEY,
    // loadAiConfig routes `base` to DeepSeek and this is the funded SERVER key that
    // authenticates it; otherwise it is the coarse APP/instance token (if any) for
    // the hosted gateway. Both are Bearer tokens on the SAME header. NEITHER is a
    // user secret, and the funded key is read from the env HERE at wire time — never
    // from the config — so it can never reach redactAiConfig, a client, or a log.
    const token = deepSeekServerKey() ?? gatewayAppToken();
    if (token) headers.authorization = `Bearer ${token}`;
    return { url: openaiCompatChatUrl(base), headers };
  }
  if (cfg.provider === 'anthropic') {
    const base = (cfg.baseUrl ?? ANTHROPIC_DEFAULT_HOST).replace(/\/+$/, '');
    if (!cfg.apiKey) throw new ProviderError('anthropic provider requires an apiKey');
    return {
      url: `${base}/v1/messages`,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
    };
  }
  const base = (cfg.baseUrl ?? '').replace(/\/+$/, '');
  if (base === '') throw new ProviderError('openai-compatible provider requires a baseUrl');
  let loopbackNoKey = false;
  try {
    const url = new URL(base);
    loopbackNoKey =
      !cfg.apiKey &&
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      isLoopbackHost(url.hostname);
  } catch {
    /* invalid URL — fall through to apiKey guard */
  }
  if (!cfg.apiKey && !loopbackNoKey) {
    /* Keyless direct calls are deliberately narrower than the general
       local-route definition: a private-LAN address is another machine, while
       loopback is confined to this one. Repository context never crosses that
       boundary merely because the address is RFC1918. */
    throw new ProviderError(
      'openai-compatible provider requires an apiKey unless baseUrl points at loopback',
    );
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  // OpenRouter ranks apps that send these; optional env overrides for deploy.
  if (isOpenRouterBase(base)) {
    headers['HTTP-Referer'] = (process.env.OPENROUTER_HTTP_REFERER ?? '').trim() || 'https://sequence.dev';
    headers['X-Title'] = (process.env.OPENROUTER_X_TITLE ?? '').trim() || 'Sequence';
  }
  return { url: openaiCompatChatUrl(base), headers };
}

/** Structured result from a single provider wire call. */
interface ModelTextResult {
  text: string;
  providerUsage?: ExtractedProviderUsage;
  /** B2.2 — openai tool_calls when present; never fabricated. */
  toolRequests?: ProviderToolRequest[];
  /**
   * How many attempts `requestModelTextWithUsage`'s retry loop took BEFORE the
   * one that produced this result. `0` is a measurement (the loop ran, retried
   * nothing); the key is absent only from a result that never went through the
   * loop (`requestModelTextOnce` called directly). Audit G3 named retry counts
   * as absent everywhere; this is the one place they can be counted.
   */
  retries?: number;
}

/**
 * ONE ATTEMPT: POST the prompt to the configured provider and return assistant
 * text + usage.
 *
 * Passing `opts.onDelta` streams (build item 1.2); omitting it sends byte-identical
 * request bytes to the pre-streaming build and takes the identical buffered path.
 *
 * The deadline and the retry policy live in {@link requestModelTextWithUsage},
 * which wraps this — so everything below sees exactly one request, and the
 * `signal` it is handed is already the combined one.
 */
async function requestModelTextOnce(
  cfg: AiConfig,
  prompt: string,
  opts: ProviderStreamOptions = {},
): Promise<ModelTextResult> {
  const isDefault = (cfg.mode ?? 'api-key') === 'default';
  // HONEST free-tier gate (v18 Wave 2, hardened in review round 1). Default mode is
  // only ever callable through the gateway seam: repoServer's loadAiConfig stamps
  // `gatewayLive: true` when a gateway URL was actually configured (the
  // SEQUENCE_GATEWAY_URL env on a real deploy, or the test injection). Without that
  // stamp there is NO live gateway — fail with the honest message BEFORE any fetch.
  // Deliberately NOT a URL comparison: the placeholder hostname is also the natural
  // production hostname, so equality-with-placeholder would brick a real deploy at
  // that address (adversarial-review finding).
  if (isDefault && cfg.gatewayLive !== true) {
    /* NAMED AS A CONFIGURATION PROBLEM, so the surface can offer the route
       its own message tells the reader to take. */
    throw new ProviderError(FREE_TIER_NOT_LIVE_MSG, { fix: 'provider' });
  }
  const { url, headers } = resolveEndpoint(cfg);
  // The anthropic Messages wire is used ONLY by api-key anthropic; default mode
  // and every openai-compatible config speak the chat/completions wire. Body,
  // response cap, parse, and error handling below are wire-shaped by this alone
  // and are otherwise unchanged.
  const wire: ProviderKind = cfg.mode !== 'default' && cfg.provider === 'anthropic' ? 'anthropic' : 'openai-compatible';
  // OpenRouter BYO: remap Sequence's bare free-default alias to the namespaced id.
  const modelForWire =
    wire === 'openai-compatible' && cfg.baseUrl && isOpenRouterBase(cfg.baseUrl)
      ? openRouterModelId(cfg.model)
      : cfg.model;
  // Streaming is opt-in PER CALL, and the opt-in is the presence of a delta sink.
  // Nothing else in the request changes shape, so a caller that does not want
  // deltas cannot accidentally acquire a different wire.
  const onDelta = opts.onDelta;
  const streaming = typeof onDelta === 'function';
  const params = cfg.params ?? {};
  const baseBody: Record<string, unknown> =
    wire === 'anthropic'
      ? {
          model: modelForWire,
          // The user's cap when they set one, else the hardcoded 8192 this wire
          // has always required. The KEY is present either way, so an unset
          // `maxTokens` leaves these bytes exactly as they were.
          max_tokens: params.maxTokens ?? MAX_TOKENS,
          messages: [
            { role: 'user', content: anthropicPromptContent(prompt, opts.cacheBreakpointChars) },
          ],
        }
      : { model: modelForWire, messages: [{ role: 'user', content: prompt }] };
  // SET ⇒ SENT. UNSET ⇒ THE FIELD DOES NOT EXIST. Picky openai-compatible
  // servers 400 on unexpected fields (the `stream_options` comment below records
  // that we already pay that tax), so a knob nobody turned must not appear.
  if (params.temperature !== undefined) baseBody.temperature = params.temperature;
  if (params.topP !== undefined) baseBody.top_p = params.topP;
  /* OpenAI-wire only, like max_tokens below it: `reasoning_effort` is a field of
     that API, and the anthropic wire has its own extended-thinking shape. */
  if (wire !== 'anthropic' && params.reasoningEffort !== undefined) {
    baseBody.reasoning_effort = params.reasoningEffort;
  }
  if (wire !== 'anthropic' && params.maxTokens !== undefined) {
    // The openai-compatible wire sent NO output cap at all, so the server's own
    // default governed. It still does, until the reader says otherwise.
    baseBody.max_tokens = params.maxTokens;
  }
  // NATIVE TOOLS ON BOTH WIRES.
  //
  // B2.2 attached these to the openai-compatible wire only, and said so:
  // "Anthropic ask stays fence-salvage until a later slice." That slice is this
  // one. The definitions come from ONE registry either way — the openai array
  // repoServer already builds — reshaped for the Messages wire by
  // {@link anthropicToolDefinitions}. Fence salvage stays as the belt for models
  // that emit prose fences instead of calling.
  //
  // Some local servers reject unknown fields; omitting `tools` when the caller
  // supplied none keeps those bodies byte-identical to the pre-tools shape.
  if (opts.tools && opts.tools.length > 0) {
    if (wire === 'anthropic') {
      baseBody.tools = anthropicToolDefinitions(opts.tools);
      // No `tool_choice`: absent IS auto on this wire, and an omitted field is
      // one fewer thing a proxy in front of the API can reject.
    } else {
      baseBody.tools = opts.tools;
      baseBody.tool_choice = 'auto';
    }
  }
  // `stream:true` and nothing else beyond optional tools. We deliberately do NOT
  // send OpenAI's `stream_options:{include_usage:true}`: several openai-compatible
  // servers (llama.cpp, LM Studio, older vLLM) reject unknown request fields with
  // a 400, and trading "this local model answers at all" for "the token count is
  // measured rather than estimated" is the wrong way round. Providers that
  // volunteer a usage frame are still read; the rest fall back to the estimator,
  // which marks itself `estimated: true` (see usageRecord) rather than pretending.
  const body: unknown = streaming ? { ...baseBody, stream: true } : baseBody;
  const reqHeaders = streaming ? { ...headers, accept: 'text/event-stream' } : headers;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if (
      (e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && e.name === 'AbortError')
    ) {
      throw e;
    }
    // A default-mode network failure here means the CONFIGURED gateway (we only
    // get past the gate above when one is stamped live) is unreachable right now —
    // surface an honest, actionable message rather than a raw "fetch failed",
    // which reads as a bug the user can't act on. A BYO-key host is THEIRS to
    // debug, so its network failures keep the raw diagnostic (their endpoint,
    // their real error). fetch/network errors never contain our request headers.
    if (isDefault) throw new ProviderError(FREE_TIER_UNREACHABLE_MSG);
    /*
     * NAME THE ENDPOINT. The comment above says a BYO-key host keeps "their
     * endpoint, their real error" — and the message never carried the endpoint.
     * `provider request failed: fetch failed` tells a reader nothing they can
     * act on: not which host, not which port, not whether the address they think
     * they configured is the one that was used. That last one matters more than
     * it sounds — config precedence puts `.sequence/ai.json` ahead of the
     * environment, so the address actually called is often not the one the
     * reader just set.
     *
     * ORIGIN AND PATH ONLY, never the query: some providers carry credentials in
     * one, and this string reaches logs and screens.
     */
    throw new ProviderError(
      `provider request failed: ${(e as Error).message} (${describeEndpoint(url)})`,
    );
  }

  if (!res.ok) {
    // Provider-authored response body; cannot contain the api key we sent. Read
    // it the buffered way whatever the request was: an error body is not a stream,
    // and the status + body a caller needs are identical on both paths.
    const errBody = await readCappedText(res, MAX_PROVIDER_RESPONSE_BYTES);
    throw new ProviderError(`provider returned HTTP ${res.status}`, { status: res.status, body: errBody });
  }

  if (streaming && onDelta) {
    const { acc, raw } = await readCappedStream(res, wire, onDelta, MAX_PROVIDER_RESPONSE_BYTES);
    if (acc.error !== undefined) {
      // Reported, never guessed. A stream that carried an error frame did not
      // produce an answer, and returning its partial text as one would be the
      // silent-in-the-direction-that-hurts failure.
      throw new ProviderError(`provider reported a stream error: ${acc.error}`);
    }
    if (acc.frames === 0) {
      // The provider ignored `stream:true` and answered with an ordinary JSON
      // body — real local servers do this. Parse it the ordinary way and hand it
      // over as ONE delta, so the caller's concatenation still equals the text it
      // is about to receive. Reporting silence here for a full answer would be a
      // lie the caller cannot detect.
      let parsedWhole: unknown;
      try {
        parsedWhole = JSON.parse(raw);
      } catch {
        throw new ProviderError('provider response was not valid JSON', { body: raw });
      }
      const wholeText = extractModelText(wire, parsedWhole);
      const wholeTools = extractToolRequests(wire, parsedWhole);
      if (wholeText === undefined && wholeTools.length === 0) {
        throw new ProviderError('could not locate assistant text in the provider response', { body: raw });
      }
      const textOut = wholeText ?? '';
      if (textOut !== '') onDelta(textOut);
      return {
        text: textOut,
        providerUsage: extractProviderUsage(wire, parsedWhole),
        ...(wholeTools.length ? { toolRequests: wholeTools } : {}),
      };
    }
    if (acc.text === '' && acc.malformedFrames > 0 && acc.toolRequests.length === 0) {
      throw new ProviderError(
        `provider stream carried ${acc.malformedFrames} unparseable frame(s) and no assistant text`,
      );
    }
    if (acc.text === '' && !acc.sawTextPart && acc.toolRequests.length === 0) {
      // Parity with the buffered path, deliberately: a reply that carried no text
      // part at all is reported, not returned as an empty answer. See
      // StreamDeltaAccumulator.sawTextPart for why '' and "none" differ here.
      // B2.2: tool_calls-only turns ARE an answer — they carry structured work.
      throw new ProviderError('could not locate assistant text in the provider response');
    }
    return {
      text: acc.text,
      providerUsage: acc.usage,
      ...(acc.toolRequests.length ? { toolRequests: acc.toolRequests } : {}),
    };
  }

  const text = await readCappedText(res, MAX_PROVIDER_RESPONSE_BYTES);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ProviderError('provider response was not valid JSON', { body: text });
  }
  const modelText = extractModelText(wire, parsed);
  const toolRequests = extractToolRequests(wire, parsed);
  if (modelText === undefined && toolRequests.length === 0) {
    throw new ProviderError('could not locate assistant text in the provider response', { body: text });
  }
  const providerUsage = extractProviderUsage(wire, parsed);
  return {
    text: modelText ?? '',
    providerUsage,
    ...(toolRequests.length ? { toolRequests } : {}),
  };
}

/**
 * A wall-clock deadline for one provider call, combined with the caller's own
 * abort signal.
 *
 * Hand-rolled rather than `AbortSignal.any([...])` so the deadline can be
 * DISTINGUISHED from the caller's abort after the fact: `timedOut` is what lets
 * the wrapper report "the provider did not answer in N ms" instead of the bare
 * `AbortError` a closed browser tab produces. Both are aborts; only one is a
 * fact about the model.
 */
function makeDeadline(
  caller: AbortSignal | undefined,
  timeoutMs: number | undefined,
): { signal: AbortSignal | undefined; timedOut: () => boolean; dispose: () => void } {
  if (typeof timeoutMs !== 'number' || !(timeoutMs > 0)) {
    /* NO deadline is the shipped behaviour and stays reachable: the caller's own
       signal is passed through untouched, so nothing about the request changes. */
    return { signal: caller, timedOut: () => false, dispose: () => {} };
  }
  const ctl = new AbortController();
  let fired = false;
  const timer = setTimeout(() => {
    fired = true;
    ctl.abort();
  }, timeoutMs);
  /* The process must not be held open by a deadline nobody is waiting on. */
  if (typeof (timer as { unref?: () => void }).unref === 'function') {
    (timer as unknown as { unref: () => void }).unref();
  }
  let relay: (() => void) | undefined;
  if (caller) {
    if (caller.aborted) ctl.abort();
    else {
      relay = () => ctl.abort();
      caller.addEventListener('abort', relay, { once: true });
    }
  }
  return {
    signal: ctl.signal,
    timedOut: () => fired,
    dispose: () => {
      clearTimeout(timer);
      if (relay && caller) caller.removeEventListener('abort', relay);
    },
  };
}

/**
 * Is this failure worth sending again?
 *
 * Only transport failures and the statuses that MEAN "later": 408/425/429 and
 * 5xx. A 400 (bad model id, unknown field) and a 401/403 (wrong key) are answers,
 * not weather — re-sending them wastes the reader's time and hides the fix.
 */
function isTransientProviderFailure(e: unknown): boolean {
  if (!(e instanceof ProviderError)) return false;
  if (e instanceof RateLimitError) return false; // our own daily cap, not the provider's
  const st = e.status;
  if (typeof st === 'number') return st === 408 || st === 425 || st === 429 || st >= 500;
  return (
    /^provider request failed:/.test(e.message) ||
    e.message === FREE_TIER_UNREACHABLE_MSG ||
    /*
     * An answerless 200 — no text, no tool calls — is a flaked generation, not
     * a request the caller can fix by rephrasing. Free-tier endpoints produce
     * these under load (measured: two mini-50 turns died on it). Retrying is
     * only ever taken under the caller's explicit maxRetries budget.
     */
    e.message.startsWith('could not locate assistant text')
  );
}

/**
 * POST the prompt to the configured provider, under this config's deadline and
 * retry policy.
 *
 * WHAT THIS ADDS AND WHAT IT REFUSES TO ADD. Before it there was no deadline on
 * a provider call at all — the only `AbortSignal` in the ask chain fires when
 * the browser tab closes — so a stalled local generation hung forever while
 * `doctor.ts` had used a 20 s probe deadline all along.
 *
 * A retry is taken ONLY when not one delta has been handed to the caller. A
 * delta already handed over has already been shown to someone; appending a
 * second generation to a first the reader watched appear would store a turn no
 * model ever produced. Same rule `ModelRequestOptions.onDelta` states for
 * failover, enforced here rather than assumed.
 *
 * With no `params` this is a single `await requestModelTextOnce(...)` with the
 * caller's own signal — the pre-knobs path, unchanged.
 */
async function requestModelTextWithUsage(
  cfg: AiConfig,
  prompt: string,
  opts: ProviderStreamOptions = {},
): Promise<ModelTextResult> {
  const params = cfg.params ?? {};
  const maxRetries = params.maxRetries ?? 0;
  const timeoutMs = params.timeoutMs;
  for (let attempt = 0; ; attempt++) {
    let emitted = false;
    const callerDelta = opts.onDelta;
    const attemptOpts: ProviderStreamOptions = { ...opts };
    if (callerDelta) {
      attemptOpts.onDelta = (d: string) => {
        emitted = true;
        callerDelta(d);
      };
    }
    const deadline = makeDeadline(opts.signal, timeoutMs);
    if (deadline.signal !== undefined) attemptOpts.signal = deadline.signal;
    try {
      const once = await requestModelTextOnce(cfg, prompt, attemptOpts);
      return { ...once, retries: attempt };
    } catch (e) {
      if (deadline.timedOut()) {
        /* NAMED AS THE DEADLINE IT WAS. A bare AbortError here reads as "the
           user cancelled", and the reader who set the timeout is the one person
           who needs to know it was hit. */
        throw new ProviderError(
          `provider did not answer within ${timeoutMs} ms (Advanced › Timeout)`,
          { fix: 'provider' },
        );
      }
      if (attempt < maxRetries && !emitted && isTransientProviderFailure(e)) {
        /* Bounded, and short enough that a human still perceives one request.
           Aborted callers stop immediately rather than sleeping through it. */
        const backoffMs = Math.min(4_000, 250 * 2 ** attempt);
        await new Promise((r) => setTimeout(r, backoffMs));
        if (opts.signal?.aborted) throw e;
        continue;
      }
      /* The retries a FAILED call took ride on the error, or the receipt's
         `providerRetries` undercounts on exactly the turn it exists for: the
         one where retrying did not help. Attached only when there were any. */
      if (attempt > 0 && typeof e === 'object' && e !== null) {
        (e as { retries?: number }).retries = attempt;
      }
      throw e;
    } finally {
      deadline.dispose();
    }
  }
}

async function requestModelText(cfg: AiConfig, prompt: string): Promise<string> {
  const { text } = await requestModelTextWithUsage(cfg, prompt);
  return text;
}

/**
 * Extract the FIRST balanced JSON object from arbitrary model text. Models often
 * wrap the object in ```json fences or a sentence, so we scan from the first `{`
 * to its matching `}` (respecting string literals and escapes) and JSON.parse
 * that slice. Never eval; returns undefined when no parseable object is found.
 */
export function extractFirstJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** Strictly validate a model response into `{files, notes}`; throws on any deviation. */
export function parseFilesFromText(text: string): { files: GeneratedFile[]; notes?: string } {
  const obj = extractFirstJsonObject(text);
  if (obj === undefined || typeof obj !== 'object') {
    throw new Error('no JSON object found in model response');
  }
  const files = (obj as { files?: unknown }).files;
  if (!Array.isArray(files)) {
    throw new Error('model response JSON must contain a "files" array');
  }
  const out: GeneratedFile[] = [];
  for (const f of files) {
    if (!f || typeof f !== 'object') throw new Error('each entry of "files" must be an object');
    const path = (f as { path?: unknown }).path;
    const content = (f as { content?: unknown }).content;
    if (typeof path !== 'string' || path.length === 0) {
      throw new Error('each file needs a non-empty string "path"');
    }
    if (typeof content !== 'string') {
      throw new Error(`file "${path}" needs a string "content"`);
    }
    out.push({ path, content });
  }
  const notesVal = (obj as { notes?: unknown }).notes;
  const notes = typeof notesVal === 'string' ? notesVal : undefined;
  return { files: out, notes };
}

/**
 * Send `prompt` to the configured provider and return the assistant's raw text,
 * unparsed. This is the generic escape hatch for callers whose reply contract is
 * NOT the `{files}` shape (e.g. the explain layer's PlainTree). It reuses the
 * exact same key-hygiene / size-capped request path as {@link generateFiles};
 * it does not change that function's parse behaviour.
 */
export async function generateTextWithUsage(
  cfg: AiConfig,
  prompt: string,
  opts: ProviderStreamOptions = {},
): Promise<{
  text: string;
  providerUsage?: import('../llm/usageExtraction.js').ExtractedProviderUsage;
  toolRequests?: ProviderToolRequest[];
  /** See `ModelTextResult.retries` — the retry loop's own count for this call. */
  retries?: number;
}> {
  return requestModelTextWithUsage(cfg, prompt, opts);
}

export async function generateText(cfg: AiConfig, prompt: string): Promise<string> {
  const { text } = await requestModelTextWithUsage(cfg, prompt);
  return text;
}

/**
 * Streamed twin of {@link generateText} (build item 1.2).
 *
 * `onDelta` is called with each text delta as it arrives; the resolved string is
 * their concatenation, character for character. A caller that stores the resolved
 * text has stored exactly what it already rendered, which is what makes a turn
 * replayable from the deltas alone.
 *
 * On the ordinary JSON fallback (a provider that ignored `stream:true`) the whole
 * answer arrives as a single delta, so the concatenation property never has an
 * exception the caller has to know about.
 */
export async function generateTextStream(
  cfg: AiConfig,
  prompt: string,
  onDelta: (delta: string) => void,
): Promise<string> {
  const { text } = await requestModelTextWithUsage(cfg, prompt, { onDelta });
  return text;
}

/** {@link generateTextStream} with the provider's usage block when it sent one. */
export async function generateTextStreamWithUsage(
  cfg: AiConfig,
  prompt: string,
  onDelta: (delta: string) => void,
): Promise<{
  text: string;
  providerUsage?: import('../llm/usageExtraction.js').ExtractedProviderUsage;
  toolRequests?: ProviderToolRequest[];
}> {
  return requestModelTextWithUsage(cfg, prompt, { onDelta });
}

/**
 * The one call the server makes: send `prompt` to the provider, parse the strict
 * `{files}` contract out of the reply. A parse failure is re-thrown as a
 * {@link ProviderError} carrying the raw model text (key-free) so the caller can
 * surface it for debugging.
 */
export async function generateFiles(cfg: AiConfig, prompt: string): Promise<ProviderReply> {
  const raw = await requestModelText(cfg, prompt);
  try {
    const { files, notes } = parseFilesFromText(raw);
    return { files, notes, raw };
  } catch (e) {
    throw new ProviderError(`could not parse files from model response: ${(e as Error).message}`, { body: raw });
  }
}

/** Structured result from {@link requestModelRequest} — secret-free diagnostics included. */
export interface ModelRequestResult {
  text: string;
  usage: ModelUsageRecord[];
  routeDiagnostics: RouteDiagnostic[];
  envelopeDiagnostics: PromptEnvelopeDiagnostics;
  sessionDiagnostics?: ModelSessionDiagnostics;
}

/**
 * Secret-free failure after one or more route attempts. Carries per-attempt usage
 * and route diagnostics — never credentials or prompt text.
 */
export class ModelRequestError extends Error {
  readonly routeDiagnostics: RouteDiagnostic[];
  readonly usage: ModelUsageRecord[];
  readonly primaryError: unknown;
  readonly failoverError?: unknown;

  constructor(
    message: string,
    opts: {
      routeDiagnostics: RouteDiagnostic[];
      usage: ModelUsageRecord[];
      primaryError: unknown;
      failoverError?: unknown;
    },
  ) {
    super(message);
    this.name = 'ModelRequestError';
    this.routeDiagnostics = opts.routeDiagnostics;
    this.usage = opts.usage;
    this.primaryError = opts.primaryError;
    this.failoverError = opts.failoverError;
  }
}

export interface ModelRequestOptions {
  /** Required for local-openai-compatible routes that carry repository context. */
  localOpenAiConsent?: boolean;
  /** When true, transient failover is blocked (tool/file side effects began). */
  sideEffectsStarted?: boolean;
  /** Optional hook for metering — receives each attempt's usage record. */
  onUsage?: (record: ModelUsageRecord) => void;
  /**
   * Optional delta sink (build item 1.2). When present the route call streams and
   * `result.text` is the concatenation of the deltas this received.
   *
   * NOTE the failover interaction, which is why this is not merely forwarded: a
   * delta the caller has already been handed has already been shown to someone.
   * Retrying on an alternate route after that point would append a second
   * generation to a first the reader saw, and the stored text would then be a
   * turn no model ever produced. So the first delta counts as a side effect and
   * blocks failover, by the same rule that blocks it after a tool ran.
   */
  onDelta?: (delta: string) => void;
  /** Gateway spend ledger for atomic reservations (ADR-013 Phase D). */
  spendLedger?: SpendLedger;
  /** When set with {@link sessionService}, reuse a capped multi-turn session. */
  sessionKey?: string;
  /** Capped model session service (ADR-013 Phase C). */
  sessionService?: ModelSessionService;
  /** Optional pinned decisions/evidence for this session turn. */
  sessionTurn?: Pick<SessionTurnRequest, 'pinnedDecisions' | 'evidenceRefs' | 'unresolvedActions'>;
}

interface UsageRecordContext {
  outputText?: string;
  providerUsage?: ExtractedProviderUsage;
  reservedCostUsd?: number;
  reconciledCostUsd?: number;
}

function remoteSpendUsd(
  route: ModelRoute,
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number,
  providerUsage?: ExtractedProviderUsage,
): { costUsd: number; costEstimated: boolean } {
  if (route.kind === 'local-openai-compatible') {
    return { costUsd: 0, costEstimated: false };
  }
  if (providerUsage?.costUsd !== undefined) {
    return { costUsd: providerUsage.costUsd, costEstimated: false };
  }
  return {
    costUsd: estimateCostUsd(inputTokens, outputTokens, cachedInputTokens),
    costEstimated: true,
  };
}

function usageRecord(
  route: ModelRoute,
  prompt: string,
  startMs: number,
  status: 'ok' | 'error' | 'blocked',
  failoverCount: number,
  ctx: UsageRecordContext = {},
): ModelUsageRecord {
  const providerUsage = ctx.providerUsage;
  const estimatedTokens = providerUsage === undefined;
  const inputTokens = providerUsage?.inputTokens ?? approxTokens(prompt);
  const outputTokens =
    providerUsage?.outputTokens ??
    (ctx.outputText !== undefined ? approxTokens(ctx.outputText) : undefined);
  const cachedInputTokens = providerUsage?.cachedInputTokens;

  const record: ModelUsageRecord = {
    routeKind: route.kind,
    model: route.model,
    inputTokens,
    estimated: estimatedTokens,
    latencyMs: Date.now() - startMs,
    status,
    failoverCount,
  };
  if (cachedInputTokens !== undefined) record.cachedInputTokens = cachedInputTokens;
  if (providerUsage?.cacheOutcome !== undefined) record.cacheOutcome = providerUsage.cacheOutcome;
  if (outputTokens !== undefined) record.outputTokens = outputTokens;

  if (status === 'ok' || status === 'error') {
    const out = outputTokens ?? 0;
    const spend = remoteSpendUsd(route, inputTokens, out, cachedInputTokens ?? 0, providerUsage);
    record.costUsd = spend.costUsd;
    record.costEstimated = spend.costEstimated;
  } else {
    record.costUsd = 0;
    record.costEstimated = false;
  }

  if (ctx.reservedCostUsd !== undefined) record.reservedCostUsd = ctx.reservedCostUsd;
  if (ctx.reconciledCostUsd !== undefined) record.reconciledCostUsd = ctx.reconciledCostUsd;
  return record;
}

function isGatewayRoute(route: ModelRoute): boolean {
  return route.kind === 'gateway';
}

function prepareRoute(route: ModelRoute, consent?: boolean): AiConfig {
  if (route.kind === 'model-subscription-oauth') assertSubscriptionOAuthAvailable(route);
  if (route.kind === 'local-openai-compatible') assertLocalOpenAiRoute(route, consent);
  return routeToAiConfig(route);
}

/**
 * ADR-013 Phase B/C — send a versioned prompt envelope through typed routes with
 * bounded one-hop failover. Existing {@link generateText} wire bytes are unchanged;
 * this is the envelope + route seam for new callers. When `sessionKey` and
 * `sessionService` are provided, compaction and session limits apply first.
 */
export async function requestModelRequest(
  request: ModelRequest,
  envelope: PromptEnvelopeSections,
  opts: ModelRequestOptions = {},
): Promise<ModelRequestResult> {
  if (opts.sessionKey && opts.sessionService) {
    const turn: SessionTurnRequest = {
      baseEnvelope: {
        policy: envelope.policy,
        toolSchemas: envelope.toolSchemas,
        snapshotContent: envelope.snapshotContent,
      },
      currentRequest: envelope.currentRequest,
      volatileMetadata: envelope.volatileMetadata,
      pinnedDecisions: opts.sessionTurn?.pinnedDecisions,
      evidenceRefs: opts.sessionTurn?.evidenceRefs,
      unresolvedActions: opts.sessionTurn?.unresolvedActions,
    };
    const { result, sessionDiagnostics } = await opts.sessionService.runTurn(
      opts.sessionKey,
      turn,
      (prepared) => executeModelRequest(request, prepared, opts),
    );
    return { ...result, sessionDiagnostics };
  }
  return executeModelRequest(request, envelope, opts);
}

async function executeModelRequest(
  request: ModelRequest,
  envelope: PromptEnvelopeSections,
  opts: ModelRequestOptions,
): Promise<ModelRequestResult> {
  const { prompt, diagnostics: envelopeDiagnostics } = assemblePromptEnvelope(envelope);
  const alternate = request.alternates?.[0];
  const usage: ModelUsageRecord[] = [];
  const routeDiagnostics: RouteDiagnostic[] = [redactRoute(request.route)];
  // Set the moment the caller is handed its first delta — see ModelRequestOptions.onDelta.
  let deltasEmitted = false;
  const deltaSink = opts.onDelta
    ? (d: string) => {
        deltasEmitted = true;
        opts.onDelta!(d);
      }
    : undefined;

  const attempt = async (route: ModelRoute, failoverCount: number): Promise<string> => {
    const cfg = prepareRoute(route, opts.localOpenAiConsent);
    const startMs = Date.now();
    const inputEstimate = approxTokens(prompt);
    let reservationId: string | undefined;
    let reservedCostUsd: number | undefined;

    if (opts.spendLedger && isGatewayRoute(route)) {
      const reserve = opts.spendLedger.tryReserve(reserveEstimateUsd(inputEstimate));
      if (!reserve.allowed) {
        const blocked = usageRecord(route, prompt, startMs, 'blocked', failoverCount, {
          reservedCostUsd: 0,
        });
        usage.push(blocked);
        opts.onUsage?.(blocked);
        throw new ModelRequestError('gateway spend cap reached — request blocked before provider call', {
          routeDiagnostics: [redactRoute(route)],
          usage,
          primaryError: new ProviderError('gateway spend cap reached'),
        });
      }
      reservationId = reserve.reservation.id;
      reservedCostUsd = reserve.reservation.estimatedUsd;
    }

    try {
      const { text, providerUsage } = await requestModelTextWithUsage(cfg, prompt, { onDelta: deltaSink });
      const outTokens = providerUsage?.outputTokens ?? approxTokens(text);
      const inTokens = providerUsage?.inputTokens ?? inputEstimate;
      const cached = providerUsage?.cachedInputTokens ?? 0;
      const spend = remoteSpendUsd(route, inTokens, outTokens, cached, providerUsage);
      let reconciledCostUsd: number | undefined;

      if (reservationId && opts.spendLedger) {
        opts.spendLedger.reconcile(reservationId, spend.costUsd);
        reconciledCostUsd = spend.costUsd;
        reservationId = undefined;
      }

      const record = usageRecord(route, prompt, startMs, 'ok', failoverCount, {
        outputText: text,
        providerUsage,
        reservedCostUsd,
        reconciledCostUsd,
      });
      usage.push(record);
      opts.onUsage?.(record);
      return text;
    } catch (e) {
      if (reservationId && opts.spendLedger) {
        opts.spendLedger.release(reservationId);
      }
      const record = usageRecord(route, prompt, startMs, 'error', failoverCount, {
        reservedCostUsd,
      });
      usage.push(record);
      opts.onUsage?.(record);
      throw e;
    }
  };

  try {
    const text = await attempt(request.route, 0);
    return { text, usage, routeDiagnostics, envelopeDiagnostics };
  } catch (primaryErr) {
    const ctx: FailoverContext = {
      primary: request.route,
      alternate,
      requiredCapabilities: request.requiredCapabilities,
      privacyBoundary: routePrivacyBoundary(request.route),
      // Streamed text already handed to the caller IS a side effect: it has been
      // read. Failing over past it would splice two generations into one turn.
      sideEffectsStarted: (opts.sideEffectsStarted ?? false) || deltasEmitted,
    };
    if (!alternate || !canFailover(ctx, primaryErr)) {
      if (alternate) routeDiagnostics.push(failoverBlockedDiagnostic(ctx, primaryErr));
      throw new ModelRequestError('model request failed on primary route', {
        routeDiagnostics,
        usage,
        primaryError: primaryErr,
      });
    }
    routeDiagnostics.push({ ...redactRoute(alternate), message: 'failover attempt' });
    try {
      const text = await attempt(alternate, 1);
      return { text, usage, routeDiagnostics, envelopeDiagnostics };
    } catch (failoverErr) {
      throw new ModelRequestError('model request failed on primary and failover route', {
        routeDiagnostics,
        usage,
        primaryError: primaryErr,
        failoverError: failoverErr,
      });
    }
  }
}
