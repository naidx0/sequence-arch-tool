import { readFileSync } from 'node:fs';
import path from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Whiteboard } from './Whiteboard';
import { WB_COLORS, WB_COLOR_TOKEN, WB_FILLS, asWbColor, asWbFill, paint } from './palette';
import { whiteboardEdit, type WhiteboardDoc, type WbItem } from './whiteboardModel';
import '../tokens/graphite.css';
import './whiteboard.css';

afterEach(cleanup);

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};
function drag(el: Element, points: { x: number; y: number }[]) {
  const fire = (type: string, p: { x: number; y: number }) => fireEvent(el, new MouseEvent(type, { bubbles: true, clientX: p.x, clientY: p.y }));
  fire('pointerdown', points[0]!);
  for (const p of points.slice(1)) fire('pointermove', p);
  fire('pointerup', points[points.length - 1]!);
}
const here = (rel: string) => readFileSync(path.resolve(__dirname, rel), 'utf8').replace(/\r\n/g, '\n');
type Shape = Extract<WbItem, { kind: 'shape' }>;
const shape = (extra: Partial<Shape> & { id: string }): WbItem => ({ kind: 'shape', shape: 'rect', from: { x: 0, y: 0 }, to: { x: 100, y: 60 }, by: 'agent', ...extra }) as WbItem;
const board = (items: WbItem[]) => render(<Whiteboard repoRoot="r" storage={memory()} agentItems={items} />);
const item = (testId = 'wb-item', kind?: string) => screen.getAllByTestId(testId).find((e) => !kind || e.getAttribute('data-kind') === kind)!;

/* B2/B5 on the backend's board-item contract (docs/requests/backend-shapes.md "Board items"). */
describe('the palette is the contract\'s names, drawn with the theme\'s own tokens', () => {
  it('maps every name to a token that exists in the theme, and the stylesheet draws that token (derived from the sets)', () => {
    const graphite = here('../tokens/graphite.css');
    const css = here('whiteboard.css');
    for (const name of WB_FILLS) {
      const token = WB_COLOR_TOKEN[name];
      if (name !== 'none') expect(graphite, `${name} -> ${token}`).toMatch(new RegExp(`${token}:`));
      expect(css, `${name} fill`).toContain(`[data-fill='${name}'] { --wb-f: ${name === 'none' ? 'transparent' : `var(${token})`}; }`);
    }
    for (const name of WB_COLORS) expect(css, `${name} stroke`).toContain(`[data-color='${name}'] { --wb-c: var(${WB_COLOR_TOKEN[name]}); }`);
    expect(WB_COLORS).toEqual(['ink', 'muted', 'accent', 'positive', 'warning', 'danger', 'info', 'chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'chart6']);
    const block = css.slice(css.indexOf('THE DRAWING PALETTE'), css.indexOf('.wb-swatch {'));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('reads the first palette as chart1..6 and refuses anything that is not a name', () => {
    expect([asWbColor('gold'), asWbColor('blue'), asWbColor('magenta'), asWbColor('teal'), asWbColor('bronze'), asWbColor('indigo')]).toEqual(['chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'chart6']);
    expect(asWbColor('danger')).toBe('danger');
    expect(asWbColor('#ff0000')).toBeUndefined();
    expect(asWbColor('red; background:url(x)')).toBeUndefined();
    expect(asWbFill('surface')).toBe('surface');
    expect(asWbFill('none')).toBe('none');
    expect(asWbColor('surface')).toBeUndefined();
  });

  it('a hex is drawn only for an own-theme mark, and only if it is a plain hex', () => {
    expect(paint('#336699', true, false)).toEqual({ hex: '#336699' });
    expect(paint('#336699', undefined, false)).toEqual({});
    expect(paint('#336699;fill:red', true, false)).toEqual({});
    expect(paint('url(#x)', true, true)).toEqual({});
    expect(paint('danger', true, false)).toEqual({ name: 'danger' });
  });
});

describe('a person chooses a colour', () => {
  it('the Colour menu lists the names in the shared menu rows', () => {
    render(<Whiteboard repoRoot="r" storage={memory()} />);
    fireEvent.click(screen.getByTestId('wb-color-trigger'));
    const rows = screen.getAllByRole('menuitemradio').filter((r) => r.getAttribute('data-testid')?.startsWith('wb-color-'));
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(WB_COLORS.map((c) => `wb-color-${c}`));
    expect(rows[0]!.textContent).toBe('Ink');
    expect(rows.every((r) => r.className === 'wb-menuitem')).toBe(true);
    expect(screen.getByTestId('wb-color-ink').getAttribute('aria-checked')).toBe('true');
  });

  it('new marks are written the way the contract names it: a shape and a stroke by `stroke`, a text by `color`; ink is no colour', () => {
    const seen: WhiteboardDoc[] = [];
    render(<Whiteboard repoRoot="r" storage={memory()} onDocChange={(d) => seen.push(d)} />);
    const last = () => seen[seen.length - 1]!.items;
    fireEvent.click(screen.getByTestId('wb-color-trigger'));
    fireEvent.click(screen.getByTestId('wb-color-chart2'));
    fireEvent.click(screen.getByTestId('wb-shapes-trigger'));
    fireEvent.click(screen.getByTestId('wb-tool-arrow'));
    drag(screen.getByTestId('wb-canvas'), [{ x: 10, y: 10 }, { x: 90, y: 60 }]);
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    drag(screen.getByTestId('wb-canvas'), [{ x: 10, y: 80 }, { x: 40, y: 90 }, { x: 70, y: 80 }]);
    fireEvent.click(screen.getByTestId('wb-annotate-trigger'));
    fireEvent.click(screen.getByTestId('wb-tool-text'));
    drag(screen.getByTestId('wb-canvas'), [{ x: 10, y: 150 }, { x: 10, y: 150 }]);
    expect(last().map((i) => [i.kind, i.stroke, i.color])).toEqual([
      ['shape', 'chart2', undefined],
      ['stroke', 'chart2', undefined],
      ['text', undefined, 'chart2'],
    ]);
    expect(new Set(screen.getAllByTestId('wb-item').map((e) => e.getAttribute('data-color')))).toEqual(new Set(['chart2']));
    fireEvent.click(screen.getByTestId('wb-color-trigger'));
    fireEvent.click(screen.getByTestId('wb-color-ink'));
    fireEvent.click(screen.getByTestId('wb-tool-draw'));
    drag(screen.getByTestId('wb-canvas'), [{ x: 10, y: 200 }, { x: 40, y: 220 }, { x: 70, y: 200 }]);
    expect(last()[3]!.stroke).toBeUndefined();
  });

  it('with a mark selected a colour recolours it (replacing a first-palette `color`), and Fill gives a shape the surface fill', () => {
    const seen: WhiteboardDoc[] = [];
    render(<Whiteboard repoRoot="r" storage={memory()} onDocChange={(d) => seen.push(d)} agentItems={[shape({ id: 'a', color: 'gold' })]} />);
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    fireEvent.pointerDown(screen.getByTestId('wb-item'));
    fireEvent.click(screen.getByTestId('wb-color-trigger'));
    expect((screen.getByTestId('wb-color-tint') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('wb-color-danger'));
    const a = () => seen[seen.length - 1]!.items[0]!;
    expect(a().stroke).toBe('danger');
    expect(a().color).toBeUndefined();
    fireEvent.click(screen.getByTestId('wb-color-trigger'));
    fireEvent.click(screen.getByTestId('wb-color-tint'));
    expect(a().fill).toBe('surface');
    expect(screen.getByTestId('wb-item').getAttribute('data-fill')).toBe('surface');
  });
});

describe('the renderer draws what the contract says', () => {
  it('maps stroke and fill names to the stylesheet, and a first-palette colour to chart1..6', () => {
    board([shape({ id: 'a', stroke: 'warning', fill: 'surface' }), shape({ id: 'b', color: 'gold', fill: 'none', from: { x: 200, y: 0 }, to: { x: 300, y: 60 } })]);
    const [a, b] = screen.getAllByTestId('wb-item');
    expect([a!.getAttribute('data-color'), a!.getAttribute('data-fill')]).toEqual(['warning', 'surface']);
    expect([b!.getAttribute('data-color'), b!.getAttribute('data-fill')]).toEqual(['chart1', 'none']);
  });

  it('draws an own-theme hex raw, and ignores a hex (or css) on a mark that is not own-theme', () => {
    board([
      shape({ id: 'a', stroke: '#336699', fill: '#112233', ownTheme: true }),
      shape({ id: 'b', stroke: '#336699', from: { x: 200, y: 0 }, to: { x: 300, y: 60 } }),
      shape({ id: 'c', stroke: 'red;position:fixed', ownTheme: true, from: { x: 400, y: 0 }, to: { x: 500, y: 60 } }),
    ]);
    const [a, b, c] = screen.getAllByTestId('wb-item');
    expect((a as SVGElement).style.stroke).toBe('#336699');
    expect((a as SVGElement).style.fill).toBe('#112233');
    expect((b as SVGElement).getAttribute('style')).toBeNull();
    expect(b!.getAttribute('data-color')).toBeNull();
    expect((c as SVGElement).getAttribute('style')).toBeNull();
  });

  it('reads strokeWidth (1 to 8) and dash: dashed 6 4, dotted 1.5 4 round', () => {
    board([
      shape({ id: 'a', strokeWidth: 5, dash: 'dashed' }),
      shape({ id: 'b', dash: 'dotted', from: { x: 200, y: 0 }, to: { x: 300, y: 60 } }),
      shape({ id: 'c', strokeWidth: 99, from: { x: 400, y: 0 }, to: { x: 500, y: 60 } }),
    ]);
    const [a, b, c] = screen.getAllByTestId('wb-item') as SVGElement[];
    expect([a!.style.strokeWidth, a!.style.strokeDasharray]).toEqual(['5', '6 4']);
    expect([b!.style.strokeDasharray, b!.style.strokeLinecap]).toEqual(['1.5 4', 'round']);
    expect(c!.style.strokeWidth).toBe('');
  });

  it('a path is a polyline through its points (not a line from first to last), and its bounds cover them', () => {
    const pts = [{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 120, y: 20 }];
    const { container } = board([shape({ id: 'p', shape: 'path', points: pts, from: pts[0]!, to: pts[2]!, stroke: 'info' })]);
    const poly = container.querySelector('polyline[data-testid="wb-item"]')!;
    expect(poly.getAttribute('points')).toBe('0,0 50,80 120,20');
    expect(poly.getAttribute('data-color')).toBe('info');
    expect(container.querySelector('line[data-testid="wb-item"]')).toBeNull();
    const moved = whiteboardEdit({ version: 1, items: [shape({ id: 'p', shape: 'path', points: pts, from: pts[0]!, to: pts[2]!, by: undefined })] }, { type: 'wb/move', id: 'p', dx: 10, dy: 5 });
    expect((moved.items[0] as Shape).points).toEqual([{ x: 10, y: 5 }, { x: 60, y: 85 }, { x: 130, y: 25 }]);
  });

  it('a frame is an outline with no fill by default and a 36px title band holding its label', () => {
    const { container } = board([shape({ id: 'f', shape: 'frame', label: 'Checkout', from: { x: 0, y: 0 }, to: { x: 300, y: 200 }, stroke: 'muted' })]);
    const rect = container.querySelector('rect[data-shape="frame"]')!;
    expect(rect.getAttribute('data-fill')).toBeNull();
    expect(rect.getAttribute('data-color')).toBe('muted');
    const band = container.querySelector('line.wb-frame-band')!;
    expect(band.getAttribute('y1')).toBe('36');
    expect(band.getAttribute('x2')).toBe('300');
    expect(screen.getByTestId('wb-frame-title').textContent).toBe('Checkout');
  });

  it('an arrow keeps its head, a line has none unless asked, and arrowStart/arrowEnd take arrow, dot, bar or none', () => {
    const line = (id: string, extra: Partial<Shape>) => shape({ id, shape: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, ...extra });
    const { container } = board([
      shape({ id: 'a1', shape: 'arrow', from: { x: 0, y: 10 }, to: { x: 100, y: 10 } }),
      line('l1', {}),
      line('l2', { arrowEnd: 'dot', arrowStart: 'bar' }),
      line('l3', { arrowEnd: 'arrow', arrowStart: 'arrow' }),
      shape({ id: 'a2', shape: 'arrow', arrowEnd: 'none', from: { x: 0, y: 20 }, to: { x: 100, y: 20 } }),
    ]);
    const group = (i: number) => container.querySelectorAll('[data-item-id]')[i]!;
    expect(group(0).querySelectorAll('path[data-testid="wb-item"]')).toHaveLength(1);
    expect(group(1).querySelectorAll('path, circle, line[data-head]')).toHaveLength(0);
    expect(group(2).querySelectorAll('circle[data-head="dot"]')).toHaveLength(1);
    expect(group(2).querySelectorAll('line[data-head="bar"]')).toHaveLength(1);
    expect(group(3).querySelectorAll('path[data-testid="wb-item"]')).toHaveLength(2);
    expect(group(4).querySelectorAll('path[data-testid="wb-item"]')).toHaveLength(0);
  });

  it('puts a label where labelPos says and at the size fontSize says (sm 12, md 14, lg 17)', () => {
    board([
      shape({ id: 'd', shape: 'diamond', label: 'Valid?', labelPos: 'top', fontSize: 'lg', from: { x: 100, y: 100 }, to: { x: 200, y: 180 } }),
      shape({ id: 'e', shape: 'diamond', label: 'Below', labelPos: 'bottom', fontSize: 'sm', from: { x: 300, y: 100 }, to: { x: 400, y: 180 } }),
    ]);
    const [top, bottom] = screen.getAllByTestId('wb-shape-label');
    expect([top!.getAttribute('data-pos'), top!.getAttribute('y'), top!.getAttribute('x')]).toEqual(['top', '90', '150']);
    expect((top as SVGElement).style.fontSize).toBe('17px');
    expect([bottom!.getAttribute('y'), (bottom as SVGElement).style.fontSize]).toEqual(['196', '12px']);
  });

  it('a text takes color (name, or own-theme hex) and fontSize; a sticky takes the name too', () => {
    board([
      { kind: 'text', id: 't1', at: { x: 0, y: 20 }, text: 'Hot', color: 'danger', fontSize: 'md', by: 'agent' },
      { kind: 'text', id: 't2', at: { x: 0, y: 60 }, text: 'Own', color: '#aa3300', ownTheme: true, fontSize: 'lg', by: 'agent' },
      { kind: 'text', id: 's1', at: { x: 0, y: 100 }, text: 'note', sticky: true, color: 'info', fill: 'accent', by: 'agent' },
    ]);
    const [t1, t2, s1] = screen.getAllByTestId('wb-item') as SVGElement[];
    expect([t1!.getAttribute('data-color'), t1!.style.fontSize]).toEqual(['danger', '14px']);
    expect([t2!.style.fill, t2!.style.fontSize, t2!.getAttribute('data-color')]).toEqual(['#aa3300', '17px', null]);
    expect([s1!.getAttribute('data-color'), s1!.getAttribute('data-fill')]).toEqual(['info', 'accent']);
  });
});

describe('a group is one diagram, and a person can make and unmake one', () => {
  const trio = (): WbItem[] => [
    shape({ id: 'a', from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, by: undefined }),
    shape({ id: 'b', from: { x: 50, y: 0 }, to: { x: 60, y: 10 }, by: undefined }),
    shape({ id: 'c', from: { x: 100, y: 0 }, to: { x: 110, y: 10 }, by: undefined }),
  ];
  const doc = (items: WbItem[]): WhiteboardDoc => ({ version: 1, items });

  it('moving one member moves the whole group and nothing outside it, as ONE edit', () => {
    const grouped = trio().map((i) => (i.id === 'c' ? i : { ...i, group: 'flow' })) as WbItem[];
    const next = whiteboardEdit(doc(grouped), { type: 'wb/move', id: 'a', dx: 5, dy: 7 });
    const at = (id: string) => (next.items.find((i) => i.id === id) as Shape).from;
    expect([at('a'), at('b'), at('c')]).toEqual([{ x: 5, y: 7 }, { x: 55, y: 7 }, { x: 100, y: 0 }]);
  });

  it('wb/group sets and clears a shared group id on exactly the ids given', () => {
    const on = whiteboardEdit(doc(trio()), { type: 'wb/group', ids: ['a', 'b'], group: 'g1' });
    expect(on.items.map((i) => i.group)).toEqual(['g1', 'g1', undefined]);
    expect(whiteboardEdit(on, { type: 'wb/group', ids: ['a', 'b'], group: 'g1' })).toBe(on);
    const off = whiteboardEdit(on, { type: 'wb/group', ids: ['a', 'b'], group: null });
    expect(off.items.map((i) => i.group)).toEqual([undefined, undefined, undefined]);
  });

  it('Group (More menu and Ctrl+G) groups a marquee selection; Ungroup (and Ctrl+Shift+G) takes it apart; one undo each', () => {
    const seen: WhiteboardDoc[] = [];
    render(<Whiteboard repoRoot="r" storage={memory()} onDocChange={(d) => seen.push(d)} agentItems={trio()} />);
    const groups = () => seen[seen.length - 1]!.items.map((i) => i.group);
    const canvas = screen.getByTestId('wb-canvas');
    fireEvent.click(screen.getByTestId('wb-tool-select'));
    fireEvent.click(screen.getByTestId('wb-more'));
    expect((screen.getByTestId('wb-more-group') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('wb-more-ungroup') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('wb-more'));
    /* Shift-marquee over the first two marks */
    fireEvent(canvas, Object.assign(new MouseEvent('pointerdown', { bubbles: true, clientX: -5, clientY: -5, shiftKey: true })));
    fireEvent(canvas, new MouseEvent('pointermove', { bubbles: true, clientX: 70, clientY: 20 }));
    fireEvent(canvas, new MouseEvent('pointerup', { bubbles: true, clientX: 70, clientY: 20 }));
    fireEvent.click(screen.getByTestId('wb-more'));
    expect((screen.getByTestId('wb-more-group') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('wb-more-group'));
    const [ga, gb, gc] = groups();
    expect(ga).toBeDefined();
    expect(gb).toBe(ga);
    expect(gc).toBeUndefined();
    /* one undo takes the Group back, and Group again puts it back */
    fireEvent.keyDown(screen.getByTestId('whiteboard'), { key: 'z', ctrlKey: true });
    expect(groups()).toEqual([undefined, undefined, undefined]);
    fireEvent.click(screen.getByTestId('wb-more'));
    fireEvent.click(screen.getByTestId('wb-more-group'));
    expect(groups()[0]).toBeDefined();
    /* a press on a member selects the group, and Ungroup takes it apart */
    fireEvent.pointerDown(screen.getAllByTestId('wb-item')[0]!);
    expect(screen.getAllByTestId('wb-item').map((e) => e.getAttribute('data-selected'))).toEqual(['true', 'true', 'false']);
    fireEvent.click(screen.getByTestId('wb-more'));
    fireEvent.click(screen.getByTestId('wb-more-ungroup'));
    expect(groups()).toEqual([undefined, undefined, undefined]);
    /* the keys */
    const root = screen.getByTestId('whiteboard');
    fireEvent.pointerDown(screen.getAllByTestId('wb-item')[0]!);
    fireEvent(canvas, new MouseEvent('pointerup', { bubbles: true, clientX: 0, clientY: 0 }));
    fireEvent(canvas, new MouseEvent('pointerdown', { bubbles: true, clientX: -5, clientY: -5, shiftKey: true }));
    fireEvent(canvas, new MouseEvent('pointermove', { bubbles: true, clientX: 70, clientY: 20 }));
    fireEvent(canvas, new MouseEvent('pointerup', { bubbles: true, clientX: 70, clientY: 20 }));
    fireEvent.keyDown(root, { key: 'g', ctrlKey: true });
    expect(groups()[0]).toBeDefined();
    expect(groups()[0]).toBe(groups()[1]);
    fireEvent.pointerDown(screen.getAllByTestId('wb-item')[0]!);
    fireEvent.keyDown(root, { key: 'G', ctrlKey: true, shiftKey: true });
    expect(groups()).toEqual([undefined, undefined, undefined]);
  });
});
