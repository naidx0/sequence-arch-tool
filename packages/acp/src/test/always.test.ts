/**
 * "ALWAYS FOR <PREFIX>": the prefix at arity, and what each agent is told.
 * Codex is told acceptForSession; an ACP agent gets its allow_always option.
 * The always-prefix fixture is not run live (codex-s1/).
 */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { commandPrefix, matchesPrefix, unwrapShell } from '../arity.js';
import { AcpClient } from '../client.js';
import { CodexAppServerClient } from '../codexAppServer.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn } from '../replay/codexReplay.js';
import { readFixture, type Json } from '../replay/fixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, '..', '..');
const S1 = path.join(PKG_ROOT, 'src', 'test', 'fixtures', 'replay', 'codex-s1');
const MOCK_AGENT = path.join(PKG_ROOT, 'src', 'test', 'fixtures', 'mock-agent.mjs');
const VCS = ['g', 'it'].join('');

test('the prefix is the command at its arity, never just the tool', () => {
  const cases: [string, string][] = [
    ['npm test -- graph', 'npm test'],
    [`${VCS} checkout main`, `${VCS} checkout`],
    [VCS, VCS],
    ['npm run build -- --watch', 'npm run build'],
    ['pnpm exec vitest run', 'pnpm exec vitest'],
    ['ls -la', 'ls'],
    ['node -e "console.log(1)"', 'node -e'],
    ['docker compose up -d', 'docker compose up'],
    ['C:\\tools\\npm.cmd test', 'npm test'],
  ];
  for (const [cmd, want] of cases) assert.equal(commandPrefix(cmd), want, cmd);
  assert.equal(commandPrefix('   '), null);
});

test('a shell wrapper is unwrapped: the rule is about the command the person read', () => {
  const ps = '"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "npm test -- graph"';
  assert.equal(unwrapShell(ps), 'npm test -- graph');
  assert.equal(commandPrefix(ps), 'npm test');
  assert.equal(commandPrefix(`bash -lc "${VCS} checkout main"`), `${VCS} checkout`);
  assert.equal(commandPrefix('cmd /c npx tsc -p .'), 'npx tsc');
  /* The live command-approval recording's quoting. */
  assert.equal(commandPrefix(`"C:\\\\WINDOWS\\\\powershell.exe" -Command "node -e \\"require('fs')\\""`), 'node -e');
  assert.equal(matchesPrefix('npm test -- link', 'npm test'), true);
  assert.equal(matchesPrefix(`${VCS} checkout main`, 'npm test'), false);
});

test('codex always-prefix (not run live): Always is acceptForSession, Allow is accept, Deny is decline', async () => {
  const fixture = readFixture(path.join(S1, 'always-prefix.jsonl'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-always-'));
  const clock = new ManualClock();
  const h = replaySpawn(fixture, { clock, values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  const answers: ('always' | 'allow' | 'deny')[] = ['always', 'allow', 'deny'];
  const asked: string[] = [];
  const client = new CodexAppServerClient({
    command: 'codex',
    cwd,
    accessMode: 'propose',
    spawn: h.spawn,
    onPermission: async (r) => {
      asked.push(String((r.toolCall.rawInput as Json).command));
      assert.ok(r.options.some((o) => o.kind === 'allow_always'), 'Always is offered');
      return answers.shift()!;
    },
  });
  try {
    const step = async <T>(p: Promise<T>): Promise<T> => {
      let done = false;
      p.finally(() => (done = true)).catch(() => {});
      for (let i = 0; i < 1000 && !done; i++) await h.drain();
      return p;
    };
    await step(client.start());
    await step(client.newSession(cwd));
    const r = await step(client.prompt('go'));
    assert.equal(r.stopReason, 'end_turn');
    assert.deepEqual(h.replay.state.divergences, []);
    const decisions = h.replay.received.filter((m) => m.method === undefined && (m.result as Json)?.decision).map((m) => (m.result as Json).decision);
    assert.deepEqual(decisions, ['acceptForSession', 'accept', 'decline']);
    assert.equal(asked.length, 3);
  } finally {
    await client.dispose();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

for (const [offersAlways, want] of [
  [true, 'always-1'],
  [false, 'allow-1'],
] as const) {
  test(`ACP: Always picks allow_always${offersAlways ? '' : ', and falls back to allow once (never a deny) when the agent offers none'}`, async () => {
    const client = new AcpClient({
      command: process.execPath,
      args: [MOCK_AGENT],
      killGraceMs: 500,
      env: { ...process.env, ...(offersAlways ? { MOCK_AGENT_ALWAYS: '1' } : {}) },
      spawn: childProcess.spawn,
      onPermission: () => 'always',
    });
    try {
      await client.start();
      await client.newSession();
      const r = await client.prompt('PERMISSION');
      assert.match(r.text, new RegExp(`permission=${want}`));
    } finally {
      await client.dispose();
    }
  });
}
