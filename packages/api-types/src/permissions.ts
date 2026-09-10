/**
 * GET/PUT `/api/permissions` — project `.sequence/permissions.json`.
 *
 * The file is the source of truth (diffable in the repo). The Settings panel
 * edits the same text the algebra loads — not a second shadow copy.
 */

/** On-disk / on-wire document (mirrors analyzer `PermissionDocument`). */
export interface PermissionsDocument {
  version: number;
  default: 'allow' | 'ask' | 'deny';
  denyStreak: number;
  deny: string[];
  ask: string[];
  allow: string[];
}

/** GET /api/permissions */
export interface GetPermissionsResponse {
  /** Absolute path under the attached repo (for the reader). */
  path: string;
  /** False when the file is absent — `document` is then the empty default. */
  exists: boolean;
  document: PermissionsDocument;
  /** Canonical serialized text (what Save would write). */
  text: string;
  /** Parse / load warnings — never silent. */
  warnings: string[];
}

/** PUT /api/permissions — send the file body as text. */
export interface PutPermissionsRequest {
  text: string;
}

export interface PutPermissionsResponse {
  path: string;
  document: PermissionsDocument;
  text: string;
  warnings: string[];
}

/* ---------------------- GET/PUT /api/auto-approve ------------------------- */

/**
 * AUTO-APPROVE — the unattended autonomy mode (analyzer `server/autoApprove.ts`).
 *
 * It converts an `ask` verdict into `allow` for the session and does nothing
 * else: a `deny` rule still refuses, and every refusal that is CODE rather than
 * policy — the write jail, the resolved-script check on an allowlisted command,
 * the untrusted-repo execution refusal — is untouched.
 *
 * TWO PROPERTIES A CLIENT MUST NOT DESIGN AROUND:
 *
 *   1. It is GATED ON REPO TRUST, not on a preference. `PUT {"on":true}` for an
 *      untrusted repository is REFUSED (403) with the reason, and `on` goes
 *      false again by itself the moment trust is revoked — so the answer is
 *      re-read, never cached.
 *   2. It is SESSION-SCOPED and lives in the server's memory. It does not
 *      survive a restart, and there is deliberately no file to persist it in.
 */
export interface GetAutoApproveResponse {
  /** Absolute server-side root, as `/api/status` reports it. */
  root: string;
  /** Whether the repository is trusted — the gate this mode rides on. */
  trusted: boolean;
  /** Active right now: switched on AND still trusted. */
  on: boolean;
  /** Why it is off, in one sentence, or null when it is on. */
  refusal: string | null;
}

/** PUT /api/auto-approve — the one explicit action, scoped to this repo root. */
export interface PutAutoApproveRequest {
  on: boolean;
}

/** What the SESSION now says, re-read rather than echoed. */
export type PutAutoApproveResponse = GetAutoApproveResponse;
