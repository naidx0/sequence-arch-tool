import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from '../v3/V3App';
import { BOARD_MIN, CHAT_DEFAULT, CHAT_MAX, CHAT_MIN, NARROW_W, roomFor } from './layoutPrefs';
import { seedOpenArchitecture } from './legacyDefaultTabs.testSupport';

/** 0.1.8.1 C1: a plain click switches the stage; these cases open surfaces BESIDE each other, which is Ctrl/Cmd+click. */
const BESIDE = { ctrlKey: true } as const;

/*
 * THE SHELL'S LAYOUT BEHAVIOUR (Decision 49 keeps DeepSeek's, in B's look).
 * Ported from the shell they replaced (v3/shell3b.test.tsx: the remembered
 * chat width; v3/agentsNarrow.test.tsx: the Agents panel by window width) to
 * the new controls:
 *   the chat column and the split dock resize on a hairline separator, the
 *   chat at 400 px at the least and the split 20 to 80 percent, both kept;
 *   Mod+B and the panel title row's button collapse the sidebar, kept;
 *   below 1024 px the sidebar folds and a segmented control switches
 *   between the chat and the workspace (and Agents, while it is open),
 *   without remounting the composer.
 */

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

function setWidth(w: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
}

beforeEach(() => {
  localStorage.clear();
  seedOpenArchitecture();
  document.documentElement.setAttribute('data-platform', 'win');
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  setWidth(1440);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setWidth(1024);
});

const chatCol = () => document.querySelector<HTMLElement>('.v3-chat-col')!;
const railSlot = () => document.querySelector<HTMLElement>('.v3-rail-slot')!;
const railShut = () => railSlot().getAttribute('data-collapsed') === 'true';
const mainCol = () => document.querySelector<HTMLElement>('.s2-mainp')!;
const panes = () => [...document.querySelectorAll<HTMLElement>('.s2-pane[data-surface-pane]')];

/** A pointer drag along x, from the handle, finished on the window. */
function dragBy(handle: HTMLElement, dx: number) {
  /* jsdom has no PointerEvent; React reads a MouseEvent of that type the same way. */
  act(() => {
    handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 500 }));
  });
  act(() => {
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 500 + dx }));
  });
  act(() => {
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: 500 + dx }));
  });
}

describe('the chat column resizes on its hairline, and keeps the width', () => {
  it("starts at B's 420 px; keeps a width the reader chose; never below 400", () => {
    expect(CHAT_DEFAULT).toBe(420);
    expect(CHAT_MIN).toBe(400);
    const first = render(<V3App appStore={freshStore()} />);
    expect(chatCol().style.width).toBe('420px');
    first.unmount();

    localStorage.setItem('v3.chatW', '600');
    const second = render(<V3App appStore={freshStore()} />);
    expect(chatCol().style.width).toBe('600px');
    second.unmount();

    localStorage.setItem('v3.chatW', '250');
    render(<V3App appStore={freshStore()} />);
    expect(chatCol().style.width).toBe('400px');
  });

  it('is a separator the arrow keys step, Home and End bound, and the width is remembered', () => {
    render(<V3App appStore={freshStore()} />);
    const sizer = screen.getByRole('separator', { name: 'Resize chat column' });
    expect(sizer.getAttribute('aria-valuemin')).toBe(String(CHAT_MIN));
    expect(sizer.getAttribute('aria-valuemax')).toBe(String(CHAT_MAX));
    expect(sizer.getAttribute('aria-valuenow')).toBe('420');
    fireEvent.keyDown(sizer, { key: 'ArrowRight' });
    expect(chatCol().style.width).toBe('436px');
    expect(localStorage.getItem('v3.chatW')).toBe('436');
    fireEvent.keyDown(sizer, { key: 'Home' });
    expect(chatCol().style.width).toBe('400px');
    fireEvent.keyDown(sizer, { key: 'ArrowLeft' });
    expect(chatCol().style.width).toBe('400px');
    fireEvent.keyDown(sizer, { key: 'End' });
    expect(sizer.getAttribute('aria-valuenow')).toBe(String(CHAT_MAX));
  });

  it('a drag moves the edge with the pointer, stops at 400, and is remembered when it ends', () => {
    render(<V3App appStore={freshStore()} />);
    const sizer = screen.getByTestId('s2-chat-sizer');
    dragBy(sizer, 60);
    expect(chatCol().style.width).toBe('480px');
    expect(localStorage.getItem('v3.chatW')).toBe('480');
    dragBy(sizer, -300);
    expect(chatCol().style.width).toBe('400px');
    expect(localStorage.getItem('v3.chatW')).toBe('400');
  });

  it('the handle is a hairline that shows on hover (no resting chrome)', async () => {
    const { default: css } = (await import('./shell2.css?raw')) as { default: string };
    expect(css).toMatch(/\.s2-sizer::after,\s*\.s2-divider::after \{[^}]*width: 2px;[^}]*opacity: 0;/);
    expect(css).toMatch(/\.s2-sizer:hover::after,[\s\S]*?\{\s*opacity: 0\.7;/);
    expect(css).toMatch(/\.s2-chat \{\s*min-width: 400px;/);
  });
});

describe('the split dock divides on its hairline, 20 to 80 percent, remembered', () => {
  it('one surface has no divider; two share the stage half and half', () => {
    render(<V3App appStore={freshStore()} />);
    expect(panes()).toHaveLength(1);
    expect(screen.queryByTestId('s2-split-divider')).toBeNull();
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    expect(panes()).toHaveLength(2);
    const divider = screen.getByRole('separator', { name: 'Resize split' });
    expect(divider.getAttribute('aria-valuenow')).toBe('50');
    expect(panes()[0]!.style.flex).toBe('0.5 1 0px');
    expect(panes()[1]!.style.flex).toBe('0.5 1 0px');
    /* The divider sits between the two panes. */
    expect(panes()[0]!.nextElementSibling).toBe(divider);
  });

  /* Round 9 (Jaden: "dragging dividers... snaps to lock frames (25%, 33%, 50%...)"):
     the arrows jump frame to frame, Shift+arrow steps 1, Home and End are the bounds. */
  it('arrows walk the lock frames, Shift+arrow steps 1, and it stops at 20 and 80; the share is remembered', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    const divider = screen.getByTestId('s2-split-divider');
    expect(divider.getAttribute('data-frame')).toBe('50');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider.getAttribute('aria-valuenow')).toBe('67');
    expect(divider.getAttribute('aria-valuetext')).toBe('67 percent');
    expect(localStorage.getItem('s2.split')).toBe('0.667');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider.getAttribute('aria-valuenow')).toBe('75');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider.getAttribute('aria-valuenow')).toBe('80');
    expect(divider.getAttribute('data-frame')).toBeNull();
    fireEvent.keyDown(divider, { key: 'ArrowLeft', shiftKey: true });
    expect(divider.getAttribute('aria-valuenow')).toBe('79');
    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(divider.getAttribute('aria-valuenow')).toBe('75');
    fireEvent.keyDown(divider, { key: 'Home' });
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider.getAttribute('aria-valuenow')).toBe('25');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider.getAttribute('aria-valuenow')).toBe('33');
    fireEvent.keyDown(divider, { key: 'End' });
    expect(divider.getAttribute('aria-valuenow')).toBe('80');
    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(divider.getAttribute('aria-valuenow')).toBe('80');
    fireEvent.keyDown(divider, { key: 'Home' });
    expect(divider.getAttribute('aria-valuenow')).toBe('20');
    expect(panes()[1]!.style.flex).toBe('0.8 1 0px');
  });

  it('a drag moves it by the pointer over the stage width, clamped; a remembered share comes back', () => {
    const real = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('s2-stage')) return { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, toJSON: () => ({}) } as DOMRect;
      return real.call(this);
    });
    const first = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    dragBy(screen.getByTestId('s2-split-divider'), 100);
    expect(screen.getByTestId('s2-split-divider').getAttribute('aria-valuenow')).toBe('60');
    expect(localStorage.getItem('s2.split')).toBe('0.6');
    /* The magnet: let go 12 px short of two thirds and it sits on two thirds; 20 px short it does not. */
    dragBy(screen.getByTestId('s2-split-divider'), 667 - 600 - 12);
    expect(localStorage.getItem('s2.split')).toBe('0.667');
    dragBy(screen.getByTestId('s2-split-divider'), -667 + 500 + 20);
    expect(localStorage.getItem('s2.split')).toBe('0.52');
    dragBy(screen.getByTestId('s2-split-divider'), 700);
    expect(screen.getByTestId('s2-split-divider').getAttribute('aria-valuenow')).toBe('80');
    first.unmount();

    localStorage.setItem('s2.split', '0.3');
    render(<V3App appStore={freshStore()} />);
    expect(panes()[0]!.style.flex).toBe('0.3 1 0px');
    expect(panes()[1]!.style.flex).toBe('0.7 1 0px');
  });
});

describe('the sidebar collapses (Mod+B, or the title row button) and the choice is kept', () => {
  it("the panel title row's button collapses it; the chat header's button brings it back", () => {
    render(<V3App appStore={freshStore()} />);
    expect(railShut()).toBe(false);
    const collapse = screen.getByTestId('s2-sidebar-collapse');
    expect(collapse.closest('.s2-ph')).not.toBeNull();
    expect(collapse.getAttribute('aria-label')).toBe('Hide sidebar');
    fireEvent.click(collapse);
    expect(railShut()).toBe(true);
    expect(screen.queryByTestId('s2-sidebar-collapse')).toBeNull();
    expect(localStorage.getItem('v3.railCollapsed')).toBe('1');
    const open = screen.getByTestId('s2-sidebar-open');
    expect(open.closest('.s2-ch')).not.toBeNull();
    fireEvent.click(open);
    expect(railShut()).toBe(false);
    expect(localStorage.getItem('v3.railCollapsed')).toBe('0');
  });

  it('Mod+B toggles it, from the page and from the composer; a collapsed sidebar stays collapsed on the next load', () => {
    const first = render(<V3App appStore={freshStore()} />);
    act(() => {
      fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    });
    expect(railShut()).toBe(true);
    act(() => {
      fireEvent.keyDown(screen.getByTestId('composer-field'), { key: 'b', ctrlKey: true });
    });
    expect(railShut()).toBe(false);
    act(() => {
      fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    });
    first.unmount();
    render(<V3App appStore={freshStore()} />);
    expect(railShut()).toBe(true);
  });
});

describe('a narrow window (below 1024 px)', () => {
  it('the boundary is 1024: at 1023 the sidebar folds and a Chat | Workspace switch shows the chat; at 1024 neither', () => {
    expect(NARROW_W).toBe(1024);
    setWidth(1024);
    const wide = render(<V3App appStore={freshStore()} />);
    expect(screen.queryByTestId('s2-narrow-switch')).toBeNull();
    expect(railShut()).toBe(false);
    wide.unmount();

    setWidth(1023);
    render(<V3App appStore={freshStore()} />);
    expect(railShut()).toBe(true);
    const sw = screen.getByRole('tablist', { name: 'Chat or workspace' });
    expect([...sw.querySelectorAll('[role="tab"]')].map((t) => t.textContent)).toEqual(['Chat', 'Workspace']);
    expect(screen.getByTestId('s2-narrow-chat').getAttribute('aria-selected')).toBe('true');
    expect(chatCol().hidden).toBe(false);
    expect(mainCol().hidden).toBe(true);
    /* No resize handle where there is one column. */
    expect(screen.queryByTestId('s2-chat-sizer')).toBeNull();
  });

  it('the switch shows the workspace and back without remounting the composer', () => {
    setWidth(900);
    render(<V3App appStore={freshStore()} />);
    const field = screen.getByTestId('composer-field');
    fireEvent.click(screen.getByTestId('s2-narrow-stage'));
    expect(chatCol().hidden).toBe(true);
    expect(mainCol().hidden).toBe(false);
    expect(screen.getByTestId('s2-narrow-stage').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('s2-narrow-chat'));
    expect(chatCol().hidden).toBe(false);
    expect(screen.getByTestId('composer-field')).toBe(field);
  });

  it('Mod+B opens the sidebar over the chat, Escape puts it away, and the stored choice is not touched', () => {
    setWidth(900);
    render(<V3App appStore={freshStore()} />);
    act(() => {
      fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    });
    expect(railShut()).toBe(false);
    expect(railSlot().classList.contains('is-overlay')).toBe(true);
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(railShut()).toBe(true);
    expect(localStorage.getItem('v3.railCollapsed')).toBeNull();
    /* The bar's own button does the same. */
    fireEvent.click(screen.getByTestId('s2-sidebar-open'));
    expect(railSlot().classList.contains('is-overlay')).toBe(true);
  });

  it('crossing 1024 either way keeps the composer mounted', () => {
    render(<V3App appStore={freshStore()} />);
    const field = screen.getByTestId('composer-field');
    act(() => {
      setWidth(900);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('s2-narrow-switch')).toBeTruthy();
    expect(screen.getByTestId('composer-field')).toBe(field);
    act(() => {
      setWidth(1300);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.queryByTestId('s2-narrow-switch')).toBeNull();
    expect(railShut()).toBe(false);
    expect(screen.getByTestId('composer-field')).toBe(field);
  });
});

describe('the Agents panel by window width', { timeout: 20_000 }, () => {
  const openAgents = () => {
    fireEvent.click(screen.getByTestId('s2-chat-more'));
    act(() => fireEvent.click(screen.getByTestId('v3-agents-toggle')));
  };

  /* UX audit: a dock never squeezes the board below BOARD_MIN (420). The
     sidebar gives way first; a dock that still does not fit floats over the
     board. With the chat at 420, the panel at 232, the Agents dock (360) and
     round 7's 8 px of ground around and between the cards (16 + 8 + 8 + 8),
     the Agents dock fits beside the board from 1472 up. */
  it('the open dock takes the sidebar room only when the board would go below 420, and gives it back when it closes', () => {
    expect(BOARD_MIN).toBe(420);
    setWidth(1470);
    const tight = render(<V3App appStore={freshStore()} />);
    openAgents();
    expect(screen.getByTestId('v3-agents-dock').getAttribute('data-overlay')).toBeNull();
    expect(railShut()).toBe(true);
    openAgents();
    expect(screen.queryByTestId('v3-agents-dock')).toBeNull();
    expect(railShut()).toBe(false);
    tight.unmount();

    localStorage.clear();
    seedOpenArchitecture();
    setWidth(1472);
    render(<V3App appStore={freshStore()} />);
    openAgents();
    expect(screen.getByTestId('v3-agents-dock')).toBeTruthy();
    expect(railShut()).toBe(false);
  });

  it('where folding the sidebar is not enough, the Agents dock takes the stage\'s place, never floats over it (round 7, A7)', async () => {
    /* Jaden: "It transpons all the other screens." The dock is never an overlay:
       with no room beside the board it stands in for the stage until closed. */
    setWidth(1100);
    render(<V3App appStore={freshStore()} />);
    openAgents();
    const dock = screen.getByTestId('v3-agents-dock');
    expect(dock.getAttribute('data-overlay')).toBeNull();
    expect(dock.classList.contains('is-overlay')).toBe(false);
    expect(dock.getAttribute('data-swap')).toBe('true');
    /* The dock's own chunk loads when it opens. */
    expect(await screen.findByTestId('agents-dock', {}, { timeout: 10_000 })).toBeTruthy(); /* lazy chunk: slow under a full parallel run */
    const stage = document.querySelector('main.s2-mainp') as HTMLElement;
    expect(stage.hidden).toBe(true);
    expect(railShut()).toBe(true);
    openAgents();
    expect(screen.queryByTestId('v3-agents-dock')).toBeNull();
    expect((document.querySelector('main.s2-mainp') as HTMLElement).hidden).toBe(false);
  });

  it('the rule, by numbers: the review dock at 1024 floats; at 1440 it docks once the sidebar folds', () => {
    /* 1024: 1024 - 16 - (208 + 8) - 420 - 8 = 364, under one board, let alone two. */
    expect(roomFor({ winW: 1024, chatW: 420, agentsOpen: false, panes: 2, review: true })).toEqual({ foldRail: true, agentsOverlay: false, reviewOverlay: true });
    /* 1440: 756 with the panel, 996 without it: two boards (840) fit. */
    expect(roomFor({ winW: 1440, chatW: 420, agentsOpen: false, panes: 2, review: true })).toEqual({ foldRail: true, agentsOverlay: false, reviewOverlay: false });
    /* One surface and no dock: nothing gives way (the negative control). */
    expect(roomFor({ winW: 1024, chatW: 420, agentsOpen: false, panes: 1, review: false })).toEqual({ foldRail: false, agentsOverlay: false, reviewOverlay: false });
    /* A wide chat counts: the reader's own width is what the board is left with
       (1920 - 16 - 240 - 860 - 8 - 368 = 428 with the panel). */
    expect(roomFor({ winW: 1920, chatW: 860, agentsOpen: true, panes: 1, review: false }).foldRail).toBe(false);
    expect(roomFor({ winW: 1920, chatW: 860, agentsOpen: true, panes: 2, review: false }).foldRail).toBe(true);
    /* The ground is counted: 8 px less room than the cards' widths alone and the panel folds. */
    expect(roomFor({ winW: 1920, chatW: 868, agentsOpen: true, panes: 1, review: false }).foldRail).toBe(false);
    expect(roomFor({ winW: 1920, chatW: 869, agentsOpen: true, panes: 1, review: false }).foldRail).toBe(true);
  });

  it('below 1024 Agents is a third view on the switch: opening shows it, Chat returns with the same composer, closing removes it', async () => {
    setWidth(900);
    render(<V3App appStore={freshStore()} />);
    const field = screen.getByTestId('composer-field');
    openAgents();
    expect(screen.queryByTestId('v3-agents-dock')).toBeNull();
    const view = screen.getByTestId('s2-agents-view');
    expect(view.hidden).toBe(false);
    await waitFor(() => expect(view.querySelector('[data-testid="agents-panel"]')).not.toBeNull(), { timeout: 10_000 });
    expect(screen.getByTestId('s2-narrow-agents').getAttribute('aria-selected')).toBe('true');
    expect(chatCol().hidden).toBe(true);
    fireEvent.click(screen.getByTestId('s2-narrow-chat'));
    expect(screen.getByTestId('s2-agents-view').hidden).toBe(true);
    expect(chatCol().hidden).toBe(false);
    expect(screen.getByTestId('composer-field')).toBe(field);
    fireEvent.click(screen.getByTestId('s2-narrow-agents'));
    openAgents();
    expect(screen.queryByTestId('s2-narrow-agents')).toBeNull();
    expect(screen.getByTestId('s2-narrow-chat').getAttribute('aria-selected')).toBe('true');
    expect(chatCol().hidden).toBe(false);
  });
});

describe('a sidebar folded for room still opens', () => {
  it('two surfaces at 1024 fold it; Show sidebar peeks it over the content without changing the stored choice; Escape puts it away', () => {
    setWidth(1024);
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-files'), BESIDE);
    expect(railShut()).toBe(true);
    fireEvent.click(screen.getByTestId('s2-sidebar-open'));
    expect(railShut()).toBe(false);
    expect(railSlot().classList.contains('is-overlay')).toBe(true);
    expect(localStorage.getItem('v3.railCollapsed')).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(railShut()).toBe(true);
  });
});
