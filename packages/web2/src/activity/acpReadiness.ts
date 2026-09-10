/**
 * P4 — ACP readiness BEFORE Start, not only after a 403.
 *
 * `@sequence/api-types` says a client must feature-detect through
 * `/api/acp/available`. Activity used to POST `/api/program/run` blind and only
 * surface "ACP is not available" after the refusal. That is still honest; this
 * probe tells the reader the same sentence before they commit a form.
 *
 * PURE. Wire results in → note out. No fetch.
 */

export type AcpReadiness =
  | { kind: 'unknown' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'no-agents' }
  | { kind: 'ready'; count: number };

/**
 * Calm copy for the author form. `null` when there is nothing useful to say
 * (probe still pending, or agents are registered — do not invent a green bar).
 */
export function acpReadinessNote(readiness: AcpReadiness): string | null {
  switch (readiness.kind) {
    case 'unknown':
      return null;
    case 'unavailable':
      return readiness.reason;
    case 'no-agents':
      return 'No local ACP agent is registered yet. Built-in workflows need one — register with `sequence agent add <id> --command <bin>`, then Start again.';
    case 'ready':
      return null;
  }
}
