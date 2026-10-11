/*
 * Scenarios whose answers are replayed (no model is called): whiteboard-draw,
 * ask-in-place, and (below) the agent-driven chat clips. See record-014.mjs for
 * the real-versus-replayed line.
 */
export function registerReplayScenarios(ctx) {
  const { LAYOUT, SCENARIOS, R, tid, waitShell, installReplay, readJson, sleep, giveRoom, openBoardTab } = ctx;

  /* ───── the whiteboard's replayed "draw the agentic loop" (the draw tool's recorded output) ───── */
  const wbEvents = () => readJson('wb-agentic-loop.json');
  const DRAW_Q = 'draw the agentic loop on the whiteboard';
  const DRAW_SAY = 'Drew the agentic loop: a prompt goes to the model, the model calls a tool, the result goes back to the model, and the model answers.';

  function askScript(state) {
    return async (prompt) => {
      if (/draw the agentic loop/i.test(prompt)) {
        return { events: [...wbEvents(), { type: 'result', text: DRAW_SAY }], gap: state.fast ? 40 : (i) => (i < 3 ? 140 : 520), delay: state.fast ? 100 : 900 };
      }
      if (/result arrow|back to the model/i.test(prompt)) {
        return { events: [{ type: 'result', text: 'The Tool call box feeds a Tool result box, and that box already points back at the Model. A second arrow straight from Tool call to Model would skip the result, so I would leave the loop as drawn.' }], delay: 900 };
      }
      if (/depends on this|what would break/i.test(prompt)) {
        return {
          events: [{ type: 'result', text: 'The gateway calls Orders over HTTP (GET /orders/*, POST /orders), so every order route would fail. Orders also publishes order.created, so Shipping and Notifications would stop receiving new orders. Orders itself calls Payments (POST /charge), Inventory (gRPC) and Postgres.' }],
          delay: 900,
        };
      }
      return { events: [{ type: 'result', text: 'Replayed answer.' }], delay: 600 };
    };
  }

  /* Fit the drawing: the Fit button, or its row in the overflow menu when the pane is narrow. */
  async function doFit(page) {
    const fit = tid(page, 'wb-fit');
    if (await fit.isVisible().catch(() => false)) {
      if (await fit.isEnabled().catch(() => false)) await fit.click();
      return;
    }
    await tid(page, 'wb-more').click().catch(() => {});
    await tid(page, 'wb-more-fit').click().catch(() => {});
  }

  /* ───── whiteboard-draw ───── */
  SCENARIOS['whiteboard-draw'] = {
    small: true,
    light: true,
    async run(rig) {
      const { page } = rig;
      const state = { fast: !rig.video };
      await installReplay(page, { mode: 'ask', script: askScript(state) });
      await waitShell(page);
      const closeArch = tid(page, 'v3-tab-close-architecture');
      if (await closeArch.count()) await closeArch.first().click();
      await giveRoom(page, 150);
      await tid(page, 's2-tab-whiteboard').click();
      await tid(page, 'wb-canvas').waitFor({ timeout: 30000 });
      await sleep(900);
      rig.start();
      await rig.focus({ x: 250, y: 560, w: 900, h: 500 }, { zoom: 1.5 });
      await rig.pause(1400);
      await rig.snap('whiteboard-empty-toolbar', { small: true, light: true });
      /* The floating toolbar: select is the default, then pen, shape, text. */
      await rig.hover(tid(page, 'wb-tools').first(), 900);
      await rig.pause(900);
      await rig.type(tid(page, 'composer-field'), DRAW_Q, 32);
      await rig.pause(500);
      await page.keyboard.press('Enter');
      /* While the diagram arrives the board zooms onto its first box; the camera stays on the chat (and the wait plays fast)
         until the board has been fitted, then turns to the drawing. */
      await rig.focus({ x: 0, y: 40, w: 700, h: 600 }, { zoom: 1.7 });
      rig.fastStart();
      await rig.pause(1800);
      await tid(page, 'wb-item').first().waitFor({ timeout: 20000 });
      await rig.pause(rig.video ? 4200 : 2500);
      await doFit(page);
      rig.fastEnd();
      await rig.pause(400);
      await rig.focus(page.locator('[data-testid="wb-item"]'));
      await rig.pause(800);
      await rig.snap('whiteboard-agentic-loop-drawn', { small: true, light: true });
      rig.poster();
      /* Select and drag is the default: pick up the Model box and move it. */
      const model = page.locator('[data-item-id="model:box"]').first();
      if (await model.count()) {
        const c = await rig.center(model);
        await rig.glide(c.x, c.y, 800);
        await page.mouse.down();
        await rig.glide(c.x + 70, c.y - 40, 700);
        await page.mouse.up();
        await rig.pause(900);
        await rig.snap('whiteboard-select-drag');
        await rig.glide(c.x - 120, c.y + 90, 700);
      }
      await rig.pause(1300);
    },
  };

  /* ───── ask-in-place ───── */
  /*
   * Two clips from one walk. ask-in-place is the whiteboard ask (hover, right-click, ask, the answer with its chip);
   * ask-chat is the same on an Architecture card. For ask-chat the whiteboard ask happens off camera first, so the
   * chat already holds it, as it would in a real session.
   */
  async function askWalk(rig, part) {
      const { page } = rig;
      const onCam = part === 'whiteboard';
      /* Off camera: no real pauses, no snaps, no marks. */
      const r = onCam
        ? rig
        : Object.assign(Object.create(rig), {
            pause: async (ms) => sleep(Math.min(ms, 250)),
            glide: async (x, y) => { await page.mouse.move(x, y); rig.mx = x; rig.my = y; },
            snap: async () => {},
            poster: () => {},
            start: () => {},
            fastStart: () => {},
            fastEnd: () => {},
            type: async (loc, text) => { await loc.click(); await page.keyboard.insertText(text); },
          });
      const state = { fast: true };
      await installReplay(page, { mode: 'ask', script: askScript(state) });
      await waitShell(page);
      await giveRoom(page, 120);
      await tid(page, 's2-tab-whiteboard').click();
      await tid(page, 'wb-canvas').waitFor({ timeout: 30000 });
      await sleep(600);
      await tid(page, 'composer-field').fill(DRAW_Q);
      await page.keyboard.press('Enter');
      await tid(page, 'wb-item').first().waitFor({ timeout: 20000 });
      await sleep(4500);
      await doFit(page);
      await sleep(1500);
      await doFit(page);
      await sleep(900);
      state.fast = !onCam;
      r.start();
      if (onCam) await rig.focus(page.locator('[data-testid="wb-item"]'));
      await r.pause(1500);
      /* Hover a drawn box: the ask handle appears on it. */
      const model = page.locator('[data-item-id="model:box"]').first();
      await r.hover(model, 900);
      await r.pause(500);
      await r.click(model, 300);
      await r.pause(900);
      await r.snap('ask-in-place-hover-handle', { small: true });
      /* Right-click another box and ask from the menu. */
      const tool = page.locator('[data-item-id="tool:box"]').first();
      const tc = await r.center(tool);
      if (onCam) await rig.focus(tool, { zoom: 1.8, dy: 40 });
      await r.glide(tc.x, tc.y, 800);
      await page.mouse.click(tc.x, tc.y, { button: 'right' });
      await r.pause(900);
      await r.snap('ask-in-place-context-menu', { small: true });
      r.poster();
      await r.click(tid(page, 'ask-menu-ask'), 600);
      await r.pause(500);
      const input = tid(page, 'ask-pop-input');
      await input.waitFor({ timeout: 5000 });
      await r.type(input, 'Add a result arrow from the tool call back to the model.', 28);
      await r.pause(700);
      await r.snap('ask-in-place-popover-chip', { small: true });
      await page.keyboard.press('Enter');
      /* The wait on the replayed answer plays fast; the answer itself at normal speed. */
      if (onCam) await rig.focus({ x: 250, y: 60, w: 420, h: 520 }, { zoom: 1.7 });
      r.fastStart();
      await page.getByText(/leave the loop as drawn/).first().waitFor({ timeout: 20000 }).catch(() => {});
      r.fastEnd();
      await r.pause(2800);
      await r.settle(2500);
      await r.snap('ask-in-place-chat-reference-chip', { small: true });
      await r.pause(1200);
      /* The same on the architecture: right-click a card and ask. */
      if (onCam) return;
      state.fast = false;
      rig.start();
      await rig.focus('full', { zoom: 1.1 });
      await rig.pause(700);
      await openBoardTab(rig, 'architecture');
      await tid(page, 'board-node').first().waitFor({ timeout: 60000 });
      await rig.focus(tid(page, 'board-node'));
      await rig.pause(1200);
      const orders = tid(page, 'board-node-title').filter({ hasText: /^Orders$/ }).first();
      const oc = await rig.center(orders);
      await rig.focus(orders, { zoom: 1.8, dy: 60 });
      await rig.glide(oc.x, oc.y, 900);
      await page.mouse.click(oc.x, oc.y, { button: 'right' });
      await rig.pause(900);
      await rig.snap('ask-in-place-architecture-menu');
      rig.poster();
      await rig.click(tid(page, 'board-menu-ask-here'), 600);
      await rig.pause(500);
      await rig.type(tid(page, 'ask-pop-input'), 'What depends on this, and what would break?', 28);
      await rig.pause(700);
      await page.keyboard.press('Enter');
      /* The answer can sit behind the previous turn for a moment: wait for it to land (played fast) rather than end on "Queued". */
      await rig.focus({ x: 250, y: 200, w: 420, h: 600 }, { zoom: 1.6 });
      rig.fastStart();
      await page.getByText(/every order route would fail/).first().waitFor({ timeout: 20000 }).catch(() => {});
      rig.fastEnd();
      await rig.pause(3200);
      await rig.settle(2500);
      await rig.snap('ask-in-place-architecture-answer');
      await rig.pause(1500);
  }
  SCENARIOS['ask-in-place'] = { small: true, pace: 0.55, run: (rig) => askWalk(rig, 'whiteboard') };
  SCENARIOS['ask-chat'] = { pace: 0.55, run: (rig) => askWalk(rig, 'architecture') };

  /* ───── zoom stills: sharp 3840x2160 screenshots for the site's zoom chapter (stills only, `sharp`) ───── */
  SCENARIOS['zoom-stills'] = {
    sharp: true,
    async run(rig) {
      const { page } = rig;
      await installReplay(page, { mode: 'ask', script: askScript({ fast: true }) });
      await waitShell(page);
      await tid(page, 'board-node').first().waitFor({ timeout: 90000 });
      /* Park the pointer on empty board, away from every card, then let the map settle. */
      rig.mx = 1500; rig.my = 960;
      await page.mouse.move(rig.mx, rig.my);
      await sleep(2500);
      await rig.snap('zoom-map');
      /* Orders selected, the pointer resting on it so its Ask chip shows. */
      const orders = tid(page, 'board-node-title').filter({ hasText: /^Orders$/ }).first();
      await rig.click(orders, 0);
      await sleep(1200);
      await rig.snap('zoom-node');
      /* Ask what depends on it, and wait for the answer to land. */
      const oc = await rig.center(orders);
      await page.mouse.click(oc.x, oc.y, { button: 'right' });
      await sleep(600);
      await tid(page, 'board-menu-ask-here').click();
      const input = tid(page, 'ask-pop-input');
      await input.waitFor({ timeout: 5000 });
      await input.click();
      await page.keyboard.insertText('What depends on this, and what would break?');
      await page.keyboard.press('Enter');
      await page.getByText(/every order route would fail/).first().waitFor({ timeout: 20000 });
      rig.mx = 1500; rig.my = 960;
      await page.mouse.move(rig.mx, rig.my);
      await sleep(1500);
      await rig.snap('zoom-answer');
    },
  };
}
