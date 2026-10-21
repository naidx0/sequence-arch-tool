#!/usr/bin/env node
/**
 * THE WORKFLOW EDITOR HAS TWO SIZES, AND ITS ICONS SIT IN THE MIDDLE (0.1.6, C5).
 *
 * The owner: "When you click make your own, it should open bigger ... The pop-up should be small, but the editor should be big."
 * And: "Make sure the icons are first centered in their boxes."  Both are layout facts jsdom cannot measure.
 *
 *  1. The start choice (no workflow yet) is a small pop-up (440 to 520 px wide, height to its content). Opening a workflow makes
 *     the editor the large working size: min(1280px, viewport - 48px) wide, min(86vh, viewport - 48px) tall, with two columns at
 *     680px and up. The change animates (an in-between width is seen) and is instant under reduced motion.
 *  2. Every glyph (palette chip, row tile) is optically centred: its drawing's centre is within 0.5 px of the centre of its
 *     box, at DPR 1 and 2. The subject set is derived (every svg[data-glyph] block glyph in the open editor), not listed.
 *
 * CONTROLS: a planted glyph pushed 3px off its tile must be reported (positive); each scan must have measured at least five
 * chips and four tiles (a scan that measured nothing would pass anything).
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { is, atLeast, sel, settle, suite, within } from './lib/harness.mjs';

const require = createRequire(import.meta.url);
const { applyWorkflowOps, checkWorkflow, freshWorkflowBlocks, workflowNotes } = await import(pathToFileURL(require.resolve('@sequence/schema')).href);

const TOL = 0.5;

/** A small in-memory /api/workflows, with the real ops and the real compile, so the editor opens on real content. */
function fakeWorkflows(seeded = false) {
  let doc = seeded ? { version: 1, id: 'w1', name: 'Workflow', blocks: freshWorkflowBlocks(), rev: 1, createdAt: '', updatedAt: '' } : null;
  const view = () => {
    const c = checkWorkflow(doc);
    return { ...doc, program: c.program, valid: c.ok, errors: c.errors, notes: workflowNotes(doc) };
  };
  return async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    const rest = url.pathname.replace(/^\/api\/workflows\/?/, '');
    if (req.method() === 'GET' && rest === '') return json(url.searchParams.has('chat') ? { workflows: doc ? [view()] : [], legacy: [] } : { workflows: doc ? [view()] : [] });
    if (req.method() === 'POST' && rest === '') {
      const from = JSON.parse(req.postData() ?? '{}').from;
      doc = { version: 1, id: 'w1', name: 'Workflow', blocks: from === 'empty' ? freshWorkflowBlocks().slice(-1) : freshWorkflowBlocks(), rev: 1, createdAt: '', updatedAt: '' };
      return json(view());
    }
    if (req.method() === 'GET' && doc) return json(view());
    if (req.method() === 'POST' && rest.endsWith('/ops') && doc) {
      doc = { ...doc, ...applyWorkflowOps(doc, JSON.parse(req.postData()).ops), rev: doc.rev + 1 };
      return json(view());
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  };
}

/** Runs IN THE PAGE: where every glyph's drawing sits in its box. */
function scanGlyphs(tolerance) {
  const centre = (r) => [r.left + r.width / 2, r.top + r.height / 2];
  const ink = (svg) => {
    const rects = [...svg.querySelectorAll('path, circle')].map((n) => n.getBoundingClientRect());
    const l = Math.min(...rects.map((r) => r.left));
    const t = Math.min(...rects.map((r) => r.top));
    return { left: l, top: t, width: Math.max(...rects.map((r) => r.right)) - l, height: Math.max(...rects.map((r) => r.bottom)) - t };
  };
  const off = [];
  let chips = 0;
  let tiles = 0;
  const check = (label, svg, box) => {
    const [gx, gy] = centre(ink(svg));
    const [bx, by] = centre(box);
    const dx = gx - bx;
    const dy = gy - by;
    if (Math.abs(dx) > tolerance || Math.abs(dy) > tolerance) off.push(`${label}: dx ${dx.toFixed(2)} dy ${dy.toFixed(2)}`);
  };
  for (const svg of document.querySelectorAll('[data-testid="wfe"] svg[data-glyph]')) {
    if (['grip', 'close', 'up', 'down', 'check'].includes(svg.getAttribute('data-glyph'))) continue;
    const kind = svg.getAttribute('data-glyph');
    /* the drawing within its own 16x16 */
    check(`${kind} in its svg`, svg, svg.getBoundingClientRect());
    const tile = svg.closest('.wfe-ico');
    const chip = svg.closest('[data-testid^="wfe-add-"]');
    if (tile) {
      tiles += 1;
      check(`${kind} in its tile`, svg, tile.getBoundingClientRect());
    } else if (chip) {
      chips += 1;
      const c = chip.getBoundingClientRect();
      const g = svg.getBoundingClientRect();
      const label = chip.querySelector('span').getBoundingClientRect();
      /* the glyph is level with the chip's middle, and the glyph-and-label group has equal room on both sides */
      const dy = g.top + g.height / 2 - (c.top + c.height / 2);
      const gapL = g.left - c.left;
      const gapR = c.right - label.right;
      if (Math.abs(dy) > tolerance) off.push(`${kind} in its chip: dy ${dy.toFixed(2)}`);
      const dpr = window.devicePixelRatio;
      for (const [axis, v] of [['x', g.left], ['y', g.top]]) if (Math.abs(v * dpr - Math.round(v * dpr)) > 0.02) off.push(`${kind} in its chip: ${axis} ${v.toFixed(2)} is not a whole device pixel`);
      if (Math.abs(gapL - gapR) > tolerance * 2) off.push(`${kind} in its chip: left gap ${gapL.toFixed(2)} vs right gap ${gapR.toFixed(2)}`);
    }
  }
  return { chips, tiles, off };
}

await suite('workflow-editor-sizes', async ({ page, base, check, log }) => {
  const browser = page.context().browser();

  const open = async (p) => {
    await p.route('**/api/workflows**', fakeWorkflows());
    await p.goto(base);
    await p.waitForSelector(sel('shell'));
    await p.locator(sel('s2-tab-agents')).first().click();
    await p.locator(sel('agents-surface-tab-workflows')).first().click();
    await p.locator(sel('activity-open-editor')).first().click();
    await p.waitForSelector(sel('wfe-start'));
    await settle(p);
  };
  const boxOf = (p) => p.locator(sel('wfe')).evaluate((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, size: e.getAttribute('data-size') }; });

  for (const [w, h] of [
    [1440, 900],
    [1024, 700],
  ]) {
    await check(`${w}x${h}: a small start pop-up, then the large editor`, async () => {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const p = await ctx.newPage();
      await open(p);
      const small = await boxOf(p);
      log(`${w}x${h} start pop-up ${small.w} x ${small.h}`);
      is(small.size, 'small', 'start size attribute');
      atLeast(small.w, 440, 'start pop-up width');
      atLeast(520, small.w, 'start pop-up width (at most 520)');
      atLeast(h * 0.5, small.h, 'start pop-up height (to its content, not a page)');
      /* sample the width through the change (recording from before the click): an in-between value proves it animates */
      await p.evaluate(() => {
        const el = document.querySelector('[data-testid="wfe"]');
        window.__seen = [];
        const t0 = performance.now();
        const tick = () => { window.__seen.push(el.getBoundingClientRect().width); if (performance.now() - t0 < 900) requestAnimationFrame(tick); };
        tick();
      });
      await p.locator(sel('wfe-start-fresh')).click();
      await p.waitForSelector(sel('wfe-block'));
      await p.waitForTimeout(1000);
      const seen = await p.evaluate(() => window.__seen);
      await settle(p);
      const large = await boxOf(p);
      log(`${w}x${h} editor ${large.w} x ${large.h}`);
      is(large.size, 'large', 'editor size attribute');
      within(large.w, Math.min(1280, w - 48), 1, 'editor width');
      within(large.h, Math.min(0.86 * h, h - 48), 1, 'editor height');
      atLeast(large.w, small.w * 1.8, 'the editor is far wider than the pop-up');
      atLeast(large.h, small.h * 1.5, 'the editor is far taller than the pop-up');
      const mid = seen.some((v) => v > small.w + 4 && v < large.w - 4);
      if (!mid) throw new Error(`no in-between width was seen while the change ran (${seen.slice(0, 6).map(Math.round)}...)`);
      /* the two columns sit side by side at this width */
      const cols = await p.locator(sel('wfe-list')).evaluate((e) => { const a = e.getBoundingClientRect(); const b = document.querySelector('[data-testid="wfe-graph"]').getBoundingClientRect(); return { sideBySide: b.left >= a.right - 1 }; });
      is(cols.sideBySide, true, 'list and graph side by side');
      await ctx.close();
    });

    for (const dpr of [1, 2]) {
      await check(`${w}x${h} @${dpr}x: every glyph is centred in its box within ${TOL}px`, async () => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
        const p = await ctx.newPage();
        await open(p);
        await p.locator(sel('wfe-start-fresh')).click();
        await p.waitForSelector(sel('wfe-block'));
        await settle(p);
        const r = await p.evaluate(scanGlyphs, TOL);
        log(`${w}x${h} @${dpr}x: ${r.chips} chips, ${r.tiles} tiles measured, ${r.off.length} off`);
        atLeast(r.chips, 5, 'chips measured');
        atLeast(r.tiles, 4, 'tiles measured');
        is(JSON.stringify(r.off), '[]', 'glyphs off centre');
        /* positive control: push one glyph 3px off its tile and the scan must see it */
        await p.evaluate(() => { const s = document.querySelector('[data-testid="wfe"] .wfe-ico svg'); s.style.transform = 'translateX(3px)'; });
        const planted = await p.evaluate(scanGlyphs, TOL);
        if (planted.off.length === 0) throw new Error('the scan did not report a glyph pushed 3px off its tile');
        await ctx.close();
      });
    }
  }

  await check('reopening an existing workflow is large from the first frame, with no grow', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('seq.wfe.size', 'large'); } catch { /* blocked */ }
      window.__w = [];
      const tick = () => { const e = document.querySelector('[data-testid="wfe"]'); if (e) window.__w.push(e.getBoundingClientRect().width); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const p = await ctx.newPage();
    await p.route('**/api/workflows**', fakeWorkflows(true));
    await p.goto(base);
    await p.waitForSelector(sel('shell'));
    await p.locator(sel('s2-tab-agents')).first().click();
    await p.locator(sel('agents-surface-tab-workflows')).first().click();
    await p.locator(sel('activity-open-editor')).first().click();
    await p.waitForSelector(sel('wfe-block'));
    await p.waitForTimeout(700);
    const w = await p.evaluate(() => window.__w);
    atLeast(w.length, 5, 'frames sampled');
    log(`reopen: first width ${w[0]}, ${w.length} frames, min ${Math.min(...w)}`);
    within(w[0], 1280, 1, 'first sampled width');
    const odd = w.filter((v) => Math.abs(v - 1280) > 1);
    is(JSON.stringify(odd), '[]', 'widths other than 1280 while reopening');
    await ctx.close();
  });

  await check('reduced motion: the editor is its large size at once', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await open(p);
    await p.locator(sel('wfe-start-fresh')).click();
    await p.waitForSelector(sel('wfe-block'));
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const b = await boxOf(p);
    within(b.w, 1280, 1, 'width right after opening, no settle');
    await ctx.close();
  });
});
