import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoSessionsSection, SessionIndexEntry } from '@sequence/api-types';

import type { GetArchGraphResponse } from '@sequence/api-types';
import { summarizeGraph } from '../boot';
import { seqdFromGraph } from '../canvas';
import { LIVE_PILLS } from '../app/chromeTabModel';
import { readShellPersisted, readShellTokens } from '../shell';
import { createSessionsClient } from '../sessions/sessionsClient';
import type { SkillsView } from '../settings/settingsClient';
import { createStore, StoreProvider, type Store } from '../state';
import { V3App } from '../v3/V3App';
import { SNAP_FRAMES, SNAP_PX, frameOf, nextFrame, snapToFrame } from './layoutPrefs';
import { SessionPanel } from './SessionPanel';
import cssRaw from './shell2.css?raw';
import { seedOpenArchitecture } from './legacyDefaultTabs.testSupport';

/*
 * ROUND 9, Jaden's third walkthrough, the home screen slice:
 *   1  "The surface icons at the top do nothing" (all surfaces closed).
 *   2  "The floating background overlaps... it must not block access."
 *   8  "Expanding many section cards pushes Settings under the status bar."
 *   9  "The session rail and main chat overhang the status bar, and it isn't
 *      centered on the screen."
 *   19 "Follow DeepSeek: the harness name at top, then the folders you're
 *      working in, chats, skills and so on. Everything transparent,
 *      scrollable and animated."
 *   21 "Dragging dividers left and right snaps to lock frames."
 * jsdom has no layout and no drag region: the rendered half (real clicks
 * through the window's drag-region walk, the rail's bottom against the
 * status bar, the snap under a real pointer) is e2e/home-screen.mjs.
 */

const css = cssRaw.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
/** Every top-level declaration for exactly `sel`, in sheet order (later ones win where they repeat). */
const lastRule = (sel: string): string => {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let body = '';
  for (let m = re.exec(css); m; m = re.exec(css)) if (m[1]!.trim() === sel) body += m[2]!;
  return body;
};

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

beforeEach(() => {
  localStorage.clear();
  seedOpenArchitecture();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

function closeAll() {
  for (const id of LIVE_PILLS) {
    const x = screen.queryByTestId(`v3-tab-close-${id}`);
    if (x) fireEvent.click(x);
  }
}

describe('item 1: the home screen icons are never under a drag strip', () => {
  it('with no surface open the icons sit in the bar between two drag strips, not floated over one', () => {
    render(<V3App appStore={freshStore()} />);
    closeAll();
    expect(screen.getByTestId('shell').getAttribute('data-home')).toBe('true');
    const bar = screen.getByTestId('s2-topbar');
    const nav = within(bar).getByRole('navigation', { name: 'Workspace' });
    /* The names and their scroll chevrons share one wrapper (round 11); the wrapper is what sits between the strips. */
    const wrap = nav.parentElement!;
    expect(wrap.getAttribute('data-testid')).toBe('s2-surfaces-wrap');
    const kids = [...bar.children];
    const lead = screen.getByTestId('s2-drag-lead');
    /* A drag strip each side of the icons, both BEFORE them in tree order (0.1.6): the drag region is built in document
       order and a later region wins, so the icons (centred over the strips) must be the later one, and nothing that
       drags may come after them AND cover them. */
    const strips = kids.filter((k) => k.classList.contains('s2-drag'));
    expect(strips.length).toBe(2);
    expect(strips[0]).toBe(lead);
    for (const s of strips) expect(kids.indexOf(s)).toBeLessThan(kids.indexOf(wrap));
    expect(wrap.nextElementSibling?.classList.contains('s2-drag') ?? false).toBe(false);
    /* The icons are in the flow: no rule floats them over the bar any more. */
    expect(lastRule(".s2-row[data-stage='none'] .s2-surfaces")).not.toMatch(/position:\s*absolute/);
    expect(css).not.toMatch(/\.s2-row\[data-stage='none'\] \.s2-surfaces \{[^}]*translateX/);
  });

  it('each icon opens its surface from the home screen; closing it comes home', () => {
    render(<V3App appStore={freshStore()} />);
    closeAll();
    for (const id of LIVE_PILLS) {
      fireEvent.click(screen.getByTestId(`s2-tab-${id}`));
      expect(document.querySelector(`[data-surface-pane="${id}"]`)).not.toBeNull();
      expect(screen.getByTestId('shell').getAttribute('data-home')).toBeNull();
      expect(screen.queryByTestId('s2-drag-lead')).toBeNull();
      fireEvent.click(screen.getByTestId(`v3-tab-close-${id}`));
      expect(screen.getByTestId('shell').getAttribute('data-home')).toBe('true');
    }
  });
});

describe('item 2: the ASCII ground is the window\'s, behind everything, and takes no click', () => {
  it('is the shell\'s first layer, before the cards and the status bar', async () => {
    render(<V3App appStore={freshStore()} />);
    closeAll();
    const bd = await screen.findByTestId('s2-ascii-backdrop', {}, { timeout: 3000 });
    expect(bd.parentElement).toBe(screen.getByTestId('shell'));
    expect(bd.getAttribute('aria-hidden')).toBe('true');
  });

  it('never takes a pointer, and paints under the window\'s own content', () => {
    expect(lastRule('.s2-backdrop')).toMatch(/pointer-events:\s*none;/);
    expect(lastRule('.s2-app > .s2-backdrop')).toMatch(/z-index:\s*-1;/);
    expect(lastRule('.s2.s2-app')).toMatch(/isolation:\s*isolate;/);
  });
});

describe('items 8 and 9: the sidebar never outgrows its slot; the status bar is clear and centred', () => {
  it('the sidebar card is held to its slot and its sections scroll', () => {
    expect(lastRule('.s2-panel')).toMatch(/min-height:\s*0;/);
    expect(lastRule('.s2-panel')).toMatch(/max-height:\s*100%;/);
    expect(lastRule('.s2-panel-slot')).toMatch(/min-height:\s*0;/);
    expect(css).toMatch(/\.s2-groups \{[^}]*overflow-y:\s*auto;/);
    expect(lastRule('.s2-panel-foot')).toMatch(/flex:\s*none;/);
  });

  it('the cards stop a gap above the status bar, whose content is centred between the cards\' edges', () => {
    expect(lastRule('.s2-row:has(+ .s2-status)')).toMatch(/padding-bottom:\s*var\(--sp-4\);/);
    const bar = lastRule('.s2-status');
    expect(bar).toMatch(/justify-content:\s*center;/);
    expect(bar).toMatch(/margin:\s*0 var\(--sp-8\);/);
  });
});

describe('item 21: lock frames', () => {
  it('the frames are 25, 33, 50, 67 and 75 percent', () => {
    expect(SNAP_FRAMES.map((f) => Math.round(f * 100))).toEqual([25, 33, 50, 67, 75]);
  });

  it('the magnet pulls a ratio within the threshold onto the nearest frame, and leaves the rest', () => {
    const t = SNAP_PX / 1000;
    expect(snapToFrame(0.51, t)).toBe(0.5);
    expect(snapToFrame(0.32, t)).toBeCloseTo(1 / 3);
    expect(snapToFrame(0.42, t)).toBe(0.42);
    expect(snapToFrame(0.5 + t + 0.001, t)).toBeCloseTo(0.5 + t + 0.001);
  });

  it('names the frame a divider sits on, and none between frames', () => {
    expect(frameOf(0.5)).toBe(50);
    expect(frameOf(2 / 3)).toBe(67);
    expect(frameOf(0.667)).toBe(67);
    expect(frameOf(0.6)).toBeNull();
  });

  it('steps to the next frame inside the bounds, either way', () => {
    expect(nextFrame(0.5, 1, 0.2, 0.8)).toBeCloseTo(2 / 3);
    expect(nextFrame(0.42, -1, 0.2, 0.8)).toBeCloseTo(1 / 3);
    expect(nextFrame(0.75, 1, 0.2, 0.8)).toBeNull();
    expect(nextFrame(0.5, 1, 0.2, 0.6)).toBeNull();
  });

  it('the chat column\'s arrows still step 16 px where the room is not measured (no frames to jump to)', () => {
    render(<V3App appStore={freshStore()} />);
    const sizer = screen.getByTestId('s2-chat-sizer');
    const before = Number(sizer.getAttribute('aria-valuenow'));
    fireEvent.keyDown(sizer, { key: 'ArrowRight' });
    expect(Number(sizer.getAttribute('aria-valuenow'))).toBe(before + 16);
    expect(sizer.getAttribute('aria-keyshortcuts')).toMatch(/Shift\+ArrowLeft/);
  });
});

/* ── item 19: DeepSeek's sidebar ─────────────────────────────────────── */

const at = (h: number) => new Date(Date.UTC(2026, 9, 6, h)).toISOString();
const chat = (id: string, title: string, h: number): SessionIndexEntry => ({ id, title, createdAt: at(h), updatedAt: at(h) }) as SessionIndexEntry;

function wired(repos: RepoSessionsSection[], index: SessionIndexEntry[]) {
  const fetchImpl = (async (input: RequestInfo | URL) =>
    String(input) === '/api/sessions'
      ? new Response(JSON.stringify({ index: { version: 1, activeId: index[0]?.id ?? '', sessions: index }, scope: 'workspace', repos }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      : new Response('{}', { status: 404 })) as typeof fetch;
  return createSessionsClient(fetchImpl);
}

const SKILLS: SkillsView = {
  dir: '.sequence/skills',
  skills: [
    { slug: 'review', name: 'Code review', description: 'Review the diff' },
    { slug: 'release', name: 'Release notes', description: 'Write the notes' },
  ],
  warnings: [],
  trusted: true,
  instructions: null,
};

describe('item 19: the sidebar reads Sequence, then Workspaces (their chats under them) and Skills', () => {
  function mount(repoPath: string | null) {
    const store = freshStore();
    if (repoPath) {
      const graph = { repoName: 'shopfront', scannedAt: at(1), nodes: [], edges: [], nodeDetail: {} } as unknown as GetArchGraphResponse;
      store.dispatch({ type: 'repo/loaded', draft: { root: repoPath, repoName: 'shopfront', graph, summary: summarizeGraph(graph), scannedAt: at(1) }, at: 1 });
    }
    const skillsSource = vi.fn(async () => SKILLS);
    const client = wired([{ path: 'C:/work/ticketing', name: 'ticketing', index: { version: 1, activeId: 't1', sessions: [chat('t1', 'Seat holds', 3)] } }], [chat('h1', 'Workspace notes', 5), chat('h2', 'Orders', 4)]);
    render(
      <StoreProvider store={store}>
        <SessionPanel client={client} skillsSource={skillsSource} />
      </StoreProvider>,
    );
    return { store, skillsSource };
  }

  it('the sections come in DeepSeek\'s order inside the one scroller, under the harness name', async () => {
    mount(null);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(2));
    const groups = screen.getByTestId('s2-groups');
    const order = [...groups.querySelectorAll('[data-testid^="s2-group-"]')].map((g) => g.getAttribute('data-testid'));
    /* No separate Chats section: every chat lives under its workspace folder. Skills moved under its navigation row (contract change, 0.1.8.4). */
    expect(order).toEqual(['s2-group-workspaces']);
    expect(screen.getByTestId('s2-brand').textContent).toBe('Sequence');
    const home = screen.getAllByTestId('s2-project').find((p) => p.getAttribute('data-project') === 'Workspace')!;
    expect(within(home).getAllByTestId('s2-session').map((r) => r.textContent)).toEqual(['Workspace notes', 'Orders']);
    expect(within(home).queryByTestId('s2-project-count')).toBeNull(); /* 10 chats or fewer: no count */
    /* With no repository there are no skills to read; the Skills row's view says how to get some. */
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    /* The rail's lists load when a section opens (rail/RailBodyLazy.tsx), so the view arrives a tick after the click. */
    expect((await within(screen.getByTestId('rail-section')).findByTestId('s2-skills-empty', {}, { timeout: 8000 })).textContent).toMatch(/Open a project/);
  });

  it('every section folds from its header, animated, remembered, and out of the tab order while folded', async () => {
    mount(null);
    await waitFor(() => expect(screen.getAllByTestId('s2-project')).toHaveLength(2));
    const projects = screen.getByTestId('s2-group-workspaces');
    const head = within(projects).getByTestId('s2-section-workspaces');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(head);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(projects.getAttribute('data-folded')).toBe('true');
    const body = projects.querySelector('.s2-sec-body')!;
    expect(body.hasAttribute('inert')).toBe(true);
    expect(JSON.parse(localStorage.getItem('s2.sections') ?? '{}')).toEqual({ workspaces: true });
    /* The fold is a transition on the body's row, and it stands still under reduced motion. */
    expect(css).toMatch(/\.s2-sec-body \{[^}]*transition:\s*grid-template-rows/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.s2-sec-body,/);
    fireEvent.click(head);
    expect(body.hasAttribute('inert')).toBe(false);
  });

  it('the sidebar is transparent over the ground (no slab, no shadow)', () => {
    const panel = lastRule('.s2-panel');
    expect(panel).toMatch(/background:\s*color-mix\(in srgb, var\(--b-bg\) \d+%, transparent\);/);
    expect(panel).toMatch(/box-shadow:\s*none;/);
  });

  it('a project lists its skills; one click puts the skill in the composer', async () => {
    const { store, skillsSource } = mount('C:/work/shopfront');
    /* Contract change (0.1.8.4): the skills sit under the Skills navigation row, not in a folding group. */
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    await waitFor(() => expect(screen.getAllByTestId('s2-skill')).toHaveLength(2));
    expect(skillsSource).toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId('rail-section')).getByText('Code review'));
    expect(store.getState().composer.draft).toBe('/review ');
  });

  it('Worktrees folds like Skills (owner 0.1.5, G5: not forced open), and stays folded', async () => {
    mount('C:/work/shopfront');
    const head = await waitFor(() => within(screen.getByTestId('s2-group-worktrees')).getByTestId('s2-section-worktrees'));
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(head);
    expect(screen.getByTestId('s2-group-worktrees').getAttribute('data-folded')).toBe('true');
    expect(head.getAttribute('aria-expanded')).toBe('false');
    /* The new-worktree-chat button stays on the header, folded or not. */
    expect(within(screen.getByTestId('s2-group-worktrees')).getByLabelText('New chat in a worktree')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('s2.sections') ?? '{}').worktrees).toBe(true);
  });
});
