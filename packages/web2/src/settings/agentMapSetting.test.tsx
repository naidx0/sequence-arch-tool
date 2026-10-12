import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentMapSetting, agentMapStatus, mapTokensLabel } from './AgentMapSetting';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Architecture map setting', () => {
  it('says how big the map is, in the server’s own count', () => {
    expect(mapTokensLabel(3912)).toBe('map 3.9k tokens');
    expect(mapTokensLabel(850)).toBe('map 850 tokens');
    expect(agentMapStatus({ includeArchitectureMap: true, map: { tokens: 3912 } })).toMatch(/map 3\.9k tokens/);
    expect(agentMapStatus({ includeArchitectureMap: true, map: null })).toMatch(/no map yet/);
    expect(agentMapStatus({ includeArchitectureMap: false, map: { tokens: 3912 } })).toMatch(/^Off/);
  });

  it('on by default; unticking PUTs false and shows the server’s answer', async () => {
    const calls: { method: string; body?: string }[] = [];
    const f = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', body: init?.body as string | undefined });
      if (init?.method === 'PUT') return json({ includeArchitectureMap: false, map: { tokens: 574 } });
      return json({ includeArchitectureMap: true, map: { tokens: 574 } });
    });
    render(<AgentMapSetting fetchImpl={f} />);
    const box = screen.getByTestId('settings-agent-map-toggle') as HTMLInputElement;
    await waitFor(() => expect(screen.getByTestId('settings-agent-map-status').textContent).toMatch(/map 574 tokens/));
    expect(box.checked).toBe(true);
    await act(async () => fireEvent.click(box));
    await waitFor(() => expect(box.checked).toBe(false));
    expect(calls.at(-1)).toEqual({ method: 'PUT', body: '{"includeArchitectureMap":false}' });
    expect(screen.getByTestId('settings-agent-map-status').textContent).toMatch(/^Off/);
  });

  it('a failed read says so instead of showing a stale switch', async () => {
    render(<AgentMapSetting fetchImpl={async () => json({ error: 'x' }, 500)} />);
    await waitFor(() => expect(screen.getByTestId('settings-agent-map-status').textContent).toMatch(/Could not read/));
  });
});
