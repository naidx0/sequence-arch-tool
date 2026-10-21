import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PanelErrorBoundary } from './PanelErrorBoundary';

afterEach(() => {
  live.throws = true;
  cleanup();
  vi.restoreAllMocks();
});

let mounts = 0;
/* Read at render time, so a remount (not a re-render of the parent) is what picks up a change. */
const live = { throws: true };
function Bomb({ armed }: { armed: boolean }) {
  mounts++;
  if (armed && live.throws) throw new Error('knob exploded');
  return <p data-testid="bomb-ok">fine</p>;
}

/** A tab body next to a sibling that lives OUTSIDE the boundary (the nav, the rest of the app). */
function Host({ armed }: { armed: { current: boolean } }) {
  const [clicks, setClicks] = useState(0);
  return (
    <div>
      <button type="button" data-testid="sibling" onClick={() => setClicks((n) => n + 1)}>
        sibling {clicks}
      </button>
      <PanelErrorBoundary>
        <Bomb armed={armed.current} />
      </PanelErrorBoundary>
    </div>
  );
}

describe('PanelErrorBoundary (APP-01)', () => {
  it('a child that throws shows the card, and the sibling UI still works', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<Host armed={{ current: true }} />);
    const card = screen.getByTestId('panel-error');
    expect(card.textContent).toContain('This panel hit a problem.');
    expect(card.textContent).toContain('Your settings are safe.');
    expect(screen.getByRole('button', { name: 'Reload panel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy details' })).toBeTruthy();
    fireEvent.click(screen.getByTestId('sibling'));
    expect(screen.getByTestId('sibling').textContent).toBe('sibling 1');
  });

  it('Reload panel remounts the children', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    live.throws = true;
    render(<Host armed={{ current: true }} />);
    expect(screen.queryByTestId('bomb-ok')).toBeNull();
    const before = mounts;
    live.throws = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reload panel' }));
    expect(screen.getByTestId('bomb-ok')).toBeTruthy();
    expect(screen.queryByTestId('panel-error')).toBeNull();
    expect(mounts).toBeGreaterThan(before);
  });

  it('Copy details puts the error text on the clipboard and never throws without a clipboard', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<Host armed={{ current: true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy details' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0]![0])).toContain('knob exploded');
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Copy details' }))).not.toThrow();
  });

  it('a new resetKey (another tab) clears the card by itself', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <PanelErrorBoundary resetKey="models">
        <Bomb armed />
      </PanelErrorBoundary>,
    );
    expect(screen.getByTestId('panel-error')).toBeTruthy();
    rerender(
      <PanelErrorBoundary resetKey="agents">
        <Bomb armed={false} />
      </PanelErrorBoundary>,
    );
    expect(screen.getByTestId('bomb-ok')).toBeTruthy();
  });
});
