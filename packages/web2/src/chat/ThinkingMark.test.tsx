import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReasoningGlyph } from './ThinkingMark';

describe('ReasoningGlyph', () => {
  it('renders nothing when inactive', () => {
    const { container } = render(<ReasoningGlyph active={false} />);
    expect(container.querySelector('[data-testid="chat-reasoning-glyph"]')).toBeNull();
  });

  it('draws a braille orbit glyph for the tool-row slot', () => {
    render(<ReasoningGlyph active />);
    const root = screen.getByTestId('chat-reasoning-glyph');
    expect(root.className).toContain('braille');
  });
});
