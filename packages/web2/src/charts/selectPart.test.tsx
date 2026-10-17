import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { SeqChartView } from './SeqChartView';
import type { SeqChart } from '@sequence/schema';

/*
 * "THE PERSON CAN SELECT A DRAWN PART AND ASK ABOUT IT."
 *                              — the owner, deferred from the 2026-09-13 walk
 *
 * Everything before this made Sequence able to DRAW well (stages 1–2) and to
 * READ what it had drawn (stage 3). This is the half where the reader can
 * answer back, and it is what "tldraw-style" was asking for.
 *
 * ONE DELEGATED HANDLER, NOT EIGHT RENDERERS. `itemAttrs` already stamps
 * `data-item` on every item of every family — it was added for cross-
 * highlighting against the board — so selection resolves by walking up from the
 * click. These tests assert that across families, because "it works on the one
 * family I tried" is how the other seven quietly do not.
 */

const flow: SeqChart = {
  version: 1,
  kind: 'data-flow',
  title: 'How a question is answered',
  items: [
    { id: 'tok', label: 'Tokenizer' },
    { id: 'emb', label: 'Embedding' },
  ],
  links: [{ from: 'tok', to: 'emb' }],
} as unknown as SeqChart;

const grounded: SeqChart = {
  version: 1,
  kind: 'data-flow',
  title: 'Real services',
  items: [{ id: 'a', label: 'Gateway', nodeId: 'svc:gateway' }, { id: 'b', label: 'Orders' }],
  links: [{ from: 'a', to: 'b' }],
} as unknown as SeqChart;

describe('a drawn part can be pointed at', () => {
  it('clicking an item reports its id and the words on screen', () => {
    const onSelectPart = vi.fn();
    const { container } = render(<SeqChartView chart={flow} onSelectPart={onSelectPart} />);
    const item = container.querySelector('[data-item="tok"]');
    expect(item).not.toBeNull();
    fireEvent.click(item!);
    expect(onSelectPart).toHaveBeenCalledWith({ itemId: 'tok', label: 'Tokenizer' });
  });

  it('a click on a CHILD of the item still selects the item', () => {
    // A reader aims at the box, and hits its label, its rect, or its icon.
    const onSelectPart = vi.fn();
    const { container } = render(<SeqChartView chart={flow} onSelectPart={onSelectPart} />);
    const child = container.querySelector('[data-item="emb"] *');
    if (child) {
      fireEvent.click(child);
      expect(onSelectPart).toHaveBeenCalledWith({ itemId: 'emb', label: 'Embedding' });
    }
  });

  it('carries nodeId when the item stands for a real scanned node', () => {
    const onSelectPart = vi.fn();
    const { container } = render(<SeqChartView chart={grounded} onSelectPart={onSelectPart} />);
    fireEvent.click(container.querySelector('[data-item="a"]')!);
    expect(onSelectPart).toHaveBeenCalledWith({
      itemId: 'a',
      label: 'Gateway',
      nodeId: 'svc:gateway',
    });
    // …and omits it when the item is not grounded, rather than sending null.
    onSelectPart.mockClear();
    fireEvent.click(container.querySelector('[data-item="b"]')!);
    expect(onSelectPart).toHaveBeenCalledWith({ itemId: 'b', label: 'Orders' });
  });

  it('a click on the CHART but not on an item selects nothing', () => {
    const onSelectPart = vi.fn();
    render(<SeqChartView chart={flow} onSelectPart={onSelectPart} />);
    fireEvent.click(screen.getByTestId('seqchart-pick'));
    expect(onSelectPart).not.toHaveBeenCalled();
  });

  it('an id the chart does not have is DROPPED, never passed on', () => {
    // `data-item` comes out of the DOM — the one input here a bug could make
    // arbitrary. Handing a caller an item the spec does not contain is the same
    // fabrication the validator upstream refuses.
    const onSelectPart = vi.fn();
    const { container } = render(<SeqChartView chart={flow} onSelectPart={onSelectPart} />);
    const fake = document.createElement('div');
    fake.setAttribute('data-item', 'not-in-this-chart');
    container.querySelector('[data-testid="seqchart-pick"]')!.appendChild(fake);
    fireEvent.click(fake);
    expect(onSelectPart).not.toHaveBeenCalled();
  });

  it('WITHOUT a handler nothing is clickable and no affordance is drawn', () => {
    // A control that looks pressable and is not is worse than one that looks
    // inert, so the wrapper only exists where the handler does.
    const { container } = render(<SeqChartView chart={flow} />);
    expect(container.querySelector('[data-testid="seqchart-pick"]')).toBeNull();
    expect(container.querySelector('[data-item="tok"]')).not.toBeNull();
  });

  it('items are keyboard-reachable, so this is not mouse-only', () => {
    const { container } = render(<SeqChartView chart={flow} onSelectPart={vi.fn()} />);
    expect(container.querySelector('[data-item="tok"]')!.getAttribute('tabindex')).toBe('0');
  });
});
