import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';
import {
  AUTONOMY_AUTO_EDIT_KEY,
  AUTONOMY_FULL_KEY,
  readAutoEditEnabled,
  writeAutoEditEnabled,
} from './autonomyPreference';

describe('Settings autonomy (P3)', () => {
  it('draws the Plan/Propose/Auto-edit/Full matrix (B5.2)', () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/ai-config')) {
        return new Response(
          JSON.stringify({
            mode: 'default',
            provider: 'anthropic',
            model: 'x',
            hasKey: false,
            keySuffix: null,
            gatewayLive: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (String(url).includes('/api/hooks')) {
        return new Response(
          JSON.stringify({ events: [], blocking: [], declared: {}, trusted: false, live: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (String(url).includes('/api/permissions')) {
        return new Response(
          JSON.stringify({
            path: '.sequence/permissions.json',
            exists: false,
            document: { version: 1, default: 'allow', denyStreak: 3, deny: [], ask: [], allow: [] },
            text: '{}\n',
            warnings: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    });

    render(
      <SettingsPanel pane="workspace" client={createSettingsClient(fetchImpl as unknown as typeof fetch)} />,
    );

    expect(screen.getByTestId('settings-autonomy-matrix')).toBeTruthy();
    expect(screen.getByTestId('settings-autonomy-cell-plan-read').textContent).toBe('yes');
    expect(screen.getByTestId('settings-autonomy-cell-plan-writeWithoutAccept').textContent).toBe('no');
    expect(screen.getByTestId('settings-autonomy-cell-full-runCommands').textContent).toBe('yes');
    expect(screen.getByTestId('settings-autonomy-cell-autoEdit-settingsOptIn').textContent).toBe('yes');
  });

  it('enables Auto-edit from Workspace and notifies the host', () => {
    const store = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    writeAutoEditEnabled(false, store);
    expect(readAutoEditEnabled(store)).toBe(false);

    const onAutonomyChange = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/api/ai-config')) {
        return new Response(
          JSON.stringify({
            mode: 'default',
            provider: 'anthropic',
            model: 'x',
            hasKey: false,
            keySuffix: null,
            gatewayLive: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (String(url).includes('/api/hooks')) {
        return new Response(
          JSON.stringify({ events: [], blocking: [], declared: {}, trusted: false, live: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (String(url).includes('/api/permissions')) {
        return new Response(
          JSON.stringify({
            path: '.sequence/permissions.json',
            exists: false,
            document: { version: 1, default: 'allow', denyStreak: 3, deny: [], ask: [], allow: [] },
            text: '{\n  "version": 1,\n  "default": "allow",\n  "denyStreak": 3,\n  "deny": [],\n  "ask": [],\n  "allow": []\n}\n',
            warnings: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    });

    /* Seed localStorage for the panel's own read. */
    window.localStorage.removeItem(AUTONOMY_AUTO_EDIT_KEY);
    window.localStorage.removeItem(AUTONOMY_FULL_KEY);

    render(
      <SettingsPanel
        pane="workspace"
        client={createSettingsClient(fetchImpl as unknown as typeof fetch)}
        onAutonomyChange={onAutonomyChange}
      />,
    );

    const row = screen.getByTestId('settings-autonomy-autoedit');
    const checkbox = row.querySelector('input')!;
    fireEvent.click(checkbox);

    expect(onAutonomyChange).toHaveBeenCalledWith(
      expect.arrayContaining(['plan', 'propose', 'autoEdit']),
    );
    expect(window.localStorage.getItem(AUTONOMY_AUTO_EDIT_KEY)).toBe('on');
  });
});
