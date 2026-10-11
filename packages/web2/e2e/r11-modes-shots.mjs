#!/usr/bin/env node
/**
 * Round 11 (owner, 2026-10-08): the mode is a plain icon inside ONE plain pill with the model.
 *   [mode icon] [provider icon] [model nickname]
 * No tint, no circle, no divider, no colour per mode: the mode icon takes the ink of the model text.
 * The mode icon opens a small three-row menu; the model part opens the full popup (Mode, Model, Reasoning).
 * The send button, the "+" and the pill outline are the same in every mode.
 * Shots go to $SHOTS (default /mnt/project-files/sequence/cloud-pass/shots/r11/modes).
 */
import fs from 'node:fs';
import { is, sel, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r11/modes';
fs.mkdirSync(OUT, { recursive: true });

const SONNET = { id: 'p2', name: 'claude-sonnet-5-5', provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: '••••9f3a', params: { reasoningEffort: 'medium' } };
const longProfile = (model) => ({ id: 'pl', name: model, provider: 'openai-compatible', model, apiKey: '••••1a2b', baseUrl: 'https://openrouter.ai/api/v1', params: { reasoningEffort: 'medium' } });
let active = SONNET;
const configBody = () => ({ configured: true, provider: active.provider, model: active.model, apiKey: active.apiKey, profiles: [active], defaultProfileId: active.id });
const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [{ id: 'h1', title: 'Rate limiting', createdAt: at(5), updatedAt: at(5) }] },
  scope: 'workspace',
  repos: [],
};
const LONG_NAMES = [
  ['deepseek', 'DeepSeek V4 Flash'],
  ['qwen', 'Qwen 2.5 Coder 32B Instruct'],
  ['unknown', 'acme-internal-reasoning-model-with-a-very-long-identifier-2026-q3-preview'],
];

/** Parse a computed colour (rgb(), rgba() or color(srgb ...)) to [r,g,b,a] in 0..255. */
const PARSE = `
  const parse = (c) => {
    let m = /^rgba?\\(([^)]+)\\)$/.exec(c);
    if (m) { const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = /^color\\(srgb ([^)]+)\\)$/.exec(c);
    if (m) { const p = m[1].split(/[ \\/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    return [0, 0, 0, 0];
  };
  const over = (top, under) => { const a = top[3] + under[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(parse(getComputedStyle(e).backgroundColor)); let acc = [255, 255, 255, 1]; for (let i = chain.length - 1; i >= 0; i--) acc = over(chain[i], acc); return acc; };
`;

await suite(
  'r11-modes-shots',
  async ({ page, base, check }) => {
    await page.route('**/api/ai-config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(configBody()) }));
    await page.route('**/api/acp/full-access', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ confirmed: true, prompt: 'Agents can run any command without asking' }) }));
    await page.setViewportSize({ width: 1440, height: 900 });
    const quiet = async () => {
      /* No focus ring in a shot: blur whatever has focus, park the pointer, let transitions finish. */
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
      await page.mouse.click(2, 2);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(250);
    };
    for (const theme of ['dark', 'light']) {
      active = SONNET;
      await page.goto(base);
      await page.evaluate((t) => {
        try {
          localStorage.setItem('seq.theme', t);
          localStorage.setItem('v3.composer.mode', 'teach');
        } catch {}
      }, theme);
      await page.reload();
      await page.waitForSelector(sel('shell'));
      const modeBtn = page.locator(sel('s2-mode-trigger')).first();
      const chip = page.locator(sel('v3-model-trigger')).first();
      await chip.waitFor({ state: 'visible', timeout: 15000 });
      const composer = page.locator('.s2-comp').first();
      const menu = page.locator(sel('s2-model-menu'));
      const quick = page.locator(sel('s2-quickmode-menu'));

      await check(`the page is really ${theme} (seq.theme drives it)`, async () => {
        is(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), theme, 'data-theme');
        const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
        const lum = (bg.match(/\d+/g) ?? []).slice(0, 3).reduce((a, b) => a + Number(b), 0) / 3;
        if (theme === 'light' && lum < 180) throw new Error(`light shots are dark: body ${bg}`);
        if (theme === 'dark' && lum > 90) throw new Error(`dark shots are light: body ${bg}`);
      });

      /* The mode rows' icons: their ink, their background, beside their name's ink. */
      const plainRows = (scope) =>
        page.evaluate((sc) => [...document.querySelectorAll(sc + ' .s2-mi-mode')].map((row) => {
          const ico = row.querySelector('[data-testid="s2-mode-icon"]');
          return {
            icon: getComputedStyle(ico.querySelector('svg')).color,
            text: getComputedStyle(row.querySelector('.s2-mi-name')).color,
            bg: getComputedStyle(ico).backgroundColor,
          };
        }), scope);
      const read = () =>
        page.evaluate(`(() => {
          ${PARSE}
          const cs = (el, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(el)[p]]));
          const q = (id) => document.querySelector('[data-testid="' + id + '"]');
          const bar = q('s2-pillbar');
          const ico = q('s2-mode-trigger').querySelector('[data-testid="s2-mode-icon"]');
          const icoSvg = ico.querySelector('svg');
          const label = q('v3-model-label');
          const brand = q('v3-model-trigger').querySelector('.s2-brand');
          const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, cy: (b.top + b.bottom) / 2 }; };
          return {
            bar: cs(bar, ['borderTopColor', 'backgroundColor', 'color', 'boxShadow']),
            model: cs(q('v3-model-trigger'), ['color', 'backgroundColor']),
            label: cs(label, ['color', 'fontSize']),
            icon: { color: getComputedStyle(icoSvg).color, box: cs(ico, ['backgroundColor', 'boxShadow', 'borderTopColor']) },
            contrast: ratio(parse(getComputedStyle(icoSvg).color), bgOf(bar)),
            divider: document.querySelectorAll('.s2-pill-sep').length,
            geo: { mode: box(icoSvg), brand: box(brand), text: box(label) },
            send: cs(q('composer-send'), ['backgroundColor', 'color', 'boxShadow', 'borderTopColor']),
            plus: cs(q('v3-tools-trigger'), ['color', 'backgroundColor', 'borderTopColor']),
            field: cs(document.querySelector('.s2-ta'), ['color', 'backgroundColor']),
            box: cs(document.querySelector('.s2-comp'), ['borderTopColor', 'backgroundColor']),
            sendHasMode: q('composer-send').hasAttribute('data-mode'),
            plusHasMode: q('v3-tools-trigger').hasAttribute('data-mode'),
          };
        })()`);
      /* The mode icon opens the small menu; picking a row sets the mode and focus returns to the icon. */
      const setMode = async (key) => {
        await modeBtn.click();
        await quick.waitFor();
        await page.locator(sel(`s2-quickmode-${key}`)).click();
        await quick.waitFor({ state: 'detached' });
        await page.waitForTimeout(250);
      };
      await page.locator('.s2-ta').first().fill('hello');
      const seen = {};

      await check(`an old saved teach loads as Plan; the mode icon is the only mode on the chip; the popup holds three modes (${theme})`, async () => {
        is(await modeBtn.getAttribute('data-mode'), 'plan', 'teach loaded as plan');
        is(await modeBtn.getAttribute('aria-label'), 'Mode: Plan', 'mode aria-label');
        is(await page.locator('.s2-pill-mode-w').count(), 0, 'no mode word on the chip');
        is(await page.locator('.s2-pillbar').count(), 1, 'one pill');
        const same = await page.evaluate(() => {
          const bar = document.querySelector('[data-testid="s2-pillbar"]');
          return bar.contains(document.querySelector('[data-testid="s2-mode-trigger"]')) && bar.contains(document.querySelector('[data-testid="v3-model-trigger"]'));
        });
        is(same, true, 'both buttons in the one pill');
        await chip.click();
        await menu.waitFor();
        is(await page.locator('[data-testid^="s2-mode-"][role="menuitemradio"]').count(), 3, 'three modes in the popup');
        is(await page.locator(sel('s2-mode-teach')).count(), 0, 'no teach row');
        is(await page.locator(sel('s2-effort-thumb')).count(), 1, 'the slider is in the popup');
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
      });

      await check(`the small mode menu: three rows, keyboard, Esc returns focus to the icon (${theme})`, async () => {
        await modeBtn.click();
        await quick.waitFor();
        is(await quick.locator('[role="menuitemradio"]').count(), 3, 'three rows');
        const rows = await plainRows('[data-testid="s2-quickmode-menu"]');
        is(rows.length, 3, 'three icons in the small menu');
        for (const r of rows) {
          is(r.icon, r.text, 'small menu: the row icon is the row ink');
          is(r.bg, 'rgba(0, 0, 0, 0)', 'small menu: no circle behind the row icon');
        }
        is(await page.locator(sel('s2-model-menu')).count(), 0, 'the model popup stays shut');
        const smartRow = (await page.locator(sel('s2-quickmode-smart')).textContent()) ?? '';
        if (!smartRow.includes('Edits, asks before commands')) throw new Error(`Smart copy: ${smartRow}`);
        await page.keyboard.press('ArrowDown');
        is(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 's2-quickmode-smart', 'arrow moves');
        await page.keyboard.press('Escape');
        await quick.waitFor({ state: 'detached' });
        is(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 's2-mode-trigger', 'focus back on the icon');
        // keyboard pick: open, arrow, Enter
        await modeBtn.focus();
        await page.keyboard.press('ArrowDown');
        await quick.waitFor();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await quick.waitFor({ state: 'detached' });
        is(await modeBtn.getAttribute('data-mode'), 'smart', 'Enter picked Smart');
        is(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')), 's2-mode-trigger', 'focus back on the icon after a pick');
      });

      for (const key of ['smart', 'plan', 'full']) {
        await setMode(key);
        await quiet();
        seen[key] = await read();
        await composer.screenshot({ path: `${OUT}/chip-send-${key}-${theme}.png` });
        await modeBtn.click();
        await quick.waitFor();
        await page.waitForTimeout(250);
        await page.mouse.move(2, 2);
        const box = await composer.boundingBox();
        await page.screenshot({ path: `${OUT}/modemenu-${key}-${theme}.png`, clip: { x: Math.max(0, box.x), y: Math.max(0, box.y - 190), width: Math.min(720, 1440 - box.x), height: box.height + 200 } });
        await page.keyboard.press('Escape');
        await quick.waitFor({ state: 'detached' });
        await chip.click();
        await menu.waitFor();
        await page.waitForTimeout(400);
        await page.mouse.move(2, 2);
        await page.screenshot({ path: `${OUT}/popup-${key}-${theme}.png` });
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
        await quiet();
      }

      await check(`one plain pill: no divider, no circle, no tint; the mode icon is the model text's ink in every mode (${theme})`, async () => {
        const s = seen.smart;
        const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
        for (const key of ['smart', 'plan', 'full']) {
          const m = seen[key];
          is(m.divider, 0, `${key}: no divider between the mode icon and the model`);
          is(transparent(m.icon.box.backgroundColor), true, `${key}: the icon has no circle (${m.icon.box.backgroundColor})`);
          is(m.icon.box.boxShadow, 'none', `${key}: the icon has no rim`);
          is(m.icon.color, m.label.color, `${key}: the mode icon is the model text's ink`);
          is(m.icon.color, s.icon.color, `${key}: the icon is the same ink as Smart's`);
          for (const part of ['bar', 'model', 'send', 'plus', 'field', 'box']) {
            for (const [prop, val] of Object.entries(s[part])) is(m[part][prop], val, `${key}: ${part}.${prop} equals Smart's`);
          }
          is(m.sendHasMode, false, `${key}: send carries no mode`);
          is(m.plusHasMode, false, `${key}: + carries no mode`);
        }
      });

      await check(`mode icon, provider icon and name share one vertical centre (1px) and even gaps (${theme})`, async () => {
        for (const key of ['smart', 'plan', 'full']) {
          const g = seen[key].geo;
          const off = Math.max(Math.abs(g.mode.cy - g.brand.cy), Math.abs(g.text.cy - g.brand.cy));
          const gap1 = g.brand.l - g.mode.r;
          const gap2 = g.text.l - g.brand.r;
          console.log(`   ${theme} ${key}: centres mode ${g.mode.cy.toFixed(2)} provider ${g.brand.cy.toFixed(2)} text ${g.text.cy.toFixed(2)}; gaps ${gap1.toFixed(2)} / ${gap2.toFixed(2)}`);
          if (!(off <= 1)) throw new Error(`${key}: vertical centres differ by ${off.toFixed(2)}px`);
          if (!(Math.abs(gap1 - gap2) <= 1)) throw new Error(`${key}: gaps ${gap1.toFixed(2)} and ${gap2.toFixed(2)} are not even`);
        }
      });

      await check(`every mode icon holds at least 3:1 against the pill (${theme})`, async () => {
        for (const key of ['smart', 'plan', 'full']) {
          const c = seen[key].contrast;
          if (!(c >= 3)) throw new Error(`${key}: icon vs pill contrast ${c.toFixed(2)} < 3`);
          console.log(`   ${theme} ${key} icon contrast ${c.toFixed(2)}`);
        }
      });

      await check(`the popup's mode rows are plain icons too (${theme})`, async () => {
        await chip.click();
        await menu.waitFor();
        const rows = await plainRows('[data-testid="s2-model-menu"]');
        is(rows.length, 3, 'three mode rows in the popup');
        for (const r of rows) {
          is(r.icon, r.text, 'popup: the row icon is the row ink');
          is(r.bg, 'rgba(0, 0, 0, 0)', 'popup: no circle behind the row icon');
        }
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached' });
      });

      /* Owner 2026-10-08 ("make sure mode descriptions fit on one line instead of wrapping like Smart"):
         every description, in the small menu and in the popup, is one line and is not cut. */
      for (const width of [1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(300);
        for (const where of ['small', 'popup']) {
          await check(`mode descriptions are one uncut line in the ${where} menu at ${width}px (${theme})`, async () => {
            if (where === 'small') {
              await modeBtn.click();
              await quick.waitFor();
            } else {
              await chip.click();
              await menu.waitFor();
            }
            const scope = where === 'small' ? '[data-testid="s2-quickmode-menu"]' : '[data-testid="s2-model-menu"]';
            const rows = await page.evaluate((sc) => [...document.querySelectorAll(sc + ' .s2-mi-mode .s2-mi-note')].map((n) => {
              const cs = getComputedStyle(n);
              const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
              return { text: n.textContent, h: n.getBoundingClientRect().height, lh, cut: n.scrollWidth > n.clientWidth + 1 };
            }), scope);
            is(rows.length, 3, 'three descriptions');
            for (const r of rows) {
              if (!(r.h <= r.lh + 0.5)) throw new Error(`"${r.text}" is ${r.h}px tall (line ${r.lh}px): it wraps`);
              if (r.cut) throw new Error(`"${r.text}" is cut`);
            }
            await page.waitForTimeout(200);
            await page.mouse.move(2, 2);
            if (width === 1024) await page.screenshot({ path: `${OUT}/modedesc-${where}-1024-${theme}.png` });
            await page.keyboard.press('Escape');
            await (where === 'small' ? quick : menu).waitFor({ state: 'detached' });
          });
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });

      await check(`the reasoning slider is a segmented track: aria-valuenow, click, arrows, pointer drag (${theme})`, async () => {
        await chip.click();
        await menu.waitFor();
        const thumb = page.locator(sel('s2-effort-thumb'));
        const now = async () => Number(await thumb.getAttribute('aria-valuenow'));
        await thumb.focus();
        await page.keyboard.press('End');
        const max = Number(await thumb.getAttribute('aria-valuemax'));
        is(await now(), max, 'End goes to the top stop');
        await page.keyboard.press('ArrowLeft');
        is(await now(), max - 1, 'ArrowLeft steps down');
        const track = page.locator(sel('s2-effort-slider'));
        const cells = page.locator('.s2-rt-cell');
        await cells.first().click();
        is(await now(), 0, 'clicking the first segment');
        const a = await cells.first().boundingBox();
        const b = await cells.last().boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(a.x + a.width * 2.5, a.y + a.height / 2, { steps: 6 });
        await page.waitForTimeout(120);
        is(await track.getAttribute('data-dragging'), 'true', 'dragging flag');
        await page.screenshot({ path: `${OUT}/slider-mid-drag-${theme}.png` });
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
        await page.mouse.up();
        is(await now(), max, 'dragging to the last segment');
        const t = await thumb.evaluate((e) => getComputedStyle(e).transitionProperty);
        if (!/transform/.test(t)) throw new Error(`the thumb does not slide: ${t}`);
        await page.keyboard.press('Escape');
      });

      /* Long names: the pill never takes more than half of the composer row; the name ellipsises, the title keeps it whole. */
      for (const width of [1440, 760]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [slug, name] of LONG_NAMES) {
          active = longProfile(name);
          await page.reload();
          await page.waitForSelector(sel('shell'));
          await chip.waitFor({ state: 'visible', timeout: 15000 });
          await page.waitForTimeout(500);
          await check(`"${name}" at ${width}px: the pill is at most half the row, condensed, ellipsised past that, the whole name in the title (${theme})`, async () => {
            const m = await page.evaluate(() => {
              const bar = document.querySelector('[data-testid="s2-pillbar"]');
              const row = document.querySelector('.s2-comp .s2-cb');
              const label = document.querySelector('[data-testid="v3-model-label"]');
              const send = document.querySelector('[data-testid="composer-send"]').getBoundingClientRect();
              return {
                fs: getComputedStyle(label).fontSize,
                bar: bar.getBoundingClientRect().width,
                row: row.getBoundingClientRect().width,
                text: label.textContent,
                clipped: label.scrollWidth > label.clientWidth + 1,
                overflow: getComputedStyle(label).textOverflow,
                title: document.querySelector('[data-testid="v3-model-trigger"]').getAttribute('title'),
                barRight: bar.getBoundingClientRect().right,
                sendLeft: send.left,
              };
            });
            console.log(`   ${theme} ${width}px ${slug}: label "${m.text}", pill ${m.bar.toFixed(0)}px of ${m.row.toFixed(0)}px (${((m.bar / m.row) * 100).toFixed(0)}%)${m.clipped ? ', ellipsised' : ''}`);
            is(m.fs, seen.smart.label.fontSize, `a long name keeps the short name's font size (${slug})`);
            if (m.bar > m.row * 0.5 + 1) throw new Error(`pill ${m.bar}px is over 50% of the row ${m.row}px`);
            if (m.barRight > m.sendLeft) throw new Error('the pill runs into the send cluster');
            is(m.overflow, 'ellipsis', 'text-overflow');
            if (slug === 'unknown' && !m.clipped) throw new Error('the unknown long id was not cut');
            if (slug === 'qwen' && m.text !== 'Qwen 2.5 Coder') throw new Error(`Qwen was not condensed: ${m.text}`);
            if (slug === 'deepseek' && m.clipped) throw new Error(`DeepSeek V4 Flash does not fit whole at ${width}px`);
            if (!(m.title ?? '').includes(slug === 'unknown' ? 'acme-internal' : slug === 'qwen' ? 'Qwen' : 'DeepSeek')) throw new Error(`title lost the name: ${m.title}`);
          });
          await quiet();
          await composer.screenshot({ path: `${OUT}/longname-${slug}-${width}-${theme}.png` });
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  },
  { routes: { '/api/sessions': SESSIONS, '/api/hooks': { declared: {}, trusted: false } } },
);
