/*
 * Agent-driven clips: agents-workflows, reasoning, chat-drawings, rewind.
 * The agent's answers are REPLAYED (scripted transcripts through route mocks);
 * everything the page does with them, and the repository it reads, is real.
 */
export function registerAgentScenarios(ctx) {
  const { SCENARIOS, R, tid, waitShell, waitBoard, installReplay, sleep, giveRoom, REPO, fs, path } = ctx;

  /* ───────────── mocked run history for the Agents tab ───────────── */
  const tool = (id, title, toolKind, status, s, e, extra = {}) => ({ id, title, toolKind, status, startedAt: s, endedAt: e, ...extra });
  const agentRuns = () => {
    const NOW = Date.now();
    return [
      {
        id: 't1', agentRef: 'claude', prompt: 'Why does the order flow call payments before it publishes order.created?', text: 'Orders charges first so a failed charge never publishes an event.',
        status: 'done', error: null, stopReason: 'end_turn', startedAt: NOW - 420_000, endedAt: NOW - 360_000, model: 'claude-sonnet-5', nodeId: null,
        tools: [
          tool('r1', 'Read orders/app/routes.py', 'read', 'done', NOW - 418_000, NOW - 417_000),
          tool('task', 'Task', 'other', 'done', NOW - 416_000, NOW - 380_000, { subagent: 'Explore: trace who consumes order.created' }),
        ],
        usage: { input: 18400, output: 2100, cacheRead: 61200, cacheWrite: 0, thought: 0, total: 20500 },
      },
      {
        id: 't2', agentRef: 'codex', prompt: 'Add a request id header in the gateway and log it', text: 'Added x-request-id in gateway/src/index.ts.',
        status: 'done', error: null, stopReason: 'end_turn', startedAt: NOW - 300_000, endedAt: NOW - 210_000, model: 'gpt-5', nodeId: null,
        tools: [tool('e1', 'Edit gateway/src/index.ts', 'edit', 'done', NOW - 280_000, NOW - 270_000)],
        usage: { input: 9800, output: 1500, cacheRead: 22000, cacheWrite: 0, thought: 0, total: 11300 },
      },
      {
        id: 't3', agentRef: 'claude', prompt: 'Make payments retry the charge once on a timeout', text: 'Payments now retries the charge once when stripe.js times out.',
        status: 'done', error: null, stopReason: 'end_turn', startedAt: NOW - 250_000, endedAt: NOW - 95_000, model: 'claude-sonnet-5', nodeId: null,
        tools: [
          tool('r3', 'Read payments/src/stripe.js', 'read', 'done', NOW - 245_000, NOW - 244_000),
          tool('task2', 'Task', 'other', 'done', NOW - 240_000, NOW - 170_000, { subagent: 'general-purpose: draft the retry test' }),
        ],
        usage: { input: 22100, output: 3400, cacheRead: 48000, cacheWrite: 0, thought: 0, total: 25500 },
      },
      {
        id: 't4', agentRef: 'codex', prompt: 'Document the shipping consumer in docs/guide.md', text: 'Added a section on the shipping consumer to docs/guide.md.',
        status: 'done', error: null, stopReason: 'end_turn', startedAt: NOW - 230_000, endedAt: NOW - 120_000, model: 'gpt-5', nodeId: null,
        tools: [tool('r4', 'Read shipping/subscriber.go', 'read', 'done', NOW - 225_000, NOW - 224_000)],
        usage: { input: 7600, output: 1200, cacheRead: 15000, cacheWrite: 0, thought: 0, total: 8800 },
      },
    ];
  };

  const node = (id, title, kind, extra = {}) => ({ id, title, kind, ...extra });
  const edge = (id, from, to, kind, label) => ({ id, from, to, kind, ...(label ? { label } : {}) });
  const PROGRAM = {
    id: 'prog-fix', name: 'Fix until green',
    nodes: [node('start', 'Start', 'start'), node('plan', 'Plan the fix', 'agent'), node('loop', 'Until tests pass', 'loop', { loop: { condition: { left: 'green', op: 'falsy' }, maxIterations: 4 } }),
      node('edit', 'Edit the code', 'agent'), node('test', 'Run the tests', 'agent'), node('check', 'Verify against the graph', 'checker'), node('end', 'Finish', 'end')],
    edges: [edge('e1', 'start', 'plan', 'seq'), edge('e2', 'plan', 'loop', 'seq'), edge('e3', 'loop', 'edit', 'loop-body'), edge('e4', 'edit', 'test', 'seq'), edge('e5', 'test', 'loop', 'loop-back'), edge('e6', 'loop', 'check', 'seq'), edge('e7', 'check', 'end', 'seq')],
  };
  const summary = (runId, name, status) => ({ runId, programId: 'prog-fix', programName: name, status, startedAt: Date.now() - 600_000, lastEventSeq: 8, steps: 5, nodesTotal: 7, nodesDone: 4, nodesError: 0 });
  const programRuns = () => ({ runs: [summary('run-m1a2b3-0001abcd', 'Fix until green', 'running'), { ...summary('run-m1a2b3-0002abcd', 'Docs pass', 'completed'), finishedAt: Date.now() - 100_000 }, { ...summary('run-m1a2b3-0003abcd', 'Docs pass', 'completed'), finishedAt: Date.now() - 900_000 }] });
  const ev = (seq, nodeId, status) => ({ seq, at: Date.now() - 500_000 + seq * 1000, type: 'node:status', nodeId, status });
  const DETAIL = (runId, status) => ({
    run: { ...summary(runId, 'Fix until green', status), program: PROGRAM, state: {}, nodeResults: {}, notes: [], checkpoint: status === 'running' ? undefined : { completed: [] } },
    events: [ev(1, 'start', 'done'), ev(2, 'plan', 'done'), ev(3, 'loop', 'running'), ev(4, 'edit', 'done'), ev(5, 'test', 'done'), ev(6, 'edit', 'running')],
  });
  const j = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

  async function installProgramMocks(page) {
    await page.route('**/api/program/runs', (r) => r.fulfill(j(programRuns())));
    await page.route('**/api/program/runs?*', (r) => r.fulfill(j(programRuns())));
    await page.route('**/api/program/runs/*', (r) => {
      const u = new URL(r.request().url());
      if (u.pathname.endsWith('/events')) return r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' });
      const id = u.pathname.split('/').pop();
      return r.fulfill(j(DETAIL(id, id === 'run-m1a2b3-0001abcd' ? 'running' : 'completed')));
    });
  }

  /* ───── agents-workflows ───── */
  SCENARIOS['agents-workflows'] = {
    small: true,
    light: true,
    pace: 0.85,
    async run(rig) {
      const { page } = rig;
      await installReplay(page, { mode: 'agent', runs: agentRuns, agents: [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }] });
      await installProgramMocks(page);
      await waitShell(page);
      const closeArch = tid(page, 'v3-tab-close-architecture');
      if (await closeArch.count()) await closeArch.first().click();
      await giveRoom(page, 170);
      await tid(page, 's2-tab-agents').click();
      await tid(page, 'agents-surface').waitFor({ timeout: 20000 });
      await sleep(1200);
      rig.start();
      /* The Agents tab fills the window from the sidebar edge; frame its left part, where the run tree reads. */
      await rig.focus(tid(page, 'agents-surface'), { zoom: 1.3, dx: -260, dy: -170 });
      await rig.pause(1600);
      await rig.snap('agents-tree-context-output', { small: true, light: true });
      rig.poster();
      const twist = tid(page, 'agents-surface-twist');
      if (await twist.count()) {
        await rig.click(twist.first(), 700);
        await rig.pause(1500);
        await rig.snap('agents-tree-run-detail', { small: true });
        const open = page.locator('[data-testid="agents-surface-twist"][aria-expanded="false"]');
        for (let i = 0; i < 3 && (await open.count()) > 0; i++) {
          await rig.click(open.first(), 500);
          await rig.pause(500);
        }
        await rig.pause(1200);
        await rig.snap('agents-several-at-once');
      }
      await rig.click(tid(page, 'agents-surface-tab-workflows'), 800);
      await rig.focus(tid(page, 'agents-surface'), { zoom: 1.35 });
      await rig.pause(1700);
      await rig.snap('workflows-list-collapsed-runs', { small: true, light: true });
      const row = tid(page, 'activity-row').first();
      if (await row.count()) {
        await rig.click(row, 800);
        await tid(page, 'activity-graph').waitFor({ timeout: 8000 }).catch(() => {});
        await rig.focus(tid(page, 'activity-graph'), { zoom: 1.7 });
        await rig.pause(2200);
        await rig.snap('workflows-graph-loop', { small: true, light: true });
      }
      const terr = tid(page, 'activity-territories-toggle');
      if (await terr.count()) {
        await rig.click(terr.first(), 800);
        await rig.pause(900);
        await tid(page, 'activity-territories').evaluate((e) => e.scrollIntoView({ block: 'end' }));
        await rig.focus(tid(page, 'activity-territories'), { zoom: 1.6 });
        await rig.pause(1100);
        await rig.snap('workflows-territories');
      }
      await rig.pause(900);
    },
  };
}
