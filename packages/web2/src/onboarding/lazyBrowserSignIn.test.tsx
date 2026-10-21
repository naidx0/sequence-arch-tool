import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./BrowserSignIn', () => ({ BrowserSignIn: () => <div data-testid="real-signin" /> }));

import { LazyBrowserSignIn as BrowserSignIn } from './signInState';
import type { ProviderStatus } from './onboardingClient';

const provider = { id: 'claude', label: 'Claude Code', installed: true, version: '1', state: 'signIn', signInCommand: 'claude login', installHint: '' } as unknown as ProviderStatus;

describe('LazyBrowserSignIn: the sign-in loads when it opens', () => {
  it('shows a calm status sentence while the sign-in loads, then the sign-in (positive control)', async () => {
    render(<BrowserSignIn provider={provider} client={{} as never} onSignedIn={() => {}} />);
    const loading = screen.getByRole('status');
    expect(loading.textContent).toContain('Opening the sign-in page');
    expect(await screen.findByTestId('real-signin')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  /* Each of these chunks is on a lazy path from the boot chunk; a static import of BrowserSignIn in any of them makes it a shared
     chunk that the boot chunk's preload map lists (+39 B on the ceiling, bootJsBytes). */
  it.each(['shell2/ConnectAgents.tsx', 'settings/AgentsPane.tsx', 'onboarding/FirstRun.tsx'])('%s reaches BrowserSignIn only through the lazy wrapper', (file) => {
    const src = readFileSync(join(process.cwd(), 'src', file), 'utf8');
    expect(src).not.toMatch(/from '(\.\.?\/onboarding|\.)\/BrowserSignIn'/);
    expect(src).toMatch(/LazyBrowserSignIn as BrowserSignIn.*from '(\.\.\/onboarding|\.)\/signInState'/);
  });

  it('negative control: the guard sees a static import', () => {
    expect("import { BrowserSignIn } from '../onboarding/BrowserSignIn';").toMatch(/from '(\.\.?\/onboarding|\.)\/BrowserSignIn'/);
  });
});
