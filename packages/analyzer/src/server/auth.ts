/**
 * OAuth sign-in (Google + GitHub) — env-driven config + the authorize/exchange
 * flow (v12 Phase 2).
 *
 * This is the app-side of hosted account login. It is ADDITIVE and ENV-GATED: with
 * no OAuth env set {@link authEnabled} is false, no routes light up, and the server
 * behaves exactly as the local single-user IDE (identity stays `'local'`). When the
 * env IS present, `GET /auth/login/:provider` redirects to the provider with a
 * signed CSRF `state`, and `GET /auth/callback/:provider` exchanges the `code` for
 * a token + userinfo and mints a signed session.
 *
 * Every network call goes through an INJECTABLE `fetch` ({@link AuthFetch}),
 * mirroring the honesty of `github.ts`: tests substitute a mock so the real
 * accounts.google.com / github.com round-trip is never made in the sandbox, while
 * the entire client path (URLs, the token-bearing headers, status handling, JSON
 * parse, identity normalization) is exercised. Live OAuth is verified only on
 * deploy with real client credentials — documented as verified-against-mock only.
 *
 * Secret hygiene mirrors provider.ts/github.ts: the client secret rides ONLY in the
 * token-exchange request body this module builds; an {@link AuthError} carries only
 * the provider's *response* status/body (provider-authored, so it cannot echo our
 * secret) and never the request.
 */

import crypto from 'node:crypto';

/** The structural subset of a `fetch` `Response` this module uses; the real `fetch` satisfies it. */
export interface AuthFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export type AuthFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<AuthFetchResponse>;

/** The real-network default: the platform `fetch`. */
export const defaultAuthFetch: AuthFetch = (url, init) => fetch(url, init);

export type AuthProvider = 'google' | 'github';

interface ProviderEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
}

/** FIXED provider endpoints (never caller-influenced ⇒ not an SSRF surface). */
const PROVIDERS: Record<AuthProvider, ProviderEndpoints> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
  },
};

export interface ProviderCreds {
  clientId: string;
  clientSecret: string;
}

export interface AuthConfig {
  /** HMAC secret for signing session + state cookies. Empty ⇒ auth disabled. */
  sessionSecret: string;
  /** Public origin (e.g. https://app.example.com), used to build callback URLs. No trailing slash. */
  publicBaseUrl: string;
  /** Only providers whose id AND secret are both present appear here. */
  providers: Partial<Record<AuthProvider, ProviderCreds>>;
}

/** True for a valid provider slug. */
export function isProvider(x: unknown): x is AuthProvider {
  return x === 'google' || x === 'github';
}

/**
 * Read the OAuth config from the environment. A provider is "configured" ONLY when
 * BOTH its client id and secret are present, so a half-set env never advertises a
 * dead button. `SESSION_SECRET` and `PUBLIC_BASE_URL` are also required for auth to
 * be live (see {@link authEnabled}).
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const providers: Partial<Record<AuthProvider, ProviderCreds>> = {};
  const gId = (env.GOOGLE_CLIENT_ID ?? '').trim();
  const gSecret = (env.GOOGLE_CLIENT_SECRET ?? '').trim();
  if (gId !== '' && gSecret !== '') providers.google = { clientId: gId, clientSecret: gSecret };
  const hId = (env.GITHUB_CLIENT_ID ?? '').trim();
  const hSecret = (env.GITHUB_CLIENT_SECRET ?? '').trim();
  if (hId !== '' && hSecret !== '') providers.github = { clientId: hId, clientSecret: hSecret };
  return {
    sessionSecret: (env.SESSION_SECRET ?? '').trim(),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    providers,
  };
}

/** The providers that are fully configured (both id + secret present). */
export function availableProviders(cfg: AuthConfig): AuthProvider[] {
  return (['google', 'github'] as AuthProvider[]).filter((p) => cfg.providers[p]);
}

/** Is a specific provider configured? */
export function providerConfigured(cfg: AuthConfig, provider: unknown): provider is AuthProvider {
  return isProvider(provider) && !!cfg.providers[provider];
}

/**
 * Auth is LIVE only when a session secret is set, a public base URL is known (to
 * build callback URLs), and at least one provider is fully configured. With none of
 * the env set this is false ⇒ the server stays in local single-user mode.
 */
export function authEnabled(cfg: AuthConfig): boolean {
  return cfg.sessionSecret !== '' && cfg.publicBaseUrl !== '' && availableProviders(cfg).length > 0;
}

/** The provider's OAuth redirect/callback URL, derived from the public base URL. */
export function callbackUrl(cfg: AuthConfig, provider: AuthProvider): string {
  return `${cfg.publicBaseUrl}/auth/callback/${provider}`;
}

/** A fresh, unguessable CSRF `state` value. */
export function randomState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** A PKCE (RFC 7636) verifier + its S256 challenge. */
export interface Pkce {
  /** The high-entropy secret kept server-side (in the signed HttpOnly state cookie). */
  verifier: string;
  /** `base64url(sha256(verifier))` — sent on the authorize redirect. */
  challenge: string;
}

/**
 * Generate a PKCE pair (RFC 7636, S256). The `verifier` is 32 random bytes
 * base64url-encoded (a 43-char string, within the spec's 43–128 range); the
 * `challenge` is its SHA-256 digest, base64url. Even though the app is a
 * confidential client (it holds a client secret), PKCE is defence-in-depth: it
 * binds the authorization code to this specific login attempt, so a code stolen
 * at the redirect can't be redeemed without the verifier we never put on the wire.
 */
export function generatePkce(): Pkce {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Build the provider's authorize-redirect URL, carrying `client_id`, `redirect_uri`,
 * `scope`, `state`, and — when a PKCE `codeChallenge` is supplied — `code_challenge`
 * + `code_challenge_method=S256`.
 */
export function buildAuthorizeUrl(
  cfg: AuthConfig,
  provider: AuthProvider,
  state: string,
  codeChallenge?: string
): string {
  const creds = cfg.providers[provider];
  if (!creds) throw new AuthError(`auth provider not configured: ${provider}`);
  const ep = PROVIDERS[provider];
  const u = new URL(ep.authorizeUrl);
  u.searchParams.set('client_id', creds.clientId);
  u.searchParams.set('redirect_uri', callbackUrl(cfg, provider));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', ep.scope);
  u.searchParams.set('state', state);
  if (codeChallenge) {
    u.searchParams.set('code_challenge', codeChallenge);
    u.searchParams.set('code_challenge_method', 'S256');
  }
  if (provider === 'google') {
    u.searchParams.set('access_type', 'online');
    u.searchParams.set('prompt', 'select_account');
  }
  return u.toString();
}

/** A normalized cross-provider identity. `userId` is the stable metering key. */
export interface NormalizedIdentity {
  /** `"${provider}:${providerUserId}"` — the stable per-user metering identity. */
  userId: string;
  provider: AuthProvider;
  providerUserId: string;
  name?: string;
  email?: string;
}

/**
 * An OAuth-boundary failure. `status`/`body` describe the PROVIDER's response only
 * (provider-authored ⇒ cannot contain our client secret). Mirrors ProviderError /
 * GithubError.
 */
export class AuthError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, opts?: { status?: number; body?: string }) {
    super(message);
    this.name = 'AuthError';
    this.status = opts?.status;
    this.body = opts?.body;
  }
}

function strOrUndef(x: unknown): string | undefined {
  return typeof x === 'string' && x.trim() !== '' ? x : undefined;
}

/**
 * The full callback exchange: `code` → access token → userinfo → normalized
 * identity. All over the injected `doFetch` (tests mock it). Throws an
 * {@link AuthError} (secret-free) on any failure.
 */
export async function exchangeCode(
  cfg: AuthConfig,
  provider: AuthProvider,
  code: string,
  doFetch: AuthFetch = defaultAuthFetch,
  codeVerifier?: string
): Promise<NormalizedIdentity> {
  const creds = cfg.providers[provider];
  if (!creds) throw new AuthError(`auth provider not configured: ${provider}`);
  const ep = PROVIDERS[provider];
  const accessToken = await exchangeToken(ep, creds, cfg, provider, code, doFetch, codeVerifier);
  return fetchIdentity(ep, provider, accessToken, doFetch);
}

async function exchangeToken(
  ep: ProviderEndpoints,
  creds: ProviderCreds,
  cfg: AuthConfig,
  provider: AuthProvider,
  code: string,
  doFetch: AuthFetch,
  codeVerifier?: string
): Promise<string> {
  // The client secret rides ONLY in this request body. Form-encoded is what both
  // Google and GitHub token endpoints accept; `accept: application/json` makes
  // GitHub return JSON (else it replies url-encoded).
  const params = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code,
    redirect_uri: callbackUrl(cfg, provider),
    grant_type: 'authorization_code',
  });
  // PKCE: prove this redemption belongs to the login attempt that produced the
  // challenge. Omitted only if the login predates PKCE (backward-compatible).
  if (codeVerifier) params.set('code_verifier', codeVerifier);
  let res: AuthFetchResponse;
  try {
    res = await doFetch(ep.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: params.toString(),
    });
  } catch (e) {
    throw new AuthError(`token exchange request failed: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new AuthError(`token endpoint returned HTTP ${res.status}`, { status: res.status, body: text });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AuthError('token response was not valid JSON');
  }
  const at = (parsed as { access_token?: unknown } | null)?.access_token;
  if (typeof at !== 'string' || at.trim() === '') {
    // Some providers report OAuth errors as a 200 with an `error` field.
    const err = strOrUndef((parsed as { error?: unknown } | null)?.error);
    throw new AuthError(err ? `token endpoint error: ${err}` : 'token response missing access_token');
  }
  return at;
}

async function fetchIdentity(
  ep: ProviderEndpoints,
  provider: AuthProvider,
  accessToken: string,
  doFetch: AuthFetch
): Promise<NormalizedIdentity> {
  let res: AuthFetchResponse;
  try {
    res = await doFetch(ep.userInfoUrl, {
      method: 'GET',
      headers: {
        // The access token (NOT our client secret) rides here.
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        'user-agent': 'sequence',
      },
    });
  } catch (e) {
    throw new AuthError(`userinfo request failed: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new AuthError(`userinfo endpoint returned HTTP ${res.status}`, { status: res.status, body: text });
  }
  let info: unknown;
  try {
    info = JSON.parse(text);
  } catch {
    throw new AuthError('userinfo response was not valid JSON');
  }
  const o = (info ?? {}) as Record<string, unknown>;

  if (provider === 'google') {
    const sub = strOrUndef(o.sub);
    if (!sub) throw new AuthError('google userinfo missing "sub"');
    return { userId: `google:${sub}`, provider, providerUserId: sub, name: strOrUndef(o.name), email: strOrUndef(o.email) };
  }

  // github: `id` is numeric; normalize to a string. `email` may be null when the
  // user hid it — best-effort fetch the primary verified address.
  const rawId = o.id;
  if (typeof rawId !== 'number' && typeof rawId !== 'string') {
    throw new AuthError('github userinfo missing "id"');
  }
  const pid = String(rawId);
  let email = strOrUndef(o.email);
  if (!email) email = await fetchGithubPrimaryEmail(accessToken, doFetch);
  const name = strOrUndef(o.name) ?? strOrUndef(o.login);
  return { userId: `github:${pid}`, provider, providerUserId: pid, name, email };
}

/** Best-effort: GitHub's primary verified email (a separate scope-gated endpoint). Never throws. */
async function fetchGithubPrimaryEmail(accessToken: string, doFetch: AuthFetch): Promise<string | undefined> {
  try {
    const res = await doFetch('https://api.github.com/user/emails', {
      method: 'GET',
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json', 'user-agent': 'sequence' },
    });
    if (!res.ok) return undefined;
    const parsed = JSON.parse(await res.text());
    if (!Array.isArray(parsed)) return undefined;
    const primary = parsed.find(
      (e) => e && typeof e === 'object' && (e as { primary?: unknown }).primary === true && (e as { verified?: unknown }).verified === true
    );
    const any = primary ?? parsed.find((e) => e && typeof e === 'object' && (e as { verified?: unknown }).verified === true);
    const email = (any as { email?: unknown } | undefined)?.email;
    return strOrUndef(email);
  } catch {
    return undefined;
  }
}
