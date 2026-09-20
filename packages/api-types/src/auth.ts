/**
 * Auth / identity — `GET /api/me` and the `authConfig` gate in `server/repoServer.ts`.
 *
 * Env-gated: with no `authConfig` the server stays in local single-user mode,
 * `availableProviders` is `[]`, and `/api/me` always answers `{ signedIn: false }`.
 * The login/callback pair is a 302 dance with a signed PKCE state cookie; neither
 * has a success body.
 */

import type { ApiErrorResponse, NoBodyRedirect } from './common.js';

/** The only two OAuth providers the server can be configured with (`auth.ts:41`). */
export type AuthProviderId = 'google' | 'github';

/* ------------------------------------------------- GET /api/me — :940 ----- */

/**
 * No request body or query — the session arrives as a signed cookie.
 * Declared for symmetry so a client can name the request type of every route.
 */
export type GetMeRequest = void;

/**
 * Signed in. `provider`/`name`/`email` come off the verified session payload
 * (`session.ts:41-48`), where all three are OPTIONAL — a provider that returned no
 * display name yields a session without one, and `JSON.stringify` then drops the
 * key entirely. `provider` is a plain string on the session, not narrowed to
 * {@link AuthProviderId}, so it is typed as it actually arrives.
 */
export interface GetMeSignedInResponse {
  signedIn: true;
  availableProviders: AuthProviderId[];
  provider?: string;
  name?: string;
  email?: string;
}

/** Signed out (and the ONLY answer when auth is not configured). */
export interface GetMeSignedOutResponse {
  signedIn: false;
  availableProviders: AuthProviderId[];
}

export type GetMeResponse = GetMeSignedInResponse | GetMeSignedOutResponse;

/* ------------------------- GET /auth/login/:provider — :963 --------------- */

/** The provider is a path segment, not a body: `/auth/login/google`. */
export interface GetAuthLoginParams {
  provider: string;
}

/**
 * 302 to the provider's authorize URL, with the signed PKCE state cookie set.
 * There is no success body.
 *
 * Failures: **404** `{ error }` when the provider is not configured.
 */
export type GetAuthLoginResponse = NoBodyRedirect;

/* ---------------------- GET /auth/callback/:provider — :984 --------------- */

/** `?state` and `?code` are query parameters; the provider is a path segment. */
export interface GetAuthCallbackParams {
  provider: string;
  state: string;
  code: string;
}

/**
 * 302 to `/` with the session cookie set. No success body.
 *
 * Failures, all `{ error }`: **404** provider not configured · **400** missing or
 * mismatched OAuth state (possible CSRF) · **400** missing authorization code ·
 * **502** the code-for-token exchange failed (the message carries the provider's
 * own response, never our secret).
 */
export type GetAuthCallbackResponse = NoBodyRedirect;

/** The failure envelope both redirect routes fall back to. */
export type AuthErrorResponse = ApiErrorResponse;

/* ----------------------------- POST /auth/logout — :1037 ------------------ */

/** No body — the route only clears the session cookie. */
export type PostAuthLogoutRequest = void;

export interface PostAuthLogoutResponse {
  signedIn: false;
}
