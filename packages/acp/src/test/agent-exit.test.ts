import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AcpClient, AgentExitedError } from '../client.js';
import { recoveryOf } from '../recovery.js';

/**
 * ROUND 7, A2: "ACP agent failed. ACP connection closed." An agent that dies
 * before it answers must say why: its exit code and its last stderr lines,
 * not the SDK's "connection closed". A usage-limit line maps to a wait.
 */

const node = (script: string) => new AcpClient({ command: process.execPath, args: ['-e', script], killGraceMs: 200 });

test('an agent that exits during initialize reports its exit code and stderr, not "connection closed"', async () => {
  const client = node(`process.stderr.write('Error: Cannot find module @anthropic-ai/claude-agent-sdk\\n'); process.exit(3)`);
  try {
    await assert.rejects(client.start(), (e: Error) => {
      assert.ok(e instanceof AgentExitedError, `got ${e.name}: ${e.message}`);
      assert.match(e.message, /exited \(code 3\)/);
      assert.match(e.message, /Cannot find module @anthropic-ai\/claude-agent-sdk/);
      assert.doesNotMatch(e.message, /connection closed/i);
      assert.equal(recoveryOf(e).kind, 'retry');
      return true;
    });
  } finally {
    await client.dispose();
  }
});

test('a usage-limit message on stderr becomes a wait until the reset', async () => {
  const client = node(`process.stderr.write("You've hit your usage limit. Upgrade to Pro or try again at Oct 12th, 2026 4:36 PM.\\n"); process.exit(1)`);
  try {
    await assert.rejects(client.start(), (e: Error) => {
      assert.match(e.message, /usage limit/);
      const r = recoveryOf(e);
      assert.equal(r.kind, 'wait');
      assert.equal(typeof (r as { resetsAt?: number }).resetsAt, 'number');
      return true;
    });
  } finally {
    await client.dispose();
  }
});

test('a command that does not exist says it could not be started (install)', async () => {
  const client = new AcpClient({ command: 'definitely-not-an-agent-r7', killGraceMs: 200 });
  try {
    await assert.rejects(client.start(), (e: Error) => {
      assert.match(e.message, /could not be started/);
      assert.equal(recoveryOf(e).kind, 'install');
      return true;
    });
  } finally {
    await client.dispose();
  }
});

test('an agent that prints nothing says so', async () => {
  const client = node(`process.exit(9)`);
  try {
    await assert.rejects(client.start(), /exited \(code 9\): it printed nothing/);
  } finally {
    await client.dispose();
  }
});

/* C1: every failure carries a cause as well as a next step. All fakes: no real agent runs. */
import { causeOf } from '../recovery.js';
import { TurnHungError } from '../recovery.js';

test('failure causes: not installed, signed out, usage limit, bridge exit, timeout, network, unknown', () => {
  const enoent = Object.assign(new Error('spawn claude-agent-acp ENOENT'), { code: 'ENOENT' });
  assert.equal(causeOf(enoent), 'notInstalled');
  assert.equal(causeOf(new Error('Please log in again')), 'signedOut');
  assert.equal(causeOf(Object.assign(new Error('Authentication required'), { code: -32000 })), 'signedOut');
  assert.equal(causeOf(new Error('You have hit your usage limit. try again at Oct 12th, 2026 4:36 PM.')), 'usageLimit');
  assert.equal(causeOf(new AgentExitedError('The agent process exited (code 3): Cannot find module x', 3, 'Cannot find module x')), 'bridgeExit');
  assert.equal(causeOf(new TurnHungError(600_000)), 'timeout');
  assert.equal(causeOf(new Error('request timed out')), 'timeout');
  assert.equal(causeOf(new Error('fetch failed: getaddrinfo ENOTFOUND api.anthropic.com')), 'network');
  assert.equal(causeOf(new Error('something odd')), 'unknown');
  assert.equal(recoveryOf(new Error('something odd')).cause, 'unknown');
  assert.equal(recoveryOf(new Error('Please log in again')).cause, 'signedOut');
});
