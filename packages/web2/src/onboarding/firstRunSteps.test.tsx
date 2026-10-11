import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUTONOMY_AUTO_EDIT_KEY } from '../settings/autonomyPreference';
import type { SettingsClient } from '../settings/settingsClient';
import { FirstRun } from './FirstRun';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';

/* Round 13 (O1, O2): the local model and API key routes, and the swipe-style setup. */

const PROVIDERS: ProviderStatus[] = [
  { id: 'claude', label: 'Claude Code', installed: true, version: '2', state: 'ready', plan: 'Max', signInCommand: 'claude auth login', installHint: 'npm i -g x' },
];
const onboarding: OnboardingClient = {
  providers: async () => ({ ok: true, body: PROVIDERS }),
  repos: async () => ({ ok: true, body: { repos: [], truncated: false } }),
};

function settingsFake(local: unknown[] = []) {
  const writes: unknown[] = [];
  const selects: string[] = [];
  const client = {
    read: vi.fn(async () => ({ outcome: 'ok' as const, body: { configured: false, localProviders: local, profiles: [] } })),
    write: vi.fn(async (d: unknown) => {
      writes.push(d);
      return { outcome: 'ok' as const, body: {} };
    }),
    selectProfile: vi.fn(async (id: string) => {
      selects.push(id);
      return { outcome: 'ok' as const, body: {} };
    }),
  } as unknown as SettingsClient;
  return { client, writes, selects };
}

const open = async (route: string) =>
  fireEvent.click((await screen.findAllByTestId('first-run-option')).find((o) => o.getAttribute('data-option') === route)!);

afterEach(() => window.localStorage.clear());

describe('Local model', () => {
  it('lists Ollama and LM Studio one per line; a detected one is one click to use, named after its model', async () => {
    const s = settingsFake([{ name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen3:4b'] }]);
    render(<FirstRun client={onboarding} settings={s.client} onDone={() => {}} />);
    await open('local');
    const rows = await screen.findAllByTestId('first-run-local-row');
    expect(rows.map((r) => r.getAttribute('data-preset'))).toEqual(['ollama', 'lm-studio']);
    await waitFor(() => expect(rows[0]!.getAttribute('data-found')).toBe('true'));
    expect(rows[1]!.getAttribute('data-found')).toBe('false');
    expect(rows[1]!.querySelector('[data-testid="first-run-local-use"]')).toBeNull();
    fireEvent.click(rows[0]!.querySelector('[data-testid="first-run-local-use"]')!);
    await screen.findByTestId('first-run-model-ready');
    const sent = s.writes[0] as { profiles: { name: string; model: string; baseUrl: string }[]; defaultProfileId: string };
    expect(sent.profiles[0]).toMatchObject({ name: 'qwen3:4b', model: 'qwen3:4b', baseUrl: 'http://127.0.0.1:11434/v1' });
    expect(s.selects).toEqual(['saved-1']);
    expect(JSON.stringify(sent)).not.toMatch(/daily|cheap|"local"/i);
    fireEvent.click(screen.getByTestId('first-run-start'));
    expect(await screen.findByTestId('first-run-setup')).toBeTruthy();
  });
});

describe('connected is reported at once (a reload mid-setup)', () => {
  it('a saved local model calls onConnected before the setup', async () => {
    const s = settingsFake([{ name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', models: ['qwen3:4b'] }]);
    const onConnected = vi.fn();
    render(<FirstRun client={onboarding} settings={s.client} onDone={() => {}} onConnected={onConnected} />);
    await open('local');
    const use = await screen.findByTestId('first-run-local-use');
    expect(onConnected).not.toHaveBeenCalled();
    fireEvent.click(use);
    await screen.findByTestId('first-run-model-ready');
    expect(onConnected).toHaveBeenCalledTimes(1);
  });
});

describe('API key', () => {
  it('OpenAI, Anthropic, OpenRouter and Other OpenAI-compatible; saves a profile named after the model', async () => {
    const s = settingsFake();
    render(<FirstRun client={onboarding} settings={s.client} onDone={() => {}} />);
    await open('key');
    const presets = await screen.findAllByTestId('first-run-key-preset');
    expect(presets.map((p) => p.textContent)).toEqual(['OpenAI', 'Anthropic', 'OpenRouter', 'Other OpenAI-compatible']);
    fireEvent.click(presets[1]!);
    expect(screen.getByTestId('first-run-key-save').hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByTestId('first-run-key-key'), { target: { value: 'sk-ant-1' } });
    fireEvent.change(screen.getByTestId('first-run-key-model'), { target: { value: 'claude-sonnet-4-5' } });
    fireEvent.click(screen.getByTestId('first-run-key-save'));
    await screen.findByTestId('first-run-model-ready');
    const sent = s.writes[0] as { profiles: Record<string, string>[] };
    expect(sent.profiles[0]).toMatchObject({ name: 'claude-sonnet-4-5', provider: 'anthropic', apiKey: 'sk-ant-1', baseUrl: 'https://api.anthropic.com' });
  });

  it('Other asks for the server address', async () => {
    render(<FirstRun client={onboarding} settings={settingsFake().client} onDone={() => {}} />);
    await open('key');
    expect(screen.queryByTestId('first-run-key-url')).toBeNull();
    fireEvent.click((await screen.findAllByTestId('first-run-key-preset'))[3]!);
    expect(screen.getByTestId('first-run-key-url')).toBeTruthy();
  });
});

describe('the swipe-style setup', () => {
  async function toSetup() {
    const onDone = vi.fn();
    render(<FirstRun client={onboarding} settings={settingsFake().client} onDone={onDone} />);
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () => new Response('{"agents":[]}')) as unknown as typeof fetch);
    await open('claude');
    fireEvent.click(await screen.findByTestId('first-run-start'));
    await screen.findByTestId('first-run-setup');
    return onDone;
  }
  afterEach(() => vi.restoreAllMocks());

  it('four cards: project, auto mode, skills, done; the card on screen holds focus', async () => {
    const onDone = await toSetup();
    const setup = screen.getByTestId('first-run-setup');
    expect(setup.getAttribute('data-step')).toBe('0');
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('first-run-setup-project-yes'));
    /* The other cards cannot take focus while they are off screen. */
    expect(setup.querySelector('[data-card="1"]')!.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByTestId('first-run-setup-project-yes'));
    expect(setup.getAttribute('data-step')).toBe('1');
    await waitFor(() => expect(document.activeElement?.getAttribute('data-testid')).toBe('first-run-setup-trust-yes'));
    fireEvent.click(screen.getByTestId('first-run-setup-trust-yes'));
    expect(window.localStorage.getItem(AUTONOMY_AUTO_EDIT_KEY)).toBe('on');
    expect(setup.getAttribute('data-step')).toBe('2');
    fireEvent.click(screen.getByTestId('first-run-skills-skip'));
    expect(setup.getAttribute('data-step')).toBe('3');
    fireEvent.click(screen.getByTestId('first-run-setup-done-go'));
    expect(onDone).toHaveBeenCalledWith(true, { openProject: true, autoMode: true });
  });

  it('Skip and No change nothing; Back and the left arrow go back a card', async () => {
    const onDone = await toSetup();
    fireEvent.click(screen.getByTestId('first-run-setup-project-no'));
    fireEvent.click(screen.getByTestId('first-run-setup-trust-no'));
    expect(window.localStorage.getItem(AUTONOMY_AUTO_EDIT_KEY)).toBeNull();
    fireEvent.click(screen.getByTestId('first-run-skills-skip'));
    expect(screen.getByTestId('first-run-setup').getAttribute('data-step')).toBe('3');
    fireEvent.keyDown(screen.getByTestId('first-run-setup'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('first-run-setup').getAttribute('data-step')).toBe('2');
    fireEvent.click(screen.getByTestId('first-run-setup-back'));
    expect(screen.getByTestId('first-run-setup').getAttribute('data-step')).toBe('1');
    fireEvent.click(screen.getByTestId('first-run-setup-back'));
    expect(screen.getByTestId('first-run-setup').getAttribute('data-step')).toBe('0');
    fireEvent.click(screen.getByTestId('first-run-setup-skipall'));
    expect(onDone).toHaveBeenCalledWith(true);
  });
});
