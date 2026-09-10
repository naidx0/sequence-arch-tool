/**
 * ADR-013 Phase B — bounded, capability-aware one-hop failover policy.
 */

import {
  type ModelCapability,
  type ModelRoute,
  routeCapabilities,
  routePrivacyBoundary,
  type PrivacyBoundary,
  redactRoute,
  type RouteDiagnostic,
} from './modelRoutes.js';

export interface FailoverContext {
  primary: ModelRoute;
  alternate?: ModelRoute;
  requiredCapabilities?: ModelCapability[];
  /** Privacy boundary of the primary route — local→remote upgrade is forbidden. */
  privacyBoundary: PrivacyBoundary;
  /** When true, failover is blocked (tool/file side effects began). */
  sideEffectsStarted: boolean;
}

const FREE_TIER_NOT_LIVE = 'the free assistant is not live yet';
const FREE_TIER_DAILY = "You've hit today's free limit";

function isProviderError(err: unknown): err is Error & { status?: number } {
  return err instanceof Error && err.name === 'ProviderError';
}

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && err.name === 'RateLimitError';
}

/** True when a route satisfies all required capabilities. */
export function routeSatisfiesCapabilities(route: ModelRoute, required?: ModelCapability[]): boolean {
  if (!required || required.length === 0) return true;
  const caps = routeCapabilities(route);
  return required.every((c) => caps.includes(c));
}

/**
 * Transient failures eligible for failover: network, timeout, HTTP 408/429, provider 5xx.
 * Auth, policy, context-overflow, and invalid-request failures are excluded.
 */
export function isTransientProviderFailure(err: unknown): boolean {
  if (isRateLimitError(err)) return false;
  if (isProviderError(err)) {
    if (err.message.includes(FREE_TIER_NOT_LIVE) || err.message.includes(FREE_TIER_DAILY)) return false;
    const status = err.status;
    if (status === 408 || status === 429) return true;
    if (status !== undefined && status >= 500) return true;
    if (status === 401 || status === 403 || status === 400) return false;
    if (status !== undefined && status < 500 && status !== 408 && status !== 429) return false;
    /*
     * An answerless 200 — no text, no tool calls — is a flaked generation
     * (measured on OpenRouter free-tier backends, 2026-08-29: two turns died
     * on it). The reply carried nothing, so no side effects were consumed,
     * and both a bounded retry and a one-hop failover are the user's friend.
     */
    if (err.message.startsWith('could not locate assistant text')) return true;
    return err.message.startsWith('provider request failed');
  }
  return err instanceof Error && /fetch failed|network/i.test(err.message);
}

/** Whether a one-hop failover to `ctx.alternate` is allowed for `err`. */
export function canFailover(ctx: FailoverContext, err: unknown): boolean {
  if (!ctx.alternate) return false;
  if (ctx.sideEffectsStarted) return false;
  if (!isTransientProviderFailure(err)) return false;
  if (ctx.privacyBoundary === 'local' && routePrivacyBoundary(ctx.alternate) === 'remote') return false;
  if (!routeSatisfiesCapabilities(ctx.alternate, ctx.requiredCapabilities)) return false;
  return true;
}

/** Secret-free diagnostics for a blocked failover attempt. */
export function failoverBlockedDiagnostic(ctx: FailoverContext, err: unknown): RouteDiagnostic {
  const base = redactRoute(ctx.alternate!);
  if (ctx.sideEffectsStarted) {
    return { ...base, message: 'failover blocked: tool or file side effects already began' };
  }
  if (ctx.privacyBoundary === 'local' && routePrivacyBoundary(ctx.alternate!) === 'remote') {
    return { ...base, message: 'failover blocked: local route cannot upgrade to remote' };
  }
  if (!routeSatisfiesCapabilities(ctx.alternate!, ctx.requiredCapabilities)) {
    return { ...base, message: 'failover blocked: alternate route lacks required capabilities' };
  }
  if (isProviderError(err) && (err.status === 401 || err.status === 403)) {
    return { ...base, message: 'failover blocked: authentication failure' };
  }
  if (isRateLimitError(err)) {
    return { ...base, message: 'failover blocked: policy rate limit' };
  }
  return { ...base, message: 'failover blocked: failure is not transient' };
}
