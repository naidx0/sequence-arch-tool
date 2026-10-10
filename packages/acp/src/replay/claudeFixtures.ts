/* ══════════════════════════════════════════════════════════════════════════
   CLAUDE FIXTURES, BUILT FROM THE ACP SCHEMA — NOT RUN LIVE
   packages/acp/src/replay/claudeFixtures.ts

   Claude is signed out on the recording machine, so these sessions were never
   recorded from claude-agent-acp. They are written by hand from the ACP
   schema (@agentclientprotocol/sdk 1.2.1: InitializeResponse,
   NewSessionResponse with modes, SessionNotification updates plan /
   agent_message_chunk / tool_call / tool_call_update with diff content,
   RequestPermissionRequest with allow_always / allow_once / reject_once
   options) in the shapes claude-agent-acp documents for its tools (an Edit
   with a diff, a Bash command). Every header says `live: false` and why;
   every test that plays one says "not run live" in its name.

   The client half (c2s) is the order AcpClient speaks in, checked by playing
   these against the real AcpClient (replay.test.ts).

   `bin/make-claude-fixtures.js` writes them; a test checks the checked-in
   files are exactly what this produces.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Fixture, FixtureHeader, Frame, Json } from './fixture.js';

const NOT_LIVE =
  'Claude is signed out on the recording machine. Built by hand from the ACP schema (@agentclientprotocol/sdk 1.2.1) in claude-agent-acp\'s documented tool shapes; never played against a live agent.';

const rpc = (msg: Json): Json => ({ jsonrpc: '2.0', ...msg });

function session(scenario: string, covers: string, answers: ('allow' | 'deny')[], turn: Frame[]): Fixture {
  const header: FixtureHeader = {
    kind: 'header',
    provider: 'acp',
    scenario,
    covers,
    live: false,
    notRunLive: NOT_LIVE,
    source: 'ACP schema, @agentclientprotocol/sdk 1.2.1; claude-agent-acp tool shapes',
    accessMode: 'propose',
    answers,
    placeholders: { '<CWD>': 'the working directory the session runs in' },
  };
  const sid = 'claude-session-1';
  const open: Frame[] = [
    { t: 0, dir: 'c2s', msg: rpc({ id: 0, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: '@sequence/acp', version: '0.1.0' } } }) },
    {
      t: 180,
      dir: 's2c',
      msg: rpc({
        id: 0,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: true, promptCapabilities: { image: true, embeddedContext: true }, mcpCapabilities: { http: true, sse: true } },
          authMethods: [],
        },
      }),
    },
    { t: 181, dir: 'c2s', msg: rpc({ id: 1, method: 'session/new', params: { cwd: '<CWD>', mcpServers: [] } }) },
    {
      t: 900,
      dir: 's2c',
      msg: rpc({
        id: 1,
        result: {
          sessionId: sid,
          modes: {
            currentModeId: 'default',
            availableModes: [
              { id: 'default', name: 'Default', description: 'Asks before edits and commands' },
              { id: 'acceptEdits', name: 'Accept Edits', description: 'Edits without asking' },
              { id: 'plan', name: 'Plan Mode', description: 'Plans without changing anything' },
              { id: 'bypassPermissions', name: 'Bypass Permissions', description: 'Never asks' },
            ],
          },
        },
      }),
    },
    { t: 901, dir: 'c2s', msg: rpc({ id: 2, method: 'session/prompt', params: { sessionId: sid } }) },
  ];
  const update = (t: number, u: Json): Frame => ({ t, dir: 's2c', msg: rpc({ method: 'session/update', params: { sessionId: sid, update: u } }) });
  return {
    header,
    frames: [...open, ...turn.map((f) => (f.msg.method === '__update' ? update(f.t, f.msg.params as Json) : f))],
  };
}

const u = (t: number, update: Json): Frame => ({ t, dir: 's2c', msg: { method: '__update', params: update } });

export function claudeFixtures(): Fixture[] {
  const sid = 'claude-session-1';
  const file = '<CWD>/orders/app/main.py';
  const edit = session(
    'claude-edit-approval',
    'a plan, an Edit tool call with its diff put to the client as a permission request and allowed, the call completing, and the answer (Claude, not run live)',
    ['allow'],
    [
      u(1400, { sessionUpdate: 'plan', entries: [{ content: 'Read orders/app/main.py', priority: 'high', status: 'in_progress' }, { content: 'Add ping()', priority: 'high', status: 'pending' }] }),
      u(1900, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: "I'll add a ping function." } }),
      u(2600, {
        sessionUpdate: 'tool_call',
        toolCallId: 'toolu_edit_1',
        title: 'Edit `orders/app/main.py`',
        kind: 'edit',
        status: 'pending',
        locations: [{ path: file }],
        rawInput: { file_path: file, old_string: 'app = FastAPI()\n', new_string: 'app = FastAPI()\n\n\ndef ping():\n    return "pong"\n' },
        content: [{ type: 'diff', path: file, oldText: 'app = FastAPI()\n', newText: 'app = FastAPI()\n\n\ndef ping():\n    return "pong"\n' }],
      }),
      {
        t: 2601,
        dir: 's2c',
        msg: rpc({
          id: 0,
          method: 'session/request_permission',
          params: {
            sessionId: sid,
            toolCall: { toolCallId: 'toolu_edit_1', title: 'Edit `orders/app/main.py`', kind: 'edit', status: 'pending', locations: [{ path: file }] },
            options: [
              { optionId: 'allow_always', name: 'Always Allow', kind: 'allow_always' },
              { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
              { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
            ],
          },
        }),
      },
      { t: 4100, dir: 'c2s', msg: rpc({ id: 0, result: { outcome: { outcome: 'selected', optionId: 'allow' } } }) },
      u(4200, { sessionUpdate: 'tool_call_update', toolCallId: 'toolu_edit_1', status: 'completed' }),
      u(4300, { sessionUpdate: 'plan', entries: [{ content: 'Read orders/app/main.py', priority: 'high', status: 'completed' }, { content: 'Add ping()', priority: 'high', status: 'completed' }] }),
      u(4900, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' Added ping() to orders/app/main.py.' } }),
      { t: 5000, dir: 's2c', msg: rpc({ id: 2, result: { stopReason: 'end_turn' } }) },
    ],
  );
  const command = session(
    'claude-command-denied',
    'a Bash tool call put to the client as a permission request and rejected, the call failing, and the agent saying so (Claude, not run live)',
    ['deny'],
    [
      u(1300, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: "I'll run the tests." } }),
      u(1800, { sessionUpdate: 'tool_call', toolCallId: 'toolu_bash_1', title: '`npm test`', kind: 'execute', status: 'pending', rawInput: { command: 'npm test', description: 'Run the tests' } }),
      {
        t: 1801,
        dir: 's2c',
        msg: rpc({
          id: 0,
          method: 'session/request_permission',
          params: {
            sessionId: sid,
            toolCall: { toolCallId: 'toolu_bash_1', title: '`npm test`', kind: 'execute', status: 'pending', rawInput: { command: 'npm test' } },
            options: [
              { optionId: 'allow_always', name: 'Always Allow', kind: 'allow_always' },
              { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
              { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
            ],
          },
        }),
      },
      { t: 3000, dir: 'c2s', msg: rpc({ id: 0, result: { outcome: { outcome: 'selected', optionId: 'reject' } } }) },
      u(3100, { sessionUpdate: 'tool_call_update', toolCallId: 'toolu_bash_1', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'The user rejected this command.' } }] }),
      u(3600, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' The command was rejected, so the tests did not run.' } }),
      { t: 3700, dir: 's2c', msg: rpc({ id: 2, result: { stopReason: 'end_turn' } }) },
    ],
  );
  return [edit, command, claudePlanMode()];
}

/**
 * S2b: Claude in Plan mode. session/new states its config options (model,
 * thought level) and modes; the client puts the session in `plan`
 * (session/set_mode); the agent lists its slash commands, reports usage,
 * keeps a todo list (plan entries), and ends planning with ExitPlanMode,
 * which claude-agent-acp puts to the client as a `switch_mode` permission
 * request carrying the plan. Answered Build (allow once = manually approve
 * edits); the mode switches to default and the turn ends.
 */
function claudePlanMode(): Fixture {
  const sid = 'claude-session-plan';
  const header: FixtureHeader = {
    kind: 'header',
    provider: 'acp',
    scenario: 'claude-plan-mode',
    covers:
      'Plan mode: config options and modes on session/new, set_mode plan, slash commands, usage, a todo list, and ExitPlanMode with the plan put to the client and answered Build (Claude, not run live)',
    live: false,
    notRunLive: NOT_LIVE,
    source: 'ACP schema, @agentclientprotocol/sdk 1.2.1 (SessionConfigOption, AvailableCommandsUpdate, UsageUpdate, CurrentModeUpdate); claude-agent-acp ExitPlanMode shape',
    accessMode: 'plan',
    prompt: 'Plan adding a ping endpoint.',
    answers: ['allow'],
    placeholders: { '<CWD>': 'the working directory the session runs in' },
  };
  const update = (t: number, up: Json): Frame => ({ t, dir: 's2c', msg: rpc({ method: 'session/update', params: { sessionId: sid, update: up } }) });
  const plan = '## Plan\n\n1. Add `ping()` to orders/app/main.py returning "pong"\n2. Route GET /ping to it\n3. Add a test for /ping';
  const todos = (s: string[]) => ({
    sessionUpdate: 'plan',
    entries: ['Read orders/app/main.py', 'Draft the ping plan'].map((content, i) => ({ content, priority: 'medium', status: s[i] })),
  });
  return {
    header,
    frames: [
      { t: 0, dir: 'c2s', msg: rpc({ id: 0, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: '@sequence/acp', version: '0.1.0' } } }) },
      { t: 180, dir: 's2c', msg: rpc({ id: 0, result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] } }) },
      { t: 181, dir: 'c2s', msg: rpc({ id: 1, method: 'session/new', params: { cwd: '<CWD>', mcpServers: [] } }) },
      {
        t: 900,
        dir: 's2c',
        msg: rpc({
          id: 1,
          result: {
            sessionId: sid,
            modes: {
              currentModeId: 'default',
              availableModes: [
                { id: 'default', name: 'Default' },
                { id: 'acceptEdits', name: 'Accept Edits' },
                { id: 'plan', name: 'Plan Mode' },
                { id: 'bypassPermissions', name: 'Bypass Permissions' },
              ],
            },
            configOptions: [
              {
                id: 'model',
                name: 'Model',
                category: 'model',
                type: 'select',
                currentValue: 'sonnet',
                options: [
                  { value: 'sonnet', name: 'Sonnet', description: 'Fast, for everyday tasks' },
                  { value: 'opus', name: 'Opus', description: 'For the hardest problems' },
                ],
              },
              {
                id: 'thought_level',
                name: 'Thinking',
                category: 'thought_level',
                type: 'select',
                currentValue: 'medium',
                options: [
                  { value: 'low', name: 'Low' },
                  { value: 'medium', name: 'Medium' },
                  { value: 'high', name: 'High' },
                ],
              },
            ],
          },
        }),
      },
      { t: 901, dir: 'c2s', msg: rpc({ id: 2, method: 'session/set_mode', params: { sessionId: sid, modeId: 'plan' } }) },
      { t: 950, dir: 's2c', msg: rpc({ id: 2, result: {} }) },
      update(960, {
        sessionUpdate: 'available_commands_update',
        availableCommands: [
          { name: 'compact', description: 'Clear the conversation history but keep a summary in context' },
          { name: 'review', description: 'Review a pull request', input: { hint: 'PR number or URL' } },
          { name: 'init', description: 'Initialize a CLAUDE.md file with codebase documentation' },
        ],
      }),
      { t: 961, dir: 'c2s', msg: rpc({ id: 3, method: 'session/prompt', params: { sessionId: sid } }) },
      update(1200, todos(['in_progress', 'pending'])),
      update(1300, { sessionUpdate: 'usage_update', used: 41_000, size: 200_000, cost: { amount: 0.04, currency: 'USD' } }),
      update(2400, todos(['completed', 'in_progress'])),
      update(3000, { sessionUpdate: 'tool_call', toolCallId: 'toolu_exit_1', title: 'Ready to code?', kind: 'switch_mode', status: 'pending', rawInput: { plan } }),
      {
        t: 3001,
        dir: 's2c',
        msg: rpc({
          id: 0,
          method: 'session/request_permission',
          params: {
            sessionId: sid,
            toolCall: { toolCallId: 'toolu_exit_1', title: 'Ready to code?', kind: 'switch_mode', status: 'pending', rawInput: { plan } },
            options: [
              { optionId: 'acceptEdits', name: 'Yes, and auto-accept edits', kind: 'allow_always' },
              { optionId: 'default', name: 'Yes, and manually approve edits', kind: 'allow_once' },
              { optionId: 'plan', name: 'No, keep planning', kind: 'reject_once' },
            ],
          },
        }),
      },
      { t: 5000, dir: 'c2s', msg: rpc({ id: 0, result: { outcome: { outcome: 'selected', optionId: 'default' } } }) },
      update(5100, { sessionUpdate: 'current_mode_update', currentModeId: 'default' }),
      update(5200, { sessionUpdate: 'tool_call_update', toolCallId: 'toolu_exit_1', status: 'completed' }),
      update(5300, todos(['completed', 'completed'])),
      update(5400, { sessionUpdate: 'usage_update', used: 52_000, size: 200_000, cost: { amount: 0.06, currency: 'USD' } }),
      update(5500, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'The plan is approved; I will start with ping().' } }),
      { t: 5600, dir: 's2c', msg: rpc({ id: 3, result: { stopReason: 'end_turn' } }) },
    ],
  };
}
