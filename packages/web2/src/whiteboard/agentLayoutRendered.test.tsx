import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Whiteboard } from './Whiteboard';
import { measureLine, type WbItem } from './whiteboardModel';
import '../tokens/graphite.css';
import './whiteboard.css';

const store = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), key: () => null, length: 0, clear: () => m.clear() } as unknown as Storage;
};

const label = 'loop 3-4 until done';
const AGENT: WbItem[] = [
  { kind: 'shape', id: 'obs:box', shape: 'rect', from: { x: 236, y: 60 }, to: { x: 392, y: 104 } },
  { kind: 'text', id: 'obs', at: { x: 250, y: 86 }, text: '4 OBSERVE\nRead the tool result: stdout, files, errors, anything else the tool returned' },
  { kind: 'shape', id: 'act:box', shape: 'rect', from: { x: 40, y: 60 }, to: { x: 196, y: 104 } },
  { kind: 'text', id: 'act', at: { x: 54, y: 86 }, text: '3 ACT' },
  { kind: 'shape', id: 'back', shape: 'arrow', from: { x: 232, y: 82 }, to: { x: 200, y: 82 } },
  { kind: 'text', id: 'back-label', at: { x: 216 - measureLine(label, 12) / 2, y: 78 }, text: label },
];

describe('the whiteboard paints an agent drawing readably (0.1.5, screenshot 3)', () => {
  it('words are inside their box, the connector label is on a backing, nothing is drawn twice', () => {
    render(<Whiteboard repoRoot="r" storage={store()} agentItems={AGENT} />);
    /* The box words are ONE label per box, wrapped to several lines for the long one. */
    const lines = screen.getAllByTestId('wb-label-line').map((n) => n.textContent);
    expect(lines.filter((l) => l === '4 OBSERVE')).toHaveLength(1);
    expect(lines.length).toBeGreaterThan(3);
    /* The connector's label is on its backing; the loose word is not also painted as a free text mark. */
    const edge = screen.getByTestId('wb-edge-label');
    expect(edge.querySelector('rect.wb-edge-back')).not.toBeNull();
    expect(edge.textContent).toBe(label);
    const loose = screen.getAllByTestId('wb-item').filter((n) => n.getAttribute('data-kind') === 'text');
    expect(loose).toHaveLength(0);
  });
});
