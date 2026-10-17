/**
 * E3 (0.1.7): a fresh profile ran its first codex turn on the model codex's own config.toml
 * names (gpt-6.1-sol on the owner's machine) although model/list, for that ChatGPT sign-in,
 * offered only gpt-6-astra (default) and gpt-5.6-*. turn/start must then name the listed default.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { CodexAppServerClient, forgetCodexModels, resetCodexExperimentalCache, turnModel } from '../codexAppServer.js';
import { ManualClock } from '../replay/clock.js';
import { replaySpawn } from '../replay/codexReplay.js';
import { readFixture, type Json } from '../replay/fixture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'test', 'fixtures', 'replay', 'codex-s2b');

async function driven<T>(drain: () => Promise<void>, step: Promise<T>): Promise<T> {
  let done = false;
  let value: T | undefined;
  let error: unknown;
  step.then((v) => ((done = true), (value = v)), (e) => ((done = true), (error = e)));
  for (let i = 0; i < 1000 && !done; i++) await drain();
  if (!done) throw new Error('the adapter did not settle while the replay drained');
  if (error) throw error;
  return value as T;
}

function client(fixture: ReturnType<typeof readFixture>, cwd: string) {
  const h = replaySpawn(fixture, { clock: new ManualClock(), values: { '<CWD>': cwd, '<HOME>': os.homedir() } });
  return { h, c: new CodexAppServerClient({ command: 'codex', cwd, accessMode: 'propose', spawn: h.spawn }) };
}

const listed = [
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', efforts: [], isDefault: true },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', efforts: [] },
];

test('a thread model the account is not offered falls back to the listed default', () => {
  assert.equal(turnModel(undefined, 'gpt-6.1-sol', listed), 'gpt-6-astra');
});

test('no listed default: the first listed model', () => {
  assert.equal(turnModel(undefined, 'gpt-6.1-sol', [listed[1]!]), 'gpt-5.6-sol');
});

test('the user pick always wins; an offered thread model or an unknown list sends nothing', () => {
  assert.equal(turnModel('gpt-5.6-sol', 'gpt-6.1-sol', listed), 'gpt-5.6-sol');
  assert.equal(turnModel(undefined, 'gpt-5.6-sol', listed), undefined);
  assert.equal(turnModel(undefined, 'gpt-6.1-sol', []), undefined);
  assert.equal(turnModel(undefined, undefined, listed), undefined);
});

test("the turn client uses the list the picker's own client read: an unlisted thread model runs on the listed default", async () => {
  resetCodexExperimentalCache();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-e3-'));
  try {
    /* The picker: a short-lived client asks model/list (gpt-5-codex is the default, gpt-5 also listed). */
    const picker = client(readFixture(path.join(ROOT, 'capabilities.jsonl')), cwd);
    await driven(() => picker.h.drain(), picker.c.start());
    await driven(() => picker.h.drain(), picker.c.capabilities());
    await picker.c.dispose();

    /* The turn: codex says the thread runs on gpt-6.1-sol (its config.toml), which the list leaves out. */
    const turn = readFixture(path.join(ROOT, 'model-effort-turn.jsonl'));
    for (const f of turn.frames) {
      const r = f.msg.result as Json | undefined;
      if (r && typeof r.model === 'string') r.model = 'gpt-6.1-sol';
      if (f.msg.method === 'turn/start') f.msg.params = { threadId: (f.msg.params as Json).threadId, model: 'gpt-5-codex' };
    }
    const t = client(turn, cwd);
    await driven(() => t.h.drain(), t.c.start());
    await driven(() => t.h.drain(), t.c.newSession(cwd));
    await driven(() => t.h.drain(), t.c.prompt('hi'));
    const start = t.h.replay.received.find((m) => m.method === 'turn/start')!.params as Json;
    assert.equal(start.model, 'gpt-5-codex');
    assert.equal(t.c.activeModel(), 'gpt-5-codex');
    /* A sign-in change forgets the list: the thread's own model stands until the picker reads again. */
    forgetCodexModels();
    assert.equal(t.c.activeModel(), 'gpt-6.1-sol');
    await t.c.dispose();
  } finally {
    resetCodexExperimentalCache();
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
