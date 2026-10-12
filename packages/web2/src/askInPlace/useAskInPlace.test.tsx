import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import { buildReference } from './askReference';
import { ASK_FLASH_MS, ASK_HOVER_GRACE_MS, useAskInPlace, type AskHostConfig, type AskPayload } from './useAskInPlace';

/* A board in miniature: three marks with ids, and whatever the test selects. */
function Harness({
  selection,
  onSend,
  select,
  snapshot,
  ownsContextMenu,
}: {
  selection: string[];
  onSend: (p: AskPayload) => void;
  select?: (ids: string[]) => void;
  snapshot?: AskHostConfig['snapshot'];
  ownsContextMenu?: AskHostConfig['ownsContextMenu'];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const ask = useAskInPlace({
    containerRef: ref,
    surface: 'whiteboard',
    selection,
    idAt: (el) => el.closest('[data-item-id]')?.getAttribute('data-item-id') ?? null,
    resolve: (ids) => buildReference('whiteboard', ids.map((id) => ({ id, kind: 'rect', label: id.toUpperCase() }))),
    rectOf: () => ({ left: 100, top: 100, width: 80, height: 40 }),
    elementsOf: (ids) => Array.from(ref.current?.querySelectorAll('[data-item-id]') ?? []).filter((el) => ids.includes(el.getAttribute('data-item-id') ?? '')),
    ...(snapshot ? { snapshot } : {}),
    ...(select ? { select } : {}),
    ...(ownsContextMenu ? { ownsContextMenu } : {}),
    onSend,
  });
  return (
    <div ref={ref} data-testid="board" tabIndex={-1} style={{ position: 'relative' }}>
      <svg>
        <g data-item-id="r1" data-testid="item-r1">
          <rect width="10" height="10" />
        </g>
        <g data-item-id="r2" data-testid="item-r2">
          <rect width="10" height="10" />
        </g>
        <g data-item-id="r3" data-testid="item-r3">
          <rect width="10" height="10" />
        </g>
      </svg>
      <input data-testid="elsewhere" />
      {ask.layer}
    </div>
  );
}

const hoverOver = (id: string) => fireEvent.pointerMove(screen.getByTestId(`item-${id}`).querySelector('rect')!, { buttons: 0 });

afterEach(() => {
  vi.useRealTimers();
});

describe('trigger: hover a selected item', () => {
  it('shows an Ask button beside a selected item the pointer is over', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
    hoverOver('r1');
    const aff = screen.getByTestId('ask-affordance');
    expect(aff.textContent).toBe('Ask');
    expect(aff.getAttribute('aria-label')).toBe('Ask about R1');
  });

  it('does not show over an item that is not selected', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    hoverOver('r2');
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
  });

  it('goes when the pointer leaves the board', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    hoverOver('r1');
    fireEvent.pointerLeave(screen.getByTestId('board'));
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
  });

  it('stays through the gap between the item and the button, and goes after the grace', () => {
    vi.useFakeTimers();
    try {
      render(<Harness selection={['r1']} onSend={() => undefined} />);
      hoverOver('r1');
      /* The pointer is on empty board, between the item and the button. */
      fireEvent.pointerMove(screen.getByTestId('board'));
      expect(screen.queryByTestId('ask-affordance')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(ASK_HOVER_GRACE_MS - 50);
      });
      expect(screen.queryByTestId('ask-affordance')).not.toBeNull();
      /* Reaching the button cancels the hide for good. */
      fireEvent.pointerMove(screen.getByTestId('ask-affordance'));
      act(() => {
        vi.advanceTimersByTime(ASK_HOVER_GRACE_MS * 3);
      });
      expect(screen.queryByTestId('ask-affordance')).not.toBeNull();
      /* Off the button onto empty board, and the grace runs out. */
      fireEvent.pointerMove(screen.getByTestId('board'));
      act(() => {
        vi.advanceTimersByTime(ASK_HOVER_GRACE_MS + 50);
      });
      expect(screen.queryByTestId('ask-affordance')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show while a button is held (a drag)', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    /* jsdom's PointerEvent drops `buttons`; a MouseEvent under the pointer name carries it. */
    fireEvent(screen.getByTestId('item-r1').querySelector('rect')!, new MouseEvent('pointermove', { bubbles: true, buttons: 1 }));
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
  });

  it('opens the popover for the whole selection', () => {
    render(<Harness selection={['r1', 'r2']} onSend={() => undefined} />);
    hoverOver('r2');
    fireEvent.click(screen.getByTestId('ask-affordance'));
    expect(screen.getByTestId('ask-pop-chip').textContent).toBe('2 items: R1, R2');
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
  });
});

describe('trigger: right-click', () => {
  it('on an item opens a menu with Ask about this, and selects the item', () => {
    const select = vi.fn();
    render(<Harness selection={[]} select={select} onSend={() => undefined} />);
    const notPrevented = fireEvent.contextMenu(screen.getByTestId('item-r2').querySelector('rect')!, { clientX: 20, clientY: 30 });
    expect(notPrevented).toBe(false); // the browser's own menu is replaced
    expect(select).toHaveBeenCalledWith(['r2']);
    expect(screen.getByTestId('ask-menu-ask').textContent).toBe('Ask about this');
  });

  it('on a member of a multi-selection asks about the whole selection', () => {
    const select = vi.fn();
    render(<Harness selection={['r1', 'r2', 'r3']} select={select} onSend={() => undefined} />);
    fireEvent.contextMenu(screen.getByTestId('item-r3').querySelector('rect')!);
    expect(select).toHaveBeenCalledWith(['r1', 'r2', 'r3']);
    fireEvent.click(screen.getByTestId('ask-menu-ask'));
    expect(screen.getByTestId('ask-pop-chip').textContent).toBe('3 items: R1, R2, R3');
  });

  it('on bare ground leaves the browser menu alone', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    const notPrevented = fireEvent.contextMenu(screen.getByTestId('board'));
    expect(notPrevented).toBe(true);
    expect(screen.queryByTestId('ask-menu')).toBeNull();
  });

  it('leaves it alone where the board owns the menu (an architecture node)', () => {
    render(<Harness selection={[]} ownsContextMenu={() => false} onSend={() => undefined} />);
    const notPrevented = fireEvent.contextMenu(screen.getByTestId('item-r1').querySelector('rect')!);
    expect(notPrevented).toBe(true);
    expect(screen.queryByTestId('ask-menu')).toBeNull();
  });

  it('Escape closes the menu', () => {
    render(<Harness selection={[]} onSend={() => undefined} />);
    fireEvent.contextMenu(screen.getByTestId('item-r1').querySelector('rect')!);
    expect(screen.getByTestId('ask-menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('ask-menu')).toBeNull();
  });

  it('a press outside the menu closes it', () => {
    render(<Harness selection={[]} onSend={() => undefined} />);
    fireEvent.contextMenu(screen.getByTestId('item-r1').querySelector('rect')!);
    fireEvent.pointerDown(screen.getByTestId('elsewhere'));
    expect(screen.queryByTestId('ask-menu')).toBeNull();
  });
});

describe('trigger: the keyboard', () => {
  it('Ctrl+Enter with a selection opens the popover', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    screen.getByTestId('board').focus();
    fireEvent.keyDown(screen.getByTestId('board'), { key: 'Enter', ctrlKey: true });
    expect(screen.getByTestId('ask-pop')).toBeTruthy();
  });

  it('Cmd+Enter does too', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    fireEvent.keyDown(screen.getByTestId('board'), { key: 'Enter', metaKey: true });
    expect(screen.getByTestId('ask-pop')).toBeTruthy();
  });

  it('/ with a selection opens it', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    fireEvent.keyDown(screen.getByTestId('board'), { key: '/' });
    expect(screen.getByTestId('ask-pop')).toBeTruthy();
  });

  it('does nothing with nothing selected', () => {
    render(<Harness selection={[]} onSend={() => undefined} />);
    fireEvent.keyDown(screen.getByTestId('board'), { key: '/' });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
  });

  it('does nothing while typing in a field', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    fireEvent.keyDown(screen.getByTestId('elsewhere'), { key: '/' });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
  });

  it('does nothing when the key is not for this board', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
  });

  it('is the board\'s once the pointer is over it, with focus on the page', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    fireEvent.pointerEnter(screen.getByTestId('board'));
    fireEvent.keyDown(document.body, { key: '/' });
    expect(screen.getByTestId('ask-pop')).toBeTruthy();
  });
});

describe('sending', () => {
  it('hands the words, the reference and the crop to the host, then closes', async () => {
    const onSend = vi.fn();
    const crop = new Blob(['png'], { type: 'image/png' });
    const snapshot = vi.fn().mockResolvedValue(crop);
    render(<Harness selection={['r1', 'r2']} onSend={onSend} snapshot={snapshot} />);
    fireEvent.keyDown(screen.getByTestId('board'), { key: '/' });
    fireEvent.change(screen.getByTestId('ask-pop-input'), { target: { value: 'why does this loop?' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('ask-pop-input'), { key: 'Enter' });
    });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
    expect(snapshot).toHaveBeenCalledWith(['r1', 'r2']);
    expect(onSend).toHaveBeenCalledTimes(1);
    const payload = onSend.mock.calls[0]![0] as AskPayload;
    expect(payload.text).toBe('why does this loop?');
    expect(payload.image).toBe(crop);
    expect(payload.reference.targets.map((t) => t.id)).toEqual(['r1', 'r2']);
    expect(payload.reference.summary).toBe('2 items: R1, R2');
  });

  it('still sends when the crop cannot be made', async () => {
    const onSend = vi.fn();
    render(<Harness selection={['r1']} onSend={onSend} snapshot={() => Promise.reject(new Error('no canvas'))} />);
    fireEvent.keyDown(screen.getByTestId('board'), { key: '/' });
    fireEvent.change(screen.getByTestId('ask-pop-input'), { target: { value: 'hello' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('ask-pop-send'));
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect((onSend.mock.calls[0]![0] as AskPayload).image).toBeNull();
  });

  it('marks the referenced items while the box is open, and lets them glow briefly after the send', async () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    render(<Harness selection={['r1', 'r3']} onSend={onSend} />);
    fireEvent.keyDown(screen.getByTestId('board'), { key: '/' });
    expect(screen.getByTestId('item-r1').getAttribute('data-ask-target')).toBe('true');
    expect(screen.getByTestId('item-r3').getAttribute('data-ask-target')).toBe('true');
    expect(screen.getByTestId('item-r2').getAttribute('data-ask-target')).toBeNull();
    fireEvent.change(screen.getByTestId('ask-pop-input'), { target: { value: 'go' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('ask-pop-input'), { key: 'Enter' });
    });
    expect(screen.getByTestId('item-r1').getAttribute('data-ask-target')).toBeNull();
    expect(screen.getByTestId('item-r1').getAttribute('data-ask-flash')).toBe('true');
    expect(screen.getByTestId('item-r3').getAttribute('data-ask-flash')).toBe('true');
    expect(screen.getByTestId('item-r2').getAttribute('data-ask-flash')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(ASK_FLASH_MS + 10);
    });
    expect(screen.getByTestId('item-r1').getAttribute('data-ask-flash')).toBeNull();
    expect(screen.getByTestId('item-r3').getAttribute('data-ask-flash')).toBeNull();
  });

  it('Escape closes the popover and focus returns to the board', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    screen.getByTestId('board').focus();
    fireEvent.keyDown(screen.getByTestId('board'), { key: '/' });
    expect(document.activeElement).toBe(screen.getByTestId('ask-pop-input'));
    fireEvent.keyDown(screen.getByTestId('ask-pop-input'), { key: 'Escape' });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('board'));
  });
});

describe('inert without a host', () => {
  it('offers nothing when disabled', () => {
    function Off() {
      const ref = useRef<HTMLDivElement | null>(null);
      const ask = useAskInPlace({
        enabled: false,
        containerRef: ref,
        surface: 'whiteboard',
        selection: ['r1'],
        idAt: (el) => el.closest('[data-item-id]')?.getAttribute('data-item-id') ?? null,
        resolve: () => buildReference('whiteboard', [{ id: 'r1', kind: 'rect', label: 'R1' }]),
        rectOf: () => ({ left: 0, top: 0, width: 10, height: 10 }),
        elementsOf: () => [],
        onSend: () => undefined,
      });
      return (
        <div ref={ref} data-testid="off">
          <g data-item-id="r1" data-testid="off-item" />
          {ask.layer}
        </div>
      );
    }
    render(<Off />);
    fireEvent.pointerMove(screen.getByTestId('off-item'));
    const notPrevented = fireEvent.contextMenu(screen.getByTestId('off-item'));
    fireEvent.keyDown(screen.getByTestId('off'), { key: '/' });
    expect(notPrevented).toBe(true);
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
    expect(screen.queryByTestId('ask-menu')).toBeNull();
    expect(screen.queryByTestId('ask-pop')).toBeNull();
  });
});

describe('the hover button steps aside for a context menu', () => {
  it('goes when the board owns the menu (an architecture node)', () => {
    render(<Harness selection={['r1']} ownsContextMenu={() => false} onSend={() => undefined} />);
    hoverOver('r1');
    expect(screen.getByTestId('ask-affordance')).toBeTruthy();
    fireEvent.contextMenu(screen.getByTestId('item-r1').querySelector('rect')!);
    expect(screen.queryByTestId('ask-affordance')).toBeNull();
  });
});

describe('typing surfaces keep the key', () => {
  it('a plaintext-only contenteditable is a field too', () => {
    render(<Harness selection={['r1']} onSend={() => undefined} />);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'plaintext-only');
    screen.getByTestId('board').append(div);
    fireEvent.keyDown(div, { key: '/' });
    expect(screen.queryByTestId('ask-pop')).toBeNull();
  });
});
