/* ══════════════════════════════════════════════════════════════════════════
   NICKNAMES, WHERE THE ROWS ARE READ
   packages/web2/src/settings/modelNicknames.test.tsx

   Max, 2026-09-12: "adapt the same chat-like settings and setups from ML
   Harness regarding model selection, nicknames and selection."

   The defect being ported out of ml-harness is his, reported there with nine
   models connected: seven rows, six of them reading `Ollama`. Two fixes travel
   together and both are locked here — a default name derived from the MODEL
   rather than the endpoint (`chat/modelNames.ts`), and a rename that happens
   where the name is read rather than three screens away.

   ml-harness `ConnectModel.tsx:Nickname` states the four rules, and they are
   the assertions below: Enter and blur save, Escape abandons, an EMPTY name is
   a no-op rather than a row with nothing on it, and a save the server refused
   KEEPS THE BOX OPEN WITH WHAT WAS TYPED. The last one is the one worth a test:
   discarding somebody's words because a request failed is the single thing this
   control must not do, and it is exactly what a naive implementation does.
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

/** What the real server answers once two models are saved. Keys are MASKS. */
const SAVED = {
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

function recorder(putStatus = 200, putBody: unknown = SAVED) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
    calls.push({ method, url, body });
    if (!url.includes('/api/ai-config')) {
      if (url.includes('/api/hooks')) {
        return new Response(
          JSON.stringify({ events: [], blocking: [], declared: {}, trusted: false }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ path: '', exists: false, text: '', warnings: [], document: {} }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (method === 'PUT') {
      return new Response(JSON.stringify(putBody), {
        status: putStatus,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (method === 'POST') {
      return new Response(
        JSON.stringify({ ok: true, model: 'granite4-hermes:latest', ms: 42, sample: 'ok' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify(SAVED), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { calls, client: createSettingsClient(fetchImpl) };
}

async function openTheBox(profile: string) {
  await screen.findAllByTestId('settings-profile');
  fireEvent.click(
    screen
      .getAllByTestId('settings-profile-rename')
      .find((b) => b.getAttribute('data-profile') === profile)!,
  );
  return screen.getByTestId('settings-profile-rename-input') as HTMLInputElement;
}

describe('renaming a saved model where its name is read', () => {
  it('the name IS the control, and Enter writes the whole list back', async () => {
    const { calls, client } = recorder();
    render(<SettingsPanel client={client} />);

    const box = await openTheBox('local');
    expect(box.value).toBe('Local, cheap');
    fireEvent.change(box, { target: { value: '  Fast draft  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const body = calls.find((c) => c.method === 'PUT')!.body as {
      profiles: { id: string; name: string; apiKey?: string }[];
      defaultProfileId: string;
    };
    expect(body.profiles.find((pr) => pr.id === 'local')!.name).toBe('Fast draft');
    /* Every other profile goes back UNCHANGED, and no mask ever rides the wire
       as a credential — sending one back is how a rename used to destroy a key. */
    expect(body.profiles.find((pr) => pr.id === 'claude')!.name).toBe('Claude, hard edits');
    expect(JSON.stringify(body)).not.toContain('••••');
    for (const pr of body.profiles) {
      expect(Object.prototype.hasOwnProperty.call(pr, 'apiKey')).toBe(false);
    }
    /* Renaming is not choosing. Which model answers is untouched. */
    expect(body.defaultProfileId).toBe('claude');
  });

  it('blur saves too — leaving the box is finishing with it', async () => {
    const { calls, client } = recorder();
    render(<SettingsPanel client={client} />);

    const box = await openTheBox('local');
    fireEvent.change(box, { target: { value: 'Fast draft' } });
    fireEvent.blur(box);

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
  });

  it('A REFUSED SAVE KEEPS THE BOX OPEN WITH WHAT WAS TYPED', async () => {
    const { client } = recorder(403, { error: 'the config file is read-only' });
    render(<SettingsPanel client={client} />);

    const box = await openTheBox('local');
    fireEvent.change(box, { target: { value: 'Fast draft' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    /* The server's own words, and the reader's own words, both still on screen.
       Throwing away a name because a request failed makes the reader type it
       twice to find out the second one fails as well. */
    await waitFor(() =>
      expect(screen.getByTestId('settings-failure').textContent).toContain('read-only'),
    );
    expect((screen.getByTestId('settings-profile-rename-input') as HTMLInputElement).value).toBe(
      'Fast draft',
    );
  });

  it('an EMPTY name is a no-op — never a row with nothing written on it', async () => {
    const { calls, client } = recorder();
    render(<SettingsPanel client={client} />);

    const box = await openTheBox('local');
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() => expect(screen.queryByTestId('settings-profile-rename-input')).toBeNull());
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(
      screen
        .getAllByTestId('settings-profile-rename')
        .find((b) => b.getAttribute('data-profile') === 'local')!.textContent,
    ).toBe('Local, cheap');
  });

  it('Escape abandons, and writes nothing', async () => {
    const { calls, client } = recorder();
    render(<SettingsPanel client={client} />);

    const box = await openTheBox('local');
    fireEvent.change(box, { target: { value: 'whatever' } });
    fireEvent.keyDown(box, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId('settings-profile-rename-input')).toBeNull());
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('the same name is not a change, and costs no round trip', async () => {
    const { calls, client } = recorder();
    render(<SettingsPanel client={client} />);

    const box = await openTheBox('local');
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() => expect(screen.queryByTestId('settings-profile-rename-input')).toBeNull());
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });
});

describe('the card says what the model actually is', () => {
  it('one meta line: who serves it, where, and whether a key is stored', async () => {
    const { client } = recorder();
    render(<SettingsPanel client={client} />);
    await screen.findAllByTestId('settings-profile');

    const metas = screen.getAllByTestId('settings-profile-meta');
    const local = metas[0]!.textContent ?? '';
    expect(local).toContain('openai-compatible');
    /* The HOST, not the whole URL — `/v1` is on every row and distinguishes
       nothing, which is the same reason `:latest` comes off a model id. */
    expect(local).toContain('127.0.0.1:11434');
    expect(local).toContain('no key stored');

    const claude = metas[1]!.textContent ?? '';
    expect(claude).toContain('anthropic');
    expect(claude).toContain('key stored');
    /* NAMED AS PRESENT, NEVER SHOWN. Not even the mask reaches this line. */
    expect(claude).not.toContain('••••');
  });

  it('Forget asks first, on the row it is about', async () => {
    const { calls, client } = recorder();
    render(<SettingsPanel client={client} />);
    await screen.findAllByTestId('settings-profile');

    fireEvent.click(
      screen
        .getAllByTestId('settings-profile-forget')
        .find((b) => b.getAttribute('data-profile') === 'local')!,
    );
    /* Nothing is gone yet — the question is the whole point of the control. */
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    expect(screen.getByTestId('settings-profile-confirm').textContent).toContain('Local, cheap');

    fireEvent.click(screen.getByTestId('settings-profile-forget-no'));
    expect(screen.queryByTestId('settings-profile-confirm')).toBeNull();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('Test probes ONE saved model and prints what came back', async () => {
    const { calls, client } = recorder();
    render(<SettingsPanel client={client} />);
    await screen.findAllByTestId('settings-profile');

    fireEvent.click(
      screen
        .getAllByTestId('settings-profile-test')
        .find((b) => b.getAttribute('data-profile') === 'local')!,
    );

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ test: true, profileId: 'local' });
    const said = await screen.findByTestId('settings-profile-test-result');
    expect(said.textContent).toContain('42 ms');
  });
});
