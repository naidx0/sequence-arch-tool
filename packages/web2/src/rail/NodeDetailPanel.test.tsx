import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { NodeDetailView } from '../state/types';
import { NodeDetailPanel } from './NodeDetailPanel';

/* ══════════════════════════════════════════════════════════════════════════
   THE DETAIL PANEL'S ANNOTATIONS — Wave 2, Decision 6.
   /api/annotate's per-node English renders here as well as on the card.
   Grounded only: the section exists when the endpoint returned bullets for
   THIS node and is absent otherwise — calm absence, no error chrome.
   ══════════════════════════════════════════════════════════════════════════ */

const view = {
  node: { id: 'svc:analyzer', kind: 'service', label: 'analyzer' },
  detail: null,
  files: [],
  edges: [],
} as unknown as NodeDetailView;

function draw(annotations?: readonly string[] | null) {
  return render(
    <NodeDetailPanel
      view={view}
      annotations={annotations}
      onOpenScope={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('NodeDetailPanel — per-node annotation', () => {
  it('renders the endpoint’s English under its own label', () => {
    const drawn = draw([
      'Reads a repository and produces a graph of its services.',
      'Second bullet.',
    ]);
    expect(screen.getAllByTestId('rail-detail-note')).toHaveLength(2);
    expect(screen.getByText('Reads a repository and produces a graph of its services.')).toBeTruthy();
    drawn.unmount();
  });

  it('renders nothing — calmly — when the endpoint returned nothing for this node', () => {
    const drawn = draw(null);
    expect(screen.queryByTestId('rail-detail-note')).toBeNull();
    // The panel itself still stands; absence is not an error state.
    expect(screen.getByTestId('rail-detail')).toBeTruthy();
    drawn.unmount();
  });

  it('keys duplicate lines apart — finding F7', () => {
    /*
     * The endpoint can legitimately return the same sentence twice. Keying a
     * bullet by its line string collides on duplicates, and React announces
     * exactly that: two children with the same key. The rows must still both
     * render, and React must have nothing to complain about.
     */
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((message: unknown) => {
      errors.push(String(message));
    });
    try {
      const drawn = draw(['Same sentence twice.', 'Same sentence twice.']);
      expect(screen.getAllByTestId('rail-detail-note')).toHaveLength(2);
      drawn.unmount();
    } finally {
      spy.mockRestore();
    }
    expect(
      errors.filter((message) => message.includes('same key')),
      'React reported duplicate bullet keys',
    ).toEqual([]);
  });
});
