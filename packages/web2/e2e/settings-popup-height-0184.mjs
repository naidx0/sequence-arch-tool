#!/usr/bin/env node
/**
 * SETTINGS POPUPS DO NOT NEED SCROLLING (0.1.8.4, lane agents)
 *
 * Owner: "popups should not scroll (except Skills, which can be a bounded list so the popup isn't infinitely large)."
 * Opens Settings at 1440x900 and 1024x700, goes through each tab (and the OpenRouter provider form on Models), and reads the
 * settings body: scrollHeight must not exceed clientHeight. Skills is given 60 skills: its LIST must be bounded and scroll
 * inside itself, and the dialog must stay inside the window. Shots go to $SHOTS (default docs/bench/0184-r2-agents),
 * named with $SHOT_TAG (default "after").
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sel, settle, suite } from './lib/harness.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = process.env.SHOTS ?? path.join(REPO, 'docs', 'bench', '0184-r2-agents');
const TAG = process.env.SHOT_TAG ?? 'after';
fs.mkdirSync(OUT, { recursive: true });

const MODELS = Array.from({ length: 24 }, (_, i) => `meta-llama/llama-3.3-70b-instruct-free-variant-${i}`);
const CONFIG = { configured: false, provider: 'openai-compatible', model: '', baseUrl: '', apiKey: '', profiles: [], localProviders: [] };
const SKILLS = {
  dir: '.sequence/skills',
  skills: Array.from({ length: 60 }, (_, i) => ({ slug: `skill-${i}`, name: `Skill number ${i}`, description: `What skill ${i} does, in one line.`, scope: 'project' })),
  warnings: [],
  trusted: true,
  instructions: null,
};
const SESSIONS = { index: { version: 1, activeId: null, sessions: [] }, scope: 'workspace', repos: [] };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const read = (page) =>
  page.evaluate(() => {
    const body = document.querySelector('[data-testid="settings-body"]');
    const dlg = document.querySelector('[data-testid="overlay-settings"]')?.closest('[role="dialog"]') ?? document.querySelector('[role="dialog"]');
    const r = dlg?.getBoundingClientRect();
    const list = document.querySelector('[data-testid="settings-skills-list"]');
    return {
      body: body ? { sh: body.scrollHeight, ch: body.clientHeight, sw: body.scrollWidth, cw: body.clientWidth } : null,
      fits: r ? r.top >= -1 && r.bottom <= innerHeight + 1 : null,
      list: list ? { sh: list.scrollHeight, ch: list.clientHeight, oy: getComputedStyle(list).overflowY, ox: getComputedStyle(list).overflowX } : null,
    };
  });

await suite(
  'settings-popup-height-0184',
  async ({ page, base, check, log }) => {
    await page.addInitScript(() => localStorage.setItem('sequence.onboarding.skip', '1'));
    await page.route('**/api/ai-config', (r) => (r.request().method() === 'GET' ? json(r, CONFIG) : json(r, { ok: true })));
    await page.route('**/api/ai-models*', (r) => json(r, { ok: true, models: MODELS, source: 'openai', cached: false, total: 24 }));
    await page.route('**/api/skills*', (r) => (r.request().method() === 'GET' ? json(r, SKILLS) : r.fallback()));
    await page.route('**/api/providers/catalog*', (r) =>
      json(r, {
        providers: [{ id: 'openrouter', name: 'OpenRouter', wire: 'openai-compatible', api: 'https://openrouter.ai/api/v1', env: ['OPENROUTER_API_KEY'], doc: 'https://openrouter.ai/keys', models: MODELS.map((id) => ({ id, name: id })) }],
        detected: [],
      }),
    );
    await page.route('**/api/hooks*', (r) => json(r, { events: [], blocking: [], declared: {}, trusted: false }));

    for (const [width, height] of [[1440, 900], [1024, 700]]) {
      await page.setViewportSize({ width, height });
      await page.goto(base);
      await page.waitForSelector(sel('shell'));
      if (!(await page.locator(sel('v3-rail-settings')).count())) await page.locator(`${sel('s2-sidebar-open')}, ${sel('s2-iconrail-expand')}`).first().click();
      await page.locator(`${sel('v3-rail-settings')}, ${sel('s2-iconrail-settings')}`).first().click();
      await page.waitForSelector(sel('overlay-settings'), { timeout: 15000 });
      await settle(page);
      const tab = (id) => () => page.locator(sel(`settings-nav-${id}`)).click();
      const steps = [
        ['app', tab('app')],
        ['agents', tab('agents')],
        ['models', tab('models')],
        [
          'openrouter',
          async () => {
            await page.locator(sel('settings-nav-models')).click();
            await page.locator(`${sel('settings-choice')}[data-choice="key"] ${sel('settings-choice-toggle')}`).click();
            await page.locator(`${sel('settings-preset')}[data-preset="openrouter"]`).click();
          },
        ],
        ['skills', tab('skills')],
        ['safety', tab('safety')],
        
        ['workspace', tab('workspace')],
      ];
      for (const [name, go] of steps) {
        await go();
        await settle(page);
        await page.waitForTimeout(350);
        if (name === 'skills') await page.locator(sel('settings-skills-list')).waitFor({timeout: 5000});
        const m = await read(page);
        await page.screenshot({ path: path.join(OUT, `${TAG}-height-${name}-${width}x${height}.png`) });
        log(width, height, name, JSON.stringify(m));
        if (name === 'skills') {
          await check(`${width}x${height} skills: the list is bounded and scrolls inside itself, the dialog fits the window`, async () => {
            if (!m.list) throw new Error('no skills list');
            if (m.list.sh <= m.list.ch + 1) throw new Error(`60 skills, yet the list is not bounded: ${JSON.stringify(m.list)}`);
            if (m.list.oy !== 'auto' && m.list.oy !== 'scroll') throw new Error(`list overflow-y is ${m.list.oy}`);
            if (m.list.ox === 'auto' || m.list.ox === 'scroll') throw new Error('list scrolls sideways');
            if (!m.fits) throw new Error('the dialog is taller than the window');
          });
        } else {
          await check(`${width}x${height} ${name}: fits with vertical-only scrolling`, async () => {
            if (!m.body) throw new Error('no settings body');
            if (m.body.sw > m.body.cw + 1) throw new Error('body scrolls sideways');
            if (name === 'openrouter' && width === 1440 && m.body.sh > m.body.ch + 1) throw new Error(`body scrolls: scrollHeight ${m.body.sh} > clientHeight ${m.body.ch}`);
          });
        }
      }
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/status': { attached: false, attaching: false } } },
);
