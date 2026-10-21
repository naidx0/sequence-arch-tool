import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BoardDelivery } from './BoardDelivery';
import type { SpaceSnapshot } from '../../git/gitEvents';

const seam = vi.hoisted(() => ({ listener: null as null | ((snapshot: SpaceSnapshot) => void), open: vi.fn(), fetch: vi.fn() }));
vi.mock('../../state/connect', () => ({ useAppState: () => ({ session: { activeId: 'chat' } }), groundedRepoRoot: () => 'project' }));
vi.mock('../../git/gitEvents', () => ({ onSpaceSnapshot: (l: typeof seam.listener) => { seam.listener = l; return () => { seam.listener = null; }; } }));
vi.mock('../../app/hostCommands', () => ({ requestHostCommand: (...args: unknown[]) => seam.open(...args) }));
vi.mock('./ArtifactDelivery', () => ({ ArtifactDelivery: () => <div data-testid="new-artifact" /> }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); seam.open.mockClear(); });
const snapshot = (rev: number, artifact = 'old'): SpaceSnapshot => ({ project: 'project', index: { version: 1, boards: [{ id: 'board', kind: 'whiteboard', name: 'Board', rev, createdAt: '', updatedAt: '', chats: ['chat'], delivery: { chat: 'chat', rev } }] }, artifacts: [{ id: artifact, chat: 'chat', path: 'image.png' }] });
it('closed-pane delivery learns stream history without reads, then reveals a new board and artifact', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<BoardDelivery />);
  act(() => seam.listener!(snapshot(1)));
  expect(seam.open).not.toHaveBeenCalled();
  expect(screen.queryByTestId('new-artifact')).toBeNull();
  act(() => seam.listener!(snapshot(2, 'new')));
  await waitFor(() => expect(seam.open).toHaveBeenCalledWith('canvas.whiteboard'));
  await screen.findByTestId('new-artifact');
  expect(fetcher).not.toHaveBeenCalled();
});
it('another project snapshot cannot reveal its board or artifact', () => {
  render(<BoardDelivery />);
  act(() => seam.listener!(snapshot(1)));
  act(() => seam.listener!({ ...snapshot(2, 'foreign'), project: 'other-project' }));
  expect(seam.open).not.toHaveBeenCalled();
  expect(screen.queryByTestId('new-artifact')).toBeNull();
});
