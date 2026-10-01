/**
 * SAVED MODELS, ON THE REAL ROUTE.
 *
 * The measured defect, in the owner's words: "can we save different models to
 * switch between? can you set a default model?" — no, and no. `/api/ai-config`
 * held ONE flat config, so changing your mind meant retyping provider + model +
 * baseUrl + key, and there was no memory of the model you used ten minutes ago.
 *
 * WHY THIS FILE DRIVES THE HTTP ROUTE rather than `validateAiConfig` alone. The
 * two things most likely to be wrong here only exist at the route:
 *
 *   1. THE KEY MERGE. A client only ever holds `••••9f3a`. If the panel sends
 *      the list back to change one field and the server stores what it was
 *      given, the bullets BECOME the credential and the model stops answering.
 *      A unit test on the validator cannot see that; this one writes, re-reads,
 *      and asserts on the bytes actually on disk.
 *   2. THE SWITCH. `{selectProfileId}` must change who answers and touch
 *      nothing else.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');

const CLAUDE_KEY = 'sk-ant-test-SUPERSECRET-9f3a';
const LOCAL_BASE = 'http://127.0.0.1:11434/v1';

function ticketingRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-profiles-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  return repo;
}

async function startServer(repoRoot: string): Promise<{ base: string; repo: string; close: () => Promise<void> }> {
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-profiles-user-')));
  /*
   * THIS SUITE ASSERTS PER-REPO CONFIG, SO IT MUST CONSENT TO THE REPO.
   *
   * Every assertion below reads `onDisk(repo)` — the config in the repository's
   * own `.sequence/ai.json`. An UNTRUSTED repository is not a place the user's
   * settings are kept: `PUT /api/ai-config` routes them to the user store
   * instead, because a repo's own ai.json is ignored while untrusted (it can
   * point `baseUrl` at an attacker's host) and writing the user's key into a
   * directory that is not gitignored is its own hazard. So an unconsenting
   * fixture would find an empty repo file and fail six tests that are about
   * key masking and profile round-tripping, not about trust.
   *
   * `isRepoTrusted`'s OWN default store, never `userConfigDir` — the boundary
   * has exactly one store, and `isolate-user-store.js` has already pointed it
   * somewhere disposable for this process.
   */
  setRepoTrust(userStoreDir(), repoRoot, true);
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    repo: repoRoot,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function onDisk(repo: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(repo, '.sequence', 'ai.json'), 'utf8')) as Record<string, unknown>;
}

async function put(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const TWO_PROFILES = {
  profiles: [
    { id: 'local', name: 'Local, cheap', provider: 'openai-compatible', model: 'granite4-hermes:latest', baseUrl: LOCAL_BASE },
    { id: 'claude', name: 'Claude, hard edits', provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: CLAUDE_KEY },
  ],
  defaultProfileId: 'claude',
};

test('two saved models round-trip; the list comes back with every key masked', async () => {
  const { base, repo, close } = await startServer(ticketingRepo());
  try {
    const res = await put(base, TWO_PROFILES);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      model: string;
      profiles: { id: string; name: string; apiKey?: string }[];
      defaultProfileId: string;
    };
    /* The flat fields still name who answers, so a reader that predates
       profiles is not broken by them. */
    assert.equal(body.model, 'claude-sonnet-4-5');
    assert.equal(body.defaultProfileId, 'claude');
    assert.equal(body.profiles.length, 2);
    const claude = body.profiles.find((p) => p.id === 'claude')!;
    assert.ok(claude.apiKey && !claude.apiKey.includes('SUPERSECRET'));
    assert.equal(body.profiles.find((p) => p.id === 'local')!.apiKey, undefined);
    /* On disk it is the LIST, not the resolved-flat object: writing the
       resolution would duplicate the active profile's key for no reader. */
    const file = onDisk(repo);
    assert.ok(Array.isArray(file.profiles));
    assert.equal(file.defaultProfileId, 'claude');
    assert.equal(JSON.stringify(file).includes(CLAUDE_KEY), true, 'the real key lives on disk');
  } finally {
    await close();
  }
});

test('switching is ONE field and moves nothing else', async () => {
  const { base, repo, close } = await startServer(ticketingRepo());
  try {
    await put(base, TWO_PROFILES);
    const res = await put(base, { selectProfileId: 'local' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { model: string; provider: string; baseUrl?: string; defaultProfileId: string };
    /* Two clicks from Claude to the local model, nothing retyped. */
    assert.equal(body.model, 'granite4-hermes:latest');
    assert.equal(body.provider, 'openai-compatible');
    assert.equal(body.baseUrl, LOCAL_BASE);
    assert.equal(body.defaultProfileId, 'local');
    /* And Claude's key is still there to switch back to. */
    assert.equal(JSON.stringify(onDisk(repo)).includes(CLAUDE_KEY), true);
  } finally {
    await close();
  }
});

test('a switch to a model that is not saved is refused, and changes nothing', async () => {
  const { base, repo, close } = await startServer(ticketingRepo());
  try {
    await put(base, TWO_PROFILES);
    const res = await put(base, { selectProfileId: 'gpt-9' });
    assert.equal(res.status, 404);
    assert.equal(onDisk(repo).defaultProfileId, 'claude');
  } finally {
    await close();
  }
});

test('THE MASK NEVER BECOMES THE KEY', async () => {
  const { base, repo, close } = await startServer(ticketingRepo());
  try {
    await put(base, TWO_PROFILES);
    /*
     * This is exactly what the settings pane sends when the reader renames a
     * profile: the whole list, with no key on the entry they did not retype.
     * If the server stored what it was given, `claude` would come back keyless
     * (a 400 for a remote provider) or — worse, with a mask sent — would store
     * the bullets and every later request would 401.
     */
    const res = await put(base, {
      profiles: [
        TWO_PROFILES.profiles[0],
        { id: 'claude', name: 'Claude, renamed', provider: 'anthropic', model: 'claude-opus-5' },
      ],
      defaultProfileId: 'claude',
    });
    const body = (await res.json()) as {
      model: string;
      profiles: { id: string; name: string }[];
      error?: string;
    };
    assert.equal(res.status, 200, body.error ?? '');
    const file = JSON.stringify(onDisk(repo));
    assert.ok(file.includes(CLAUDE_KEY), 'the stored key must survive an edit that omitted it');
    assert.ok(!file.includes('••••'), 'a mask must never be written as a credential');
    assert.equal(body.model, 'claude-opus-5');
    assert.equal(body.profiles.find((p) => p.id === 'claude')!.name, 'Claude, renamed');
  } finally {
    await close();
  }
});

test('a config saved before profiles existed is SHOWN as the one saved model it is', async () => {
  const { base, close } = await startServer(ticketingRepo());
  try {
    /* The pre-profiles PUT, byte-for-byte what this route has always accepted. */
    const res = await put(base, {
      provider: 'openai-compatible',
      baseUrl: LOCAL_BASE,
      model: 'granite4-hermes:latest',
    });
    assert.equal(res.status, 200);
    const get = (await (await fetch(`${base}/api/ai-config`)).json()) as {
      configured: boolean;
      profiles?: { id: string; name: string; model: string }[];
      defaultProfileId?: string;
    };
    assert.equal(get.configured, true);
    /* A picker that saw nothing here would tell the reader they have no saved
       model when they plainly do. */
    assert.equal(get.profiles?.length, 1);
    assert.equal(get.profiles?.[0]!.model, 'granite4-hermes:latest');
    assert.equal(get.defaultProfileId, get.profiles?.[0]!.id);
  } finally {
    await close();
  }
});

test('knobs survive the round trip and are never masked', async () => {
  const { base, close } = await startServer(ticketingRepo());
  try {
    const res = await put(base, {
      provider: 'openai-compatible',
      baseUrl: LOCAL_BASE,
      model: 'granite4-hermes:latest',
      params: { temperature: 0, timeoutMs: 120_000 },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { params?: Record<string, number> };
    assert.deepEqual(body.params, { temperature: 0, timeoutMs: 120_000 });
  } finally {
    await close();
  }
});

test('an out-of-range knob is refused with the field and its range', async () => {
  const { base, close } = await startServer(ticketingRepo());
  try {
    const res = await put(base, {
      provider: 'openai-compatible',
      baseUrl: LOCAL_BASE,
      model: 'm',
      params: { temperature: 9 },
    });
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.equal(body.error, 'params.temperature must be between 0 and 2');
  } finally {
    await close();
  }
});

test('the probe reports a dead endpoint as a fact, not as a server fault', async () => {
  const { base, close } = await startServer(ticketingRepo());
  try {
    /* Port 9 (discard) is closed on the loopback interface — a keyless local
       config pointing at nothing, which is exactly the misconfiguration whose
       first evidence used to be a failed chat turn. */
    await put(base, { provider: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', model: 'ghost' });
    const res = await fetch(`${base}/api/ai-config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });
    /* 200 with ok:false — a model that refused is a fact about the
       CONFIGURATION, and a 502 here would read as "Sequence is broken". */
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; model: string; error?: string; ms: number };
    assert.equal(body.ok, false);
    assert.equal(body.model, 'ghost');
    assert.ok(typeof body.error === 'string' && body.error.length > 0, 'the provider gets the last word');
    assert.ok(typeof body.ms === 'number');
  } finally {
    await close();
  }
});

test('the probe refuses a shape it does not understand rather than guessing', async () => {
  const { base, close } = await startServer(ticketingRepo());
  try {
    await put(base, { provider: 'openai-compatible', baseUrl: LOCAL_BASE, model: 'm' });
    const res = await fetch(`${base}/api/ai-config`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ probe: 'yes' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('a MASKED key sent back is treated as unchanged, never stored', async () => {
  /*
   * THE HOLE THE TEST ABOVE DOES NOT REACH. "THE MASK NEVER BECOMES THE KEY"
   * sends the profile with `apiKey` OMITTED, which is only one of the two shapes
   * the Settings panel produces. GET returns every key MASKED, so the panel holds
   * "••••9f3a" — and a round-trip that edits a name sends that mask straight back.
   *
   * A mask is a non-empty string, so the merge's "did the client send a key?" test
   * answered YES and wrote the redaction over the credential. Renaming a profile
   * destroyed its key and every later request 401'd with no way to see why.
   */
  const { base, repo, close } = await startServer(ticketingRepo());
  try {
    await put(base, TWO_PROFILES);
    const real = JSON.stringify(onDisk(repo));
    assert.ok(real.includes(CLAUDE_KEY), 'the fixture must have stored a real key first');

    // Exactly what the panel holds after a GET: the key, masked.
    const masked = (await (await fetch(`${base}/api/ai-config`)).json()) as {
      profiles: { id: string; name: string; provider: string; model: string; apiKey?: string }[];
    };
    const claude = masked.profiles.find((p) => p.id === 'claude')!;
    assert.ok(claude.apiKey?.startsWith('••••'), `GET must mask the key, got ${claude.apiKey}`);

    // The rename round-trip: send the list straight back, mask included.
    const res = await put(base, {
      profiles: masked.profiles.map((p) =>
        p.id === 'claude' ? { ...p, name: 'Claude, renamed' } : p,
      ),
      defaultProfileId: 'claude',
    });
    assert.equal(res.status, 200);

    const after = JSON.stringify(onDisk(repo));
    assert.ok(!after.includes('••••'), 'a mask must never reach disk');
    assert.ok(after.includes(CLAUDE_KEY), 'the real key must survive a rename');
    assert.ok(after.includes('Claude, renamed'), 'and the rename must actually apply');
  } finally {
    await close();
  }
});
