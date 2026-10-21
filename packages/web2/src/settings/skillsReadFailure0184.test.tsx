import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

describe('workspace skills read failures', () => {
  it.each(['http', 'shape'])('ends %s failure in an actionable message and Retry reads again', async (failure) => {
    let reads = 0;
    const f = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/skills') {
        reads++;
        if (reads === 1) return new Response(JSON.stringify(failure === 'http' ? { error: 'Open a project to read skills.' } : { nonsense: true }), { status: failure === 'http' ? 409 : 200 });
        return new Response(JSON.stringify({ skills: [{ slug: 'recovered', name: 'Recovered skill', description: 'Read after retry' }], warnings: [], trusted: true, instructions: null }));
      }
      return new Response(JSON.stringify({ error: 'Controlled unavailable endpoint' }), { status: 503 });
    }) as typeof fetch;
    render(<SettingsPanel pane="skills" client={createSettingsClient(f)} />);
    const note = await screen.findByTestId('settings-skills-failure');
    expect(note.textContent).toMatch(failure === 'http' ? /Open a project/ : /invalid skills/i);
    expect(screen.queryByTestId('settings-skills-loading')).toBeNull();
    expect(reads).toBe(1);
    fireEvent.click(screen.getByTestId('settings-skills-retry'));
    await screen.findByText('Recovered skill');
    await waitFor(() => expect(screen.queryByTestId('settings-skills-failure')).toBeNull());
    expect(reads).toBe(2);
  });
});
