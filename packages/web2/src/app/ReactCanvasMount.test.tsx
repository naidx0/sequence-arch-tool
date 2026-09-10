import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@babel/standalone', () => ({
  transform: vi.fn(() => ({
    code: `
      exports.default = function Preview() {
        return React.createElement('div', { 'data-testid': 'mounted-chart' }, 'Chart');
      };
    `,
  })),
}));

import { ReactCanvasMount } from './ReactCanvasMount';

describe('ReactCanvasMount', () => {
  it('mounts compiled React source when transform succeeds', async () => {
    render(<ReactCanvasMount source="export default function X(){ return (<div>Chart</div>); }" />);
    await waitFor(() => {
      expect(screen.getByTestId('ai-canvas-react-mount')).toBeTruthy();
      expect(screen.getByTestId('mounted-chart').textContent).toBe('Chart');
    });
    expect(screen.getByTestId('ai-canvas-react-src')).toBeTruthy();
  });
});
