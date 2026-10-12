/* ══════════════════════════════════════════════════════════════════════════
   S2a FIXTURES: THE AGENT SEES THE BOARD — NOT RUN LIVE
   packages/acp/src/replay/s2aFixtures.ts

   Recording new live sessions needs the owner's yes (and Claude is signed
   out on the recording machine), so these are built from the protocols' own
   types: codex-cli 0.153.4 `codex app-server generate-ts` (ThreadStartParams
   .config, UserInput localImage, ThreadItem mcpToolCall with readOnlyHint /
   result, ThreadItem plan, TurnStartParams.collaborationMode from
   `--experimental`, McpServerStatusUpdatedNotification) and the ACP schema
   (@agentclientprotocol/sdk: McpServerStdio, ImageContent, EmbeddedResource,
   ResourceLink, PromptCapabilities). Every header says `live: false`.

   codex-s2a/board-mcp-map   thread/start carries mcp_servers.sequence.*;
                             the agent calls sequence.map and it is answered
   codex-s2a/plan-mode       Plan: turn/start carries collaborationMode plan;
                             codex writes its plan as a plan item
   codex-s2a/image-turn      a pasted image goes as a localImage item
   claude/claude-board-session  session/new carries the stdio server
                             "sequence"; the prompt carries an image block and
                             an embedded node slice; mcp__sequence__map runs

   The client half (c2s) is what the real clients send, checked field by
   field in s2a-adapter.test.ts (the replay itself matches methods only).
   ══════════════════════════════════════════════════════════════════════════ */

import type { Fixture, FixtureHeader, Frame, Json } from './fixture.js';

/** The server a session gets, as these fixtures record it (`<MCP>` the server entry, `<CWD>` the repo). */
export const S2A_MCP = { name: 'sequence', command: 'node', args: ['<MCP>'], env: { SEQUENCE_REPO: '<CWD>', SEQUENCE_MCP_TOOLS: 'core' } };

export const S2A_MAP_TEXT =
  '# map shopfront · scanned 2026-10-06T07:00:00Z · budget 1000 · 6 services 7 edges\n' +
  '## orders (svc:orders) rank 1\n- calls payments POST /charge at orders/app/main.py:41\n- writes postgres at orders/app/db.py:12\n' +
  'omitted: 4 services below the budget';

const NOT_LIVE_CODEX = "Recording a new live session needs the owner's yes. Built from the binary's own generated protocol types around the opening the live sessions recorded.";
const NOT_LIVE_CLAUDE = "Claude is signed out on the recording machine. Built by hand from the ACP schema (@agentclientprotocol/sdk) in claude-agent-acp's documented tool shapes; never played against a live agent.";

const PLACEHOLDERS = { '<CWD>': 'the working directory the session runs in', '<HOME>': 'the home directory', '<MCP>': "Sequence's MCP server entry (packages/mcp/dist/server.js)" };

const codexHeader = (scenario: string, covers: string, source: string, accessMode: string, prompt: string): FixtureHeader => ({
  kind: 'header',
  provider: 'codex-app-server',
  scenario,
  covers,
  live: false,
  notRunLive: NOT_LIVE_CODEX,
  source,
  accessMode,
  prompt,
  answers: [],
  placeholders: PLACEHOLDERS,
});

const INIT: Frame[] = [
  { t: 0, dir: 'c2s', msg: { id: 1, method: 'initialize', params: { clientInfo: { name: 'sequence', title: 'Sequence', version: '0.1.0' }, capabilities: { experimentalApi: true, requestAttestation: false } } } },
  { t: 40, dir: 's2c', msg: { id: 1, result: { userAgent: 'codex_cli_rs/0.153.4', codexHome: '<HOME>/.codex', platformFamily: 'windows', platformOs: 'windows' } } },
  { t: 41, dir: 'c2s', msg: { method: 'initialized' } },
];

const MCP_CONFIG: Json = {
  'mcp_servers.sequence.command': S2A_MCP.command,
  'mcp_servers.sequence.args': S2A_MCP.args,
  'mcp_servers.sequence.env': S2A_MCP.env,
};

const turnOf = (id: string, status: string): Json => ({ id, items: [], status, error: null });

const threadStart = (threadId: string, sandbox: string, sandboxType: string, approvalPolicy: string): Frame[] => [
  { t: 42, dir: 'c2s', msg: { id: 2, method: 'thread/start', params: { cwd: '<CWD>', approvalPolicy, sandbox, config: MCP_CONFIG } } },
  { t: 300, dir: 's2c', msg: { id: 2, result: { thread: { id: threadId, turns: [] }, model: 'gpt-5-codex', modelProvider: 'openai', cwd: '<CWD>', approvalPolicy, sandbox: { type: sandboxType } } } },
  { t: 420, dir: 's2c', msg: { method: 'mcpServer/startupStatus/updated', params: { name: 'sequence', status: 'ready', error: null } } },
];

export function codexBoardMcpFixture(): Fixture {
  const threadId = 'thread-board-1';
  const turnId = 'turn-board-1';
  const call: Json = { type: 'mcpToolCall', id: 'mcp-map-1', server: 'sequence', tool: 'map', status: 'inProgress', arguments: { budget: 1000, focus: 'svc:orders' }, appContext: null, pluginId: null, readOnlyHint: true, result: null, error: null, durationMs: null };
  return {
    header: codexHeader(
      'board-mcp-map',
      "Sequence's board server reaches codex as a per-thread config override (thread/start config mcp_servers.sequence.*), starts, and the agent's sequence.map call is answered with the map slice (codex, not run live)",
      'codex app-server generate-ts (codex-cli 0.153.4): ThreadStartParams.config, McpServerStatusUpdatedNotification, ThreadItem mcpToolCall (readOnlyHint, result McpToolCallResult)',
      'propose',
      'What does orders call?',
    ),
    frames: [
      ...INIT,
      ...threadStart(threadId, 'read-only', 'readOnly', 'on-request'),
      { t: 421, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId } } },
      { t: 440, dir: 's2c', msg: { id: 3, result: { turn: turnOf(turnId, 'inProgress') } } },
      { t: 441, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
      { t: 1200, dir: 's2c', msg: { method: 'item/started', params: { threadId, turnId, item: call } } },
      {
        t: 1650,
        dir: 's2c',
        msg: { method: 'item/completed', params: { threadId, turnId, item: { ...call, status: 'completed', result: { content: [{ type: 'text', text: S2A_MAP_TEXT }], structuredContent: null, _meta: null }, durationMs: 430 } } },
      },
      { t: 2300, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-board-1', delta: 'orders calls payments (POST /charge, orders/app/main.py:41) and writes postgres.' } } },
      { t: 2350, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
    ],
  };
}

export const S2A_PLAN_TEXT = '1. Add `ping()` to orders/app/main.py returning "pong"\n2. Route GET /ping to it\n3. Add a test for /ping';

export function codexPlanModeFixture(): Fixture {
  const threadId = 'thread-plan-1';
  const turnId = 'turn-plan-1';
  return {
    header: codexHeader(
      'plan-mode',
      "Plan is codex's own plan mode: turn/start carries collaborationMode { mode: plan, settings: { model, reasoning_effort, developer_instructions: null } } (with the read-only sandbox kept), and codex writes its plan as a plan item (codex, not run live)",
      'codex app-server generate-ts --experimental (codex-cli 0.153.4): InitializeCapabilities.experimentalApi, TurnStartParams.collaborationMode, CollaborationMode, Settings, ModeKind, ThreadItem plan, PlanDeltaNotification',
      'plan',
      'Plan adding a ping endpoint.',
    ),
    frames: [
      ...INIT,
      ...threadStart(threadId, 'read-only', 'readOnly', 'on-request'),
      /* The once-per-codex probe: does it offer a plan preset? */
      { t: 421, dir: 'c2s', msg: { id: 3, method: 'collaborationMode/list', params: {} } },
      { t: 430, dir: 's2c', msg: { id: 3, result: { data: PRESETS } } },
      { t: 431, dir: 'c2s', msg: { id: 4, method: 'turn/start', params: { threadId } } },
      { t: 440, dir: 's2c', msg: { id: 4, result: { turn: turnOf(turnId, 'inProgress') } } },
      { t: 441, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
      { t: 900, dir: 's2c', msg: { method: 'item/started', params: { threadId, turnId, item: { type: 'plan', id: 'plan-1', text: '' } } } },
      { t: 1400, dir: 's2c', msg: { method: 'item/plan/delta', params: { threadId, turnId, itemId: 'plan-1', delta: S2A_PLAN_TEXT } } },
      { t: 1500, dir: 's2c', msg: { method: 'item/completed', params: { threadId, turnId, item: { type: 'plan', id: 'plan-1', text: S2A_PLAN_TEXT } } } },
      { t: 1600, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
    ],
  };
}

/** CollaborationModeMask[] as `collaborationMode/list` answers it (generate-ts --experimental). */
const PRESETS: Json[] = [
  { name: 'Plan', mode: 'plan', model: null, reasoning_effort: null },
  { name: 'Default', mode: 'default', model: null, reasoning_effort: null },
];

/** A codex without the experimental API: the probe is refused, and Plan is the read-only plan. */
export function codexPlanUnsupportedFixture(): Fixture {
  const threadId = 'thread-plan-2';
  const turnId = 'turn-plan-2';
  return {
    header: codexHeader(
      'plan-mode-unsupported',
      'a codex that does not offer the experimental plan mode (collaborationMode/list refused): the Plan turn goes without collaborationMode, read-only sandbox and on-request policy (the same dials as Ask), and still plans (codex, not run live)',
      'codex app-server generate-ts (codex-cli 0.153.4), plain output: no collaborationMode/list, no TurnStartParams.collaborationMode; JSON-RPC -32601 for an unknown method',
      'plan',
      'Plan adding a ping endpoint.',
    ),
    frames: [
      ...INIT,
      ...threadStart(threadId, 'read-only', 'readOnly', 'on-request'),
      { t: 421, dir: 'c2s', msg: { id: 3, method: 'collaborationMode/list', params: {} } },
      { t: 425, dir: 's2c', msg: { id: 3, error: { code: -32601, message: 'Method not found: collaborationMode/list' } } },
      { t: 426, dir: 'c2s', msg: { id: 4, method: 'turn/start', params: { threadId } } },
      { t: 440, dir: 's2c', msg: { id: 4, result: { turn: turnOf(turnId, 'inProgress') } } },
      { t: 441, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
      { t: 1500, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-plan-2', delta: S2A_PLAN_TEXT } } },
      { t: 1600, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
    ],
  };
}

/** A codex that lists plan mode but refuses it on the turn (an update that dropped the field): the turn goes again without it. */
export function codexPlanRefusedTurnFixture(): Fixture {
  const threadId = 'thread-plan-3';
  const turnId = 'turn-plan-3';
  return {
    header: codexHeader(
      'plan-mode-refused-turn',
      'a codex that refuses collaborationMode on turn/start: the same turn is started again without it (read-only plan), and the chat goes on (codex, not run live)',
      'codex app-server generate-ts --experimental (codex-cli 0.153.4): TurnStartParams.collaborationMode; a JSON-RPC -32600 invalid-params refusal',
      'plan',
      'Plan adding a ping endpoint.',
    ),
    frames: [
      ...INIT,
      ...threadStart(threadId, 'read-only', 'readOnly', 'on-request'),
      { t: 421, dir: 'c2s', msg: { id: 3, method: 'collaborationMode/list', params: {} } },
      { t: 430, dir: 's2c', msg: { id: 3, result: { data: PRESETS } } },
      { t: 431, dir: 'c2s', msg: { id: 4, method: 'turn/start', params: { threadId } } },
      { t: 435, dir: 's2c', msg: { id: 4, error: { code: -32600, message: 'Invalid request: unknown field `collaborationMode`' } } },
      { t: 436, dir: 'c2s', msg: { id: 5, method: 'turn/start', params: { threadId } } },
      { t: 450, dir: 's2c', msg: { id: 5, result: { turn: turnOf(turnId, 'inProgress') } } },
      { t: 451, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
      { t: 1500, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-plan-3', delta: S2A_PLAN_TEXT } } },
      { t: 1600, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
    ],
  };
}

/** Codex asks (McpServerElicitationRequest) before a board tool runs: "sequence" is accepted; another server's is declined. */
export function codexBoardElicitationFixture(): Fixture {
  const threadId = 'thread-elicit-1';
  const turnId = 'turn-elicit-1';
  const ask = (serverName: string, message: string): Json => ({ threadId, turnId, serverName, mode: 'form', _meta: null, message, requestedSchema: { type: 'object', properties: {} } });
  const call: Json = { type: 'mcpToolCall', id: 'mcp-map-2', server: 'sequence', tool: 'map', status: 'inProgress', arguments: { budget: 1000 }, appContext: null, pluginId: null, readOnlyHint: true, result: null, error: null, durationMs: null };
  return {
    header: codexHeader(
      'board-elicitation',
      'codex asks (mcpServer/elicitation/request) before an MCP tool runs in Ask: Sequence accepts for its own read-only "sequence" server and the map call runs; another server\'s question is declined (codex, not run live)',
      'codex app-server generate-ts (codex-cli 0.153.4): McpServerElicitationRequestParams (serverName, mode form, requestedSchema), McpServerElicitationRequestResponse (action accept | decline | cancel, content, _meta)',
      'propose',
      'What does orders call?',
    ),
    frames: [
      ...INIT,
      ...threadStart(threadId, 'read-only', 'readOnly', 'on-request'),
      { t: 421, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId } } },
      { t: 440, dir: 's2c', msg: { id: 3, result: { turn: turnOf(turnId, 'inProgress') } } },
      { t: 441, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
      { t: 1100, dir: 's2c', msg: { method: 'mcpServer/elicitation/request', id: 10, params: ask('sequence', 'Allow the sequence MCP server to run tool "map"?') } },
      { t: 1100, dir: 'c2s', msg: { id: 10, result: { action: 'accept', content: {}, _meta: null } } },
      { t: 1200, dir: 's2c', msg: { method: 'item/started', params: { threadId, turnId, item: call } } },
      { t: 1650, dir: 's2c', msg: { method: 'item/completed', params: { threadId, turnId, item: { ...call, status: 'completed', result: { content: [{ type: 'text', text: S2A_MAP_TEXT }], structuredContent: null, _meta: null }, durationMs: 430 } } } },
      { t: 1700, dir: 's2c', msg: { method: 'mcpServer/elicitation/request', id: 11, params: ask('github', 'Allow the github MCP server to run tool "create_issue"?') } },
      { t: 1700, dir: 'c2s', msg: { id: 11, result: { action: 'decline', content: null, _meta: null } } },
      { t: 2300, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-elicit-1', delta: 'orders calls payments (POST /charge, orders/app/main.py:41).' } } },
      { t: 2350, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
    ],
  };
}

export function codexImageTurnFixture(): Fixture {
  const threadId = 'thread-image-1';
  const turnId = 'turn-image-1';
  return {
    header: codexHeader(
      'image-turn',
      'a pasted image goes to codex as a localImage item (a path, not base64 in the JSON) beside the text (codex, not run live)',
      'codex app-server generate-ts (codex-cli 0.153.4): UserInput localImage',
      'propose',
      'What is wrong in this screenshot?',
    ),
    frames: [
      ...INIT,
      ...threadStart(threadId, 'read-only', 'readOnly', 'on-request'),
      { t: 421, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId } } },
      { t: 440, dir: 's2c', msg: { id: 3, result: { turn: turnOf(turnId, 'inProgress') } } },
      { t: 441, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
      { t: 1800, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-image-1', delta: 'The orders card has no edge to payments.' } } },
      { t: 1850, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
    ],
  };
}

const rpc = (msg: Json): Json => ({ jsonrpc: '2.0', ...msg });

export function claudeBoardSessionFixture(): Fixture {
  const sid = 'claude-session-board';
  const header: FixtureHeader = {
    kind: 'header',
    provider: 'acp',
    scenario: 'claude-board-session',
    covers:
      'session/new carries Sequence\'s board server (mcpServers: one stdio "sequence"); the prompt carries an image block and an embedded node slice because initialize said image and embeddedContext; mcp__sequence__map runs without asking and is answered (Claude, not run live)',
    live: false,
    notRunLive: NOT_LIVE_CLAUDE,
    source: 'ACP schema, @agentclientprotocol/sdk (McpServerStdio, EnvVariable, PromptCapabilities, ImageContent, EmbeddedResource); claude-agent-acp mcp__<server>__<tool> naming',
    accessMode: 'propose',
    prompt: 'What does orders call?',
    answers: [],
    placeholders: PLACEHOLDERS,
  };
  const update = (t: number, up: Json): Frame => ({ t, dir: 's2c', msg: rpc({ method: 'session/update', params: { sessionId: sid, update: up } }) });
  return {
    header,
    frames: [
      { t: 0, dir: 'c2s', msg: rpc({ id: 0, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: '@sequence/acp', version: '0.1.0' } } }) },
      { t: 180, dir: 's2c', msg: rpc({ id: 0, result: { protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: true, embeddedContext: true }, mcpCapabilities: { http: true, sse: true } }, authMethods: [] } }) },
      {
        t: 181,
        dir: 'c2s',
        msg: rpc({
          id: 1,
          method: 'session/new',
          params: {
            cwd: '<CWD>',
            mcpServers: [{ name: 'sequence', command: 'node', args: ['<MCP>'], env: [{ name: 'SEQUENCE_REPO', value: '<CWD>' }, { name: 'SEQUENCE_MCP_TOOLS', value: 'core' }] }],
            _meta: { claudeCode: { options: { permissionMode: 'default', allowedTools: ['mcp__sequence__*'] } } },
          },
        }),
      },
      { t: 900, dir: 's2c', msg: rpc({ id: 1, result: { sessionId: sid } }) },
      { t: 901, dir: 'c2s', msg: rpc({ id: 2, method: 'session/prompt', params: { sessionId: sid } }) },
      update(1500, { sessionUpdate: 'tool_call', toolCallId: 'toolu_map_1', title: 'mcp__sequence__map', kind: 'other', status: 'pending', rawInput: { budget: 1000, focus: 'svc:orders' } }),
      update(1950, { sessionUpdate: 'tool_call_update', toolCallId: 'toolu_map_1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: S2A_MAP_TEXT } }] }),
      update(2400, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'orders calls payments (POST /charge, orders/app/main.py:41).' } }),
      { t: 2450, dir: 's2c', msg: rpc({ id: 2, result: { stopReason: 'end_turn' } }) },
    ],
  };
}

export function s2aFixtures(): { dir: string; fixture: Fixture }[] {
  return [
    ...[codexBoardMcpFixture(), codexPlanModeFixture(), codexPlanUnsupportedFixture(), codexPlanRefusedTurnFixture(), codexBoardElicitationFixture(), codexImageTurnFixture()].map((fixture) => ({ dir: 'codex-s2a', fixture })),
    { dir: 'claude', fixture: claudeBoardSessionFixture() },
  ];
}
