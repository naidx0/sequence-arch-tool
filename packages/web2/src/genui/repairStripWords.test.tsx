/**
 * The repair strip speaks plainly: no "fallback", no "fixer". A change the surface needed a stand-in for is "simplified".
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { GenUISurface } from './GenUISurface';
import type { SurfaceView } from './session';

afterEach(cleanup);

const view = (fixes: SurfaceView['fixes']): SurfaceView => ({
  id: 's',
  spec: { root: 'c', elements: { c: { type: 'Card', props: { title: 'Build' }, children: [] } }, state: {}, actions: {}, meta: {} },
  renderable: new Set(['c']),
  issues: [],
  fixes,
  phase: 'settled',
  repairing: new Set(),
  rounds: 0,
  pendingAction: null,
  refused: null,
});

const FIXES: SurfaceView['fixes'] = [
  { lossy: false, by: 'fixer', message: 'moved title into props', at: 1 },
  { lossy: false, by: 'agent', message: 'replaced Sparkline with Metric', at: 2 },
  { lossy: true, by: 'fixer', message: '"x" could not be fixed; shown as text', at: 3 },
];

describe('the repair strip', () => {
  it('names each kind of repair in plain words, closed and open, with no middle dot', () => {
    const { container } = render(<GenUISurface view={view(FIXES)} busy={false} onClick={() => {}} />);
    const strip = container.querySelector('.gu-repair')!;
    expect(strip.textContent).toContain('1 auto fixed');
    expect(strip.textContent).toContain('1 fixed by agent');
    expect(strip.textContent).toContain('1 simplified');
    fireEvent.click(strip.querySelector('button')!);
    const tags = [...strip.querySelectorAll('.gu-repair-by')].map((n) => n.textContent);
    expect(tags).toEqual(['auto fixed', 'fixed by agent', 'simplified']);
    expect(strip.textContent).not.toMatch(/fallback|fixer/i);
    expect(strip.textContent).not.toContain('\u00b7');
  });
});
