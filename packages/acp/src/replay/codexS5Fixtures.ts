/* ══════════════════════════════════════════════════════════════════════════
   S5 FIXTURES: STEERING A RUNNING TURN, AND A QUEUE THAT SENDS IN ORDER
   NOT RUN LIVE
   packages/acp/src/replay/codexS5Fixtures.ts

   Recording new live sessions needs the owner's yes, so these are built from
   codex-cli 0.153.4's own generated protocol types (`codex app-server
   generate-ts`): TurnSteerParams { threadId, input, expectedTurnId,
   clientUserMessageId? }, TurnSteerResponse { turnId }, CodexErrorInfo
   activeTurnNotSteerable { turnKind }, around the opening the live sessions
   recorded. All carry `live: false`, and every test that plays them says
   "not run live".

   steer-mid-turn            a turn is running; the client sends turn/steer
                             with the active turn's id; codex accepts it and
                             the same turn goes on to answer both asks.
   steer-refused-then-queued the running turn is a review, which codex will
                             not steer; the refusal comes back, the turn ends,
                             and the text the person typed goes as the next
                             turn/start on the same thread.
   queue-two-in-order        two texts were queued while a turn ran; when it
                             ends they go as two turns, first to last.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Fixture, Frame, Json } from './fixture.js';

const INIT: Frame[] = [
  { t: 0, dir: 'c2s', msg: { id: 1, method: 'initialize', params: { clientInfo: { name: 'sequence', title: 'Sequence', version: '0.1.0' }, capabilities: null } } },
  { t: 40, dir: 's2c', msg: { id: 1, result: { userAgent: 'codex_cli_rs/0.153.4', codexHome: '<HOME>/.codex', platformFamily: 'windows', platformOs: 'windows' } } },
  { t: 41, dir: 'c2s', msg: { method: 'initialized' } },
];

const turnOf = (id: string, status: string): Json => ({ id, items: [], status, error: null });

function thread(threadId: string, t: number): Frame[] {
  return [
    { t, dir: 'c2s', msg: { id: 2, method: 'thread/start', params: { cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'workspace-write' } } },
    { t: t + 250, dir: 's2c', msg: { id: 2, result: { thread: { id: threadId, turns: [] }, model: 'gpt-5-codex', modelProvider: 'openai', cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } } } },
  ];
}

/** One whole turn: the client's turn/start (request `id`), and codex answering `text`. */
function turn(id: number, threadId: string, turnId: string, t: number, text: string): Frame[] {
  return [
    { t, dir: 'c2s', msg: { id, method: 'turn/start', params: { threadId } } },
    { t: t + 20, dir: 's2c', msg: { id, result: { turn: turnOf(turnId, 'inProgress') } } },
    { t: t + 21, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
    { t: t + 900, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: `msg-${turnId}`, delta: text } } },
    { t: t + 950, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
  ];
}

const header = (scenario: string, covers: string, notRunLive: string, source: string, prompt: string): Fixture['header'] => ({
  kind: 'header',
  provider: 'codex-app-server',
  scenario,
  covers,
  live: false,
  notRunLive,
  source,
  accessMode: 'autoEdit',
  prompt,
  answers: [],
  placeholders: { '<CWD>': 'the working directory the session runs in', '<HOME>': 'the home directory' },
});

const NOT_LIVE = 'Recording a new live session needs the owner\'s yes. Built from the binary\'s own generated protocol types around the opening the live sessions recorded.';

export const STEER_TEXT = 'Also update the README when you are done.';

export function codexSteerFixture(): Fixture {
  const threadId = 'thread-steer-1';
  const turnId = 'turn-steer-1';
  const frames: Frame[] = [
    ...INIT,
    ...thread(threadId, 41),
    { t: 301, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId } } },
    { t: 320, dir: 's2c', msg: { id: 3, result: { turn: turnOf(turnId, 'inProgress') } } },
    { t: 321, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
    { t: 1800, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-1', delta: 'Fixed the parser test. ' } } },
    /* The person typed while it ran and pressed Enter. */
    { t: 2400, dir: 'c2s', msg: { id: 4, method: 'turn/steer', params: { threadId, input: [{ type: 'text', text: STEER_TEXT, text_elements: [] }], expectedTurnId: turnId } } },
    { t: 2430, dir: 's2c', msg: { id: 4, result: { turnId } } },
    { t: 2431, dir: 's2c', msg: { method: 'item/started', params: { threadId, turnId, item: { type: 'userMessage', id: 'user-steer-1', content: [{ type: 'text', text: STEER_TEXT, text_elements: [] }] } } } },
    { t: 4100, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-2', delta: 'README updated too.' } } },
    { t: 4200, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
  ];
  return {
    header: header(
      'steer-mid-turn',
      'a running turn is steered with turn/steer (expectedTurnId = the active turn) and goes on to answer both asks in the same turn (codex, not run live)',
      NOT_LIVE,
      'codex app-server generate-ts (codex-cli 0.153.4): TurnSteerParams, TurnSteerResponse, UserInput',
      'Fix the failing parser test.',
    ),
    frames,
  };
}

export const QUEUED_AFTER_REFUSAL = 'Then summarise what the review found.';

export function codexSteerRefusedFixture(): Fixture {
  const threadId = 'thread-steer-2';
  const turnId = 'turn-review-1';
  const frames: Frame[] = [
    ...INIT,
    ...thread(threadId, 41),
    { t: 301, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId } } },
    { t: 320, dir: 's2c', msg: { id: 3, result: { turn: turnOf(turnId, 'inProgress') } } },
    { t: 321, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
    { t: 1500, dir: 'c2s', msg: { id: 4, method: 'turn/steer', params: { threadId, input: [{ type: 'text', text: QUEUED_AFTER_REFUSAL, text_elements: [] }], expectedTurnId: turnId } } },
    {
      t: 1510,
      dir: 's2c',
      msg: { id: 4, error: { code: -32600, message: 'active turn is not steerable: activeTurnNotSteerable (review)', data: { codexErrorInfo: { activeTurnNotSteerable: { turnKind: 'review' } } } } },
    },
    { t: 3000, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-r', delta: 'Review: two findings.' } } },
    { t: 3050, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
    /* The refused text was queued, and goes once the turn settled. */
    ...turn(5, threadId, 'turn-after-review', 3100, 'Summary: both findings are in the parser.'),
  ];
  return {
    header: header(
      'steer-refused-then-queued',
      'a review turn refuses turn/steer (activeTurnNotSteerable); the text is queued and sent as the next turn/start once the turn ends (codex, not run live)',
      NOT_LIVE,
      'codex app-server generate-ts (codex-cli 0.153.4): TurnSteerParams, CodexErrorInfo.activeTurnNotSteerable, NonSteerableTurnKind',
      'Review the parser change.',
    ),
    frames,
  };
}

export const QUEUED = ['Now run the tests.', 'And commit if they pass.'] as const;

export function codexQueueFixture(): Fixture {
  const threadId = 'thread-queue-1';
  const frames: Frame[] = [
    ...INIT,
    ...thread(threadId, 41),
    ...turn(3, threadId, 'turn-q-0', 301, 'Fixed it.'),
    ...turn(4, threadId, 'turn-q-1', 1300, 'Tests pass.'),
    ...turn(5, threadId, 'turn-q-2', 2300, 'Committed.'),
  ];
  return {
    header: header(
      'queue-two-in-order',
      'two texts queued while a turn ran go, once it ends, as two turns on the same thread, first to last (codex, not run live)',
      NOT_LIVE,
      'codex app-server generate-ts (codex-cli 0.153.4): TurnStartParams, TurnCompletedNotification',
      'Fix the failing parser test.',
    ),
    frames,
  };
}

export function s5Fixtures(): Fixture[] {
  return [codexSteerFixture(), codexSteerRefusedFixture(), codexQueueFixture()];
}
