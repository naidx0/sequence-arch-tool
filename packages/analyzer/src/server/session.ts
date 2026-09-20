/**
 * Signed sessions + cookie helpers (v12 Phase 2).
 *
 * The auth layer needs two signed, tamper-evident, self-contained tokens carried
 * in cookies: the long-lived SESSION (who the user is, after OAuth) and a
 * short-lived OAuth STATE (the CSRF nonce during a login round-trip). Both are the
 * same primitive: a `base64url(JSON payload).base64url(HMAC-SHA256)` string with an
 * `exp` (unix seconds) expiry baked into the payload. Verification is
 * CONSTANT-TIME ({@link crypto.timingSafeEqual}) so a forged signature cannot be
 * discovered byte-by-byte via timing.
 *
 * No external dependency — only node `crypto`. The secret (`SESSION_SECRET`) never
 * leaves the server; the token body is signed, not encrypted. The SESSION token
 * therefore carries no secret of its own (only a public user id + display fields).
 * The short-lived STATE token additionally carries the PKCE `code_verifier` (`v`) —
 * acceptable because that cookie is `HttpOnly` (no JS read) and `Secure` (HTTPS
 * only), so the verifier stays server-only in practice; it is never exposed to the
 * browser JS or put on the authorize redirect (only the S256 challenge is).
 */

import crypto from 'node:crypto';

/** The session cookie name (the long-lived "who is signed in" token). */
export const SESSION_COOKIE = 'seq_session';
/** The short-lived OAuth CSRF-state cookie name (set at /auth/login, checked at /auth/callback). */
export const STATE_COOKIE = 'seq_oauth_state';
/** Default session lifetime: 7 days. */
export const DEFAULT_SESSION_TTL = 7 * 24 * 60 * 60;

/**
 * Token-KIND tags (the `typ` claim). Minted into every token and REQUIRED at
 * verification, so the two token kinds can never be cross-used even structurally:
 * a signed SESSION cookie can never be replayed as an OAuth STATE nonce (or vice
 * versa) even though both are signed with the same secret. {@link verifySession}
 * accepts only `typ:'session'`; {@link verifyState} accepts only `typ:'state'`.
 */
export const SESSION_TYP = 'session';
export const STATE_TYP = 'state';

/** The verified session payload. `userId` is the stable `"${provider}:${id}"` identity. */
export interface SessionPayload {
  userId: string;
  provider?: string;
  name?: string;
  email?: string;
  /** Expiry, unix seconds. Added by {@link signSession}; enforced by {@link verifyToken}. */
  exp?: number;
}

function hmac(secret: string, data: string): Buffer {
  return crypto.createHmac('sha256', secret).update(data).digest();
}

/**
 * Sign an arbitrary JSON payload into a `body.sig` token that expires in
 * `ttlSeconds`. The expiry is written into the payload as `exp` (unix seconds)
 * before signing, so it is covered by the signature and cannot be extended by a
 * client.
 */
export function signToken(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds));
  const full = { ...payload, exp };
  const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = hmac(secret, body).toString('base64url');
  return `${body}.${sig}`;
}

/**
 * Verify a `body.sig` token: constant-time signature check, then expiry check.
 * Returns the decoded payload on success, or `null` for ANY failure (malformed,
 * tampered signature, wrong secret, or expired). Never throws.
 */
export function verifyToken(token: string | undefined | null, secret: string): Record<string, unknown> | null {
  if (typeof token !== 'string' || token === '' || secret === '') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(secret, body).toString('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Length guard first: timingSafeEqual throws on a length mismatch. A differing
  // length is already a definitive reject, so this leaks nothing useful.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const exp = (payload as { exp?: unknown }).exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  if (Math.floor(Date.now() / 1000) > exp) return null;
  return payload as Record<string, unknown>;
}

/** Mint a signed SESSION token from a payload (adds `exp` + `typ:'session'`). Returned string is the cookie VALUE. */
export function signSession(payload: SessionPayload, secret: string, ttlSeconds: number = DEFAULT_SESSION_TTL): string {
  return signToken({ ...payload, typ: SESSION_TYP }, secret, ttlSeconds);
}

/**
 * Mint a signed OAuth STATE token (adds `exp` + `typ:'state'`). Distinct `typ` from
 * a session token, so a state cookie can never be replayed as a session and a
 * session cookie can never satisfy the CSRF-state check. Verified via {@link verifyState}.
 */
export function signState(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number
): string {
  return signToken({ ...payload, typ: STATE_TYP }, secret, ttlSeconds);
}

/**
 * Verify an OAuth STATE token: the same signature/expiry check as
 * {@link verifyToken}, PLUS a hard `typ:'state'` requirement. A session token (or
 * any token without the state tag) is rejected. Returns the payload, or `null`.
 */
export function verifyState(token: string | undefined | null, secret: string): Record<string, unknown> | null {
  const payload = verifyToken(token, secret);
  if (!payload || payload.typ !== STATE_TYP) return null;
  return payload;
}

/**
 * Read + verify the SESSION cookie out of a raw `Cookie` header. Returns the
 * session payload only when the signature is valid, the token is unexpired, and it
 * carries a non-empty `userId`; otherwise `null`. This is the exact shape the
 * production `resolveIdentity` calls: `verifySession(req.headers.cookie, secret)?.userId`.
 */
export function verifySession(cookieHeader: string | undefined | null, secret: string): SessionPayload | null {
  const raw = readCookie(cookieHeader, SESSION_COOKIE);
  const payload = verifyToken(raw, secret);
  // Require the SESSION kind tag: a state token (or any other signed token) can
  // never be accepted as a session, even though it is signed with the same secret.
  if (!payload || payload.typ !== SESSION_TYP) return null;
  const userId = payload.userId;
  if (typeof userId !== 'string' || userId.trim() === '') return null;
  return payload as unknown as SessionPayload;
}

/** Extract a single cookie value (URL-decoded) from a raw `Cookie` header. */
export function readCookie(cookieHeader: string | undefined | null, name: string): string | undefined {
  if (typeof cookieHeader !== 'string' || cookieHeader === '') return undefined;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return part.slice(idx + 1).trim();
    }
  }
  return undefined;
}

export interface CookieOptions {
  /** Cookie lifetime in seconds. Omitted ⇒ a session cookie (no Max-Age). */
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

/**
 * Build a `Set-Cookie` header value. Defaults are the secure session defaults:
 * `HttpOnly; Secure; SameSite=Lax; Path=/`. `Secure` means the cookie only rides
 * over HTTPS — correct for the hosted deploy (auth is hosted-only); pass
 * `secure:false` only for a plain-HTTP test if ever needed.
 */
export function buildSetCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  if (opts.secure !== false) parts.push('Secure');
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

/** A `Set-Cookie` value that immediately clears `name` (Max-Age=0, empty value). */
export function clearCookie(name: string): string {
  return buildSetCookie(name, '', { maxAge: 0 });
}
