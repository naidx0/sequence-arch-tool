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
    await screen.findByText('Better typography: Type passes.');
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
    await screen.findByText('Better typography: Type passes.');
    const group = screen.getByRole('radiogroup');
    await act(async () => fireEvent.keyDown(group, { key: 'ArrowRight' }));
    expect(document.activeElement?.getAttribute('data-components-mode')).toBe('manual');
  });
});
