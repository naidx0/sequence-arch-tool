import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';
import {
  OPENAI_SUBSCRIPTION_NOTE,
  PROVIDER_PRESETS,
  keyFieldVisible,
  presetById,
  presetChipLabel,
  presetForProfile,
  probesForPreset,
  thinksByDefault,
} from './providerPresets';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * ══════════════════════════════════════════════════════════════════════════
 * WHERE THE MODEL RUNS
 *
 * Max, 2026-09-18: "make sure Settings is a proper setup for everyone's local
 * setup — local models, easy to set up new models with API keys, see if they
 * can open or add their OpenAI subscription."
 *
 * THE FORM ASKED FOR A WIRE AND THE READER HAS A PRODUCT. Adding OpenRouter
 * meant already knowing it is spelled `openai-compatible` at
 * `https://openrouter.ai/api/v1`; adding Anthropic meant knowing its base must
 * NOT carry `/v1`, because `resolveEndpoint` appends `/v1/messages` itself.
 * Four facts, none on screen, each worth an HTTP 404 several screens later.
 *
 * These lock the four claims the cards make: the address they fill, which of
 * them show a key box, what a local card lists, and the one sentence about a
 * ChatGPT subscription that must never soften into implying one works.
 * ══════════════════════════════════════════════════════════════════════════
 */

const OLLAMA = {
  name: 'Ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  models: ['granite4-hermes:latest', 'ornith:9b'],
};
const LM_STUDIO = {
  name: 'LM Studio',
  baseUrl: 'http://127.0.0.1:1234/v1',
  models: ['qwen3-8b'],
};

/**
 * The fake wire. Every `/api/ai-config` call is recorded so a test can assert
 * WHAT was sent, not merely that something was.
 */
function answering(body: unknown, putBody: unknown = body) {
  const calls: { method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const at = String(url);
      if (at.includes('/api/ai-config')) {
        calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, model: 'granite4-hermes:latest', ms: 12, sample: 'ok' }),
          } as unknown as Response;
        }
        if (method === 'PUT') {
          return { ok: true, status: 200, json: async () => putBody } as unknown as Response;
        }
      }
      if (at.includes('/api/hooks')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ events: [], blocking: [], declared: {}, trusted: false }),
        } as unknown as Response;
      }
      if (at.includes('/api/permissions') || at.includes('/api/mcp')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ path: 'x', exists: false, text: '{}', warnings: [] }),
        } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }),
  );
  return calls;
}

const card = (preset: string) =>
  screen.getAllByTestId('settings-preset').find((b) => b.getAttribute('data-preset') === preset)!;

describe('the preset table itself', () => {
  it('names only wires the analyzer accepts, and local ones first', () => {
    /*
     * `validateAiConfig` accepts `anthropic` and `openai-compatible` and
     * NOTHING ELSE (analyzer/src/server/provider.ts:601). The dropdown this
     * replaces once offered five ids, three of which were guaranteed 400s.
     * Offering a choice that always fails is the dishonesty.
     */
    for (const p of PROVIDER_PRESETS) {
      expect(['anthropic', 'openai-compatible']).toContain(p.provider);
    }
    /* CLAUDE.md's second non-negotiable. A row that opened with OpenAI would
       put a bill in front of something already running on the machine. */
    expect(PROVIDER_PRESETS.slice(0, 2).map((p) => p.id)).toEqual(['ollama', 'lm-studio']);
    expect(PROVIDER_PRESETS.slice(0, 2).every((p) => p.local)).toBe(true);
  });

  it("Anthropic's base carries no /v1, because the server appends /v1/messages", () => {
    /*
     * NOT COSMETIC. `resolveEndpoint` builds `${base}/v1/messages` for the
     * anthropic wire (provider.ts:1872) and routes the other five through
     * `openaiCompatChatUrl`, which joins WITHOUT doubling (provider.ts:1698).
     * A base of `https://api.anthropic.com/v1` becomes `/v1/v1/messages` and
     * 404s — the two rules differ, so the two bases must differ.
     */
    expect(presetById('anthropic')!.baseUrl).toBe('https://api.anthropic.com');
    expect(presetById('openai')!.baseUrl).toBe('https://api.openai.com/v1');
    expect(presetById('openrouter')!.baseUrl).toBe('https://openrouter.ai/api/v1');
    expect(presetById('ollama')!.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(presetById('lm-studio')!.baseUrl).toBe('http://127.0.0.1:1234/v1');
    /* Inventing a default here would put somebody else's host in the field of
       a person who came to type their own. */
    expect(presetById('other')!.baseUrl).toBe('');
  });

  it('shows a key box exactly where the server would refuse a keyless config', () => {
    /*
     * `parseDirectAiFields` earns a keyless config ONLY for an
     * `openai-compatible` baseUrl on loopback (provider.ts:621-641). Hiding
     * the box anywhere else would hide the reason a save failed.
     */
    expect(keyFieldVisible(presetById('ollama'))).toBe(false);
    expect(keyFieldVisible(presetById('lm-studio'))).toBe(false);
    for (const id of ['openai', 'anthropic', 'openrouter', 'other']) {
      expect(keyFieldVisible(presetById(id))).toBe(true);
      expect(presetById(id)!.keyUrl === undefined && id !== 'other').toBe(false);
    }
    /* No card chosen means the reader is editing by hand or reading what is
       already stored, and the box has always been there. */
    expect(keyFieldVisible(undefined)).toBe(true);
  });

  it('matches a probed daemon by name, and by ORIGIN however it was spelled', () => {
    /*
     * The four spellings of one machine — `localhost`, a trailing slash, no
     * `/v1`, upper case — are the lesson `matchLocalOllama` records in
     * analyzer/src/server/localProviders.ts:365-379, where comparing the
     * literal silently turned a whole planner off with no signal anywhere.
     */
    const ollama = presetById('ollama')!;
    expect(probesForPreset(ollama, [OLLAMA, LM_STUDIO])).toEqual([OLLAMA]);
    const spelled = { name: 'something else', baseUrl: 'HTTP://localhost:11434/', models: ['m'] };
    expect(probesForPreset(ollama, [spelled])).toEqual([spelled]);
    /* A different port is a different service, not Ollama spelled differently. */
    expect(probesForPreset(ollama, [LM_STUDIO])).toEqual([]);
    /* A remote card never claims a local daemon. */
    expect(probesForPreset(presetById('openai')!, [OLLAMA])).toEqual([]);
  });

  it('reads a saved row back to the card it belongs to', () => {
    /* A READING of the stored address, never a claim about how the row was
       made: a profile typed by hand before presets existed still says what it
       actually is. */
    expect(presetForProfile('anthropic', undefined)).toBe('anthropic');
    expect(presetForProfile('openai-compatible', 'http://localhost:11434')).toBe('ollama');
    expect(presetForProfile('openai-compatible', 'https://openrouter.ai/api/v1')).toBe('openrouter');
    /* The fallback names the WIRE rather than guessing a product. */
    expect(presetForProfile('openai-compatible', 'https://example.invalid/v1')).toBe('other');
    expect(presetChipLabel('openai-compatible', 'https://example.invalid/v1')).toBe(
      'OpenAI-compatible',
    );
    expect(presetChipLabel('openai-compatible', 'http://127.0.0.1:1234/v1')).toBe('LM Studio');
  });
});

describe('picking a card fills the address', () => {
  it('fills base URL and provider without the reader knowing either', async () => {
    answering({ configured: false });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-presets');

    fireEvent.click(card('openrouter'));

    expect((screen.getByTestId('settings-baseurl') as HTMLInputElement).value).toBe(
      'https://openrouter.ai/api/v1',
    );
    expect((screen.getByTestId('settings-provider') as HTMLSelectElement).value).toBe(
      'openai-compatible',
    );
    /* What a model id looks like THERE. `claude-sonnet-4-5` on an OpenRouter
       form is a 404: that service wants `vendor/model`. */
    expect(screen.getByTestId('settings-model').getAttribute('placeholder')).toBe(
      'deepseek/deepseek-v4-flash',
    );
    /* A PREFILL, NEVER A LOCK — the field the card filled is still a field. */
    fireEvent.change(screen.getByTestId('settings-baseurl'), {
      target: { value: 'https://elsewhere.invalid/v1' },
    });
    expect((screen.getByTestId('settings-baseurl') as HTMLInputElement).value).toBe(
      'https://elsewhere.invalid/v1',
    );
  });

  it('fills the anthropic native endpoint on the anthropic wire', async () => {
    answering({ configured: false });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-presets');

    fireEvent.click(card('anthropic'));

    expect((screen.getByTestId('settings-provider') as HTMLSelectElement).value).toBe('anthropic');
    expect((screen.getByTestId('settings-baseurl') as HTMLInputElement).value).toBe(
      'https://api.anthropic.com',
    );
  });

  it('shows the key box for a remote card and REMOVES it for a local one', async () => {
    answering({ configured: false });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-presets');

    fireEvent.click(card('openai'));
    expect(screen.getByTestId('settings-apikey')).toBeTruthy();
    /* Where to get one, so the answer to "now what" is a link and not a search. */
    expect(screen.getByTestId('settings-preset-key-link').getAttribute('href')).toBe(
      'https://platform.openai.com/api-keys',
    );

    fireEvent.click(card('ollama'));
    /* A key box on a form for 127.0.0.1 is a box a reader will try to fill and
       there is nothing to put in it. */
    expect(screen.queryByTestId('settings-apikey')).toBeNull();
    expect(screen.getByTestId('settings-key-not-needed').textContent).toMatch(/no key/i);
  });

  it('saves what the card filled, on the wire the server accepts', async () => {
    const calls = answering({ configured: false });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-presets');

    fireEvent.click(card('anthropic'));
    fireEvent.change(screen.getByTestId('settings-model'), {
      target: { value: 'claude-sonnet-4-5' },
    });
    fireEvent.change(screen.getByTestId('settings-apikey'), { target: { value: 'sk-ant-real' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const sent = calls.find((c) => c.method === 'PUT')!.body as Record<string, unknown>;
    expect(sent.provider).toBe('anthropic');
    expect(sent.baseUrl).toBe('https://api.anthropic.com');
    expect(sent.model).toBe('claude-sonnet-4-5');
  });
});

describe('a local card lists what that daemon reported', () => {
  it('shows the models found, and one click connects one', async () => {
    const calls = answering(
      { configured: false, localProviders: [OLLAMA, LM_STUDIO] },
      {
        configured: true,
        provider: 'openai-compatible',
        baseUrl: OLLAMA.baseUrl,
        model: OLLAMA.models[0],
      },
    );
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-presets');

    /* NOTHING TOUCHED YET: the probe ran on the config read, so a reader with
       Ollama sees their models before they click anything. */
    expect(screen.getAllByTestId('settings-local-use').map((r) => r.getAttribute('data-model')))
      .toEqual([...OLLAMA.models, ...LM_STUDIO.models]);

    /* Picking LM Studio stops answering with Ollama's models. */
    fireEvent.click(card('lm-studio'));
    expect(screen.getAllByTestId('settings-local-use').map((r) => r.getAttribute('data-model')))
      .toEqual(LM_STUDIO.models);

    fireEvent.click(card('ollama'));
    fireEvent.click(
      screen.getAllByTestId('settings-local-use').find((r) => r.getAttribute('data-model') === 'ornith:9b')!,
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const saved = calls.find((c) => c.method === 'PUT')!.body as {
      profiles: Record<string, unknown>[];
    };
    expect(saved.profiles[0]!.model).toBe('ornith:9b');
    /* Named after the MODEL, never the endpoint — the endpoint is localhost for
       every one of them. And ABSENCE is how a later reader can tell there was
       never a credential. */
    expect(saved.profiles[0]!.name).toBe('ornith:9b');
    expect(Object.prototype.hasOwnProperty.call(saved.profiles[0]!, 'apiKey')).toBe(false);
  });

  it('a remote card stops listing what is running on the laptop', async () => {
    answering({ configured: false, localProviders: [OLLAMA] });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-local');

    fireEvent.click(card('openai'));
    /* A person typing an OpenAI key is not being told what is running on their
       laptop. A list that ignores the question being answered is noise. */
    expect(screen.queryByTestId('settings-local')).toBeNull();
  });

  it('says a local daemon is not answering, and offers to look again', async () => {
    /* NOT ANSWERING is a different thing to fix from NOT INSTALLED, and the
       likeliest next act is starting it — which used to need an app reload to
       be noticed at all. */
    const calls = answering({ configured: false, localProviders: [OLLAMA] });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-presets');

    fireEvent.click(card('lm-studio'));
    const absent = screen.getByTestId('settings-preset-absent');
    expect(absent.textContent).toMatch(/LM Studio is not answering/);
    expect(absent.textContent).toMatch(/127\.0\.0\.1:1234/);

    const before = calls.filter((c) => c.method === 'GET').length;
    fireEvent.click(screen.getByTestId('settings-preset-recheck'));
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(before),
    );
  });
});

describe('a model that thinks before it answers', () => {
  it('names the families that reason unless told not to', () => {
    /*
     * Measured on Ollama 0.33.2, 2026-09-18: these answer
     * `/v1/chat/completions` with `content: ""` and the whole reply on
     * `reasoning`, `finish_reason: length`. One real turn — 6,746 tokens in,
     * 0 out, 27 s — reached the reader as "I did not produce an answer".
     */
    for (const id of ['qwen3.5:4b', 'deepseek-r1:8b', 'gpt-oss:20b', 'magistral-small', 'DeepSeek-V3']) {
      expect(thinksByDefault(id)).toBe(true);
    }
    for (const id of ['granite4-hermes:latest', 'llama3.2', 'claude-sonnet-4-5', '']) {
      expect(thinksByDefault(id)).toBe(false);
    }
    expect(thinksByDefault(undefined)).toBe(false);
  });

  it('says so on the row, before the slow first question rather than after', async () => {
    /* A NOTE, NEVER A REFUSAL: the analyzer retries such a turn once with
       reasoning off and answers, so the model works — it just costs two round
       trips the first time, and a reader who is not told that concludes the
       model is broken. */
    answering({
      configured: false,
      localProviders: [{ name: 'Ollama', baseUrl: OLLAMA.baseUrl, models: ['qwen3.5:4b', 'granite4-hermes:latest'] }],
    });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);
    await screen.findByTestId('settings-local');

    const rows = screen.getAllByTestId('settings-local-row');
    expect(rows[0]!.textContent).toMatch(/thinks by default/);
    expect(rows[1]!.textContent).not.toMatch(/thinks by default/);
  });
});

describe('the ChatGPT question, answered before it is asked', () => {
  it('says a subscription cannot sign in, in that sentence', async () => {
    /*
     * Max asked whether people "can open or add their OpenAI subscription".
     * They cannot: there is no public API for a ChatGPT Plus/Pro account, and
     * the sign-in Codex CLI performs is OpenAI's own first-party client flow,
     * not something a third party may implement. The alternatives were one
     * muted sentence or a button that lies.
     *
     * ASSERTED AS THE SENTENCE, not as a pattern, so a later edit cannot
     * soften it into implying a subscription works.
     */
    answering({ configured: false });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);

    const said = await screen.findByTestId('settings-openai-subscription');
    expect(said.textContent).toBe(OPENAI_SUBSCRIPTION_NOTE);
    expect(OPENAI_SUBSCRIPTION_NOTE).toContain('a ChatGPT subscription cannot sign in here');
    expect(OPENAI_SUBSCRIPTION_NOTE).toContain('platform.openai.com');
    /* It is on screen BEFORE anything is clicked, because the reader looking
       for a sign-in button has not clicked anything yet. */
    expect(screen.queryByTestId('settings-preset-note')).toBeNull();
  });

  it('adds no sign-in door of any kind', async () => {
    answering({ configured: false });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);
    const presets = await screen.findByTestId('settings-presets');

    const words = (presets.textContent ?? '').toLowerCase();
    expect(words).not.toMatch(/sign in with|log in with|connect your chatgpt|oauth/);
  });
});

describe('a saved row says whose wire it is', () => {
  it('carries a chip naming the service, not only the protocol', async () => {
    answering({
      configured: true,
      provider: 'openai-compatible',
      baseUrl: OLLAMA.baseUrl,
      model: 'granite4-hermes:latest',
      defaultProfileId: 'local',
      profiles: [
        {
          id: 'local',
          name: 'Local, cheap',
          provider: 'openai-compatible',
          model: 'granite4-hermes:latest',
          baseUrl: OLLAMA.baseUrl,
        },
        {
          id: 'router',
          name: 'The router',
          provider: 'openai-compatible',
          model: 'deepseek/deepseek-v4-flash',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiKey: '••••9f3a',
        },
      ],
    });
    render(<SettingsPanel client={createSettingsClient(globalThis.fetch)} />);
    await screen.findAllByTestId('settings-profile');

    const chips = screen.getAllByTestId('settings-profile-chip');
    /* `openai-compatible` names a protocol and four of the six things it can
       be; the chip names the one it actually is. */
    expect(chips.map((c) => c.textContent)).toEqual(['Ollama', 'OpenRouter']);
    expect(chips.map((c) => c.getAttribute('data-preset'))).toEqual(['ollama', 'openrouter']);
  });
});
