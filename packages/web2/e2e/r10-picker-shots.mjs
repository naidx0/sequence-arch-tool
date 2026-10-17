#!/usr/bin/env node
/**
 * Round 10: the composer chip ([mode icon][provider icon] Nickname) and its
 * one popup (Mode, then Local/Claude/OpenAI groups, then Reasoning).
 * Run four ways: default; LONG=1 (a long model id as the active model); DEFAULT=1 (the hosted default
 * model, no saved profiles); EMPTY=1 (nothing connected).
 * Shots go to $SHOTS (default /mnt/project-files/sequence/cloud-pass/shots/r10/picker).
 */
import fs from 'node:fs';
import { is, sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r10/picker';
fs.mkdirSync(OUT, { recursive: true });
const LONG = process.env.LONG === '1';
const HOSTED_DEFAULT = process.env.DEFAULT === '1';
const EMPTY = process.env.EMPTY === '1';

const PROFILES = [
  { id: 'p1', name: 'minicpm5:latest', provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'minicpm5:latest' },
  { id: 'p2', name: 'claude-sonnet-5-5', provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: '••••9f3a', params: { reasoningEffort: 'medium' } },
  { id: 'p3', name: 'gpt-5.1-codex', provider: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.1-codex', apiKey: '••••71bc' },
  { id: 'p4', name: 'qwen2.5-coder:32b-instruct-q4_K_M', provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:32b-instruct-q4_K_M' },
  { id: 'p5', name: 'meta-llama/llama-3.3-70b-instruct', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct', apiKey: '••••c0de' },
  /* LM Studio on loopback with a dummy key: Local, never "Localhost". */
  { id: 'p6', name: 'mistral-small-3.2', provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', model: 'mistral-small-3.2', apiKey: '••••udio' },
];
/* A stateful /api/ai-config: GET answers the configured response (top-level `model` of the active
   profile, as the real server does) and PUT { selectProfileId } switches it and returns the new model. */
let activeId = LONG ? 'p4' : 'p1';
const configBody = () => {
  if (EMPTY) return { configured: false };
  if (HOSTED_DEFAULT) return { configured: true, mode: 'default', model: 'deepseek-v4-flash', gatewayLive: true };
  const act = PROFILES.find((p) => p.id === activeId);
  return { configured: true, provider: act.provider, baseUrl: act.baseUrl, model: act.model, ...(act.apiKey ? { apiKey: act.apiKey } : {}), profiles: PROFILES, defaultProfileId: activeId };
};
const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [{ id: 'h1', title: 'Rate limiting for the gateway', createdAt: at(5), updatedAt: at(5) }] },
  scope: 'workspace',
  repos: [],
};

await suite(
  'r10-picker-shots',
  async ({ page, base, check }) => {
    /* A slow GET (an Ollama probe) answers with the model it had when the request STARTED. */
    let getDelayMs = 0;
    await page.route('**/api/ai-config', async (route) => {
      const req = route.request();
      if (req.method() !== 'PUT' && getDelayMs > 0) {
        const snapshot = JSON.stringify(configBody());
        await new Promise((r) => setTimeout(r, getDelayMs));
        await route.fulfill({ status: 200, contentType: 'application/json', body: snapshot }).catch(() => {});
        return;
      }
      if (req.method() === 'PUT') {
        const { selectProfileId } = JSON.parse(req.postData() ?? '{}');
        if (PROFILES.some((p) => p.id === selectProfileId)) activeId = selectProfileId;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(configBody()) });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const theme of ['dark', 'light']) {
      activeId = LONG ? 'p4' : 'p1';
      await page.goto(base);
      await page.evaluate((t) => {
        try {
          localStorage.setItem('theme', t);
        } catch {}
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await page.waitForSelector(sel('shell'));
      const chip = page.locator(sel('v3-model-trigger')).first();
      await chip.waitFor({ state: 'visible', timeout: 15000 });
      const composer = page.locator('.s2-comp').first();
      const shotChip = async (name) => {
        await page.waitForTimeout(250);
        await composer.screenshot({ path: `${OUT}/${name}-${theme}.png` });
      };
      if (HOSTED_DEFAULT) {
        await check(`the hosted default reads DeepSeek, not Local, in the chip and the bar (${theme})`, async () => {
          await page.waitForFunction(() => document.querySelector('[data-testid="s2-status-agent"]')?.getAttribute('data-provider-name') === 'DeepSeek', null, { timeout: 8000 });
          is(await page.locator(sel('s2-status-model')).textContent(), 'DeepSeek V4 Flash', 'the bar names the model');
          is((await chip.locator('.s2-pill-l').textContent()).trim(), 'DeepSeek V4 Flash', 'the chip names it too');
        });
        await shotChip('chip-default-mode');
        await chip.click();
        await page.locator(sel('s2-model-menu')).waitFor();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${OUT}/popup-default-mode-${theme}.png` });
        await page.keyboard.press('Escape');
        continue;
      }
      if (EMPTY) {
        await check(`the empty chip keeps its whole label and the popup has one action and no slider (${theme})`, async () => {
          is((await chip.locator('.s2-pill-l').textContent()).trim(), 'Connect agent', 'full label');
          is(await chip.locator('.s2-pill-l').evaluate((e) => e.scrollWidth > e.clientWidth), false, 'not truncated');
          await chip.click();
          await page.locator(sel('s2-model-menu')).waitFor();
          is(await page.locator(sel('s2-effort')).count(), 0, 'no reasoning slider without a model');
          is(await page.locator(sel('s2-model-empty')).count(), 0, 'no duplicate empty line');
          is(await page.locator(sel('s2-add-model')).count(), 1, 'one action row');
        });
        await shotChip('chip-empty');
        await page.screenshot({ path: `${OUT}/popup-empty-${theme}.png` });
        await page.keyboard.press('Escape');
        continue;
      }
      /* Choose the model through the popup, as a person would: that is what puts it on the chip. */
      await chip.click();
      await page.locator(sel('s2-model-menu')).waitFor();
      await page.locator(`${sel('v3-model-row')}[data-model="${LONG ? 'p4' : 'p2'}"]`).click();
      await page.locator(sel('s2-model-menu')).waitFor({ state: 'detached' });
      if (!LONG) {
        await check(`switching to Sonnet 5.5 reads Claude in the status bar (${theme})`, async () => {
          await page.waitForFunction(() => document.querySelector('[data-testid="s2-status-agent"]')?.getAttribute('data-provider-name') === 'Claude', null, { timeout: 8000 });
          is(await page.locator(sel('s2-status-model')).textContent(), 'Sonnet 5.5', 'the bar names the model the chip names');
          is((await chip.locator('.s2-pill-l').textContent()).trim(), 'Sonnet 5.5', 'the chip names it too');
        });
      }
      const setMode = async (key) => {
        await chip.click();
        await page.locator(sel('s2-model-menu')).waitFor();
        await page.locator(sel(`s2-mode-${key}`)).click();
        await page.locator(sel('s2-model-menu')).waitFor({ state: 'detached' });
      };

      if (LONG) {
        await check(`a long model id shows its whole nickname with room to spare, inside the chip's cap (${theme})`, async () => {
          const b = await chip.boundingBox();
          if (b.width > 321) throw new Error(`chip is ${b.width}px wide`);
          const overflow = await chip.locator('.s2-pill-l').evaluate((e) => e.scrollWidth > e.clientWidth);
          is(overflow, false, 'a name with room is not cut');
          is((await chip.locator('.s2-pill-l').textContent()).trim(), 'Qwen 2.5 Coder', 'the nickname, condensed');
          const title = await chip.getAttribute('title');
          if (!/q4_K_M/.test(title ?? '')) throw new Error(`tooltip lacks the full id: ${title}`);
        });
        await shotChip('chip-long-name');
        continue;
      }

      await setMode('smart');
      await shotChip('chip-plan-off');
      await setMode('plan');
      is(await chip.getAttribute('data-mode'), 'plan', 'Plan is on');
      await shotChip('chip-plan-on');

      await chip.click();
      const menu = page.locator(sel('s2-model-menu'));
      await menu.waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/popup-${theme}.png` });
      await check(`at 1440x900 the popup does not scroll, reasoning and Add stay pinned, loopback is Local (${theme})`, async () => {
        const body = page.locator(sel('s2-menu-body'));
        const m = await body.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
        if (m.sh > m.ch + 1) throw new Error(`the list scrolls with room to spare: ${m.sh} > ${m.ch}`);
        const foot = await page.locator(sel('s2-menu-foot')).boundingBox();
        const eff = await page.locator(sel('s2-effort')).boundingBox();
        const mb = await menu.boundingBox();
        if (eff.y < foot.y || foot.y + foot.height > mb.y + mb.height + 1) throw new Error('the foot is not inside the popup');
        const groups = await page.locator('.s2-group-h').allTextContents();
        if (groups.some((g) => /localhost|127/i.test(g))) throw new Error(`a loopback group is named for the host: ${groups}`);
        is(await page.locator(`${sel('s2-model-group-local')} ${sel('v3-model-row')}[data-model="p6"]`).count(), 1, 'LM Studio on loopback is under Local');
      });
      await check(`on a short window the list scrolls under a fade and the foot stays in view (${theme})`, async () => {
        await page.setViewportSize({ width: 1024, height: 600 });
        await page.waitForTimeout(300);
        const body = page.locator(sel('s2-menu-body'));
        const m = await body.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
        if (m.sh <= m.ch) throw new Error('expected an overflowing list at 600px');
        is(await menu.getAttribute('data-more'), 'true', 'the fade is on');
        const eff = await page.locator(sel('s2-effort')).boundingBox();
        if (eff.y < 0 || eff.y + eff.height > 600) throw new Error('reasoning is out of view');
        await page.screenshot({ path: `${OUT}/popup-short-${theme}.png` });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(300);
      });
      await check(`popup fits the window with 5 models at 1024x768, 1024x700 and 800x600 (${theme})`, async () => {
        for (const [w, h] of [[1024, 768], [1024, 700], [800, 600]]) {
          await page.setViewportSize({ width: w, height: h });
          await page.waitForTimeout(300);
          const b = await menu.boundingBox();
          if (b.x < 0 || b.y < 0 || b.x + b.width > w || b.y + b.height > h) throw new Error(`menu overflows at ${w}x${h}: ${JSON.stringify(b)}`);
          const c = await chip.boundingBox();
          if (b.y + b.height > c.y) throw new Error(`menu does not open upward at ${w}x${h}`);
          const head = await page.locator(sel('s2-mode-menu')).boundingBox();
          if (head.y < 0) throw new Error(`Mode heading is cut at ${w}x${h}`);
          if (w === 1024 && h === 700) await page.screenshot({ path: `${OUT}/popup-1024x700-${theme}.png` });
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(300);
      });
      await page.keyboard.press('Escape');
      await check(`Esc closes the popup and focus returns to the chip (${theme})`, async () => {
        await menu.waitFor({ state: 'detached' });
        is(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 'v3-model-trigger', 'focus is on the chip');
      });
      await check(`a switch made in Settings (not the popup) reaches the chip, the bar and the next send (${theme})`, async () => {
        await chip.click();
        await page.locator(sel('s2-add-model')).click();
        const use = page.locator(`${sel('settings-profile-use')}[data-profile="p5"]`);
        await use.waitFor({ timeout: 15000 });
        await use.click();
        await page.waitForFunction(() => document.querySelector('[data-testid="s2-status-agent"]')?.getAttribute('data-provider-name') === 'OpenRouter', null, { timeout: 8000 });
        is((await chip.locator('.s2-pill-l').textContent()).trim(), 'Llama 3.3', 'the chip names the new model');
        is(await page.locator(sel('s2-status-model')).textContent(), 'Llama 3.3', 'the bar names it too');
        /* the next send carries it */
        await page.keyboard.press('Escape');
        const sent = page.waitForRequest((r) => /\/api\/ask/.test(r.url()) && r.method() === 'POST', { timeout: 8000 }).catch(() => null);
        await page.locator('.s2-ta').first().fill('hello');
        await page.keyboard.press('Enter');
        const req = await sent;
        if (!req) throw new Error('the send went nowhere');
        const body = req.postData() ?? '';
        if (/minicpm5|claude-sonnet/.test(body)) throw new Error('the send still names the old model');
        await shotChip('chip-after-settings-switch');
      });
      await check(`a slow GET that began before a popup pick does not revert it (${theme})`, async () => {
        getDelayMs = 1000;
        try {
          await chip.click();
          await page.locator(`${sel('v3-model-row')}[data-model="p2"]`).click();
          await page.waitForTimeout(3000);
          is((await chip.locator('.s2-pill-l').textContent()).trim(), 'Sonnet 5.5', 'the chip still names the pick');
          is(await page.locator(sel('s2-status-agent')).getAttribute('data-provider-name'), 'Claude', 'the bar too');
        } finally {
          getDelayMs = 0;
        }
      });
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/hooks': { declared: {}, trusted: false } } },
);
