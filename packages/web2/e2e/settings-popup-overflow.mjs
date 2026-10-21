#!/usr/bin/env node
/**
 * SETTINGS POPUPS DO NOT SCROLL SIDEWAYS (0.1.8.4, lane settings)
 *
 * Owner: "when OpenRouter is opened in Agents it actually makes you scroll. Pop-ups should not scroll (except Skills, a bounded
 * list). Bottom-up scrolling is OK, left-to-right is NEVER OK."  jsdom has no layout, so this runs in a real browser against
 * dist/. It opens Settings, then each tab, and on Models the OpenRouter provider form, at 1440, 1024 and 420 px with long
 * model ids, a long saved name and a long error sentence. It measures scrollWidth > clientWidth on the document, the body, the
 * dialog and every descendant, and that the dialog fits the viewport vertically. Shots go to $SHOTS
 * (default docs/bench/0184-fin-settings), named by $SHOT_TAG (default "after").
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sel, settle, suite } from './lib/harness.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = process.env.SHOTS ?? path.join(REPO, 'docs', 'bench', '0184-fin-settings');
const TAG = process.env.SHOT_TAG ?? 'after';
fs.mkdirSync(OUT, { recursive: true });

const LONG_ID = 'openrouter/anthropic/claude-sonnet-5-20261001-extended-thinking-preview-with-a-very-long-suffix-that-cannot-break';
const MODELS = Array.from({ length: 24 }, (_, i) => `meta-llama/llama-3.3-70b-instruct-free-variant-${i}-with-a-long-quantisation-tag-q8_0-ctx131072`).concat([LONG_ID]);
const LONG_ERR = 'The provider answered 401: ' + 'Invalid API key sk-or-v1-FIXTURE-NOT-A-REAL-KEY-'.repeat(4) + 'https://openrouter.ai/api/v1/chat/completions/very/long/path/with/no/spaces/at/all/anywhere/in/it';
const CONFIG = {
  configured: true,
  provider: 'openai-compatible',
  model: LONG_ID,
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: '••••c0de',
  profiles: [{ id: 'p1', name: LONG_ID, provider: 'openai-compatible', model: LONG_ID, baseUrl: 'https://openrouter.ai/api/v1', apiKey: '••••c0de' }],
  defaultProfileId: 'p1',
  localProviders: [],
};
const SESSIONS = { index: { version: 1, activeId: null, sessions: [] }, scope: 'workspace', repos: [] };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Everything wider than its box, in the dialog and out of it. */
const measure = (page) =>
  page.evaluate(() => {
    const out = { doc: false, body: false, dialog: null, vertical: null, offenders: [] };
    const de = document.documentElement;
    out.doc = de.scrollWidth > de.clientWidth;
    out.body = document.body.scrollWidth > document.body.clientWidth;
    const host = document.querySelector('[data-testid="overlay-settings"]');
    const dlg = host?.closest('[role="dialog"]') ?? document.querySelector('[role="dialog"]');
    if (!dlg) return out;
    const r = dlg.getBoundingClientRect();
    out.dialog = dlg.scrollWidth > dlg.clientWidth;
    out.vertical = { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, fits: r.top >= -1 && r.bottom <= innerHeight + 1 };
    for (const el of [dlg, ...dlg.querySelectorAll('*')]) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'inline') continue;
      const over = el.scrollWidth > el.clientWidth + 1;
      const scrollsX = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && over;
      const escapes = b.right > r.right + 1 || b.left < r.left - 1;
      /* A single line cut with an ellipsis is a truncation, not a sideways scroll: it is neither reachable nor wider than its box. */
      if (scrollsX || escapes || (over && cs.overflowX === 'visible')) {
        out.offenders.push(`${el.tagName.toLowerCase()}[${el.getAttribute('data-testid') ?? ''}].${String(el.className).slice(0, 40)} sw${el.scrollWidth}>cw${el.clientWidth} ox:${cs.overflowX}${scrollsX ? ' SCROLLS' : ''}${escapes ? ' ESCAPES' : ''}`);
      }
    }
    return out;
  });

await suite(
  'settings-popup-overflow',
  async ({ page, base, check, log }) => {
    await page.route('**/api/ai-config', (r) => (r.request().method() === 'GET' ? json(r, CONFIG) : json(r, { error: LONG_ERR }, 400)));
    await page.route('**/api/ai-models*', (r) => json(r, { ok: true, models: MODELS, source: 'openai', cached: false, total: 300 }));
    await page.route('**/api/providers/catalog*', (r) =>
      json(r, {
        providers: [{ id: 'openrouter', name: 'OpenRouter', wire: 'openai-compatible', api: 'https://openrouter.ai/api/v1', env: ['OPENROUTER_API_KEY'], doc: 'https://openrouter.ai/keys', models: MODELS.map((id) => ({ id, name: id })) }],
        detected: [{ id: 'openrouter', name: 'OpenRouter', keyEnv: 'OPENROUTER_API_KEY' }],
      }),
    );
    await page.route('**/api/hooks*', (r) => json(r, { events: [], blocking: [], declared: {}, trusted: false }));

    for (const width of [1440, 1024, 420]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(base);
      await page.waitForSelector(sel('shell'));
      if (!(await page.locator(sel('v3-rail-settings')).count())) await page.locator(`${sel('s2-sidebar-open')}, ${sel('s2-iconrail-expand')}`).first().click();
      await page.locator(`${sel('v3-rail-settings')}, ${sel('s2-iconrail-settings')}`).first().click();
      await page.waitForSelector(sel('overlay-settings'), { timeout: 15000 });
      await settle(page);

      const tab = (id) => async () => {
        await page.locator(sel(`settings-nav-${id}`)).click();
      };
      const steps = [
        ['agents', tab('agents')],
        ['models', tab('models')],
        [
          'openrouter',
          async () => {
            await page.locator(sel('settings-nav-models')).click();
            await page.locator(`${sel('settings-choice')}[data-choice="key"] ${sel('settings-choice-toggle')}`).click();
            await page.locator(`${sel('settings-preset')}[data-preset="openrouter"]`).click();
            await page.waitForTimeout(400);
            /* A long error sentence from the server, shown where the reader looks. */
            await page.locator(sel('settings-model')).fill(LONG_ID);
            await page.locator(sel('settings-apikey')).fill('sk-or-FIXTURE-NOT-A-KEY');
            await page.locator(sel('settings-save')).click();
            await page.locator(sel('settings-failure')).waitFor({ timeout: 5000 });
          },
        ],
        ['skills', tab('skills')],
        [
          'safety',
          async () => {
            await page.locator(sel('settings-nav-safety')).click();
            /* the autonomy table is folded until asked for; open it so the narrow stack is measured */
            await page.locator('details.sb-more > summary').first().click().catch(() => {});
          },
        ],
        ['workspace', tab('workspace')],
      ];
      for (const [name, go] of steps) {
        await go();
        await settle(page);
        await page.waitForTimeout(250);
        const m = await measure(page);
        await page.screenshot({ path: path.join(OUT, `${TAG}-${name}-${width}.png`) });
        log(width, name, JSON.stringify(m));
        await check(`${width} ${name}: no sideways scroll in document, body, dialog or any child`, async () => {
          if (m.doc || m.body || m.dialog || m.offenders.length) {
            throw new Error(`doc:${m.doc} body:${m.body} dialog:${m.dialog} offenders:\n    ${m.offenders.join('\n    ')}`);
          }
        });
        if (name === 'workspace') {
          await check(`${width} workspace: This workspace, Open a folder and Default workspace are drawn`, async () => {
            for (const id of ['settings-open-folder', 'settings-default-workspace', 'settings-sections']) {
              if ((await page.locator(sel(id)).count()) !== 1) throw new Error(`${id} is absent`);
            }
          });
        }
        await check(`${width} ${name}: the dialog fits the viewport vertically`, async () => {
          if (m.vertical && !m.vertical.fits) throw new Error(JSON.stringify(m.vertical));
        });
      }
    }
  },
  { routes: { '/api/sessions': SESSIONS } },
);
