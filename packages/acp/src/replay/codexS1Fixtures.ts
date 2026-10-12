/* ══════════════════════════════════════════════════════════════════════════
   S1 FIXTURES: A THREAD RESUMED AFTER A RESTART, AND A CHILD THAT HANGS
   NOT RUN LIVE
   packages/acp/src/replay/codexS1Fixtures.ts

   Recording new live sessions needs the owner's yes, so these two are built
   from codex-cli 0.153.4's own generated protocol types (`codex app-server
   generate-ts`: ThreadResumeParams { threadId, cwd, approvalPolicy, sandbox,
   excludeTurns }, ThreadResumeResponse { thread, model, ... }), around the
   opening the live sessions recorded. Both carry `live: false`, and every
   test that plays them says "not run live".

   resume-after-restart  The thread of the live long-silent-tool session,
                         reopened by a new app-server process with
                         thread/resume, then one more turn on it. The thread
                         id is the live recording's, so a test can play
                         long-silent-tool, restart, and play this.
   hung-after-start      A turn that starts, begins a command, sends one
                         heartbeat (token usage), and then never says
                         anything again.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Fixture, Frame, Json } from './fixture.js';

/** The thread the live long-silent-tool recording opened. */
export const SILENT_TOOL_THREAD = '01a10ef2-aded-75f1-8e23-92169c4fcf7b';

const INIT: Frame[] = [
  { t: 0, dir: 'c2s', msg: { id: 1, method: 'initialize', params: { clientInfo: { name: 'sequence', title: 'Sequence', version: '0.1.0' }, capabilities: null } } },
  { t: 40, dir: 's2c', msg: { id: 1, result: { userAgent: 'codex_cli_rs/0.153.4', codexHome: '<HOME>/.codex', platformFamily: 'windows', platformOs: 'windows' } } },
  { t: 41, dir: 'c2s', msg: { method: 'initialized' } },
];

const turnOf = (id: string, status: string): Json => ({ id, items: [], status, error: null });

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

export function codexResumeFixture(): Fixture {
  const threadId = SILENT_TOOL_THREAD;
  const turnId = 'turn-resume-1';
  const frames: Frame[] = [
    ...INIT,
    {
      t: 41,
      dir: 'c2s',
      msg: { id: 2, method: 'thread/resume', params: { threadId, cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'workspace-write', excludeTurns: true } },
    },
    {
      t: 210,
      dir: 's2c',
      msg: {
        id: 2,
        result: {
          thread: { id: threadId, turns: [] },
          model: 'gpt-5-codex',
          modelProvider: 'openai',
          serviceTier: null,
          cwd: '<CWD>',
          instructionSources: [],
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
          reasoningEffort: null,
          turnsBackwardsCursor: null,
          itemsBackwardsCursor: null,
        },
      },
    },
    { t: 211, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId } } },
    { t: 230, dir: 's2c', msg: { id: 3, result: { turn: turnOf(turnId, 'inProgress') } } },
    { t: 231, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
    { t: 1900, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-resume-1', delta: 'It printed "done waiting".' } } },
    { t: 1950, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } },
  ];
  return {
    header: header(
      'resume-after-restart',
      'the thread of the live long-silent-tool session reopened by a new app-server process (thread/resume), then asked what the command printed (codex, not run live)',
      'Recording a new live session needs the owner\'s yes. Built from the binary\'s own generated protocol types; the thread id is the live long-silent-tool recording\'s, so a test can play that, restart, and play this.',
      'codex app-server generate-ts (codex-cli 0.153.4): ThreadResumeParams, ThreadResumeResponse',
      'What did the command print?',
    ),
    frames,
  };
}

/**
 * ALWAYS FOR A PREFIX. Built on the live command-approval recording's shape
 * (the command wrapped in PowerShell, approvals as server requests with ids
 * from 0): the first `npm test` is answered Always (codex's session accept),
 * the second `npm test` with other arguments is answered by that rule without
 * asking anyone, and `git checkout main` (another prefix) still asks and is
 * denied.
 */
export function codexAlwaysFixture(): Fixture {
  const threadId = 'thread-always-1';
  const turnId = 'turn-always-1';
  const ps = (cmd: string): string => `"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "${cmd}"`;
  const cmds = [
    { id: 'exec-always-1', command: ps('npm test -- graph'), approval: 0, answer: 'acceptForSession', status: 'completed', out: '16 passed' },
    { id: 'exec-always-2', command: ps('npm test -- link'), approval: 1, answer: 'accept', status: 'completed', out: '4 passed' },
    { id: 'exec-always-3', command: ps('git checkout main'), approval: 2, answer: 'decline', status: 'declined', out: '' },
  ];
  const frames: Frame[] = [
    ...INIT,
    { t: 41, dir: 'c2s', msg: { id: 2, method: 'thread/start', params: { cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'read-only' } } },
    { t: 300, dir: 's2c', msg: { id: 2, result: { thread: { id: threadId, turns: [] }, model: 'gpt-5-codex', modelProvider: 'openai', cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: { type: 'readOnly' } } } },
    { t: 301, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId } } },
    { t: 320, dir: 's2c', msg: { id: 3, result: { turn: turnOf(turnId, 'inProgress') } } },
    { t: 321, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
  ];
  let t = 1000;
  for (const c of cmds) {
    const item = { type: 'commandExecution', id: c.id, command: c.command, cwd: '<CWD>', status: 'inProgress', commandActions: [], aggregatedOutput: null, exitCode: null };
    frames.push({ t, dir: 's2c', msg: { method: 'item/started', params: { threadId, turnId, item } } });
    frames.push({
      t: t + 10,
      dir: 's2c',
      msg: {
        method: 'item/commandExecution/requestApproval',
        id: c.approval,
        params: { kind: 'command', threadId, turnId, itemId: c.id, reason: 'Do you want to allow this command?', command: c.command, cwd: '<CWD>', commandActions: [] },
      },
    });
    frames.push({ t: t + 10, dir: 'c2s', msg: { id: c.approval, result: { decision: c.answer } } });
    frames.push({
      t: t + 900,
      dir: 's2c',
      msg: { method: 'item/completed', params: { threadId, turnId, item: { ...item, status: c.status, aggregatedOutput: c.out || null, exitCode: c.status === 'completed' ? 0 : null } } },
    });
    t += 1000;
  }
  frames.push({ t, dir: 's2c', msg: { method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: 'msg-always-1', delta: 'Both test runs passed; the checkout was declined.' } } });
  frames.push({ t: t + 50, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: turnOf(turnId, 'completed') } } });
  return {
    header: {
      ...header(
        'always-prefix',
        'a command answered Always, a second command with the same prefix allowed by that rule without asking, and a command with another prefix that still asks and is denied (codex, not run live)',
        'Recording a new live session needs the owner\'s yes. Built on the live command-approval recording\'s request shape and codex\'s generated protocol types (CommandExecutionApprovalDecision: accept | acceptForSession | decline).',
        'codex app-server generate-ts (codex-cli 0.153.4): CommandExecutionRequestApprovalParams, CommandExecutionApprovalDecision',
        'Run the graph and link tests, then check out main.',
      ),
      accessMode: 'propose',
      /* The questions a person answers; the second npm test is answered by the rule. */
      answers: ['always', 'deny'],
    },
    frames,
  };
}

/**
 * SIGNED OUT. The turn starts and codex fails it with its own
 * `unauthorized` code (TurnError.codexErrorInfo), as it does when the
 * ChatGPT login has expired. Not run live: signing this machine out to
 * record it would need the owner.
 */
export function codexSignedOutFixture(): Fixture {
  const threadId = 'thread-signed-out-1';
  const turnId = 'turn-signed-out-1';
  const error = { message: 'unexpected status 401 Unauthorized: Your authentication token has expired. Please log in again.', codexErrorInfo: 'unauthorized', additionalDetails: null };
  const frames: Frame[] = [
    ...INIT,
    { t: 41, dir: 'c2s', msg: { id: 2, method: 'thread/start', params: { cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'workspace-write' } } },
    { t: 300, dir: 's2c', msg: { id: 2, result: { thread: { id: threadId, turns: [] }, model: 'gpt-5-codex', modelProvider: 'openai', cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } } } },
    { t: 301, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId } } },
    { t: 320, dir: 's2c', msg: { id: 3, result: { turn: turnOf(turnId, 'inProgress') } } },
    { t: 321, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
    { t: 900, dir: 's2c', msg: { method: 'error', params: { error, willRetry: false, threadId, turnId } } },
    { t: 901, dir: 's2c', msg: { method: 'turn/completed', params: { threadId, turn: { id: turnId, items: [], status: 'failed', error } } } },
  ];
  return {
    header: header(
      'signed-out',
      'a turn codex fails with its unauthorized error, as when the ChatGPT login has expired (codex, not run live)',
      'Signing this machine out to record it would need the owner. Built from the binary\'s own generated protocol types (ErrorNotification, TurnError, CodexErrorInfo: unauthorized).',
      'codex app-server generate-ts (codex-cli 0.153.4): ErrorNotification, TurnError, CodexErrorInfo',
      'Summarise the repo.',
    ),
    frames,
  };
}

export function codexHungFixture(): Fixture {
  const threadId = 'thread-hung-1';
  const turnId = 'turn-hung-1';
  const frames: Frame[] = [
    ...INIT,
    { t: 41, dir: 'c2s', msg: { id: 2, method: 'thread/start', params: { cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'workspace-write' } } },
    { t: 300, dir: 's2c', msg: { id: 2, result: { thread: { id: threadId, turns: [] }, model: 'gpt-5-codex', modelProvider: 'openai', cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } } } },
    { t: 301, dir: 'c2s', msg: { id: 3, method: 'turn/start', params: { threadId } } },
    { t: 320, dir: 's2c', msg: { id: 3, result: { turn: turnOf(turnId, 'inProgress') } } },
    { t: 321, dir: 's2c', msg: { method: 'turn/started', params: { threadId, turn: turnOf(turnId, 'inProgress') } } },
    {
      t: 1500,
      dir: 's2c',
      msg: { method: 'item/started', params: { threadId, turnId, item: { type: 'commandExecution', id: 'cmd-hung-1', command: 'npm test', cwd: '<CWD>', status: 'inProgress' } } },
    },
    /* A heartbeat: not progress. The watchdog must not be fed by it. */
    { t: 4000, dir: 's2c', msg: { method: 'thread/tokenUsage/updated', params: { threadId, turnId, tokenUsage: { total: { totalTokens: 1200 } } } } },
  ];
  return {
    header: header(
      'hung-after-start',
      'a turn that starts a command, sends one token-usage heartbeat, and then never speaks again (codex, not run live)',
      'A real hang cannot be recorded on purpose. Built from the binary\'s own generated protocol types around the opening the live sessions recorded.',
      'codex app-server generate-ts (codex-cli 0.153.4): TurnStartedNotification, ItemStartedNotification, ThreadTokenUsageUpdatedNotification',
      'Run the tests.',
    ),
    frames,
  };
}
