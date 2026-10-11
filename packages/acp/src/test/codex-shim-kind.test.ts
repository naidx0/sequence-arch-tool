import assert from 'node:assert/strict';
import { test } from 'node:test';

import { agentKindOf } from '../accessMode.js';

/**
 * 0.1.5 G1, the Windows .cmd shim variant. `codex` from npm is a `.cmd` shim
 * that Sequence cannot spawn, so Connect registers node plus the package's own
 * entry, `...\node_modules\@openai\codex\bin\codex.js`. The node is the one
 * beside the shim or on PATH, else this process's executable: in the installed
 * app that is Sequence.exe (run as node through ELECTRON_RUN_AS_NODE).
 *
 * agentKindOf recognised the entry only behind a command named `node`, so the
 * Sequence.exe registration was 'other' and was spoken to over ACP. codex does
 * not speak ACP: it never listed its models and never ran a turn, while
 * Settings called it Connected.
 */

const ENTRY = 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';

test("the codex package's own entry is codex, whichever node runs it", () => {
  assert.equal(agentKindOf({ command: 'C:\\Program Files\\nodejs\\node.exe', args: [ENTRY] }), 'codex-cli');
  assert.equal(agentKindOf({ command: 'C:\\Users\\me\\AppData\\Local\\Programs\\Sequence\\Sequence.exe', args: [ENTRY] }), 'codex-cli');
  assert.equal(agentKindOf({ command: '/Applications/Sequence.app/Contents/MacOS/Sequence', args: ['/usr/local/lib/node_modules/@openai/codex/bin/codex.js'] }), 'codex-cli');
});

test('controls: another script run by the app executable is not codex', () => {
  assert.equal(agentKindOf({ command: 'C:\\Users\\me\\AppData\\Local\\Programs\\Sequence\\Sequence.exe', args: ['C:\\x\\mock-agent.mjs'] }), 'other');
  assert.equal(agentKindOf({ command: 'C:\\Users\\me\\AppData\\Local\\Programs\\Sequence\\Sequence.exe', args: ['C:\\x\\my-tools\\codex.js'] }), 'other');
  assert.equal(agentKindOf({ command: 'C:\\Users\\me\\AppData\\Local\\Programs\\Sequence\\Sequence.exe', args: ['C:\\x\\claude-agent-acp\\dist\\index.js'] }), 'claude-acp');
});
