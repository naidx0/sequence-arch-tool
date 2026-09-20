#!/usr/bin/env node
/**
 * C2.5 — Browser pane locking e2e: pill + fetch under policy.
 *
 * Boots the real analyzer with web2 dist. Skip cleanly (exit 0) when Chromium
 * is missing — same contract as terminal-pane.mjs.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findChromium, launchOptions, loadPlaywright, cacheRoots } from './lib/chromium.mjs';
import { buildProblem, WEB2 } from './lib/serve.mjs';
import { is, sel, settle } from './lib/harness.mjs';

const REPO_ROOT = path.resolve(WEB2, '..', '..');
const ANALYZER_CLI = path.join(REPO_ROOT, 'packages', 'analyzer', 'dist', 'cli.js');

const NAME = 'browser-pane';
const log = (...args) => console.log(`[${NAME}]`, ...args);

function failHarness(msg) {
  console.error(`[${NAME}] ERROR: ${msg}`);
  process.exit(2);
}

async function waitHttp(url, ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on('error', reject);
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error('timeout'));
        });
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`server did not become ready at ${url}`);
}

async function main() {
  const problem = buildProblem();
  if (problem) failHarness(`${problem} — run: pnpm --filter @sequence/web2 build`);
  if (!fs.existsSync(ANALYZER_CLI)) {
    failHarness('analyzer not built — run: pnpm --filter @sequence/analyzer build');
  }

  const executablePath = findChromium();
  if (!executablePath) {
    log('SKIP: no Chromium found. Searched:', cacheRoots().join(', '));
    process.exit(0);
  }
  const chromium = await loadPlaywright();
  if (!chromium) {
    log('SKIP: playwright-core is not installed');
    process.exit(0);
  }

  const port = 4178;
  const child = spawn(
    process.execPath,
    [ANALYZER_CLI, 'app', '--no-open', '--port', String(port)],
    {
      cwd: REPO_ROOT,
      env: { ...process.env, SEQUENCE_BIND_HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.on('data', (b) => {
    stderr += b.toString('utf8');
  });
  child.stdout.on('data', () => {});

  const base = `http://127.0.0.1:${port}`;
  const failures = [];
  let passes = 0;
  const check = async (label, fn) => {
    try {
      await fn();
      passes += 1;
      log('ok  ', label);
    } catch (e) {
      failures.push(`${label}: ${e.message}`);
      log('FAIL', label, '—', e.message);
    }
  };

  const browser = await chromium.launch(launchOptions(executablePath));
  try {
    await waitHttp(base);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page);

    await check('Browser workspace pill is present', async () => {
      is(await page.locator(sel('workspace-tab-browser')).count(), 1, 'browser pill');
    });

    await check('composer Browser is enabled (C2.5)', async () => {
      const disabled = await page.locator(sel('composer-browser')).getAttribute('disabled');
      if (disabled !== null) throw new Error('composer-browser must be enabled after C2.5');
    });

    await page.locator(sel('workspace-tab-browser')).click();
    await settle(page);

    await check('Browser pane mounts', async () => {
      is(await page.locator(sel('browser-pane')).count(), 1, 'browser-pane');
    });

    await check('fetch returns measured HTTP 200 body for example.com', async () => {
      await page.locator(sel('browser-pane-url')).fill('https://example.com');
      await page.locator(sel('browser-pane-fetch')).click();
      await page.waitForFunction(
        () => {
          const status = document.querySelector('[data-testid="browser-pane-status"]');
          const body = document.querySelector('[data-testid="browser-pane-body"]');
          const s = status?.textContent || '';
          const b = body?.textContent || '';
          return /HTTP 200/i.test(s) && /Example Domain/i.test(b);
        },
        { timeout: 30000 },
      );
    });
  } finally {
    await browser.close();
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    try {
      child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }

  if (failures.length) {
    console.error(`\n[${NAME}] ${failures.length} FAILED, ${passes} passed`);
    for (const f of failures) console.error(`  - ${f}`);
    if (stderr.trim()) console.error(`[${NAME}] server stderr:\n${stderr.slice(-2000)}`);
    process.exit(1);
  }

  log(`${passes} checks passed`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`[${NAME}] HARNESS ERROR:`, e.stack ?? e.message);
  process.exit(2);
});
