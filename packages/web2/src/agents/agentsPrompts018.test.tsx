/**
 * 0.1.8 Agents surface. Jaden: "agents loads every single question ... should show maximum the last five prompts ... and then the rest
 * of them show more to expand for every like five" and "Tree and timeline don't actually switch between each other".
 */
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { agentRuns, type AgentRun } from './agentRuns';
import { requestAgentsView } from './agentsSection';
import { AgentsSurface } from './AgentsSurface';

const run = (i: number): AgentRun =>
  ({ id: `r${i}`, sessionId: 'a', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: `Prompt number ${i}`, status: 'done', startedAt: 1_000 * i, endedAt: 1_000 * i + 500, items: [], approvals: [], error: null }) as AgentRun;
const twelve = Array.from({ length: 12 }, (_, i) => run(i + 1));
const shown = () => screen.getAllByTestId('agents-surface-run').map((n) => n.textContent ?? '');

describe('D1: a chat shows its last five prompts, and five more per click', () => {
  afterEach(() => act(() => agentRuns.patch((s) => ({ ...s, runs: [] }))));

  it('12 prompts: 5 shown (the newest), then 10, then all 12, with the remainder on the row', () => {
    act(() => agentRuns.patch((s) => ({ ...s, runs: twelve })));
    render(<AgentsSurface />);
    expect(shown()).toHaveLength(5);
    const first = shown().join('|');
    expect(first).toContain('Prompt number 12');
    expect(first).toContain('Prompt number 8');
    expect(first).not.toContain('Prompt number 7');
    const more = screen.getByTestId('agents-surface-more');
    expect(more.textContent).toMatch(/Show 5 more/);
    expect(more.textContent).toMatch(/7 remain/);
    fireEvent.click(more);
    expect(shown()).toHaveLength(10);
    expect(shown().join('|')).toContain('Prompt number 3');
    expect(screen.getByTestId('agents-surface-more').textContent).toMatch(/Show 2 more/);
    expect(screen.getByTestId('agents-surface-more').textContent).toMatch(/2 remain/);
    fireEvent.click(screen.getByTestId('agents-surface-more'));
    expect(shown()).toHaveLength(12);
    expect(screen.queryByTestId('agents-surface-more')).toBeNull();
  });

  it('the row reads as clickable: an accent-coloured button with a chevron, not plain text', () => {
    act(() => agentRuns.patch((s) => ({ ...s, runs: twelve })));
    render(<AgentsSurface />);
    const more = screen.getByTestId('agents-surface-more');
    expect(more.tagName).toBe('BUTTON');
    expect(more.querySelector('svg')).toBeTruthy();
    const css = readFileSync(`${__dirname}/agentsSurface.css`, 'utf8').replace(/\r\n/g, '\n');
    expect(/\n\.ags-more \{([^}]*)\}/.exec(css)?.[1]).toMatch(/color:\s*var\(--b-acc\)/);
  });

  it('five prompts or fewer: no row', () => {
    act(() => agentRuns.patch((s) => ({ ...s, runs: twelve.slice(0, 5) })));
    render(<AgentsSurface />);
    expect(shown()).toHaveLength(5);
    expect(screen.queryByTestId('agents-surface-more')).toBeNull();
  });

  it('a prompt that is still running stays inside the shown window', () => {
    const live = { ...run(12), status: 'running', endedAt: null } as AgentRun;
    act(() => agentRuns.patch((s) => ({ ...s, runs: [...twelve.slice(0, 11), live] })));
    render(<AgentsSurface />);
    expect(shown().join('|')).toContain('Prompt number 12');
  });

  it('a running prompt OLDER than the newest five is still listed, and is not counted as hidden', () => {
    const live = { ...run(1), status: 'running', endedAt: null } as AgentRun;
    act(() => agentRuns.patch((s) => ({ ...s, runs: [live, ...twelve.slice(1, 7)] })));
    render(<AgentsSurface />);
    expect(shown()).toHaveLength(6);
    expect(shown().join('|')).toMatch(/Prompt number 1(?!\d)/);
    expect(screen.getByTestId('agents-surface-more').textContent).toMatch(/1 remains/);
  });
});

describe('G11: Tree and Timeline both switch, both ways', () => {
  afterEach(() => act(() => agentRuns.patch((s) => ({ ...s, runs: [] }))));

  it('offers Tree, Timeline and Workflows; Timeline shows every row on the clock, Tree hides it again', () => {
    act(() => agentRuns.patch((s) => ({ ...s, runs: twelve.slice(0, 3) })));
    render(<AgentsSurface />);
    const tabs = within(screen.getByRole('tablist', { name: 'Agents view' })).getAllByRole('tab');
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(['Tree', 'Timeline', 'Workflows']);
    expect(screen.getByTestId('agents-surface-tab-tree').getAttribute('aria-selected')).toBe('true');
    expect(screen.queryAllByTestId('agents-surface-detail')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('agents-surface-tab-timeline'));
    expect(screen.getByTestId('agents-surface-tab-timeline').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('agents-surface-tab-tree').getAttribute('aria-selected')).toBe('false');
    expect(screen.getAllByTestId('agents-surface-detail').length).toBeGreaterThanOrEqual(4);
    fireEvent.click(screen.getByTestId('agents-surface-tab-tree'));
    expect(screen.queryAllByTestId('agents-surface-detail')).toHaveLength(0);
  });

  it('a request for the timeline after mount switches the view; so does one for the tree after that', () => {
    act(() => agentRuns.patch((s) => ({ ...s, runs: twelve.slice(0, 2) })));
    render(<AgentsSurface />);
    act(() => requestAgentsView('timeline'));
    expect(screen.getByTestId('agents-surface-tab-timeline').getAttribute('aria-selected')).toBe('true');
    act(() => requestAgentsView('tree'));
    expect(screen.getByTestId('agents-surface-tab-tree').getAttribute('aria-selected')).toBe('true');
  });

  it('the initial view prop is followed when it changes after mount', () => {
    act(() => agentRuns.patch((s) => ({ ...s, runs: twelve.slice(0, 2) })));
    const { rerender } = render(<AgentsSurface initialView="tree" />);
    rerender(<AgentsSurface initialView="timeline" />);
    expect(screen.getByTestId('agents-surface-tab-timeline').getAttribute('aria-selected')).toBe('true');
  });
});
