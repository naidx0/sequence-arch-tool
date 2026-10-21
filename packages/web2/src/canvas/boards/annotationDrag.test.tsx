import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArchCapture, ArchMarks, ArchPalette } from './ArchDraw';
import { resetBoardsStreamForTests, useBoardDoc } from './boardsClient';
import { resolveItems } from './boardsModel';
import { FakeEventSource, fakeBoardsServer } from './fakeBoardsServer';
import type { WbItem } from '../../whiteboard/whiteboardModel';

const boxes = [{ id: 'svc', x: 100, y: 50, w: 160, h: 64 }];
const toFlow = ({ x, y }: { x: number; y: number }) => ({ x: (x - 20) / .25, y: (y - 10) / .25 });
let server: ReturnType<typeof fakeBoardsServer>;
beforeEach(() => {
  server = fakeBoardsServer();
  vi.stubGlobal('fetch', server.fetch);
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('PointerEvent', MouseEvent);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) });
  resetBoardsStreamForTests();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetBoardsStreamForTests(); });

function Pad({ board = 'architecture', passive = false }: { board?: string; passive?: boolean }) {
  const { doc, write } = useBoardDoc(board);
  const items = doc?.items ?? [];
  return <>
    <ArchMarks items={items} boxOf={id => boxes.find(b => b.id === id)} hittable />
    <ArchCapture tool="select" passive={passive} toFlow={toFlow} boxes={boxes} items={items}
      onPut={item => void write([{ op: 'put', item }])} onRemove={id => void write([{ op: 'remove', id }])} />
  </>;
}
async function seed(item: WbItem) {
  server.agentDraw('architecture', [{ op: 'put', item }]);
  await waitFor(() => expect(document.querySelector(`[data-annot-id="${item.id}"]`)).toBeTruthy());
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => document.querySelector(`[data-annot-id="${item.id}"]`));
}
function drag(end = 'pointerUp') {
  const capture = screen.getByTestId('annot-capture');
  fireEvent.pointerDown(capture, { clientX: 40, clientY: 30, button: 0, pointerId: 1 });
  fireEvent.pointerMove(capture, { clientX: 50, clientY: 40, pointerId: 1 });
  fireEvent[end === 'pointerUp' ? 'pointerUp' : 'pointerCancel'](capture, { clientX: 60, clientY: 50, pointerId: 1 });
}

it('offers Select / move in the mounted drawing palette', () => {
  const onTool = vi.fn();
  render(<ArchPalette tool="pen" onTool={onTool} onDone={() => {}} hidden={0} />);
  fireEvent.click(screen.getByRole('button', { name: /select/i }));
  expect(onTool).toHaveBeenCalledWith('select');
});

it.each<WbItem>([
  { kind: 'text', id: 't', at: { x: 5, y: 6 }, text: 'Text', by: 'agent', anchor: 'svc' },
  { kind: 'text', id: 's', at: { x: 5, y: 6 }, text: 'Sticky', sticky: true },
  { kind: 'shape', id: 'r', shape: 'rect', from: { x: 5, y: 6 }, to: { x: 65, y: 76 } },
  { kind: 'shape', id: 'e', shape: 'ellipse', from: { x: 5, y: 6 }, to: { x: 65, y: 76 } },
  { kind: 'stroke', id: 'p', width: 2, points: [{ x: 5, y: 6 }, { x: 65, y: 76 }] },
])('moves $id at far zoom once, keeping its author and re-anchoring to the drop, then survives board switch and remount', async item => {
  const view = render(<Pad />);
  await seed(item);
  const before = resolveItems([item], id => boxes.find(b => b.id === id)).items[0]!;
  drag();
  await waitFor(() => expect(server.calls.filter(c => c === 'POST /api/boards/architecture/ops')).toHaveLength(1));
  const stored = server.items('architecture')[0]!;
  expect(stored.id).toBe(item.id);
  /* A moved mark belongs to the card it is dropped on; this drop is on empty board, so it is free. */
  expect(stored.anchor).toBeUndefined();
  expect(stored.by).toBe(item.by);
  const after = resolveItems([stored], id => boxes.find(b => b.id === id)).items[0]!;
  const coords = (i: WbItem) => i.kind === 'stroke' ? i.points : i.kind === 'shape' ? [i.from, i.to] : [i.at];
  expect(coords(after)).toEqual(coords(before).map(p => ({ x: p.x + 80, y: p.y + 80 })));
  view.rerender(<Pad board="whiteboard" />);
  await waitFor(() => expect(screen.queryByTestId('annot-mark')).toBeNull());
  view.unmount();
  render(<Pad />);
  await waitFor(() => expect(screen.getByTestId('annot-mark').getAttribute('data-annot-id')).toBe(item.id));
  expect(server.items('architecture')[0]).toEqual(stored);
});

it('moves a bound arrow from its rendered endpoints, releasing bindings instead of snapping back', async () => {
  const item: WbItem = { kind: 'shape', id: 'a', shape: 'arrow', from: { x: 0, y: 0 }, to: { x: 400, y: 90 }, fromId: 'svc' };
  render(<Pad />);
  await seed(item);
  const resolved = resolveItems([item], id => boxes.find(b => b.id === id)).items[0]!;
  drag();
  await waitFor(() => expect(server.items('architecture')[0]).not.toEqual(item));
  const moved = server.items('architecture')[0]!;
  expect(moved.kind).toBe('shape');
  if (moved.kind !== 'shape' || resolved.kind !== 'shape') throw new Error('arrow');
  expect(moved.fromId).toBeUndefined();
  expect(moved.from).toEqual({ x: resolved.from.x + 80, y: resolved.from.y + 80 });
  expect(moved.to).toEqual({ x: resolved.to.x + 80, y: resolved.to.y + 80 });
});

it('cancel, a click without movement, passive pan and blank space write nothing', async () => {
  const view = render(<Pad />);
  await seed({ kind: 'text', id: 't', at: { x: 5, y: 6 }, text: 'Text' });
  drag('pointerCancel');
  const capture = screen.getByTestId('annot-capture');
  fireEvent.pointerDown(capture, { clientX: 40, clientY: 30, button: 0 });
  fireEvent.pointerUp(capture, { clientX: 40, clientY: 30 });
  view.rerender(<Pad passive />);
  drag();
  view.rerender(<Pad />);
  vi.mocked(document.elementFromPoint).mockReturnValue(null);
  drag();
  expect(server.calls.filter(c => c.startsWith('POST'))).toEqual([]);
});

it('lost capture and a changed board document cancel the preview and selection', async () => {
  render(<Pad />);
  await seed({ kind: 'text', id: 't', at: { x: 5, y: 6 }, text: 'Text' });
  const capture = screen.getByTestId('annot-capture');
  const begin = () => {
    fireEvent.pointerDown(capture, { clientX: 40, clientY: 30, button: 0 });
    fireEvent.pointerMove(capture, { clientX: 50, clientY: 40 });
  };
  begin();
  expect(screen.getByTestId('annot-mark').style.translate).toBe('40px 40px');
  fireEvent.lostPointerCapture(capture);
  expect(screen.getByTestId('annot-mark').style.translate).toBe('');
  expect(screen.getByTestId('annot-mark').hasAttribute('data-annot-selected')).toBe(false);
  begin();
  server.agentDraw('architecture', [{ op: 'remove', id: 't' }]);
  await waitFor(() => expect(screen.queryByTestId('annot-mark')).toBeNull());
  fireEvent.pointerUp(capture, { clientX: 60, clientY: 50 });
  expect(server.calls.filter(c => c.startsWith('POST'))).toEqual([]);
});

it('cannot select a mark from another mounted board', async () => {
  render(<Pad />);
  await seed({ kind: 'text', id: 't', at: { x: 5, y: 6 }, text: 'Text' });
  const foreign = document.createElement('div');
  foreign.setAttribute('data-annot-id', 't');
  document.body.append(foreign);
  vi.mocked(document.elementFromPoint).mockReturnValue(foreign);
  drag();
  expect(server.calls.filter(c => c.startsWith('POST'))).toEqual([]);
  foreign.remove();
});
