/**
 * THE LIVE-AGENT HARNESS CAN FAIL — EACH WAY IT IS MEANT TO.
 *
 * `tools/agent-live/run.mjs` drives the shipped agent against a real model and
 * decides, per turn, whether it answered. A harness like that is only evidence
 * if it has been shown to go red on each fault it claims to catch; one that has
 * only ever been seen green could be checking nothing at all. That is the exact
 * shape that let the clamp fault through: every unit test was green and the
 * owner got `32.4k in · 0 out`.
 *
 * So each case below builds the record of one fault the owner actually hit, or
 * one the harness names, and asserts the judge rejects it FOR THAT REASON — a
 * case that tripped two branches would prove neither
 * (`each-exit-needs-a-case-that-produces-only-it`).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BATTERY,
  drawingLedger,
  judge,
  modelDrew,
  planParts,
  repeatedCall,
  seeTraceEvent,
} from '../agent-live/run.mjs';

/** A turn that did everything right; each case breaks exactly one thing. */
function good(over = {}) {
  return {
    id: 'plain',
    guards: 'x',
    ms: 1200,
    text: 'The gateway routes requests to the order service and the pricing service.',
    in: 900,
    out: 40,
    tools: [{ name: 'read_topology', evidence: 'topology' }],
    errors: [],
    drew: false,
    timedOut: false,
    ...over,
  };
}

const plain = { id: 'plain', question: 'q' };

describe('the judge passes a turn that answered', () => {
  it('passes the good turn — the control every other case is measured against', () => {
    const v = judge(good(), plain);
    assert.equal(v.pass, true, v.fails.join('; '));
    assert.deepEqual(v.fails, []);
  });
});

describe('the judge fails each fault for its own reason', () => {
  it('the 0-out turn the owner hit four times', () => {
    /* His transcript: "turn · 32.4k in · 0 out", then the stop copy. */
    const v = judge(
      good({
        in: 32400,
        out: 0,
        text:
          'Wrote 1 item on the whiteboard. I stopped because this turn hit its time budget ' +
          'while I was still looking things up, so I have not written an answer rather than guess at one.',
      }),
      plain,
    );
    assert.equal(v.pass, false);
    assert.ok(v.fails.some((f) => /stopped without answering/.test(f)), v.fails.join('; '));
    assert.ok(v.fails.some((f) => /0 output tokens/.test(f)), v.fails.join('; '));
  });

  it('a turn that ends with no text at all', () => {
    const v = judge(good({ text: '' }), plain);
    assert.equal(v.pass, false);
    assert.deepEqual(v.fails, ['no answer text at all']);
  });

  it('a stop-copy answer with output tokens is still not an answer', () => {
    /* The stop copy is PROSE, so a check on "any text" or "out > 0" alone
       would pass it. This is the case that proves the NO_ANSWER pattern is
       doing work of its own. */
    const v = judge(
      good({ out: 55, text: 'I used all 2 of my tool rounds and have not written an answer.' }),
      plain,
    );
    assert.deepEqual(v.fails, ['stopped without answering ("have not written an answer")']);
  });

  it('a stream error', () => {
    const v = judge(good({ errors: ['provider returned 500'] }), plain);
    assert.deepEqual(v.fails, ['stream error: provider returned 500']);
  });

  it('a turn that ran out of wall clock', () => {
    const v = judge(good({ timedOut: true }), plain);
    assert.deepEqual(v.fails, ['did not finish inside the budget']);
  });

  it('the same tool called twice in a row with the same evidence', () => {
    const v = judge(
      good({
        tools: [
          { name: 'read_topology', evidence: 'topology' },
          { name: 'read_topology', evidence: 'topology' },
        ],
      }),
      plain,
    );
    assert.deepEqual(v.fails, ['repeated an identical tool call back to back: read_topology (topology)']);
  });

  it('a lookup question that made no tool call', () => {
    const v = judge(good({ tools: [] }), { id: 'lookup', question: 'q', expectTool: true });
    assert.deepEqual(v.fails, ['expected at least one tool call and made none']);
  });
});

describe('the faults of 2026-09-22 (photo 3)', () => {
  it('a board request where nothing landed', () => {
    const v = judge(good({ drew: false }), { id: 'arch-add', question: 'q', expectDraw: true });
    assert.deepEqual(v.fails, ['asked for the board and nothing landed']);
  });

  it('a tool fence printed to the reader', () => {
    const v = judge(good({ text: 'Proposing a new service.\n\nsequence-tool\n)' }), plain);
    assert.deepEqual(v.fails, ['a tool fence reached the reader']);
  });

  /* The re-measure's r1 (2026-09-22): the stream is judged too. */
  it('a result that is the model planning, ending on a think close tag', () => {
    const v = judge(
      good({ text: 'The gateway hands the order on. I should check the files first.\n</think>\n\n' }),
      plain,
    );
    assert.deepEqual(v.fails, ["the model's thinking reached the reader as the answer"]);
  });

  it('a clean result whose deltas streamed a tool fence', () => {
    const v = judge(
      good({ streamed: 'Reading first.\n\n```sequence-tool\n{"id":"g0","name":"read_file"}\n```\n' }),
      plain,
    );
    assert.deepEqual(v.fails, ['a tool fence streamed to the reader']);
  });

  it('a clean result whose deltas streamed the thinking', () => {
    const v = judge(good({ streamed: 'Let me read the key files first.\n</think>\n\n' }), plain);
    assert.deepEqual(v.fails, ["the model's thinking streamed to the reader"]);
  });

  it('a clean stream passes (control)', () => {
    const v = judge(good({ streamed: 'The gateway routes requests to the order service.' }), plain);
    assert.equal(v.pass, true, v.fails.join('; '));
  });

  it('a board request that landed passes', () => {
    const v = judge(good({ drew: true }), { id: 'arch-add', question: 'q', expectDraw: true });
    assert.equal(v.pass, true, v.fails.join('; '));
  });

  it('a text that is only the harness note is no answer', () => {
    /* The compound question on 2026-09-22 "passed" with exactly this. */
    const v = judge(good({ text: '(Nothing was put on the architecture board this turn.)' }), plain);
    assert.deepEqual(v.fails, ['no answer text at all']);
  });

  it('an answer followed by the note is still an answer', () => {
    const v = judge(
      good({ text: 'The gateway routes orders.\n\n(Nothing was drawn on the AI Canvas this turn.)' }),
      plain,
    );
    assert.equal(v.pass, true, v.fails.join('; '));
  });

  it('a plan is scored by its parts, and a plan missing parts still passes', () => {
    const rec = good({ planBlocks: ['markdown'], planCharts: 0, tools: [{ name: 'write_plan', evidence: 'plan: 3 step(s)' }] });
    assert.deepEqual(planParts(rec), { steps: true, document: true, beforeAfter: false, effect: false });
    const v = judge(rec, { id: 'plan', question: 'q', scorePlan: true });
    assert.equal(v.pass, true, v.fails.join('; '));
  });

  it('the battery carries turn 17 verbatim', () => {
    const add = BATTERY.find((b) => b.id === 'arch-add');
    assert.ok(add && add.expectDraw);
    assert.match(add.question, /on the arch baord i wnat to add a new program/);
  });
});

describe('what the judge must NOT fail', () => {
  it('a bare drawing that drew, with little prose, is the short path working', () => {
    const v = judge(good({ text: '', out: 0, drew: true }), {
      id: 'bare-draw',
      question: 'q',
      allowDrawingOnly: true,
    });
    assert.equal(v.pass, true, v.fails.join('; '));
  });

  it('the same tool twice with DIFFERENT evidence is not a repeat', () => {
    /* read_file on two different files is progress, not a loop. */
    assert.equal(
      repeatedCall([
        { name: 'read_file', evidence: 'src/a.ts' },
        { name: 'read_file', evidence: 'src/b.ts' },
      ]),
      null,
    );
  });

  it('two calls with EMPTY evidence are not shown to be a repeat', () => {
    /* Found live: two `search_files` calls, both with no evidence line, were
       flagged as a loop although the stream gave no sign they were the same
       search. Empty evidence carries no information about the arguments. */
    assert.equal(
      repeatedCall([
        { name: 'search_files', evidence: '' },
        { name: 'search_files', evidence: '' },
      ]),
      null,
    );
  });

  it('usage that was never reported is not "0 out"', () => {
    /* `null` means the provider did not say; only a reported zero is a fault. */
    const v = judge(good({ out: null }), plain);
    assert.equal(v.pass, true, v.fails.join('; '));
  });
});

describe('the battery carries the regression that motivated it', () => {
  it('includes the compound ask, verbatim', () => {
    const compound = BATTERY.find((b) => b.id === 'compound');
    assert.ok(compound, 'the compound case is the reason this harness exists');
    assert.match(compound.question, /walk through the whole surface/);
    assert.match(compound.question, /on the arch board/);
  });

  it('includes the owner\'s teaching prompt, verbatim, in his real state', () => {
    /* Plan chat, Teach toggle OFF, AI Canvas open — the state he asked from on
       2026-09-22 (docs/teaching-flow-plan.md, the live baseline). */
    const teach = BATTERY.find((b) => b.id === 'teach-flow');
    assert.ok(teach, 'the teaching prompt is the case the teaching-flow plan is scored on');
    assert.equal(
      teach.question,
      'Teach me how this app works at the root: how the engine sends AI token requests to the model, ' +
        'how the harness and the gates fit around it, and what the UI does. I know nothing about it yet. ' +
        'Draw on the ai canvas the visual breakdown to teach me about the elements within the app.',
    );
    /* CONTRACT CHANGED 2026-09-23 (the fourth measurement): `expectTool`
       failed 6/6 once the harness gathered the evidence before the first call —
       the instrument, not the turn. The case now expects that evidence, and a
       chart on its traces. */
    assert.notEqual(teach.expectTool, true, 'the model need not call a tool when the harness did the research');
    assert.equal(teach.expectEvidence, true);
    assert.equal(teach.expectFlowOnTrace, true);
    assert.equal(teach.expectDraw, true);
    assert.equal(teach.body?.permission, 'plan');
    assert.deepEqual(teach.body?.surface, { id: 'ai-canvas' });
    assert.notEqual(teach.body?.teach, true, 'the toggle is off in his state');
  });

  it('every case says what it guards', () => {
    for (const b of BATTERY) assert.ok(b.guards && b.guards.length > 10, b.id);
  });
});

describe('who drew (the r3 fault of 2026-09-22)', () => {
  /* The engine seeds one box per service at turn start. r3 landed nothing —
     its propose_chart began and the stream died — and was printed PASS. */
  const seed = { type: 'board:item', items: [{ kind: 'noderef', id: 'seed:svc:ml-harness-app', nodeId: 'svc:ml-harness-app' }] };
  it('the seed box alone is nobody\'s drawing', () => {
    assert.equal(modelDrew([seed]), false);
    const l = drawingLedger();
    l.see(seed);
    assert.equal(l.harness, false);
  });

  it('a board item the MODEL placed counts, even beside the seed', () => {
    assert.equal(
      modelDrew([
        seed,
        { type: 'tool:start', name: 'propose_topology' },
        { type: 'board:item', items: [{ kind: 'noderef', id: 'n:1', nodeId: 'svc:x' }] },
        { type: 'tool:done', evidence: 'placed 1' },
      ]),
      true,
    );
  });

  it('a refused chart is not a drawing; a landed one is', () => {
    const refused = [
      seed,
      { type: 'tool:start', name: 'propose_chart' },
      { type: 'tool:done', evidence: 'refused: propose_chart — links[0]: no edge' },
    ];
    assert.equal(modelDrew(refused), false);
    const landed = [
      seed,
      { type: 'tool:start', name: 'propose_chart' },
      { type: 'chart:proposal', surface: 'ai-canvas' },
      { type: 'tool:done', evidence: 'chart landed' },
    ];
    assert.equal(modelDrew(landed), true);
  });

  it('a chart outside any tool call is the harness\'s, and still counts as landed for the judge', () => {
    const l = drawingLedger();
    for (const ev of [seed, { type: 'chart:proposal', surface: 'ai-canvas' }]) l.see(ev);
    assert.equal(l.model, false);
    assert.equal(l.harness, true);
    const v = judge(good({ drew: false, harnessDrew: true }), { id: 'arch-add', question: 'q', expectDraw: true });
    assert.equal(v.pass, true, v.fails.join('; '));
  });

  it('a stream that ended on a bare tool:start is a failure, not a pass', () => {
    const v = judge(good({ errors: ['stream closed without result or error'] }), plain);
    assert.deepEqual(v.fails, ['stream error: stream closed without result or error']);
  });
});

describe('the turn is measured, not the model\'s tool count (the fourth measurement, 2026-09-23)', () => {
  /* The harness gathers the evidence before the first call and says so on the
     result; the landed chart's steps must be hops of the traces it gathered. */
  const evidence = { chars: 4205, sources: ['frontend/src/lib/engine/client.ts', 'app/main.py'], hops: ['a>b', 'b>c', 'b>d'] };
  const teachItem = { id: 'teach-flow', question: 'q', expectEvidence: true, expectFlowOnTrace: true };
  const onTrace = good({ tools: [], evidence, chartSteps: ['a>b', 'b>c'] });

  it('a turn the harness researched, with its chart on the trace, passes with no model tool call', () => {
    const v = judge(onTrace, teachItem);
    assert.equal(v.pass, true, v.fails.join('; '));
  });

  it('fails when the first prompt did not carry the gathered evidence', () => {
    const v = judge({ ...onTrace, evidence: null }, { ...teachItem, expectFlowOnTrace: false });
    assert.deepEqual(v.fails, ['the first prompt did not carry the gathered evidence']);
    const empty = judge({ ...onTrace, evidence: { ...evidence, chars: 0 } }, { ...teachItem, expectFlowOnTrace: false });
    assert.deepEqual(empty.fails, ['the first prompt did not carry the gathered evidence']);
  });

  it('fails when a landed chart step is not a hop of the gathered traces', () => {
    const v = judge({ ...onTrace, chartSteps: ['a>b', 'x>y'] }, teachItem);
    assert.deepEqual(v.fails, ['the landed chart step x>y is not a hop of the gathered traces']);
  });

  it('fails when no landed chart has steps to check', () => {
    const v = judge({ ...onTrace, chartSteps: [] }, teachItem);
    assert.deepEqual(v.fails, ['no landed chart has steps to check against the gathered traces']);
  });

  it('reads the evidence off the result and the steps off the last chart that landed', () => {
    const rec = { evidence: null, chartSteps: [] };
    for (const ev of [
      { type: 'chart:proposal', chart: { steps: [{ from: 'p', to: 'q' }] } },
      { type: 'chart:proposal', chart: { steps: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] } },
      { type: 'result', text: 'x', evidence },
    ]) {
      seeTraceEvent(rec, ev);
    }
    assert.deepEqual(rec.chartSteps, ['a>b', 'b>c']);
    assert.deepEqual(rec.evidence, evidence);
  });
});
