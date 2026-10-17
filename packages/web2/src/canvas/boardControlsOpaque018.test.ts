import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* The board controls panel (.bmenu: PATH, NEIGHBOURS, LAYOUT, GROUPS, KEYS, EXPORT) sat on a 94% mix, so cards and
   text showed through it. It takes the surface token the board's other popovers use, whole. */
const css = readFileSync(join(process.cwd(), 'src/canvas/board.css'), 'utf8').replace(/\r\n/g, '\n');

describe('the board controls panel is opaque', () => {
  const rule = /\n\.board-scope \.bmenu \{([^}]*)\}/.exec(css);

  it('has a rule', () => expect(rule).not.toBeNull());

  it('fills with the board-card token, not a transparent mix', () => {
    const body = rule![1]!;
    expect(body).toMatch(/background:\s*var\(--board-card\)\s*;/);
    expect(body).not.toMatch(/transparent/);
    expect(body).not.toMatch(/color-mix/);
  });

  it('the token it uses is defined opaque', () => {
    expect(css).toMatch(/--board-card:\s*var\(--surface-2\)/);
  });
});
