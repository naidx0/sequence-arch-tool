import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildHandoff, buildHandoffBudgeted, planHandoffBudgeted, HANDOFF_MAX_CHARS } from '../server/agentHandoff.js';
import { cacheFile, resetHistorySummaryMemory } from '../server/askHistory.js';

/**
 * 019-10 slice 5: the agent handoff is sized from a token budget and carries a
 * summary of what does not fit; it is no longer a fixed 12k characters.
 */

const FACT = 'The deploy key rotates on the 3rd, said the user (CODEWORD-ZEBRA-91).';

function bigChat(): { turns: { role: string; text: string; at: string }[] } {
  const filler = 'Some long and unremarkable discussion of the build pipeline. '.repeat(40); /* ~2.4k chars */
  const turns = [
    { role: 'user', text: FACT, at: '2026-01-01T00:00:00Z' },
    { role: 'assistant', text: 'Got it.', at: '2026-01-01T00:00:01Z' },
  ];
  for (let i = 0; i < 120; i++) {
    turns.push({ role: i % 2 === 0 ? 'user' : 'assistant', text: `turn ${i}. ${filler}`, at: `2026-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` });
  }
  return { turns };
}

test('the fixed 12k cut loses turn 1; the budgeted handoff keeps its fact through a cached summary', async () => {
  resetHistorySummaryMemory();
  const chat = bigChat();
  const old = buildHandoff(chat, { forAgent: 'gpt' });
  assert.ok(old.length <= HANDOFF_MAX_CHARS + 400);
  assert.ok(!old.includes('CODEWORD-ZEBRA-91'), 'the 12k builder forgot it');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-handoff-budget-'));
  const file = cacheFile(dir, 'chat-h', 'handoff-summary.json');
  let calls = 0;
  const summarize = async (prompt: string): Promise<string> => {
    calls += 1;
    return prompt.includes('CODEWORD-ZEBRA-91') ? 'The user said the deploy key rotates on the 3rd (CODEWORD-ZEBRA-91).' : 'nothing';
  };
  const a = await buildHandoffBudgeted(chat, { forAgent: 'gpt' }, [], undefined, { cacheFile: file, summarize });
  assert.match(a.text, /Earlier in this chat \(\d+ turns, summarized/);
  assert.match(a.text, /CODEWORD-ZEBRA-91/);
  assert.ok(a.text.includes('turn 119.'), 'the newest turns are verbatim');
  assert.ok(a.text.length > HANDOFF_MAX_CHARS, 'sized by the window, not 12k');
  assert.ok(a.summarizedTurns > 0 && a.keptTurns > 0);
  const callsAfterFirst = calls;
  const b = await buildHandoffBudgeted(chat, { forAgent: 'gpt' }, [], undefined, { cacheFile: file, summarize });
  assert.strictEqual(b.text, a.text);
  assert.ok(calls >= 1);
  assert.strictEqual(calls, callsAfterFirst, 'no further call for the same dropped set');
});

test('with no model the handoff summary is extractive and still carries the first ask', async () => {
  resetHistorySummaryMemory();
  const out = await planHandoffBudgeted(bigChat(), [], { forAgent: 'gpt', threadReopened: false });
  assert.strictEqual(out?.kind, 'full');
  assert.match(out!.text, /CODEWORD-ZEBRA-91/);
});

test('a short chat is carried whole with no summary', async () => {
  const out = await buildHandoffBudgeted({ turns: [{ role: 'user', text: 'hi', at: '2026-01-01T00:00:00Z' }, { role: 'assistant', text: 'hello', at: '2026-01-01T00:00:01Z' }] }, { forAgent: 'gpt' }, [], undefined);
  assert.strictEqual(out.text, 'User: hi\n\nSequence: hello');
  assert.strictEqual(out.summarizedTurns, 0);
});
