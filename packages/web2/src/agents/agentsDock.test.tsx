import fs from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AgentsDock } from './AgentsDock';
import { createAgentStore } from './agentStream';

/*
 * ROUND 7, A7: "Agent window sucks. It transpons all the other screens. As a
 * pop-up, it's not really clear what the boundaries are."
 *
 * The dock is a card in the stage: it draws nothing over the page (no scrim,
 * overlay, dialog or modal), has its own edge and rounded corners, closes on
 * its x and on Escape, and keeps a usable width. Its stylesheet is read for
 * the card rule, so a later change back to a fixed overlay fails here.
 */

const css = fs.readFileSync(path.join(__dirname, 'agents.css'), 'utf8');
const rule = (sel: string): string => {
  const i = css.indexOf(`\n${sel} {`);
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
};

describe('the Agents dock', () => {
  it('closed draws nothing; open is a card beside the page, never over it', () => {
    const store = createAgentStore(() => null);
    const { rerender } = render(<AgentsDock open={false} onClose={() => {}} store={store} />);
    expect(screen.queryByTestId('agents-dock')).toBeNull();
    rerender(<AgentsDock open onClose={() => {}} store={store} />);
    const dock = screen.getByTestId('agents-dock');
    expect(dock.tagName).toBe('ASIDE');
    const covers = [...document.querySelectorAll('*')].filter(
      (el) => /scrim|overlay|backdrop/i.test(String(el.className)) || el.getAttribute('aria-modal') === 'true' || el.getAttribute('role') === 'dialog',
    );
    expect(covers).toEqual([]);
    const card = rule('.ag-dock');
    expect(card).toMatch(/border-radius:\s*(1[6-9]|2\d)px/);
    expect(card).toMatch(/border:\s*1px solid/);
    expect(card).not.toMatch(/position:\s*(fixed|absolute)/);
    expect(card).toMatch(/height:\s*100%/);
  });

  it('closes on its x and on Escape, and keeps at least 300px', () => {
    const onClose = vi.fn();
    render(<AgentsDock open onClose={onClose} width={200} store={createAgentStore(() => null)} />);
    expect(screen.getByTestId('agents-dock').style.width).toBe('300px');
    fireEvent.click(screen.getByTestId('agents-close'));
    fireEvent.keyDown(screen.getByTestId('agents-dock'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('B controls: the segmented Tree | Timeline and a live/offline chip in words', () => {
    render(<AgentsDock open onClose={() => {}} store={createAgentStore(() => null)} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Tree', 'Timeline']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText(/^(Live|Offline)$/)).toBeTruthy();
  });
});
