// Built-shell audit; `dom` records accessible desktop controls before navigation.
import fs from 'node:fs';
import { sel, settle, suite, is } from './lib/harness.mjs';

const phase = process.argv[2] ?? 'before';
const measured = phase.includes('measured');
const out = `tmp-shots/agent-audit-0184/${phase}`;
fs.mkdirSync(out, { recursive: true });
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const sessions = { index: { version: 1, activeId: 'audit-chat', sessions: [{ id: 'audit-chat', title: 'Agent context audit', createdAt: '2026-10-20', updatedAt: '2026-10-20' }] }, scope: 'workspace', repos: [] };
const runs = Array.from({ length: 12 }, (_, i) => ({ id: `audit-${i}`, agentRef: 'codex', prompt: `Check ${i + 1}: packages/web2/src/settings/AgentsPane.tsx with a long specific explanation`, text: 'Controlled saved turn; no agent executed.', status: 'done', startedAt: 1792490000000 + i * 1000, endedAt: 1792490000500 + i * 1000, model: 'audit-agent-model', tools: [], usage: { input: 24000, output: 500, total: 24500 } }));
await suite('agent-context-audit-0184', async ({ page, base, log, check, consoleErrors }) => {
  await page.route('**/api/**', r => r.fulfill({ ...json({ error: 'Controlled audit: unavailable' }), status: 503 }));
  await page.route('**/api/sessions*', r => r.fulfill(json(sessions)));
  await page.route('**/api/acp/runs*', r => r.fulfill(json({ runs })));
  await page.route('**/api/acp/live', r => r.fulfill(json({ turns: measured ? [{ turnId: 'controlled-live', chatId: 'audit-chat', agentRef: 'codex', prompt: 'Controlled report', startedAt: 1792491000000 }] : [] })));
  await page.route('**/api/acp/attach*', r => r.fulfill({ status: 200, contentType: 'text/event-stream', body: [
    { type: 'acp:turn-id', turnId: 'controlled-live' },
    { type: 'acp:update', update: { sessionId: 'controlled', update: { sessionUpdate: 'usage_update', used: 24000, size: 200000 } } },
    { type: 'acp:result', stopReason: 'end_turn', text: 'Controlled report; no agent executed.' },
    { type: 'acp:turn', state: 'settled' },
  ].map(e => `data: ${JSON.stringify(e)}\n\n`).join('') }));
  await page.route('**/api/acp/agents', r => r.fulfill(json({ agents: [{ id: 'codex', label: 'Codex' }] })));
  await page.route('**/api/acp/available', r => r.fulfill(json({ available: true })));
  await page.route('**/api/acp/capabilities*', r => r.fulfill(json({ models: [{ id: 'audit-agent-model', name: 'Agent model', isDefault: true, efforts: [] }], efforts: [], commands: [], skills: [] })));
  await page.route('**/api/ai-config', r => r.fulfill(json({ mode: 'api-key', provider: 'openai-compatible', model: 'saved-api-model', contextWindow: 131072, profiles: [] })));
  await page.route('**/api/agent-events', r => r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }));
  for (const width of (phase === 'dom' ? [1440] : [1440, 1024, 390])) for (const theme of (phase === 'dom' ? ['dark'] : ['dark', 'light'])) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base);
    await page.evaluate(t => { localStorage.clear(); localStorage.setItem('seq.theme', t); localStorage.setItem('sequence.chatAgentPicks.v1', JSON.stringify({ 'audit-chat': { agent: 'codex', model: 'audit-agent-model' } })); }, theme);
    await page.reload();
    await page.locator(sel('shell')).waitFor();
    await page.waitForTimeout(1000);
    if (phase === 'dom') {
      log('errors', consoleErrors);
      log('body', await page.locator('body').innerText());
      log('visible controls', await page.locator('button').evaluateAll(bs => bs.filter(b => b.getBoundingClientRect().width && b.getBoundingClientRect().height).map(b => ({ id: b.dataset.testid, label: b.getAttribute('aria-label'), text: b.textContent }))));
      await page.screenshot({ path: `${out}/${width}-${theme}-dom.png` });
      continue;
    }
    const workspace = page.locator(sel('s2-narrow-stage'));
    if (await workspace.isVisible()) await workspace.click();
    await page.locator(sel('s2-tab-agents')).first().click();
    await page.locator(sel('agents-surface-chat')).first().waitFor();
    await settle(page);
    await page.screenshot({ path: `${out}/${width}-${theme}-agents-tree.png` });
    log(`${out}/${width}-${theme}-agents-tree.png`);
    log('Agents surface:', await page.locator(sel('agents-surface')).innerText());
    await check(`${width} ${theme}: prompt paging`, async () => {
      is(await page.locator(sel('agents-surface-run')).count(), 5, 'initial prompts');
      await page.locator(sel('agents-surface-more')).click();
      is(await page.locator(sel('agents-surface-run')).count(), 10, 'expanded prompts');
    });
    await page.locator(sel('agents-surface-tab-timeline')).click();
    await settle(page);
    await page.screenshot({ path: `${out}/${width}-${theme}-agents-timeline.png` });
    await check(`${width} ${theme}: last expanded timeline prompt is reachable`, async () => {
      const last = page.locator(sel('agents-surface-run')).last();
      await last.scrollIntoViewIfNeeded();
      const b = await last.boundingBox();
      if (!b || b.y < 0 || b.y + b.height > 900) throw new Error('last timeline prompt outside viewport');
      await page.screenshot({ path: `${out}/${width}-${theme}-agents-timeline-bottom.png` });
    });
    for (const id of ['agents', 'architecture', 'files', 'whiteboard', 'terminal']) {
      const close = page.locator(sel(`v3-tab-close-${id}`));
      if (await close.count()) await close.first().click();
    }
    if (width >= 1180) {
      const toggle = page.locator(sel('s2-overview-toggle'));
      if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click();
      const pill = page.locator(sel('ov-pill'));
      if (await pill.isVisible()) await pill.click();
      await page.locator(sel('ov-window')).waitFor();
      await settle(page);
      log('overview window:', await page.locator(sel('ov-window')).innerText());
      await page.screenshot({ path: `${out}/${width}-${theme}-agent-overview.png` });
      await check(`${theme}: context follows agent report, never API-model window`, async () => is(await page.locator(sel('ov-window')).innerText(), measured ? '24k of 200k' : 'Not measured', 'agent context'));
    } else {
      await check(`${width} ${theme}: overview intentionally unavailable below 1180px`, async () => is(await page.locator(sel('s2-overview-toggle')).count(), 0, 'overview toggle'));
    }
  }
  await check('no uncaught browser errors', () => is(consoleErrors.filter(e => e.startsWith('uncaught:')).length, 0, 'uncaught errors'));
}, { routes: { '/api/graph': null, '/archgraph.json': JSON.parse(fs.readFileSync(process.env.AUDIT_GRAPH, 'utf8')) } });
