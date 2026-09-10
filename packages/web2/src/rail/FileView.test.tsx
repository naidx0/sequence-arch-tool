import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileView } from './FileView';
import '../tokens/graphite.css';
import './rail.css';

/**
 * READING A FILE.
 *
 * The rail listed every file in the repository and clicking one grounded the
 * composer on it. There was no way to READ it — a product whose whole claim is
 * "every edge cites a file and a line" could show the citation and not the
 * line, and the reader had to leave for their editor.
 */

function serving(body: string, ok = true) {
  return vi.fn(async () =>
    new Response(body, { status: ok ? 200 : 404 }),
  ) as unknown as typeof fetch;
}

describe('reading a file', () => {
  it('shows the source with a line number on every line', async () => {
    render(
      <FileView path="src/a.ts" onClose={vi.fn()} fetchImpl={serving('const a = 1;\nconst b = 2;')} />,
    );
    await waitFor(() => expect(screen.getByTestId('file-view-body')).toBeTruthy());

    const lines = screen.getAllByTestId('file-view-line');
    expect(lines).toHaveLength(2);
    /* THE GUTTER IS THE POINT: evidence here is file:line, and a viewer
       without numbers makes the reader count. */
    expect(lines[0]!.textContent).toMatch(/^1/);
    expect(lines[1]!.textContent).toMatch(/^2/);
  });

  it('MARKS THE CITED LINE', async () => {
    render(
      <FileView path="src/a.ts" line={2} onClose={vi.fn()} fetchImpl={serving('one\ntwo\nthree')} />,
    );
    await waitFor(() => expect(screen.getByTestId('file-view-body')).toBeTruthy());

    const marked = screen.getAllByTestId('file-view-line').filter(
      (el) => el.getAttribute('data-cited') === 'true',
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]!.textContent).toContain('two');
  });

  it('asks for the path it was given, and encodes it', async () => {
    const fetchImpl = serving('x');
    render(<FileView path="src/a b.ts" onClose={vi.fn()} fetchImpl={fetchImpl} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(String((fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls[0]![0])).toContain(
      'path=src%2Fa%20b.ts',
    );
  });

  it('SHOWS THE SERVER’S OWN SENTENCE when it cannot read', async () => {
    /*
     * Too large, outside the repo, unreadable — each is a different fix, and
     * the reader can only act on the difference. Rewriting it hides the one
     * line that says what to do.
     */
    render(<FileView path="secret" onClose={vi.fn()} fetchImpl={serving('outside the repository', false)} />);
    await waitFor(() => expect(screen.getByTestId('file-view-failed')).toBeTruthy());
    expect(screen.getByTestId('file-view-failed').textContent).toBe('outside the repository');
  });

  it('renders nothing at all with no path open', () => {
    render(<FileView path={null} onClose={vi.fn()} fetchImpl={serving('x')} />);
    expect(screen.queryByTestId('file-view')).toBeNull();
  });

  it('handles CRLF, which core.autocrlf checks files out with', async () => {
    render(<FileView path="a.ts" onClose={vi.fn()} fetchImpl={serving('one\r\ntwo')} />);
    await waitFor(() => expect(screen.getByTestId('file-view-body')).toBeTruthy());
    /* Two lines, not one line containing a stray carriage return. */
    expect(screen.getAllByTestId('file-view-line')).toHaveLength(2);
  });
});
