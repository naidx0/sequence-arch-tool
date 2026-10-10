import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './whiteboard.css';
import { Whiteboard, pillLeftFor } from './Whiteboard';
import type { WbItem, WhiteboardDoc } from './whiteboardModel';

const css = readFileSync(path.resolve(__dirname, 'whiteboard.css'), 'utf8');
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

function seeded(items: WbItem[]) {
  const doc: WhiteboardDoc = { version: 1, items };
  const map = new Map<string, string>([['k', JSON.stringify(doc)]]);
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
}
const box = (id: string, x: number): WbItem => ({ kind: 'shape', id, shape: 'rect', from: { x, y: 40 }, to: { x: x + 150, y: 100 }, label: id });

const pane = (width: number, height: number) =>
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, width, height, toJSON: () => ({}) });
const viewport = () => screen.getByTestId('wb-viewport').getAttribute('transform') ?? '';

afterEach(() => vi.restoreAllMocks());

describe('a reload frames a drawing that runs off the pane', () => {
  it('moves the camera when the diagram is wider than a narrow pane', () => {
    pane(300, 600);
    render(<Whiteboard repoRoot="r" storage={seeded([box('a', 0), box('b', 400), box('c', 800)])} storageKey="k" />);
    expect(viewport()).not.toBe('translate(0,0) scale(1)');
    const scale = Number(/scale\(([\d.]+)\)/.exec(viewport())![1]);
    expect(scale).toBeLessThan(1);
  });

  it('leaves a drawing that already fits exactly where it was drawn', () => {
    pane(900, 600);
    render(<Whiteboard repoRoot="r" storage={seeded([box('a', 40), box('b', 300)])} storageKey="k" />);
    expect(viewport()).toBe('translate(0,0) scale(1)');
  });

  it('frames once: a later edit does not drag the camera back', () => {
    pane(300, 600);
    render(<Whiteboard repoRoot="r" storage={seeded([box('a', 0), box('b', 800)])} storageKey="k" />);
    const framed = viewport();
    expect(framed).not.toBe('translate(0,0) scale(1)');
    expect(screen.getByTestId('wb-viewport').getAttribute('transform')).toBe(framed);
  });
});

describe('the pill sits on whole pixels', () => {
  it('rounds the centred left margin, never to a half pixel', () => {
    for (const [inner, wide] of [[754, 381], [753, 380], [306, 253], [305, 252], [300, 301]] as const) {
      const left = pillLeftFor(inner, wide);
      expect(Number.isInteger(left), `${inner} - ${wide}`).toBe(true);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(Math.abs(left - (inner - wide) / 2)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('lands the LEFT EDGE on a device pixel even when the shell put the board on a fraction', () => {
    for (const dpr of [1, 2]) {
      for (const origin of [689, 689.5, 677.17, 809.25]) {
        for (const [inner, wide] of [[754, 381], [753, 380], [306, 253]] as const) {
          const edge = (origin + pillLeftFor(inner, wide, origin, dpr)) * dpr;
          expect(Math.abs(edge - Math.round(edge)), `${origin} ${inner} ${wide} @${dpr}x`).toBeLessThan(1e-9);
        }
      }
    }
  });
});

describe('the empty-board hint and the focus ring', () => {
  it('the hint has a solid backdrop of its own, so the dots do not run through it', () => {
    render(<Whiteboard repoRoot="r" storage={seeded([])} storageKey="k" />);
    expect(screen.getByTestId('wb-empty')).toBeTruthy();
    expect(rule('.wb-empty')).toMatch(/background:\s*var\(--board-ground\)/);
    expect(rule('.wb-empty')).not.toMatch(/inset:\s*0/);
  });

  it('the board has no default outline (it clips into corner triangles); the keyboard gets an inset ring', () => {
    expect(css).toMatch(/\.wb-scope\.wb:focus,\s*\.wb-canvas:focus \{\s*outline: none/);
    const ring = css.slice(css.indexOf('.wb-scope.wb:focus-visible'));
    expect(ring).toMatch(/outline: var\(--w-rule\) solid var\(--accent\)/);
    expect(ring).toMatch(/outline-offset: calc\(-1 \* var\(--w-rule\)\)/);
  });

  it('the More menu has a rule of its own', () => {
    expect(rule('.wb-more-menu')).toMatch(/min-width/);
  });
});

describe('the first stroke on an empty board never moves the camera (review)', () => {
  const stroke = (el: Element, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const fire = (type: string, p: { x: number; y: number }) => fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y }));
    fire('pointerdown', a);
    fire('pointermove', b);
    fire('pointerup', b);
  };

  it('zoomed out on an empty board, drawing the first rectangle leaves the view alone', () => {
    pane(300, 600);
    render(<Whiteboard repoRoot="r" storage={seeded([])} storageKey="k" />);
    const canvas = screen.getByTestId('wb-canvas');
    fireEvent.wheel(canvas, { deltaY: 100, clientX: 0, clientY: 0 });
    const before = viewport();
    expect(before).not.toBe('translate(0,0) scale(1)');
    fireEvent.click(screen.getByTestId('wb-shapes-trigger'));
    fireEvent.click(screen.getByTestId('wb-tool-rect'));
    stroke(canvas, { x: 20, y: 20 }, { x: 900, y: 500 });
    expect(screen.getAllByTestId('wb-item').length).toBeGreaterThan(0);
    expect(viewport()).toBe(before);
  });

  it('a first stroke at the default camera does not jump either, even if it is wider than the pane', () => {
    pane(300, 600);
    render(<Whiteboard repoRoot="r" storage={seeded([])} storageKey="k" />);
    const canvas = screen.getByTestId('wb-canvas');
    fireEvent.click(screen.getByTestId('wb-shapes-trigger'));
    fireEvent.click(screen.getByTestId('wb-tool-rect'));
    stroke(canvas, { x: 20, y: 20 }, { x: 900, y: 500 });
    expect(viewport()).toBe('translate(0,0) scale(1)');
  });

  it('a drawing already in view through a zoomed camera is not "cut off"', () => {
    pane(300, 600);
    render(<Whiteboard repoRoot="r" storage={seeded([box('a', 0), box('b', 400), box('c', 800)])} storageKey="k" />);
    /* Framed on load (it was cut off); the camera now shows all of it. */
    const framed = viewport();
    expect(framed).not.toBe('translate(0,0) scale(1)');
  });
});
