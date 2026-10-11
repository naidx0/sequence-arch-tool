#!/usr/bin/env node
/**
 * Round 11, lane "look": the surface bar's three states with three surfaces
 * open (sidebar open, 1440x900), the two-surface cap at 1024, the static ASCII
 * background (empty chat vs under surfaces), the Files header, loading, refusal
 * and empty states, New chat across every accent, and the status bar and the
 * closed pill label measured on the REAL rendered pixels (text hidden, then
 * compared), not on the ink tokens against the raw backdrop. Dark and light.
 * Round 11, round 2 adds: the unset accent is blue, every accent paints the surface-bar
 * indicator, a selected sidebar row and a toggle; the backdrop is half as bright; the cards sit
 * 8 px apart with no shadow over a neighbour (pixels); the status bar's model icon and context
 * ring (hovered); the light room is cream. Shots go to $SHOTS (default /mnt/project-files/sequence/cloud-pass/shots/r11/look).
 */
import fs from 'node:fs';
import { is, sel, settle, suite } from './lib/harness.mjs';

const OUT = process.env.SHOTS ?? '/mnt/project-files/sequence/cloud-pass/shots/r11/look';
fs.mkdirSync(OUT, { recursive: true });

/** Every selectable accent (accentPreference.ts), white and blue included, plus the default. */
const ACCENTS = ['default', 'gold', 'white', 'blue', 'violet', 'green', 'rose', 'graphite'];

const clipOf = async (locator, pad = 10) => {
  const b = await locator.boundingBox();
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
};

const EMPTY_TREE = { path: '', name: 'workspace', type: 'dir', children: [] };
/* A configured model with a published window, so the bar has a model and the ring has a denominator. */
const AI_CONFIG = { configured: true, provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: '••••9f3a', contextWindow: 1_000_000 };
/* behind-chat backdrop brightness above the ground before round 2 (opacity .26, saturate .6): the bar to halve. */
const BASE_LIFT = 0.0653;

/** RGB of single pixels, read from one screenshot of a thin strip. */
async function pixels(page, points) {
  const xs = points.map((p) => p[0]);
  const y = points[0][1];
  const x0 = Math.floor(Math.min(...xs));
  const w = Math.ceil(Math.max(...xs)) - x0 + 1;
  const png = (await page.screenshot({ clip: { x: x0, y: Math.floor(y), width: w, height: 1 } })).toString('base64');
  return page.evaluate(
    async ({ png, x0, points }) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = `data:image/png;base64,${png}`;
      });
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return points.map(([x]) => [...g.getImageData(Math.floor(x) - x0, 0, 1, 1).data].slice(0, 3));
    },
    { png, x0, points },
  );
}
const lumOf = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

async function boot(page, base, theme, accent = 'default') {
  await page.goto(base);
  await page.evaluate(
    ([t, a]) => {
      try {
        localStorage.setItem('theme', t);
        localStorage.setItem('seq.theme', t);
        /* The sidebar open (layoutPrefs SIDEBAR_KEY: '0' is unfolded). */
        localStorage.setItem('v3.railCollapsed', '0');
        if (a === 'default') localStorage.removeItem('sequence.accent');
        else localStorage.setItem('sequence.accent', a);
      } catch {}
    },
    [theme, accent],
  );
  /* Reload so the pre-paint script and the stored layout apply exactly as for a person.
     The default is NO stored accent and the real pre-paint script decides (it must say blue). */
  await page.reload();
  await page.waitForSelector(sel('shell'));
  await page.waitForTimeout(500);
}

/** The workspace tree the engine answers in this run: an empty folder, or a refusal. */
async function serveTree(page, status, body) {
  await page.unroute('**/api/tree').catch(() => {});
  await page.route('**/api/tree', (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }));
}

async function closeAll(page) {
  for (let i = 0; i < 6; i++) {
    const x = page.locator('[data-testid^="v3-tab-close-"]').first();
    if (!(await x.count())) break;
    await x.click();
    await page.waitForTimeout(120);
  }
}

/** Worst-case contrast of the ink tokens over the drawn backdrop (opacity applied) on the app ground. */
async function backdropContrast(page) {
  return page.evaluate(() => {
    const rgb = (s) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const probe = (prop, value) => {
      const d = document.createElement('div');
      d.style[prop] = value;
      document.body.appendChild(d);
      const c = getComputedStyle(d)[prop];
      d.remove();
      return rgb(c);
    };
    const lin = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const ratio = (a, b) => {
      const [hi, lo] = lum(a) > lum(b) ? [a, b] : [b, a];
      return (lum(hi) + 0.05) / (lum(lo) + 0.05);
    };
    const bd = document.querySelector('[data-testid="s2-ascii-backdrop"]');
    const canvas = bd?.querySelector('canvas');
    if (!bd || !canvas || bd.getAttribute('data-drawn') !== 'true') return { drawn: false };
    const op = Number(getComputedStyle(bd).opacity);
    const ground = probe('backgroundColor', getComputedStyle(document.querySelector('.s2-app')).backgroundColor);
    const bg = probe('color', getComputedStyle(document.querySelector('.s2')).getPropertyValue('--b-bg') || 'rgb(0,0,0)');
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const inks = { ink1: probe('color', 'var(--ink-1)'), ink2: probe('color', 'var(--ink-2)'), ink3: probe('color', 'var(--ink-3)') };
    const worst = { ink1: Infinity, ink2: Infinity, ink3: Infinity };
    let lumMax = 0;
    const filt = getComputedStyle(canvas).filter;
    const sat = Number((/saturate\(([\d.]+)\)/.exec(filt) ?? [])[1] ?? 1);
    for (let i = 0; i < data.length; i += 4 * 7) {
      const a = (data[i + 3] / 255) * op;
      const raw = [data[i], data[i + 1], data[i + 2]];
      const l = 0.2126 * raw[0] + 0.7152 * raw[1] + 0.0722 * raw[2];
      const sx = raw.map((v) => l + (v - l) * sat);
      const px = [0, 1, 2].map((k) => ground[k] * (1 - a) + sx[k] * a);
      lumMax = Math.max(lumMax, lum(px));
      for (const k of Object.keys(inks)) worst[k] = Math.min(worst[k], ratio(inks[k], px));
    }
    return { drawn: true, opacity: op, mode: bd.getAttribute('data-mode'), worst, ground, bg, lift: lumMax - lum(ground), lumMax };
  });
}

/**
 * The contrast of a label as it PAINTS: screenshot it with its text, then with
 * the text made transparent, and compare the two. Pixels that differ are ink;
 * the ink is the differing pixel furthest from the background, and the
 * background is the hidden-text shot's luminance (median, and the 10th and 90th
 * percentiles for the worst case). Anti-aliasing can only lower the measured
 * peak, so a pass here is a pass for the real ink too.
 */
async function renderedInk(page, css) {
  const loc = page.locator(css).first();
  const b = await loc.boundingBox();
  const pad = 2;
  const clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  const visible = (await page.screenshot({ clip })).toString('base64');
  await page.evaluate((c) => {
    document.querySelector(c)?.setAttribute('data-r11-hide', '');
    const st = document.createElement('style');
    st.id = 'r11-hide-style';
    st.textContent = '[data-r11-hide], [data-r11-hide] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }';
    document.head.appendChild(st);
  }, css);
  await page.waitForTimeout(150);
  const hidden = (await page.screenshot({ clip })).toString('base64');
  await page.evaluate(() => {
    document.getElementById('r11-hide-style')?.remove();
    document.querySelector('[data-r11-hide]')?.removeAttribute('data-r11-hide');
  });
  return page.evaluate(
    async ({ visible, hidden }) => {
      const load = (d) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = `data:image/png;base64,${d}`;
        });
      const [a, h] = [await load(visible), await load(hidden)];
      const grab = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, c.width, c.height).data;
      };
      const pa = grab(a);
      const ph = grab(h);
      const lin = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      const L = (i, d) => 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
      const bgs = [];
      for (let i = 0; i < ph.length; i += 4) bgs.push(L(i, ph));
      bgs.sort((x, y) => x - y);
      const pct = (q) => bgs[Math.min(bgs.length - 1, Math.floor(q * bgs.length))];
      const median = pct(0.5);
      let ink = null;
      let inkLum = median;
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.abs(pa[i] - ph[i]) + Math.abs(pa[i + 1] - ph[i + 1]) + Math.abs(pa[i + 2] - ph[i + 2]);
        if (d < 24) continue;
        const l = L(i, pa);
        if (ink === null || Math.abs(l - median) > Math.abs(inkLum - median)) {
          inkLum = l;
          ink = [pa[i], pa[i + 1], pa[i + 2]];
        }
      }
      if (ink === null) return { ink: null };
      const ratio = (x, y) => {
        const [hi, lo] = x > y ? [x, y] : [y, x];
        return (hi + 0.05) / (lo + 0.05);
      };
      /* The worst background is the one nearest the ink in luminance: the 10th
         percentile when the ink is lighter, the 90th when it is darker. */
      const worstBg = inkLum > median ? pct(0.9) : pct(0.1);
      return {
        ink,
        inkLum,
        median: ratio(inkLum, median),
        worst: ratio(inkLum, worstBg),
        p10: pct(0.1),
        p90: pct(0.9),
      };
    },
    { visible, hidden },
  );
}

await suite(
  'r11-look-shots',
  async ({ page, base, check, log }) => {
    const rendered = {};
    /* An empty folder for the shots: this static run has no engine behind /api/tree. */
    await serveTree(page, 200, EMPTY_TREE);
    const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
    await page.route('**/api/sessions', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ index: { version: 1, activeId: 'h1', sessions: [{ id: 'h1', title: 'Rate limiting for the gateway', createdAt: at(5), updatedAt: at(5) }] }, scope: 'workspace', repos: [] }) }));
    await page.route('**/api/ai-config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AI_CONFIG) }));
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await boot(page, base, theme);

      // 1. empty chat: the ASCII ground is visible
      await closeAll(page);
      await settle(page);
      await page.waitForSelector('[data-testid="s2-ascii-backdrop"][data-drawn="true"]', { timeout: 15000 });
      await page.waitForTimeout(500);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${OUT}/empty-chat-background-${theme}.png` });
      const empty = await backdropContrast(page);
      const emptyStatus = await renderedInk(page, '[data-testid="s2-status-workspace"]');
      log(theme, 'empty chat', JSON.stringify(empty));
      log(theme, 'empty status label (rendered)', JSON.stringify(emptyStatus));
      await check(`${theme}: the background is drawn behind the empty chat`, async () => {
        if (!empty.drawn) throw new Error('backdrop not drawn');
        is(empty.mode, 'behind-chat', 'mode');
      });
      await check(`${theme}: body text over the empty-chat background stays >= 4.5:1 (ink-1, ink-2)`, async () => {
        if (empty.worst.ink1 < 4.5 || empty.worst.ink2 < 4.5) throw new Error(`ink1 ${empty.worst.ink1.toFixed(2)} ink2 ${empty.worst.ink2.toFixed(2)}`);
      });
      await check(`${theme}: the background behind the chat is at most half as bright as before (lift ${empty.lift?.toFixed(4)} vs ${BASE_LIFT})`, async () => {
        if (theme === 'dark' && !(empty.lift <= BASE_LIFT / 2)) throw new Error(`lift ${empty.lift} > ${BASE_LIFT / 2}`);
        if (!(empty.lift < BASE_LIFT)) throw new Error(`lift ${empty.lift}`);
      });
      await check(`${theme}: the status bar label paints at >= 4.5:1 over the empty-chat background`, async () => {
        if (!emptyStatus.ink) throw new Error('no ink found in the status label');
        if (emptyStatus.median < 4.5) throw new Error(`median ${emptyStatus.median.toFixed(2)} worst ${emptyStatus.worst.toFixed(2)}`);
      });

      // 2. three surfaces open, files focused, the sidebar open (three boards plus the sidebar need ~1960 px; below that the layout folds it)
      await page.setViewportSize({ width: 1960, height: 1000 });
      await settle(page);
      await page.locator(sel('s2-tab-architecture')).click();
      await page.locator(sel('s2-tab-terminal')).click();
      await page.locator(sel('s2-tab-files')).click();
      await settle(page);
      await page.waitForTimeout(2800);
      const states = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.s2-sp')].map((e) => [e.getAttribute('data-pill'), e.getAttribute('data-state')])));
      log(theme, 'bar states', JSON.stringify(states));
      await check(`${theme}: the bar shows focused, open and closed`, async () => {
        is(states.files, 'focused', 'files');
        is(states.architecture, 'open', 'architecture');
        is(states.terminal, 'open', 'terminal');
        if (!Object.values(states).includes('closed')) throw new Error('no closed pill to compare');
      });
      await check(`${theme}: focused is outlined, open is tinted, closed is a quieter text step (computed)`, async () => {
        const r = await page.evaluate(() => {
          const pill = (id) => document.querySelector(`.s2-sp[data-pill="${id}"]`);
          const closedEl = document.querySelector('.s2-sp[data-state="closed"]');
          const ind = getComputedStyle(document.querySelector('.s2-sp-ind'));
          return {
            indWidth: ind.borderTopWidth,
            openBg: getComputedStyle(pill('architecture')).backgroundColor,
            openColor: getComputedStyle(pill('architecture').querySelector('.s2-seg-l')).color,
            closedColor: getComputedStyle(closedEl.querySelector('.s2-seg-l')).color,
            closedOpacity: getComputedStyle(closedEl).opacity,
            openDot: !!pill('architecture').querySelector('.s2-sp-dot'),
            closedDot: !!closedEl.querySelector('.s2-sp-dot'),
          };
        });
        log(theme, JSON.stringify(r));
        if (r.openBg === 'rgba(0, 0, 0, 0)') throw new Error('open pill has no tint');
        if (r.closedOpacity !== '1') throw new Error(`closed pill is dimmed by opacity (${r.closedOpacity}); use a text step`);
        if (r.closedColor === r.openColor) throw new Error('closed and open labels are the same colour');
        if (!r.openDot || r.closedDot) throw new Error('dot placement');
        if (r.indWidth === '0px') throw new Error('focused pill has no outline');
      });
      const closedInk = await renderedInk(page, '.s2-sp[data-state="closed"] .s2-seg-l');
      log(theme, 'closed pill label (rendered)', JSON.stringify(closedInk));
      await check(`${theme}: the closed pill label paints at >= 4.5:1 on the bar`, async () => {
        if (!closedInk.ink) throw new Error('no ink found in the closed label');
        if (closedInk.median < 4.5) throw new Error(`median ${closedInk.median.toFixed(2)} worst ${closedInk.worst.toFixed(2)}`);
      });
      const bar = page.locator(sel('s2-surfaces'));
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${OUT}/three-surfaces-${theme}.png` });
      await page.screenshot({ path: `${OUT}/surface-bar-crop-${theme}.png`, clip: await clipOf(bar, 14) });
      /* the sidebar is open, as the owner has it */
      await check(`${theme}: the sidebar is open for the three-surface shot`, async () => {
        if (!(await page.locator(sel('v3-rail-settings')).isVisible())) throw new Error('sidebar closed');
      });
      /* even gaps: chat to stage and between surfaces are all the same 8 px */
      const rects = await page.evaluate(() => {
        const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
        return { chat: r(document.querySelector('.s2-chat')), panes: [...document.querySelectorAll('.s2-stage > .s2-pane')].map(r) };
      });
      log(theme, 'rects', JSON.stringify(rects));
      const gaps = [rects.panes[0].l - rects.chat.r, ...rects.panes.slice(1).map((p, i) => p.l - rects.panes[i].r)];
      log(theme, 'gaps chat-surface and surface-surface', JSON.stringify(gaps));
      await check(`${theme}: the gaps between surfaces equal the chat-surface gap (8 px)`, async () => {
        if (rects.panes.length < 3) throw new Error(`only ${rects.panes.length} panes`);
        for (const g of gaps) if (Math.abs(g - 8) > 0.6) throw new Error(`gaps ${JSON.stringify(gaps)}`);
      });
      /* pixels: no card's shadow paints over a neighbour. Sample a neighbour's inner edge against its interior. */
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
      const yE = Math.round(rects.panes[0].b - 120);
      const probes = [
        ['chat right edge (Files shadow)', rects.chat.r - 4, rects.chat.r - 30, Math.round(rects.chat.t + 300)],
        ['Files left edge (chat shadow)', rects.panes[0].l + 4, rects.panes[0].l + 30, yE],
        ['Terminal left edge (Architecture shadow)', rects.panes[2].l + 4, rects.panes[2].l + 30, yE],
        ['Architecture right edge, below its dots', rects.panes[1].r - 4, rects.panes[1].r - 30, Math.round(rects.panes[1].t + 50)],
      ];
      const shadowRows = [];
      for (const [name, edgeX, innerX, y] of probes) {
        const [edge, inner] = await pixels(page, [[edgeX, y], [innerX, y]]);
        shadowRows.push({ name, edge, inner, delta: Math.abs(lumOf(edge) - lumOf(inner)) });
      }
      log(theme, 'neighbour edge pixels', JSON.stringify(shadowRows));
      await check(`${theme}: no surface shadow paints over a neighbour (edge vs interior pixels differ by <= 3 levels)`, async () => {
        for (const row of shadowRows.slice(0, 3)) if (row.delta > 3) throw new Error(JSON.stringify(row));
      });
      /* the big floating pill keeps a dark casting shadow on the ground (dark theme) */
      const pillBox = await page.locator(sel('s2-surfaces')).boundingBox();
      const yP = Math.round(pillBox.y + pillBox.height + 3);
      const near = await pixels(page, [[pillBox.x + pillBox.width / 2, yP], [pillBox.x + pillBox.width / 2 + 40, yP]]);
      const far = await pixels(page, [[pillBox.x + pillBox.width + 120, yP], [pillBox.x + pillBox.width + 160, yP]]);
      const pill = { under: lumOf(near[0]), under2: lumOf(near[1]), ground: lumOf(far[0]) };
      log(theme, 'pill shadow (luma below pill vs open ground)', JSON.stringify(pill));
      await check(`${theme}: the surface-bar pill casts a dark shadow on the ground`, async () => {
        if (theme === 'dark' && !(pill.under < pill.ground - 1.5)) throw new Error(JSON.stringify(pill));
        if (theme === 'light' && !(pill.under < pill.ground - 1)) throw new Error(JSON.stringify(pill));
      });
      /* the status bar: [state] | [icon + nickname] | [ring] | [workspace] */
      const sbar = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="s2-status"]');
        const words = bar.cloneNode(true);
        words.querySelectorAll('svg').forEach((n) => n.remove());
        const at = (id) => bar.querySelector(`[data-testid="${id}"]`);
        const order = ['s2-status-state', 's2-status-model', 's2-status-context', 's2-status-workspace'].map((id) => at(id));
        const pos = order.map((el) => (el ? el.getBoundingClientRect().left : null));
        return { text: words.textContent.replace(/\s+/g, ' ').trim(), model: at('s2-status-model')?.textContent, provider: at('s2-status-agent')?.getAttribute('data-provider'), hasIconSvg: !!at('s2-status-agent')?.querySelector('svg, span'), ring: !!at('s2-status-context')?.querySelector('button'), pos };
      });
      log(theme, 'status bar', JSON.stringify(sbar));
      await check(`${theme}: the status bar shows the model's icon and nickname, no "Claude", then the ring, then the workspace`, async () => {
        is(sbar.model, 'Sonnet 5.5', 'nickname');
        is(sbar.provider, 'claude', 'icon');
        if (!sbar.hasIconSvg) throw new Error('no icon');
        if (/Claude/.test(sbar.text)) throw new Error(sbar.text);
        if (!sbar.ring) throw new Error('no ring');
        if (sbar.pos.some((x) => x === null) || sbar.pos.some((x, i) => i && x <= sbar.pos[i - 1])) throw new Error(`order ${JSON.stringify(sbar.pos)}`);
      });
      const ringBtn = page.locator('[data-testid="s2-status-context"] button').first();
      await ringBtn.hover();
      await page.waitForSelector('[data-testid="s2-status-context"] [data-testid="composer-context-breakdown"]', { timeout: 4000 });
      await page.waitForTimeout(250);
      const pop = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="s2-status-context"] [data-testid="composer-context-breakdown"]');
        const b = el.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + 12);
        return { text: el.textContent.replace(/\s+/g, ' ').trim(), box: { x: b.x, y: b.y, w: b.width, h: b.height }, vw: innerWidth, onTop: el.contains(top) };
      });
      log(theme, 'ring popover', JSON.stringify(pop));
      await page.screenshot({ path: `${OUT}/status-bar-context-hover-${theme}.png`, clip: { x: 0, y: Math.max(0, pop.box.y - 24), width: 1000, height: page.viewportSize().height - Math.max(0, pop.box.y - 24) } });
      await check(`${theme}: hovering the ring opens the breakdown (used / window, input, output, cache), whole and on top`, async () => {
        if (!/1M/.test(pop.text) || !/Input/.test(pop.text) || !/Output/.test(pop.text) || !/Cache/.test(pop.text)) throw new Error(pop.text);
        if (!/—/.test(pop.text)) throw new Error(`no dash for unknowns: ${pop.text}`);
        if (pop.box.x < 0 || pop.box.y < 0 || pop.box.x + pop.box.w > pop.vw) throw new Error(JSON.stringify(pop.box));
        if (!pop.onTop) throw new Error('popover is covered');
      });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
      await ringBtn.focus();
      await check(`${theme}: the ring is keyboard focusable and focus opens the same breakdown`, async () => {
        await page.waitForSelector('[data-testid="s2-status-context"] [data-testid="composer-context-breakdown"]', { timeout: 3000 });
      });
      await page.keyboard.press('Tab');
      await page.mouse.move(0, 0);
      const under = await backdropContrast(page);
      const underStatus = await renderedInk(page, '[data-testid="s2-status-workspace"]');
      log(theme, 'under surfaces', JSON.stringify(under));
      log(theme, 'under status label (rendered)', JSON.stringify(underStatus));
      await check(`${theme}: the background is still there under surfaces, dimmer than behind the chat`, async () => {
        if (!under.drawn) throw new Error('backdrop gone');
        is(under.mode, 'under', 'mode');
        if (!(under.opacity < empty.opacity)) throw new Error(`under ${under.opacity} vs empty ${empty.opacity}`);
      });
      await check(`${theme}: body text over the under-surface background stays >= 4.5:1`, async () => {
        if (under.worst.ink1 < 4.5 || under.worst.ink2 < 4.5) throw new Error(`ink1 ${under.worst.ink1.toFixed(2)} ink2 ${under.worst.ink2.toFixed(2)}`);
      });
      await check(`${theme}: the status bar label paints at >= 4.5:1 under the surfaces`, async () => {
        if (!underStatus.ink) throw new Error('no ink found in the status label');
        if (underStatus.median < 4.5) throw new Error(`median ${underStatus.median.toFixed(2)} worst ${underStatus.worst.toFixed(2)}`);
      });
      rendered[theme] = { emptyStatus, underStatus, closedInk };
      await page.screenshot({ path: `${OUT}/files-header-${theme}.png`, clip: await clipOf(page.locator('[data-surface-pane="files"]').first(), 4) });

      // 2b. narrow window: the stage holds two at 1024, a third retires the oldest
      await page.setViewportSize({ width: 1024, height: 768 });
      await boot(page, base, theme);
      await closeAll(page);
      await page.locator(sel('s2-tab-architecture')).click();
      await page.locator(sel('s2-tab-terminal')).click();
      await page.locator(sel('s2-tab-files')).click();
      await settle(page);
      await page.waitForTimeout(2800);
      const narrowOpen = await page.evaluate(() => [...document.querySelectorAll('.s2-sp')].filter((e) => e.getAttribute('data-state') !== 'closed').map((e) => e.getAttribute('data-pill')));
      log(theme, 'open at 1024', JSON.stringify(narrowOpen));
      await check(`${theme}: at 1024 the stage holds two surfaces, the oldest retired`, async () => {
        is(narrowOpen.length, 2, 'open surfaces');
        if (narrowOpen.includes('architecture')) throw new Error(`oldest still open: ${narrowOpen}`);
      });
      await page.mouse.move(0, 0);
      await page.screenshot({ path: `${OUT}/three-surfaces-1024-${theme}.png` });
      await page.setViewportSize({ width: 1440, height: 900 });
      await settle(page);

      // 3. files: loading, refusal with a retry, and the empty folder
      await serveTree(page, 409, { error: 'no workspace available — attach a repository or fix home permissions' });
      await boot(page, base, theme);
      await page.locator(sel('s2-tab-files')).click();
      await settle(page);
      await page.waitForTimeout(900);
      await check(`${theme}: a refused folder says why, once, with a Retry`, async () => {
        const text = (await page.locator(sel('connected-files-unattached')).first().textContent()) ?? '';
        if (!/Files are unavailable: no workspace available/.test(text)) throw new Error(`text: ${text}`);
        if (/No files yet/.test(text)) throw new Error('refusal says "No files yet."');
        if (!(await page.locator(sel('connected-files-retry')).count())) throw new Error('no Retry');
      });
      await serveTree(page, 200, EMPTY_TREE);
      await page.locator(sel('connected-files-retry')).click();
      await page.waitForTimeout(900);
      await boot(page, base, theme);
      await page.locator(sel('s2-tab-files')).click();
      await settle(page);
      await page.waitForTimeout(900);
      await check(`${theme}: Files header names the repo, no path line, and an empty folder is one line`, async () => {
        if (await page.locator(sel('connected-files-path')).count()) throw new Error('the root path line is back');
        const shown = await page.locator('[data-surface-pane="files"]').first().innerText();
        if (shown.includes('.sequence/workspace')) throw new Error('workspace path shown');
        const bare = await page.locator('.files-scope.is-bare').count();
        const textLen = await page.evaluate(() => document.querySelector('[data-surface-pane="files"]')?.innerText.replace(/\s+/g, ' ').trim().length ?? 0);
        log(theme, 'files pane text', textLen, 'bare', bare);
        if (!bare) throw new Error('not bare');
        if (/Local workspace at|engine could not/.test(await page.content())) throw new Error('old error text present');
      });
      await page.screenshot({ path: `${OUT}/files-empty-${theme}.png`, clip: await clipOf(page.locator('[data-surface-pane="files"]').first(), 4) });

      // 4. New chat across accents
      const bgs = {};
      const labels = {};
      for (const accent of ACCENTS) {
        await boot(page, base, theme, accent);
        await closeAll(page);
        await page.waitForSelector(sel('s2-new-chat'));
        await page.waitForTimeout(600);
        const b = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="s2-new-chat"]');
          const cs = getComputedStyle(el);
          return { bg: cs.backgroundColor, color: cs.color };
        });
        bgs[accent] = b.bg;
        labels[accent] = b.color;
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${OUT}/new-chat-${accent}-${theme}.png` });
      }
      log(theme, 'new chat bg per accent', JSON.stringify(bgs));
      log(theme, 'new chat label per accent', JSON.stringify(labels));
      await check(`${theme}: New chat is the same neutral under every accent (white and blue included)`, async () => {
        const set = new Set(Object.values(bgs));
        if (set.size !== 1) throw new Error(JSON.stringify(bgs));
        const labelSet = new Set(Object.values(labels));
        if (labelSet.size !== 1) throw new Error(`label: ${JSON.stringify(labels)}`);
        if (theme === 'dark') {
          const [r, g, b] = [...set][0].match(/\d+/g).map(Number);
          if (Math.min(r, g, b) < 200 || Math.max(r, g, b) - Math.min(r, g, b) > 24) throw new Error(`not white: ${[...set][0]}`);
        }
      });

      // 5. accent audit: every accent-bearing element, sampled with three surfaces open
      await page.setViewportSize({ width: 1960, height: 1000 });
      const audit = {};
      for (const accent of ACCENTS) {
        await boot(page, base, theme, accent);
        await closeAll(page);
        await page.locator(sel('s2-tab-architecture')).click();
        await page.locator(sel('s2-tab-terminal')).click();
        await page.locator(sel('s2-tab-files')).click();
        await settle(page);
        await page.waitForTimeout(900);
        audit[accent] = await page.evaluate(() => {
          const pick = (q, props) => {
            const el = document.querySelector(q);
            if (!el) return null;
            const cs = getComputedStyle(el);
            return props.map((p) => cs[p]).join(' | ');
          };
          return {
            attr: document.documentElement.getAttribute('data-accent'),
            send: pick('.s2-send', ['backgroundColor', 'color']),
            composerFocus: pick('[data-testid="composer-field"]', ['caretColor', 'borderTopColor']),
            focusedPillIcon: pick('.s2-sp.is-focused .s2-sp-main > svg', ['color']),
            indicator: pick('.s2-sp-ind', ['borderTopColor', 'backgroundColor']),
            openPillTint: pick('.s2-sp.is-on', ['backgroundColor']),
            dot: pick('.s2-sp-dot', ['backgroundColor']),
            selectedRow: pick('.s2-rail-row.is-on', ['backgroundColor']),
            accentVar: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
            newChat: pick('[data-testid="s2-new-chat"]', ['backgroundColor', 'color']),
          };
        });
        if (accent === 'default' || accent === 'rose') {
          await page.mouse.move(0, 0);
          await page.screenshot({ path: `${OUT}/${accent === 'default' ? 'accent-blue-default' : 'accent-rose'}-${theme}.png` });
        }
      }
      // the toggle lives in Settings: click each accent there and sample a switched-on toggle
      const toggles = {};
      await boot(page, base, theme, 'default');
      await closeAll(page);
      await page.setViewportSize({ width: 1440, height: 900 });
      await settle(page);
      await page.locator(sel('v3-rail-settings')).click({ timeout: 8000 });
      await page.waitForSelector(sel('settings-panel'), { timeout: 10000 });
      await page.locator(sel('settings-nav-app')).click().catch(() => undefined);
      await page.locator(sel('settings-accent')).first().waitFor({ timeout: 15000 });
      toggles.default = await page.evaluate(() => {
        const el = document.querySelector('.sb-switch:checked');
        return el ? getComputedStyle(el).backgroundColor : null;
      });
      for (const accent of ACCENTS.filter((a) => a !== 'default')) {
        await page.locator(`[data-accent-choice="${accent}"]`).click();
        await page.waitForTimeout(250);
        toggles[accent] = await page.evaluate(() => {
          const el = document.querySelector('.sb-switch:checked');
          return el ? getComputedStyle(el).backgroundColor : null;
        });
      }
      await page.locator(sel('settings-accent')).first().scrollIntoViewIfNeeded();
      await page.mouse.move(0, 0);
      for (const [a, row] of Object.entries(audit)) row.toggle = toggles[a];
      fs.writeFileSync(`${OUT}/accent-audit-${theme}.json`, JSON.stringify(audit, null, 2));
      const REAL = ACCENTS.filter((a) => a !== 'default');
      await check(`${theme}: an unset accent is blue (default equals blue everywhere, differs from gold)`, async () => {
        if (audit.default.attr !== 'blue') throw new Error(`default attr ${audit.default.attr}`);
        for (const k of Object.keys(audit.blue)) if (k !== 'attr' && audit.default[k] !== audit.blue[k]) throw new Error(`${k}: default ${audit.default[k]} vs blue ${audit.blue[k]}`);
        const want = theme === 'dark' ? '#5B9BFF' : '#2F52B5';
        if (audit.default.accentVar.toLowerCase() !== want.toLowerCase()) throw new Error(`accent ${audit.default.accentVar}`);
        for (const k of ['indicator', 'openPillTint', 'dot', 'selectedRow', 'toggle']) if (audit.default[k] === audit.gold[k]) throw new Error(`${k} is gold in the default`);
      });
      await check(`${theme}: the surface-bar indicator, open tint, dot, a selected sidebar row and a toggle each follow all ${REAL.length} accents`, async () => {
        for (const k of ['indicator', 'openPillTint', 'dot', 'selectedRow', 'toggle']) {
          const vals = REAL.map((a) => audit[a][k]);
          if (vals.some((v) => v === null || v === undefined)) throw new Error(`${k} not found for ${REAL.filter((a, i) => vals[i] == null)}`);
          if (new Set(vals).size !== REAL.length) throw new Error(`${k} is not distinct per accent: ${JSON.stringify(Object.fromEntries(REAL.map((a) => [a, audit[a][k]])))}`);
        }
      });
      await check(`${theme}: New chat stays the same neutral in every accent`, async () => {
        const nc = new Set(Object.values(audit).map((row) => row.newChat));
        if (nc.size !== 1) throw new Error(`New chat differs: ${JSON.stringify([...nc])}`);
      });

      // 6. light room: cream, and the text on it holds 4.5:1
      if (theme === 'light') {
        await page.setViewportSize({ width: 1440, height: 900 });
        await boot(page, base, theme);
        await closeAll(page);
        await page.mouse.move(0, 0);
        await page.screenshot({ path: `${OUT}/light-cream-overview.png` });
        const cream = await page.evaluate(() => {
          const rgb = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map(Number); return c.startsWith('color(') ? v.map((x) => Math.round(x * 255)) : v; };
          const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
          const L = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
          const ratio = (a, b) => { const [h, l] = L(a) > L(b) ? [a, b] : [b, a]; return (L(h) + 0.05) / (L(l) + 0.05); };
          const bg = rgb(getComputedStyle(document.querySelector('.s2-chat')).backgroundColor);
          const ground = rgb(getComputedStyle(document.querySelector('.s2-app')).backgroundColor);
          const css = getComputedStyle(document.documentElement);
          const ink = (n) => { const d = document.createElement('i'); d.style.color = css.getPropertyValue(n); document.body.appendChild(d); const c = rgb(getComputedStyle(d).color); d.remove(); return c; };
          return { bg, ground, warm: bg[0] - bg[2], ink1: ratio(ink('--ink-1'), bg), ink2: ratio(ink('--ink-2'), bg), ink3: ratio(ink('--ink-3'), bg), accentInk: ratio(ink('--accent-ink'), bg) };
        });
        log('light cream', JSON.stringify(cream));
        await check('light: the room is cream (warm, not white) and its text holds >= 4.5:1', async () => {
          if (cream.warm < 8) throw new Error(`not cream enough: ${JSON.stringify(cream.bg)}`);
          for (const k of ['ink1', 'ink2', 'ink3', 'accentInk']) if (cream[k] < 4.5) throw new Error(`${k} ${cream[k].toFixed(2)}`);
        });
      }
    }
    log('rendered ink', JSON.stringify(rendered));
  },
  { routes: {} },
);
