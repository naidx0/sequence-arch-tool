/* ══════════════════════════════════════════════════════════════════════════
   THE COMPOSER'S MODEL CHIP IS A PICKER
   packages/web2/src/chat/modelPicker.test.tsx

   THE DEFECT. The chip drew a chevron — sheet 12.4 always drew one — and
   clicking it opened the WHOLE Settings dialog. Its own source said why:
   `modelSelection.ts` — "IT IS NOT A PICKER. A menu needs a LIST of models, and
   no route serves one"; `composerModel.ts` — "A submenu of alternate models has
   no wire source… so the honest door is the settings pane, not a fake picker".
   Both were true, and both were describing a missing route rather than a
   missing menu.

   `/api/ai-config` serves `profiles` now. So the menu is real, and the rule the
   old comments were defending is the thing these tests enforce: NO LIST, NO
   MENU ROWS — never a fabricated one.
   ══════════════════════════════════════════════════════════════════════════ */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Composer } from './Composer';
import { composerHandlers, composerSlice } from './fixtures';
import { createModelPicker, profilesFromConfig, type ModelPickerPort } from './modelPicker';

/** The shape the real GET answers with once two models are saved. */
const CONFIG_BODY = {
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
    { id: 'claude', name: 'Claude, hard edits', provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: '••••9f3a' },
  ],
};

describe('profilesFromConfig', () => {
  it('reads the saved models and names which one answers', () => {
    const rows = profilesFromConfig(CONFIG_BODY);
    expect(rows.map((r) => r.id)).toEqual(['local', 'claude']);
    expect(rows.find((r) => r.id === 'claude')!.active).toBe(true);
    expect(rows.find((r) => r.id === 'local')!.active).toBe(false);
  });

  it('anything unrecognised is an EMPTY list, never a guessed row', () => {
    /* A row in this menu claims that picking it will change who answers. A
       wrong one is worse than none — the same rule `modelFromConfig` follows. */
    expect(profilesFromConfig(null)).toEqual([]);
    expect(profilesFromConfig({ configured: false })).toEqual([]);
    expect(profilesFromConfig({ configured: true, model: 'm' })).toEqual([]);
    expect(profilesFromConfig({ configured: true, profiles: 'nope' })).toEqual([]);
  });

  it('the free hosted default is not a saved model', () => {
    expect(profilesFromConfig({ configured: true, mode: 'default', model: 'free', profiles: [] })).toEqual([]);
  });

  it('every row carries the nickname AND the wire id, as two facts', () => {
    const row = profilesFromConfig(CONFIG_BODY).find((r) => r.id === 'local')!;
    expect(row.nickname).toBe('Local, cheap');
    expect(row.model).toBe('granite4-hermes:latest');
    expect(row.provider).toBe('openai-compatible');
    expect(row.active).toBe(false);
  });

  it('an UNNAMED profile wears the default derived from its model, not its endpoint', () => {
    /*
     * The owner's report against ml-harness, with nine models set up: seven
     * rows and six of them read `Ollama`. A name taken from the endpoint is the
     * same string for every local model, so the list that exists to tell them
     * apart told them apart by nothing.
     */
    const rows = profilesFromConfig({
      configured: true,
      defaultProfileId: 'a',
      profiles: [
        { id: 'a', provider: 'openai-compatible', model: 'hf.co/prism-ml/Bonsai-27B-gguf' },
        { id: 'b', name: '   ', provider: 'openai-compatible', model: 'granite4-hermes:latest' },
      ],
    });
    expect(rows.map((r) => r.nickname)).toEqual(['Bonsai-27B-gguf', 'granite4-hermes']);
  });
});

describe('createModelPicker', () => {
  it('switches with ONE field and never sends a key', async () => {
    const calls: { method: string; body: unknown }[] = [];
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({ ...CONFIG_BODY, model: 'granite4-hermes:latest' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const answer = await createModelPicker(fetchImpl).select('local');
    expect(answer).toEqual({ outcome: 'ok', model: 'granite4-hermes:latest' });
    expect(calls[0]!.body).toEqual({ selectProfileId: 'local' });
  });

  it('a switch the server did not confirm is NOT reported as done', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ configured: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const answer = await createModelPicker(fetchImpl).select('local');
    expect(answer.outcome).toBe('error');
  });

  it('a rename sends the WHOLE list back with the masked key untouched', async () => {
    /*
     * `profiles` is the file's meaning, so a partial list is a deletion — the
     * rename has to put every other profile back. It puts the MASK back with
     * them, deliberately: the server's `mergeStoredProfileKeys` recognises
     * `••••`+last4 as "unchanged" and re-attaches the stored key by id. That
     * path exists because editing a profile's NAME used to destroy its key.
     */
    const calls: { method: string; body: unknown }[] = [];
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify(CONFIG_BODY), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const answer = await createModelPicker(fetchImpl).rename('local', '  Fast draft  ');
    expect(answer.outcome).toBe('ok');

    const put = calls.find((c) => c.method === 'PUT')!;
    const body = put.body as {
      profiles: { id: string; name: string; apiKey?: string }[];
      defaultProfileId: string;
    };
    expect(body.profiles).toHaveLength(2);
    expect(body.profiles.find((pr) => pr.id === 'local')!.name).toBe('Fast draft');
    /* UNCHANGED — name, key and all. */
    expect(body.profiles.find((pr) => pr.id === 'claude')!.name).toBe('Claude, hard edits');
    expect(body.profiles.find((pr) => pr.id === 'claude')!.apiKey).toBe('••••9f3a');
    expect(body.profiles.find((pr) => pr.id === 'local')!.apiKey).toBeUndefined();
    /* Which model answers is NOT this request's business. */
    expect(body.defaultProfileId).toBe('claude');
  });

  it('an EMPTY name is refused before the wire — it is not a rename', async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init?.method ?? 'GET');
      return new Response(JSON.stringify(CONFIG_BODY), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const answer = await createModelPicker(fetchImpl).rename('local', '   ');
    expect(answer.outcome).toBe('error');
    /* A row with nothing written on it is worse than a repeated one, and a
       round trip that could only produce one is not worth making. */
    expect(calls).toEqual([]);
  });

  it('reports the server refusal verbatim', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: "selectProfileId 'x' names no saved model" }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    const answer = await createModelPicker(fetchImpl).select('x');
    expect(answer).toEqual({
      outcome: 'error',
      message: "selectProfileId 'x' names no saved model",
    });
  });
});

function picker(overrides: Partial<ModelPickerPort> = {}): ModelPickerPort {
  return {
    list: async () => ({ outcome: 'ok', profiles: profilesFromConfig(CONFIG_BODY) }),
    select: async () => ({ outcome: 'ok', model: 'granite4-hermes:latest' }),
    rename: async (id, nickname) => ({
      outcome: 'ok',
      profiles: profilesFromConfig(CONFIG_BODY).map((row) =>
        row.id === id ? { ...row, nickname } : row,
      ),
    }),
    ...overrides,
  };
}

describe('the model chip', () => {
  it('opens a MENU rather than the whole Settings dialog', async () => {
    const onToolbeltPick = vi.fn();
    render(
      <Composer
        {...composerHandlers({ onToolbeltPick })}
        composer={composerSlice({ draft: '' })}
        modelPicker={picker()}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-model'));

    /* THE DEFECT, locked: this used to be the ONLY behaviour of the chip. */
    expect(onToolbeltPick).not.toHaveBeenCalled();
    await screen.findByTestId('composer-model-menu');
    const options = await screen.findAllByTestId('composer-model-option');
    expect(options.map((o) => o.getAttribute('data-profile'))).toEqual(['local', 'claude']);
    expect(options.find((o) => o.getAttribute('data-profile') === 'claude')!.getAttribute('data-active')).toBe('true');
  });

  it('picking a model switches it and renames the chip to the CONFIRMED model, by its nickname', async () => {
    const select = vi.fn(async () => ({ outcome: 'ok' as const, model: 'granite4-hermes:latest' }));
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({ draft: '' })}
        modelPicker={picker({ select })}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-model'));
    const options = await screen.findAllByTestId('composer-model-option');
    fireEvent.click(options.find((o) => o.getAttribute('data-profile') === 'local')!);

    await waitFor(() => expect(select).toHaveBeenCalledWith('local'));
    /*
     * The label names the model the SERVER confirmed. Leaving the old name up
     * would be the chip lying about who is about to answer.
     *
     * IT NAMES IT BY THE READER'S OWN WORD FOR IT, since 2026-09-13. Owner:
     * "when you add a nickname to a model, in your chat box it should show the
     * nickname, not the model direct signature." This case used to assert the
     * wire id `granite4-hermes:latest` was in the label; the claim it was
     * really making — the chip names the model the server confirmed, not the
     * one that was there before — is unchanged and asserted twice below, once
     * on the visible name and once on the id that is still one hover away.
     */
    const chip = () => screen.getByTestId('composer-model');
    await waitFor(() => expect(chip().textContent).toContain('Local, cheap'));
    expect(chip().textContent).not.toContain('Bonsai');
    /* The wire id is never lost — it is what the nickname is a nickname FOR. */
    expect(chip().getAttribute('title')).toContain('granite4-hermes:latest');
    expect(screen.queryByTestId('composer-model-menu')).toBeNull();
  });

  it('a failed read SAYS SO instead of drawing an empty menu', async () => {
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({ draft: '' })}
        modelPicker={picker({ list: async () => ({ outcome: 'error', message: 'forbidden' }) })}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-model'));
    /* An empty menu after a FAILED read is indistinguishable from one with
       nothing to draw, and the two need different actions from the reader. */
    const failure = await screen.findByTestId('composer-model-failure');
    expect(failure.textContent).toBe('forbidden');
    expect(screen.queryAllByTestId('composer-model-option')).toHaveLength(0);
  });

  it('renames at the point of choice — Enter saves, and the row keeps the new name', async () => {
    const rename = vi.fn(async (id: string, nickname: string) => ({
      outcome: 'ok' as const,
      profiles: profilesFromConfig(CONFIG_BODY).map((row) =>
        row.id === id ? { ...row, nickname } : row,
      ),
    }));
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({ draft: '' })}
        modelPicker={picker({ rename })}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-model'));
    const pencil = (await screen.findAllByTestId('composer-model-rename')).find(
      (b) => b.getAttribute('data-profile') === 'local',
    )!;
    fireEvent.click(pencil);

    const box = screen.getByTestId('composer-model-rename-input') as HTMLInputElement;
    expect(box.value).toBe('Local, cheap');
    fireEvent.change(box, { target: { value: 'Fast draft' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    await waitFor(() => expect(rename).toHaveBeenCalledWith('local', 'Fast draft'));
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('composer-model-option')
          .find((o) => o.getAttribute('data-profile') === 'local')!.textContent,
      ).toContain('Fast draft'),
    );
  });

  it('a REFUSED rename keeps the box open with what was typed', async () => {
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({ draft: '' })}
        modelPicker={picker({
          rename: async () => ({ outcome: 'error', message: 'the config file is read-only' }),
        })}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-model'));
    fireEvent.click(
      (await screen.findAllByTestId('composer-model-rename')).find(
        (b) => b.getAttribute('data-profile') === 'local',
      )!,
    );
    const box = screen.getByTestId('composer-model-rename-input') as HTMLInputElement;
    fireEvent.change(box, { target: { value: 'Fast draft' } });
    fireEvent.keyDown(box, { key: 'Enter' });

    /* Discarding somebody's words because a request failed is the one thing
       this control must not do. */
    await screen.findByTestId('composer-model-failure');
    expect((screen.getByTestId('composer-model-rename-input') as HTMLInputElement).value).toBe(
      'Fast draft',
    );
  });

  it('an EMPTY name is a no-op, and Escape abandons', async () => {
    const rename = vi.fn(async () => ({ outcome: 'ok' as const, profiles: [] }));
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({ draft: '' })}
        modelPicker={picker({ rename })}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-model'));
    fireEvent.click(
      (await screen.findAllByTestId('composer-model-rename')).find(
        (b) => b.getAttribute('data-profile') === 'local',
      )!,
    );
    const box = screen.getByTestId('composer-model-rename-input') as HTMLInputElement;
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByTestId('composer-model-rename-input')).toBeNull());
    expect(rename).not.toHaveBeenCalled();

    /* And Escape puts the old name back without writing anything. */
    fireEvent.click(
      screen.getAllByTestId('composer-model-rename').find(
        (b) => b.getAttribute('data-profile') === 'local',
      )!,
    );
    const again = screen.getByTestId('composer-model-rename-input') as HTMLInputElement;
    fireEvent.change(again, { target: { value: 'whatever' } });
    fireEvent.keyDown(again, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('composer-model-rename-input')).toBeNull());
    expect(rename).not.toHaveBeenCalled();
    expect(
      screen
        .getAllByTestId('composer-model-option')
        .find((o) => o.getAttribute('data-profile') === 'local')!.textContent,
    ).toContain('Local, cheap');
  });

  it('the menu names the model under the nickname, and the door says Manage', async () => {
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({ draft: '' })}
        modelPicker={picker()}
      />,
    );
    fireEvent.click(screen.getByTestId('composer-model'));
    const row = (await screen.findAllByTestId('composer-model-option')).find(
      (o) => o.getAttribute('data-profile') === 'local',
    )!;
    /* Two facts, two lines: the name alone cannot be checked against what is
       configured, and the id alone is a wire string. */
    expect(row.textContent).toContain('Local, cheap');
    expect(row.textContent).toContain('granite4-hermes:latest');
    expect(screen.getByTestId('composer-model-settings').textContent).toContain('Manage models');
  });

  it('keeps the door to Settings as a row, for managing rather than choosing', async () => {
    const onToolbeltPick = vi.fn();
    render(
      <Composer
        {...composerHandlers({ onToolbeltPick })}
        composer={composerSlice({ draft: '' })}
        modelPicker={picker()}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-model'));
    fireEvent.click(await screen.findByTestId('composer-model-settings'));
    expect(onToolbeltPick).toHaveBeenCalledWith('models');
  });

  it('no saved models ⇒ no invented rows, just the Settings door', async () => {
    render(
      <Composer
        {...composerHandlers()}
        composer={composerSlice({ draft: '' })}
        modelPicker={picker({ list: async () => ({ outcome: 'ok', profiles: [] }) })}
      />,
    );

    fireEvent.click(screen.getByTestId('composer-model'));
    await screen.findByTestId('composer-model-settings');
    expect(screen.queryAllByTestId('composer-model-option')).toHaveLength(0);
  });
});
