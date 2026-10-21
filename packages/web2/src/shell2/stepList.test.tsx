import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StepList } from './StepList';
import { afterEach, beforeEach } from 'vitest';
import { resetToolDetailForTest, writeToolDetail } from '../settings/toolDetailPreference';

/* The Opus walk of 2026-10-15: after the edit was made the tool row still said "Calling edit_file". */
/* Per-row wording is what Detailed mode shows (Focused folds two calls into one summary row: toolDetailMode.test.tsx). */
describe('the step list names a call by whether it is still going', () => {
  beforeEach(() => writeToolDetail('detailed'));
  afterEach(() => resetToolDetailForTest());

  it('the running call says what it is doing; the finished one says what it did', () => {
    const tools = [
      { id: 'a', name: 'read_file', text: '12 lines' },
      { id: 'b', name: 'edit_file', text: 'README.md' },
    ];
    const { rerender } = render(<StepList tools={tools} running />);
    const rows = () => screen.getAllByTestId('s2-step').map((r) => r.textContent ?? '');
    expect(rows()[0]).toContain('Explored files');
    expect(rows()[1]).toContain('Editing a file');
    rerender(<StepList tools={tools} />);
    expect(rows()[1]).toContain('Edited a file');
    expect(rows().join(' ')).not.toMatch(/Calling/);
  });

  it('a refused call says it was refused', () => {
    render(<StepList tools={[{ id: 'c', name: 'edit_file', text: 'refused: edit_file - Plan mode' }]} />);
    expect(screen.getByTestId('s2-step').textContent).toContain('Refused edit_file');
  });
});
