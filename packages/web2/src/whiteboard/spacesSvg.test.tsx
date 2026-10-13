import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Whiteboard } from './Whiteboard';
import { hostedSvg } from './svgItem';
import { itemBox } from '../canvas/boards/boardsModel';
import { readWhiteboard, whiteboardBounds, whiteboardEdit, type WhiteboardDoc, type WbItem } from './whiteboardModel';
import '../tokens/graphite.css';
import './whiteboard.css';

afterEach(cleanup);

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};
const mouse = (el: Element, type: string, x: number, y: number) => fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));

const HOSTILE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60" onload="alert(1)">' +
  '<script>alert(1)</script>' +
  '<polygon points="50,5 95,30 50,55 5,30" fill="none" stroke="currentColor" onclick="alert(2)" onmouseover="alert(3)"/>' +
  '<foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>' +
  '<a href="javascript:alert(4)"><text x="5" y="10">link</text></a>' +
  '<image href="https://evil.example/pixel.png" width="5" height="5"/>' +
  '<rect width="5" height="5" style="fill:url(https://evil.example/x);stroke:red"/>' +
  '<text x="10" y="50">Aorta</text>' +
  '</svg>';

/* The item as the backend contract names it ("Board items"): at, w, h, svg, label. */
const svgItem = (extra: Partial<Extract<WbItem, { kind: 'svg' }>> = {}): WbItem => ({
  kind: 'svg',
  id: 'anatomy',
  at: { x: 40, y: 50 },
  w: 400,
  h: 240,
  svg: HOSTILE,
  by: 'agent',
  ...extra,
});

/* B6: an agent hosts an svg on a Space (the anatomy diagram): it goes through the chat's sanitiser, and is a movable, resizable item. */
describe('a hosted svg is made safe before it reaches the page', () => {
  it('strips script, event attributes, foreignObject, javascript: links and external references, and keeps the drawing', () => {
    const r = hostedSvg(HOSTILE, { x: 40, y: 50 }, { w: 400, h: 240 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toMatch(/<script/i);
    expect(r.html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(r.html).not.toMatch(/alert\(/);
    expect(r.html).not.toMatch(/foreignObject/i);
    expect(r.html).not.toMatch(/javascript:/i);
    expect(r.html).not.toMatch(/evil\.example/);
    expect(r.html).not.toMatch(/<image/i);
    expect(r.html).toContain('<polygon');
    expect(r.html).toContain('Aorta');
  });

  it('is fitted to the frame the board owns: x, y, width, height are set after the sanitiser, and the viewBox scales it', () => {
    const r = hostedSvg('<svg viewBox="0 0 100 60" x="999" y="999" width="9999" height="9999"><rect width="5" height="5"/></svg>', { x: 40, y: 50 }, { w: 400, h: 240 });
    expect(r.ok && r.html).toMatch(/x="40"/);
    expect(r.ok && r.html).toMatch(/y="50"/);
    expect(r.ok && r.html).toMatch(/width="400"/);
    expect(r.ok && r.html).toMatch(/height="240"/);
    expect(r.ok && r.html).toMatch(/viewBox="0 0 100 60"/);
    expect(r.ok && r.html).not.toMatch(/9999/);
    /* an svg with only width/height still scales: its viewBox is derived */
    const plain = hostedSvg('<svg width="200" height="100"><rect width="5" height="5"/></svg>', { x: 0, y: 0 }, { w: 400, h: 200 });
    expect(plain.ok && plain.html).toMatch(/viewBox="0 0 200 100"/);
  });

  it('says so, instead of drawing nothing, for markup that is not an svg', () => {
    expect(hostedSvg('<div>hi</div>', { x: 0, y: 0 }, { w: 100, h: 100 }).ok).toBe(false);
    render(<Whiteboard repoRoot="r" storage={memory()} agentItems={[svgItem({ svg: '<div>hi</div>' })]} />);
    expect(screen.getByTestId('wb-svg-host').textContent).toMatch(/could not be drawn/);
  });
});

describe('the svg on the board', () => {
  it('renders as one item whose DOM carries no script and no event attribute, in its frame', () => {
    const { container } = render(<Whiteboard repoRoot="r" storage={memory()} agentItems={[svgItem()]} />);
    const item = screen.getByTestId('wb-item');
    expect(item.getAttribute('data-kind')).toBe('svg');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('foreignObject svg, image')).toBeNull();
    const all = Array.from(container.querySelectorAll('*'));
    expect(all.some((el) => el.getAttributeNames().some((n) => /^on/i.test(n)))).toBe(false);
    const inner = item.querySelector('svg')!;
    expect(inner.getAttribute('width')).toBe('400');
    expect(inner.getAttribute('height')).toBe('240');
    expect(item.textContent).toContain('Aorta');
  });

  it('reads the contract field `svg` and the first version `markup`, and draws a label under the frame', () => {
    const { markup: _m, ...legacy } = svgItem() as Extract<WbItem, { kind: 'svg' }>;
    render(<Whiteboard repoRoot="r" storage={memory()} agentItems={[{ ...legacy, svg: undefined, markup: HOSTILE, label: 'Anatomy' } as WbItem]} />);
    expect(screen.getByTestId('wb-item').textContent).toContain('Aorta');
    expect(screen.getByTestId('wb-svg-label').textContent).toBe('Anatomy');
    cleanup();
    render(<Whiteboard repoRoot="r" storage={memory()} agentItems={[svgItem()]} />);
    expect(screen.getByTestId('wb-item').textContent).toContain('Aorta');
    expect(screen.queryByTestId('wb-svg-label')).toBeNull();
  });

  it('has a box the move and fit logic can see (itemBox and bounds)', () => {
    const it = svgItem();
    expect(itemBox(it)).toEqual({ x: 40, y: 50, w: 400, h: 240 });
    expect(whiteboardBounds({ version: 1, items: [it] })).toEqual({ x: 40, y: 50, width: 400, height: 240 });
  });

  it('survives a reload: the stored document keeps it, and a malformed one is dropped', () => {
    const doc: WhiteboardDoc = { version: 1, items: [svgItem()] };
    expect(readWhiteboard(JSON.stringify(doc)).items).toHaveLength(1);
    expect(readWhiteboard(JSON.stringify({ version: 1, items: [{ ...svgItem(), svg: undefined, markup: HOSTILE }] })).items).toHaveLength(1);
    expect(readWhiteboard(JSON.stringify({ version: 1, items: [{ kind: 'svg', id: 'x' }] })).items).toHaveLength(0);
  });

  it('moves as a whole and resizes through the model (never below the minimum)', () => {
    const doc: WhiteboardDoc = { version: 1, items: [svgItem()] };
    const moved = whiteboardEdit(doc, { type: 'wb/move', id: 'anatomy', dx: 10, dy: -5 });
    expect((moved.items[0] as Extract<WbItem, { kind: 'svg' }>).at).toEqual({ x: 50, y: 45 });
    const bigger = whiteboardEdit(doc, { type: 'wb/resize', id: 'anatomy', w: 600, h: 300 });
    const sized = (d: WhiteboardDoc) => { const i = d.items[0] as Extract<WbItem, { kind: 'svg' }>; return { w: i.w, h: i.h }; };
    expect(sized(bigger)).toEqual({ w: 600, h: 300 });
    const tiny = whiteboardEdit(doc, { type: 'wb/resize', id: 'anatomy', w: 1, h: 1 });
    expect(sized(tiny)).toEqual({ w: 40, h: 40 });
  });

  it('a person drags it to move it, and drags its corner handle to resize it', () => {
    const seen: WhiteboardDoc[] = [];
    render(<Whiteboard repoRoot="r" storage={memory()} onDocChange={(d) => seen.push(d)} agentItems={[svgItem()]} />);
    const last = () => seen[seen.length - 1]!.items.find((i) => i.id === 'anatomy') as Extract<WbItem, { kind: 'svg' }>;
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    expect(screen.queryByTestId('wb-resize')).toBeNull();
    const canvas = screen.getByTestId('wb-canvas');
    const item = screen.getByTestId('wb-item');
    mouse(item, 'pointerdown', 100, 100);
    mouse(canvas, 'pointermove', 130, 120);
    mouse(canvas, 'pointerup', 130, 120);
    expect(last().at).toEqual({ x: 70, y: 70 });
    /* selected: the corner handle is there, and dragging it grows the frame */
    const handle = screen.getByTestId('wb-resize');
    mouse(handle, 'pointerdown', 470, 310);
    mouse(canvas, 'pointermove', 520, 340);
    mouse(canvas, 'pointerup', 520, 340);
    expect([last().w, last().h]).toEqual([450, 270]);
    expect(last().at).toEqual({ x: 70, y: 70 });
    expect(screen.getByTestId('wb-item').querySelector('svg')!.getAttribute('width')).toBe('450');
  });
});
