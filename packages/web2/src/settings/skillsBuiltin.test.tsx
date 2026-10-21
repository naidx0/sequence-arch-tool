/**
 * A built-in skill (be-ambitious) is listed in Settings, Skills like any other, marked "Built in", and carries no Edit or
 * Remove: it has no folder in the workspace. A workspace skill beside it keeps both.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

const BODY = {
  dir: '.sequence/skills',
  skills: [
    { slug: 'gate-first', name: 'Gate first', description: 'Run the gate.' },
    { slug: 'be-ambitious', name: 'be-ambitious', description: 'Turn a task or prompt into a deeper version of itself, not a bigger one.', builtin: true },
  ],
  warnings: [],
  trusted: true,
  instructions: null,
};

afterEach(cleanup);

describe('built-in skills in Settings', () => {
  it('lists be-ambitious as Built in with no Edit or Remove, and leaves the workspace skill its actions', async () => {
    const fetchImpl = (async (url: RequestInfo | URL) =>
      String(url) === '/api/skills' ? new Response(JSON.stringify(BODY), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('{}', { status: 404 })) as typeof fetch;
    render(<SettingsPanel pane="skills" client={createSettingsClient(fetchImpl)} />);
    const rows = await screen.findAllByTestId('settings-skill-row');
    const by = Object.fromEntries(rows.map((r) => [r.getAttribute('data-slug')!, r]));
    expect(Object.keys(by).sort()).toEqual(['be-ambitious', 'gate-first']);
    const built = by['be-ambitious']!;
    expect(within(built).getByTestId('settings-skill-source').textContent).toBe('Built in');
    expect(within(built).queryByTestId('settings-skill-edit')).toBeNull();
    expect(within(built).queryByTestId('settings-skill-remove')).toBeNull();
    const own = by['gate-first']!;
    expect(within(own).getByTestId('settings-skill-source').textContent).toBe('This project');
    expect(within(own).getByTestId('settings-skill-edit')).toBeTruthy();
    expect(within(own).getByTestId('settings-skill-remove')).toBeTruthy();
  });
});
