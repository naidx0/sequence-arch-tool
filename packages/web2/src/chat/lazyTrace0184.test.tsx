import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LazyReasoningTrace } from './LazyReasoningTrace';

const loaded = vi.hoisted(() => vi.fn());
vi.mock('./ReasoningTraceView', () => {
  loaded();
  return { ReasoningTraceView: ({ chunks }: { chunks: string[] }) => <div data-testid="loaded-trace">{chunks.join('')}</div> };
});
afterEach(cleanup);
it('does not import a renderer for an empty stream, then renders the actual reasoning on arrival', async () => {
  const view = render(<LazyReasoningTrace chunks={[]} streaming />);
  expect(loaded).not.toHaveBeenCalled();
  view.rerender(<LazyReasoningTrace chunks={['  ', '']} streaming />);
  expect(loaded).not.toHaveBeenCalled();
  view.rerender(<LazyReasoningTrace chunks={['## Inspect\nActual reasoning']} streaming />);
  expect((await screen.findByTestId('loaded-trace')).textContent).toBe('## Inspect\nActual reasoning');
  expect(loaded).toHaveBeenCalledTimes(1);
});
