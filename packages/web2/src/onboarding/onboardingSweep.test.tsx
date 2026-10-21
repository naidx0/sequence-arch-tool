import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import css from './onboarding.css?raw';
import { FirstRun } from './FirstRun';
import { providerSentence, type OnboardingClient, type ProviderStatus } from './onboardingClient';

const PROVIDERS: ProviderStatus[] = [
  { id: 'claude', label: 'Claude Code', installed: true, version: '2', state: 'ready', plan: 'Max', signInCommand: 'claude auth login', installHint: 'x' },
];
const client: OnboardingClient = {
  providers: async () => ({ ok: true, body: PROVIDERS }),
  repos: async () => ({ ok: true, body: { repos: [], truncated: false } }),
};

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('welcome sweep (item 6)', () => {
  it('the API key option carries a neutral key glyph, never the OpenAI mark, on the pick and on its route', async () => {
    render(<FirstRun client={client} onDone={() => {}} />);
    const key = (await screen.findAllByTestId('first-run-option')).find((o) => o.getAttribute('data-option') === 'key')!;
    expect(key.querySelector('svg[data-icon="key"]')).not.toBeNull();
    expect(key.querySelector('.s2-brand')).toBeNull();
    /* The other three keep their own marks. */
    const claude = (await screen.findAllByTestId('first-run-option')).find((o) => o.getAttribute('data-option') === 'claude')!;
    expect(claude.querySelector('.s2-brand')).not.toBeNull();
    fireEvent.click(key);
    const route = await screen.findByTestId('first-run-route');
    expect(route.querySelector('svg[data-icon="key"]')).not.toBeNull();
  });

  it('a status that will not read says so in plain words, naming the agent', () => {
    const p = { ...PROVIDERS[0]!, label: 'Cursor', state: 'attention' as const };
    const say = providerSentence(p);
    expect(say).toBe('Couldn’t check whether Cursor is signed in. Try Sign in.');
    expect(say).not.toMatch(/status command/i);
  });

  it('at phone width the welcome is an opaque full-height sheet that scrolls inside itself', () => {
    const m = /@media \(max-width: 560px\) \{\s*\.fr-root:not\(\.fr-inline\):not\(\.fr-finder\) \{([^}]*)\}/.exec(css)!;
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/height:\s*100dvh/);
    expect(m[1]).toMatch(/overflow-y:\s*auto/);
    expect(m[1]).toMatch(/background:\s*var\(--bg-ground\)/);
    expect(m[1]).toMatch(/align-items:\s*flex-start/);
    expect(/\.fr-root:not\(\.fr-inline\):not\(\.fr-finder\) \.fr-col \{([^}]*)\}/.exec(css)![1]).toMatch(/border-radius:\s*0/);
  });
});
