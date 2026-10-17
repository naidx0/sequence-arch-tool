#!/usr/bin/env node
/** Settings > Skills against the REAL analyzer server (no mocks): `node e2e/skills-real-shots.mjs <baseUrl> <outDir> <phase>`. */
import { findChromium, launchOptions, loadPlaywright } from './lib/chromium.mjs';

const [base, out, phase = 'after'] = process.argv.slice(2);
const chromium = await loadPlaywright();
const browser = await chromium.launch(launchOptions(findChromium()));
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base);
await page.waitForSelector('[data-testid="shell"]');
await page.waitForTimeout(1500);
await page.locator('[data-testid="v3-rail-settings"], [data-testid="s2-iconrail-settings"]').first().click();
await page.locator('[data-testid="settings-nav-skills"]').click();
await page.locator('[data-testid="settings-skill-row"]').first().waitFor({ timeout: 15000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/04-skills-rest-real-${phase}.png` });
await page.locator('[data-testid="settings-skill-row"]').first().hover();
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/04-skills-hover-real-${phase}.png` });
console.log('banner:', await page.locator('.settings-scope .sb-error, [role=alert]').count());
// Remove the second skill for real: arm, confirm.
const row = page.locator('[data-testid="settings-skill-row"]').nth(1);
await row.hover();
await row.locator('[data-testid="settings-skill-remove"]').click();
await row.locator('[data-testid="settings-skill-remove"]').click();
await page.waitForTimeout(800);
console.log('rows after remove:', await page.locator('[data-testid="settings-skill-row"]').count());
await browser.close();
