#!/usr/bin/env node
/**
 * EVERY POP-UP SHARES ONE STYLE (round 8, item 6).
 *
 * The consistency pass: menus, the toast, confirm dialogs, the takeover,
 * popovers and tooltips share one frame (radius, hairline, fill, shadow,
 * padding) and one inside (row height, type sizes, the key-hint chip). This
 * is the rendered proof, where var() resolves.
 *
 * THE SUBJECT SET IS DERIVED BY OPENING THINGS, NOT LISTED. Every control in
 * the shell that says it opens something (`aria-haspopup`) is pressed in turn,
 * plus the command palette's key and a chat's Delete (the confirm dialog);
 * every element with role menu, dialog, alertdialog or tooltip (and the toast)
 * that appears is collected and measured. The full-screen overlay panels
 * (Settings and the like) are panels, not pop-ups, and are left out by their
 * scrim.
 *
 * CONTROLS: a planted role="menu" on an 8 px radius must be reported
 * (positive); the run must have collected menus AND a dialog (a scan of
 * nothing passes anything).
 */
import { atLeast, is, sel, suite } from './lib/harness.mjs';

async function settle(page) {
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      const end = a.effect?.getComputedTiming?.().endTime;
      if (Number.isFinite(end)) a.finish();
    }
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id, title, h) => ({ id, title, createdAt: at(h), updatedAt: at(h) });
const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [chat('h1', 'Rate limiting for the gateway', 5), chat('h2', 'Orders health check', 4)] },
  scope: 'workspace',
  repos: [],
};

/** Every visible pop-up on the page right now, with its frame and inside measured. Runs in the page. */
function collect() {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const out = [];
  for (const el of document.querySelectorAll('[role="menu"],[role="dialog"],[role="alertdialog"],[role="tooltip"],[data-testid="agent-toast"]')) {
    if (!visible(el) || el.closest('.v3-overlay-scrim')) continue;
    const cs = getComputedStyle(el);
    const rows = [...el.querySelectorAll('.s2-mi, .shell-cmd-item')].filter(visible).map((r) => getComputedStyle(r).minHeight);
    const keys = [...el.querySelectorAll('.s2-kbd')].filter(visible).map((k) => {
      const ks = getComputedStyle(k);
      return `${ks.fontSize}/${ks.borderTopLeftRadius}/${ks.height}`;
    });
    out.push({
      name: `${el.getAttribute('role') ?? 'toast'}:${el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.className}`,
      frame: {
        radius: cs.borderTopLeftRadius,
        border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
        fill: cs.backgroundColor,
        shadow: cs.boxShadow,
        padding: cs.paddingTop,
        fontSize: cs.fontSize,
      },
      rows: [...new Set(rows)],
      keys: [...new Set(keys)],
    });
  }
  return out;
}

const key = (f) => JSON.stringify(f);
/* A modal (the palette, a confirm) sits over board text and keeps the near-opaque
   --float-fill (Decision 45, graphite.css): its fill is the one thing it does not
   share with a glass menu. Same surface colour, more opaque, everything else equal. */
const isModal = (p) => /^(dialog|alertdialog):/.test(p.name);
const alpha = (fill) => {
  const m = /\/\s*([\d.]+)\s*\)$/.exec(fill) ?? /rgba\([^)]*,\s*([\d.]+)\)$/.exec(fill);
  return m ? Number(m[1]) : 1;
};
const rgbOf = (fill) => fill.replace(/\s*\/\s*[\d.]+\s*\)$/, ')');
const sameFrame = (p, ref) => {
  if (!isModal(p)) return key(p.frame) === key(ref.frame);
  const { fill, ...rest } = p.frame;
  const { fill: refFill, ...refRest } = ref.frame;
  return key(rest) === key(refRest) && rgbOf(fill) === rgbOf(refFill) && alpha(fill) >= alpha(refFill);
};

await suite(
  'popovers-share',
  async ({ page, base, check, log }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const fresh = async () => {
      await page.goto(base);
      await page.waitForSelector(sel('shell'));
      await page.locator(sel('s2-session')).first().waitFor({ state: 'visible', timeout: 15000 });
      await settle(page);
    };
    await fresh();

    const seen = new Map();
    const take = async (how) => {
      await settle(page);
      for (const p of await page.evaluate(collect)) {
        if (!seen.has(p.name)) {
          seen.set(p.name, { ...p, how });
          log(`collected ${p.name} (${how})`);
        }
      }
    };
    const close = async () => {
      await page.keyboard.press('Escape');
      await page.mouse.click(1430, 890);
      await settle(page);
    };

    /* The triggers, derived: everything that says it opens something. */
    const triggers = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="shell"] [aria-haspopup]')]
        .filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('.v3-overlay-scrim'))
        .map((b, i) => {
          b.setAttribute('data-pop-trigger', String(i));
          return { i, label: b.getAttribute('aria-label') || b.textContent.trim().slice(0, 30) };
        }),
    );
    log(`${triggers.length} controls say they open something: ${triggers.map((t) => t.label).join(', ')}`);
    atLeast(triggers.length, 3, 'controls with aria-haspopup');
    for (const t of triggers) {
      const b = page.locator(`[data-pop-trigger="${t.i}"]`);
      if (!(await b.count())) continue;
      await b.hover({ force: true }).catch(() => {});
      await b.click({ force: true }).catch(() => {});
      await take(t.label);
      await close();
    }

    /* The command palette's key. */
    await page.keyboard.press('Control+k');
    await take('Ctrl+K');
    await close();

    /* A chat's Delete opens the confirm dialog. */
    await page.locator(sel('s2-session')).nth(1).hover();
    await page.locator(`${sel('s2-session')} .s2-it-more`).nth(1).click({ force: true });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await take('Delete a chat');
    await close();

    const all = [...seen.values()];
    await check('the run opened menus and a dialog', async () => {
      atLeast(all.filter((p) => p.name.startsWith('menu')).length, 2, 'menus collected');
      atLeast(all.filter((p) => /^(dialog|alertdialog)/.test(p.name)).length, 1, 'dialogs collected');
    });

    await check('every pop-up shares one frame', async () => {
      const ref = all.find((p) => p.name.startsWith('menu'));
      log('the frame:', key(ref.frame));
      const off = all.filter((p) => !sameFrame(p, ref)).map((p) => `${p.name}: ${key(p.frame)}`);
      is(off.join(' | '), '', 'pop-ups whose frame differs from the menu');
    });

    await check('every row inside is one height, every key hint one chip', async () => {
      const rows = new Set(all.flatMap((p) => p.rows));
      const keys = new Set(all.flatMap((p) => p.keys));
      log(`row heights: ${[...rows].join(', ')}; key hints: ${[...keys].join(', ')}`);
      atLeast(rows.size, 1, 'row styles seen');
      is(rows.size, 1, 'row heights in use');
      if (keys.size) is(keys.size, 1, 'key-hint styles in use');
    });

    await check('a planted menu on another radius is reported (positive control)', async () => {
      const planted = await page.evaluate((fn) => {
        const m = document.createElement('div');
        m.setAttribute('role', 'menu');
        m.setAttribute('aria-label', 'planted');
        m.className = 's2-menu';
        m.style.cssText = 'position:fixed;left:40px;top:40px;width:120px;height:60px;border-radius:8px';
        document.querySelector('[data-testid="shell"]').appendChild(m);
        // eslint-disable-next-line no-new-func
        const out = new Function(`return (${fn})`)()();
        m.remove();
        return out.find((p) => p.name === 'menu:planted');
      }, collect.toString());
      const ref = all.find((p) => p.name.startsWith('menu'));
      is(Boolean(planted), true, 'the planted menu was collected');
      is(key(planted.frame) === key(ref.frame), false, 'the planted menu differs');
    });
  },
  { routes: { '/api/sessions': SESSIONS } },
);
