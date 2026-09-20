import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { startMockProvider } from './mock-provider.js';
import { currentMonthYear, DEFAULT_METER_POLICY, type MeterUsage } from '../server/meter.js';
import { usageFileForIdentity } from '../server/store.js';

/**
 * Per-IDENTITY metering seam (v10 Phase 4). The whole point: meter.ts stays
 * identity-agnostic while usage is keyed per user behind the UsageStore, so a
 * deployed free-plan can rate-limit per person without a rewrite. Here two
 * identities are simulated by an injected `resolveIdentity` that reads a test
 * header (the auth-middleware slot); a deployed build validates a real session
 * instead. Locks: GET /api/usage AND the metered path see SEPARATE usage per
 * identity — one identity can neither READ nor CHARGE another's counter.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function plainappRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-idmeter-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  return repo;
}

function tempUserDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-idmeter-home-')));
}

/** The injected auth-middleware slot: identity from a test header (deploy uses a real session). */
function resolveIdentity(req: http.IncomingMessage): string | undefined {
  const h = req.headers['x-test-identity'];
  return typeof h === 'string' && h.trim() !== '' ? h : undefined;
}

async function startServer(
  repoRoot: string | null,
  userConfigDir: string,
  gatewayBaseUrl?: string
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, {
    webDist: undefined,
    userConfigDir,
    gatewayBaseUrl,
    resolveIdentity,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

type UsageView = { usedThisMonth: number; allotment: number; softCapped: boolean };

async function getUsageAs(base: string, identity?: string): Promise<UsageView> {
  const headers: Record<string, string> = {};
  if (identity) headers['x-test-identity'] = identity;
  return (await (await fetch(`${base}/api/usage`, { headers })).json()) as UsageView;
}

async function askAs(base: string, identity: string): Promise<Response> {
  return fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-identity': identity },
    body: JSON.stringify({ question: 'What does this app do?' }),
  });
}

test('GET /api/usage keys per identity: a soft-capped user and a fresh user report SEPARATE usage', async () => {
  const userDir = tempUserDir();
  // Seed ONLY alice at her soft cap (her per-identity usage file); bob + local
  // have no file. The filename is derived via usageFileForIdentity so the test
  // tracks the real (now hash-suffixed, collision-resistant) mapping.
  const seeded: MeterUsage = {
    usedThisMonth: DEFAULT_METER_POLICY.monthlyAllotment,
    monthYear: currentMonthYear(),
    globalSpendToDate: 0.01,
  };
  fs.writeFileSync(path.join(userDir, usageFileForIdentity('alice')), JSON.stringify(seeded));

  const { base, close } = await startServer(null, userDir);
  try {
    const alice = await getUsageAs(base, 'alice');
    assert.strictEqual(alice.usedThisMonth, DEFAULT_METER_POLICY.monthlyAllotment);
    assert.strictEqual(alice.softCapped, true, 'alice is soft-capped');

    const bob = await getUsageAs(base, 'bob');
    assert.strictEqual(bob.usedThisMonth, 0, 'bob starts fresh — he cannot see alice usage');
    assert.strictEqual(bob.softCapped, false);

    // No header ⇒ the single-user local identity (its own usage.json), also fresh.
    const local = await getUsageAs(base);
    assert.strictEqual(local.usedThisMonth, 0);
  } finally {
    await close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('the metered path charges ONLY the calling identity: bob asks; alice is never touched', async () => {
  const repo = plainappRepo();
  const userDir = tempUserDir();
  // alice is pre-seeded at the soft cap; bob is fresh.
  const aliceSeed: MeterUsage = {
    usedThisMonth: DEFAULT_METER_POLICY.monthlyAllotment,
    monthYear: currentMonthYear(),
    globalSpendToDate: 0.01,
  };
  fs.writeFileSync(path.join(userDir, usageFileForIdentity('alice')), JSON.stringify(aliceSeed));

  const gateway = await startMockProvider(() => ({ text: 'A frontend and a backend.' }), 'openai');
  const { base, close } = await startServer(repo, userDir, gateway.baseUrl);
  try {
    // Select the FREE metered default (per-repo ai.json, repo attached).
    const put = await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'default' }),
    });
    assert.strictEqual(put.status, 200);

    // Bob makes one metered call.
    const res = await askAs(base, 'bob');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(gateway.requests.length, 1, 'the gateway was contacted once');

    // Bob's usage advanced to 1; alice is UNCHANGED (still at her soft cap).
    const bob = await getUsageAs(base, 'bob');
    assert.strictEqual(bob.usedThisMonth, 1, 'bob was charged exactly one call');
    const alice = await getUsageAs(base, 'alice');
    assert.strictEqual(
      alice.usedThisMonth,
      DEFAULT_METER_POLICY.monthlyAllotment,
      'alice was NOT charged by bob'
    );

    // On disk: separate files; alice's seed untouched.
    const bobOnDisk = JSON.parse(fs.readFileSync(path.join(userDir, usageFileForIdentity('bob')), 'utf8')) as MeterUsage;
    assert.strictEqual(bobOnDisk.usedThisMonth, 1);
    const aliceOnDisk = JSON.parse(fs.readFileSync(path.join(userDir, usageFileForIdentity('alice')), 'utf8')) as MeterUsage;
    assert.strictEqual(aliceOnDisk.usedThisMonth, DEFAULT_METER_POLICY.monthlyAllotment, 'alice.json untouched');
  } finally {
    await close();
    await gateway.close();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});
