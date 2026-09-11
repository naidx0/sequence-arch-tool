import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { activeStoryBlockId, CanvasStoryNav } from './CanvasStoryNav';
import type { CanvasDoc } from '../state/types';

describe('CanvasStoryNav', () => {
  const route = {
    title: 'Deploy story',
    steps: [
      { blockId: 'b1', caption: 'Overview' },
      { blockId: 'b2', caption: 'Detail' },
    ],
  };

  it('renders steps and calls onStep', () => {
    const onStep = vi.fn();
    render(<CanvasStoryNav route={route} activeIndex={0} onStep={onStep} />);
    expect(screen.getByText('Deploy story')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ai-canvas-story-step-1'));
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it('activeStoryBlockId resolves current step block', () => {
    const doc: CanvasDoc = { blocks: [], storyRoute: route };
    expect(activeStoryBlockId(doc, 1)).toBe('b2');
    expect(activeStoryBlockId(doc, 99)).toBeNull();
  });
});
