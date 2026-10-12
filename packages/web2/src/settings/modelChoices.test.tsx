import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

/* Round 13 (O3): one-line expandable choices, a one-click "Use it" for what is running,
   an accent "Add another model", and no role words ("daily", "cheap", "local") in a name. */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wire(body: unknown) {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const at = String(url);
      const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as unknown as Response;
      if (at.includes('/api/ai-config')) {
        if (init?.method === 'PUT') {
          puts.push(JSON.parse(String(init.body)));
          return ok(body);
        }
        return ok(body);
      }
      if (at.includes('/api/hooks')) return ok({ events: [], blocking: [], declared: {}, trusted: false });
      return ok({ path: 'x', exists: false, text: '{}', warnings: [] });
    }),
  );
  return puts;
}

const CONFIG = {
  configured: true,
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKey: '••••4f2a',
  profiles: [{ id: 'p1', name: 'Claude Sonnet', provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: '••••4f2a' }],
  defaultProfileId: 'p1',
  localProviders: [{ name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen3:4b'] }],
};

/** The add-a-model form belongs to the API key choice: nothing of it is drawn until that door is opened. */
function openApiKey() {
  const door = screen.getAllByTestId('settings-choice').find((c) => c.getAttribute('data-choice') === 'key')!;
  fireEvent.click(door.querySelector('[data-testid="settings-choice-toggle"]')!);
}

describe('Settings > Models: the two one-line choices', () => {
  it('Local model and API key are folded to one line each; opening one shows only its providers', async () => {
    wire(CONFIG);
    render(<SettingsPanel pane="models" client={createSettingsClient(globalThis.fetch)} />);
    const choices = await screen.findAllByTestId('settings-choice');
    expect(choices.map((c) => c.getAttribute('data-choice'))).toEqual(['local', 'key']);
    expect(choices.map((c) => c.getAttribute('data-open'))).toEqual(['false', 'false']);
    expect(choices[0]!.textContent).toContain('Ollama, LM Studio');
    expect(choices[1]!.textContent).toContain('OpenAI, Anthropic, OpenRouter, Other OpenAI-compatible');
    expect(screen.queryAllByTestId('settings-preset')).toHaveLength(0);

    fireEvent.click(choices[0]!.querySelector('[data-testid="settings-choice-toggle"]')!);
    expect(screen.getAllByTestId('settings-preset').map((p) => p.getAttribute('data-preset'))).toEqual(['ollama', 'lm-studio']);
    expect(choices[0]!.querySelector('[aria-expanded]')!.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(choices[1]!.querySelector('[data-testid="settings-choice-toggle"]')!);
    /* One choice open at a time. */
    expect(screen.getAllByTestId('settings-preset').map((p) => p.getAttribute('data-preset'))).toEqual(['openai', 'anthropic', 'openrouter', 'other']);
    expect(screen.getByText('Other OpenAI-compatible')).toBeTruthy();
  });

  it('a running Ollama has a one-click Use it that saves its first model and selects it', async () => {
    const puts = wire(CONFIG);
    render(<SettingsPanel pane="models" client={createSettingsClient(globalThis.fetch)} />);
    const head = (await screen.findAllByTestId('settings-choice'))[0]!;
    fireEvent.click(head.querySelector('[data-testid="settings-choice-toggle"]')!);
    const use = await screen.findAllByTestId('settings-preset-use');
    expect(use.map((b) => b.getAttribute('data-preset'))).toEqual(['ollama']);
    fireEvent.click(use[0]!);
    await waitFor(() => expect(puts.length).toBeGreaterThan(0));
    const first = puts[0] as { profiles: { name: string; model: string }[] };
    expect(first.profiles.at(-1)).toMatchObject({ name: 'qwen3:4b', model: 'qwen3:4b' });
  });

  it('says the local offer once: no repeated sentences, and nothing offered for a model that is already saved', async () => {
    wire({ ...CONFIG, profiles: [...CONFIG.profiles, { id: 'p2', name: 'qwen3:4b', provider: 'openai-compatible', model: 'qwen3:4b', baseUrl: 'http://127.0.0.1:11434/v1' }] });
    render(<SettingsPanel pane="models" client={createSettingsClient(globalThis.fetch)} />);
    const head = (await screen.findAllByTestId('settings-choice'))[0]!;
    fireEvent.click(head.querySelector('[data-testid="settings-choice-toggle"]')!);
    expect(screen.queryAllByTestId('settings-preset-use')).toHaveLength(0);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/Add a model\. Local ones are free/);
    expect(text).not.toMatch(/is running on this machine/);
  });

  it('plain words on the saved rows and the status line', async () => {
    wire(CONFIG);
    render(<SettingsPanel pane="models" client={createSettingsClient(globalThis.fetch)} />);
    await screen.findAllByTestId('settings-profile');
    expect(screen.getByTestId('settings-profile-meta').textContent).toBe('Anthropic, key saved');
    expect(screen.getByTestId('settings-current').textContent).toBe('Using Claude Sonnet');
  });

  it('every choice row is drawn one per line, never wrapped (nowrap rules)', async () => {
    const css = (await import('./settings.css?raw')).default.replace(/\/\*[\s\S]*?\*\//g, '');
    const tiles = /\.settings-scope \.sb-choice \.sb-tiles \{([^}]*)\}/.exec(css)![1]!;
    expect(tiles).toMatch(/flex-direction:\s*column/);
    expect(/\.settings-scope \.sb-choice \.sb-tile-t,\s*\.settings-scope \.sb-choice \.sb-tile-sub \{([^}]*)\}/.exec(css)![1]).toMatch(/white-space:\s*nowrap/);
  });

  it('"Add another model" is the accent button', async () => {
    wire(CONFIG);
    render(<SettingsPanel pane="models" client={createSettingsClient(globalThis.fetch)} />);
    const add = await screen.findByTestId('settings-profile-new');
    expect(add.className).toContain('sb-pill-solid');
    expect(add.textContent).toBe('Add another model');
  });

  it('the name box never suggests a role word', async () => {
    wire(CONFIG);
    render(<SettingsPanel pane="models" client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-presets');
    openApiKey();
    const name = await screen.findByTestId('settings-name');
    expect(name.getAttribute('placeholder') ?? '').not.toMatch(/daily|cheap|local/i);
  });
  /* Owner: "API key information (name, provider, model, base URL) shows right away even if they didn't select
     API key; we don't need that, it's repetitive; only show it when API key is selected." */
  const FIELDS = ['settings-name', 'settings-provider', 'settings-model', 'settings-baseurl', 'settings-apikey'];
  it('shows none of the API key fields until API key is chosen, even with a model already saved', async () => {
    wire(CONFIG);
    render(<SettingsPanel pane="models" client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-presets');
    await screen.findByTestId('settings-current');
    for (const id of FIELDS) expect(screen.queryByTestId(id), `${id} before choosing`).toBeNull();

    openApiKey();
    for (const id of FIELDS) expect(screen.queryByTestId(id), `${id} after choosing API key`).not.toBeNull();

    openApiKey(); /* the same door again folds it */
    for (const id of FIELDS) expect(screen.queryByTestId(id), `${id} after folding`).toBeNull();
  });

  it('does not show them for the Local model choice either', async () => {
    wire(CONFIG);
    render(<SettingsPanel pane="models" client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-presets');
    const door = screen.getAllByTestId('settings-choice').find((c) => c.getAttribute('data-choice') === 'local')!;
    fireEvent.click(door.querySelector('[data-testid="settings-choice-toggle"]')!);
    for (const id of FIELDS) expect(screen.queryByTestId(id), `${id} under Local model`).toBeNull();
  });
});
