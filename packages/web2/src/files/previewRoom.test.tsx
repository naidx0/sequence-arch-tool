import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FilesPanel, type FilesPanelProps } from './FilesPanel';

const props: FilesPanelProps = {
  paths: ['page.html'], selected: 'page.html', expanded: new Set(), query: '',
  view: 'preview', content: { state: 'ready', text: '<h1>Preview</h1>' }, diff: { state: 'idle' },
  onSelect: () => {}, onToggle: () => {}, onQuery: () => {}, onView: () => {},
};
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
function paneWidth(width: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, width, height: 600, left: 0, top: 0, right: width, bottom: 600, toJSON: () => ({}) });
}

it('focuses a preview in a narrow Files pane; the tree can be reopened without losing the file', () => {
  paneWidth(300);
  render(<FilesPanel {...props} />);
  expect(screen.getByTestId('files-panel').classList.contains('is-tree-shut')).toBe(true);
  fireEvent.click(screen.getByTestId('files-tree-toggle'));
  expect(screen.getByTestId('files-panel').classList.contains('is-tree-shut')).toBe(false);
  expect(screen.getByTestId('files-header-path').textContent).toBe('page.html');
  fireEvent.click(screen.getByTestId('files-tree-toggle'));
  expect(screen.getByTestId('files-panel').classList.contains('is-tree-shut')).toBe(true);
});
