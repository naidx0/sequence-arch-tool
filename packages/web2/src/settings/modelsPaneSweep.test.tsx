import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { GetAiConfigResponse } from '@sequence/api-types';
import { brandOf } from '../shell2/brandIcons';
import { AgentsPane } from './AgentsPane';
import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

const SAVED = {
  configured: true,
  provider: 'openai-compatible',
  model: 'deepseek/deepseek-v4-flash',
  defaultProfileId: 'ds',
  profiles: [{ id: 'ds', name: 'deepseek/deepseek-v4-flash', provider: 'openai-compatible', model: 'deepseek/deepseek-v4-flash', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '••••abcd' }],
} as unknown as GetAiConfigResponse;

const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const fetchImpl = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes('/api/ai-config')) return ok(SAVED);
  if (url.includes('/api/hooks')) return ok({ events: [], blocking: [], declared: {}, trusted: false });
  return ok({ path: '', exists: false, text: '', warnings: [], document: {} });
}) as typeof fetch;

describe('Settings › Models (sweep, item 7)', () => {
  it('a saved model reads by its display name with its maker’s mark, and the raw id shows once', async () => {
    render(<SettingsPanel pane="models" client={createSettingsClient(fetchImpl)} />);
    const row = await screen.findByTestId('settings-profile');
    expect(row.querySelector('[data-testid="settings-profile-rename"]')!.textContent).toBe('DeepSeek V4 Flash');
    expect(row.querySelector('[data-testid="settings-profile-mark"] [data-brand]')).not.toBeNull();
    expect(row.textContent!.match(/deepseek\/deepseek-v4-flash/g)).toHaveLength(1);
    expect(screen.getByTestId('settings-current').textContent).toBe('Using DeepSeek V4 Flash');
  });
});

describe('Settings › Agents marks (sweep, item 8)', () => {
  it('Hermes and Cursor rows carry their own packaged marks, not the neutral glyph', async () => {
    expect(brandOf('hermes', 'Hermes Agent')).toBe('agent:hermes');
    expect(brandOf('cursor', 'Cursor')).toBe('agent:cursor');
    render(
      <AgentsPane
        catalog={false}
        client={{
          list: async () => ({
            outcome: 'ok',
            body: [
              { id: 'hermes', label: 'Hermes Agent', status: 'connected' },
              { id: 'cursor', label: 'Cursor', status: 'connected' },
            ],
          }),
        }}
      />,
    );
    const rows = await screen.findAllByTestId('settings-agent');
    expect(rows.map((r) => r.querySelector('.sb-agent-ic [data-mark="logo"]')?.getAttribute('data-brand'))).toEqual(['hermes', 'cursor']);
  });
});
