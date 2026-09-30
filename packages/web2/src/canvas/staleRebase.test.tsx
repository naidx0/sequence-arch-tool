import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { CanvasProvider } from './canvasChannel';
import { ConnectedBoard } from './ConnectedBoard';
import { DocProvider, useDoc } from './docChannel';
import { EMPTY_DOC_SESSION, docSessionReduce, type DocSession, type DocSessionAction } from './docSession';
import { StoreProvider, createStore } from '../state';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * THE WAY OUT OF A HELD RESCAN
 *
 * `docSession` HOLDS a rescan that arrives while there are unsaved edits
 * rather than silently applying it, and its own comment argues why: offering a
 * rebase onto a scan that is already two behind is worse than holding.
 *
 * That is correct, and it left the reader stuck. `baseChanged` was rendered by
 * NOTHING, and `doc/rebase` — the arm that takes the new scan — was dispatched
 * by nothing. The held state was reachable; the exit from it was not, so the
 * board silently stopped being current and never said so.
 * ══════════════════════════════════════════════════════════════════════════
 */

const doc = (graphId: string, label: string) =>
  ({
    version: 1 as const,
    kind: 'service-sequence' as const,
    title: 't',
    grounded: { graphId, origin: 'scan' as const },
    nodes: [{ id: 'svc:a', label, kind: 'service' as const }],
    edges: [],
  }) as never;

/** A session holding a rescan: a base, an edit, then a different scan. */
function held() {
  let s = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1', 'first') });
  s = docSessionReduce(s, { type: 'doc/rename-node', id: 'svc:a', label: 'renamed' });
  /* THE SAME graphId, and that is the branch under test: `doc/base` adopts
     outright when the graph id DIFFERS, because that is a different repository
     rather than a rescan of this one. A rescan keeps the id and changes the
     contents, and that is what gets held. */
  s = docSessionReduce(s, { type: 'doc/base', doc: doc('g1', 'second') });
  return s;
}

describe('the state a reader could not leave', () => {
  it('a rescan under an unsaved edit IS held, and the session raises it', () => {
    const s = held();
    expect(s.baseChanged).toBe(true);
    expect(s.pendingBase).not.toBeNull();
    /* The drawing survives — that is the whole point of holding. */
    expect(s.doc?.nodes[0]?.label).toBe('renamed');
    expect(s.edits).toBe(1);
  });

  it('REBASE TAKES THE NEW SCAN, and the hold is over', () => {
    const s = docSessionReduce(held(), { type: 'doc/rebase' });
    expect(s.baseChanged).toBe(false);
    expect(s.pendingBase).toBeNull();
    expect(s.baseGraphId).toBe('g1');
    /* And the unsaved edit is gone, because that is what taking a new scan
       means. The strip says so before the reader presses it. */
    expect(s.doc?.nodes[0]?.label).toBe('second');
    expect(s.edits).toBe(0);
  });

  it('rebase with nothing held changes nothing', () => {
    /* Total, so a stray dispatch is not a way to lose a drawing. */
    const base = docSessionReduce(EMPTY_DOC_SESSION, { type: 'doc/base', doc: doc('g1', 'first') });
    expect(docSessionReduce(base, { type: 'doc/rebase' })).toBe(base);
  });
});

describe('and the board offers it', () => {
  type Channel = { session: DocSession; dispatch: (action: DocSessionAction) => void };

  function Probe({ onReady }: { onReady: (channel: Channel) => void }) {
    onReady(useDoc());
    return null;
  }

  async function settleLayout() {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }

  async function mountHeld() {
    let channel: Channel | null = null;
    render(
      <StoreProvider store={createStore()}>
        <CanvasProvider>
          <DocProvider>
            <Probe onReady={(next) => (channel = next)} />
            <ConnectedBoard />
          </DocProvider>
        </CanvasProvider>
      </StoreProvider>,
    );
    const dispatch = channel!.dispatch;
    act(() => {
      dispatch({ type: 'doc/base', doc: doc('g1', 'first') });
      dispatch({ type: 'doc/rename-node', id: 'svc:a', label: 'renamed' });
      dispatch({ type: 'doc/base', doc: doc('g1', 'second') });
    });
    await settleLayout();
    return () => channel!;
  }

  it('renders a strip when the session is holding a rescan', async () => {
    await mountHeld();
    expect(screen.getByTestId('board-stale')).toBeTruthy();
  });

  it('dispatches the rebase from it', async () => {
    const channel = await mountHeld();
    fireEvent.click(screen.getByTestId('board-stale-rebase'));
    await settleLayout();

    expect(screen.queryByTestId('board-stale')).toBeNull();
    expect(channel().session.baseChanged).toBe(false);
    expect(channel().session.pendingBase).toBeNull();
    expect(channel().session.doc?.nodes[0]?.label).toBe('second');
  });

  it('SAYS WHAT TAKING IT COSTS, in edits', async () => {
    /* "Take the new scan" with no mention that it replaces unsaved work is a
       button that destroys a drawing and reads as a refresh. */
    await mountHeld();
    expect(screen.getByTestId('board-stale').textContent).toMatch(/replaces 1 unsaved edit/i);
  });
});
