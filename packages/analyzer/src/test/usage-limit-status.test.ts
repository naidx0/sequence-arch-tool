import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ManualClock } from '@sequence/acp/dist/replay/clock.js';
import { replaySpawn } from '@sequence/acp/dist/replay/codexReplay.js';
import type { Json } from '@sequence/acp/dist/replay/fixture.js';

import { createRepoServer, serverSettled } from '../server/repoServer.js';
import { agentSpecimen, replayFixture, streamTurn } from './support/agentServer.js';

/**
 * ROUND 7: Codex read "Ready, ChatGPT" while Jaden's usage limit was spent
 * until Oct 12. The recorded live turn (codex-question/plan-question-usage-
 * limit) fails on usageLimitExceeded with its reset; the server remembers
 * that reset, and the providers answer then says `limited` with the time, not
 * `ready`, until the reset passes. Codex is never probed for it: the probe
 * here is a fake codex that says it is signed in, as the real one did.
 */

const RESETS_AT = 1791837379 * 1000;

const FAKE = `const a = process.argv.slice(3).join(' ');
if (a === '--version') process.stdout.write('codex-cli 0.153.4\\n');
else if (a === 'login status') process.stderr.write('Logged in using ChatGPT\\n');
else { process.stderr.write('unexpected: ' + a); process.exitCode = 2; }
`;

function fakeCodex(dir: string): void {
  fs.writeFileSync(path.join(dir, 'fake.cjs'), FAKE);
  if (process.platform === 'win32') fs.writeFileSync(path.join(dir, 'codex.cmd'), `@"${process.execPath}" "%~dp0fake.cjs" codex %*\r\n`);
  else fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.cjs')}" codex "$@"\n`, { mode: 0o755 });
}

test('a turn that hit the usage limit makes Codex read "limited" with the reset, until it passes', { timeout: 60_000 }, async () => {
  const s = agentSpecimen({ id: 'codex', command: 'codex' });
  const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-limit-bin-')));
  fakeCodex(bin);
  let now = RESETS_AT - 6 * 86400_000;
  const clock = new ManualClock();
  const h = replaySpawn(replayFixture('codex-question', 'plan-question-usage-limit'), { clock, values: { '<CWD>': s.work, '<HOME>': os.homedir() } });
  const server = await createRepoServer(null, {
    webDist: undefined,
    userConfigDir: s.store,
    acpTurn: { clock, spawn: h.spawn, killGraceMs: 0 },
    providerSearch: { pathValue: bin, extraDirs: [], capMs: 15_000 },
    agentLimitsNow: () => now,
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const codexState = async (refresh = false) => {
    const j = (await (await fetch(`${base}/api/onboarding/providers${refresh ? '?refresh=1' : ''}`)).json()) as { providers: Json[] };
    return j.providers.find((p) => p.id === 'codex')!;
  };
  try {
    assert.equal((await codexState(true)).state, 'ready', 'signed in, and no turn has said otherwise');

    const events = await streamTurn(
      base,
      { prompt: 'Plan adding rate limiting to the gateway.', permissionMode: 'plan', sessionKey: `chat::${s.chatId}::codex`, chatId: s.chatId, agentRef: 'codex' },
      h,
      async (e) => {
        if (e.type !== 'acp:question' || e.pending !== true) return;
        const answers = Object.fromEntries((e.questions as Json[]).map((q) => [q.id, [((q.options as Json[])[0] as Json).label]]));
        await fetch(`${base}/api/acp/question`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: e.requestId, answers }) });
      },
    );
    assert.deepEqual(events.find((e) => e.type === 'acp:error')?.recovery, { kind: 'wait', cause: 'usageLimit', provider: 'codex', resetsAt: RESETS_AT });

    const limited = await codexState();
    assert.equal(limited.state, 'limited');
    assert.equal(limited.limitResetsAt, RESETS_AT);
    assert.equal(limited.plan, 'ChatGPT');

    now = RESETS_AT + 1;
    assert.equal((await codexState()).state, 'ready', 'after the reset it is ready again');
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
    await serverSettled(server);
    fs.rmSync(s.dir, { recursive: true, force: true });
    fs.rmSync(bin, { recursive: true, force: true });
  }
});
