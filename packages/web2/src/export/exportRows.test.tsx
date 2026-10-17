import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardControlsBody } from '../canvas/BoardControlsBody';
import type { BoardControlsProps } from '../canvas/BoardControls';

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const props = {
  query: '', onQuery: () => {}, matches: null, onFitMatches: () => {}, selectedLabel: null, pathStart: null, pathEnd: null,
  pathNote: null, onPathStart: () => {}, onPathEnd: () => {}, onPathClear: () => {}, focusLabel: null, proximity: 1,
  onFocusSelected: () => {}, onFocusClear: () => {}, onProximity: () => {}, direction: 'auto', onDirection: () => {},
  flat: false, onFlat: () => {}, onExport: () => {}, exportNote: null,
} as unknown as BoardControlsProps;

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('board menu file exports (I7)', () => {
  it('lists the three file formats beside Save as PNG', () => {
    render(<BoardControlsBody {...props} />);
    expect(screen.getByTestId('board-export-png')).toBeTruthy();
    expect(screen.getByText('Mermaid flowchart')).toBeTruthy();
    expect(screen.getByText('Dependency matrix (CSV)')).toBeTruthy();
    expect(screen.getByText('Architecture note (Markdown)')).toBeTruthy();
  });

  it('requests the clicked format and saves the filename the server gave', async () => {
    const asked: string[] = [];
    globalThis.fetch = (async (u: string) => {
      asked.push(u);
      return json({ format: 'matrix-csv', filename: 'shop-architecture.csv', mime: 'text/csv', content: 'a,b\n' });
    }) as unknown as typeof fetch;
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
    render(<BoardControlsBody {...props} />);
    fireEvent.click(screen.getByText('Dependency matrix (CSV)'));
    await waitFor(() => expect(names).toEqual(['shop-architecture.csv']));
    expect(asked).toEqual(['/api/export?format=matrix-csv']);
    expect(screen.getByTestId('board-export-file-note').textContent).toContain('shop-architecture.csv');
  });

  it('says to scan first on a 409 and what failed otherwise', async () => {
    globalThis.fetch = (async () => json({ error: 'no repo attached' }, 409)) as unknown as typeof fetch;
    render(<BoardControlsBody {...props} />);
    fireEvent.click(screen.getByText('Mermaid flowchart'));
    await waitFor(() => expect(screen.getByTestId('board-export-file-note').textContent).toBe('Scan the project first.'));
    globalThis.fetch = (async () => json({ error: 'boom' }, 500)) as unknown as typeof fetch;
    fireEvent.click(screen.getByText('Architecture note (Markdown)'));
    await waitFor(() => expect(screen.getByTestId('board-export-file-note').textContent).toBe('Not exported: boom'));
  });
});
