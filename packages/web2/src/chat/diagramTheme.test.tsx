import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const draws: string[] = [];
const resets = vi.fn();
vi.mock('../app/MermaidBlock', () => ({
  canDrawDiagrams: () => true,
  resetMermaidTheme: () => resets(),
  drawMermaid: async (source: string) => {
    draws.push(document.documentElement.getAttribute('data-theme') ?? 'none');
    const { mermaidNode } = await import('./svgSanitize');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text>${source.length}</text></svg>`;
    return { svg, node: mermaidNode(svg)!, normalised: false };
  },
}));

import { ProseMessage } from './ProseMessage';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('a mermaid drawing follows the theme', () => {
  it('re-renders when data-theme flips', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    render(<ProseMessage text={'```mermaid\ngraph TD\nA-->B\n```'} />);
    await screen.findByTestId('chat-diagram-art');
    expect(draws).toEqual(['dark']);
    await act(async () => {
      document.documentElement.setAttribute('data-theme', 'light');
    });
    await waitFor(() => expect(draws).toEqual(['dark', 'light']));
    expect(resets).toHaveBeenCalled();
    expect(screen.getByTestId('chat-diagram-art').querySelector('svg')).not.toBeNull();
  });
});
