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

  it('picking a model switches it and renames the chip to what the server confirmed', async () => {
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
    /* The label names the model the SERVER confirmed. Leaving the old name up
       would be the chip lying about who is about to answer. */
    await waitFor(() =>
      expect(screen.getByTestId('composer-model').textContent).toContain('granite4-hermes:latest'),
    );
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
