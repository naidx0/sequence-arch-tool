/*
 * Chat clips: reasoning, chat-drawings, rewind. A connected agent is replayed
 * (scripted transcripts through route mocks, nothing is sent to a model); the
 * page renders those events with the code it uses for live ones, and the kit
 * drawings are rendered by the real visual kit from the specs in the transcript.
 */
export function registerChatScenarios(ctx) {
  const { SCENARIOS, R, tid, waitShell, waitBoard, installReplay, sleep, REPO, fs, path } = ctx;

  const chunks = (text, n = 34) => {
    const out = [];
    for (let i = 0; i < text.length; ) {
      let k = Math.min(text.length, i + n);
      while (k < text.length && text[k] !== ' ' && text[k] !== '\n') k++;
      out.push(text.slice(i, k));
      i = k;
    }
    return out;
  };
  const streamText = (text, n) => chunks(text, n).map((c) => R.say(c));

  /* Source-file counts per service, read from the real repository (not typed in). */
  function filesPerService() {
    const out = {};
    for (const d of fs.readdirSync(REPO, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.') || d.name === 'docs') continue;
      let n = 0;
      const walk = (p) => {
        for (const e of fs.readdirSync(p, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(p, e.name));
          else n++;
        }
      };
      walk(path.join(REPO, d.name));
      out[d.name] = n;
    }
    return Object.entries(out).sort((a, b) => b[1] - a[1]);
  }

  /* The sequence below is read off gateway/src/routes/orders.ts and orders/app/routes.py. */
  const SEQ_SPEC = {
    title: 'Placing an order',
    actors: ['Gateway', 'Orders', 'Inventory', 'Postgres', 'Payments', 'Shipping'],
    messages: [
      { from: 'Gateway', to: 'Orders', text: 'POST /orders' },
      { from: 'Orders', to: 'Inventory', text: 'reserve_stock', note: 'gRPC' },
      { from: 'Orders', to: 'Postgres', text: 'insert order' },
      { from: 'Orders', to: 'Payments', text: 'POST /charge' },
      { from: 'Orders', to: 'Shipping', text: 'publish order.created', kind: 'async', note: 'via Redis' },
      { from: 'Orders', to: 'Gateway', text: 'order', kind: 'return' },
    ],
    numbered: true,
  };
  /* 15 edges in the scan: http 7, db 4, queue 3, grpc 1 (ground-truth.json of the fixture). */
  const DONUT_SPEC = {
    title: 'Connections by kind',
    parts: [{ label: 'HTTP', value: 7 }, { label: 'Database', value: 4 }, { label: 'Queue', value: 3 }, { label: 'gRPC', value: 1 }],
    unit: 'edges',
  };
  const barSpec = () => {
    const rows = filesPerService();
    return { title: 'Source files per service', categories: rows.map((r) => r[0]), series: [{ name: 'files', values: rows.map((r) => r[1]) }], horizontal: true, unit: 'files' };
  };
  const fence = (c, spec) => '```visual\n' + JSON.stringify({ component: c, spec }) + '\n```\n';

  const ORDER_Q = 'Show me how placing an order flows through the code, and how the connections split by kind.';
  const orderText = () =>
    'Placing an order starts at the gateway and ends with an event. I read gateway/src/routes/orders.ts and orders/app/routes.py:\n\n' +
    fence('sequence', SEQ_SPEC) +
    '\nThe scan found 15 connections between the services. Most are HTTP; the rest are database access, the order.created queue and one gRPC call:\n\n' +
    fence('donut', DONUT_SPEC) +
    '\nAnd the size of each service, by source files:\n\n' +
    fence('bar', barSpec());

  function chatScript(state) {
    return async (prompt) => {
      if (/placing an order flows/i.test(prompt)) {
        return {
          events: [
            { type: 'acp:turn-id', turnId: 'turn-1' },
            R.think('Read the gateway route and the orders route, then draw the sequence and count the edge kinds from the scan.'),
            R.tool('a', 'Read gateway/src/routes/orders.ts', 'read', 'in_progress'),
            R.tool('a', 'Read gateway/src/routes/orders.ts', 'read', 'completed'),
            R.tool('b', 'Read orders/app/routes.py', 'read', 'in_progress'),
            R.tool('b', 'Read orders/app/routes.py', 'read', 'completed'),
            ...streamText(orderText(), state.fast ? 400 : 40),
            R.ctx(31200),
            R.done(),
          ],
          gap: state.fast ? 20 : 170,
          delay: 700,
        };
      }
      if (/riskiest/i.test(prompt)) {
        return { events: [{ type: 'acp:turn-id', turnId: 'turn-2' }, ...streamText('Orders. It sits on the most paths: the gateway depends on it, and it calls payments, inventory and postgres and publishes order.created. A bug there stops orders and the shipping event.', 30), R.done()], gap: 60, delay: 400 };
      }
      if (/why does the gateway call orders/i.test(prompt)) {
        return {
          events: [
            { type: 'acp:turn-id', turnId: 'turn-r1' },
            R.think('The gateway route uses postJson against ORDERS_URL, so it is plain HTTP. gRPC appears once, from orders to inventory.'),
            R.tool('a', 'Read gateway/src/lib/http.ts', 'read', 'in_progress'),
            { __wait: 1400 },
            R.tool('a', 'Read gateway/src/lib/http.ts', 'read', 'completed'),
            ...streamText('The gateway talks to every service over plain HTTP through one helper, gateway/src/lib/http.ts, with the service address read from an environment variable. gRPC is used only once: orders to inventory.', 32),
            R.done(),
          ],
          gap: 160,
          delay: 1600,
        };
      }
      if (/grpc to reach payments/i.test(prompt)) {
        return { events: [{ type: 'acp:turn-id', turnId: 'turn-3' }, ...streamText('No. Orders reaches payments over HTTP (POST /charge); only its call to inventory is gRPC.', 28), R.done()], gap: 60, delay: 400 };
      }
      return { events: [...streamText('Replayed answer.'), R.done()], delay: 500 };
    };
  }

  /* ───── reasoning ───── */
  SCENARIOS['reasoning'] = {
    small: true,
    light: true,
    pace: 0.9,
    async run(rig) {
      const { page } = rig;
      const state = { fast: false };
      await installReplay(page, { mode: 'agent', script: chatScript(state) });
      await waitShell(page);
      await waitBoard(page);
      await page.waitForFunction(() => /Sonnet/.test(document.querySelector('[data-testid="v3-model-label"]')?.textContent ?? ''), null, { timeout: 15000 });
      rig.start();
      await rig.pause(1400);
      await rig.click(tid(page, 'v3-model-trigger').first(), 800);
      await page.locator('.s2-rt').waitFor({ timeout: 8000 });
      await rig.pause(900);
      await rig.snap('reasoning-slider-open', { small: true, light: true });
      rig.poster();
      const dots = page.locator('.s2-rt-dot');
      const n = await dots.count();
      /* Faster to Smarter: step to the first notch, up through every notch, then settle on the middle. */
      const order = [0, ...Array.from({ length: n - 1 }, (_, k) => k + 1), Math.floor(n / 2)];
      for (const i of order) {
        await rig.click(dots.nth(i), 650);
        await rig.pause(i === n - 1 ? 1200 : 750);
        if (i === n - 1) await rig.snap('reasoning-slider-smarter', { small: true, light: true });
        if (i === 0) await rig.snap('reasoning-slider-faster', { small: true });
      }
      await rig.pause(500);
      await page.keyboard.press('Escape');
      await rig.pause(500);
      /* Ask a question: the radar loader runs while the (replayed) agent works. */
      await rig.type(tid(page, 'composer-field'), 'Why does the gateway call orders over HTTP?', 30);
      await rig.pause(400);
      await page.keyboard.press('Enter');
      await rig.pause(1500);
      await rig.snap('reasoning-working-ascii-radar', { small: true });
      await rig.pause(2800);
      await rig.settle(4500);
      /* End on the finished answer, not mid-sentence. */
      await page.getByText(/orders to inventory\./).first().waitFor({ timeout: 20000 }).catch(() => {});
      await rig.snap('reasoning-answer');
      await rig.pause(1000);
    },
  };

  /* ───── chat-drawings ───── */
  SCENARIOS['chat-drawings'] = {
    small: true,
    light: true,
    pace: 0.9,
    async run(rig) {
      const { page } = rig;
      const state = { fast: !rig.video };
      await installReplay(page, { mode: 'agent', script: chatScript(state) });
      await waitShell(page);
      const closeArch = tid(page, 'v3-tab-close-architecture');
      if (await closeArch.count()) await closeArch.first().click();
      await sleep(900);
      rig.start();
      await rig.focus(tid(page, 'composer-field'), { zoom: 1.6, dy: -120 });
      await rig.pause(1200);
      await rig.type(tid(page, 'composer-field'), ORDER_Q, 24);
      await rig.pause(500);
      await page.keyboard.press('Enter');
      await rig.focus(page.locator('section.s2-chat').first(), { zoom: 1.45, dy: -150 });
      await rig.pause(3500);
      await rig.snap('chat-drawing-streaming', { small: true });
      await page.locator('[data-testid="chat-visual-pending"]').first().waitFor({ state: 'detached', timeout: 25000 }).catch(() => {});
      await rig.pause(rig.video ? 5200 : 2500);
      const card = (k) => tid(page, 'chat-diagram').nth(k);
      const center = (k) => card(k).evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await center(0);
      await rig.focus(card(0), { zoom: 1.6 });
      await rig.pause(1300);
      await rig.snap('chat-inline-sequence-diagram', { light: true });
      rig.poster();
      await rig.pause(1800);
      await page.locator('section.s2-chat').first().hover();
      await center(1);
      await rig.focus(card(1), { zoom: 1.6 });
      await rig.pause(1800);
      await rig.snap('chat-kit-donut-card', { light: true });
      await center(2);
      await rig.focus(card(2), { zoom: 1.6 });
      await rig.pause(2000);
      await rig.snap('chat-kit-bar-chart', { small: true });
      await rig.pause(1000);
    },
  };

  /* ───── rewind (Edit from here) ───── */
  SCENARIOS['rewind'] = {
    small: true,
    light: true,
    pace: 0.9,
    async run(rig) {
      const { page } = rig;
      const state = { fast: true };
      await installReplay(page, { mode: 'agent', script: chatScript(state), onRewind: (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }) });
      await waitShell(page);
      const closeArch = tid(page, 'v3-tab-close-architecture');
      if (await closeArch.count()) await closeArch.first().click();
      await sleep(700);
      const send = async (text) => {
        await tid(page, 'composer-field').fill(text);
        await page.keyboard.press('Enter');
        await sleep(2600);
      };
      await send('Which service is the riskiest to change?');
      await send('Does orders use gRPC to reach payments?');
      state.fast = false;
      rig.start();
      await rig.focus(page.locator('.s2-run-prompt'), { zoom: 1.6 });
      await rig.pause(1500);
      await rig.snap('rewind-conversation', { small: true, light: true });
      rig.poster();
      /* Hover the second message: its Edit from here control appears. */
      const second = page.locator('.s2-run-prompt').nth(1);
      await rig.hover(second, 900);
      await rig.pause(800);
      await rig.snap('rewind-edit-from-here-hover', { small: true });
      await rig.click(tid(page, 'edit-from-here').last(), 700);
      await rig.pause(1100);
      await rig.snap('rewind-confirm-row', { small: true, light: true });
      await rig.click(tid(page, 'edit-from-here-go'), 700);
      await rig.pause(1300);
      await rig.snap('rewind-draft-back-in-composer', { small: true });
      /* Rewrite the message and go on from there. */
      const box = tid(page, 'composer-field');
      await rig.focus(box, { zoom: 1.6, dy: -200 });
      await rig.click(box, 500);
      await page.keyboard.press('Control+A');
      await page.keyboard.type('Why does the gateway call orders over HTTP?', { delay: rig.video ? 30 : 0 });
      await rig.pause(500);
      await page.keyboard.press('Enter');
      await rig.pause(5000);
      await rig.settle(3000);
      await rig.snap('rewind-new-branch', { small: true });
      await rig.pause(1000);
    },
  };
}
