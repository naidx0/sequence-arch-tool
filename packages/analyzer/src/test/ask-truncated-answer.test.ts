import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import {
  runAskPipeline,
  TRUNCATED_ANSWER_NOTE,
  type AskPipelineInput,
} from '../server/askPipeline.js';

/**
 * A TURN THAT WAS CUT OFF SAYS SO.
 *
 * Owner walk, 2026-09-19: "it also seems to render incomplete under certain
 * changes when I ran the breakdown skill." The screenshot shows a Break-it-down
 * answer that stops on a bare list marker — "Render" then "-" — and the turn
 * header reads `4.9k in · 191 out` on a local model. The model had no room
 * left; the product showed the fragment as if it were the reply.
 *
 * THE FACT WAS AVAILABLE THE WHOLE TIME. `provider.ts` has read `finish_reason`
 * since the audit that recorded "a completion truncated at max_tokens was
 * indistinguishable from a complete one", and used it at exactly one site to
 * decorate an error message. Nothing else could see it, so nothing else could
 * tell a finished answer from a severed one.
 *
 * These tests are about the CONSEQUENCE, not the plumbing: given a provider
 * that says it stopped for length, does the reader get told?
 */

function tinyRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-trunc-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const A = 1;\n');
  return repo;
}

async function ask(
  repo: string,
  reply: { text: string; finishReason?: string },
): Promise<string> {
  const graph = await scanRepo(repo, {});
  const input = {
    question: 'Break down the architecture.',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'research',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (p: string) => path.resolve(repo, p),
    repoRoot: repo,
    callProvider: async () => reply,
  } as unknown as AskPipelineInput;
  const out = await runAskPipeline(input);
  return out.text;
}

/** The owner's answer, cut where his was: a heading and a bare list marker. */
const SEVERED =
  'The parabola plotting system breaks into four stages.\n\n' +
  '**Module Detail**\n\nInput\n\n- Parameter parsing\n- Validation\n\nRender\n-';

test('an answer the model ran out of room for is marked as unfinished', async () => {
  const text = await ask(tinyRepo(), { text: SEVERED, finishReason: 'length' });

  /* THE WORDS IT DID WRITE ARE KEPT. A severed answer is still evidence — the
     first three stages above are true and the reader may only have needed
     those. Replacing them with an apology would throw away the part that
     worked, which is what the empty-answer funnel is for and this is not. */
  assert.ok(text.includes('Parameter parsing'), 'the model’s own words must survive');
  assert.ok(text.includes(TRUNCATED_ANSWER_NOTE), 'the cut must be reported');

  /* AND IT COMES LAST, because a note before the answer is read as the answer
     failing before it started. */
  assert.ok(
    text.indexOf(TRUNCATED_ANSWER_NOTE) > text.indexOf('Parameter parsing'),
    'the note belongs after the words it is about',
  );
});

test('a finished answer is not decorated', async () => {
  /*
   * THE CASE THAT PRODUCES ONLY THIS EXIT. A note that also appeared on
   * complete turns would be noise on every reply and would stop being read
   * before the first real truncation arrived.
   */
  const text = await ask(tinyRepo(), { text: 'Three stages, and here they are.', finishReason: 'stop' });
  assert.ok(!text.includes(TRUNCATED_ANSWER_NOTE));
});

test('a provider that reports no reason is not accused of truncating', async () => {
  /*
   * Absent is not `length`. Plenty of openai-compatible servers send no
   * `finish_reason` at all, and marking their every answer as unfinished would
   * be the harness inventing a fault to report — the same lie as hiding one,
   * pointed the other way.
   */
  const text = await ask(tinyRepo(), { text: 'A complete answer, reason unstated.' });
  assert.ok(!text.includes(TRUNCATED_ANSWER_NOTE));
});

test('an EMPTY answer takes the funnel’s words, not this note', async () => {
  /*
   * Two different failures, two different sentences, and a turn can only be
   * one of them. An empty reply has nothing to append a note to; it needs the
   * harness to say what happened in full. Asserting this is what stops the
   * two branches being "simplified" into one later — which would tell a reader
   * the model wrote nothing while half a list sits on their screen.
   */
  const text = await ask(tinyRepo(), { text: '   ', finishReason: 'length' });
  assert.ok(!text.includes(TRUNCATED_ANSWER_NOTE));
  assert.ok(text.trim().length > 0, 'a turn always ends in words');
});
