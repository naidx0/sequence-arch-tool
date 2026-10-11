#!/usr/bin/env node
/**
 * 0.1.5 G1: the owner's state. Codex is registered (Settings says Connected) and signed in, and its
 * model list cannot be read. Before the fix the picker had no Codex anywhere. Here: the picker shows
 * Codex under OpenAI on its default model with the reason and one Retry; one click puts the chat on
 * Codex and a message starts a Codex run (POST /api/acp/run-node with agentRef codex); Retry, once
 * the agent answers, lists its models. Also the open/close motion: a frame mid-rise, and the menu
 * gone after close. Every API is faked; no agent runs. Shots go to $SHOTS.
 */
import fs from 'node:fs';
import { is, sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/0.1.5/g1';
fs.mkdirSync(OUT, { recursive: true });

const at = (h) => new Date(Date.UTC(2026, 9, 10, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'Rate limiter returns 200 under load', titleEdited: false, createdAt: at(5), updatedAt: at(6) }] },
  scope: 'workspace',
  repos: [],
};
const CODEX = { id: 'codex', label: 'Codex', installed: true, version: '0.153.4', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: 'npm i -g @openai/codex' };
const MODELS = [
  { id: 'gpt-6-astra', name: 'GPT-6-Astra', description: 'Most capable', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', isDefault: true },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', description: 'Frontier agentic coding', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' },
];

await suite(
  'g1-codex-picker-shots',
  async ({ page, base, check }) => {
    let capsOk = false;
    const runs = [];
    await page.route('**/api/acp/agents', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'codex', label: 'Codex' }] }) }));
    await page.route('**/api/onboarding/providers*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers: [CODEX] }) }));
    await page.route('**/api/acp/capabilities*', (r) =>
      capsOk
        ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agentRef: 'codex', models: MODELS, efforts: [], commands: [], skills: [] }) })
        : r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'the agent could not say what it offers: codex app-server exited (code=1)' }) }),
    );
    await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [] }) }));
    /* The run never answers: it is enough that it was asked for, for Codex. */
    await page.route('**/api/acp/run-node*', (r) => {
      runs.push(r.request().postDataJSON?.() ?? null);
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const theme of ['dark', 'light']) {
      capsOk = false;
      await page.goto(base);
      await page.evaluate(() => {
        try {
          localStorage.clear();
        } catch {}
      });
      await page.reload();
      await page.evaluate((t) => {
        try {
          localStorage.setItem('seq.theme', t);
        } catch {}
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await page.waitForSelector(sel('shell'));
      const chip = page.locator(sel('v3-model-trigger')).first();
      await chip.waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(400);
      const composer = page.locator('.s2-comp').first();
      await page.screenshot({ path: `${OUT}/closed-${theme}.png` });

      /* A frame mid-rise: animations slowed twentyfold (CDP) so the shot lands inside the 240 ms rise. */
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Animation.enable');
      await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.05 });
      await chip.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${OUT}/opening-frame-${theme}.png` });
      await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
      const menu = page.locator(sel('s2-model-menu'));
      await menu.waitFor();
      await page.locator(sel('agent-default-model')).waitFor({ timeout: 10000 });
      await page.locator(sel('s2-model-caps-error')).waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/open-unreadable-${theme}.png` });
      await check(`${theme}: a connected Codex with an unreadable list is offered, with the reason and one Retry`, async () => {
        const row = page.locator(sel('agent-default-model'));
        is(await row.getAttribute('data-agent'), 'codex', 'the row is Codex');
        is(await page.locator(`${sel('s2-model-group-openai')} ${sel('agent-default-model')}`).count(), 1, 'under OpenAI');
        is(await page.locator(sel('s2-model-caps-retry')).count(), 1, 'one Retry');
        is(await page.locator(sel('s2-connect-codex')).count(), 0, 'not offered twice');
        const anim = await menu.evaluate((n) => getComputedStyle(n).animationName);
        is(anim, 's2-rise', 'the popup rises in');
      });
      await check(`${theme}: the Retry and the error line up with the rows' names`, async () => {
        const name = await page.locator(`${sel('agent-default-model')} .s2-mi-name`).boundingBox();
        const say = await page.locator(`${sel('s2-model-caps-error')} .failure-note-say, ${sel('s2-model-caps-error')} .s2-caps-err-text`).first().boundingBox();
        const retry = await page.locator(sel('s2-model-caps-retry')).boundingBox();
        if (Math.abs(say.x - name.x) > 1.5) throw new Error(`error text at ${say.x}, names at ${name.x}`);
        if (Math.abs(retry.x - name.x) > 1.5) throw new Error(`Retry at ${retry.x}, names at ${name.x}`);
      });

      /* One click: the chat is on Codex, the menu closes (sinking away), a message starts a Codex run. */
      await check(`${theme}: the rise is the 240 ms token, and closing plays a 170 ms sink, then the menu is gone`, async () => {
        is(await menu.evaluate((n) => `${getComputedStyle(n).animationName}|${getComputedStyle(n).animationDuration}`), 's2-rise|0.24s', 'rises with --dur-3');
        await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.05 });
        const seen = await page.evaluate(async () => {
          document.querySelector('[data-testid="agent-default-model"]').click();
          await new Promise((r) => requestAnimationFrame(() => r()));
          const c = document.querySelector('[data-testid="s2-model-menu-closing"]');
          return c ? `${getComputedStyle(c).animationName}|${getComputedStyle(c).animationDuration}|${c.getAttribute('aria-hidden')}|${c.getAttribute('role')}` : 'none';
        });
        is(seen, 's2-sink|0.17s|true|null', 'the closing menu sinks, hidden and not a menu');
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${OUT}/closing-frame-${theme}.png` });
        await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
        await page.locator(sel('s2-model-menu-closing')).waitFor({ state: 'detached', timeout: 4000 });
        is(await page.locator(sel('s2-model-menu')).count(), 0, 'closed');
      });
      await page.waitForTimeout(300);
      await composer.screenshot({ path: `${OUT}/chip-on-codex-${theme}.png` });
      await check(`${theme}: the chip names Codex's default and a message starts a Codex run`, async () => {
        is((await chip.locator('.s2-pill-l').textContent()).trim(), 'Default model', 'the chip');
        is(await chip.getAttribute('data-action'), 'agent', 'the chat is on an agent');
        const box = page.locator(sel('composer-field')).first();
        await box.click();
        await box.fill('Why does the limiter return 200?');
        const before = runs.length;
        await box.press('Enter');
        for (let i = 0; i < 40 && runs.length === before; i++) await page.waitForTimeout(100);
        if (runs.length !== before + 1) throw new Error(`run-node asked ${runs.length - before} times`);
        is(runs[runs.length - 1]?.agentRef, 'codex', 'the run is for Codex');
      });

      /* Retry once the agent answers: its models are listed. */
      capsOk = true;
      await chip.click();
      await page.locator(sel('s2-model-caps-retry')).click();
      await page.locator(sel('agent-model')).first().waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/open-models-${theme}.png` });
      await check(`${theme}: after Retry the models are listed and the error is gone`, async () => {
        is(await page.locator(sel('agent-model')).count(), 2, 'two models');
        is(await page.locator(sel('s2-model-caps-error')).count(), 0, 'no error');
      });
      await page.locator(`${sel('agent-model')}[data-model="gpt-5.6-sol"]`).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/open-picked-${theme}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/hooks': { declared: {}, trusted: false } } },
);
