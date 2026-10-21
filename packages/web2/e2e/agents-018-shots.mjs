#!/usr/bin/env node
/**
 * 0.1.8 agents pass: Agents surface (many prompts, Tree and Timeline), the status bar (idle, working, waiting with a long name),
 * and Settings > Skills (row at rest and hovered). `node e2e/agents-018-shots.mjs <before|after> [outDir]`.
 */
import fs from 'node:fs';
import { sel, settle, suite } from './lib/harness.mjs';

const phase = process.argv[2] ?? 'after';
const OUT = process.argv[3] ?? 'tmp-shots/agents-018';
fs.mkdirSync(OUT, { recursive: true });

const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [{ id: 'h1', title: 'Fix the failing gateway tests', createdAt: '2026-10-06T05:00:00Z', updatedAt: '2026-10-06T05:00:00Z' }] },
  scope: 'workspace',
  repos: [],
};
const T0 = Date.now() - 3_600_000;
const mk = (id, prompt, i, over = {}) => ({ id, sessionId: 'h1', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt, status: 'done', startedAt: T0 + i * 120_000, endedAt: T0 + i * 120_000 + 60_000, items: [], approvals: [], error: null, ...over });
const PROMPTS = Array.from({ length: 12 }, (_, i) => `Prompt ${i + 1}: why does the gateway rate limiter return 200 instead of 429 for case ${i + 1}?`);
const runsFor = (extra) => ({ runs: [...PROMPTS.map((p, i) => mk(`t${i + 1}`, p, i)), ...extra] });
const SKILLS = {
  dir: '.sequence/skills',
  skills: [
    { slug: 'gate-first', name: 'Gate first', description: 'Run the full gate before pushing anything, read the bare exit code, and keep the whole log in a file instead of piping it through tail so the failure list is never lost.' },
    { slug: 'ship-notes', name: 'Ship notes', description: 'Write the release notes from the merged pull requests.' },
    { slug: 'ui-looks', name: 'UI looks', description: 'Open the built frontend and take a screenshot before calling a UI change done.' },
  ],
  warnings: [],
  trusted: true,
  instructions: { file: 'AGENTS.md', bytes: 4200, truncated: false },
};

async function boot(page, base, runs) {
  await page.route('**/api/sessions*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSIONS) }));
  await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runs) }));
  await page.route('**/api/skills', (r) => (r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SKILLS) }) : r.fallback()));
  await page.route('**/api/agent-events', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: '' }));
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);
}

await suite('agents-018-shots', async ({ page, base, log }) => {
  const shot = async (name, loc) => {
    const p = `${OUT}/${name}-${phase}.png`;
    if (loc) await loc.screenshot({ path: p });
    else await page.screenshot({ path: p });
    log(p);
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  const status = () => page.locator(sel('s2-status'));

  // idle
  await boot(page, base, runsFor([]));
  await shot('03-statusbar-idle', status());
  // the Agents surface with 12 prompts
  await page.locator(sel('s2-tab-agents')).first().click();
  await page.locator(sel('agents-surface-chat')).first().waitFor({ timeout: 15000 });
  await settle(page);
  await shot('01-agents-prompts');
  const tl = page.locator(sel('agents-surface-tab-timeline'));
  if (await tl.count()) {
    await tl.click();
    await settle(page);
    await shot('02-agents-timeline');
  } else log('no timeline tab');

  // working, with a waiting approval and long label
  const waiting = mk('w1', 'Fix it', 13, { status: 'running', endedAt: null, approvals: [{ id: 'ap1', toolCallId: 'tc', title: 'Edit gateway/src/very/long/path/to/some/deeply_nested_rate_limiter_configuration_file.ts', kind: 'edit', options: [], decision: null }] });
  const working = mk('w2', 'Fix it', 13, { status: 'running', endedAt: null });
  for (const [name, run] of [['working', working], ['waiting', waiting]]) {
    await page.unroute('**/api/acp/runs*');
    await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runsFor([run])) }));
    await page.goto(base);
    await page.waitForSelector(sel('shell'));
    await settle(page);
    await shot(`03-statusbar-${name}`, status());
    if (name === 'waiting') {
      await page.setViewportSize({ width: 760, height: 800 });
      await settle(page);
      await shot('03-statusbar-waiting-narrow', status());
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  }

  // skills
  await page.unroute('**/api/acp/runs*');
  await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runsFor([])) }));
  await page.goto(base);
  await page.waitForSelector(sel('shell'));
  await settle(page);
  await page.locator(`${sel('v3-rail-settings')}, ${sel('s2-iconrail-settings')}`).first().click();
  await page.locator(sel('settings-nav-skills')).click();
  await page.locator(sel('settings-skill-row')).first().waitFor({ timeout: 15000 });
  await settle(page);
  await shot('04-skills-rest');
  await page.locator(sel('settings-skill-row')).first().hover();
  await page.waitForTimeout(300);
  await shot('04-skills-hover');
});
