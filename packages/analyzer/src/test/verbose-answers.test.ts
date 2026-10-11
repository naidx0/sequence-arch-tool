import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAskPrompt } from '../explain/explain.js';
import { CANVAS_BLOCK_CRAFT_SECTION, runAskPipeline, type AskPipelineInput, type AskStreamEvent } from '../server/askPipeline.js';
import { MAX_TOKENS } from '../server/provider.js';

/**
 * LET THE MODEL TALK (owner, 2026-10-09): "the models don't seem very verbose ... make sure we're
 * not really cutting models off too much and letting them do their thing." Asking "draw the agentic
 * loop on the whiteboard" got back only "Drew the loop." because the draw instructions asked for
 * "one sentence" and the register clause told the model to default to terse notes.
 *
 * These pin the new contract: no brevity instruction in the shared prompt, the draw craft section
 * asks for an explanation, the default output cap is generous, and a long answer reaches the user whole.
 */

const DIGEST = {
  repo: { id: 'repo', name: 'demo' },
  folders: [],
  services: [],
  datastores: [],
  topics: [],
  edges: [],
} as Parameters<typeof buildAskPrompt>[0];

const BREVITY = [
  /default to concise/i,
  /every line earns its place/i,
  /one or two sentences/i,
  /stop when it is answered/i,
  /in one sentence what the drawing shows/i,
  /\bbe (brief|terse|concise)\b/i,
];

test('the shared ask prompt carries no brevity instruction and asks for a complete answer', () => {
  for (const q of ['explain the architecture', 'what does askPipeline do?', 'draw the agentic loop on the whiteboard']) {
    const prompt = buildAskPrompt(DIGEST, q);
    for (const re of BREVITY) assert.doesNotMatch(prompt, re, `${q}: ${re}`);
    assert.match(prompt, /complete, thoughtful answer/i);
    assert.match(prompt, /do not cut a useful explanation short/i);
  }
});

test('a user who asks for terse still gets the register-matching clause (their ask outranks the default)', () => {
  assert.match(buildAskPrompt(DIGEST, 'be terse'), /terse and technical if they ask for that/i);
});

test('after drawing, the model is asked to EXPLAIN the drawing, not caption it in one sentence', () => {
  assert.doesNotMatch(CANVAS_BLOCK_CRAFT_SECTION, /one sentence/i);
  assert.match(CANVAS_BLOCK_CRAFT_SECTION, /explain the drawing/i);
});

test('the default anthropic output cap is at least 16k', () => {
  assert.ok(MAX_TOKENS >= 16384, String(MAX_TOKENS));
});

test('a long model answer reaches the user whole: no clipping, no canned replacement', async () => {
  const long = Array.from({ length: 60 }, (_, i) => `Step ${i + 1}: the loop reads state, picks a tool, runs it and feeds the result back in.`).join('\n\n');
  const events: AskStreamEvent[] = [];
  const input: AskPipelineInput = {
    question: 'draw the agentic loop on the whiteboard',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: { title: 'Blank workspace', outline: 'x' },
    designMode: true,
    askMode: 'implementation',
    graph: null,
    digest: undefined,
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: () => null,
    repoRoot: null,
    callProvider: async () => ({ text: long }),
  };
  const out = await runAskPipeline(input, (e) => events.push(e));
  assert.ok(out.text.startsWith(long), "the model's whole text is kept; the harness may only append its own notes");
  assert.ok(out.text.includes('Step 60:'));
  assert.doesNotMatch(out.text, /Drew the loop/);
});
