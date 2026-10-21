import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AttachDialog } from './AttachDialog';
import type { BootTransport } from './bootClient';

/* APP-15: the dialog must not claim that nothing is written; Sequence keeps a .sequence folder inside the project. */
function transport(): BootTransport {
  return {
    status: vi.fn(),
    archGraph: vi.fn(async () => ({ outcome: 'error' as const, status: 500, body: null })),
    recent: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { recent: [] } })),
    browse: vi.fn(async () => ({ outcome: 'ok' as const, status: 200, body: { root: '/home/box', path: '/home/box', parent: null, entries: [] } })),
    attach: vi.fn(),
    detach: vi.fn(),
  } as unknown as BootTransport;
}

describe('the Open a project subtitle tells the truth about what is written (APP-15)', () => {
  it('names the .sequence folder and says source files are not changed, and never says "Nothing is written"', () => {
    render(<AttachDialog transport={transport()} onAttached={() => {}} />);
    const dialog = screen.getByTestId('attach');
    expect(dialog.textContent).toContain('Sequence reads your code and keeps its map in a .sequence folder inside the project. Your source files are not changed.');
    expect(dialog.textContent).not.toMatch(/nothing is written/i);
  });
});
