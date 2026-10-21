#!/usr/bin/env node
/**
 * 0.1.7 R1: the composer chip and the status bar, in a real browser.
 *
 * Owner: "No colors" on the mode icon; a long model name "fades earlier ... cut to ... 12 characters"; "the status bar
 * shouldn't go past those boundaries" of the chat box.
 * Reads: computed colour of the mode glyph against the chip's model text, the name's computed max-width / mask /
 * text-overflow, and the bounding rects of the composer card (section.s2-chat) and the status bar's content.
 * Matrix: 1440 and 1024, dark and light, models "DeepSeek V4 Flash" and "Sonnet 5.5", every mode. Controls: a planted
 * accent-coloured glyph must be flagged; a planted overflowing child must be flagged by the bounds probe.
 * SHOTS = output dir (optional): writes composer + status bar PNGs.
 */
import fs from 'node:fs';
import { is, sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '';
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const LONG_WS = 'a-very-long-workspace-name-for-the-bounds-check-repository';
const LONG_BRANCH = 'feature/some-extremely-long-branch-name-that-would-push-the-status-bar-wide';
const json = (body) => (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const at = (h) => new Date(Date.UTC(2026, 9, 8, h)).toISOString();
const SESSIONS = { index: { version: 1, activeId: 'c1', sessions: [{ id: 'c1', title: 'Chip bounds', titleEdited: false, createdAt: at(5), updatedAt: at(6) }] }, scope: 'workspace', repos: [] };
const MODELS = [
  { label: 'DeepSeek V4 Flash', cfg: { configured: true, provider: 'deepseek', model: 'deepseek-v4-flash', apiKey: '9f3a' }, long: true },
  { label: 'Sonnet 5.5', cfg: { configured: true, provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: '9f3a' }, long: false },
];

async function fresh(page, base, theme, w, model, ws = LONG_WS) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const pat of ['**/api/sessions', '**/api/acp/runs*', '**/api/acp/capabilities*', '**/api/ai-config', '**/api/tree', '**/api/acp/full-access', '**/api/git/status*', '**/api/status', '**/archgraph.json']) await page.unroute(pat).catch(() => {});
  await page.route('**/api/sessions', json(SESSIONS));
  await page.route('**/api/acp/capabilities*', json({ models: [], efforts: [], commands: [], skills: [] }));
  await page.route('**/api/acp/runs*', json({ runs: [] }));
  await page.route('**/api/acp/full-access', json({ confirmed: true, prompt: 'x' }));
  await page.route('**/api/ai-config', json(model.cfg));
  await page.route('**/api/tree', json({ path: '', name: 'workspace', type: 'dir', children: [] }));
  await page.route('**/api/git/status*', json({ branch: LONG_BRANCH, files: [] }));
  await page.route('**/api/status', json({ attached: true, repoName: ws, root: `/home/dev/${ws}` }));
  await page.route('**/archgraph.json', json({ nodes: [], edges: [], warnings: [], repoName: ws, repoRoot: `/home/dev/${ws}`, scannedAt: at(5) }));
  await page.goto(base);
  await page.evaluate((t) => {
    try {
      localStorage.clear();
      localStorage.setItem('seq.theme', t);
      localStorage.setItem('theme', t);
    } catch {}
  }, theme);
  await page.reload();
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.waitForSelector(sel('shell'));
  await page.waitForSelector(sel('s2-status'));
  await page.waitForTimeout(900);
}

const probe = (page) =>
  page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid="${id}"]`);
    const rgb = (el) => getComputedStyle(el).color;
    const chip = q('v3-model-label');
    const glyph = q('s2-mode-icon');
    const bar = q('s2-status');
    const card = document.querySelector('section.s2-chat');
    const sbModel = q('s2-status-model');
    const nameStyle = (el) => {
      const cs = getComputedStyle(el);
      return { maxWidth: cs.maxWidth, textOverflow: cs.textOverflow, mask: cs.maskImage || cs.webkitMaskImage, cut: el.getAttribute('data-cut'), text: el.textContent, w: el.getBoundingClientRect().width, font: parseFloat(cs.fontSize) };
    };
    const kids = [...bar.children].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
    const br = bar.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const right = Math.max(br.right, ...kids.map((k) => k.right));
    const left = Math.min(br.left, ...kids.map((k) => k.left));
    return {
      glyphColor: rgb(glyph),
      glyphIconColor: rgb(glyph.firstElementChild),
      chipColor: rgb(chip),
      chip: nameStyle(chip),
      sb: sbModel ? nameStyle(sbModel) : null,
      card: { l: cr.left, r: cr.right },
      bar: { l: left, r: right },
      branchShown: !!q('s2-status-branch') && q('s2-status-branch').getBoundingClientRect().width > 0 && !bar.hasAttribute('data-nobranch'),
      branch: q('s2-status-branch') ? { cut: q('s2-status-branch').getAttribute('data-cut'), mask: getComputedStyle(q('s2-status-branch')).maskImage } : null,
      barScroll: bar.scrollWidth - bar.clientWidth,
      text: bar.innerText.replace(/\s+/g, ' '),
    };
  });

await suite('composer-chip-bounds', async ({ page, base, check }) => {
  await fresh(page, base, 'dark', 1440, MODELS[0]);

  await check('control: the colour probe flags an accent-coloured glyph, the bounds probe an overflowing segment', async () => {
    const r = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="s2-mode-icon"]');
      const chip = document.querySelector('[data-testid="v3-model-label"]');
      const before = getComputedStyle(g).color;
      g.style.color = 'rgb(255, 0, 0)';
      const flagged = getComputedStyle(g).color !== getComputedStyle(chip).color;
      g.style.color = '';
      const bar = document.querySelector('[data-testid="s2-status"]');
      const x = document.createElement('span');
      x.className = 's2-sb-x';
      x.style.cssText = 'width:4000px;flex:none';
      bar.appendChild(x);
      const over = x.getBoundingClientRect().right > document.querySelector('section.s2-chat').getBoundingClientRect().right;
      x.remove();
      return { flagged, over, restored: getComputedStyle(g).color === before };
    });
    is(r.flagged, true, 'accent glyph flagged');
    is(r.over, true, 'overflow flagged');
    is(r.restored, true, 'control cleaned up');
  });

  for (const w of [1440, 1024]) {
    await check(`${w}: a long branch beside a short workspace and model stays inside the card`, async () => {
      await fresh(page, base, 'dark', w, MODELS[1], 'seq');
      await page.waitForTimeout(600);
      const p = await probe(page);
      is(p.bar.l >= p.card.l - 0.5 && p.bar.r <= p.card.r + 0.5, true, `bar ${p.bar.l}-${p.bar.r} inside card ${p.card.l}-${p.card.r}`);
      if (OUT) {
        const c = await page.locator('section.s2-chat').boundingBox();
        const b = await page.locator(sel('s2-status')).boundingBox();
        const y = c.y + c.height - 100;
        await page.screenshot({ path: `${OUT}/longbranch_dark_${w}.png`, clip: { x: Math.max(0, c.x - 12), y, width: c.width + 24, height: Math.min(900 - y, b.y + b.height + 12 - y) } });
      }
    });
  }

  for (const theme of ['dark', 'light']) {
    for (const w of [1440, 1024]) {
      for (const model of MODELS) {
        const T = `${theme} ${w} ${model.label}`;
        await check(`${T}: neutral mode glyph in every mode, capped faded names, bar inside the card`, async () => {
          await fresh(page, base, theme, w, model);
          await page.locator(sel('s2-mode-trigger')).click();
          const modeKeys = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="s2-quickmode-"][role="menuitemradio"]')].map((e) => e.getAttribute('data-mode')));
          await page.keyboard.press('Escape');
          if (modeKeys.length < 2) throw new Error(`modes found: ${modeKeys.length}`);
          for (const key of modeKeys) {
            await page.locator(sel('s2-mode-trigger')).click();
            await page.locator(sel(`s2-quickmode-${key}`)).click();
            const dlg = page.getByRole('button', { name: /allow|confirm|enable/i });
            if (await dlg.count()) await dlg.first().click().catch(() => {});
            await page.waitForTimeout(500);
            const p = await probe(page);
            is(p.glyphColor, p.chipColor, `${key}: glyph colour is the chip ink`);
            is(p.glyphIconColor, p.chipColor, `${key}: glyph svg colour is the chip ink`);
            is(p.bar.l >= p.card.l - 0.5, true, `${key}: bar left ${p.bar.l} inside card ${p.card.l}`);
            is(p.bar.r <= p.card.r + 0.5, true, `${key}: bar right ${p.bar.r} inside card ${p.card.r}`);
            is(p.text.includes('a-very-long'), true, `${key}: the long workspace is in the bar (${p.text})`);
            is(!!p.branch, true, `${key}: the long branch is mounted (hidden only when no stub of it fits)`);
            is(p.barScroll <= 0, true, `${key}: bar does not scroll sideways (${p.barScroll})`);
            if (OUT) {
              const c = await page.locator('section.s2-chat').boundingBox();
              const s = await page.locator(sel('s2-status')).boundingBox();
              const y = Math.max(0, c.y + c.height - 140);
              const x0 = Math.max(0, c.x - 12);
              const slug = model.label.replace(/\W+/g, '').toLowerCase();
              await page.screenshot({ path: `${OUT}/${slug}_${theme}_${w}_${key}.png`, clip: { x: x0, y, width: Math.min(c.width + 24, w - x0), height: Math.min(900 - y, s.y + s.height + 12 - y) } });
            }
          }
          const p = await probe(page);
          for (const [where, n] of [['chip', p.chip], ['status bar', p.sb]]) {
            if (!n) throw new Error(`${where}: no name element`);
            is(n.textOverflow === 'ellipsis', false, `${where}: no ellipsis`);
            /* 12ch is 12 widths of "0": about 6 px a character at 12 px type; the computed value is in px. */
            is(/px$/.test(n.maxWidth) && parseFloat(n.maxWidth) >= 12 * 0.4 * n.font && parseFloat(n.maxWidth) <= 12 * 0.8 * n.font, true, `${where}: max-width ${n.maxWidth} is the 12ch cap`);
            is(n.w <= parseFloat(n.maxWidth) + 0.5, true, `${where}: name box ${n.w} within ${n.maxWidth}`);
            if (model.long) {
              is(n.cut, 'true', `${where}: long name is marked cut`);
              is(/linear-gradient/.test(n.mask), true, `${where}: long name fades (mask ${n.mask})`);
            } else {
              is(n.cut, null, `${where}: short name is not cut`);
              is(n.mask, 'none', `${where}: short name has no mask`);
              is(n.text, model.label, `${where}: short name whole`);
            }
          }
        });
      }
    }
  }
});
