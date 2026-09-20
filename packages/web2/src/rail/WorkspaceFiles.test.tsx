import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WorkspaceFiles } from './WorkspaceFiles';
import type { WorkspaceView } from '../state/types';

/*
 * "THEN WE KNOW WHERE IT'S WRITING FILES, ITS CACHE, ALL OF THAT."
 *                                                 — the owner, 2026-09-13
 *
 * The rail's answer for a chat with no repository was one sentence about
 * opening a repository. True, and not an answer to the question.
 */

const LISTED: WorkspaceView = {
  root: 'C:/Users/max/.sequence/workspace',
  exists: true,
  entries: [
    { path: 'notes.md', kind: 'file', bytes: 812 },
    { path: 'drafts', kind: 'dir' },
    { path: 'drafts/one.txt', kind: 'file', bytes: 2048 },
  ],
  omitted: 0,
};

describe('the rail with no repository open', () => {
  it('NAMES THE PATH — the literal answer to "where does it write"', () => {
    render(<WorkspaceFiles workspace={LISTED} />);
    expect(screen.getByTestId('rail-workspace-root').textContent).toBe(
      'C:/Users/max/.sequence/workspace',
    );
  });

  it('lists the files, with sizes a person reads', () => {
    render(<WorkspaceFiles workspace={LISTED} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2); // files only — a directory is not a file
    expect(rows[0]!.textContent).toContain('notes.md');
    expect(rows[0]!.textContent).toContain('812 B');
    expect(rows[1]!.textContent).toContain('2 KB');
  });

  it('an EMPTY workspace says what will land there, and still names it', () => {
    render(<WorkspaceFiles workspace={{ ...LISTED, exists: true, entries: [] }} />);
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy();
    expect(screen.getByTestId('rail-workspace-root')).toBeTruthy();
  });

  it('a workspace not yet CREATED says so — different from empty', () => {
    render(<WorkspaceFiles workspace={{ ...LISTED, exists: false, entries: [] }} />);
    expect(screen.getByText(/Not created yet/)).toBeTruthy();
  });

  it('NOT ASKED YET claims nothing about the folder', () => {
    // Absence of a signal must not render as evidence of absence — the second
    // law in docs/how-to-verify.md. A failed or pending listing shows the old
    // sentence and no workspace panel at all.
    render(<WorkspaceFiles workspace={null} />);
    expect(screen.queryByTestId('rail-workspace')).toBeNull();
    expect(screen.getByTestId('rail-empty')).toBeTruthy();
  });

  it('reports the overflow rather than hiding it', () => {
    render(<WorkspaceFiles workspace={{ ...LISTED, omitted: 7 }} />);
    expect(screen.getByText('+7 more not listed here')).toBeTruthy();
  });

  it('a workspace file is NEVER a rail row', () => {
    // Sheet 11.2: "Three rungs, and no fourth" — and all three are things the
    // SCAN found. Nothing here was scanned. Two lists in one column, never one.
    const { container } = render(<WorkspaceFiles workspace={LISTED} />);
    expect(container.querySelectorAll('.rail-row')).toHaveLength(0);
    expect(container.querySelectorAll('[data-testid="rail-row"]')).toHaveLength(0);
  });
});
