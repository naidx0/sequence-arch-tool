import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AiCanvas } from './AiCanvas';

/**
 * KEYBOARD FOCUS IS VISIBLE ON THIS SURFACE — Sequence's third gate.
 *
 * Correctness and legibility are the first two; human-usability is the third,
 * and "a feature that exists but can't be found isn't done". Every control on
 * this canvas is a real <button>, so it is REACHABLE by keyboard — and the
 * canvas stylesheet defines no focus styling at all, so a reader tabbing
 * through it cannot see where they are. Reachable and unseeable.
 *
 * It is an omission rather than a decision: `shell.css` and `chat.css` both
 * define `:focus-visible` rings, and `tokens/graphite.css` reserves the accent
 * for "selection, focus". The canvas simply never got one.
 *
 * ── WHAT EACH TEST READS, BEFORE WHAT IT PROVES ──────────────────────────
 *
 * The first two READ THE STYLESHEET SOURCE, because jsdom does not paint
 * imported CSS and cannot answer "is there a visible ring" at all. They prove a
 * rule exists and that it is the app's ring rather than a new invention. They
 * do NOT prove anything renders.
 *
 * The third READS THE RENDERED DOM and proves the controls those rules name are
 * actually on screen and focusable. A stylesheet assertion alone passes forever
 * against a class the renderer stopped emitting; a DOM assertion alone passes
 * while the control is invisible when focused. Neither is sufficient and each
 * fails for its own reason.
 */
const css = readFileSync(resolve(__dirname, 'aiCanvas.css'), 'utf8');

/** Every control the canvas owns. Named here so a new one is a deliberate edit. */
const CONTROLS = ['.ai-canvas-ask-block', '.ai-canvas-export-quiet', '.ai-canvas-story-ctrl'];

describe('canvas controls show keyboard focus', () => {
  it('READS THE STYLESHEET: every canvas control has a :focus-visible rule', () => {
    const missing = CONTROLS.filter((c) => !css.includes(`${c}:focus-visible`));
    expect(missing.join(', ')).toBe('');
  });

  it('READS THE STYLESHEET: the ring is the app’s, not a new one', () => {
    /*
     * shell.css and chat.css both draw focus as a two-ring box-shadow — a gap
     * in --bg-base, then --accent, which graphite.css:99 reserves for
     * "selection, focus". Matching it is extending the book; an outline of my
     * own choosing would be redesigning it.
     */
    /*
     * READS the rule block CONTAINING that selector, grouped or not. The first
     * version required the selector to be alone on its line before the brace —
     * it read "a rule whose selector is exactly this" while claiming "the ring
     * is the app's", and went red against correct CSS written as a group. An
     * instrument accurate about what it read and silent about what it claimed.
     */
    const block = css.match(/\.ai-canvas-ask-block:focus-visible[\s\S]*?\}/)?.[0] ?? '';
    expect(block, 'no rule block found for the ask control').not.toBe('');
    expect(block).toContain('var(--accent)');
    expect(block).toContain('var(--bg-base)');
  });

  it('READS THE RENDERED DOM: those controls are on screen and focusable', () => {
    /*
     * The half that stops the two above being rules about nothing. `.ask-block`
     * only renders when a handler is passed, so this passes one — otherwise the
     * assertion would be about a control the fixture never asked for.
     */
    render(
      <AiCanvas
        doc={{ blocks: [{ id: 'b1', type: 'markdown', payload: '# T\n\np', status: 'landed' }] } as never}
        onAskBlock={() => {}}
        onExport={() => {}}
      />,
    );
    for (const sel of ['.ai-canvas-ask-block', '.ai-canvas-export-quiet']) {
      const el = document.querySelector(sel);
      expect(el, `${sel} must render`).toBeTruthy();
      expect(el!.tagName, `${sel} must be focusable by keyboard`).toBe('BUTTON');
    }
  });
});
