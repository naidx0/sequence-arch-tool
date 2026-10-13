import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CANVAS_BLOCK_CRAFT_SECTION, INLINE_ART_RULES_SECTION } from '../server/askPipeline.js';

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
