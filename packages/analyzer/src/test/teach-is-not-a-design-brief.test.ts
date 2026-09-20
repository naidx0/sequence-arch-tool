import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildAskPrompt, buildDesignAskPrompt } from '../explain/explain.js';

/*
 * THE OWNER'S SHAPE, 2026-09-13.
 *
 * He turned Teach on, asked for a drawing of how an LLM works, and got a
 * DESIGN PROPOSAL back — numbered assumptions, modules named by role,
 * `propose_topology` fired. Built from the reported shape, not a convenient
 * one: a General chat with nothing attached is exactly `design: { title:
 * 'Blank workspace' }`, which is why the design builder is the one under test
 * for the no-repository case.
 *
 * Every assertion below FAILS on the commit before this file existed.
 */

/** What a General chat actually sends when no repository is attached. */
const BLANK_WORKSPACE = { title: 'Blank workspace', outline: 'how an LLM works' };

/** A digest of nothing — the repo-less shape `askPipeline` builds. */
const EMPTY_DIGEST = {
  repo: { id: 'none', name: 'no repository' },
  folders: [],
  services: [],
  datastores: [],
  topics: [],
  edges: [],
} as unknown as Parameters<typeof buildAskPrompt>[0];

/** The exact words the owner typed, and the family they belong to. */
const DRAW_ASKS = [
  'draw me how an LLM works',
  'teach me how a transformer works and draw it',
  'show me how attention works on the board',
];

describe('a lesson that says "draw it" is not a design brief', () => {
  for (const question of DRAW_ASKS) {
    it(`design path — "${question}" gets the teach clause, not the proposal stack`, () => {
      const lesson = buildDesignAskPrompt(BLANK_WORKSPACE, question, { teach: true });

      // The clause that hijacked it.
      assert.doesNotMatch(lesson, /Frame the answer as a design proposal/);
      // The directive stack `propose` pulled in.
      assert.doesNotMatch(lesson, /PROPOSE a typical architecture/);
      assert.doesNotMatch(lesson, /natural modules for THAT domain/);
      // The belt already forbids interrogating a learner; this is the prompt
      // line that used to order it in the same breath.
      assert.doesNotMatch(lesson, /ask those clarifying questions FIRST/);

      // And it still has to DRAW — the override of the refusal survives.
      assert.match(lesson, /DRAW WHAT YOU ARE TEACHING/);
      assert.match(lesson, /as it actually works in the world/);

      // FIGURE IT OUT is the clause that actually ordered the numbered
      // assumptions the owner reported — "show me how" matches it, and it ends
      // "then CALL the `propose_topology` tool". It must not reach a learner.
      assert.doesNotMatch(lesson, /FIGURE IT OUT:/);
      assert.doesNotMatch(lesson, /numbered assumptions/);
      // Nor may the prompt order an interrogation the teach contract forbids.
      assert.doesNotMatch(lesson, /PREPARE BEFORE YOU PROPOSE/);
      // The cost-honesty half of that clause survives — it is true on a lesson.
      assert.match(lesson, /If cost is unknown, say unknown/);
    });

    it(`attached path — "${question}" gets the teach clause too`, () => {
      const lesson = buildAskPrompt(EMPTY_DIGEST, question, { teach: true });
      assert.doesNotMatch(lesson, /Frame the answer as a design proposal/);
      assert.match(lesson, /DRAW WHAT YOU ARE TEACHING/);
    });
  }

  it('the design framing is untouched when the turn is NOT a lesson', () => {
    // "draw it on the board" — the phrasing that IS a design request. (The
    // owner's own words were not; see the FIGURE IT OUT note above.)
    const q = 'draw it on the board';
    const design = buildDesignAskPrompt(BLANK_WORKSPACE, q);
    assert.match(design, /Frame the answer as a design proposal/);
    assert.match(design, /PROPOSE a typical architecture/);
    assert.doesNotMatch(design, /DRAW WHAT YOU ARE TEACHING/);

    const attached = buildAskPrompt(EMPTY_DIGEST, q);
    assert.match(attached, /Frame the answer as a design proposal/);
    assert.match(attached, /PREPARE BEFORE YOU PROPOSE/);
  });

  it('the two draw overrides never both fire on a lesson', () => {
    // "show me ... on the board" matches BOTH predicates. One clause, once.
    const lesson = buildAskPrompt(EMPTY_DIGEST, 'show me how attention works on the board', {
      teach: true,
    });
    const hits = lesson.split('DRAW WHAT YOU ARE TEACHING').length - 1;
    assert.equal(hits, 1);
  });

  it('an EXPLICIT design request in teach mode is still honoured', () => {
    // `proposeArchitecture` is the client saying "design this" in so many
    // words. Teach must soften the accidental trigger, never override the
    // deliberate one.
    const explicit = buildDesignAskPrompt(
      { ...BLANK_WORKSPACE, proposeArchitecture: true },
      'design me a rate limiter',
      { teach: true },
    );
    assert.match(explicit, /PROPOSE a typical architecture/);
  });

  it('a lesson that never mentions drawing carries neither clause', () => {
    const plain = buildDesignAskPrompt(BLANK_WORKSPACE, 'what is a gradient?', { teach: true });
    assert.doesNotMatch(plain, /DRAW WHAT YOU ARE TEACHING/);
    assert.doesNotMatch(plain, /Frame the answer as a design proposal/);
    // It still must not be told to interrogate before answering.
    assert.doesNotMatch(plain, /PREPARE BEFORE YOU PROPOSE/);
  });

  it('teaching verbs alone no longer flip the design-brief directive', () => {
    // `prefersSeqdDiagramAsk` matches "explain how", "walk me through" and
    // "components of" — the plainest teaching language there is — and flipping
    // `propose` on those is what turned the owner's transformer lesson into a
    // module catalogue.
    for (const q of [
      'explain how backpropagation works',
      'walk me through what a transformer does',
      'what are the components of an LLM',
    ]) {
      const lesson = buildDesignAskPrompt(BLANK_WORKSPACE, q, { teach: true });
      assert.doesNotMatch(lesson, /natural modules for THAT domain/, q);
      assert.doesNotMatch(lesson, /PROPOSE a typical architecture/, q);
      assert.doesNotMatch(lesson, /ask those clarifying questions FIRST/, q);
    }
  });
});
