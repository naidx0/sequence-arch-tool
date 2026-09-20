import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { type ArchGraph } from '@sequence/schema';
import { startMockProvider } from './mock-provider.js';
import { currentMonthYear, type MeterUsage } from '../server/meter.js';
import { usageFileForIdentity } from '../server/store.js';

/**
 * The v12 metering GAP closure. `/api/generate` and `/api/prompt-file` funnel to
 * generateAndApply → generateFiles DIRECTLY, so default-mode (free-tier) FILE
 * generation was previously NOT counted (only ask/explain/design-suggest were).
 * Lock: a default-mode generate now records ONE use for the calling identity;
 * api-key mode stays unmetered.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const TICKETING_SPEC = path.join(REPO_ROOT, 'examples', 'ticketing.spec.json');

const TEST_KEY = 'sk-ant-test-SECRET-abc123';

/** A near-empty generate target: only the compose manifest the scanner needs to boot. */
function seedRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-metergap-'));
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  fs.copyFileSync(path.join(TICKETING, 'docker-compose.yml'), path.join(repo, 'docker-compose.yml'));
  return repo;
}

function collectScaffoldFiles(root: string): { path: string; content: string }[] {
  const reserved = new Set(['.sequence', '.git', '.ssh', '.aws', '.gnupg', 'node_modules']);
  const out: { path: string; content: string }[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      if (dir === root && reserved.has(name)) continue;
      const abs = path.join(dir, name);
      if (fs.statSync(abs).isDirectory()) walk(abs);
      else out.push({ path: path.relative(root, abs), content: fs.readFileSync(abs, 'utf8') });
    }
  };
  walk(root);
  return out;
}

const SCAFFOLD_FILES = collectScaffoldFiles(TICKETING);

function tempUserDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-metergap-home-')));
}

function resolveIdentity(req: http.IncomingMessage): string | undefined {
  const h = req.headers['x-test-identity'];
  return typeof h === 'string' && h.trim() !== '' ? h : undefined;
}

async function startServer(
  repoRoot: string,
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

async function usageFor(base: string, identity: string): Promise<number> {
  const view = (await (await fetch(`${base}/api/usage`, { headers: { 'x-test-identity': identity } })).json()) as {
    usedThisMonth: number;
  };
  return view.usedThisMonth;
}

test('default-mode /api/generate now RECORDS one use for the calling identity (gap closed)', async () => {
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  const gateway = await startMockProvider(() => ({ text: JSON.stringify({ files: SCAFFOLD_FILES, notes: 'ok' }) }), 'openai');
  const repo = seedRepo();
  const userDir = tempUserDir();
  const { base, close } = await startServer(repo, userDir, gateway.baseUrl);
  try {
    // Select the FREE metered default.
    assert.strictEqual(
      (await fetch(`${base}/api/ai-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'default' }),
      })).status,
      200
    );

    assert.strictEqual(await usageFor(base, 'carol'), 0, 'carol starts fresh');

    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-identity': 'carol' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(gateway.requests.length, 1, 'the gateway was contacted once');

    // The gap is closed: carol's generate was counted.
    assert.strictEqual(await usageFor(base, 'carol'), 1, 'default-mode generate charged one call');
    const onDisk = JSON.parse(fs.readFileSync(path.join(userDir, usageFileForIdentity('carol')), 'utf8')) as MeterUsage;
    assert.strictEqual(onDisk.usedThisMonth, 1);
    assert.strictEqual(onDisk.monthYear, currentMonthYear());

    // A different identity is untouched (per-user isolation preserved through the gap fix).
    assert.strictEqual(await usageFor(base, 'dave'), 0, 'dave was not charged by carol');
  } finally {
    await close();
    await gateway.close();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});

test('api-key mode /api/generate stays UNMETERED (no use recorded)', async () => {
  const spec = JSON.parse(fs.readFileSync(TICKETING_SPEC, 'utf8')) as ArchGraph;
  // api-key mode speaks the anthropic wire in the mock.
  const provider = await startMockProvider(() => ({ text: JSON.stringify({ files: SCAFFOLD_FILES, notes: 'ok' }) }), 'anthropic');
  const repo = seedRepo();
  const userDir = tempUserDir();
  const { base, close } = await startServer(repo, userDir);
  try {
    assert.strictEqual(
      (await fetch(`${base}/api/ai-config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', baseUrl: provider.baseUrl, model: 'claude-test', apiKey: TEST_KEY }),
      })).status,
      200
    );

    const res = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-identity': 'erin' },
      body: JSON.stringify({ specOverride: spec }),
    });
    assert.strictEqual(res.status, 200);

    // api-key mode is never metered.
    assert.strictEqual(await usageFor(base, 'erin'), 0, 'api-key generate is not charged');
  } finally {
    await close();
    await provider.close();
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    fs.rmSync(userDir, { recursive: true, force: true });
  }
});
