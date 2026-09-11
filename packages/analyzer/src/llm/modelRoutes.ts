/**
 * ADR-013 Phase A — typed provider routes (discriminated union).
 *
 * Routing is explicit and route-local: credentials never cross route kinds and
 * are never serialized into diagnostics. Wire adapters in `server/provider.ts`
 * remain the credential→network chokepoint; this module owns route *selection*
 * and secret-free views.
 */

import type { AiConfig, ProviderKind } from '../server/provider.js';

/** Mirrors {@link DEFAULT_GATEWAY_URL} in provider.ts — duplicated to avoid import cycles. */
const GATEWAY_HOST_URL = 'https://gateway.sequence.dev';

/** Route kinds supported by the model request service (ADR-013 §1). */
export type ModelRouteKind =
  | 'api-key'
  | 'gateway'
  | 'local-openai-compatible'
  | 'model-subscription-oauth';

/** Capabilities a route may satisfy (extended in later phases). */
export type ModelCapability = 'chat' | 'json-contract' | 'tool-use' | 'streaming';

/** Where repository context leaves the machine (ADR-013 §2). */
export type PrivacyBoundary = 'local' | 'remote';

/** A model request's ordered route list (failover wired in Phase B). */
export interface ModelRequest {
  /** Primary route for this attempt. */
  route: ModelRoute;
  /** Optional ordered alternates (user-approved; not auto-selected). */
  alternates?: ModelRoute[];
  /** Capabilities the attempt requires. */
  requiredCapabilities?: ModelCapability[];
}

export interface ApiKeyRoute {
  kind: 'api-key';
  provider: ProviderKind;
  model: string;
  baseUrl?: string;
  apiKey: string;
}

export interface GatewayRoute {
  kind: 'gateway';
  model: string;
  baseUrl: string;
  gatewayLive: boolean;
}

/** Loopback/private OpenAI-compatible endpoint (Phase B wires consent/validation). */
export interface LocalOpenAiCompatibleRoute {
  kind: 'local-openai-compatible';
  model: string;
  baseUrl: string;
  apiKey?: string;
}

/**
 * Typed subscription OAuth — not live at adoption (ADR-013 §1). Configuration
 * fails closed until a provider documents third-party OAuth for this purpose.
 */
export interface ModelSubscriptionOAuthRoute {
  kind: 'model-subscription-oauth';
  providerId: string;
  model: string;
}

export type ModelRoute =
  | ApiKeyRoute
  | GatewayRoute
  | LocalOpenAiCompatibleRoute
  | ModelSubscriptionOAuthRoute;

/** Cache read/write outcome when the provider reports it (ADR-013 §6). */
export type CacheOutcome = 'hit' | 'miss' | 'write';

/** Per-attempt usage record (no prompt text or credentials — ADR-013 §6). */
export interface ModelUsageRecord {
  routeKind: ModelRouteKind;
  model: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  /** True when token counts are estimated rather than provider-reported. */
  estimated: boolean;
  /** Cache read/write outcome when reported by the provider. */
  cacheOutcome?: CacheOutcome;
  latencyMs?: number;
  status: 'ok' | 'error' | 'blocked';
  retryCount?: number;
  /** How many failover hops were used for this attempt (0 = primary only). */
  failoverCount?: number;
  /** USD cost — provider-reported when available, otherwise a versioned estimate. */
  costUsd?: number;
  /** True when {@link costUsd} is estimated, not provider-reported. */
  costEstimated?: boolean;
  /** Gateway pre-request reservation (diagnostics only). */
  reservedCostUsd?: number;
  /** Gateway post-request reconciled cost (diagnostics only). */
  reconciledCostUsd?: number;
}

/** Secret-free diagnostic surfaced to callers (ADR-013 §2 / §6). */
export interface RouteDiagnostic {
  routeKind: ModelRouteKind;
  model: string;
  provider?: ProviderKind;
  /** Hostname only — never a full URL with credentials or query params. */
  host?: string;
  message?: string;
}

export class ModelRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelRouteError';
  }
}

/** Actionable error when subscription OAuth is requested but not available. */
export const MODEL_SUBSCRIPTION_OAUTH_UNAVAILABLE_MSG =
  'model subscription OAuth is not available — no built-in provider documents third-party OAuth for this purpose; use api-key or the free gateway instead';

/** Actionable error when local OpenAI-compatible routes lack explicit user consent. */
export const LOCAL_OPENAI_CONSENT_REQUIRED_MSG =
  'local OpenAI-compatible routes require explicit consent — set localOpenAiConsent before sending repository context to a loopback endpoint';

/**
 * Map today's {@link AiConfig} to a typed route without changing wire behavior.
 *   - absent/`api-key` mode with a key → `api-key` route
 *   - absent/`api-key` mode without a key at loopback → `local-openai-compatible`
 *   - `default` mode → `gateway` route
 */
export function routeFromAiConfig(
  cfg: AiConfig,
): ApiKeyRoute | GatewayRoute | LocalOpenAiCompatibleRoute {
  const mode = cfg.mode ?? 'api-key';
  if (mode === 'default') {
    return {
      kind: 'gateway',
      model: cfg.model,
      baseUrl: (cfg.baseUrl ?? GATEWAY_HOST_URL).replace(/\/+$/, ''),
      gatewayLive: cfg.gatewayLive === true,
    };
  }
  if (!cfg.apiKey) {
    if (
      cfg.provider !== 'openai-compatible' ||
      !cfg.baseUrl ||
      !isHttpLoopbackBaseUrl(cfg.baseUrl)
    ) {
      throw new ModelRouteError('keyless OpenAI-compatible route requires a loopback baseUrl');
    }
    return {
      kind: 'local-openai-compatible',
      model: cfg.model,
      baseUrl: cfg.baseUrl!.replace(/\/+$/, ''),
    };
  }
  const route: ApiKeyRoute = {
    kind: 'api-key',
    provider: cfg.provider,
    model: cfg.model,
    apiKey: cfg.apiKey,
  };
  if (cfg.baseUrl) route.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  return route;
}

/** Hostname extractor for diagnostics — never throws on bad input. */
function hostOnly(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return undefined;
  }
}

/** Mask a credential for client-visible views (last four chars when long enough). */
export function maskSecret(secret: string): string {
  const last4 = secret.length >= 4 ? secret.slice(-4) : secret;
  return '••••' + last4;
}

/** Secret-free view of a route — safe for logs, errors, and client responses. */
export function redactRoute(route: ModelRoute): RouteDiagnostic {
  switch (route.kind) {
    case 'api-key':
      return {
        routeKind: 'api-key',
        model: route.model,
        provider: route.provider,
        host: hostOnly(route.baseUrl),
      };
    case 'gateway':
      return {
        routeKind: 'gateway',
        model: route.model,
        host: hostOnly(route.baseUrl),
      };
    case 'local-openai-compatible':
      return {
        routeKind: 'local-openai-compatible',
        model: route.model,
        host: hostOnly(route.baseUrl),
      };
    case 'model-subscription-oauth':
      return {
        routeKind: 'model-subscription-oauth',
        model: route.model,
        message: MODEL_SUBSCRIPTION_OAUTH_UNAVAILABLE_MSG,
      };
  }
}

/**
 * Subscription OAuth routes fail closed (ADR-013 §1). Call before any wire
 * attempt when a `model-subscription-oauth` route is configured.
 */
export function assertSubscriptionOAuthAvailable(route: ModelSubscriptionOAuthRoute): never {
  void route;
  throw new ModelRouteError(MODEL_SUBSCRIPTION_OAUTH_UNAVAILABLE_MSG);
}

/** Capabilities declared by a route kind (Phase B baseline). */
export function routeCapabilities(route: ModelRoute): ModelCapability[] {
  switch (route.kind) {
    case 'api-key':
    case 'gateway':
    case 'local-openai-compatible':
      return ['chat', 'json-contract'];
    case 'model-subscription-oauth':
      return [];
  }
}

/** Privacy boundary for a route — local routes never silently upgrade to remote. */
export function routePrivacyBoundary(route: ModelRoute): PrivacyBoundary {
  return route.kind === 'local-openai-compatible' ? 'local' : 'remote';
}

/**
 * True only for a hostname confined to this machine's loopback interface.
 */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost') return true;
  if (h === '::1') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function isHttpLoopbackBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      isLoopbackHost(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Loopback plus private/link-local hosts suitable for an explicitly keyed route. */
export function isLoopbackOrPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopbackHost(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  const m172 = h.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/**
 * Validate a local OpenAI-compatible route: loopback/private host + explicit consent.
 */
export function assertLocalOpenAiRoute(route: LocalOpenAiCompatibleRoute, consent?: boolean): void {
  const host = hostOnly(route.baseUrl);
  if (!host) throw new ModelRouteError('local-openai-compatible requires a valid baseUrl');
  if (!isLoopbackOrPrivateHost(host)) {
    throw new ModelRouteError(
      'local-openai-compatible baseUrl must point at a loopback or private host — public endpoints are not allowed',
    );
  }
  if (!route.apiKey && !isHttpLoopbackBaseUrl(route.baseUrl)) {
    /* A private-LAN host is still another machine. Sending repository context
       there without a credential is a materially wider trust boundary than a
       process reachable only through this machine's loopback interface. */
    throw new ModelRouteError(
      'keyless local-openai-compatible baseUrl must point at loopback',
    );
  }
  if (!consent) throw new ModelRouteError(LOCAL_OPENAI_CONSENT_REQUIRED_MSG);
}

/**
 * Map a typed route to {@link AiConfig} for the existing wire adapters.
 * Does not validate local consent — call {@link assertLocalOpenAiRoute} first.
 */
export function routeToAiConfig(route: ModelRoute): AiConfig {
  switch (route.kind) {
    case 'api-key': {
      const cfg: AiConfig = {
        provider: route.provider,
        model: route.model,
        apiKey: route.apiKey,
      };
      if (route.baseUrl) cfg.baseUrl = route.baseUrl;
      return cfg;
    }
    case 'gateway':
      return {
        mode: 'default',
        provider: 'openai-compatible',
        baseUrl: route.baseUrl,
        model: route.model,
        gatewayLive: route.gatewayLive,
      };
    case 'local-openai-compatible': {
      const cfg: AiConfig = {
        provider: 'openai-compatible',
        baseUrl: route.baseUrl,
        model: route.model,
      };
      if (route.apiKey) cfg.apiKey = route.apiKey;
      return cfg;
    }
    case 'model-subscription-oauth':
      return assertSubscriptionOAuthAvailable(route);
  }
}
