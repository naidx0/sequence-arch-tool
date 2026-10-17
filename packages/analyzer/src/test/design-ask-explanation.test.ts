import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildDesignAskPrompt } from '../explain/explain.js';
import { isArchitectureDesignAsk, isExplanatoryHomeAsk } from '../server/askIntent.js';

/**
 * THE BASE PROMPT AND THE BELT AGREE ABOUT WHAT KIND OF ASK THIS IS.
 *
 * Owner, home workspace, 2026-09-17: "explain LLMs and their internal computer
 * architecture using visuals in 3D" came back as "state three to five
 * assumptions, then emit a seqd diagram". The belt had stopped ordering an
 * architecture proposal for an explanation, but `buildDesignAskPrompt` decided
 * `propose` on its own from the bare noun "architecture" — so the belt's
 * canvas section was arguing with a base-prompt law, which this repository's
 * record says measures 0 of 1. One predicate now gates all three places.
 */
const OWNER_ASK = 'explain llms to me and how they work in their internal computer architecture using visuals in 3d to explain the systems behind ai';
const DESIGN_BRIEF = 'propose an architecture for a checkout system with a payments service and an orders queue';

function designPrompt(question: string, proposeArchitecture: boolean): string {
  return buildDesignAskPrompt(
    { title: 'Blank workspace', outline: question, ...(proposeArchitecture ? { proposeArchitecture: true } : {}) },
    question,
  );
}

test('the owner\'s explanation is not a design brief, even with the client flag set', () => {
  assert.equal(isExplanatoryHomeAsk(OWNER_ASK), true);
  assert.equal(isArchitectureDesignAsk(OWNER_ASK), false);
  const prompt = designPrompt(OWNER_ASK, true);
  /* The two directives the owner read back: PROPOSE NOW (numbered assumptions,
     then a seqd fence) and the "do not refuse, propose a typical architecture"
     order. The base prompt still mentions seqd as a diagram OPTION; that is
     not the defect. */
  assert.doesNotMatch(prompt, /PROPOSE NOW/, 'no PROPOSE NOW clause on an explanation');
  assert.doesNotMatch(prompt, /numbered assumptions/i, 'no assumptions directive on an explanation');
  assert.doesNotMatch(prompt, /Do NOT refuse with/, 'no propose-architecture directive on an explanation');
});

test('a real design brief still gets the proposal directives', () => {
  assert.equal(isArchitectureDesignAsk(DESIGN_BRIEF), true);
  const prompt = designPrompt(DESIGN_BRIEF, true);
  assert.match(prompt, /Do NOT refuse with/, 'the design brief keeps its propose-architecture directive');
  assert.match(prompt, /PROPOSE NOW/, 'and its PROPOSE NOW clause');
});

test('the two prompts differ only by the ask kind — the flag alone does not decide', () => {
  /* Same flag, different asks: the flag was the only signal before, and it
     was set on every blank-workspace turn. */
  const explanation = designPrompt(OWNER_ASK, true);
  const brief = designPrompt(DESIGN_BRIEF, true);
  assert.notEqual(/PROPOSE NOW/.test(explanation), /PROPOSE NOW/.test(brief));
  /* And a structural ask that is not an explanation keeps the flag's effect:
     "break down X" is the design-breakdown product law, not an explanation. */
  assert.match(designPrompt('break down hermes agent and tell me how it works with models memory', true), /Do NOT refuse with/);
});
