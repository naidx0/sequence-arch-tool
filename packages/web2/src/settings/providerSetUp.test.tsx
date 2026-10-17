import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import './settings.css';
import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

const GROQ = { id: 'groq', name: 'Groq', wire: 'openai-compatible', api: 'https://api.groq.com/openai/v1', env: ['GROQ_API_KEY'], doc: 'https://console.groq.com/docs', models: [{ id: 'llama-5', name: 'Llama 5' }] };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('Set up from Other providers puts the cursor in the API key field and offers "Get a Groq key"; the card sits under the lede', async () => {
  const f = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    const body = u.startsWith('/api/providers/catalog') ? { providers: [GROQ], detected: [] } : u.startsWith('/api/ai-config') ? { configured: false } : u.startsWith('/api/hooks') ? { events: [], blocking: [], declared: {}, trusted: false } : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  vi.stubGlobal('fetch', f);
  render(<SettingsPanel pane="models" client={createSettingsClient(f)} />);
  const lede = await screen.findByTestId('settings-unconfigured');
  const card = await screen.findByTestId('provider-catalog');
  /* The lede first, then the providers (it used to sit above the lede). */
  expect(lede.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByText('Other providers').className).toContain('sb-lab');
  fireEvent.change(screen.getByTestId('provider-catalog-search'), { target: { value: 'groq' } });
  fireEvent.click(await screen.findByTestId('provider-catalog-pick'));
  const key = (await screen.findByTestId('settings-apikey')) as HTMLInputElement;
  await waitFor(() => expect(document.activeElement).toBe(key));
  expect(key.placeholder).toBe('Paste your Groq key');
  const link = screen.getByTestId('settings-provider-key-link') as HTMLAnchorElement;
  expect(link.textContent).toBe('Get a Groq key');
  expect(link.getAttribute('href')).toBe('https://console.groq.com/docs');
});

