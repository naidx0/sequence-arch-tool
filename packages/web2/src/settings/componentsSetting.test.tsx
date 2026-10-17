import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComponentsSetting, MODE_CHOICES } from './ComponentsSetting';
import { resolvePane, tabOf } from './settingsPanes';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const VIEW = {
  enabled: true,
  mode: 'approve',
  groups: [{ id: 'design-elements', name: 'Design elements', blurb: 'Interface review.', components: [{ id: 'better-typography', name: 'Better typography', blurb: 'Type passes.' }] }],
};

function fake() {
  const puts: unknown[] = [];
  const f = vi.fn(async (_u: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)));
      return json({});
    }
    return json(VIEW);
  });
  return { f: f as unknown as typeof fetch, puts };
}

describe('Settings > Components', () => {
  it('lists groups and components, the master switch and three choices', async () => {
    const { f } = fake();
    render(<ComponentsSetting fetchImpl={f} />);
    await screen.findByText('Type passes.');
    expect(screen.getByText('Better typography')).toBeTruthy();
    expect(screen.getByText('Type passes.').getAttribute('title')).toBe('Type passes.');
    expect(screen.getByText('Design elements')).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Run on their own', 'Ask me first', 'Only from +']);
    expect(screen.getByTestId('settings-components-mode-says').textContent).toMatch(/approval card/);
  });

  it('PUTs the switch and the mode', async () => {
    const { f, puts } = fake();
    render(<ComponentsSetting fetchImpl={f} />);
    const box = (await screen.findByTestId('settings-components-toggle')) as HTMLInputElement;
    await waitFor(() => expect(box.disabled).toBe(false));
    await act(async () => fireEvent.click(screen.getByText('Only from +')));
    expect(puts).toEqual([{ mode: 'manual' }]);
    expect(screen.getByTestId('settings-components-mode-says').textContent).toMatch(/Never suggested/);
    await act(async () => fireEvent.click(box));
    expect(puts.at(-1)).toEqual({ enabled: false });
    expect(screen.queryByTestId('settings-components-mode-row')).toBeNull();
  });

  it('hides quietly on a 404', async () => {
    const { container } = render(<ComponentsSetting fetchImpl={(async () => json({}, 404)) as unknown as typeof fetch} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe('');
  });

  it('has a section that opens on the Skills tab', () => {
    expect(tabOf('components')).toBe('skills');
    expect(resolvePane('components')).toBe('skills');
  });
});

describe('review fixes (components)', () => {
  it('every mode sentence keeps to the 90-character hint cap', () => {
    for (const c of MODE_CHOICES) expect(c.says.length, c.id).toBeLessThanOrEqual(90);
  });
  it('the arrow keys move focus with the selection', async () => {
    const { f } = fake();
    render(<ComponentsSetting fetchImpl={f} />);
    await screen.findByText('Type passes.');
    expect(screen.getByText('Better typography')).toBeTruthy();
    expect(screen.getByText('Type passes.').getAttribute('title')).toBe('Type passes.');
    const group = screen.getByRole('radiogroup');
    await act(async () => fireEvent.keyDown(group, { key: 'ArrowRight' }));
    expect(document.activeElement?.getAttribute('data-components-mode')).toBe('manual');
  });
});

describe('Settings > Components rows (sweep, item 5)', () => {
  it('each component is its own row: the name, then a one-line sub that carries the full text as its title and is focusable', async () => {
    const view = { ...VIEW, groups: [{ ...VIEW.groups[0]!, components: [{ id: 'a', name: 'Better Accessibility', blurb: 'Reviews and fixes keyboard and focus behavior, ARIA, accessible names, forms, screen-reader announcements.' }, { id: 'b', name: 'Break' }] }] };
    const f = vi.fn(async () => json(view)) as unknown as typeof fetch;
    render(<ComponentsSetting fetchImpl={f} />);
    const rows = await screen.findAllByTestId('settings-components-item');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.sb-row-t')!.textContent).toBe('Better Accessibility');
    const sub = rows[0]!.querySelector('[data-testid="settings-components-item-sub"]') as HTMLElement;
    expect(sub.getAttribute('title')).toBe(sub.textContent);
    expect(sub.tabIndex).toBe(0);
    expect(rows[0]!.textContent).not.toContain(':');
    expect(rows[1]!.querySelector('[data-testid="settings-components-item-sub"]')).toBeNull();
  });

  it('the sub is one line with an ellipsis (CSS), and opens on keyboard focus', async () => {
    const css = (await import('./settings.css?raw')).default;
    expect(css).toMatch(/\.sb-comp-sub \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/);
    expect(css).toMatch(/\.sb-comp-sub:focus-visible \{ white-space: normal/);
  });
});
