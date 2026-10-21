import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EFFORT_ROWS, effortLabelOf } from '../chat/composerModel';
import { StoreProvider, createStore } from '../state';
import { ModelMenu, effortLabelOf as menuEffortLabelOf } from './ModelMenu';
import { ReasoningTrack } from './ReasoningTrack';
import type { EffortStop } from './EffortSlider';

/* Composer round (0.1.8.4), item 4: each defect found in the effort slider has a test here. */

afterEach(cleanup);

const css = readFileSync(resolve(process.cwd(), 'src/shell2/modelMenu.css'), 'utf8').replace(/\r\n/g, '\n');
const rule = (sel: string): string => {
  const at = css.indexOf(`
${sel} {`);
  if (at < 0) return '';
  /* comments out, so a rule's own notes do not hide its declarations */
  return css
    .slice(css.indexOf('{', at) + 1, css.indexOf('}', at))
    .split('*/')
    .map((p) => (p.includes('/*') ? p.slice(0, p.indexOf('/*')) : p))
    .join('');

};
const px = (decl: string, prop: string): number => {
  const m = decl.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${prop}:`));
  return m ? parseFloat(m.slice(prop.length + 1)) : 0;
};

function stops(on: number, pick: (i: number) => void = () => {}): EffortStop[] {
  return ['low', 'medium', 'high'].map((k, i) => ({ key: k, label: effortLabelOf(k), title: `${effortLabelOf(k)} reasoning`, on: i === on, pick: () => pick(i) }));
}

describe('D1: every stop is a target of at least 24px', () => {
  it('the dot button is 24px or more each way', () => {
    const r = rule('.s2-rt-dot');
    expect(px(r, 'width')).toBeGreaterThanOrEqual(24);
    expect(px(r, 'height')).toBeGreaterThanOrEqual(24);
  });
  it('the drawn dot inside it stays small', () => {
    const r = rule('.s2-rt-dot::before');
    expect(px(r, 'inset')).toBeGreaterThanOrEqual(8);
  });
});

describe('D2: the slider does not claim a level when none is chosen', () => {
  it('reads Not set, not the first stop', () => {
    render(<ReasoningTrack stops={stops(-1)} testidFor={(s) => `e-${s.key}`} />);
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('Not set');
  });
  it('still reads the chosen level when there is one', () => {
    render(<ReasoningTrack stops={stops(1)} testidFor={(s) => `e-${s.key}`} />);
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).toBe('Medium');
  });
});

describe('D3: the keyboard reaches the first stop from an unset slider', () => {
  it('ArrowRight picks the first stop, not the second', () => {
    const picked: number[] = [];
    render(<ReasoningTrack stops={stops(-1, (i) => picked.push(i))} testidFor={(s) => `e-${s.key}`} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    expect(picked).toEqual([0]);
  });
  it('from a chosen stop the arrows still step by one', () => {
    const picked: number[] = [];
    render(<ReasoningTrack stops={stops(1, (i) => picked.push(i))} testidFor={(s) => `e-${s.key}`} />);
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' });
    expect(picked).toEqual([2, 0, 2]);
  });
});

describe('D4: the recommended stop is named, and the caption points at its dot', () => {
  it('the recommended dot says so in its name and title; the others do not', () => {
    render(<ReasoningTrack stops={stops(0)} recommended="medium" testidFor={(s) => `e-${s.key}`} />);
    expect(screen.getByTestId('e-medium').getAttribute('aria-label')).toBe('Medium, recommended');
    expect(screen.getByTestId('e-medium').getAttribute('title')).toMatch(/recommended/i);
    expect(screen.getByTestId('e-low').getAttribute('aria-label')).toBe('Low');
  });
  it('the caption has a pointer mark drawn from its own box', () => {
    expect(rule('.s2-rt-rec::before')).toMatch(/left:\s*calc\(var\(--rt-x\)/);
  });
});

describe('D5: one source for the effort labels', () => {
  it('the composer rows take their labels from effortLabelOf, so Medium is never "Med"', () => {
    for (const row of EFFORT_ROWS) expect(row.label).toBe(effortLabelOf(row.key));
    expect(EFFORT_ROWS.map((r) => r.label)).toEqual(['Off', 'Low', 'Medium', 'High']);
    expect(menuEffortLabelOf).toBe(effortLabelOf);
  });
  it('the pill reads the same label the slider does, whatever label the caller passed', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    render(
      <StoreProvider store={createStore({})}>
        <ModelMenu
          wrapRef={createRef<HTMLDivElement>()}
          open={false}
          onTrigger={() => {}}
          onClose={() => {}}
          sessionId="s"
          agentRun={undefined}
          profiles={[]}
          pickModel={() => {}}
          modelErr={null}
          effort="medium"
          effortRows={EFFORT_ROWS}
          pickEffort={() => {}}
          modelChip="GPT"
          modelChipShort="GPT"
          modelChipTitle="GPT"
          effortLabel="Med"
          modes={[]}
          currentMode="plan"
          onMode={() => {}}
        />
      </StoreProvider>,
    );
    const pill = screen.getByTestId('v3-model-trigger');
    expect(pill.getAttribute('title')).toContain('Medium reasoning');
    expect(pill.getAttribute('title')).not.toContain('Med reasoning');
    vi.unstubAllGlobals();
  });
});

describe('D6: the help mark beside Effort can be reached from the keyboard', () => {
  it('is a tab stop in the source and has a visible focus ring', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/shell2/ModelMenu.tsx'), 'utf8');
    const help = src.slice(src.indexOf('data-testid="s2-effort-help"') - 200, src.indexOf('data-testid="s2-effort-help"') + 400);
    expect(help).toMatch(/tabIndex=\{0\}/);
    expect(rule('.s2-effort-help:focus-visible')).toMatch(/outline|box-shadow/);
  });
});
