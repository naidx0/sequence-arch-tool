import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const z = (css: string, selector: string): number => {
  const m = new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{[^}]*?z-index:\\s*(\\d+)`).exec(css);
  if (!m) throw new Error(`no z-index on ${selector}`);
  return Number(m[1]);
};

describe('0.1.8.4 audit: the open drawer covers the board dock', () => {
  const shell = readFileSync(`${__dirname}/shell2.css`, 'utf8');
  const board = readFileSync(`${__dirname}/../canvas/board.css`, 'utf8');
  it('stacks the overlay drawer and its scrim above the dock furniture', () => {
    const dock = z(board, '.board-scope .boardfurniture');
    expect(z(shell, '.s2-panel-slot.is-overlay')).toBeGreaterThan(dock);
    expect(z(shell, '.s2-rail-scrim')).toBeGreaterThan(dock);
  });
});
