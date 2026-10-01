import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  describeTurnArtefacts,
  runAskPipeline,
  type AskPipelineInput,
  type AskStreamEvent,
  type TurnArtefact,
} from '../server/askPipeline.js';

/**
 * A TURN ALWAYS ENDS IN WORDS — INCLUDING THE TURN THAT ONLY DREW.
 *
 * THE REPORT, owner walking the installed app with MiniCPM5-2B, 2026-09-17:
 * "the model just drew and returned. It didn't say anything."
 *
 * WHAT HAPPENED. A round whose only output is a ```sequence-tool fence leaves
 * `text` empty — the fence is stripped out of the answer before the loop breaks
 * — so the pipeline's exit funnel fired. That funnel exists precisely to honour
 * CANON's "a turn always ends in words", and its sentence for a turn with no
 * stop reason is "I did not produce an answer for this one. Nothing was found
 * and nothing is being hidden." Beside a freshly drawn parabola, both halves
 * are false: something WAS produced, and the reader can see it.
 *
 * The funnel was never wrong about silence; it was missing the one fact that
 * makes the words true. So the ending is built from the work rows the turn
 * actually emitted, and the three endings below each have a case that produces
 * only that one.
 */

const CFG = { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' } as const;

/** y = x² over x in [-5, 5]: the owner's own ask, with the real numbers. */
const PARABOLA_ITEMS = [25, 16, 9, 4, 1, 0, 1, 4, 9, 16, 25].map((y, i) => ({
  id: `p${i}`,
  label: String(i - 5),
  value: y,
}));

function designInput(
  question: string,
  scripts: ReadonlyArray<{
    text: string;
    toolRequests?: ReadonlyArray<{ id: string; name: string; args?: Record<string, unknown> }>;
  }>,
): AskPipelineInput {
  let i = 0;
  return {
    question,
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: { title: 'Blank workspace', outline: question },
    designMode: true,
    askMode: 'implementation',
    graph: null,
    digest: undefined,
    cfg: { ...CFG },
    resolveReadable: () => null,
    repoRoot: null,
    callProvider: async () => {
      const canned = scripts[Math.min(i, scripts.length - 1)]!;
      i++;
      return {
        text: canned.text,
        ...(canned.toolRequests ? { toolRequests: canned.toolRequests } : {}),
      };
    },
  };
}

/* ------------------------------- the sentence ----------------------------- */

test('nothing drawn ⇒ no sentence: the old fallback is still right about silence', () => {
  assert.equal(describeTurnArtefacts([]), undefined);
});

test('one chart ⇒ the chart’s own title, in one line', () => {
  const said = describeTurnArtefacts([{ kind: 'chart', label: 'Regular parabola plot' }]);
  assert.ok(said !== undefined);
  assert.match(said, /^Drew a chart: Regular parabola plot\./);
  assert.ok(!/did not produce an answer/.test(said));
});

test('two canvas blocks ⇒ the count AND both names — a number alone is not a receipt', () => {
  const said = describeTurnArtefacts([
    { kind: 'canvas', label: 'Attention heads (mermaid)' },
    { kind: 'canvas', label: 'Token embedding (svg)' },
  ]);
  assert.ok(said !== undefined);
  assert.match(said, /Added 2 blocks to the AI Canvas: Attention heads \(mermaid\), Token embedding \(svg\)\./);
});

test('one block reads as one, not as "1 blocks"', () => {
  assert.match(
    String(describeTurnArtefacts([{ kind: 'canvas', label: 'Notes (markdown)' }])),
    /Added a block to the AI Canvas: Notes \(markdown\)\./,
  );
});

test('board writes are summed across rounds and counted once', () => {
  const said = String(
    describeTurnArtefacts([
      { kind: 'board', label: '2' },
      { kind: 'board', label: '3' },
    ]),
  );
  assert.match(said, /Wrote 5 items on the whiteboard\./);
});

test('a diagram names the board it landed on', () => {
  assert.match(
    String(describeTurnArtefacts([{ kind: 'topology', label: 'Order intake' }])),
    /Put a diagram on the architecture board: Order intake\./,
  );
});

test('every kind in one turn reads as one sentence per kind, in a fixed order', () => {
  const rows: TurnArtefact[] = [
    { kind: 'canvas', label: 'Notes (markdown)' },
    { kind: 'board', label: '1' },
    { kind: 'chart', label: 'Latency by route' },
    { kind: 'topology', label: 'Order intake' },
  ];
  const said = String(describeTurnArtefacts(rows));
  const at = (s: string): number => said.indexOf(s);
  assert.ok(at('Drew a chart') >= 0 && at('Added a block') >= 0);
  assert.ok(at('Drew a chart') < at('Added a block'), 'the chart is named first');
  assert.ok(at('Added a block') < at('Put a diagram'));
  assert.ok(at('Put a diagram') < at('Wrote 1 item'));
});

test('the sentence offers the words the reader did not get', () => {
  assert.match(
    String(describeTurnArtefacts([{ kind: 'chart', label: 'y = x²' }])),
    /ask about any part of it and I will explain it in words/,
  );
});

/* ------------------------------ through the turn -------------------------- */

test('THE OWNER’S TURN: a chart and no prose ends in the chart, never in "I did not produce an answer"', async () => {
  const input = designInput('plot a parabola, y = x^2', [
    {
      text: '',
      toolRequests: [
        {
          id: 'c1',
          name: 'propose_chart',
          args: {
            chart: {
              version: 1,
              kind: 'line',
              title: 'Regular parabola plot',
              items: PARABOLA_ITEMS,
              axes: { x: 'x', y: 'y' },
            },
          },
        },
      ],
    },
    { text: '' },
  ]);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  assert.ok(
    events.some((e) => e.type === 'chart:proposal'),
    'the premise of this test is a turn that DID draw',
  );
  assert.ok(
    !/did not produce an answer/i.test(result.text),
    `the turn drew a chart and still claimed it produced nothing: ${result.text}`,
  );
  assert.match(result.text, /Drew a chart: Regular parabola plot\./);
});

test('a turn that drew NOTHING still gets the old ending — the fix widens, it does not replace', async () => {
  const input = designInput('what would you change here', [{ text: '' }]);
  const result = await runAskPipeline(input);
  assert.match(result.text, /did not produce an answer/i);
});

test('prose wins: a turn that both drew and wrote keeps the model’s own words', async () => {
  const input = designInput('plot a parabola, y = x^2', [
    {
      text: 'Here is the curve.',
      toolRequests: [
        {
          id: 'c1',
          name: 'propose_chart',
          args: {
            chart: {
              version: 1,
              kind: 'line',
              title: 'Regular parabola plot',
              items: PARABOLA_ITEMS,
            },
          },
        },
      ],
    },
    { text: 'Here is the curve.' },
  ]);
  const result = await runAskPipeline(input);
  assert.match(result.text, /Here is the curve\./);
  assert.ok(
    !/Drew a chart/.test(result.text),
    'the harness speaks only when the model did not',
  );
});
