import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { KNOBS } from './knobs';

/*
 * APP-12 acceptance: "No placeholder or value is truncated." The Max output tokens placeholder read "provider de"
 * in the box. The check is derived from the table (every knob), against the box's CSS width: a placeholder must fit
 * in the characters the box has, and so must the longest value a knob takes (3600000, seven digits).
 */
const css = readFileSync(resolve(__dirname, 'settings.css'), 'utf8').replace(/\r\n/g, '\n');
const rule = css.match(/\.settings-scope \.sb-row-knob \.sb-input-num\s*\{([^}]*)\}/);
const minWidth = Number(/min-width:\s*(\d+)px/.exec(rule?.[1] ?? '')?.[1] ?? 0);
/* The box's inner width: its min-width less 12 px of padding each side and a 7 px average glyph at 13 px. */
const FITS = Math.floor((minWidth - 24) / 7);

describe('Advanced knob boxes show their placeholder and longest value whole', () => {
  it('the box has a width rule', () => {
    expect(minWidth).toBeGreaterThan(0);
  });
  for (const k of KNOBS) {
    it(`${k.key}: placeholder "${k.placeholder}" fits`, () => {
      expect(k.placeholder.length).toBeLessThanOrEqual(FITS);
    });
  }
  it('the longest accepted value (3600000) fits', () => {
    expect('3600000'.length).toBeLessThanOrEqual(FITS);
  });
  it('no placeholder is longer than "no deadline" (the longest checked on screen)', () => {
    for (const k of KNOBS) expect(k.placeholder.length).toBeLessThanOrEqual('no deadline'.length);
  });
});
