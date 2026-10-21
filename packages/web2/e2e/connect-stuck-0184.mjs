#!/usr/bin/env node
/* Nothing connected yet (no agent CLI, no model), in the built shell. The probe is controlled; no vendor CLI runs.
 *  - Connect an agent: every row keeps its name and note, and its two setup actions sit on their own line under them.
 *  - Settings > Agents, a Claude row that needs the bridge and a sign-in: one filled button (the bridge), before Sign in;
 *    the sign-in panel's buttons are Settings pills with a border, at least 24 px tall, inside the card.
 *  - Settings > General and Skills: the segmented controls stay inside their card.
 */
import fs from 'node:fs';
import { sel, settle, suite } from './lib/harness.mjs';

const out = 'tmp-shots/connect-stuck-0184';
fs.mkdirSync(out, { recursive: true });
const providers = [
  { id: 'claude', label: 'Claude Code', installed: false, version: null, state: 'install', signInCommand: 'claude auth login', installHint: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'codex', label: 'Codex', installed: false, version: null, state: 'install', signInCommand: 'codex login', installHint: 'npm install -g @openai/codex' },
];
const signedOut = [
  { ...providers[0], installed: true, version: '2.1.120', state: 'signIn', adapterInstall: 'npm install -g @agentclientprotocol/claude-agent-acp' },
  { ...providers[1], installed: true, version: '0.9.1', state: 'signIn' },
];

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const openSettings = async (page) => {
  if (!(await page.locator(sel('v3-rail-settings')).count())) await page.locator(`${sel('s2-sidebar-open')}, ${sel('s2-iconrail-expand')}`).first().click();
  await page.locator(`${sel('v3-rail-settings')}, ${sel('s2-iconrail-settings')}`).first().click();
};

await suite('connect-stuck-0184', async ({ page, base, check }) => {
  let list = providers;
  await page.route('**/api/onboarding/providers*', (route) => route.fulfill(json({ providers: list })));
  await page.route('**/api/acp/agents', (route) => route.fulfill(json({ agents: [] })));
  await page.route('**/api/acp/catalog', (route) => route.fulfill(json({ agents: [], registryFetchedAt: null })));
  for (const [width, theme] of [[1440, 'dark'], [1024, 'light'], [390, 'dark'], [390, 'light']]) {
    const key = `${width}-${theme}`;
    list = providers;
    await page.setViewportSize({ width, height: width < 500 ? 780 : 900 });
    await page.goto(base);
    await page.evaluate((t) => localStorage.setItem('seq.theme', t), theme);
    await page.reload();
    await page.locator(sel('v3-model-trigger')).first().click();
    await page.locator(sel('s2-connect-line-claude')).waitFor();
    await settle(page);
    await page.screenshot({ path: `${out}/menu-${key}.png` });
    await check(`Connect menu with nothing connected: names and notes keep their width, actions sit under them (${key})`, async () => {
      const problems = await page.evaluate(() => {
        const errors = [];
        const lines = [...document.querySelectorAll('[data-testid^="s2-connect-line-"]')];
        if (lines.length !== 2) errors.push(`${lines.length} rows, wanted 2`);
        for (const line of lines) {
          const name = line.querySelector('.s2-mi-name');
          const note = line.querySelector('.s2-mi-note');
          /* Two setup actions (Copy prompt, Connect a model) sit on their own line; a missing claude or codex shows one Install button on the row itself, which installs in place. */
          const acts = line.querySelector('.s2-agent-line-acts');
          const single = line.querySelector('[data-testid^="s2-install-"]');
          const menu = line.closest('.s2-menu');
          if (!name || !note || !(acts || single) || !menu) { errors.push('row is missing its name, note, actions or menu'); continue; }
          if (!acts) {
            const n = name.getBoundingClientRect(), s = single.getBoundingClientRect(), m = menu.getBoundingClientRect();
            if (n.width < 40 || name.scrollWidth > name.clientWidth + 1) errors.push(`${name.textContent}: name has no room (${Math.round(n.width)}px)`);
            if (s.left < m.left || s.right > m.right) errors.push(`${name.textContent}: ${single.textContent} outside the menu`);
            if (s.height < 24) errors.push(`${single.textContent} is ${Math.round(s.height)}px tall`);
            continue;
          }
          const n = name.getBoundingClientRect(), t = note.getBoundingClientRect(), a = acts.getBoundingClientRect(), m = menu.getBoundingClientRect();
          if (n.width < 40 || name.scrollWidth > name.clientWidth + 1) errors.push(`${name.textContent}: name has no room (${Math.round(n.width)}px)`);
          if (t.width < 40) errors.push(`${name.textContent}: note has no room`);
          if (a.top < Math.max(n.bottom, t.bottom) - 1) errors.push(`${name.textContent}: actions are not under the words`);
          for (const b of acts.querySelectorAll('button')) {
            const r = b.getBoundingClientRect();
            if (r.left < m.left || r.right > m.right) errors.push(`${name.textContent}: ${b.textContent} outside the menu`);
            if (r.height < 24) errors.push(`${b.textContent} is ${Math.round(r.height)}px tall`);
          }
        }
        return errors;
      });
      if (problems.length) throw new Error(problems.join('; '));
    });
    await page.keyboard.press('Escape');

    list = signedOut;
    await openSettings(page);
    await page.locator(sel('settings-nav-agents')).click();
    await page.locator(`${sel('settings-agent')}[data-agent="claude"]`).waitFor();
    await page.locator(sel('settings-agent-signin')).first().click();
    await page.locator(sel('first-run-signin-retry')).waitFor({ timeout: 15000 });
    await settle(page);
    await page.screenshot({ path: `${out}/signin-${key}.png` });
    await check(`Claude row: the bridge is the one filled button and comes before Sign in; panel buttons are bordered pills (${key})`, async () => {
      const result = await page.evaluate(() => {
        const row = document.querySelector('[data-testid="settings-agent"][data-agent="claude"]');
        const card = row?.closest('.sb-card');
        if (!row || !card) return 'row or card missing';
        const bridge = row.querySelector('[data-testid="bridge-install-button"]');
        const signIn = row.querySelector('[data-testid="settings-agent-signin"]');
        if (!bridge || !signIn) return 'bridge or sign-in button missing';
        if (!(bridge.compareDocumentPosition(signIn) & Node.DOCUMENT_POSITION_FOLLOWING)) return 'Sign in comes before the bridge';
        const solid = [...row.querySelectorAll('button')].filter((b) => /sb-pill-solid/.test(b.className) && b.getAttribute('data-testid') !== 'first-run-signin-retry');
        if (solid.length !== 1) return `${solid.length} filled buttons besides Retry`;
        const cr = card.getBoundingClientRect();
        const panel = row.querySelector('[data-testid="settings-agent-terminal"]');
        for (const b of panel.querySelectorAll('button')) {
          const r = b.getBoundingClientRect();
          const s = getComputedStyle(b);
          if (r.left < cr.left - 1 || r.right > cr.right + 1) return `${b.textContent} outside the card`;
          if (r.height < 24) return `${b.textContent} is ${Math.round(r.height)}px tall`;
          if (s.backgroundColor === 'rgba(0, 0, 0, 0)' && parseFloat(s.borderTopWidth) === 0) return `${b.textContent} has no fill and no border`;
        }
        return null;
      });
      if (result) throw new Error(result);
    });
    await check(`The setup actions beside the sign-in panel do not overlap each other or their own words (${key})`, async () => {
      const result = await page.evaluate(() => {
        const row = document.querySelector('[data-testid="settings-agent"][data-agent="claude"]');
        const btns = [...row.querySelectorAll('[data-testid^="settings-agent-chat"]')];
        for (const b of btns) {
          const r = b.getBoundingClientRect();
          if (b.scrollWidth > b.clientWidth + 1) return `${b.textContent} text is wider than its button`;
          if (r.height < 24) return `${b.textContent} is ${Math.round(r.height)}px tall`;
        }
        for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
          const a = btns[i].getBoundingClientRect(), c = btns[j].getBoundingClientRect();
          if (Math.min(a.right, c.right) - Math.max(a.left, c.left) > 1 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 1) return 'two setup buttons overlap';
        }
        return btns.length >= 2 ? null : `${btns.length} setup buttons found`;
      });
      if (result) throw new Error(result);
    });

    await page.locator(sel('settings-nav-app')).click();
    await page.locator('.sb-seg').first().waitFor();
    await settle(page);
    await page.screenshot({ path: `${out}/general-${key}.png` });
    await check(`General: segmented controls stay inside their card (${key})`, async () => {
      const problems = await page.evaluate(() => {
        const errors = [];
        const segs = [...document.querySelectorAll('.settings-scope .sb-seg')];
        if (!segs.length) errors.push('no segmented control found');
        for (const seg of segs) {
          const c = seg.closest('.sb-card').getBoundingClientRect();
          for (const el of [seg, ...seg.querySelectorAll('button')]) {
            const r = el.getBoundingClientRect();
            if (r.right > c.right + 1 || r.left < c.left - 1) errors.push(`${el.textContent?.trim() || 'track'} outside the card`);
          }
          for (const b of seg.querySelectorAll('button')) if (b.scrollWidth > b.clientWidth + 1) errors.push(`${b.textContent.trim()} is clipped`);
        }
        return errors;
      });
      if (problems.length) throw new Error(problems.join('; '));
    });
    await page.locator(sel('settings-nav-skills')).click();
    await page.locator('.sb-seg').first().waitFor();
    await settle(page);
    await page.screenshot({ path: `${out}/skills-${key}.png` });
    await check(`Skills: the component-mode segments stay inside their card (${key})`, async () => {
      const problems = await page.evaluate(() => {
        const errors = [];
        const segs = [...document.querySelectorAll('.settings-scope .sb-seg')];
        if (!segs.length) errors.push('no segmented control found');
        for (const seg of segs) {
          const c = seg.closest('.sb-card').getBoundingClientRect();
          for (const b of seg.querySelectorAll('button')) {
            const r = b.getBoundingClientRect();
            if (r.right > c.right + 1 || r.left < c.left - 1) errors.push(`${b.textContent.trim()} outside the card`);
          }
        }
        return errors;
      });
      if (problems.length) throw new Error(problems.join('; '));
    });
  }
});
