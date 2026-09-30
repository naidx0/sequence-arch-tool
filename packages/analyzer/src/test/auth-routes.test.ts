import assert from 'node:assert';
import { test } from 'node:test';
import http from 'node:http';
import { createRepoServer } from '../server/repoServer.js';
import { loadAuthConfig, type AuthConfig, type AuthFetch } from '../server/auth.js';
import { signSession, verifySession, SESSION_COOKIE, STATE_COOKIE, readCookie } from '../server/session.js';

/**
 * Auth ROUTES (v12 Phase 2) at the HTTP boundary. Locks: `/api/me` shape with and
 * without a session; `/auth/login/:provider` sets a signed state cookie + 302s to
 * the provider (404 for an unconfigured provider); `/auth/callback` verifies state
 * (CSRF), exchanges the code via an injected mock fetch, and mints a session that
 * `resolveIdentity` then reads; and the ENV-ABSENT regression: no authConfig ⇒
 * `/api/me` advertises nothing and identity stays 'local'.
 */

const AUTH_ENV = {
  GOOGLE_CLIENT_ID: 'g-id',
  GOOGLE_CLIENT_SECRET: 'g-secret',
  SESSION_SECRET: 'sess-secret-abc',
  PUBLIC_BASE_URL: 'https://app.example.com',
} as NodeJS.ProcessEnv;

function mockAuthFetch(): AuthFetch {
  return async (url) => {
    if (url.includes('/token')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'TOK' }) };
    }
    if (url.includes('userinfo')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ sub: '55501', name: 'Grace', email: 'grace@example.com' }) };
    }
    throw new Error(`unexpected ${url}`);
  };
}

async function startServer(opts: {
  authConfig?: AuthConfig;
  authFetch?: AuthFetch;
} = {}): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(null, {
    webDist: undefined,
    authConfig: opts.authConfig,
    authFetch: opts.authFetch,
    // Production wiring: identity comes from the signed session cookie.
    resolveIdentity: opts.authConfig
      ? (req: http.IncomingMessage) => verifySession(req.headers.cookie, opts.authConfig!.sessionSecret)?.userId
      : undefined,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('/api/me: no authConfig ⇒ signedIn:false, empty availableProviders (env-absent lock)', async () => {
  const { base, close } = await startServer();
  try {
    const me = (await (await fetch(`${base}/api/me`)).json()) as { signedIn: boolean; availableProviders: string[] };
    assert.strictEqual(me.signedIn, false);
    assert.deepStrictEqual(me.availableProviders, []);
    // login is 404 when nothing is configured.
    const login = await fetch(`${base}/auth/login/google`, { redirect: 'manual' });
    assert.strictEqual(login.status, 404);
  } finally {
    await close();
  }
});

test('/api/me: authConfig present but no session ⇒ availableProviders lists configured providers', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const { base, close } = await startServer({ authConfig, authFetch: mockAuthFetch() });
  try {
    const me = (await (await fetch(`${base}/api/me`)).json()) as { signedIn: boolean; availableProviders: string[] };
    assert.strictEqual(me.signedIn, false);
    assert.deepStrictEqual(me.availableProviders, ['google']);
  } finally {
    await close();
  }
});

test('/api/me: a valid signed session cookie ⇒ signedIn with provider/name/email', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const { base, close } = await startServer({ authConfig, authFetch: mockAuthFetch() });
  try {
    const cookie = `${SESSION_COOKIE}=${signSession({ userId: 'google:55501', provider: 'google', name: 'Grace', email: 'grace@example.com' }, authConfig.sessionSecret)}`;
    const me = (await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()) as {
      signedIn: boolean;
      provider: string;
      name: string;
      email: string;
    };
    assert.strictEqual(me.signedIn, true);
    assert.strictEqual(me.provider, 'google');
    assert.strictEqual(me.name, 'Grace');
    assert.strictEqual(me.email, 'grace@example.com');
  } finally {
    await close();
  }
});

test('/auth/login/google: 302 to the provider + a signed state cookie', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const { base, close } = await startServer({ authConfig, authFetch: mockAuthFetch() });
  try {
    const res = await fetch(`${base}/auth/login/google`, { redirect: 'manual' });
    assert.strictEqual(res.status, 302);
    const loc = res.headers.get('location') ?? '';
    assert.ok(loc.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), 'redirects to google');
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.ok(setCookie.includes(`${STATE_COOKIE}=`), 'sets the state cookie');
    assert.ok(setCookie.includes('HttpOnly') && setCookie.includes('SameSite=Lax'), 'secure cookie flags');
  } finally {
    await close();
  }
});

test('/auth/callback/google: valid state → exchange → session; then resolveIdentity keys the meter', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const { base, close } = await startServer({ authConfig, authFetch: mockAuthFetch() });
  try {
    // Step 1: /auth/login to obtain a real signed state cookie + the state value.
    const login = await fetch(`${base}/auth/login/google`, { redirect: 'manual' });
    const stateCookieHeader = login.headers.get('set-cookie') ?? '';
    const stateCookieVal = readCookie(stateCookieHeader.split(';')[0], STATE_COOKIE)!;
    const stateValue = new URL(login.headers.get('location')!).searchParams.get('state')!;

    // Step 2: the provider redirects back with ?code&state; we present the state cookie.
    const cb = await fetch(`${base}/auth/callback/google?code=abc&state=${encodeURIComponent(stateValue)}`, {
      redirect: 'manual',
      headers: { cookie: `${STATE_COOKIE}=${encodeURIComponent(stateCookieVal)}` },
    });
    assert.strictEqual(cb.status, 302);
    assert.strictEqual(cb.headers.get('location'), '/');
    const sessionSetCookie = cb.headers.get('set-cookie') ?? '';
    assert.ok(sessionSetCookie.includes(`${SESSION_COOKIE}=`), 'mints a session cookie');
    const sessionVal = readCookie(sessionSetCookie.split(';')[0], SESSION_COOKIE)!;

    // Step 3: the session drives /api/me → the real user, isolated per person.
    const me = (await (await fetch(`${base}/api/me`, { headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessionVal)}` } })).json()) as {
      signedIn: boolean;
      provider: string;
      email: string;
    };
    assert.strictEqual(me.signedIn, true);
    assert.strictEqual(me.provider, 'google');
    assert.strictEqual(me.email, 'grace@example.com');
  } finally {
    await close();
  }
});

test('/auth/callback/google: missing/blank state is rejected as CSRF (400)', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const { base, close } = await startServer({ authConfig, authFetch: mockAuthFetch() });
  try {
    // No state param and no state cookie.
    const noState = await fetch(`${base}/auth/callback/google?code=abc`, { redirect: 'manual' });
    assert.strictEqual(noState.status, 400);

    // A state param present but no matching signed cookie ⇒ still rejected.
    const mismatched = await fetch(`${base}/auth/callback/google?code=abc&state=forged`, { redirect: 'manual' });
    assert.strictEqual(mismatched.status, 400);
  } finally {
    await close();
  }
});

test('POST /auth/logout clears the session cookie', async () => {
  const authConfig = loadAuthConfig(AUTH_ENV);
  const { base, close } = await startServer({ authConfig, authFetch: mockAuthFetch() });
  try {
    const res = await fetch(`${base}/auth/logout`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    assert.ok(setCookie.includes(`${SESSION_COOKIE}=`) && setCookie.includes('Max-Age=0'), 'expires the session cookie');
  } finally {
    await close();
  }
});
