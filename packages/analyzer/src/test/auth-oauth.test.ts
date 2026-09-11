import assert from 'node:assert';
import { test } from 'node:test';
import crypto from 'node:crypto';
import {
  loadAuthConfig,
  authEnabled,
  availableProviders,
  providerConfigured,
  buildAuthorizeUrl,
  callbackUrl,
  exchangeCode,
  generatePkce,
  type AuthConfig,
  type AuthFetch,
} from '../server/auth.js';

/**
 * OAuth config + exchange (v12 Phase 2). The whole provider round-trip is verified
 * against a MOCKED fetch (mirroring github.ts's injectable-fetch honesty); live
 * OAuth is a deploy-time step. Locks: env drives which providers are advertised;
 * the authorize URL carries state/redirect/scope; a callback exchange yields the
 * normalized `"${provider}:${id}"` userId; the client secret only ever rides in the
 * token request body.
 */

const FULL_ENV = {
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  GITHUB_CLIENT_ID: 'h-id',
  GITHUB_CLIENT_SECRET: 'h-secret',
  SESSION_SECRET: 'sess-secret',
  PUBLIC_BASE_URL: 'https://app.example.com/',
} as NodeJS.ProcessEnv;

test('loadAuthConfig: only fully-configured providers are advertised', () => {
  const cfg = loadAuthConfig(FULL_ENV);
  assert.deepStrictEqual(availableProviders(cfg).sort(), ['github', 'google']);
  assert.strictEqual(authEnabled(cfg), true);
  assert.strictEqual(cfg.publicBaseUrl, 'https://app.example.com', 'trailing slash trimmed');

  // A provider with a client id but NO secret is NOT advertised (no dead button).
  const half = loadAuthConfig({ GOOGLE_CLIENT_ID: 'g-id', SESSION_SECRET: 's', PUBLIC_BASE_URL: 'https://x' } as NodeJS.ProcessEnv);
  assert.deepStrictEqual(availableProviders(half), []);
  assert.strictEqual(authEnabled(half), false);
});

test('authEnabled: false when no OAuth env is set (the local regression lock)', () => {
  const cfg = loadAuthConfig({} as NodeJS.ProcessEnv);
  assert.strictEqual(authEnabled(cfg), false);
  assert.deepStrictEqual(availableProviders(cfg), []);
  assert.strictEqual(providerConfigured(cfg, 'google'), false);
});

test('buildAuthorizeUrl carries client_id, redirect_uri, scope, and state', () => {
  const cfg = loadAuthConfig(FULL_ENV);
  const u = new URL(buildAuthorizeUrl(cfg, 'google', 'STATE123'));
  assert.strictEqual(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.strictEqual(u.searchParams.get('client_id'), 'g-id');
  assert.strictEqual(u.searchParams.get('redirect_uri'), callbackUrl(cfg, 'google'));
  assert.strictEqual(u.searchParams.get('redirect_uri'), 'https://app.example.com/auth/callback/google');
  assert.strictEqual(u.searchParams.get('state'), 'STATE123');
  assert.ok((u.searchParams.get('scope') ?? '').includes('email'));

  const gh = new URL(buildAuthorizeUrl(cfg, 'github', 'S'));
  assert.strictEqual(gh.origin + gh.pathname, 'https://github.com/login/oauth/authorize');
  assert.strictEqual(gh.searchParams.get('redirect_uri'), 'https://app.example.com/auth/callback/github');
});

test('generatePkce: verifier is base64url and challenge = S256(verifier)', () => {
  const { verifier, challenge } = generatePkce();
  // RFC 7636: verifier 43–128 chars, base64url alphabet only.
  assert.ok(verifier.length >= 43 && verifier.length <= 128, `verifier length ${verifier.length}`);
  assert.match(verifier, /^[A-Za-z0-9\-_]+$/, 'verifier is base64url (no +/= padding)');
  assert.match(challenge, /^[A-Za-z0-9\-_]+$/, 'challenge is base64url');
  // The challenge must be exactly the S256 digest of the verifier.
  const expected = crypto.createHash('sha256').update(verifier).digest('base64url');
  assert.strictEqual(challenge, expected, 'challenge is base64url(sha256(verifier))');
  assert.notStrictEqual(verifier, challenge);
  // Fresh each call (unguessable).
  assert.notStrictEqual(generatePkce().verifier, verifier);
});

test('buildAuthorizeUrl adds code_challenge + S256 method only when a challenge is given', () => {
  const cfg = loadAuthConfig(FULL_ENV);
  const withPkce = new URL(buildAuthorizeUrl(cfg, 'google', 'ST', 'CHALLENGE123'));
  assert.strictEqual(withPkce.searchParams.get('code_challenge'), 'CHALLENGE123');
  assert.strictEqual(withPkce.searchParams.get('code_challenge_method'), 'S256');
  // Absent when no challenge is supplied (backward-compatible).
  const noPkce = new URL(buildAuthorizeUrl(cfg, 'google', 'ST'));
  assert.strictEqual(noPkce.searchParams.get('code_challenge'), null);
  assert.strictEqual(noPkce.searchParams.get('code_challenge_method'), null);
});

test('exchangeCode sends code_verifier in the token body when supplied (and omits it otherwise)', async () => {
  const cfg = loadAuthConfig(FULL_ENV);
  const script = {
    'https://oauth2.googleapis.com/token': { body: JSON.stringify({ access_token: 'ya29.T' }) },
    'https://openidconnect.googleapis.com/v1/userinfo': { body: JSON.stringify({ sub: 's1' }) },
  };
  const withV = mockFetch(script);
  await exchangeCode(cfg, 'google', 'code', withV.fetch, 'VERIFIER-abc');
  const tokenCall = withV.calls.find((c) => c.url.includes('/token'))!;
  const body = new URLSearchParams(tokenCall.init.body);
  assert.strictEqual(body.get('code_verifier'), 'VERIFIER-abc', 'verifier rides in the token request');

  const noV = mockFetch(script);
  await exchangeCode(cfg, 'google', 'code', noV.fetch);
  const tokenCall2 = noV.calls.find((c) => c.url.includes('/token'))!;
  assert.strictEqual(new URLSearchParams(tokenCall2.init.body).get('code_verifier'), null, 'omitted when not supplied');
});

/** A scripted mock fetch that answers token + userinfo by URL. Records requests. */
function mockFetch(script: Record<string, { ok?: boolean; status?: number; body: string }>): {
  fetch: AuthFetch;
  calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[];
} {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body?: string } }[] = [];
  const fetch: AuthFetch = async (url, init) => {
    calls.push({ url, init });
    const entry = script[url];
    if (!entry) throw new Error(`unexpected fetch to ${url}`);
    return { ok: entry.ok ?? true, status: entry.status ?? 200, text: async () => entry.body };
  };
  return { fetch, calls };
}

test('exchangeCode (google): code → token → userinfo yields google:<sub>', async () => {
  const cfg = loadAuthConfig(FULL_ENV);
  const { fetch, calls } = mockFetch({
    'https://oauth2.googleapis.com/token': { body: JSON.stringify({ access_token: 'ya29.TOKEN' }) },
    'https://openidconnect.googleapis.com/v1/userinfo': {
      body: JSON.stringify({ sub: '109876543210', name: 'Ada Lovelace', email: 'ada@example.com' }),
    },
  });
  const ident = await exchangeCode(cfg, 'google', 'auth-code-xyz', fetch);
  assert.strictEqual(ident.userId, 'google:109876543210');
  assert.strictEqual(ident.provider, 'google');
  assert.strictEqual(ident.name, 'Ada Lovelace');
  assert.strictEqual(ident.email, 'ada@example.com');

  // The client secret rode ONLY in the token request body — never the userinfo call.
  const tokenCall = calls.find((c) => c.url.includes('/token'))!;
  assert.ok(tokenCall.init.body!.includes('g-secret'), 'secret is in the token request body');
  const infoCall = calls.find((c) => c.url.includes('userinfo'))!;
  assert.ok(!JSON.stringify(infoCall.init).includes('g-secret'), 'secret never rides on userinfo');
  assert.strictEqual(infoCall.init.headers.authorization, 'Bearer ya29.TOKEN');
});

test('exchangeCode (github): code → token → user yields github:<id> (id stringified)', async () => {
  const cfg = loadAuthConfig(FULL_ENV);
  const { fetch } = mockFetch({
    'https://github.com/login/oauth/access_token': { body: JSON.stringify({ access_token: 'gho_TOKEN' }) },
    'https://api.github.com/user': { body: JSON.stringify({ id: 424242, login: 'octocat', name: 'The Octocat', email: 'octo@example.com' }) },
  });
  const ident = await exchangeCode(cfg, 'github', 'code', fetch);
  assert.strictEqual(ident.userId, 'github:424242');
  assert.strictEqual(ident.provider, 'github');
  assert.strictEqual(ident.name, 'The Octocat');
  assert.strictEqual(ident.email, 'octo@example.com');
});

test('exchangeCode (github): null email falls back to /user/emails primary+verified', async () => {
  const cfg = loadAuthConfig(FULL_ENV);
  const { fetch } = mockFetch({
    'https://github.com/login/oauth/access_token': { body: JSON.stringify({ access_token: 'gho_TOKEN' }) },
    'https://api.github.com/user': { body: JSON.stringify({ id: 7, login: 'ghost', name: null, email: null }) },
    'https://api.github.com/user/emails': {
      body: JSON.stringify([
        { email: 'secondary@example.com', primary: false, verified: true },
        { email: 'primary@example.com', primary: true, verified: true },
      ]),
    },
  });
  const ident = await exchangeCode(cfg, 'github', 'code', fetch);
  assert.strictEqual(ident.userId, 'github:7');
  assert.strictEqual(ident.email, 'primary@example.com');
  assert.strictEqual(ident.name, 'ghost', 'falls back to login when name is null');
});

test('exchangeCode surfaces a token-endpoint failure without leaking the secret', async () => {
  const cfg = loadAuthConfig(FULL_ENV);
  const { fetch } = mockFetch({
    'https://oauth2.googleapis.com/token': { ok: false, status: 401, body: JSON.stringify({ error: 'invalid_grant' }) },
  });
  await assert.rejects(
    () => exchangeCode(cfg, 'google', 'bad-code', fetch),
    (e: Error) => {
      assert.ok(!e.message.includes('g-secret'), 'the error never carries our secret');
      return /HTTP 401/.test(e.message);
    }
  );
});
