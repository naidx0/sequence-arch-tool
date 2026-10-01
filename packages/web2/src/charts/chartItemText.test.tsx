import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fitText } from './chartLayout';
import { SeqChartView } from './SeqChartView';

/*
 * The chart saved on 2026-09-22 carried `detail: { whatItDoes }` on every item
 * and drew as "this chart could not be rendered: … e.slice is not a function"
 * — an empty frame on the canvas. The server now repairs it; a chart already
 * on disk must still draw.
 */
const SAVED = {
  version: 1,
  kind: 'system-architecture',
  title: 'Sequence architecture plan',
  items: [
    { id: 'svc:schema', label: 'Schema', detail: { whatItDoes: 'Graph/domain/program types' } },
    { id: 'svc:web2', label: 'Web2', detail: { whatItDoes: 'The UI' } },
  ],
  links: [{ from: 'svc:web2', to: 'svc:schema', label: 'import' }],
};

describe('a chart whose item text is not a string', () => {
  it('fitText takes the sentence out of a `{ whatItDoes }` object', () => {
    expect(fitText({ whatItDoes: 'The UI' } as never, 400)).toBe('The UI');
  });

  it('the saved chart draws instead of failing', () => {
    render(<SeqChartView chart={SAVED as never} />);
    expect(screen.queryByTestId('seqchart-fail')).toBeNull();
    expect(screen.getByTestId('seqchart')).toBeTruthy();
  });
});
