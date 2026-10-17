#!/usr/bin/env node
/**
 * EVERY ICON SITS IN THE MIDDLE OF ITS BUTTON (round 7, B7).
 *
 * Jaden, on the installed app: "Make sure all the buttons spacing is unique
 * and uniform throughout... Make sure the icons are fixed as well in terms of
 * the surfaces when they're minimized." Off-centre glyphs are a layout fact,
 * which jsdom cannot measure, so this is the e2e tier.
 *
 * THE SUBJECT SET IS DERIVED, NOT LISTED: every visible button in the shell
 * whose only visible content is one glyph (lib/iconCentre.mjs). The scan runs
 * in four shell states (one surface; two; Terminal with its x; no surface,
 * where the pills fold to icons), at 1440 and at 1024, with the desktop
 * window buttons drawn. A glyph's box centre must be within 0.5 px of its
 * button's on both axes.
 *
 * CONTROLS: a planted button whose glyph is pushed 3 px off must be reported
 * (positive); every state must have measured a real number of buttons (a
 * scan that measured nothing would pass anything).
 */
import { scanIconCentres } from './lib/iconCentre.mjs';
import { atLeast, is, sel, settle, suite } from './lib/harness.mjs';

const TOL = 0.5;

await suite('icons-centred', async ({ page, base, check, log }) => {
  /* The desktop bridge, so the window buttons draw as they do in the app. */
  await page.addInitScript(() => {
    window.sequence = { openRepo: async () => null, shell: async () => ({ maximized: false }) };
  });

  const scan = (label) =>
    check(label, async () => {
      await settle(page);
      const r = await page.evaluate(scanIconCentres, { rootSelector: sel('shell'), tolerance: TOL });
      atLeast(r.measured, 8, `${label}: icon buttons measured`);
      log(`${label}: ${r.measured} icon buttons measured, ${r.off.length} off centre`);
      is(JSON.stringify(r.off), '[]', `${label}: icons more than ${TOL} px off their button's centre`);
    });
  const click = async (testid) => {
    await page.locator(sel(testid)).first().click();
    await settle(page);
  };

  for (const [w, h] of [
    [1440, 900],
    [1024, 700],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.goto(base);
    await page.waitForSelector(sel('shell'));
    await page.waitForSelector(sel('shell-window-controls'));

    if ((await page.locator(sel('s2-tab-architecture')).getAttribute('aria-pressed')) !== 'true') await click('s2-tab-architecture');
    await scan(`${w}: one surface`);
    await click('s2-tab-files');
    await scan(`${w}: two surfaces`);
    await click('s2-tab-terminal');
    await scan(`${w}: Terminal with its x`);
    for (const id of ['architecture', 'files', 'whiteboard', 'terminal']) {
      const x = page.locator(sel(`v3-tab-close-${id}`));
      if (await x.count()) await x.click();
    }
    await settle(page);
    await check(`${w}: no surface open, the pills fold to icons`, async () => {
      is(await page.locator('.s2-row').getAttribute('data-stage'), 'none', 'the stage folded');
    });
    await scan(`${w}: no surface (icon pills)`);
  }

  await check('the scan reports a glyph pushed off its centre (positive control)', async () => {
    const r = await page.evaluate(
      ({ scan, tolerance }) => {
        const host = document.querySelector('[data-testid="shell"]');
        const b = document.createElement('button');
        b.setAttribute('aria-label', 'planted');
        b.style.cssText = 'position:fixed;left:40px;top:40px;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;padding:0 0 0 6px;z-index:9999';
        b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
        host.appendChild(b);
        // eslint-disable-next-line no-new-func
        const fn = new Function(`return (${scan})`)();
        const out = fn({ rootSelector: '[data-testid="shell"]', tolerance });
        b.remove();
        return out.off.filter((o) => o.label === 'planted');
      },
      { scan: scanIconCentres.toString(), tolerance: TOL },
    );
    is(r.length, 1, 'the planted off-centre button is reported');
  });
});
