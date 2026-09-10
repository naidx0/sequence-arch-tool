import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * LOCAL-FIRST, SAID OUT LOUD
 *
 * CLAUDE.md's second non-negotiable: "the app boots and delivers its core with
 * no network and no key." The ENGINE honours it — measured 2026-08-23, a full
 * grounded answer against a 6.9B model on localhost with neither.
 *
 * THE PRODUCT NEVER SAID SO. The shipped default points at an undeployed
 * gateway, and the first failure a new reader meets is this very form asking
 * for an API key — for a capability already running on their machine. That is
 * the biggest first-impression defect in the product and the cheapest to fix.
 * ══════════════════════════════════════════════════════════════════════════
 */

const LOCAL = {
  name: 'Ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  models: ['granite4-hermes:latest', 'ornith:9b'],
};

function answering(body: unknown, putBody: unknown = body) {
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') {
        puts.push(JSON.parse(String(init?.body)));
        return { ok: true, status: 200, json: async () => putBody } as unknown as Response;
      }
      if (String(url).includes('/api/hooks')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ events: [], blocking: [], declared: {}, trusted: false }),
        } as unknown as Response;
      }
      if (String(url).includes('/api/permissions')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            path: '.sequence/permissions.json',
            exists: false,
            document: { version: 1, default: 'allow', denyStreak: 3, deny: [], ask: [], allow: [] },
            text: '{}',
            warnings: [],
          }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  );
  return puts;
}

describe('when something is already running here', () => {
  it('SAYS SO, and says it costs nothing', async () => {
    answering({ configured: false, localProviders: [LOCAL] });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);

    const said = await screen.findByTestId('settings-local');
    expect(said.textContent).toMatch(/Ollama is running on this machine/);
    expect(said.textContent).toMatch(/no key/i);
    /* And that nothing leaves the machine, which is the other half of why a
       reader would choose it. */
    expect(said.textContent).toMatch(/nothing leaves your computer/i);
  });

  it('offers EVERY model it reported, and invents none', async () => {
    answering({ configured: false, localProviders: [LOCAL] });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);

    const rows = await screen.findAllByTestId('settings-local-use');
    expect(rows.map((r) => r.getAttribute('data-model'))).toEqual(LOCAL.models);
  });

  it('FILLS THE FORM RATHER THAN SAVING — the choice stays the reader s', async () => {
    /*
     * A surface that configured itself because it found something would be
     * choosing on the reader's behalf. Pressing this puts the values in the
     * form; Save is the same explicit act it always was, and they can change
     * their mind having seen what it would do.
     */
    const puts = answering({ configured: false, localProviders: [LOCAL] });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);

    fireEvent.click((await screen.findAllByTestId('settings-local-use'))[0]!);

    await waitFor(() => {
      expect((screen.getByTestId('settings-model') as HTMLInputElement).value).toBe(
        'granite4-hermes:latest',
      );
    });
    expect((screen.getByTestId('settings-baseurl') as HTMLInputElement).value).toBe(LOCAL.baseUrl);
    /* NOTHING WAS WRITTEN. */
    expect(puts).toHaveLength(0);
  });

  it('SAVES the selected local model with no invented credential', async () => {
    const puts = answering(
      { configured: false, localProviders: [LOCAL] },
      {
        configured: true,
        provider: 'openai-compatible',
        baseUrl: LOCAL.baseUrl,
        model: LOCAL.models[0],
      },
    );
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);

    fireEvent.click((await screen.findAllByTestId('settings-local-use'))[0]!);
    fireEvent.click(screen.getByTestId('settings-save'));

    await screen.findByTestId('settings-saved');
    expect(puts).toEqual([{
      mode: 'api-key',
      provider: 'openai-compatible',
      baseUrl: LOCAL.baseUrl,
      model: LOCAL.models[0],
    }]);
    expect(Object.prototype.hasOwnProperty.call(puts[0] as object, 'apiKey')).toBe(false);
    expect(screen.getByTestId('settings-key-hint').textContent).toMatch(/does not need a key/i);
  });

  it('RUNNING WITH NOTHING LOADED says how to pull a model', async () => {
    /*
     * One of these the reader can fix in thirty seconds and the other they
     * cannot; collapsing them into silence hides the one that is actionable.
     */
    answering({ configured: false, localProviders: [{ ...LOCAL, models: [] }] });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);

    const empty = await screen.findByTestId('settings-local-empty');
    expect(empty.textContent).toMatch(/no models loaded/i);
    expect(empty.querySelector('code')?.textContent).toBe('ollama pull <model-name>');
    expect(screen.queryAllByTestId('settings-local-use')).toHaveLength(0);
  });

  it('says NOTHING when nothing is running', async () => {
    /* Most machines run neither, and a panel that explained what Ollama is to
       everybody who opened it would be noise on every one of them. */
    answering({ configured: false });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);

    await screen.findByTestId('settings-unconfigured');
    expect(screen.queryByTestId('settings-local')).toBeNull();
  });

  it('offers it even when a provider is ALREADY configured', async () => {
    /* Switching to something local is a decision a reader can make at any
       time, not only before their first key. */
    answering({
      configured: true,
      provider: 'anthropic',
      model: 'claude',
      apiKey: '••••1234',
      localProviders: [LOCAL],
    });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);

    await screen.findByTestId('settings-current');
    expect(screen.getByTestId('settings-local')).toBeTruthy();
  });
});
