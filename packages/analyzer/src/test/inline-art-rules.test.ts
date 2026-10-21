import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CANVAS_BLOCK_CRAFT_SECTION, GENUI_RULES_SECTION, INLINE_ART_RULES_SECTION, renderAskInstructionBelt, type AskInstructionHashInput } from '../server/askPipeline.js';

/* B13: the model is told inline art uses the app's font, colours and buttons, in its own short section. */
test('the inline-art section carries the rules', () => {
  assert.match(INLINE_ART_RULES_SECTION, /var\(--font-sans\)/);
  assert.match(INLINE_ART_RULES_SECTION, /var\(--edge-strong\)/);
  assert.match(INLINE_ART_RULES_SECTION, /class="btn primary"/);
  assert.match(INLINE_ART_RULES_SECTION, /own-fonts/);
  assert.match(INLINE_ART_RULES_SECTION, /```workflow/);
  assert.match(INLINE_ART_RULES_SECTION, /"loop":\{"from","to","until"\}/);
  assert.ok(INLINE_ART_RULES_SECTION.split('\n').length <= 6);
});

test('the craft section is untouched: still twelve lines, no inline-art packing', () => {
  assert.equal(CANVAS_BLOCK_CRAFT_SECTION.split('\n').length, 12);
  assert.doesNotMatch(CANVAS_BLOCK_CRAFT_SECTION, /own-fonts/);
});

/* Generative UI: when to draw a card and when not, and where the catalog lives (one call, not pasted into every prompt). */
test('the genui section says when to draw a card, when not to, and points at ui({help:true}) for the catalog', () => {
  assert.match(GENUI_RULES_SECTION, /`ui`/);
  assert.match(GENUI_RULES_SECTION, /multi-step|progress/i);
  assert.match(GENUI_RULES_SECTION, /Do not draw/);
  assert.match(GENUI_RULES_SECTION, /ui\(\{help:true\}\)/);
  assert.match(GENUI_RULES_SECTION, /once per session/);
  assert.match(GENUI_RULES_SECTION, /done:true/);
  assert.ok(GENUI_RULES_SECTION.split('\n').length <= 5, 'short: it rides on every ask turn');
  assert.ok(GENUI_RULES_SECTION.length <= 900, `${GENUI_RULES_SECTION.length} characters`);
  /* The catalog is fetched by the tool, never pasted into the prompt. */
  for (const component of ['TimelineItem', 'StatusLine', 'KeyValue']) assert.doesNotMatch(GENUI_RULES_SECTION, new RegExp(component));
});

test('the belt carries the genui section right after the inline-art section, once', () => {
  const b = renderAskInstructionBelt({ intents: [], question: 'upgrade the auth library and run the tests' } as unknown as AskInstructionHashInput);
  const art = b.indexOf(INLINE_ART_RULES_SECTION);
  const genui = b.indexOf(GENUI_RULES_SECTION);
  assert.ok(art >= 0 && genui > art, 'genui follows inline art');
  assert.equal(b.split(GENUI_RULES_SECTION).length - 1, 1);
});
