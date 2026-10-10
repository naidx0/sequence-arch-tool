/* Round 11, chat lane: shimmer while working, centred subagent rows, film diagram actions, the Agents surface door. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CHROME_TAB_DEFS, LIVE_PILLS, WORKSPACE_PILLS } from '../app/chromeTabModel';
import type { SubagentRef } from '../agents/subagents';
import { SubagentSubRows } from '../shell2/SubagentRows';
import { ChatStatus } from './ChatStatus';
import { RunWatchdog } from './RunWatchdog';

const css = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const t0 = 1_800_000_000_000;

describe('working text shimmers and stops when the work stops', () => {
  it('an active status shimmers; a stalled one does not', () => {
    const { rerender } = render(<ChatStatus status={{ kind: 'thinking' }} />);
    expect(screen.getByTestId('chat-status-text').className).toContain('shimmer-text');
    rerender(<ChatStatus status={{ kind: 'stalled' }} />);
    expect(screen.getByTestId('chat-status-text').className).not.toContain('shimmer-text');
  });
  it('the live tool row and the thinking fold use the shared class, not a private loop', () => {
    expect(readFileSync(join(__dirname, 'WorkRowLine.tsx'), 'utf8')).toMatch(/live \? 'name shimmer-text'/);
    expect(readFileSync(join(__dirname, 'AgentRunThread.tsx'), 'utf8')).toMatch(/live \? ' shimmer-text'/);
    expect(css('runLive.css')).not.toMatch(/r9-glimmer/);
  });
});

describe('subagent rows centre their icon, chevron and label', () => {
  const ref = (status: SubagentRef['status']): SubagentRef => ({ runId: 'r', toolId: status, name: 'Explore', description: 'find auth', status, startedAt: 1, endedAt: null });
  it('a running rail sub-row has the ASCII spinner and a shimmering label; a done one has neither', () => {
    const { container } = render(<SubagentSubRows refs={[ref('running'), ref('done')]} onPick={() => {}} />);
    const rows = container.querySelectorAll('.rsub-row');
    expect(rows[0]!.querySelector('[data-testid="s2-ascii-spinner"]')).not.toBeNull();
    expect(rows[0]!.querySelector('.rsub-name.shimmer-text')).not.toBeNull();
    expect(rows[1]!.querySelector('[data-testid="s2-ascii-spinner"]')).toBeNull();
    expect(rows[1]!.querySelector('.shimmer-text')).toBeNull();
  });
  it('both headers centre their items (no baseline alignment)', () => {
    expect(css('subagent.css')).toMatch(/\.agsub-hd \{[^}]*align-items: center;/);
    expect(css('subagent.css')).not.toMatch(/align-items: baseline/);
    expect(readFileSync(join(__dirname, '../shell2/railSubagents.css'), 'utf8')).toMatch(/\.rsub-row \{[^}]*align-items: center;/);
  });
});

describe('diagram actions are a quiet transparent film', () => {
  const c = css('diagramBlock.css');
  it('hidden until the diagram is hovered or focused, keyboard reachable, still under reduced motion', () => {
    expect(c).toMatch(/\.dgm-toggle \{[^}]*opacity: 0;[^}]*transition: opacity/);
    expect(c).toMatch(/\.dgm:hover \.dgm-toggle,\s*\.dgm:focus-within \.dgm-toggle,\s*\.dgm-toggle:focus-visible/);
    expect(c).toMatch(/@media \(hover: none\)/);
    expect(c).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.dgm-toggle \{\s*transition: none/);
  });
});

describe('the watchdog row reads as key fact, then detail, then quiet actions', () => {
  it('keeps the key fact in its own span and adds a detail line', () => {
    render(<RunWatchdog run={{ id: 'r', sessionId: 's', agentRef: 'claude', prompt: 'q', status: 'running', startedAt: t0, endedAt: null, items: [], approvals: [], error: null, lastEventAt: t0 } as never} now={t0 + 48_000} onStop={() => {}} />);
    expect(screen.getByTestId('agent-run-watchdog-text').textContent).toBe('Claude is still starting, 48s');
    expect(screen.getByTestId('agent-run-watchdog-detail').textContent).toBeTruthy();
    expect(screen.getByTestId('agent-run-watchdog').getAttribute('data-watch')).toBe('film');
    expect(css('agentRun.css')).toMatch(/\.agnote\[data-watch='film'\] \.agnote-text \{\s*color: var\(--b-ink1\)/);
  });
});

describe('Agents is a surface next to Terminal', () => {
  it('sits right after Terminal in the bar and is a live pane', () => {
    expect(WORKSPACE_PILLS.indexOf('agents')).toBe(WORKSPACE_PILLS.indexOf('terminal') + 1);
    expect(LIVE_PILLS).toContain('agents');
    expect(CHROME_TAB_DEFS.agents.label).toBe('Agents');
  });
});

describe('timeline dots are centred on their step row', () => {
  it('the dot is placed from the row height and pulled back by half its own', () => {
    expect(css('toolRows.css')).toMatch(/\.s2-agcard::before \{[^}]*top: calc\(var\(--row-h-thread\) \/ 2\);[^}]*transform: translateY\(-50%\)/);
  });
});
