#!/usr/bin/env node
/**
 * THE AGENTS SURFACE WHEN IT IS WIDE (round 16, B12).
 *
 * Owner: side by side the left-to-right view is fine at 25-35% of the window, but the bigger the surface gets the more the
 * rows, the Tree/Timeline tabs and the totals stretch across it. Past about 45% the content is one centred column and the
 * side margins open up. The width is the SURFACE's (a container query), not the window's, so this pins the surface element
 * to 400, 640, 900 and 1400 px in one 1920px window and measures: the column's width (the whole surface up to the cap, 720px
 * after), that it sits in the middle (left margin equals right margin), that the tabs keep their own width, and that nothing
 * (header, tabs, rows) reaches outside the column. Both surfaces are measured: the Agents surface tab and the Agents dock.
 *
 * jsdom has no layout, so this runs in a real browser against dist/.
 */
import { atLeast, sel, settle, suite, within } from './lib/harness.mjs';

const at = (h) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const SESSIONS = {
  index: { version: 1, activeId: 'h1', sessions: [{ id: 'h1', title: 'Fix the failing gateway tests', createdAt: at(5), updatedAt: at(5) }] },
  scope: 'workspace',
  repos: [],
};
const usage = (input, output, cacheRead) => ({ input, output, cacheRead, cacheWrite: 0, thought: 0, total: input + output });
const run = (id, sessionId, prompt, startedAt, endedAt, u) => ({ id, sessionId, agentRef: 'claude', prompt, text: 'done', status: 'done', error: null, stopReason: 'end_turn', startedAt, endedAt, model: 'claude-sonnet-5', nodeId: null, tools: [], usage: u });
const T0 = Date.now() - 600000;
const RUNS = { runs: [run('t1', 'h1', 'Why do the gateway tests fail?', T0, T0 + 90000, usage(18400, 2100, 61200)), run('t2', 'h1', 'Fix it and rerun them', T0 + 120000, T0 + 200000, usage(9300, 640, 28800))] };
let n = 0;
const ev = (dt, e) => ({ id: `e${++n}`, at: Date.now() + dt, source: 'acp', sessionId: 'h1', paths: [], status: 'done', ...e });
const EVENTS = [
  ev(-300000, { kind: 'session_start', status: 'running', title: 'Fix the failing gateway tests' }),
  ev(-299000, { kind: 'tool_start', tool: 'Read', toolKind: 'read', toolUseId: 'a', status: 'running', title: 'Read gateway/src/server.ts', paths: ['gateway/src/server.ts'] }),
  ev(-298400, { kind: 'tool_end', tool: 'Read', toolKind: 'read', toolUseId: 'a', title: 'Read gateway/src/server.ts', paths: ['gateway/src/server.ts'] }),
  ev(-298000, { kind: 'subagent_start', agentId: 'sub', title: 'Explore', status: 'running' }),
  ev(-295000, { kind: 'subagent_stop', agentId: 'sub', title: 'Explore' }),
  ev(-290000, { kind: 'tool_start', tool: 'Edit', toolKind: 'edit', toolUseId: 'b', status: 'running', title: 'Edit gateway/test/setup.ts', paths: ['gateway/test/setup.ts'] }),
  ev(-289000, { kind: 'tool_end', tool: 'Edit', toolKind: 'edit', toolUseId: 'b', title: 'Edit gateway/test/setup.ts', paths: ['gateway/test/setup.ts'] }),
  ev(-260000, { kind: 'stop', usage: usage(18400, 2100, 61200), tokens: 20500 }),
];

/* the cap is a share of the WINDOW, as the owner said it: max(560px, 40vw) */
const capFor = (vw) => Math.max(560, vw * 0.4);
const VW = 1920;
const WIDTHS = [400, 640, 900, 1400];

/** Pin the element to a width in px, whatever its host would give it. */
const pin = (page, testid, w) =>
  page.evaluate(
    ([id, width]) => {
      const el = document.querySelector(`[data-testid="${id}"]`);
      el.style.setProperty('width', `${width}px`, 'important');
      el.style.setProperty('flex', 'none', 'important');
      el.style.setProperty('max-width', 'none', 'important');
    },
    [testid, w],
  );

const rect = (page, testid) =>
  page.evaluate((id) => {
    const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
    return { left: r.left, right: r.right, width: r.width };
  }, testid);

await suite(
  'agents-wide',
  async ({ page, base, check, log }) => {
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.route('**/api/agent-events', (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: EVENTS.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') }),
    );
    await page.route('**/api/sessions*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSIONS) }));
    await page.route('**/api/acp/runs*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RUNS) }));
    await page.goto(base);
    await page.waitForSelector(sel('shell'));

    await check('beside the chat at 1440x900: dragging the chat sizer, the content is centred with margins once the surface passes 45% of the window', async () => {
      const VWD = 1440;
      await page.setViewportSize({ width: VWD, height: 900 });
      await page.goto(base);
      await page.waitForSelector(sel('shell'));
      await page.locator(sel('s2-tab-agents')).first().click();
      await page.locator(sel('agents-surface-chat')).first().waitFor({ timeout: 15000 });
      for (const id of ['architecture', 'files', 'whiteboard', 'terminal']) {
        const c = page.locator(sel(`v3-tab-close-${id}`));
        if (await c.count()) await c.first().click().catch(() => {});
      }
      await settle(page);
      const drag = async (share) => {
        const sz = page.locator(sel('s2-chat-sizer'));
        const bb = await sz.boundingBox();
        const dx = (await rect(page, 'agents-surface')).width - Math.round(share * VWD);
        await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await page.mouse.down();
        await page.mouse.move(bb.x + bb.width / 2 + dx, bb.y + bb.height / 2, { steps: 8 });
        await page.mouse.up();
        await settle(page);
        const s = await rect(page, 'agents-surface');
        const c = await rect(page, 'agents-surface-col');
        return { s, c, share: s.width / VWD, left: c.left - s.left, right: s.right - c.right };
      };
      const cap = capFor(VWD);
      const narrow = await drag(0.33);
      log(`sizer: surface ${(narrow.share * 100).toFixed(0)}%, column ${Math.round(narrow.c.width)}px, margins ${Math.round(narrow.left)}/${Math.round(narrow.right)}`);
      atLeast(narrow.c.width, narrow.s.width - 32 - 40, 'at about 33% the column is the whole surface (left to right, as today)');
      for (const share of [0.5, 0.6]) {
        const m = await drag(share);
        log(`sizer: surface ${(m.share * 100).toFixed(0)}%, column ${Math.round(m.c.width)}px, margins ${Math.round(m.left)}/${Math.round(m.right)}`);
        atLeast(m.share, 0.45, 'the sizer reached past 45% of the window');
        within(m.left, m.right, 1.5, `at ${(m.share * 100).toFixed(0)}%: centred`);
        atLeast(m.left, 30, `at ${(m.share * 100).toFixed(0)}%: side margin`);
        atLeast(cap + 1, m.c.width, `at ${(m.share * 100).toFixed(0)}%: column stops at the cap`);
      }
    });
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.goto(base);
    await page.waitForSelector(sel('shell'));

    await check('the Agents surface: full width up to the cap, then a centred capped column', async () => {
      await page.locator(sel('s2-tab-agents')).first().click();
      await page.locator(sel('agents-surface-chat')).first().waitFor({ timeout: 15000 });
      for (const W of WIDTHS) {
        await pin(page, 'agents-surface', W);
        await settle(page);
        const s = await rect(page, 'agents-surface');
        const c = await rect(page, 'agents-surface-col');
        const CAP = capFor(VW);
        if (W - 32 > CAP + 40) within(c.width, CAP, 1, `surface at ${W}: column width (the cap)`);
        else atLeast(c.width, Math.min(W - 32, CAP) - 40, `surface at ${W}: column width (the surface, less its padding and scrollbar gutter)`);
        const left = c.left - s.left;
        const right = s.right - c.right;
        within(left, right, 1, `surface at ${W}: left margin vs right margin (centred)`);
        if (W - 32 > CAP + 40) atLeast(left, (W - CAP) / 2 - 20, `surface at ${W}: the side margin grows with the surface`);
        for (const p of ['agents-surface-tab-tree', 'agents-surface-tab-workflows', 'agents-surface-total', 'agents-surface-run']) {
          const r = await rect(page, p);
          atLeast(r.left, c.left - 2, `${p} at ${W}: inside the column (left)`);
          atLeast(c.right + 2, r.right, `${p} at ${W}: inside the column (right)`);
        }
        const tab = await rect(page, 'agents-surface-tab-workflows');
        atLeast(160, tab.width, `the Workflows tab keeps its intrinsic width at ${W}`);
        log(`surface @${W}: column ${Math.round(c.width)}px, margins ${Math.round(left)}/${Math.round(right)}, tab ${Math.round(tab.width)}px`);
      }
    });

    await check('the Agents dock: full width up to the cap, then a centred capped column; the Timeline tab keeps its width', async () => {
      await page.goto(base);
      await page.waitForSelector(sel('shell'));
      if (!(await page.locator(sel('agents-panel')).count())) {
        await page.locator(sel('s2-chat-more')).first().click();
        await page.locator(sel('v3-agents-toggle')).first().click();
      }
      await page.locator(sel('agents-tree')).waitFor({ timeout: 15000 });
      await page.locator(sel('agents-view-timeline')).click();
      await page.locator(sel('agents-timeline')).waitFor({ timeout: 15000 });
      for (const W of WIDTHS) {
        await pin(page, 'agents-dock', W);
        await settle(page);
        const dock = await rect(page, 'agents-dock');
        const CAP = capFor(VW);
        const expectW = Math.min(dock.width - 2, CAP); /* the card's 1px edge each side */
        const h = await rect(page, 'agents-head');
        within(h.width, expectW, 1.5, `dock header at ${W}: width`);
        within(h.left - dock.left - 1, dock.right - 1 - h.right, 1.5, `dock header at ${W}: centred`);
        for (const id of ['agents-roster', 'agents-timeline']) {
          const r = await rect(page, id);
          atLeast(h.right + 0.5, r.right, `${id} at ${W}: inside the header's column (right)`);
          atLeast(r.left, h.left - 0.5, `${id} at ${W}: inside the header's column (left)`);
        }
        const tl = await rect(page, 'agents-view-timeline');
        atLeast(140, tl.width, `the Timeline tab keeps its own width at ${W}`);
        atLeast(h.right + 0.5, tl.right, `the Timeline tab at ${W}: inside the column`);
        log(`dock @${W}: header ${Math.round(h.width)}px, Timeline tab ${Math.round(tl.width)}px`);
      }
    });
  },
  { routes: {} },
);
