#!/usr/bin/env node
/* Agent connection layout in the built shell. The probe is controlled; no vendor CLI or login runs. */
import fs from 'node:fs';
import { sel, settle, suite } from './lib/harness.mjs';

const out = 'tmp-shots/connect-0184';
fs.mkdirSync(out, { recursive: true });
const providers = [
  { id: 'codex', label: 'Codex', installed: true, version: '1', state: 'ready', plan: 'ChatGPT', signInCommand: 'codex login', installHint: '' },
  { id: 'claude', label: 'Claude Code', installed: true, version: '1', state: 'signIn', signInCommand: 'claude login', installHint: '' },
];

await suite('connect-ux-0184', async ({ page, base, check }) => {
  await page.route('**/api/onboarding/providers*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ providers }) }));
  await page.route('**/api/acp/agents', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"agents":[]}' }));
  await page.route('**/api/acp/catalog', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'gemini', name: 'Gemini CLI', source: 'builtin', state: 'npx', description: 'Google coding agent', installHint: '' }], registryFetchedAt: null }) }));
  await page.route('**/api/acp/catalog/sign-in/methods', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ methods: [{ id: 'browser', name: 'Sign in with Google', description: 'Opens your browser for your Google account', type: 'agent' }, { id: 'apikey', name: 'Use an API key', description: 'Paste a key from your Google AI Studio account', type: 'agent' }, { id: 'terminal', name: 'Use a terminal', type: 'terminal' }] }) }));
  for (const [width, theme] of [[1440, 'dark'], [1440, 'light'], [1024, 'dark'], [390, 'dark'], [390, 'light']]) {
    await page.setViewportSize({ width, height: width < 500 ? 780 : 900 });
    await page.goto(base);
    await page.evaluate((t) => { try { localStorage.setItem('seq.theme', t); } catch { /* private mode */ } }, theme);
    await page.reload();
    await page.locator(sel('v3-model-trigger')).first().waitFor();
    await page.locator(sel('v3-model-trigger')).first().click();
    await page.locator(sel('s2-connect-line-claude')).waitFor();
    await settle(page);
    await page.screenshot({ path: `${out}/connect-menu-${width}-${theme}.png` });
    await check(`Connect menu labels and actions fit at ${width}px ${theme}`, async () => {
      const problems = await page.evaluate(() => {
        const rect = (el) => el.getBoundingClientRect();
        const lines = [...document.querySelectorAll('[data-testid^="s2-connect-line-"]')];
        const errors = [];
        for (const line of lines) {
          const label = line.querySelector('.s2-mi-name');
          const note = line.querySelector('.s2-mi-note');
          const action = line.querySelector('.s2-btn');
          const shell = line.closest('.s2-menu');
          if (!label || !note || !action || !shell) continue;
          const l = rect(label), n = rect(note), a = rect(action), s = rect(shell);
          if (n.top < l.bottom - 1) errors.push(`${label.textContent}: note overlaps name`);
          if (a.left < l.right - 1 || a.left < n.right - 1) errors.push(`${label.textContent}: action overlaps words`);
          if (a.right > s.right - 1 || a.left < s.left + 1) errors.push(`${label.textContent}: action outside menu`);
          if (l.width < label.scrollWidth - 1) errors.push(`${label.textContent}: name clipped`);
        }
        return errors;
      });
      if (problems.length) throw new Error(problems.join('; '));
    });
    await page.keyboard.press('Escape');
    if (!(await page.locator(sel('v3-rail-settings')).count())) {
      await page.locator(`${sel('s2-sidebar-open')}, ${sel('s2-iconrail-expand')}`).first().click();
    }
    const settings = page.locator(`${sel('v3-rail-settings')}, ${sel('s2-iconrail-settings')}`).first();
    await settings.click();
    await page.locator(sel('settings-nav-agents')).click();
    await page.locator(`${sel('settings-agent')}[data-agent="claude"]`).waitFor();
    await settle(page);
    await page.screenshot({ path: `${out}/settings-agents-${width}-${theme}.png` });
    await check(`Settings agent actions fit at ${width}px ${theme}`, async () => {
      const problems = await page.evaluate(() => {
        const errors = [];
        for (const row of document.querySelectorAll('[data-testid="settings-agent"]')) {
          const card = row.closest('.sb-card');
          if (!card) continue;
          const cr = card.getBoundingClientRect();
          for (const el of row.querySelectorAll('button, .sb-badge')) {
            const r = el.getBoundingClientRect();
            if (r.left < cr.left - 1 || r.right > cr.right + 1) errors.push(`${row.getAttribute('data-agent')}: ${el.textContent?.trim()} outside card`);
          }
        }
        return errors;
      });
      if (problems.length) throw new Error(problems.join('; '));
    });
    await page.locator(sel('agent-catalog-more')).first().click();
    await page.locator(sel('agent-catalog-signin')).first().click();
    await page.locator(sel('agent-catalog-method')).first().waitFor();
    await settle(page);
    await page.screenshot({ path: `${out}/settings-methods-${width}-${theme}.png` });
    await check(`Sign-in methods are readable at ${width}px ${theme}`, async () => {
      const result = await page.evaluate(() => {
        const row = document.querySelector('[data-testid="agent-catalog-row"]');
        const method = document.querySelector('[data-testid="agent-catalog-method"]');
        if (!row || !method) return 'method row missing';
        const card = row.closest('.sb-card');
        if (!card) return 'card missing';
        const m = method.getBoundingClientRect(), c = card.getBoundingClientRect();
        if (m.left < c.left - 1 || m.right > c.right + 1) return 'method button outside card';
        if (!method.textContent?.includes('Opens your browser for your Google account')) return 'vendor explanation hidden';
        return null;
      });
      if (result) throw new Error(result);
    });
    await check(`Exactly one method is labelled Recommended, visibly, at ${width}px ${theme}`, async () => {
      const result = await page.evaluate(() => {
        const labels = [...document.querySelectorAll('[data-testid="agent-catalog-method-recommended"]')];
        if (labels.length !== 1) return `${labels.length} Recommended labels`;
        const r = labels[0].getBoundingClientRect();
        const card = labels[0].closest('.sb-card')?.getBoundingClientRect();
        if (r.width < 40 || r.height < 16) return 'Recommended label has no size';
        if (!card || r.left < card.left - 1 || r.right > card.right + 1) return 'Recommended label outside the card';
        const method = labels[0].closest('[data-testid="agent-catalog-method"]');
        const first = document.querySelector('[data-testid="agent-catalog-method"]');
        if (method !== first) return 'Recommended is not on the first method';
        const names = [...document.querySelectorAll('[data-testid="agent-catalog-method"]')].map((m) => m.querySelector('.sb-agent-method-hd > span')?.textContent);
        if (new Set(names).size !== names.length) return 'two methods read the same';
        return null;
      });
      if (result) throw new Error(result);
    });
  }
});
