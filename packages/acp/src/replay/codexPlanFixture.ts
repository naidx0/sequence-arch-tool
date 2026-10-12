/* ══════════════════════════════════════════════════════════════════════════
   A CODEX TODO LIST (turn/plan/updated) — NOT RUN LIVE
   packages/acp/src/replay/codexPlanFixture.ts

   The live todo-plan session asked codex-cli 0.153.4 for its update_plan
   tool with goals off, and the app-server offered none: the agent kept the
   list in its text and no turn/plan/updated was sent (todo-plan.jsonl says
   so). The notification is in the same binary's protocol
   (`codex app-server generate-ts`: TurnPlanUpdatedNotification
   { threadId, turnId, explanation, plan: TurnPlanStep[] }, TurnPlanStep
   { step, status: 'pending' | 'inProgress' | 'completed' }), so this fixture
   is built from those types, around the opening the live sessions recorded.
   `live: false`, and every test that plays it says "not run live".
   ══════════════════════════════════════════════════════════════════════════ */

import type { Fixture, Frame, Json } from './fixture.js';

export function codexPlanFixture(): Fixture {
  const threadId = 'thread-plan-1';
  const turnId = 'turn-plan-1';
  const plan = (statuses: string[]): Json => ({
    method: 'turn/plan/updated',
    params: {
      threadId,
      turnId,
      explanation: statuses.every((s) => s === 'completed') ? 'All three steps done.' : null,
      plan: ['Inspect module setup and imports', 'Inspect request handlers', 'Summarise what the file does'].map((step, i) => ({ step, status: statuses[i] })),
    },
  });
  const frames: Frame[] = [
    { t: 0, dir: 'c2s', msg: { id: 1, method: 'initialize', params: { clientInfo: { name: 'sequence', title: 'Sequence', version: '0.1.0' }, capabilities: null } } },
    { t: 40, dir: 's2c', msg: { id: 1, result: { userAgent: 'codex_cli_rs/0.153.4', codexHome: '<HOME>/.codex', platformFamily: 'windows', platformOs: 'windows' } } },
    { t: 41, dir: 'c2s', msg: { method: 'initialized' } },
    { t: 41, dir: 'c2s', msg: { id: 2, method: 'thread/start', params: { cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'read-only' } } },
    { t: 300, dir: 's2c', msg: { id: 2, result: { thread: { id: threadId, turns: [] }, model: 'gpt-5-codex', modelProvider: 'openai', cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: { type: 'readOnly' } } } },
    { t: 301, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId } } },
    { t: 320, dir: 's2c', msg: { id: 3, result: { turn: { id: turnId, items: [], status: 'inProgress', error: null } } } },
    { t: 321, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: { id: turnId, items: [], status: 'inProgress', error: null } } } },
    { t: 2100, dir: 's2c', msg: plan(['inProgress', 'pending', 'pending']) },
    { t: 4800, dir: 's2c', msg: plan(['completed', 'inProgress', 'pending']) },
    { t: 7300, dir: 's2c', msg: plan(['completed', 'completed', 'inProgress']) },
    { t: 7400, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-1', delta: 'It serves the orders API.' } } },
    { t: 7450, dir: 's2c', msg: plan(['completed', 'completed', 'completed']) },
    { t: 7500, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: { id: turnId, items: [], status: 'completed', error: null } } } },
  ];
  return {
    header: {
      kind: 'header',
      provider: 'codex-app-server',
      scenario: 'todo-plan-synthetic',
      covers: 'a todo list created, advanced step by step and completed (turn/plan/updated), with the answer (codex, not run live)',
      live: false,
      notRunLive:
        'codex-cli 0.153.4 app-server offered no update_plan tool in the live todo-plan session, so no turn/plan/updated was ever recorded. Built from the binary\'s own generated protocol types around the opening the live sessions recorded.',
      source: 'codex app-server generate-ts (codex-cli 0.153.4): TurnPlanUpdatedNotification, TurnPlanStep',
      accessMode: 'propose',
      answers: [],
      placeholders: { '<CWD>': 'the working directory the session runs in', '<HOME>': 'the home directory' },
    },
    frames,
  };
}
