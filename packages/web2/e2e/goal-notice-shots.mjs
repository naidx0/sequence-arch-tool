#!/usr/bin/env node
/**
 * The goal bar after a start that carries `worktree` (the run works in its own branch) and one that carries `warning`
 * (it may overlap another run). The server is a fake route table: no real CLI, no agent. Shots go to $SHOTS.
 */
import fs from 'node:fs';
import { sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? 'tmp-shots/019-goalwt';
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'Fix the parser', titleEdited: false, createdAt: at(5), updatedAt: at(5) }] },
  scope: 'workspace',
  repos: [],
};
const SESSION = {
  chat: { version: 1, sessionId: 'c1', turns: [] },
  meta: {},
  goal: 'Fix the parser so nested blocks survive a round trip',
  plan: [
    { id: 's1', text: 'Read src/parser.ts', status: 'done' },
    { id: 's2', text: 'Add the guard in src/parser.ts', status: 'open' },
  ],
};
const IDLE = { running: false, turns: 0, cap: 24 };
const WARNING = 'Another run is already working in this project and this one could not get its own worktree (This folder is not a git repository, so a chat cannot have its own worktree.) Both write to the same files and may overlap.';

/* One variant per run: the harness exits when a suite ends. VARIANT=worktree|warning. */
for (const [name, extra] of [
  ['worktree', { worktree: { path: '/tmp/wt/ab12cd34', branch: 'sequence/goal-fix-the-parser-ab12' } }],
  ['warning', { warning: WARNING }],
].filter(([n]) => n === (process.env.VARIANT ?? 'worktree'))) {
  await suite(
    `goal-notice-${name}`,
    async ({ page, base, check }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base);
      await page.evaluate(() => {
        try {
          localStorage.setItem('sequence.autonomy.autoEdit', 'on');
          localStorage.setItem('v3.composer.mode', 'build');
        } catch {}
        document.documentElement.setAttribute('data-theme', 'dark');
      });
      await page.goto(base);
      await page.waitForSelector(sel('v3-goalbar'), { timeout: 15000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/goal-before-${name}.png` });
      const work = page.locator(sel('v3-goalbar-work'));
      await work.click();
      await page.waitForSelector(sel('v3-goal-notice'), { timeout: 10000 });
      await page.waitForTimeout(300);
      await check(`${name}: the notice is shown`, async () => {
        const t = await page.locator(sel('v3-goal-notice')).innerText();
        if (name === 'worktree' && !/own branch sequence\/goal-fix-the-parser-ab12, listed under Worktrees/.test(t)) throw new Error(t);
        if (name === 'warning' && !/may overlap/.test(t)) throw new Error(t);
      });
      await page.screenshot({ path: `${OUT}/goal-notice-${name}.png` });
    },
    {
      routes: {
        '/api/sessions': SESSIONS,
        '/api/sessions/c1': SESSION,
        '/api/sessions/c1/goal-run': { ...IDLE, ok: true, state: { ...IDLE, running: true }, ...extra },
      },
    },
  );
}
