import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CodexAppServerClient } from '../codexAppServer.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn } from '../replay/codexReplay.js';
import { readFixture } from '../replay/fixture.js';

test('recorded Codex final_answer item completes before its bridge turn settles', async () => {
  const file = fileURLToPath(new URL('../../src/test/fixtures/replay/codex/long-silent-tool.jsonl', import.meta.url));
  const clock = new ManualClock();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-final-answer-'));
  const h = replaySpawn(readFixture(file), { clock, values: { '<CWD>': cwd } });
  let complete = false, settled = false;
  const client = new CodexAppServerClient({ command: 'codex', cwd, accessMode: 'autoEdit', spawn: h.spawn, onUpdate: n => {
    const meta = n.update._meta as { sequence?: { answerComplete?: boolean } } | undefined;
    if (meta?.sequence?.answerComplete) { complete = true; assert.equal(settled, false); }
  } });
  const driven = async <T>(p: Promise<T>) => {
    let done = false;
    void p.then(() => { done = true; }, () => { done = true; });
    for (let i = 0; i < 1000 && !done; i++) await h.drain();
    assert.ok(done, 'bounded replay drain');
    return p;
  };
  try {
    await driven(client.start()); await driven(client.newSession(cwd));
    const prompt = client.prompt('run it').then(r => { settled = true; return r; });
    const r = await driven(prompt);
    assert.ok(complete);
    assert.equal(r.stopReason, 'end_turn');
    assert.deepEqual(h.replay.divergences, []);
  } finally { await client.dispose(); fs.rmSync(cwd, { recursive: true, force: true }); }
});
