import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';
import css from './settings.css?raw';

/* Owner: "some models are missing: import/refresh more models." Refresh models asks the saved model's own provider
   (through the server, which holds the key) and shows what it answered, or ONE line saying why not. */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CONFIG = {
  configured: true,
  provider: 'openai-compatible',
  model: 'qwen3:4b',
  baseUrl: 'http://127.0.0.1:11434/v1',
  profiles: [{ id: 'p1', name: 'Qwen', provider: 'openai-compatible', model: 'qwen3:4b', baseUrl: 'http://127.0.0.1:11434/v1' }],
  defaultProfileId: 'p1',
};

function wire(models: unknown, status = 200) {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const at = String(url);
      const ok = (b: unknown, s = 200) => ({ ok: s < 400, status: s, json: async () => b }) as unknown as Response;
      if (at.startsWith('/api/ai-models')) {
        asked.push(at);
        return ok(models, status);
      }
      if (at.includes('/api/ai-config')) return ok(CONFIG);
      if (at.includes('/api/hooks')) return ok({ events: [], blocking: [], declared: {}, trusted: false });
      return ok({ path: 'x', exists: false, text: '{}', warnings: [] });
    }),
  );
  return asked;
}

async function open() {
  render(<SettingsPanel pane="models" client={createSettingsClient(globalThis.fetch)} />);
  return screen.findByTestId('settings-profile-refresh-models');
}

describe('Settings > Models: Refresh models', () => {
  it('lists what the provider reported, bypassing the server cache, and a pick opens Edit with it', async () => {
    const asked = wire({ ok: true, models: ['qwen3:4b', 'llama3:8b'], source: 'ollama', cached: false });
    fireEvent.click(await open());
    const list = await screen.findByTestId('settings-profile-models');
    expect(asked).toEqual(['/api/ai-models?profile=p1&refresh=1']);
    expect(list.textContent).toContain('2 models');
    const opts = screen.getAllByTestId('settings-profile-model-option');
    expect(opts.map((o) => o.getAttribute('data-model'))).toEqual(['qwen3:4b', 'llama3:8b']);
    fireEvent.click(opts[1]!);
    expect((await screen.findByTestId('settings-model') as HTMLInputElement).value).toBe('llama3:8b');
  });

  it('a provider that cannot answer shows its one-line reason, not a blank', async () => {
    wire({ ok: false, reason: '127.0.0.1:11434 did not answer within 4 seconds.' });
    fireEvent.click(await open());
    const why = await screen.findByTestId('settings-profile-models-reason');
    expect(why.textContent).toBe('127.0.0.1:11434 did not answer within 4 seconds.');
    expect(screen.queryByTestId('settings-profile-models')).toBeNull();
  });

  it('a failed request is a line too, and the button comes back', async () => {
    wire({ error: 'boom' }, 500);
    fireEvent.click(await open());
    await waitFor(() => expect(screen.getByTestId('settings-profile-models-reason').textContent).toContain('boom'));
    expect(screen.getByTestId('settings-profile-refresh-models').textContent).toBe('Refresh models');
  });

  it('a capped list says "First N of M"', async () => {
    wire({ ok: true, models: ['a', 'b'], total: 1200, source: 'openai', cached: false });
    fireEvent.click(await open());
    expect((await screen.findByTestId('settings-profile-models')).textContent).toContain('First 2 of 1200 models');
  });

  it('a long model id cannot widen the card: the wrapper may shrink, the list never scrolls sideways, the id has a title', async () => {
    const long = 'x'.repeat(200);
    wire({ ok: true, models: [long], source: 'openai', cached: false });
    fireEvent.click(await open());
    const opt = await screen.findByTestId('settings-profile-model-option');
    expect(opt.getAttribute('title')).toBe(long);
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const body = (sel: string) => [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim() === sel).map((m) => m[2]).join(';');
    expect(body('.settings-scope .sb-model-wrap')).toMatch(/min-width:\s*0/);
    /* The card is a wrapping COLUMN flex: a flex-basis of 100% there is a height, and pushes the list into a second column off to the right. */
    expect(body('.settings-scope .sb-model-wrap')).not.toMatch(/flex-basis/);
    expect(body('.settings-scope .sb-model-list')).toMatch(/overflow-x:\s*hidden/);
    expect(body('.settings-scope .sb-model-list .sb-pill')).toMatch(/text-overflow:\s*ellipsis/);
  });
});
