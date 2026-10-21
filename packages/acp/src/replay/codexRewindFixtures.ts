/* ══════════════════════════════════════════════════════════════════════════
   EDIT FROM HERE, CODEX SIDE: A THREAD RESUMED, THEN ROLLED BACK (not run live)
   packages/acp/src/replay/codexRewindFixtures.ts

   Built from the shapes in T3 Code's CodexThreadRevert.ts (thread/turns/list,
   thread/revert { threadId, beforeTurnId }) and the older thread/rollback
   { threadId, numTurns }. Both carry `live: false`.
   ══════════════════════════════════════════════════════════════════════════ */

import type { Fixture, Frame } from './fixture.js';
import { SILENT_TOOL_THREAD } from './codexS1Fixtures.js';

const INIT: Frame[] = [
  { t: 0, dir: 'c2s', msg: { id: 1, method: 'initialize', params: { clientInfo: { name: 'sequence', title: 'Sequence', version: '0.1.0' }, capabilities: null } } },
  { t: 40, dir: 's2c', msg: { id: 1, result: { userAgent: 'codex_cli_rs/0.156.0', codexHome: '<HOME>/.codex', platformFamily: 'unix', platformOs: 'linux' } } },
  { t: 41, dir: 'c2s', msg: { method: 'initialized' } },
];

const RESUME: Frame[] = [
  {
    t: 41,
    dir: 'c2s',
    msg: { id: 2, method: 'thread/resume', params: { threadId: SILENT_TOOL_THREAD, cwd: '<CWD>', approvalPolicy: 'on-request', sandbox: 'workspace-write', excludeTurns: true } },
  },
  { t: 100, dir: 's2c', msg: { id: 2, result: { thread: { id: SILENT_TOOL_THREAD, turns: [] }, model: 'gpt-5-codex' } } },
];

const header = (scenario: string, covers: string): Fixture['header'] => ({
  kind: 'header',
  provider: 'codex-app-server',
  scenario,
  covers,
  live: false,
  notRunLive: 'Built from T3 Code CodexThreadRevert.ts and the app-server protocol names; not recorded from a live session.',
  source: 't3code apps/server/src/provider/CodexThreadRevert.ts',
  accessMode: 'autoEdit',
  prompt: '',
  answers: [],
  placeholders: { '<CWD>': 'the working directory the session runs in', '<HOME>': 'the home directory' },
});

/** Three turns on the thread; drop the last two: revert before the OLDER of the two. */
export function codexRevertFixture(): Fixture {
  return {
    header: header('rewind-revert', 'thread/turns/list newest first, then thread/revert before the oldest dropped turn'),
    frames: [
      ...INIT,
      ...RESUME,
      { t: 120, dir: 'c2s', msg: { id: 3, method: 'thread/turns/list', params: { threadId: SILENT_TOOL_THREAD, cursor: null, limit: 2, sortDirection: 'desc', itemsView: 'summary' } } },
      { t: 150, dir: 's2c', msg: { id: 3, result: { data: [{ id: 'turn-3' }, { id: 'turn-2' }], nextCursor: 'more' } } },
      { t: 160, dir: 'c2s', msg: { id: 4, method: 'thread/revert', params: { threadId: SILENT_TOOL_THREAD, beforeTurnId: 'turn-2' } } },
      { t: 190, dir: 's2c', msg: { id: 4, result: { thread: { id: SILENT_TOOL_THREAD } } } },
    ],
  };
}

/** An app-server with no thread/turns/list: count-based thread/rollback. */
export function codexLegacyRollbackFixture(): Fixture {
  return {
    header: header('rewind-legacy', 'thread/turns/list unknown, so thread/rollback { numTurns }'),
    frames: [
      ...INIT,
      ...RESUME,
      { t: 120, dir: 'c2s', msg: { id: 3, method: 'thread/turns/list', params: { threadId: SILENT_TOOL_THREAD, cursor: null, limit: 2, sortDirection: 'desc', itemsView: 'summary' } } },
      { t: 150, dir: 's2c', msg: { id: 3, error: { code: -32601, message: 'method not found' } } },
      { t: 160, dir: 'c2s', msg: { id: 4, method: 'thread/rollback', params: { threadId: SILENT_TOOL_THREAD, numTurns: 2 } } },
      { t: 190, dir: 's2c', msg: { id: 4, result: { thread: { id: SILENT_TOOL_THREAD } } } },
    ],
  };
}

/** The thread holds one turn but two were to be dropped: nothing may be reverted. */
export function codexShortThreadFixture(): Fixture {
  return {
    header: header('rewind-short', 'thread/turns/list returns fewer turns than asked, and nothing is sent after it'),
    frames: [
      ...INIT,
      ...RESUME,
      { t: 120, dir: 'c2s', msg: { id: 3, method: 'thread/turns/list', params: { threadId: SILENT_TOOL_THREAD, cursor: null, limit: 2, sortDirection: 'desc', itemsView: 'summary' } } },
      { t: 150, dir: 's2c', msg: { id: 3, result: { data: [{ id: 'turn-1' }], nextCursor: null } } },
    ],
  };
}
