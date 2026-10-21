/* ══════════════════════════════════════════════════════════════════════════
   APP-12: VALIDATE THE ADVANCED KNOBS ON BLUR, WARN ON A KEY THAT LOOKS WRONG, CONFIRM A SAVE
   packages/web2/src/settings/knobValidation.test.tsx

   Contract change: the pane used to send whatever was typed and let the server decide
   ("Timeout 5" saved silently; the old test only locked a non-number being refused at Save).
   It now checks the shared bounds (@sequence/api-types AI_PARAM_BOUNDS) when the reader leaves
   the box, shows the sentence under it, and keeps Save off until every box is valid.
   ══════════════════════════════════════════════════════════════════════════ */

import { AI_PARAM_BOUNDS } from '@sequence/api-types';
import type { GetAiConfigResponse } from '@sequence/api-types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { KNOBS, keyPrefixWarning, knobMessage, validateKnob } from './knobs';
import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

afterEach(cleanup);

const CONFIGURED = {
  configured: true,
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  apiKey: '••••9f3a',
  defaultProfileId: 'claude',
  profiles: [{ id: 'claude', name: 'Claude', provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: '••••9f3a' }],
} as unknown as GetAiConfigResponse;
const UNCONFIGURED = { configured: false } as GetAiConfigResponse;

function harness(get: unknown) {
  const puts: unknown[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'PUT') puts.push(JSON.parse(String(init.body)));
    const body = url.includes('/api/ai-config')
      ? get
      : { events: [], blocking: [], declared: {}, trusted: false, path: '', exists: false, text: '', warnings: [], document: {} };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { puts, client: createSettingsClient(fetchImpl) };
}

async function openSavedAdvanced() {
  const h = harness(CONFIGURED);
  render(<SettingsPanel pane="models" client={h.client} />);
  fireEvent.click((await screen.findAllByTestId('settings-profile-edit'))[0]!);
  fireEvent.click(screen.getByTestId('settings-advanced-toggle'));
  return h;
}

const box = (key: string) => screen.getByTestId(`settings-knob-${key}`) as HTMLInputElement;
const save = () => screen.getByTestId('settings-save') as HTMLButtonElement;

describe('validateKnob (pure)', () => {
  it('every knob: min and max pass, one past either end fails, blank is absent', () => {
    for (const k of KNOBS) {
      const b = AI_PARAM_BOUNDS[k.key];
      expect(validateKnob(k.key, String(b.min))).toBeNull();
      expect(validateKnob(k.key, String(b.max))).toBeNull();
      expect(validateKnob(k.key, String(b.min - 1))).toBe(knobMessage(k.key));
      expect(validateKnob(k.key, String(b.max + 1))).toBe(knobMessage(k.key));
      expect(validateKnob(k.key, '')).toBeNull();
      expect(validateKnob(k.key, '   ')).toBeNull();
      expect(validateKnob(k.key, 'hot')).toBe(knobMessage(k.key));
      expect(validateKnob(k.key, 'Infinity')).toBe(knobMessage(k.key));
    }
    expect(validateKnob('maxRetries', '1.5')).toBe(knobMessage('maxRetries'));
    expect(validateKnob('temperature', '0.7')).toBeNull();
  });

  it('the copy is the copy table, word for word', () => {
    expect(knobMessage('timeoutMs')).toBe('Use a value from 1,000 to 3,600,000 ms (1 s to 1 h).');
    expect(knobMessage('maxRetries')).toBe('Use 0 to 5 retries.');
  });

  it('key prefix: a mismatch warns, a match and a blank do not, an unknown preset never does', () => {
    expect(keyPrefixWarning('openai', 'abc')).toBe("That doesn't look like an OpenAI key (they start with sk-).");
    expect(keyPrefixWarning('openai', 'sk-abc')).toBeNull();
    expect(keyPrefixWarning('openai', '  ')).toBeNull();
    expect(keyPrefixWarning('other', 'abc')).toBeNull();
    expect(keyPrefixWarning(undefined, 'abc')).toBeNull();
  });
});

describe('the pane (APP-12)', () => {
  it('Timeout 5 on blur: the sentence under the box, aria-invalid, Save off; a valid value clears all three', async () => {
    const { puts } = await openSavedAdvanced();
    fireEvent.change(box('timeoutMs'), { target: { value: '5' } });
    fireEvent.blur(box('timeoutMs'));
    const err = await screen.findByTestId('settings-knob-timeoutMs-error');
    expect(err.textContent).toBe('Use a value from 1,000 to 3,600,000 ms (1 s to 1 h).');
    expect(box('timeoutMs').getAttribute('aria-invalid')).toBe('true');
    expect(box('timeoutMs').getAttribute('aria-describedby')).toBe(err.id);
    expect(save().disabled).toBe(true);
    fireEvent.click(save());
    expect(puts.length).toBe(0);

    fireEvent.change(box('timeoutMs'), { target: { value: '120000' } });
    fireEvent.blur(box('timeoutMs'));
    await waitFor(() => expect(screen.queryByTestId('settings-knob-timeoutMs-error')).toBeNull());
    expect(box('timeoutMs').getAttribute('aria-invalid')).toBeNull();
    expect(save().disabled).toBe(false);
  });

  it('Retries 9 on blur says so; Save stays off while ANY box is invalid', async () => {
    await openSavedAdvanced();
    fireEvent.change(box('maxRetries'), { target: { value: '9' } });
    fireEvent.blur(box('maxRetries'));
    expect((await screen.findByTestId('settings-knob-maxRetries-error')).textContent).toBe('Use 0 to 5 retries.');
    fireEvent.change(box('timeoutMs'), { target: { value: '5' } });
    fireEvent.blur(box('timeoutMs'));
    fireEvent.change(box('maxRetries'), { target: { value: '2' } });
    fireEvent.blur(box('maxRetries'));
    await waitFor(() => expect(screen.queryByTestId('settings-knob-maxRetries-error')).toBeNull());
    expect(save().disabled).toBe(true); // Timeout is still wrong
  });

  it('an invalid box never reaches the wire even if the reader hits Save without leaving it', async () => {
    const { puts } = await openSavedAdvanced();
    fireEvent.change(box('timeoutMs'), { target: { value: '5' } });
    fireEvent.click(save());
    expect(await screen.findByTestId('settings-knob-timeoutMs-error')).toBeTruthy();
    expect(puts.length).toBe(0);
  });

  it('the number boxes are at least 96px wide so 3,600,000 fits', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/settings/settings.css'), 'utf8');
    const rules = css.split('}').filter((r) => r.includes('.sb-input-num'));
    expect(rules.length).toBeGreaterThan(0);
    /* Contract change (visual pass): 96px became 112px so every placeholder fits too; the floor stays 96px. */
    for (const r of rules) expect(Number(/min-width:\s*(\d+)px/.exec(r)?.[1])).toBeGreaterThanOrEqual(96);
  });

  it('a successful save shows Saved ✓ and it clears itself after about 2 s', async () => {
    const { puts } = await openSavedAdvanced();
    fireEvent.change(box('timeoutMs'), { target: { value: '120000' } });
    fireEvent.click(save());
    const saved = await screen.findByTestId('settings-saved');
    expect(saved.textContent).toBe('Saved ✓');
    expect(puts.length).toBe(1);
    await waitFor(() => expect(screen.queryByTestId('settings-saved')).toBeNull(), { timeout: 4000 });
  }, 8000);

  async function openOpenAiForm() {
    const h = harness(UNCONFIGURED);
    render(<SettingsPanel pane="models" client={h.client} />);
    await screen.findByTestId('settings-unconfigured');
    const door = screen.getAllByTestId('settings-choice').find((c) => c.getAttribute('data-choice') === 'key')!;
    fireEvent.click(door.querySelector('[data-testid="settings-choice-toggle"]')!);
    fireEvent.click(screen.getAllByTestId('settings-preset').find((b) => b.getAttribute('data-preset') === 'openai')!);
    fireEvent.change(screen.getByTestId('settings-model'), { target: { value: 'gpt-x' } });
    return h;
  }

  it('a key that does not start with sk- warns with Save anyway; Save alone does not send it', async () => {
    const { puts } = await openOpenAiForm();
    fireEvent.change(screen.getByTestId('settings-apikey'), { target: { value: 'abc123' } });
    fireEvent.click(save());
    const warn = await screen.findByTestId('settings-key-warning');
    expect(warn.textContent).toContain("That doesn't look like an OpenAI key (they start with sk-).");
    expect(puts.length).toBe(0);
    fireEvent.click(screen.getByTestId('settings-key-save-anyway'));
    await waitFor(() => expect(puts.length).toBe(1));
  });

  it('a key that starts with sk- shows no warning and saves at once', async () => {
    const { puts } = await openOpenAiForm();
    fireEvent.change(screen.getByTestId('settings-apikey'), { target: { value: 'sk-abc123' } });
    fireEvent.blur(screen.getByTestId('settings-apikey'));
    expect(screen.queryByTestId('settings-key-warning')).toBeNull();
    fireEvent.click(save());
    await waitFor(() => expect(puts.length).toBe(1));
  });
});
