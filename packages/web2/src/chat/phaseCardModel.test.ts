import { describe, expect, it } from 'vitest';

import { workRow } from './fixtures';
import { activePhaseRow, phaseLiveLabel, phaseSurfaceCrumb } from './phaseCardModel';

describe('phaseCardModel', () => {
  it('prefers canvas work for the active phase row', () => {
    const rows = [
      workRow('w1', { status: 'running', from: 'file:read', verb: 'Read foo.ts' }),
      workRow('w2', {
        status: 'running',
        from: 'canvas:block',
        verb: 'canvas.write_mermaid',
        opens: 'ai-canvas',
      }),
    ];
    expect(activePhaseRow(rows)?.id).toBe('w2');
  });

  it('names surface crumbs and live labels', () => {
    const row = workRow('w1', {
      status: 'running',
      from: 'canvas:block',
      verb: 'canvas.write_markdown',
      opens: 'ai-canvas',
    });
    expect(phaseSurfaceCrumb(row)).toBe('sequence / AI Canvas');
    expect(phaseLiveLabel(row, 'deepseek').length).toBeGreaterThan(0);
  });

  it('prefers provider over bookkeeping step rows for the phase card', () => {
    const rows = [
      workRow('step:provider', {
        status: 'running',
        from: 'step:start',
        verb: 'Worked a step',
        identifier: 'provider',
      }),
      workRow('provider', {
        status: 'running',
        from: 'provider:start',
        verb: 'Reasoned',
        identifier: null,
      }),
    ];
    expect(activePhaseRow(rows)?.id).toBe('provider');
    expect(phaseLiveLabel(rows[1]!, 'deepseek/flash')).toBe('Reasoning with deepseek/flash');
    expect(phaseSurfaceCrumb(rows[1]!)).toBe('sequence / Chat');
  });
});
