#!/usr/bin/env node
/**
 * Round 9 (asks 16, 17): screenshots of the model menu with its reasoning
 * slider, and a real drag + keyboard pass over that slider in a real browser.
 * Shots go to $SHOTS (default /mnt/project-files/sequence/cloud-pass/shots/cloud).
 */
import fs from 'node:fs';
import { is, sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/cloud';
fs.mkdirSync(OUT, { recursive: true });

const CONFIG = {
  configured: true,
  mode: 'custom',
  defaultProfileId: 'p1',
  profiles: [
    { id: 'p1', name: 'Sequence Local', provider: 'ollama', model: 'qwen3-coder:30b', params: { reasoningEffort: 'medium' } },
    { id: 'p2', name: 'Sequence Cloud', provider: 'anthropic', model: 'claude-sonnet-5' },
    { id: 'p3', name: 'GPT', provider: 'openai', model: 'gpt-5.6' },
  ],
};
const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [{ id: 'h1', title: 'Rate limiting for the gateway', createdAt: at(5), updatedAt: at(5) }] },
  scope: 'workspace',
  repos: [],
};

await suite(
  'controls-shots',
  async ({ page, base, check }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const theme of ['dark', 'light']) {
      await page.goto(base);
      await page.evaluate((t) => {
        try {
          localStorage.setItem('theme', t);
        } catch {}
        document.documentElement.setAttribute('data-theme', t);
      }, theme);
      await page.waitForSelector(sel('shell'));
      await page.locator(sel('v3-model-trigger')).first().waitFor({ state: 'visible', timeout: 15000 });
      await page.locator(sel('v3-model-trigger')).first().click();
      await page.locator(sel('s2-model-menu')).waitFor();
      await page.waitForTimeout(400);
      if (theme === 'dark') {
        await check('the thumb is a slider; arrows and drag move it', async () => {
          const thumb = page.getByRole('slider', { name: 'Reasoning effort' });
          const before = await thumb.getAttribute('aria-valuetext');
          await thumb.focus();
          await page.keyboard.press('ArrowRight');
          const after = await thumb.getAttribute('aria-valuetext');
          if (before === after) throw new Error(`keyboard did not move the thumb (${before})`);
          const hit = await page.locator('.s2-slider-hit').boundingBox();
          await page.mouse.move(hit.x + hit.width / 2, hit.y + 12);
          await page.mouse.down();
          await page.mouse.move(hit.x + hit.width - 1, hit.y + 12, { steps: 6 });
          await page.mouse.up();
          is(await thumb.getAttribute('aria-valuenow'), await thumb.getAttribute('aria-valuemax'), 'drag to the right end lands on the last stop');
          await page.mouse.move(hit.x + 1, hit.y + 12);
          await page.mouse.down();
          await page.mouse.move(hit.x + hit.width / 2, hit.y + 12, { steps: 6 });
          await page.mouse.up();
          await page.keyboard.press('End');
        });
      }
      await page.screenshot({ path: `${OUT}/controls-model-picker-${theme}.png` });
      await page.keyboard.press('Escape');
    }
  },
  { routes: { '/api/ai-config': CONFIG, '/api/sessions': SESSIONS } },
);
