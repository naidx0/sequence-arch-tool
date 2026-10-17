/* ══════════════════════════════════════════════════════════════════════════
   CODEX ASKS THE PERSON A QUESTION — around ONE LIVE-RECORDED FRAME
   packages/acp/src/replay/codexQuestionFixtures.ts

   The live Plan turn of the codex gate (2026-10-06, lab/codex-live-gate.md;
   codex-cli 0.153.4, wire log sha256 bfa282ec…) sent one
   `item/tool/requestUserInput` request: two questions, three options each.
   That frame is LIVE_QUESTION below, copied verbatim from the wire (it holds
   no path, account or machine name), and so are the frames marked `live`
   beside it (the thread's waitingOnUserInput status, codex's own
   serverRequest/resolved, the collaborationMode presets, the turn's ids).

   The rest is trimmed to what the adapter needs, so the WHOLE session is not
   live and its header says `live: false`; `liveRecorded` names the live frame.
   The client frames are what Sequence sends now: on-request + read-only (the
   live run sent `untrusted`, the policy this branch replaces), and the answer
   in codex's ToolRequestUserInputResponse shape (questions.ts), where the live
   run answered -32601.

   codex-question/plan-question             the person answers by option
   codex-question/plan-question-turn-ended  the turn ends while the question
                                            waits: the adapter answers with
                                            none, so codex is never left waiting
   ══════════════════════════════════════════════════════════════════════════ */

import { PLAN_ASK_INSTRUCTION } from '../accessMode.js';
import type { Fixture, FixtureHeader, Frame, Json } from './fixture.js';

const THREAD = '01a1116e-9a96-7992-a206-779672b0be65';
const TURN = '01a1116e-9b9e-72a2-8652-a44a3c21c226';
export const QUESTION_ITEM = 'call_cQ8BB6e6iuLy3H4JpCPbfaRz';

/** item/tool/requestUserInput, wire id 2, as codex sent it live at 13:37:36.259Z. Verbatim. */
export const LIVE_QUESTION: Json = {
  method: 'item/tool/requestUserInput',
  id: 2,
  params: {
    threadId: THREAD,
    turnId: TURN,
    itemId: QUESTION_ITEM,
    questions: [
      {
        id: 'health_scope',
        header: 'Endpoint scope',
        question: 'What should the health endpoint represent? (I couldn’t inspect the local service because command access was declined.)',
        isOther: true,
        isSecret: false,
        options: [
          { label: 'Liveness only (Recommended)', description: 'Returns service/process availability; dependency failures do not make it unhealthy.' },
          { label: 'Readiness', description: 'Also verifies required dependencies before returning success.' },
          { label: 'Both endpoints', description: 'Plans separate liveness and readiness routes.' },
        ],
      },
      {
        id: 'route_contract',
        header: 'Route contract',
        question: 'Which public route/response contract should we standardize on?',
        isOther: true,
        isSecret: false,
        options: [
          { label: 'GET /health JSON (Recommended)', description: 'Use a stable JSON body such as {"status":"ok"} and HTTP 200.' },
          { label: 'GET /healthz text', description: 'Use a minimal plain-text probe endpoint.' },
          { label: 'Existing convention', description: 'Match another service; please name its repository/service in the free-text follow-up.' },
        ],
      },
    ],
    isBlocking: true,
    autoResolutionMs: null,
  },
};

/** The answer by option the plan-question fixture records (the first option of each question). */
export const OPTION_ANSWERS: Record<string, string[]> = {
  health_scope: ['Liveness only (Recommended)'],
  route_contract: ['GET /health JSON (Recommended)'],
};

export const QUESTION_PLAN_TEXT = '# Orders Service Health Check\n\nAdd `GET /health` returning `200 OK` with `{"status":"ok"}` (liveness only).';

const PROMPT = 'Plan how to add a health check endpoint to the orders service. Do not change files.';

const header = (scenario: string, covers: string): FixtureHeader => ({
  kind: 'header',
  provider: 'codex-app-server',
  scenario,
  covers,
  live: false,
  notRunLive:
    'Trimmed around one live-recorded frame: item/tool/requestUserInput (wire id 2) from the live Plan turn of 2026-10-06 is verbatim, as are the frames that sat beside it; the rest is cut to what the adapter needs, and the client frames are what Sequence sends after this change.',
  liveRecorded: 'item/tool/requestUserInput, wire id 2, codex-cli 0.153.4 live Plan turn 2026-10-06T13:37:36.259Z (lab/codex-live-gate.md, wire sha256 bfa282ec), verbatim',
  source: 'codex-cli 0.153.4 `codex app-server`, live gate wire log (Plan); shapes per generate-ts ToolRequestUserInputParams / ToolRequestUserInputResponse',
  recordedAt: '2026-10-06',
  accessMode: 'plan',
  prompt: PROMPT,
  answers: [],
  placeholders: { '<CWD>': 'the working directory the session runs in', '<HOME>': 'the home directory' },
});

const turnOf = (status: string): Json => ({ id: TURN, items: [], itemsView: 'notLoaded', status, error: null, startedAt: null, completedAt: null, durationMs: null });

/** From initialize to the question, as the Plan turn ran it. */
const OPENING: Frame[] = [
  { t: 8, dir: 'c2s', msg: { id: 1, method: 'initialize', params: { clientInfo: { name: 'sequence', title: 'Sequence', version: '0.1.0' }, capabilities: { experimentalApi: true, requestAttestation: false } } } },
  { t: 92, dir: 's2c', msg: { id: 1, result: { userAgent: 'sequence/0.153.4', codexHome: '<HOME>\\.codex', platformFamily: 'windows', platformOs: 'windows' } } },
  { t: 93, dir: 'c2s', msg: { method: 'initialized' } },
  { t: 93, dir: 'c2s', msg: { id: 2, method: 'thread/start', params: { cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'read-only', developerInstructions: PLAN_ASK_INSTRUCTION } } },
  {
    t: 359,
    dir: 's2c',
    msg: { id: 2, result: { thread: { id: THREAD, turns: [] }, model: 'gpt-5.6-terra', modelProvider: 'openai', cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: { type: 'readOnly', networkAccess: false } } },
  },
  { t: 361, dir: 'c2s', msg: { id: 3, method: 'collaborationMode/list', params: {} } },
  /* live */
  { t: 362, dir: 's2c', msg: { id: 3, result: { data: [{ name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'medium' }, { name: 'Default', mode: 'default', model: null, reasoning_effort: null }] } } },
  { t: 363, dir: 'c2s', msg: { id: 4, method: 'turn/start', params: { threadId: THREAD } } },
  /* live */
  { t: 373, dir: 's2c', msg: { id: 4, result: { turn: turnOf('inProgress') } } },
  { t: 449, dir: 's2c', msg: { method: 'turn/started', params: { threadId: THREAD, turn: { ...turnOf('inProgress'), startedAt: 1791293823 } } } },
  /* live */
  { t: 32721, dir: 's2c', msg: { method: 'thread/status/changed', params: { threadId: THREAD, status: { type: 'active', activeFlags: ['waitingOnUserInput'] } } } },
  /* LIVE-RECORDED, verbatim */
  { t: 32722, dir: 's2c', msg: LIVE_QUESTION },
];

const RESOLVED: Frame = { t: 32723, dir: 's2c', msg: { method: 'serverRequest/resolved', params: { threadId: THREAD, requestId: 2 } } };

export function codexPlanQuestionFixture(): Fixture {
  return {
    header: header(
      'plan-question',
      "codex plan mode's clarifying question (live-recorded request) reaches the client, and the person's answer goes back in codex's ToolRequestUserInputResponse shape; the plan follows",
    ),
    frames: [
      ...OPENING,
      { t: 40100, dir: 'c2s', msg: { id: 2, result: { answers: Object.fromEntries(Object.entries(OPTION_ANSWERS).map(([k, v]) => [k, { answers: v }])) } } },
      { ...RESOLVED, t: 40101 },
      { t: 40102, dir: 's2c', msg: { method: 'thread/status/changed', params: { threadId: THREAD, status: { type: 'active', activeFlags: [] } } } },
      { t: 60000, dir: 's2c', msg: { method: 'item/completed', params: { threadId: THREAD, turnId: TURN, item: { type: 'plan', id: `${TURN}-plan`, text: QUESTION_PLAN_TEXT } } } },
      { t: 64432, dir: 's2c', msg: { method: 'turn/completed', params: { threadId: THREAD, turn: turnOf('completed') } } },
    ],
  };
}

export function codexPlanQuestionTurnEndedFixture(): Fixture {
  return {
    header: header(
      'plan-question-turn-ended',
      'the turn ends while codex’s question (live-recorded request) waits: the adapter answers it with no answer, so codex is never left waiting',
    ),
    frames: [
      ...OPENING,
      { t: 33000, dir: 's2c', msg: { method: 'turn/completed', params: { threadId: THREAD, turn: turnOf('interrupted') } } },
      { t: 33001, dir: 'c2s', msg: { id: 2, result: { answers: {} } } },
    ],
  };
}

/* ── codex-question/plan-question-usage-limit ────────────────────────────
   The live Plan turn of 2026-10-06 16:34 (lab/codex-live-gate.md, the gate4
   run; codex-cli 0.153.4, wire sha256 eec37f60…), the first one that ran with
   the request_user_input developer instruction. Codex asked two questions
   through the tool, Sequence answered with the first option of each, codex
   resolved the request, and one second later the turn failed: the account's
   Codex usage limit (codexErrorInfo usageLimitExceeded), reset 6 days later.
   Every frame below is from that wire log. Redacted: the working directory
   and home paths (placeholders), the board MCP override on thread/start (it
   names this machine's checkout; the replay matches methods, not params), the
   thread/start result's session path, instruction sources and settings echo,
   the account's plan type, and codex's emittedAtMs stamps. Cut: MCP startup,
   warnings, token usage, reasoning and userMessage items, thread/started and
   thread/settings/updated. */

const UL_THREAD = '01a11211-098a-7733-b35b-f6c67b97c081';
const UL_TURN = '01a11211-0b77-7c91-aad7-c634696536f2';
export const USAGE_LIMIT_PROMPT =
  'Plan adding rate limiting to the gateway. Before you plan, ask me which limit strategy I want (per IP, per user, or per API key) and which store to keep counters in.';

/** item/tool/requestUserInput, wire id 0, as codex sent it live at 16:34:37.519Z. Verbatim. */
export const LIVE_USAGE_QUESTION: Json = {
  method: 'item/tool/requestUserInput',
  id: 0,
  params: {
    threadId: UL_THREAD,
    turnId: UL_TURN,
    itemId: 'call_1d26194a49d2431eb78859e2a2c3abb0',
    questions: [
      {
        id: 'limit_strategy',
        header: 'Limit key',
        question: 'Which identity should the gateway rate-limit on?',
        isOther: true,
        isSecret: false,
        options: [
          { label: 'Per API key (Recommended)', description: 'Best isolation for authenticated client integrations and quota enforcement.' },
          { label: 'Per user', description: "Applies one shared limit across a signed-in user's sessions and devices." },
          { label: 'Per IP', description: 'Protects anonymous/public endpoints but can group users behind NAT.' },
        ],
      },
      {
        id: 'counter_store',
        header: 'Counter store',
        question: 'Where should rate-limit counters be stored?',
        isOther: true,
        isSecret: false,
        options: [
          { label: 'Redis (Recommended)', description: 'Reliable shared atomic counters that work across multiple gateway instances.' },
          { label: 'In-memory', description: 'Simplest, but limits are per instance and reset on restart.' },
          { label: 'Database', description: 'Durable and centralized, but adds load and contention on request paths.' },
        ],
      },
    ],
    isBlocking: true,
    autoResolutionMs: null,
  },
};

/** What Sequence answered live (the first option of each question). */
export const USAGE_LIMIT_ANSWERS: Record<string, string[]> = {
  limit_strategy: ['Per API key (Recommended)'],
  counter_store: ['Redis (Recommended)'],
};

/** Codex's own error, live: the message and code on both `error` and the failed turn. */
export const LIVE_USAGE_LIMIT_ERROR: Json = {
  message: "You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at Oct 12th, 2026 4:36 PM.",
  codexErrorInfo: 'usageLimitExceeded',
  additionalDetails: null,
  misalignment: null,
};

/** The fullest rate-limit window codex reported before failing resets at this moment (epoch s). */
export const LIVE_USAGE_RESETS_AT_S = 1791837379;

export function codexPlanQuestionUsageLimitFixture(): Fixture {
  const ulTurn = (status: string, extra: Json = {}): Json => ({ id: UL_TURN, items: [], itemsView: 'notLoaded', status, error: null, startedAt: null, completedAt: null, durationMs: null, ...extra });
  const status = (st: Json): Json => ({ method: 'thread/status/changed', params: { threadId: UL_THREAD, status: st } });
  const limits = (limitId: string, primary: Json | null): Json => ({
    method: 'account/rateLimits/updated',
    params: { rateLimits: { limitId, limitName: null, primary, secondary: null, credits: { hasCredits: false, unlimited: false, balance: null }, individualLimit: null, spendControlReached: null, planType: null, rateLimitReachedType: null } },
  });
  return {
    header: {
      kind: 'header',
      provider: 'codex-app-server',
      scenario: 'plan-question-usage-limit',
      covers:
        "codex asks through request_user_input under the developer instruction, Sequence relays both questions and sends the person's answer in codex's shape, then the turn fails on the account's usage limit, which names when it resets",
      live: false,
      notRunLive:
        'Every frame is from one live run; the session is not byte-for-byte live because paths, the board MCP override, the account plan type and noise frames were redacted or cut (see codexQuestionFixtures.ts).',
      liveRecorded:
        "codex-cli 0.153.4 live Plan turn 2026-10-06T16:34:27Z (lab/codex-live-gate.md, gate4, wire sha256 eec37f60): thread/start with developerInstructions, item/tool/requestUserInput (wire id 0), Sequence's answer, serverRequest/resolved, account/rateLimits/updated, error and turn/completed (usageLimitExceeded), verbatim apart from the redactions named",
      source: 'codex-cli 0.153.4 `codex app-server`, live gate wire log (Plan, request_user_input instruction)',
      recordedAt: '2026-10-06',
      accessMode: 'plan',
      prompt: USAGE_LIMIT_PROMPT,
      answers: [],
      placeholders: { '<CWD>': 'the working directory the session runs in', '<HOME>': 'the home directory' },
    },
    frames: [
      { t: 104, dir: 'c2s', msg: { id: 1, method: 'initialize', params: { clientInfo: { name: 'sequence', title: 'Sequence', version: '0.1.0' }, capabilities: { experimentalApi: true, requestAttestation: false } } } },
      { t: 309, dir: 's2c', msg: { id: 1, result: { userAgent: 'sequence/0.153.4', codexHome: '<HOME>\\.codex', platformFamily: 'windows', platformOs: 'windows' } } },
      { t: 311, dir: 'c2s', msg: { method: 'initialized' } },
      { t: 312, dir: 'c2s', msg: { id: 2, method: 'thread/start', params: { cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'read-only', developerInstructions: PLAN_ASK_INSTRUCTION } } },
      {
        t: 1748,
        dir: 's2c',
        msg: { id: 2, result: { thread: { id: UL_THREAD, turns: [] }, model: 'gpt-5.6-terra', modelProvider: 'openai', cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: { type: 'readOnly', networkAccess: false } } },
      },
      { t: 1752, dir: 'c2s', msg: { id: 3, method: 'collaborationMode/list', params: {} } },
      { t: 1753, dir: 's2c', msg: { id: 3, result: { data: [{ name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'medium' }, { name: 'Default', mode: 'default', model: null, reasoning_effort: null }] } } },
      { t: 1754, dir: 'c2s', msg: { id: 4, method: 'turn/start', params: { threadId: UL_THREAD } } },
      { t: 1786, dir: 's2c', msg: { id: 4, result: { turn: ulTurn('inProgress') } } },
      { t: 1901, dir: 's2c', msg: status({ type: 'active', activeFlags: [] }) },
      { t: 1901, dir: 's2c', msg: { method: 'turn/started', params: { threadId: UL_THREAD, turn: ulTurn('inProgress', { startedAt: 1791304469 }) } } },
      { t: 9919, dir: 's2c', msg: status({ type: 'active', activeFlags: ['waitingOnUserInput'] }) },
      { t: 9919, dir: 's2c', msg: LIVE_USAGE_QUESTION },
      { t: 9925, dir: 'c2s', msg: { id: 0, result: { answers: Object.fromEntries(Object.entries(USAGE_LIMIT_ANSWERS).map(([k, v]) => [k, { answers: v }])) } } },
      { t: 9927, dir: 's2c', msg: { method: 'serverRequest/resolved', params: { threadId: UL_THREAD, requestId: 0 } } },
      { t: 9928, dir: 's2c', msg: status({ type: 'active', activeFlags: [] }) },
      { t: 10033, dir: 's2c', msg: limits('codex', { usedPercent: 99, windowDurationMins: 43200, resetsAt: LIVE_USAGE_RESETS_AT_S }) },
      { t: 11037, dir: 's2c', msg: limits('premium', null) },
      { t: 11038, dir: 's2c', msg: status({ type: 'systemError' }) },
      { t: 11038, dir: 's2c', msg: { method: 'error', params: { error: LIVE_USAGE_LIMIT_ERROR, willRetry: false, threadId: UL_THREAD, turnId: UL_TURN } } },
      {
        t: 11047,
        dir: 's2c',
        msg: { method: 'turn/completed', params: { threadId: UL_THREAD, turn: ulTurn('failed', { error: LIVE_USAGE_LIMIT_ERROR, startedAt: 1791304469, completedAt: 1791304478, durationMs: 9258 }) } },
      },
    ],
  };
}

export function codexQuestionFixtures(): Fixture[] {
  return [codexPlanQuestionFixture(), codexPlanQuestionTurnEndedFixture(), codexPlanQuestionUsageLimitFixture()];
}
