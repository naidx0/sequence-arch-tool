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

/**
 * Every ai-config call in the order it was made. The ORDER is the claim the
 * one-click path makes — save it, make it the one that answers, then probe the
 * real wire — and a test that only looked at the PUT bodies could not see it.
 */
const wire: { method: string; body: unknown }[] = [];

function answering(body: unknown, putBody: unknown = body) {
  const puts: unknown[] = [];
  wire.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (String(url).includes('/api/ai-config')) {
        wire.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
      }
      if (method === 'POST') {
        /* `POST /api/ai-config` is ALWAYS HTTP 200: a model that refused is a
           fact about the configuration, not a server fault. */
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, model: 'granite4-hermes:latest', ms: 31, sample: 'hi' }),
        } as unknown as Response;
      }
      if (method === 'PUT') {
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

  it('ONE CLICK CONNECTS IT — save, then select, then probe, in that order', async () => {
    /*
     * CORRECTION, 2026-09-12. This test used to read "FILLS THE FORM RATHER
     * THAN SAVING — the choice stays the reader's", on the reasoning that a
     * surface which configured itself because it found something would be
     * choosing for them. That reasoning is intact and is not what changed: the
     * CLICK is the reader choosing. What changed is that filling a form and
     * then pressing Save were two gestures for one decision. Max, asking for
     * the ml-harness shape: "adapt the same chat-like settings and setups from
     * ML Harness regarding model selection, nicknames and selection", and his
     * own measure of what this should cost is "one click".
     *
     * The ORDER is the substance. The probe runs LAST because it reports on
     * what was stored; running it first would be testing a model nobody had
     * chosen yet.
     */
    answering({ configured: false, localProviders: [LOCAL] }, {
        configured: true,
        provider: 'openai-compatible',
        baseUrl: LOCAL.baseUrl,
        model: LOCAL.models[0],
        defaultProfileId: 'saved-1',
        profiles: [
          {
            id: 'saved-1',
            name: 'granite4-hermes',
            provider: 'openai-compatible',
            model: LOCAL.models[0],
            baseUrl: LOCAL.baseUrl,
          },
        ],
      });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);

    fireEvent.click((await screen.findAllByTestId('settings-local-use'))[0]!);

    await waitFor(() => expect(wire.filter((c) => c.method === 'POST')).toHaveLength(1));
    const acts = wire.filter((c) => c.method !== 'GET');
    expect(acts.map((c) => c.method)).toEqual(['PUT', 'PUT', 'POST']);

    const saved = acts[0]!.body as {
      profiles: { id: string; name: string; model: string; baseUrl: string; provider: string }[];
      defaultProfileId: string;
    };
    /* NAMED AFTER THE MODEL, never after the endpoint — the endpoint is the
       same string for every local model, which is how nine connections became
       seven rows that mostly read `Ollama`. */
    expect(saved.profiles[0]!.name).toBe('granite4-hermes');
    expect(saved.profiles[0]!.model).toBe(LOCAL.models[0]);
    expect(saved.profiles[0]!.baseUrl).toBe(LOCAL.baseUrl);
    expect(saved.profiles[0]!.provider).toBe('openai-compatible');
    expect(saved.defaultProfileId).toBe(saved.profiles[0]!.id);
    expect(acts[1]!.body).toEqual({ selectProfileId: saved.profiles[0]!.id });
    expect(acts[2]!.body).toEqual({ test: true, profileId: saved.profiles[0]!.id });

    /* And the probe's answer is on the card, not swallowed. */
    expect((await screen.findByTestId('settings-profile-test-result')).textContent).toMatch(/31 ms/);
  });

  it('connects the local model with NO INVENTED CREDENTIAL', async () => {
    const puts = answering({ configured: false, localProviders: [LOCAL] }, {
        configured: true,
        provider: 'openai-compatible',
        baseUrl: LOCAL.baseUrl,
        model: LOCAL.models[0],
        defaultProfileId: 'saved-1',
        profiles: [
          {
            id: 'saved-1',
            name: 'granite4-hermes',
            provider: 'openai-compatible',
            model: LOCAL.models[0],
            baseUrl: LOCAL.baseUrl,
          },
        ],
      });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);

    fireEvent.click((await screen.findAllByTestId('settings-local-use'))[0]!);

    await waitFor(() => expect(puts.length).toBeGreaterThan(0));
    const saved = puts[0] as { profiles: Record<string, unknown>[] };
    /* A loopback OpenAI-compatible model needs no key, and ABSENCE is the
       contract that lets a later reader tell it was never a credential. */
    expect(Object.prototype.hasOwnProperty.call(saved.profiles[0]!, 'apiKey')).toBe(false);
    expect(JSON.stringify(puts)).not.toContain('apiKey');
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
