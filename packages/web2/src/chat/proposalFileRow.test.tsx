import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore, StoreProvider } from '../state';
import type { FileEditProposal } from '../state/types';
import { ApprovalCard } from '../v3/V3Chat';
import { proposalOutcome } from './ProposalFileRow';

/* The Opus walk of 2026-10-15, edit card: "Clicking the file name does nothing, there is no diff, the copy reads
   'Decision recorded, applied'". */

const proposal = (over: Partial<FileEditProposal> = {}): FileEditProposal =>
  ({
    id: 'p1',
    turnId: 't1',
    title: 'Fix the readme',
    rationale: null,
    files: [{ path: 'README.md', content: 'x', decision: 'accepted', diff: null, comments: [] }],
    status: 'applied',
    verify: null,
    ...over,
  }) as FileEditProposal;

const DIFF = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old line\n+new line\n';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => (String(url).startsWith('/api/git/diff') ? new Response(JSON.stringify({ path: 'README.md', diff: DIFF }), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 404 }))),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('an edit card says what happened and lets the reader see it', () => {
  it('the copy names the file, not "Decision recorded"', () => {
    expect(proposalOutcome(proposal())).toBe('Edited README.md');
    expect(proposalOutcome(proposal({ files: [proposal().files[0]!, { ...proposal().files[0]!, path: 'src/a.ts' }] }))).toBe('Edited 2 files');
    expect(proposalOutcome(proposal({ status: 'denied' }))).toBe('Rejected the edit to README.md');
    render(<ApprovalCard proposal={proposal()} onDecideAll={() => {}} />);
    fireEvent.click(screen.getByTestId('v3-approve-fold'));
    expect(screen.getByTestId('v3-approve-settled').textContent).toBe('Edited README.md');
    expect(document.body.textContent).not.toContain('Decision recorded');
  });

  it('the file name opens the file in Files', () => {
    const store = createStore({});
    render(
      <StoreProvider store={store}>
        <ApprovalCard proposal={proposal()} onDecideAll={() => {}} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId('v3-approve-fold'));
    fireEvent.click(screen.getByTestId('v3-approve-open'));
    expect(store.getState().session.filesFocus?.path).toBe('README.md');
  });

  it('an applied edit offers its diff in place', async () => {
    render(<ApprovalCard proposal={proposal()} onDecideAll={() => {}} />);
    fireEvent.click(screen.getByTestId('v3-approve-fold'));
    expect(screen.queryByTestId('v3-approve-diff')).toBeNull();
    fireEvent.click(screen.getByTestId('v3-approve-diff-toggle'));
    await waitFor(() => expect(screen.getByTestId('v3-approve-diff').textContent).toContain('new line'), { timeout: 5000 });
    expect(screen.getByTestId('v3-approve-diff').textContent).toContain('old line');
  });

  it('a proposal still waiting offers no diff it does not have', () => {
    render(<ApprovalCard proposal={proposal({ status: 'pending', files: [{ ...proposal().files[0]!, decision: 'pending' }] })} onDecideAll={() => {}} />);
    expect(screen.queryByTestId('v3-approve-diff-toggle')).toBeNull();
  });
});
