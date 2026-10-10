/*
 * The v3 clips: connect-agent, agentic-workflow, research-whiteboard.
 *
 * Same honest line as the others (see record-014.mjs and MEDIA-NOTES.md): the app, its UI and the repository are real;
 * every agent or model answer is a scripted transcript replayed through route mocks, written by hand for the demo. The
 * agent list, model lists and workflow run states are mocked too (named per clip below).
 */
export function registerV3Scenarios(ctx) {
  const { LAYOUT, SCENARIOS, R, tid, waitShell, waitBoard, installReplay, sleep } = ctx;
  const j = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  const model = (id, name, isDefault = false) => ({ id, name, efforts: EFFORTS, defaultEffort: 'medium', isDefault });
  const CAPS_BY = {
    claude: { models: [model('claude-sonnet-5', 'Sonnet 5', true), model('claude-opus-5', 'Opus 5')], efforts: EFFORTS, commands: [], skills: [] },
    codex: { models: [model('gpt-5', 'GPT-5', true), model('gpt-5-mini', 'GPT-5 mini')], efforts: EFFORTS, commands: [], skills: [] },
  };
  const AGENTS = [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }];
  /* A local model saved in Settings (Ollama on this machine), next to the two connected agents. */
  const LOCAL_CONFIG = {
    configured: true,
    provider: 'ollama',
    model: 'qwen3:8b',
    baseUrl: 'http://127.0.0.1:11434',
    profiles: [{ id: 'p-local', name: 'Qwen3 8B', nickname: 'Qwen3 8B', provider: 'ollama', model: 'qwen3:8b', baseUrl: 'http://127.0.0.1:11434', params: {} }],
    defaultProfileId: 'p-local',
  };
  async function agentMocks(page) {
    await page.route('**/api/acp/capabilities*', (r) => {
      const ref = new URL(r.request().url()).searchParams.get('agentRef') ?? 'claude';
      return r.fulfill(j(CAPS_BY[ref] ?? CAPS_BY.claude));
    });
  }

  /* ───── connect-agent: Claude Code, Codex and a local model, one chat each, all left running ───── */
  const longTurn = (lines, tools) => {
    const ev = [R.think('Reading the map first.')];
    tools.forEach(([id, title, kind], i) => {
      ev.push(R.tool(id, title, kind, 'in_progress'), { __wait: 700 }, R.tool(id, title, kind, 'completed'));
      if (lines[i]) ev.push(R.say(lines[i]));
    });
    ev.push({ __wait: 9000 }, R.done(''));
    return ev;
  };
  function connectScript() {
    return async (prompt) => {
      if (/order flow/i.test(prompt)) {
        return { events: longTurn(['The order flow starts at the gateway. ', 'Orders charges payments before it publishes order.created. '], [['c1', 'Read gateway/src/routes/orders.ts', 'read'], ['c2', 'Read orders/app/routes.py', 'read'], ['c3', 'Read payments/src/stripe.js', 'read']]), gap: 450, delay: 500, hold: true };
      }
      if (/request id/i.test(prompt)) {
        return { events: longTurn(['Adding x-request-id in the gateway. '], [['x1', 'Read gateway/src/index.ts', 'read'], ['x2', 'Edit gateway/src/index.ts', 'edit']]), gap: 450, delay: 500, hold: true };
      }
      if (/guide/i.test(prompt)) {
        const text = 'Shopfront is a gateway in front of orders, payments, shipping and invoices. Orders publishes OrderCreated; shipping subscribes.';
        return { events: [...text.split(' ').map((w) => ({ type: 'delta', text: w + ' ' })), { __wait: 8000 }, { type: 'result', text }], gap: 160, delay: 500, hold: true };
      }
      return { events: [R.done('')] };
    };
  }
  async function pickModel(rig, testid, dataModel) {
    const { page } = rig;
    await rig.click(tid(page, 'v3-model-trigger').first(), 600);
    const menu = tid(page, 's2-model-menu');
    await menu.waitFor({ timeout: 8000 });
    await rig.focus(menu);
    await rig.pause(450);
    const row = page.locator(`[data-testid="${testid}"][data-model="${dataModel}"]`).first();
    await rig.hover(row, 650);
    await rig.pause(300);
    await rig.click(row, 200);
    await rig.pause(400);
  }
  SCENARIOS['connect-agent'] = {
    async run(rig) {
      const { page } = rig;
      await installReplay(page, { mode: 'agent', script: connectScript(), agents: AGENTS });
      await agentMocks(page);
      await page.route('**/api/ai-config', (r) => r.fulfill(j(LOCAL_CONFIG)));
      await waitShell(page);
      await waitBoard(page);
      await sleep(800);
      rig.start();
      await rig.focus({ x: 250, y: 620, w: 420, h: 440 }, { zoom: 1.8 });
      await rig.pause(800);
      /* Claude Code. */
      await pickModel(rig, 'agent-model', 'claude-sonnet-5');
      await rig.snap('connect-agent-menu');
      await rig.focus({ x: 250, y: 620, w: 420, h: 440 }, { zoom: 1.8 });
      await rig.type(tid(page, 'composer-field'), 'Walk me through the order flow', 26);
      await page.keyboard.press('Enter');
      await rig.focus(LAYOUT.chat, { zoom: 1.6, dy: -200 });
      await rig.pause(1600);
      /* A second chat on Codex, while the first keeps running. */
      await rig.focus({ x: 0, y: 0, w: 700, h: 400 }, { zoom: 1.8 });
      await rig.click(tid(page, 's2-new-chat'), 600);
      await rig.pause(700);
      await pickModel(rig, 'agent-model', 'gpt-5');
      await rig.focus({ x: 250, y: 620, w: 420, h: 440 }, { zoom: 1.8 });
      await rig.type(tid(page, 'composer-field'), 'Add request ids at the gateway', 26);
      await page.keyboard.press('Enter');
      await rig.pause(1800);
      /* A third on the local model. */
      await rig.focus({ x: 0, y: 0, w: 700, h: 400 }, { zoom: 1.8 });
      await rig.click(tid(page, 's2-new-chat'), 600);
      await rig.pause(700);
      await pickModel(rig, 'v3-model-row', 'p-local');
      await rig.focus({ x: 250, y: 620, w: 420, h: 440 }, { zoom: 1.8 });
      await rig.type(tid(page, 'composer-field'), 'Summarise docs/guide.md', 26);
      await page.keyboard.press('Enter');
      await rig.pause(1500);
      /* The sidebar: three chats, three agents, each with its own mark. */
      await rig.focus(tid(page, 's2-groups'), { zoom: 1.9, dy: -60 });
      await rig.pause(1500);
      await rig.snap('connect-agent-sidebar');
      await rig.focus('full', { zoom: 1.05 });
      await rig.pause(900);
    },
  };

  /* ───── agentic-workflow: ask for a workflow, hand it to agents, watch the run loop until green ───── */
  const node = (id, title, kind, extra = {}) => ({ id, title, kind, ...extra });
  const edge = (id, from, to, kind) => ({ id, from, to, kind });
  const PROGRAM = {
    id: 'prog-green', name: 'Fix until green',
    nodes: [node('start', 'Start', 'start'), node('plan', 'Plan the fix (Claude)', 'agent'), node('loop', 'Until tests pass', 'loop', { loop: { condition: { left: 'green', op: 'falsy' }, maxIterations: 4 } }),
      node('edit', 'Edit the code (Codex)', 'agent'), node('test', 'Run the tests (Codex)', 'agent'), node('check', 'Check against the graph', 'checker'), node('end', 'Finish', 'end')],
    edges: [edge('e1', 'start', 'plan', 'seq'), edge('e2', 'plan', 'loop', 'seq'), edge('e3', 'loop', 'edit', 'loop-body'), edge('e4', 'edit', 'test', 'seq'), edge('e5', 'test', 'loop', 'loop-back'), edge('e6', 'loop', 'check', 'seq'), edge('e7', 'check', 'end', 'seq')],
  };
  /* The run's log, step by step (seconds after the run starts): plan, edit, tests fail, edit again, tests pass, check. */
  const STEPS = [
    [0, [['start', 'done'], ['plan', 'running']]],
    [2.5, [['plan', 'done'], ['loop', 'running'], ['edit', 'running']]],
    [5, [['edit', 'done'], ['test', 'running']]],
    [7.5, [['test', 'error']]],
    [10, [['edit', 'running']]],
    [12.5, [['edit', 'done'], ['test', 'running']]],
    [15, [['test', 'done'], ['loop', 'done'], ['check', 'running']]],
    [17.5, [['check', 'done'], ['end', 'done']]],
  ];
  function wfState(started) {
    const el = started ? (Date.now() - started) / 1000 : -1;
    const events = [];
    let seq = 0;
    for (const [at, list] of STEPS) {
      if (el < at) break;
      for (const [nodeId, status] of list) events.push({ seq: ++seq, at: started + at * 1000, type: 'node:status', nodeId, status });
    }
    const done = el >= 17.5;
    const last = {};
    for (const e of events) last[e.nodeId] = e.status;
    const summary = { runId: 'run-m9w0f1-0001abcd', programId: PROGRAM.id, programName: PROGRAM.name, status: done ? 'completed' : 'running', startedAt: started, lastEventSeq: seq, steps: events.length, nodesTotal: PROGRAM.nodes.length, nodesDone: Object.values(last).filter((s) => s === 'done').length, nodesError: Object.values(last).filter((s) => s === 'error').length, ...(done ? { finishedAt: started + 17500 } : {}) };
    return { summary, events };
  }
  SCENARIOS['agentic-workflow'] = {
    async run(rig) {
      const { page } = rig;
      const wf = { started: 0 };
      const script = async (prompt) => {
        if (!/workflow/i.test(prompt)) return { events: [R.done('')] };
        return {
          events: [
            R.think('A loop until the tests pass, with the graph check after it.'),
            R.tool('w1', 'Create workflow "Fix until green"', 'other', 'in_progress'), { __wait: 500 }, R.tool('w1', 'Create workflow "Fix until green"', 'other', 'completed'),
            R.tool('w2', 'Add blocks: plan (Claude), loop until tests pass: edit and test (Codex), check against the graph', 'other', 'in_progress'), { __wait: 700 }, R.tool('w2', 'Add blocks: plan (Claude), loop until tests pass: edit and test (Codex), check against the graph', 'other', 'completed'),
            R.tool('w3', 'Start run', 'other', 'in_progress'), { __wait: 300 }, R.tool('w3', 'Start run', 'other', 'completed'),
            R.say('Started **Fix until green**. Claude plans the fix, Codex edits and runs the tests in a loop until they pass, then the change is checked against the graph. Follow it in Agents.'),
            R.done(''),
          ],
          gap: 300,
          delay: 600,
        };
      };
      await installReplay(page, { mode: 'agent', script, agents: AGENTS });
      await agentMocks(page);
      /* The run appears once the agent started it; its state then follows STEPS on the clock. */
      await page.route('**/api/program/runs', (r) => r.fulfill(j({ runs: wf.started ? [wfState(wf.started).summary] : [] })));
      await page.route('**/api/program/runs?*', (r) => r.fulfill(j({ runs: wf.started ? [wfState(wf.started).summary] : [] })));
      await page.route('**/api/program/runs/*', (r) => {
        const u = new URL(r.request().url());
        if (u.pathname.endsWith('/events')) return r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
        const st = wfState(wf.started);
        return r.fulfill(j({ run: { ...st.summary, program: PROGRAM, state: {}, nodeResults: {}, notes: [] }, events: st.events }));
      });
      await page.route('**/api/workflows', (r) => r.fulfill(j({ workflows: wf.started ? [{ id: PROGRAM.id, name: PROGRAM.name, rev: 3, program: PROGRAM }] : [] })));
      await waitShell(page);
      await waitBoard(page);
      /* Off camera: this chat runs on Claude Code (the picker itself is the connect-agent clip). */
      await tid(page, 'v3-model-trigger').first().click();
      await page.locator('[data-testid="agent-model"][data-model="claude-sonnet-5"]').first().click();
      await sleep(300);
      if (await tid(page, 's2-model-menu').isVisible().catch(() => false)) await page.keyboard.press('Escape');
      await page.mouse.move(1500, 960);
      await sleep(800);
      rig.start();
      await rig.focus({ x: 250, y: 620, w: 420, h: 440 }, { zoom: 1.8 });
      await rig.pause(600);
      await rig.type(tid(page, 'composer-field'), 'Set up a workflow: Claude plans the fix, Codex edits until the tests pass, then check it against the graph', 18);
      await page.keyboard.press('Enter');
      await rig.focus(LAYOUT.chat, { zoom: 1.6, dy: -170 });
      /* The run starts when the agent's Start run call lands. */
      await page.getByText(/Start run/).first().waitFor({ timeout: 20000 }).catch(() => {});
      wf.started = Date.now();
      await page.getByText(/Follow it in Agents/).first().waitFor({ timeout: 20000 }).catch(() => {});
      await rig.pause(1300);
      await rig.snap('agentic-workflow-asked');
      /* Hand-off: the Agents tab, the workflow, its run. */
      await rig.focus({ x: 700, y: 0, w: 1220, h: 120 }, { zoom: 1.6, dy: 200 });
      await rig.click(tid(page, 's2-tab-agents'), 700);
      await tid(page, 'agents-surface').waitFor({ timeout: 20000 });
      await rig.pause(500);
      await rig.click(tid(page, 'agents-surface-tab-workflows'), 600);
      await rig.focus(tid(page, 'agents-surface'), { zoom: 1.35 });
      await rig.pause(700);
      const row = tid(page, 'activity-row').first();
      await row.waitFor({ timeout: 15000 }).catch(() => {});
      if (await row.count()) await rig.click(row, 700);
      await tid(page, 'activity-graph').waitFor({ timeout: 10000 }).catch(() => {});
      await rig.focus(tid(page, 'activity-graph'), { zoom: 1.75 });
      /* Watch it: tests fail once, the loop goes round, they pass, the graph check runs. */
      while (Date.now() - wf.started < 19500) await sleep(250);
      await rig.pause(800);
      await rig.snap('agentic-workflow-green');
      await rig.focus(tid(page, 'agents-surface'), { zoom: 1.3 });
      await rig.pause(1200);
    },
  };

  /* ───── research-whiteboard: not a codebase, a research loop drawn on the whiteboard ───── */
  const BOXES = [
    ['q', 'Question', 260, 40],
    ['lit', 'Literature search', 500, 150],
    ['hyp', 'Hypothesis', 500, 300],
    ['exp', 'Experiment', 260, 410],
    ['ana', 'Analysis', 20, 300],
    ['wr', 'Write up', 20, 470],
  ];
  const W = 170, H = 44;
  const box = ([id, , x, y]) => ({ kind: 'shape', id: `${id}:box`, shape: 'rect', from: { x, y }, to: { x: x + W, y: y + H } });
  const label = ([id, text, x, y]) => ({ kind: 'text', id, at: { x: x + 14, y: y + 25 }, text });
  const ARROWS = [
    ['a1', [430, 62], [585, 150]],
    ['a2', [585, 194], [585, 300]],
    ['a3', [500, 322], [430, 432]],
    ['a4', [260, 432], [190, 344]],
    ['a5', [105, 300], [260, 62]],
    ['a6', [105, 344], [105, 470]],
  ];
  const arrow = ([id, f, t]) => ({ kind: 'shape', id, shape: 'arrow', from: { x: f[0], y: f[1] }, to: { x: t[0], y: t[1] } });
  function researchEvents() {
    /* The boxes land together (so the board frames the whole loop from the start), then the arrows go round it. */
    const ev = [{ type: 'board:item', items: [...BOXES.map(box), ...BOXES.map(label)] }];
    for (const a of ARROWS) ev.push({ type: 'board:item', items: [arrow(a)] });
    ev.push({ type: 'board:item', items: [{ kind: 'text', id: 'refine', at: { x: 120, y: 160 }, text: 'refine' }] });
    ev.push({ type: 'result', text: 'Drew the research loop: a question leads to a literature search, a hypothesis, an experiment and its analysis, which refines the question; the analysis also feeds the write-up.' });
    return ev;
  }
  SCENARIOS['research-whiteboard'] = {
    async run(rig) {
      const { page } = rig;
      const script = async (prompt) => (/research loop/i.test(prompt) ? { events: researchEvents(), gap: (i) => (i < 2 ? 250 : 420), delay: 700 } : { events: [{ type: 'result', text: '' }] });
      await installReplay(page, { mode: 'ask', script });
      await waitShell(page);
      const closeArch = tid(page, 'v3-tab-close-architecture');
      if (await closeArch.count()) await closeArch.first().click();
      await tid(page, 's2-tab-whiteboard').click();
      await tid(page, 'wb-canvas').waitFor({ timeout: 30000 });
      await sleep(900);
      rig.start();
      await rig.focus({ x: 250, y: 620, w: 420, h: 440 }, { zoom: 1.8 });
      await rig.pause(600);
      await rig.type(tid(page, 'composer-field'), 'Draw a research loop: question, literature, hypothesis, experiment, analysis', 20);
      await page.keyboard.press('Enter');
      await rig.focus(LAYOUT.pane, { zoom: 1.2 });
      await tid(page, 'wb-item').first().waitFor({ timeout: 20000 });
      await page.getByText(/Drew the research loop/).first().waitFor({ timeout: 30000 }).catch(() => {});
      await rig.pause(600);
      const fit = tid(page, 'wb-fit');
      if (await fit.isVisible().catch(() => false)) await fit.click().catch(() => {});
      await rig.pause(500);
      await rig.focus(page.locator('[data-testid="wb-item"]'), { zoom: 1.55 });
      await rig.pause(1200);
      await rig.snap('research-whiteboard-drawn');
      /* Move a box by hand: select and drag is the default tool. */
      const exp = page.locator('[data-item-id="exp:box"]').first();
      if (await exp.count()) {
        const c = await rig.center(exp);
        await rig.glide(c.x, c.y, 700);
        await page.mouse.down();
        await rig.glide(c.x + 40, c.y + 30, 600);
        await page.mouse.up();
        await rig.pause(900);
      }
      await rig.focus({ x: 250, y: 60, w: 420, h: 400 }, { zoom: 1.6 });
      await rig.pause(1300);
    },
  };
}
