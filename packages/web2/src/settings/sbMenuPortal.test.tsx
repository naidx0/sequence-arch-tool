import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuSelect } from './sbParts';

afterEach(() => cleanup());

const OPTS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

/* The listbox lives outside the select's row (a card with overflow:hidden clipped it); the real-layout lock is
   e2e/settings-dropdown.mjs. This keeps the structure and the behaviour the Settings overlay depends on. */
describe('MenuSelect listbox is a portal', () => {
  it('renders the listbox outside the select host, under the overlay scrim when there is one', () => {
    render(
      <div className="v3-overlay-scrim" data-testid="scrim">
        <div className="sb-card" style={{ overflow: 'hidden' }}>
          <MenuSelect value="a" options={OPTS} onChange={() => {}} testid="sel" ariaLabel="Pick" />
        </div>
      </div>,
    );
    fireEvent.click(screen.getByTestId('sel'));
    const menu = screen.getByTestId('sel-menu');
    expect(menu.matches('.sb-menu[role="listbox"]')).toBe(true);
    expect(menu.closest('.sb-card')).toBeNull();
    expect(menu.closest('.sb-select')).toBeNull();
    expect(menu.parentElement).toBe(screen.getByTestId('scrim'));
  });

  it('Escape closes only the menu (stopImmediatePropagation) and returns focus to the trigger', () => {
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    render(<MenuSelect value="a" options={OPTS} onChange={() => {}} testid="sel" ariaLabel="Pick" />);
    fireEvent.click(screen.getByTestId('sel'));
    expect(screen.queryByTestId('sel-menu')).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    window.removeEventListener('keydown', outer);
    expect(screen.queryByTestId('sel-menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('sel'));
  });

  it('picking an option reports it and closes the menu', () => {
    const onChange = vi.fn();
    render(<MenuSelect value="a" options={OPTS} onChange={onChange} testid="sel" ariaLabel="Pick" />);
    fireEvent.click(screen.getByTestId('sel'));
    fireEvent.click(screen.getAllByTestId('sel-option')[1]!);
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByTestId('sel-menu')).toBeNull();
  });

  it('the trigger carries the full value, because the control shows it cut', () => {
    /*
     * THE VALUE IS CUT. `.sb-select-v` is one line with an ellipsis, so a
     * chosen value longer than the control reads "Muse Spark Open, 1M co..." and
     * stops. The aria-label carries the full text to a screen reader; a reader
     * looking at the control had nothing at all.
     */
    const long = 'Muse Spark Open, 1M context, reasoning on';
    render(<MenuSelect value="c" options={[...OPTS, { value: 'c', label: long }]} onChange={() => {}} testid="sel" ariaLabel="Pick" />);
    const trigger = screen.getByTestId('sel');
    expect(trigger.getAttribute('title')).toBe(long);
    /* and it is the CHOSEN value, not the first option's */
    expect(trigger.getAttribute('title')).not.toBe('Alpha');
  });
});
