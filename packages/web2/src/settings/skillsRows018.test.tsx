/**
 * 0.1.8 F3/F4. Jaden: the skills page "just shows too much in the beginning ... define each skill there shortly ... if you just hover
 * a skill you can add or remove it from workspace, like edit or remove."
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { SettingsPanel } from './SettingsPanel';
import { createSettingsClient } from './settingsClient';

const LONG = 'Run the full gate before pushing anything, read the bare exit code, and keep the whole log in a file instead of piping it through tail so the failure list is never lost.';
const BODY = {
  dir: '.sequence/skills',
  skills: [
    { slug: 'gate-first', name: 'Gate first', description: LONG },
    { slug: 'ship-notes', name: 'Ship notes', description: 'Write the release notes.' },
  ],
  warnings: [],
  trusted: true,
  instructions: null,
};

function mount(removeStatus = 200) {
  const calls: { method: string; url: string }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = String(url);
    calls.push({ method, url: u });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (u === '/api/skills' && method === 'GET') return json(200, BODY);
    if (u.startsWith('/api/skills/') && method === 'DELETE') return removeStatus === 200 ? json(200, { removed: 'x' }) : json(removeStatus, { error: 'no skill named x in this workspace' });
    if (u.endsWith('/reveal') && method === 'POST') return json(200, { revealed: 'x' });
    return json(404, { error: 'not here' });
  }) as typeof fetch;
  render(<SettingsPanel pane="skills" client={createSettingsClient(fetchImpl)} />);
  return calls;
}

describe('F3: a skill is one condensed row', () => {
  afterEach(cleanup);

  it('shows the name and a one-line description, with the full text on the title; no slug column, no paragraph', async () => {
    mount();
    const rows = await screen.findAllByTestId('settings-skill-row');
    expect(rows).toHaveLength(2);
    const first = rows[0]!;
    expect(within(first).getByTestId('settings-skill-name').textContent).toBe('Gate first');
    const desc = within(first).getByTestId('settings-skill-desc');
    expect(desc.textContent).toBe(LONG);
    expect(desc.getAttribute('title')).toBe(LONG);
    expect(first.querySelector('p')).toBeNull();
    expect(first.textContent).not.toContain('gate-first');
  });

  it('the stylesheet clips the description to one line and shows the actions on hover or focus, not display:none', () => {
    const css = readFileSync(resolve(__dirname, 'settings.css'), 'utf8').replace(/\r\n/g, '\n');
    const desc = /\.sb-skill-desc \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(desc).toMatch(/white-space:\s*nowrap/);
    expect(desc).toMatch(/text-overflow:\s*ellipsis/);
    expect(/\.sb-skill-act \{([^}]*)\}/.exec(css)?.[1]).toMatch(/opacity:\s*0/);
    expect(css).toMatch(/\.sb-skill:hover \.sb-skill-act,\s*\n\.settings-scope \.sb-skill:focus-within \.sb-skill-act \{ opacity: 1; \}/);
    expect(/\.sb-skill-act \{([^}]*)\}/.exec(css)?.[1]).not.toMatch(/display:\s*none/);
  });
});

describe('F4: Edit and Remove from workspace on each row', () => {
  afterEach(cleanup);

  it('each row has Edit and Remove as real buttons (keyboard reachable) named for the skill', async () => {
    mount();
    const row = (await screen.findAllByTestId('settings-skill-row'))[0]!;
    const edit = within(row).getByRole('button', { name: 'Edit Gate first' });
    const remove = within(row).getByRole('button', { name: 'Remove Gate first from workspace' });
    expect(edit.tagName).toBe('BUTTON');
    expect(edit.getAttribute('tabindex')).toBeNull();
    expect(remove.getAttribute('tabindex')).toBeNull();
  });

  it('Edit asks the server to show that skill; nothing is removed', async () => {
    const calls = mount();
    const row = (await screen.findAllByTestId('settings-skill-row'))[0]!;
    fireEvent.click(within(row).getByTestId('settings-skill-edit'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/skills/gate-first/reveal')).toBe(true));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });

  it('Remove asks once, then deletes that skill only and the row goes', async () => {
    const calls = mount();
    const row = (await screen.findAllByTestId('settings-skill-row'))[0]!;
    const remove = within(row).getByTestId('settings-skill-remove');
    fireEvent.click(remove);
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    expect(remove.textContent).toBe('Confirm remove');
    fireEvent.click(remove);
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual(['/api/skills/gate-first']));
    await waitFor(() => expect(screen.getAllByTestId('settings-skill-row')).toHaveLength(1));
    expect(screen.getByTestId('settings-skill-name').textContent).toBe('Ship notes');
  });

  it('leaving the button (blur) disarms the confirmation, and a refused removal keeps the row and says why', async () => {
    const calls = mount(404);
    const row = (await screen.findAllByTestId('settings-skill-row'))[0]!;
    const remove = within(row).getByTestId('settings-skill-remove');
    fireEvent.click(remove);
    fireEvent.blur(remove);
    expect(remove.textContent).toBe('Remove');
    fireEvent.click(remove);
    fireEvent.click(remove);
    await screen.findByTestId('settings-skill-note');
    expect(screen.getByTestId('settings-skill-note').textContent).toMatch(/Could not remove Gate first/);
    expect(screen.getAllByTestId('settings-skill-row')).toHaveLength(2);
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });
});
