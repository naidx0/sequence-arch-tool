import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Whiteboard } from './Whiteboard';
import cssRaw from './whiteboard.css?raw';

const css = cssRaw.replace(/\r\n/g, '\n');
/** The body of the first `@container wb (max-width: Npx)` block. */
const block = (px: number) => {
  const at = css.indexOf(`@container wb (max-width: ${px}px) {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('\n}\n', at));
};

/*
 * 0.1.8.1 C6 (audit P2-1, P2-2): one click picks the last-used shape, the chevron opens the list; the tool returns to
 * Select after one shape; a double-click on a tool keeps it.
 */

function memoryStore() {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}
function drag(el: Element, a: { x: number; y: number }, b: { x: number; y: number }) {
  const fire = (type: string, p: { x: number; y: number }) => fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y }));
  fire('pointerdown', a);
  fire('pointermove', b);
  fire('pointerup', b);
}
const tool = () => screen.getByTestId('wb-canvas').getAttribute('data-tool');
const shapes = () => screen.queryAllByTestId('wb-item').filter((i) => i.getAttribute('data-kind') === 'shape').length;

afterEach(cleanup);

describe('board tools (0.1.8.1 C6)', () => {
  it('one click on Shapes picks the last-used shape; the chevron opens the list', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    fireEvent.click(screen.getByTestId('wb-shapes-main'));
    expect(tool()).toBe('rect');
    expect(screen.queryByTestId('wb-shapes-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('wb-shapes-trigger'));
    expect(screen.getByTestId('wb-shapes-menu')).toBeTruthy();
    fireEvent.click(screen.getByTestId('wb-tool-ellipse'));
    expect(tool()).toBe('ellipse');
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    /* The last one used is what one click gives next time. */
    fireEvent.click(screen.getByTestId('wb-shapes-main'));
    expect(tool()).toBe('ellipse');
  });

  it('the tool returns to Select after one shape', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    fireEvent.click(screen.getByTestId('wb-shapes-main'));
    drag(screen.getByTestId('wb-canvas'), { x: 20, y: 20 }, { x: 120, y: 90 });
    expect(shapes()).toBe(1);
    expect(tool()).toBe('select');
  });

  it('a double-click keeps the tool for shape after shape', () => {
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    fireEvent.doubleClick(screen.getByTestId('wb-shapes-main'));
    const canvas = screen.getByTestId('wb-canvas');
    drag(canvas, { x: 20, y: 20 }, { x: 120, y: 90 });
    drag(canvas, { x: 220, y: 20 }, { x: 320, y: 90 });
    drag(canvas, { x: 20, y: 220 }, { x: 120, y: 290 });
    expect(shapes()).toBe(3);
    expect(tool()).toBe('rect');
    expect(screen.getByTestId('wb-shapes-main').getAttribute('data-locked')).toBe('true');
    /* Picking another tool lets the lock go. */
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    fireEvent.click(screen.getByTestId('wb-shapes-main'));
    drag(canvas, { x: 220, y: 220 }, { x: 320, y: 290 });
    expect(tool()).toBe('select');
  });
});

describe('the split Shapes and Text buttons on a narrow board (review S4, S5)', () => {
  it('the glyph button has its own rule, and the chevron carries no glyph at full width', () => {
    expect(css).toMatch(/\.wb-tool\.wb-tool-split \{[^}]*min-width/);
    expect(css).toMatch(/\.wb-tool\.wb-tool-chev \.wb-chev-glyph \{\s*display: none;/);
  });
  it('at 380px and under the pair folds into ONE tool-width trigger with the glyph, never a blank button', () => {
    const b = block(380);
    expect(b).toMatch(/\.wb-tool\.wb-tool-split \{\s*display: none;/);
    expect(b).toMatch(/\.wb-tool\.wb-tool-chev \{\s*min-width: var\(--icon-btn-lg\);/);
    expect(b).toMatch(/\.wb-tool\.wb-tool-chev \.wb-chev-glyph \{\s*display: block;/);
    render(<Whiteboard repoRoot="r" storage={memoryStore()} />);
    expect(screen.getByTestId('wb-shapes-trigger').querySelector('.wb-chev-glyph')).not.toBeNull();
  });
});
