import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContextRing, contextLevel, contextPercent } from './ContextRing';

describe('ContextRing, round 9 redesign: percent, meter, warning only near the limit', () => {
  it('level is ok below 80%, warn from 80%, full from 95%', () => {
    expect(contextLevel(0.5)).toBe('ok');
    expect(contextLevel(0.79)).toBe('ok');
    expect(contextLevel(0.8)).toBe('warn');
    expect(contextLevel(0.95)).toBe('full');
    expect(contextPercent(27_640, 131_100)).toBe('21%');
    expect(contextPercent(10, 131_100)).toBe('<1%');
    expect(contextPercent(0, 131_100)).toBe('0%');
  });

  it('the panel shows percent, used / total, a meter and what is left; no warning at 21%', () => {
    render(<ContextRing used={27_640} window={131_100} breakdown={null} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.getByTestId('composer-context-percent').textContent).toBe('21%');
    expect(screen.getByTestId('composer-context-label').textContent).toBe('27.6k / 131.1k');
    const meter = screen.getByTestId('composer-context-meter');
    expect(meter.getAttribute('data-level')).toBe('ok');
    expect(meter.getAttribute('aria-valuenow')).toBe('27640');
    expect(screen.getByTestId('composer-context-left').textContent).toBe('103.5k left');
    expect(screen.getByTestId('composer-context').getAttribute('data-level')).toBe('ok');
  });

  it('turns warning near the limit and says so when full', () => {
    const { rerender } = render(<ContextRing used={110_000} window={131_100} breakdown={null} />);
    expect(screen.getByTestId('composer-context').getAttribute('data-level')).toBe('warn');
    rerender(<ContextRing used={130_000} window={131_100} breakdown={null} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.getByTestId('composer-context-meter').getAttribute('data-level')).toBe('full');
    expect(screen.getByTestId('composer-context-left').textContent).toMatch(/full/i);
  });

  it('unmetered: an em dash for the percent, no "left" line', () => {
    render(<ContextRing used={null} window={131_100} breakdown={null} />);
    fireEvent.click(screen.getByTestId('composer-context'));
    expect(screen.getByTestId('composer-context-percent').textContent).toBe('—');
    expect(screen.queryByTestId('composer-context-left')).toBeNull();
  });
});
