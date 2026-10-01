/**
 * Compose repo-committed policies for a service context — mirrors the language-pack
 * selection seam (`analyzer/src/lang/packs.ts`): repo-wide defaults plus
 * service-scoped overrides when a caller knows which service is in play.
 *
 * PURE: no I/O, no store. `readPolicies` loads every file; this picks the subset
 * that applies at check time.
 */

import type { Policy } from './policy.js';

/**
 * Merge global policies (no `scope`) with service-scoped ones.
 *
 * When `serviceNodeId` is omitted, only repo-wide (unscoped) policies apply —
 * service-scoped files are inert until a caller names the service. When it is
 * provided, unscoped policies plus any file whose `scope` matches are returned,
 * in the same order they appeared in `policies`.
 */
export function composePolicies(policies: readonly Policy[], serviceNodeId?: string): Policy[] {
  if (!policies || policies.length === 0) return [];
  const wantService = serviceNodeId?.trim();
  if (!wantService) {
    return policies.filter((p) => !p.scope || p.scope.trim() === '');
  }
  return policies.filter((p) => {
    const scope = p.scope?.trim();
    if (!scope) return true;
    return scope === wantService;
  });
}
