import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ActivityPane } from '../activity/ActivityPane';
import { ACTIVITY } from '../activity/anchors';
import { oneOfEach, summary } from '../activity/fixtures';
import { fieldDots } from '../canvas/fieldDots';
import { ViewMenu } from '../canvas/views/ViewMenu';
import { agentRuns } from './agentRuns';
import { AgentsSurface } from './AgentsSurface';

/* ROUND 13, LANE A (A1 to A7): Jaden's walkthrough of the r12 shots. */

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
afterEach(() => {
  cleanup();
  act(() => agentRuns.patch((s) => ({ ...s, runs: [] })));
});

const pane = (over: Partial<Parameters<typeof ActivityPane>[0]> = {}) =>
  render(<ActivityPane runs={[]} now={1_700_000_060_000} filter="all" onFilter={() => undefined} onOpen={() => undefined} onCloseRun={() => undefined} {...over} />);

describe('A1: the Workflows head is the title, then both buttons as one unit', () => {
  it('title first, then one actions group holding Refresh and Start a workflow', () => {
    pane({ embedded: true, onRefresh: () => undefined, onAuthor: () => undefined });
    const head = document.querySelector('.ac-head') as HTMLElement;
    const kids = [...head.children];
    expect(kids[0]!.textContent).toBe('Workflows');
    const actions = within(head).getByTestId('activity-head-actions');
    expect(within(actions).getByTestId(ACTIVITY.refresh)).toBeTruthy();
    expect(within(actions).getByTestId(ACTIVITY.newRun).textContent).toBe('Start a workflow');
  });
  it('the css keeps the unit whole and the title on one line', () => {
    const css = read('activity/activity.css');
    expect(css).toMatch(/\.ac-head-actions \{ display: inline-flex;[^}]*flex: none;/);
    expect(css).toContain(".ac-scope[data-embedded='true'] .ac-title { white-space: nowrap; flex: none; }");
    expect(css).toContain(".ac-scope[data-embedded='true'] .ac-head-actions { margin-left: auto; }");
  });
});

describe('A2/N1/N2: three tabs (Tree, Timeline, Workflows) with distinct glyphs, and the head never stacks', () => {
  it('each tab keeps its aria-label and title; the glyphs differ', () => {
    render(<AgentsSurface />);
    const ds = (['tree', 'timeline', 'workflows'] as const).map((v) => {
      const b = screen.getByTestId(`agents-surface-tab-${v}`);
      expect(b.getAttribute('aria-label')).toBeTruthy();
      expect(b.getAttribute('title')).toBeTruthy();
      return b.querySelector('svg')!.innerHTML;
    });
    expect(new Set(ds).size).toBe(3);
    /* N1: the tree is a list-tree (lines, no boxes); Workflows is the board glyph upside down (one box over two). */
    expect(ds[0]).not.toContain('<rect');
    expect(ds[2]!.match(/<rect/g)).toHaveLength(3);
    expect(ds[2]).toMatch(/<rect x="5.5" y="1.8"[\s\S]*<rect x="1.5" y="10.6"/);
  });
  it('the head is one nowrap row', () => {
    const css = read('agents/agentsSurface.css');
    expect(css).toContain('.ags-head { flex-wrap: nowrap; min-width: 0; }');
    expect(css).toContain('.ags-title, .ags-total { white-space: nowrap; flex: none; }');
  });
});

describe('A3: "Context 100k · Output 18k", the hover says what each counts', () => {
  it('names Context and Output, never a bare Tokens figure', () => {
    render(<AgentsSurface />);
    const t = screen.getByTestId('agents-surface-total');
    expect(t.textContent).toBe('Context—Output—');
    expect(t.textContent).not.toMatch(/total|tokens/i);
    expect(t.getAttribute('title')).toMatch(/reported none/i);
  });
});

describe('A4 (H8 contract): every row shows its one plain word, visible, beside its icon', () => {
  it('no row, running and done included, hides its word; reasons follow only where there is one', () => {
    const runs = oneOfEach();
    pane({ runs });
    for (const status of ['running', 'completed'] as const) {
      const row = screen.getAllByTestId(ACTIVITY.row).find((r) => r.dataset.status === status)!;
      expect(within(row).getByTestId(ACTIVITY.rowState).className).not.toContain('ac-state-quiet');
      expect(within(row).getByTestId(ACTIVITY.rowState).textContent).toBeTruthy();
      expect(row.querySelector('.ac-ico svg')).not.toBeNull();
      expect(row.querySelector('.ac-hint')).toBeNull();
    }
    for (const status of ['paused', 'interrupted', 'stopped', 'failed', 'completed-with-violations'] as const) {
      const row = screen.getAllByTestId(ACTIVITY.row).find((r) => r.dataset.status === status)!;
      expect(within(row).getByTestId(ACTIVITY.rowState).className).not.toContain('ac-state-quiet');
      expect(row.querySelector('.ac-hint')).not.toBeNull();
    }
    expect(summary({}).status).toBeTruthy();
  });
  it('the screen-reader-only clipping class is gone from the stylesheet', () => {
    expect(read('activity/activity.css')).not.toContain('ac-state-quiet');
  });
});

describe('A5: an agent definition is one line with an ellipsis', () => {
  it('the subagent description and the panel reason are one-line and ellipsised', () => {
    const s = read('agents/agentsSurface.css');
    expect(s).toMatch(/\.ags-desc \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap/);
    expect(read('agents/agents.css')).toMatch(/\.ag-why \{[^}]*-webkit-line-clamp: 1/);
  });
});

describe('A6: the board toolbar overflow is a dropdown of the views', () => {
  it('lists every view, marks the chosen one, and picking one changes the view', () => {
    let v = 'map';
    render(<ViewMenu views={['map', 'grid', 'diff', 'hotspots']} value="map" onChange={(n) => (v = n)} />);
    expect(screen.queryByTestId('board-view-list')).toBeNull();
    fireEvent.click(screen.getByTestId('board-view-menu'));
    expect(screen.getByTestId('board-view-menu').getAttribute('aria-expanded')).toBe('true');
    expect(['map', 'grid', 'diff', 'hotspots'].every((x) => screen.queryByTestId(`board-view-menu-${x}`))).toBe(true);
    expect(screen.getByTestId('board-view-menu-map').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('board-view-menu-diff'));
    expect(v).toBe('diff');
    expect(screen.queryByTestId('board-view-list')).toBeNull();
  });
  it('Escape closes it', () => {
    render(<ViewMenu views={['map', 'grid']} value="map" onChange={() => undefined} />);
    fireEvent.click(screen.getByTestId('board-view-menu'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('board-view-list')).toBeNull();
  });
  it('the css: the dropdown pill is drawn at every width, the tags share the toolbar row', () => {
    const css = read('canvas/board.css');
    expect(css).toMatch(/\.bview-menu-wrap \{[^}]*display: inline-flex;/);
    expect(css).not.toMatch(/\.bview-menu-wrap \{[^}]*display: none;/);
    expect(css).not.toContain('.vtabs .vt:not(.on) { display: none; }');
    expect(read('canvas/boards/boards.css')).toMatch(/\.board-controls \{\s*top: var\(--sp-12\);/);
  });
});

describe('A7: fewer, fainter dots when the board is zoomed out', () => {
  it('doubles the pitch until dots sit 10px apart', () => {
    expect(fieldDots(1).step).toBe(1);
    expect(fieldDots(0.5).step).toBe(1);
    expect(fieldDots(0.37).step).toBe(2);
    expect(fieldDots(0.2).step).toBe(4);
    for (const z of [0.05, 0.1, 0.15, 0.25, 0.37, 0.6]) expect(20 * z * fieldDots(z).step).toBeGreaterThanOrEqual(10);
  });
  it('fades to 40% at the floor and is 1 when zoomed in', () => {
    expect(fieldDots(1).fade).toBe(1);
    expect(fieldDots(0.1).fade).toBe(0.4);
    expect(fieldDots(0.37).fade).toBeLessThan(0.6);
  });
  it('the css reads both', () => {
    const css = read('canvas/board.css');
    expect(css).toContain('var(--board-field-step, 1)');
    expect(css).toContain('var(--board-field-fade, 1)');
  });
});

describe('lead tweaks: the Workflows block shares the Agents header left edge; chips are one row', () => {
  it('outranks the shell inset and keeps the filter chips on one row', () => {
    const css = read('activity/activity.css');
    expect(css).toContain(".s2 .ac-scope[data-embedded='true'] .ac-head { padding-left: 0; padding-right: 0; }");
    expect(css).toMatch(/\.ac-scope\[data-embedded='true'\] \.ac-buckets \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto/);
  });
});

describe('lead: no duration from an unknown start; the title wins the row', () => {
  it('spanMs is null for a zero, missing or later-than-end start, and a real span otherwise', async () => {
    const { spanMs } = await import('./agentsOverview');
    expect(spanMs(0, null, 1_800_000_000_000)).toBeNull();
    expect(spanMs(undefined, 5, 10)).toBeNull();
    expect(spanMs(NaN, 5, 10)).toBeNull();
    expect(spanMs(10, 5, 10)).toBeNull();
    expect(spanMs(10, 10, 99)).toBeNull();
    expect(spanMs(10, null, 10)).toBeNull();
    expect(spanMs(1_000, null, 41_000)).toBe(40_000);
    expect(spanMs(1_000, 3_500, 99_000)).toBe(2_500);
  });
  it('a chat whose run has no start time draws no duration (never 29858542m)', async () => {
    const { agentRuns: store } = await import('./agentRuns');
    act(() => store.patch((s) => ({ ...s, runs: [{ id: 'z', sessionId: 'a', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'Why?', status: 'running', startedAt: 0, endedAt: null, items: [], approvals: [], error: null } as never] })));
    render(<AgentsSurface />);
    expect(document.querySelector('.ags-time')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d{5,}m/);
  });
  it('token cells carry no "tok" word and the label flexes while the numbers do not', () => {
    act(() => agentRuns.patch((s) => ({ ...s, runs: [{ id: 'y', sessionId: 'a', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'Why?', status: 'done', startedAt: 1_000, endedAt: 5_000, items: [], approvals: [], error: null, turnUsage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, thought: 0, total: 2000 } } as never] })));
    render(<AgentsSurface />);
    expect(document.body.textContent).not.toMatch(/\btok\b/);
    const css = read('agents/agentsSurface.css');
    expect(css).toContain('.ags-row > .ags-label { flex: 1 1 auto; }');
    expect(css).toContain('.ags-row > .ags-meta { flex: none;');
  });
});

describe('N3/N4/N5', () => {
  it('N3: what is running is stronger and a step larger, what is done is quieter', () => {
    const css = read('agents/agentsSurface.css');
    expect(css).toContain("li[data-state='done'] > .ags-row .ags-label { color: var(--b-ink3); }");
    expect(css).toMatch(/li\[data-state='running'\] > \.ags-row \.ags-label \{ font-size: var\(--t-13\); \S+: var\(--fw-label\); \}/);
  });
  it('N4: under 1200px the Workflows title is hidden and Refresh is its glyph; the editor button is visible', () => {
    pane({ embedded: true, onRefresh: () => undefined, onAuthor: () => undefined, onOpenEditor: () => undefined });
    expect(screen.getByTestId('activity-open-editor').textContent).toContain('Workflow editor');
    expect(screen.getByTestId(ACTIVITY.refresh).getAttribute('aria-label')).toBe('Refresh');
    const css = read('activity/activity.css');
    expect(css).toMatch(/@media \(max-width: 1199px\) \{\s*\.ac-scope\[data-embedded='true'\] \.ac-title \{ position: absolute;/);
    expect(css).toContain('.ac-btn-t { position: absolute;');
  });
  it('N5: the dock is centred alone at every width (the kind key and its spacers are gone), and the folded Find glyph has no gap', () => {
    const css = read('canvas/board.css');
    expect(css).toMatch(/\.board-scope \.boardfurniture \{[^}]*display: flex;[^}]*justify-content: center;/);
    expect(css).not.toMatch(/bfurn-(start|end)/);
    expect(css).not.toMatch(/kindlegend/);
    expect(css).toMatch(/@container boardstack \(max-width: 760px\) \{\s*\.board-scope \.board-controls \.bfind \{ gap: 0; \}/);
  });

  it('review: a tree row shrinks its title, never its numbers; the running shimmer repeats so no letter goes unpainted; the status line is one line', () => {
    const css = read('agents/agentsSurface.css');
    expect(css).toMatch(/\.ags-row:has\(\.ags-desc\) > \.ags-label \{ flex: 0 0 auto; max-width: 70%; \}/);
    expect(css).toMatch(/\.ags-row > \.ags-meta \{ flex: none; margin-left: 0; white-space: nowrap; \}/);
    expect(css).toMatch(/\.ags \.ags-label\.shimmer-text \{[^}]*background-repeat: repeat-x;/);
    const ac = read('activity/activity.css');
    expect(ac).toMatch(/\.ac-head-sub \.ac-needs \{ white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/);
    expect(ac).toMatch(/\.ac-ed-short \{ display: none; \}/);
  });

  it('re-review: the detail line is one line with its full text on hover; a subagent row gives way in its definition before its name', () => {
    const css = read('agents/agentsSurface.css');
    expect(css).toMatch(/\.ags-detail-t \{[^}]*white-space: nowrap;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
    expect(css).toMatch(/\.ags-row > \.ags-desc \{ flex: 1 1 0; min-width: 0; \}/);
    expect(css).not.toMatch(/min-width: 4ch/);
  });
});
