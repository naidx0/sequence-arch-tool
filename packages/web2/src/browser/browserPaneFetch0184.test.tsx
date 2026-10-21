import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserPane } from './BrowserPane';

afterEach(() => vi.unstubAllGlobals());
describe('the parked BrowserPane fetch contract', () => {
  it('posts the entered URL and renders only the measured response', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, url: 'https://example.com/final', status: 200, title: 'Measured page', text: 'Measured response body' })));
    vi.stubGlobal('fetch', f);
    render(<BrowserPane />);
    fireEvent.change(screen.getByTestId('browser-pane-url'), { target: { value: 'https://example.com/requested' } });
    fireEvent.click(screen.getByTestId('browser-pane-fetch'));
    await waitFor(() => expect(screen.getByTestId('browser-pane-body').textContent).toBe('Measured response body'));
    expect(f).toHaveBeenCalledWith('/api/net-fetch', expect.objectContaining({ method: 'POST', body: JSON.stringify({ url: 'https://example.com/requested' }) }));
    expect(screen.getByTestId('browser-pane-status').textContent).toBe('https://example.com/final, HTTP 200, title: Measured page');
  });
  it('a refused fetch reports the refusal without a fabricated page body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'URL is outside the policy allowlist' }), { status: 403 })));
    render(<BrowserPane />);
    fireEvent.click(screen.getByTestId('browser-pane-fetch'));
    await waitFor(() => expect(screen.getByTestId('browser-pane-status').textContent).toBe('URL is outside the policy allowlist'));
    expect(screen.getByTestId('browser-pane-body').textContent).toBe('');
  });
});
