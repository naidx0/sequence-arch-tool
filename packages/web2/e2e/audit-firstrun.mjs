#!/usr/bin/env node
/**
 * THE FIRST-RUN PAGE (ask 32): the screen an unattached install lands on, with
 * agents and recent projects filled in, dark and light at 1440x900.
 *
 *   SHOT_DIR=/path node e2e/audit-firstrun.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

import { sel, suite } from './lib/harness.mjs';

const SHOT_DIR = process.env.SHOT_DIR || '/tmp/claude-0/sc';

const routes = {
  '/api/status': { attached: false },
  '/api/recent': { recent: [] },
  '/api/onboarding/providers': { providers: [
    { id: 'claude', label: 'Claude Code', installed: true, version: '2.1.4', state: 'ready', signInCommand: 'claude auth login', installHint: 'npm i -g @anthropic-ai/claude-code', plan: 'Max' },
    { id: 'codex', label: 'Codex', installed: true, version: '0.9.1', state: 'signIn', signInCommand: 'codex login', installHint: 'npm i -g @openai/codex' },
    { id: 'other', label: 'Local model', installed: false, version: null, state: 'install', signInCommand: '', installHint: 'ollama pull qwen3' },
  ] },
  '/api/onboarding/repos': {
    repos: [
      { path: 'C:/work/gateway', name: 'gateway', lastActive: Date.now() - 3600_000, recent: true },
      { path: 'C:/work/orders-service', name: 'orders-service', lastActive: Date.now() - 86400_000 * 2, recent: true },
      { path: 'C:/work/design-system', name: 'design-system', lastActive: null, recent: false },
    ],
    truncated: false,
  },
  '/api/onboarding/setup': { mcpServers: [{ name: 'github', source: 'claude' }], skills: [{ name: 'review', source: 'claude' }] },
};

await suite('audit-firstrun', async ({ page, base, check }) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  for (const theme of ['dark', 'light']) {
    await check(`${theme}: first run`, async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base);
      await page.evaluate((t) => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('seq.theme', t);
      }, theme);
      await page.reload();
      await page.waitForSelector('.fr-root', { timeout: 15000 });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(SHOT_DIR, `audit-firstrun-${theme}.png`) });
    });
  }
  void sel;
}, { routes });
