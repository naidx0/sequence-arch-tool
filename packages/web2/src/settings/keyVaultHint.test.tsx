/* APP-11: the key hint says where the key goes, before Save, in Settings and in first-run. */
import type { GetAiConfigResponse } from '@sequence/api-types';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { KeyPanel } from '../onboarding/FirstRunModels';
import { keyVaultHint } from './keyVaultState';
import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

const PLAIN_PATH = '/home/max/.sequence/ai.json';

function setBridge(v: unknown) {
  (window as unknown as { sequence?: unknown }).sequence = v;
}
afterEach(() => {
  cleanup();
  setBridge(undefined);
});

const SEALED_SENTENCE = 'Stored in your system keychain.';
const plainSentence = (p: string) => `No system keychain found. Stored unencrypted in ${p}, readable only by your user.`;

function settingsClient() {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/api/ai-config')
      ? ({ configured: false } as GetAiConfigResponse)
      : { events: [], blocking: [], declared: {}, trusted: false, path: '', exists: false, text: '', warnings: [], document: {} };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return createSettingsClient(fetchImpl);
}

async function openKeyForm() {
  render(<SettingsPanel pane="models" client={settingsClient()} />);
  await screen.findByTestId('settings-unconfigured');
  const door = screen.getAllByTestId('settings-choice').find((c) => c.getAttribute('data-choice') === 'key')!;
  fireEvent.click(door.querySelector('[data-testid="settings-choice-toggle"]')!);
  fireEvent.click(screen.getAllByTestId('settings-preset').find((b) => b.getAttribute('data-preset') === 'openai')!);
}

describe('the sentence (pure)', () => {
  it('sealed and plain', () => {
    expect(keyVaultHint({ state: 'sealed', path: null })).toBe(SEALED_SENTENCE);
    expect(keyVaultHint({ state: 'plain', path: PLAIN_PATH })).toBe(plainSentence(PLAIN_PATH));
  });
});

describe('Settings key hint', () => {
  it('sealed: says the system keychain', async () => {
    setBridge({ keyVault: async () => ({ state: 'sealed', path: null }) });
    await openKeyForm();
    await screen.findByText(SEALED_SENTENCE);
    expect(screen.getByTestId('settings-key-hint').textContent).toContain(SEALED_SENTENCE);
  });

  it('plain: names the real path the vault uses', async () => {
    setBridge({ keyVault: async () => ({ state: 'plain', path: PLAIN_PATH }) });
    await openKeyForm();
    await screen.findByText(plainSentence(PLAIN_PATH), { exact: false });
    expect(screen.getByTestId('settings-key-hint').textContent).toContain(plainSentence(PLAIN_PATH));
  });

  it('browser mode (no bridge) always shows the plain sentence', async () => {
    await openKeyForm();
    expect((await screen.findByTestId('settings-key-hint')).textContent).toContain(plainSentence('~/.sequence/ai.json'));
    expect(screen.queryByText(SEALED_SENTENCE)).toBeNull();
  });

  it('a bridge that fails is plain, never sealed', async () => {
    setBridge({
      keyVault: async () => {
        throw new Error('no');
      },
    });
    await openKeyForm();
    expect((await screen.findByTestId('settings-key-hint')).textContent).toContain('No system keychain found.');
  });

  it('the old claim is gone', async () => {
    await openKeyForm();
    expect(document.body.textContent).not.toContain('Saved on this machine only');
  });
});

describe('first-run key hint', () => {
  const stub = {} as never;
  it('sealed', async () => {
    setBridge({ keyVault: async () => ({ state: 'sealed', path: null }) });
    render(<KeyPanel settings={stub} onReady={() => {}} />);
    expect((await screen.findByTestId('first-run-key-hint')).textContent).toBe(SEALED_SENTENCE);
  });
  it('plain with the real path', async () => {
    setBridge({ keyVault: async () => ({ state: 'plain', path: PLAIN_PATH }) });
    render(<KeyPanel settings={stub} onReady={() => {}} />);
    expect((await screen.findByTestId('first-run-key-hint')).textContent).toBe(plainSentence(PLAIN_PATH));
  });
  it('browser mode: plain', async () => {
    render(<KeyPanel settings={stub} onReady={() => {}} />);
    expect((await screen.findByTestId('first-run-key-hint')).textContent).toBe(plainSentence('~/.sequence/ai.json'));
  });
});
