import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtifactDelivery } from './ArtifactDelivery';
import type { BoardsIndex } from './boardsModel';

vi.mock('../../state/connect', () => ({ useAppState: () => ({ session: { activeId: 'chat' } }), groundedRepoRoot: () => 'project' }));
vi.mock('../../files/FilePreview', () => ({ default: () => <div>Decoded preview surface</div> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const index = (artifactDelivery: BoardsIndex['artifactDelivery']): BoardsIndex => ({ version: 1, boards: [], artifactDelivery });
it('uses shared metadata without a delivery GET, learns history, then reveals only a new matching chat delivery', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const view = render(<ArtifactDelivery index={index({ id: 'old', chat: 'chat', path: 'old.png' })} />);
  expect(screen.queryByTestId('space-artifact-preview')).toBeNull();
  view.rerender(<ArtifactDelivery index={index({ id: 'foreign', chat: 'other', path: 'other.png' })} />);
  expect(screen.queryByTestId('space-artifact-preview')).toBeNull();
  view.rerender(<ArtifactDelivery index={index({ id: 'new', chat: 'chat', path: 'visible.png' })} />);
  expect(await screen.findByText('Decoded preview surface')).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});
