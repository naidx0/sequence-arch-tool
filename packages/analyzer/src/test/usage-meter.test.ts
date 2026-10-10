import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';
import { startMockProvider } from './mock-provider.js';
import { currentMonthYear, DEFAULT_METER_POLICY, type MeterUsage } from '../server/meter.js';

/**
 * e2e lock for the FREE metered default (v9 Phase 2) wired into the server:
 *   - PUT {mode:'default'} → the redacted default config (NO key).
 *   - a default-mode /api/ask meters through a MOCK gateway (real HTTP), carries
 *     NO user secret, increments usage, and GET /api/usage reports it.
 *   - a soft-capped user is STILL served (a nudge, not a wall).
 *   - the global spend backstop HARD-blocks (502) without contacting the gateway.
 *
 * The gateway is injected via `gatewayBaseUrl` (the test/deploy seam) so the real
 * funded gateway — the one unverified seam — is never contacted.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-usage-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

function tempUserDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-usage-home-')));
}

async function startServer(
  repoRoot: string | null,
  userConfigDir: string,
  gatewayBaseUrl?: string
): Promise<{ base: string; close: () => Promise<void> }> {
  /* PER-REPO AI CONFIG IS A TRUSTED-REPO FEATURE, so this fixture consents.
     A repo's own `.sequence/ai.json` is ignored while untrusted — it can point
     `baseUrl` at an attacker's host and take every question and file excerpt
     with it — and the user's settings go to the user store instead. The
     assertions below are about key masking, redaction and per-repo precedence,
     not about trust, so the fixture says yes the way a reader would.
     `isRepoTrusted`'s OWN default store, never `userConfigDir`: the boundary has
     one store and `isolate-user-store.js` has already isolated it. */
  if (repoRoot !== null) setRepoTrust(userStoreDir(), repoRoot, true);
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir, gatewayBaseUrl });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function putDefault(base: string): Promise<Response> {
  return fetch(`${base}/api/ai-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'default' }),
  });
}

async function ask(base: string): Promise<Response> {
  return fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'What does this app do?' }),
  });
}

async function getUsage(base: string): Promise<{ usedThisMonth: number; allotment: number; softCapped: boolean }> {
  return (await (await fetch(`${base}/api/usage`)).json()) as { usedThisMonth: number; allotment: number; softCapped: boolean };
}

test('PUT {mode:"default"} → redacted default config, NO key; on-disk ai.json holds no secret', async () => {
  const repo = plainappRepo();
  const userDir = tempUserDir();
  const { base, close } = await startServer(repo, userDir);
  try {
    const res = await putDefault(base);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.strictEqual(body.configured, true);
    assert.strictEqual(body.mode, 'default');
    assert.ok(!('apiKey' in body), 'the default config redaction has no key field');
    // Per-repo ai.json exists and holds no key material.
    const onDisk = fs.readFileSync(path.join(repo, '.sequence', 'ai.json'), 'utf8');
    assert.ok(!onDisk.includes('sk-'));
    assert.ok(onDisk.includes('default'));
  } finally {
    await close();
  }
});

test('GET /api/usage: contract is {usedThisMonth, allotment, softCapped}; starts at zero', async () => {
  const userDir = tempUserDir();
  const { base, close } = await startServer(null, userDir);
  try {
    const u = await getUsage(base);
    assert.strictEqual(u.usedThisMonth, 0);
    assert.strictEqual(u.allotment, DEFAULT_METER_POLICY.monthlyAllotment);
    assert.strictEqual(u.softCapped, false);
  } finally {
    await close();
  }
});

test('default-mode /api/ask meters through the mock gateway: increments usage, NO user secret on the wire', async () => {
  const repo = plainappRepo();
  const userDir = tempUserDir();
  const gateway = await startMockProvider(() => ({ text: 'A frontend and a backend that stores notes.' }), 'openai');
  const { base, close } = await startServer(repo, userDir, gateway.baseUrl);
  try {
    assert.strictEqual((await putDefault(base)).status, 200);

    const res = await ask(base);
    assert.strictEqual(res.status, 200);
    const body = (await res.json()) as { text: string };
    assert.strictEqual(body.text, 'A frontend and a backend that stores notes.');

    // The gateway saw the call over real HTTP, with NO api-key header of any kind.
    assert.strictEqual(gateway.requests.length, 1);
    assert.ok(!('x-api-key' in gateway.requests[0].headers));
    assert.ok(!('authorization' in gateway.requests[0].headers), 'no app token set ⇒ no auth header, and never a user key');

    // Usage advanced by exactly one, and is reported by GET /api/usage.
    const u = await getUsage(base);
    assert.strictEqual(u.usedThisMonth, 1);
    assert.strictEqual(u.softCapped, false);
  } finally {
    await close();
    await gateway.close();
  }
});

test('a SOFT-CAPPED user is STILL served (a nudge, not a wall); usage keeps climbing', async () => {
  const repo = plainappRepo();
  const userDir = tempUserDir();
  // Seed usage AT the monthly allotment (soft cap) but well under the spend backstop.
  const seeded: MeterUsage = {
    usedThisMonth: DEFAULT_METER_POLICY.monthlyAllotment,
    monthYear: currentMonthYear(),
    globalSpendToDate: 0.01,
  };
  fs.writeFileSync(path.join(userDir, 'usage.json'), JSON.stringify(seeded));

  const gateway = await startMockProvider(() => ({ text: 'still answering past the soft cap' }), 'openai');
  const { base, close } = await startServer(repo, userDir, gateway.baseUrl);
  try {
    await putDefault(base);
    const before = await getUsage(base);
    assert.strictEqual(before.softCapped, true, 'reported as soft-capped');

    const res = await ask(base);
    assert.strictEqual(res.status, 200, 'the soft cap must NOT hard-block the request');
    assert.strictEqual(gateway.requests.length, 1, 'the gateway was still contacted');

    const after = await getUsage(base);
    assert.strictEqual(after.usedThisMonth, DEFAULT_METER_POLICY.monthlyAllotment + 1);
  } finally {
    await close();
    await gateway.close();
  }
});

test('the global spend BACKSTOP hard-blocks (502) WITHOUT contacting the gateway or charging usage', async () => {
  const repo = plainappRepo();
  const userDir = tempUserDir();
  const seeded: MeterUsage = {
    usedThisMonth: 3,
    monthYear: currentMonthYear(),
    globalSpendToDate: DEFAULT_METER_POLICY.globalSpendBackstop, // at the backstop
  };
  fs.writeFileSync(path.join(userDir, 'usage.json'), JSON.stringify(seeded));

  const gateway = await startMockProvider(() => ({ text: 'should never be called' }), 'openai');
  const { base, close } = await startServer(repo, userDir, gateway.baseUrl);
  try {
    await putDefault(base);
    const res = await ask(base);
    assert.strictEqual(res.status, 502);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /backstop|API key/i);

    assert.strictEqual(gateway.requests.length, 0, 'the funded gateway is never contacted when backstopped');
    const u = await getUsage(base);
    assert.strictEqual(u.usedThisMonth, 3, 'a blocked call does NOT increment usage');
  } finally {
    await close();
    await gateway.close();
  }
});
