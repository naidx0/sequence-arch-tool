import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KindLegend, LEGEND_NEEDS_PX } from './KindLegend';

/**
 * Owner: the kinds key is too big at first glance and Hide is not obvious.
 * Default shut; Show / Hide are always available.
 */

describe('the key collapses rather than covering the board', () => {
  it('starts shut so the board is not covered at first glance', () => {
    render(<KindLegend />);
    expect(screen.getByTestId('board-legend-shut')).toBeTruthy();
    expect(screen.queryByTestId('board-legend')).toBeNull();
    /* One icon (owner, 2026-09-22): the word, the count and the hint are in
       the accessible name, not on the strip. */
    const pill = screen.getByTestId('board-legend-shut');
    expect(pill.textContent?.trim()).toBe('');
    expect(pill.getAttribute('aria-label')).toMatch(/show kind key/i);
    expect(pill.getAttribute('aria-label')).toMatch(/6 kinds/);
  });

  it('opens as a popover on its anchor and closes on Escape or a press elsewhere', () => {
    render(<KindLegend present={['service', 'storage']} />);
    fireEvent.click(screen.getByTestId('board-legend-shut'));
    const key = screen.getByTestId('board-legend');
    const anchor = key.parentElement!;
    expect(anchor.classList.contains('kindlegend-anchor')).toBe(true);
    expect(anchor.getAttribute('data-kindlegend-open')).toBe('true');
    expect(screen.queryByTestId('board-legend-shut')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('board-legend')).toBeNull();
    expect(screen.getByTestId('board-legend-shut')).toBeTruthy();

    fireEvent.click(screen.getByTestId('board-legend-shut'));
    fireEvent.pointerDown(screen.getByTestId('board-legend-hint'));
    expect(screen.getByTestId('board-legend')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId('board-legend')).toBeNull();
  });

  it('opens on Show with Hide on its own header row', () => {
    render(<KindLegend present={['service', 'storage']} />);
    fireEvent.click(screen.getByTestId('board-legend-shut'));
    expect(screen.getByTestId('board-legend')).toBeTruthy();
    expect(screen.getByTestId('board-legend-hide')).toBeTruthy();
    expect(screen.getByTestId('board-legend-hint').textContent).toMatch(/same box, different icon/i);
    const kinds = screen.getAllByTestId('board-legend-kind');
    expect(kinds.map((k) => k.getAttribute('data-kind'))).toEqual(['service', 'storage']);
  });

  it('names the width it needs, with the reason attached', () => {
    expect(LEGEND_NEEDS_PX).toBeGreaterThanOrEqual(700 / 0.55);
  });

  it('draws module with the service swatch — no folder tab in the key', () => {
    render(<KindLegend present={['module']} />);
    fireEvent.click(screen.getByTestId('board-legend-shut'));
    const chip = screen.getByTestId('board-legend-kind');
    expect(chip.getAttribute('data-kind')).toBe('module');
    expect(chip.querySelector('.silswatch')?.classList.contains('n-service')).toBe(true);
    expect(chip.querySelector('.silswatch')?.classList.contains('n-module')).toBe(false);
  });
});
