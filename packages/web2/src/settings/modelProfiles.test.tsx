/* ══════════════════════════════════════════════════════════════════════════
   THE MODEL PANE, AFTER THE MODEL LANE
   packages/web2/src/settings/modelProfiles.test.tsx

   Three measured defects, locked here.

   1. THE DROPDOWN OFFERED THREE PROVIDERS THE SERVER REJECTS. `PROVIDERS` read
      `['anthropic', 'openai', 'openai-compatible', 'google', 'ollama']` and the
      server accepts two. A local-first reader picked `ollama` — the one option
      that named the thing already running on their machine — pressed Save, and
      was told "provider must be 'anthropic' or 'openai-compatible'". Offering a
      choice that always fails is the dishonesty.

   2. ONE SAVED MODEL, NO DEFAULT, NO SWITCH. Changing your mind meant retyping
      provider + model + baseUrl + key.

   3. NO KNOBS ANYWHERE, INCLUDING NO TIMEOUT.

   WHY THE FIXTURES LOOK LIKE THIS. `CONFIGURED_WITH_PROFILES` is the shape the
   REAL server answers with after this change — `profiles` present, every key a
   `••••`+last4 MASK, one `defaultProfileId`. The mask matters: a panel that
   sends the list back verbatim would store the bullets as a credential, and a
   fixture whose keys were plaintext could not catch that.
   ══════════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { GetAiConfigResponse } from '@sequence/api-types';
import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function recorder(get: unknown, put?: unknown, putStatus = 200) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
    calls.push({ method, url, body });
    if (!url.includes('/api/ai-config')) {
      /* The pane reads hooks / permissions / mcp on mount too. They are not
         under test here and answer with the shapes those readers expect. */
      if (url.includes('/api/hooks')) {
        return new Response(JSON.stringify({ events: [], blocking: [], declared: {}, trusted: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ path: '', exists: false, text: '', warnings: [], document: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'PUT') {
      return new Response(JSON.stringify(put ?? get), {
        status: putStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'POST') {
      return new Response(JSON.stringify({ ok: true, model: 'granite4-hermes:latest', ms: 42, sample: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(get), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, client: createSettingsClient(fetchImpl) };
}

/** What the real server answers once two models are saved. Keys are MASKS. */
const CONFIGURED_WITH_PROFILES = {
  configured: true,
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKey: '••••9f3a',
  defaultProfileId: 'claude',
  profiles: [
    {
      id: 'local',
      name: 'Local, cheap',
      provider: 'openai-compatible',
      model: 'granite4-hermes:latest',
      baseUrl: 'http://127.0.0.1:11434/v1',
    },
    {
      id: 'claude',
      name: 'Claude, hard edits',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
      apiKey: '••••9f3a',
    },
  ],
} as unknown as GetAiConfigResponse;

/** The add-a-model form belongs to the API key choice: nothing of it is drawn until that door is opened. */
function openApiKey() {
  const door = screen.getAllByTestId('settings-choice').find((c) => c.getAttribute('data-choice') === 'key')!;
  fireEvent.click(door.querySelector('[data-testid="settings-choice-toggle"]')!);
}

/** Edit is the only route that edits a saved model; the API key choice always starts a new one. */
async function editSaved(id: string) {
  const row = (await screen.findAllByTestId('settings-profile-edit')).find((b) => b.getAttribute('data-profile') === id)!;
  fireEvent.click(row);
}

describe('the provider list offers only what the server accepts', () => {
  it('renders exactly the two real providers — no openai, no google, no ollama', async () => {
    const { client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    /* Decision 49: the provider control is B's menu (sbParts MenuSelect);
       its options are the menu's rows, opened by pressing the pill. */
    await screen.findAllByTestId('settings-profile');
    openApiKey();
    const select = await screen.findByTestId('settings-provider');
    fireEvent.click(select);
    const options = screen.getAllByTestId('settings-provider-option');
    const values = options.map((o) => o.getAttribute('data-value'));
    /*
     * The server's `validateAiConfig` accepts these two and refuses everything
     * else. Any id here that is not one of them is a guaranteed 400 the reader
     * discovers for us. The TYPE is the other half of this lock: `PROVIDERS` is
     * `readonly ProviderKind[]`, so re-adding a dead id is a compile error in
     * `pnpm --filter @sequence/web2 build`.
     */
    expect(values).toEqual(['anthropic', 'openai-compatible']);
    /* And the labels name the PRODUCT, not the wire — `openai-compatible` is
       the door for Ollama, and nothing used to say so. */
    const labels = options.map((o) => o.textContent ?? '');
    expect(labels.join(' ')).toMatch(/Ollama/);
  });

  it('the Base URL placeholder no longer names a provider that does not exist', async () => {
    const { client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    openApiKey();
    const field = await screen.findByTestId('settings-baseurl');
    const placeholder = field.getAttribute('placeholder') ?? '';
    /* It used to read "only for openai-compatible / ollama", which reinforced
       the trap two fields below the dropdown that set it. The fixture is an
       Anthropic model, so the placeholder names Anthropic's address, not the
       OpenAI-compatible wire (UX audit R11 #10). */
    expect(placeholder).not.toMatch(/\bollama\b/i);
    expect(placeholder).toMatch(/api\.anthropic\.com/);
    expect(placeholder).not.toMatch(/openai-compatible/);
  });
});

describe('saved models', () => {
  it('lists every saved model and names which one answers', async () => {
    const { client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    const rows = await screen.findAllByTestId('settings-profile');
    expect(rows).toHaveLength(2);
    /* A WORD, not a colour — sheet 12.5. */
    const marked = rows.filter((r) => r.getAttribute('data-active') === 'true');
    expect(marked).toHaveLength(1);
    expect(marked[0]!.getAttribute('data-profile')).toBe('claude');
    expect(screen.getByTestId('settings-profile-default').textContent).toMatch(/Default/);
  });

  it('switching is ONE field on the wire — no key, no list', async () => {
    const { calls, client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');

    const use = screen
      .getAllByTestId('settings-profile-use')
      .find((b) => b.getAttribute('data-profile') === 'local')!;
    fireEvent.click(use);

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    /*
     * THE WHOLE POINT. Sending the list back to change one field would write
     * `••••9f3a` over a working credential, because a mask is the only key
     * material this client has ever held.
     */
    expect(put.body).toEqual({ selectProfileId: 'local' });
  });

  it('the model in use cannot be "switched to" — the control says so instead', async () => {
    const { client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    const active = screen
      .getAllByTestId('settings-profile-use')
      .find((b) => b.getAttribute('data-profile') === 'claude')!;
    expect((active as HTMLButtonElement).disabled).toBe(true);
    expect(active.textContent).toBe('In use');
  });

  it('saving a list NEVER sends a mask back as a key', async () => {
    const { calls, client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    await editSaved('claude');

    fireEvent.change(screen.getByTestId('settings-model'), { target: { value: 'claude-opus-5' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = calls.find((c) => c.method === 'PUT')!.body as {
      profiles: { id: string; model: string; apiKey?: string }[];
      defaultProfileId: string;
    };
    expect(body.profiles).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('••••');
    for (const pr of body.profiles) {
      /* Absent means "keep the key already stored under this id" — the same
         rule the empty key box has always followed, applied to a list. */
      expect(Object.prototype.hasOwnProperty.call(pr, 'apiKey')).toBe(false);
    }
    expect(body.profiles.find((p) => p.id === 'claude')!.model).toBe('claude-opus-5');
    expect(body.defaultProfileId).toBe('claude');
  });

  /* APP-12 contract change: the key is an Anthropic one now, because a key that does not start the way
     its provider's do is held back behind a soft warning (knobValidation.test.tsx). The assertions are unchanged. */
  it('a typed key rides on the edited profile ALONE', async () => {
    const { calls, client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    await editSaved('claude');

    fireEvent.change(screen.getByTestId('settings-apikey'), { target: { value: 'sk-ant-brand-new' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = calls.find((c) => c.method === 'PUT')!.body as {
      profiles: { id: string; apiKey?: string }[];
    };
    expect(body.profiles.find((p) => p.id === 'claude')!.apiKey).toBe('sk-ant-brand-new');
    expect(body.profiles.find((p) => p.id === 'local')!.apiKey).toBeUndefined();
  });

  it('adding another model appends — it does not overwrite the one you had', async () => {
    const { calls, client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');

    fireEvent.click(screen.getByTestId('settings-profile-new'));
    fireEvent.change(screen.getByTestId('settings-name'), { target: { value: 'Fast draft' } });
    fireEvent.change(screen.getByTestId('settings-model'), { target: { value: 'claude-haiku' } });
    fireEvent.change(screen.getByTestId('settings-apikey'), { target: { value: 'sk-h' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = calls.find((c) => c.method === 'PUT')!.body as {
      profiles: { id: string; name: string }[];
      defaultProfileId: string;
    };
    expect(body.profiles).toHaveLength(3);
    expect(body.profiles.map((p) => p.name)).toContain('Fast draft');
    /* Saving a model is choosing it — the form says which model this is. */
    expect(body.profiles.find((p) => p.id === body.defaultProfileId)!.name).toBe('Fast draft');
  });

  it('the last saved model cannot be forgotten', async () => {
    const one = {
      ...(CONFIGURED_WITH_PROFILES as unknown as Record<string, unknown>),
      defaultProfileId: 'local',
      profiles: [(CONFIGURED_WITH_PROFILES as unknown as { profiles: unknown[] }).profiles[0]],
    };
    const { client } = recorder(one);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    const forget = screen.getByTestId('settings-profile-forget') as HTMLButtonElement;
    /* An empty list has no answer to "which model", and silently falling back
       to unconfigured is not what "forget this one" said. */
    expect(forget.disabled).toBe(true);
  });
});

describe('the knobs', () => {
  it('a blank knob sends NO FIELD AT ALL', async () => {
    const { calls, client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    await editSaved('claude');
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = calls.find((c) => c.method === 'PUT')!.body as {
      profiles: Record<string, unknown>[];
    };
    /* Several local servers 400 on a request field they did not expect, so an
       untouched Advanced section must leave the body exactly as it was. */
    for (const pr of body.profiles) {
      expect(Object.prototype.hasOwnProperty.call(pr, 'params')).toBe(false);
    }
  });

  it('a set knob reaches the wire under the name the server validates', async () => {
    const { calls, client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    await editSaved('claude');

    fireEvent.click(screen.getByTestId('settings-advanced-toggle'));
    fireEvent.change(screen.getByTestId('settings-knob-temperature'), { target: { value: '0' } });
    fireEvent.change(screen.getByTestId('settings-knob-timeoutMs'), { target: { value: '120000' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = calls.find((c) => c.method === 'PUT')!.body as {
      profiles: { id: string; params?: Record<string, number> }[];
      defaultProfileId: string;
    };
    const edited = body.profiles.find((p) => p.id === body.defaultProfileId)!;
    expect(edited.params).toEqual({ temperature: 0, timeoutMs: 120000 });
  });

  it('the temperature and top P sliders are real range inputs that write the same value the box does', async () => {
    const { calls, client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    await editSaved('claude');

    fireEvent.click(screen.getByTestId('settings-advanced-toggle'));
    const temp = screen.getByTestId('settings-knob-temperature-slider') as HTMLInputElement;
    expect(temp.type).toBe('range');
    expect([temp.min, temp.max]).toEqual(['0', '2']);
    const topP = screen.getByTestId('settings-knob-topP-slider') as HTMLInputElement;
    expect([topP.min, topP.max]).toEqual(['0', '1']);
    /* A blank box sends nothing, so the slider only RESTS at the provider's usual value. */
    expect((screen.getByTestId('settings-knob-temperature') as HTMLInputElement).value).toBe('');

    fireEvent.change(temp, { target: { value: '0.4' } });
    expect((screen.getByTestId('settings-knob-temperature') as HTMLInputElement).value).toBe('0.4');
    fireEvent.change(topP, { target: { value: '0.9' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = calls.find((c) => c.method === 'PUT')!.body as {
      profiles: { id: string; params?: Record<string, number> }[];
      defaultProfileId: string;
    };
    const edited = body.profiles.find((p) => p.id === body.defaultProfileId)!;
    expect(edited.params).toEqual({ temperature: 0.4, topP: 0.9 });
  });

  it('a knob that is not a number is refused before the round trip (contract change, APP-12: inline error on blur, Save off)', async () => {
    const { calls, client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    await editSaved('claude');

    fireEvent.click(screen.getByTestId('settings-advanced-toggle'));
    fireEvent.change(screen.getByTestId('settings-knob-temperature'), { target: { value: 'hot' } });
    fireEvent.blur(screen.getByTestId('settings-knob-temperature'));

    const error = await screen.findByTestId('settings-knob-temperature-error');
    expect(error.textContent).toBe('Use a number from 0 to 2.');
    expect((screen.getByTestId('settings-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('settings-save'));
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('test this model', () => {
  it('probes the real route and reports what came back', async () => {
    const { calls, client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    await editSaved('claude');

    fireEvent.click(screen.getByTestId('settings-test'));

    const result = await screen.findByTestId('settings-test-result');
    expect(result.getAttribute('data-ok')).toBe('true');
    expect(result.textContent).toMatch(/granite4-hermes:latest/);
    expect(result.textContent).toMatch(/42 ms/);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toContain('/api/ai-config');
    expect(post.body).toEqual({ test: true, profileId: 'claude' });
  });

  it('says what it tested, because the form can be ahead of what is stored', async () => {
    const { client } = recorder(CONFIGURED_WITH_PROFILES);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    openApiKey();
    const hint = await screen.findByTestId('settings-test-hint');
    expect(hint.textContent).toMatch(/what is stored/i);
  });
});

/* Reviewer-reproduced defect: with a local Ollama model active, opening the API key choice showed a form
   prefilled with that model, and Save overwrote it. The API key choice starts a NEW model. */
describe('the API key choice never edits the active model', () => {
  const OLLAMA_ACTIVE = {
    configured: true,
    provider: 'openai-compatible',
    model: 'minicpm5:latest',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultProfileId: 'p1',
    profiles: [
      { id: 'p1', name: 'MINICPM5', provider: 'openai-compatible', model: 'minicpm5:latest', baseUrl: 'http://127.0.0.1:11434/v1' },
    ],
  } as unknown as GetAiConfigResponse;

  it('opens empty, and Save adds a new profile leaving the local one unchanged', async () => {
    const { calls, client } = recorder(OLLAMA_ACTIVE);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    openApiKey();
    expect((screen.getByTestId('settings-name') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('settings-model') as HTMLInputElement).value).toBe('');
    expect((screen.getByTestId('settings-baseurl') as HTMLInputElement).value).not.toMatch(/11434/);

    fireEvent.change(screen.getByTestId('settings-model'), { target: { value: 'gpt-5' } });
    fireEvent.change(screen.getByTestId('settings-apikey'), { target: { value: 'sk-x' } });
    fireEvent.click(screen.getByTestId('settings-save'));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = calls.find((c) => c.method === 'PUT')!.body as { profiles: { id: string; model: string; baseUrl?: string }[] };
    expect(body.profiles).toHaveLength(2);
    const p1 = body.profiles.find((p) => p.id === 'p1')!;
    expect(p1.model).toBe('minicpm5:latest');
    expect(p1.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(body.profiles.find((p) => p.id !== 'p1')!.model).toBe('gpt-5');
  });

  it('the new form does not claim the local model needs no key', async () => {
    const { client } = recorder(OLLAMA_ACTIVE);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    openApiKey();
    expect(screen.getByTestId('settings-key-hint').textContent).not.toMatch(/local model needs no key/i);
  });

  it('Edit on the saved model is still the route that edits it', async () => {
    const { client } = recorder(OLLAMA_ACTIVE);
    render(<SettingsPanel pane="models" client={client} />);
    await editSaved('p1');
    expect((screen.getByTestId('settings-model') as HTMLInputElement).value).toBe('minicpm5:latest');
  });

  it('019-model: the first save keeps the Name the person typed (a one-entry list, not a flat config)', async () => {
    const { calls, client } = recorder({ configured: false });
    render(<SettingsPanel pane="models" client={client} />);
    openApiKey();
    fireEvent.change(await screen.findByTestId('settings-name'), { target: { value: 'Mock local' } });
    fireEvent.change(screen.getByTestId('settings-model'), { target: { value: 'mock-1' } });
    fireEvent.change(screen.getByTestId('settings-baseurl'), { target: { value: 'http://127.0.0.1:9/v1' } });
    fireEvent.click(screen.getByTestId('settings-save'));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!;
    const profiles = (put.body as { profiles?: { id: string; name: string; model: string }[] }).profiles;
    expect(profiles?.[0]).toMatchObject({ id: 'saved-1', name: 'Mock local', model: 'mock-1' });
  });

  it('019-model: a failed test shows the real error text, not only "did not answer"', async () => {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/ai-config') && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: "profileId 'saved-1' names no saved model" }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/hooks')) {
        return new Response(JSON.stringify({ events: [], blocking: [], declared: {}, trusted: false }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (!url.includes('/api/ai-config')) {
        return new Response(JSON.stringify({ path: '', exists: false, text: '', warnings: [], document: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify(CONFIGURED_WITH_PROFILES), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const client = createSettingsClient(fetchImpl);
    render(<SettingsPanel pane="models" client={client} />);
    await screen.findAllByTestId('settings-profile');
    fireEvent.click(screen.getAllByTestId('settings-profile-test')[0]!);
    const note = await screen.findByTestId('settings-profile-test-result');
    expect(note.querySelector('.failure-note-say')?.textContent).toContain("names no saved model");
  });
});
