import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Whiteboard } from './Whiteboard';
import { GRID_KEY, readGridEnabled, writeGridEnabled } from './snapPreference';
import '../tokens/graphite.css';
import './whiteboard.css';

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};
const css = readFileSync(path.resolve(__dirname, 'whiteboard.css'), 'utf8');

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

/* B3 + B4: a Space is a plain dark field; the dotted grid is a per-person option in the More menu. */
describe('Spaces: the grid is off by default and a choice in More', () => {
  it('the dots sit only behind [data-grid=true]; the base canvas rule has no background-image', () => {
    const base = css.slice(css.indexOf('.wb-canvas {'), css.indexOf('}', css.indexOf('.wb-canvas {')));
    expect(base).toMatch(/background-color:\s*var\(--board-ground\)/);
    expect(base).not.toMatch(/background-image/);
    const gridRule = css.slice(css.indexOf(".wb-canvas[data-grid='true'] {"));
    expect(gridRule.slice(0, gridRule.indexOf('}'))).toMatch(/radial-gradient\(/);
  });

  it('opens with no grid', () => {
    render(<Whiteboard repoRoot="r" storage={memory()} />);
    expect(screen.getByTestId('wb-canvas').getAttribute('data-grid')).toBe('false');
    expect(readGridEnabled()).toBe(false);
  });

  it('More has a Show grid row, in the same menu-item markup as the others, unchecked at first', () => {
    render(<Whiteboard repoRoot="r" storage={memory()} />);
    fireEvent.click(screen.getByTestId('wb-more'));
    const row = screen.getByTestId('wb-more-grid');
    expect(row.textContent).toBe('Show grid');
    expect(row.className).toBe(screen.getByTestId('wb-more-reset').className);
    expect(row.tagName).toBe(screen.getByTestId('wb-more-reset').tagName);
    expect(row.getAttribute('role')).toBe('menuitemcheckbox');
    expect(row.getAttribute('aria-checked')).toBe('false');
  });

  it('choosing it turns the grid on, remembers it for the person, and a new board opens with it', () => {
    const first = render(<Whiteboard repoRoot="r" storage={memory()} />);
    fireEvent.click(screen.getByTestId('wb-more'));
    fireEvent.click(screen.getByTestId('wb-more-grid'));
    expect(screen.getByTestId('wb-canvas').getAttribute('data-grid')).toBe('true');
    expect(window.localStorage.getItem(GRID_KEY)).toBe('on');
    fireEvent.click(screen.getByTestId('wb-more'));
    expect(screen.getByTestId('wb-more-grid').getAttribute('aria-checked')).toBe('true');
    first.unmount();
    render(<Whiteboard repoRoot="r" storage={memory()} />);
    expect(screen.getByTestId('wb-canvas').getAttribute('data-grid')).toBe('true');
    fireEvent.click(screen.getByTestId('wb-more'));
    fireEvent.click(screen.getByTestId('wb-more-grid'));
    expect(screen.getByTestId('wb-canvas').getAttribute('data-grid')).toBe('false');
    expect(readGridEnabled()).toBe(false);
  });

  it('an unreadable value falls back to off, and the architecture board keeps its own dotted field', () => {
    window.localStorage.setItem(GRID_KEY, 'maybe');
    expect(readGridEnabled()).toBe(false);
    writeGridEnabled(true);
    expect(readGridEnabled()).toBe(true);
    const arch = readFileSync(path.resolve(__dirname, '../canvas/board.css'), 'utf8');
    expect(arch).toContain('radial-gradient(');
    expect(arch).not.toContain('data-grid');
  });
});
