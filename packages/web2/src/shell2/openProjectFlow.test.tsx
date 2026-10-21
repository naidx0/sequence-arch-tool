import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AttachDialog } from '../boot/AttachDialog';
import { createBootTransport } from '../boot/bootClient';

afterEach(() => { vi.unstubAllGlobals(); });
it('names the Open a project flow and gives desktop users Open folder before the path browser', async () => {
  vi.stubGlobal('sequence', { openRepo: vi.fn(async () => null) });
  const net = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).startsWith('/api/recent') ? { recent: [] } : { root: '/test', path: '/test', parent: null, entries: [] })));
  render(<AttachDialog transport={createBootTransport(net)} onAttached={() => {}} />);
  expect(screen.getByRole('dialog', { name: 'Open a project' })).toBeTruthy();
  const native = screen.getByTestId('attach-native');
  expect(native.compareDocumentPosition(screen.getByTestId('attach-path')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it('keeps a refused typed path in the field and says why', async () => {
  const net = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).startsWith('/api/attach') ? { error: 'directory not found' } : String(input).startsWith('/api/recent') ? { recent: [] } : { root: '/test', path: '/test', parent: null, entries: [] }), { status: String(input).startsWith('/api/attach') ? 404 : 200 }));
  render(<AttachDialog transport={createBootTransport(net)} onAttached={() => {}} />);
  fireEvent.change(screen.getByTestId('attach-path'), { target: { value: '/test/missing' } });
  fireEvent.click(screen.getByTestId('attach-path-open'));
  const failure = await screen.findByTestId('attach-failure');
  expect(failure.textContent).not.toBe('');
  expect((screen.getByTestId('attach-path') as HTMLInputElement).value).toBe('/test/missing');
});
