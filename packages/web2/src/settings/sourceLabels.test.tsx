/**
 * APP-43: every listed skill and component says where it comes from, and has a description.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ComponentsSetting } from './ComponentsSetting';
import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

afterEach(cleanup);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SKILLS = {
  dir: '.sequence/skills',
  skills: [
    { slug: 'gate-first', name: 'Gate first', description: 'Run the gate.', scope: 'project' },
    { slug: 'be-ambitious', name: 'be-ambitious', description: 'Go deeper.', builtin: true, scope: 'builtin' },
    { slug: 'mine', name: 'Mine', description: 'Mine, everywhere.', scope: 'user' },
    { slug: 'old-route', name: 'Old route', description: 'A route that sends no scope.' },
    { slug: 'old-builtin', name: 'Old builtin', description: 'Sends builtin only.', builtin: true },
  ],
  warnings: [],
  trusted: true,
  instructions: null,
};

describe('Settings > Skills source label', () => {
  it('every row has a non-empty source and description; the words are Built in, This project, User-wide', async () => {
    const fetchImpl = (async (url: RequestInfo | URL) => (String(url) === '/api/skills' ? json(SKILLS) : json({}, 404))) as typeof fetch;
    render(<SettingsPanel pane="skills" client={createSettingsClient(fetchImpl)} />);
    const rows = await screen.findAllByTestId('settings-skill-row');
    expect(rows).toHaveLength(SKILLS.skills.length);
    const source = (slug: string) => {
      const row = rows.find((r) => r.getAttribute('data-slug') === slug)!;
      return within(row).getByTestId('settings-skill-source').textContent;
    };
    for (const row of rows) {
      expect(within(row).getByTestId('settings-skill-source').textContent?.trim(), row.getAttribute('data-slug')!).toBeTruthy();
      expect(within(row).getByTestId('settings-skill-desc').textContent?.trim()).toBeTruthy();
    }
    expect(source('gate-first')).toBe('This project');
    expect(source('be-ambitious')).toBe('Built in');
    expect(source('mine')).toBe('User-wide');
    expect(source('old-route')).toBe('This project');
    expect(source('old-builtin')).toBe('Built in');
  });
});

describe('Settings > Components source label', () => {
  it('every row shows its source, falling back to the catalog group, and a description', async () => {
    const view = {
      enabled: true,
      mode: 'approve',
      groups: [
        {
          id: 'ml',
          name: 'Bundled, ML and research',
          blurb: 'Ships with the app.',
          components: [
            { id: 'a', name: 'Alpha', blurb: 'Does alpha.', source: 'Sequence' },
            { id: 'b', name: 'Beta', blurb: 'Does beta.', source: 'github.com/acme/beta' },
            { id: 'c', name: 'Gamma' },
          ],
        },
      ],
    };
    render(<ComponentsSetting fetchImpl={vi.fn(async () => json(view)) as unknown as typeof fetch} />);
    const items = await screen.findAllByTestId('settings-components-item');
    expect(items).toHaveLength(3);
    const src = items.map((i) => within(i).getByTestId('settings-components-item-source').textContent);
    expect(src).toEqual(['Bundled, ML and research', 'github.com/acme/beta', 'Bundled, ML and research']);
    for (const i of items) expect(within(i).getByTestId('settings-components-item-sub').textContent?.trim()).toBeTruthy();
  });
});
