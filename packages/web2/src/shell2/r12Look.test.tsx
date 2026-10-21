import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns, type AgentRun } from '../agents/agentRuns';
import { tabStatus } from '../app/chromeTabStrip';
import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import { S2Icon } from './icons';

/*
 * ROUND 12, lane "look" (Jaden 10-08): the surface bar's dot is for a surface that
 * is working, the selected pill is an outline, icons only at a narrow column and
 * the bar scrolls under a drag; the status bar never leaves the chat box; the
 * mode icon and the agent icon are one box; the Windows controls keep their strip.
 */
const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8').replace(/\r\n/g, '\n');
const shell = read('shell2.css');
const menu = read('modelMenu.css');
const body = (sheet: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...sheet.matchAll(new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join('\n');
};
const freshStore = () => createStore({ project: (g) => seqdFromGraph(g, g.nodeDetail), tokens: readShellTokens(document.documentElement), persisted: readShellPersisted() });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  agentRuns.patch((s) => ({ ...s, runs: [] }));
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
});

describe('the surface bar dot (B9)', () => {
  const idle = { running: false, modelDrawn: new Set(['architecture' as const]), pendingEdits: 0, pendingTopology: false };
  it('is only for a surface that is actively working', () => {
    expect(tabStatus('architecture', idle)).toBeNull();
    expect(tabStatus('architecture', { ...idle, running: true })).toBe('running');
    expect(tabStatus('agents', { ...idle, running: true })).toBeNull();
    expect(tabStatus('agents', { ...idle, agentsRunning: true })).toBe('running');
    expect(tabStatus('files', { ...idle, agentsRunning: true })).toBeNull();
  });

  it('an agent run lights the Agents pill and no other; stopping it clears the dot', () => {
    render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByTestId('s2-tab-agents'));
    expect(document.querySelectorAll('.s2-sp-dot')).toHaveLength(0);
    const run = { id: 'r1', sessionId: 's', agentRef: 'claude', nodeId: null, nodeLabel: null, prompt: 'x', status: 'running', startedAt: 1, endedAt: null, items: [], approvals: [], error: null } as unknown as AgentRun;
    act(() => agentRuns.patch((s) => ({ ...s, runs: [run] })));
    const dots = [...document.querySelectorAll('.s2-sp-dot')].map((d) => d.getAttribute('data-testid'));
    expect(dots).toEqual(['s2-sp-dot-agents']);
    act(() => agentRuns.patch((s) => ({ ...s, runs: [{ ...run, status: 'done' } as AgentRun] })));
    expect(document.querySelectorAll('.s2-sp-dot')).toHaveLength(0);
  });
});

describe('the surface bar at a narrow column (D13)', () => {
  it('round 13 (S1) reverts the narrow-column fold: no query hides a name or a close', () => {
    expect(shell).not.toMatch(/@container s2main \(max-width: 720px\) \{\s*\.s2-surfaces/);
    expect(shell).not.toMatch(/\.s2-surfaces:not\(\.is-compact\) \.s2-sp:not\(\.is-focused\) \.s2-sp-x \{\s*display: none;/);
  });

  it('every pill keeps its name as its accessible name and title, so icons-only is still readable', () => {
    render(<V3App appStore={freshStore()} />);
    const pill = screen.getByTestId('s2-tab-files');
    expect(pill.getAttribute('aria-label')).toBe('Files');
    expect(pill.getAttribute('title')).toMatch(/Files/);
  });

  it('scrolls under a pointer drag, as under the arrows, and the click that ends a drag is swallowed', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
    render(<V3App appStore={freshStore()} />);
    const bar = screen.getByTestId('s2-surfaces');
    Object.defineProperty(bar, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(bar, 'clientWidth', { configurable: true, value: 200 });
    bar.scrollLeft = 0;
    const pill = screen.getByTestId('s2-tab-files');
    /* jsdom has no PointerEvent: a MouseEvent of the pointer type carries the coordinates. */
    const ptr = (type: string, x: number) => act(() => void bar.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, button: 0 })));
    ptr('pointerdown', 300);
    ptr('pointermove', 240);
    expect(bar.getAttribute('data-dragging')).toBe('true');
    /* The write waits for the frame (0.1.6: one scroll write per frame). */
    await act(async () => {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
    });
    expect(bar.scrollLeft).toBe(60);
    ptr('pointerup', 240);
    const before = pill.getAttribute('aria-pressed');
    fireEvent.click(pill);
    expect(pill.getAttribute('aria-pressed')).toBe(before);
  });

  it('a plain click (no drag) still opens a surface', () => {
    render(<V3App appStore={freshStore()} />);
    const bar = screen.getByTestId('s2-surfaces');
    const ptr = (type: string, x: number) => act(() => void bar.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, button: 0 })));
    ptr('pointerdown', 100);
    ptr('pointerup', 100);
    fireEvent.click(screen.getByTestId('s2-tab-terminal'));
    expect(screen.getByTestId('s2-tab-terminal').getAttribute('aria-pressed')).toBe('true');
  });
  it('the CSS gives the bar a grab cursor and a drag state', () => {
    /* Grab only when the bar can actually scroll. */
    expect(body(shell, '.s2-surfaces')).not.toMatch(/cursor/);
    expect(body(shell, ".s2-surfaces[data-scrollable='true']")).toMatch(/cursor:\s*grab/);
    expect(shell).toMatch(/\.s2-surfaces\[data-dragging='true'\] \{[^}]*cursor:\s*grabbing/);
  });
});

describe('the Windows controls strip (D12)', () => {
  it('the top bar reserves 138 px at the right on Windows', () => {
    expect(shell).toMatch(/--win-controls-w:\s*138px;/);
    /* Only where the controls render: a browser build keeps its whole bar. */
    expect(body(shell, ".s2[data-platform='win'] .s2-topb:has(.shell-winctl)")).toMatch(/padding-right:\s*var\(--win-controls-w\)/);
    expect(shell).not.toMatch(/\.s2\[data-platform='win'\] \.s2-topb \{/);
    expect(body(shell, ".s2[data-platform='win'] .s2-topb .shell-winctl")).toMatch(/position:\s*absolute/);
  });
  it('the shell marks its platform for that rule', () => {
    render(<V3App appStore={freshStore()} />);
    expect(['win', 'mac']).toContain(screen.getByTestId('shell').getAttribute('data-platform'));
  });
});

describe('the status bar stays inside the chat box (A3)', () => {
  it('every item can shrink, text ellipsises, the bar is capped at its own width', () => {
    expect(body(shell, '.s2-status')).toMatch(/max-width:\s*100%/);
    expect(body(shell, '.s2-status')).toMatch(/min-width:\s*0/);
    const text = body(shell, '.s2-sb-state,\n.s2-status .s2-sb-x > span:not(.s2-sb-dot):not(.s2-sb-icon):not(.s2-sb-ring)');
    expect(text).toMatch(/overflow:\s*hidden/);
    expect(text).toMatch(/text-overflow:\s*ellipsis/);
    expect(body(shell, ".s2-status > .s2-sb-x:has([data-testid='s2-status-model'])")).toMatch(/flex:\s*0 0 auto/);
    expect(body(shell, '.s2-status > .s2-sb-x')).toMatch(/min-width:\s*0/);
    expect(body(shell, '.s2-status > .s2-sb-x')).toMatch(/overflow:\s*hidden/);
    /* The ring keeps its size and its popover stays visible. */
    expect(body(shell, '.s2-status > .s2-sb-x:has(.s2-sb-ring)')).toMatch(/flex:\s*none/);
    expect(body(shell, '.s2-status > .s2-sb-x:has(.s2-sb-ring)')).toMatch(/overflow:\s*visible/);
  });
  it('the state label is a span the bar can truncate', () => {
    render(<V3App appStore={freshStore()} />);
    const state = screen.getByTestId('s2-status-state');
    state.textContent = `Running ${'pnpm --filter x test '.repeat(20)}`;
    expect(state.tagName).toBe('SPAN');
    expect(state.className).toContain('s2-sb-state');
  });
});

describe('the mode icon and the agent icon are one box (A4, A5)', () => {
  it('both are the same square, from one token', () => {
    expect(body(menu, ':root')).toMatch(/--pill-ico:\s*var\(--sp-16\)/);
    const both = body(menu, '.s2-pillbar .s2-mode-ico,\n.s2-pillbar .s2-brand,\n.s2-pillbar .s2-pb > .s2-i');
    expect(both).toMatch(/width:\s*var\(--pill-ico\)/);
    expect(both).toMatch(/height:\s*var\(--pill-ico\)/);
  });
  it('the shared Smart shield is untouched (ConfirmDialog and Settings use it); the pill scales it locally', () => {
    const { container } = render(<S2Icon name="shield" />);
    expect(container.querySelector('path')?.getAttribute('transform')).toBeNull();
    expect(menu).toMatch(/\.s2-pillbar \.s2-mode-ico > \.s2-i,\n\.s2-mi-mode \.s2-mode-ico > \.s2-i \{[^}]*transform:[^;]*scale\(var\(--mode-glyph-scale\)\)/);
    expect(menu).toMatch(/--mode-glyph-scale:\s*1\.22;/);
  });
  it('the pill prints no mode word: icon only, the word is the accessible name', () => {
    render(<V3App appStore={freshStore()} />);
    const trigger = screen.getByTestId('s2-mode-trigger');
    expect(trigger.getAttribute('aria-label')).toMatch(/^Mode: /);
    const label = trigger.querySelector('[data-testid="v3-mode-label"]');
    expect(label?.className).toContain('s2-sr');
    expect(trigger.querySelectorAll('.s2-mode-ico svg')).toHaveLength(1);
  });
  it('the popup reflects the real mode: the row for the current mode is the one marked on', () => {
    render(<V3App appStore={freshStore()} />);
    const trigger = screen.getByTestId('s2-mode-trigger');
    const current = trigger.getAttribute('data-mode')!;
    fireEvent.click(trigger);
    const rows = [...document.querySelectorAll('[data-testid^="s2-quickmode-"][data-mode]')];
    expect(rows.map((r) => r.getAttribute('data-mode'))).toHaveLength(4); // Plan, Smart, Full auto, Teach (0.1.8)
    expect(rows.filter((r) => r.classList.contains('is-on')).map((r) => r.getAttribute('data-mode'))).toEqual([current]);
  });
});

describe('the chat reads as a left-aligned column (A2)', () => {
  const chat2 = read('chat2.css');
  it('the transcript column, composer strip and empty state start at the left and read from the left', () => {
    const col = body(chat2, '.s2-chat .chat-scope .tcol,\n.s2-chat .chat-scope .composerwrap .inner,\n.s2-chat .chat-scope .session-home,\n.s2-chat .chat-scope .undercomposer');
    expect(col).toMatch(/margin-left:\s*0;/);
    expect(col).toMatch(/margin-right:\s*auto;/);
    expect(col).toMatch(/text-align:\s*left;/);
    expect(body(chat2, '.s2-chat .chat-scope .emptychat')).toMatch(/text-align:\s*left;/);
  });
  it('no rule centres the text of a message', () => {
    for (const sheet of ['chat2.css', '../chat/chat.css', '../chat/agentRun.css', '../chat/toolRows.css']) {
      const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/([^{}]+)\{[^{}]*text-align:\s*center[^{}]*\}/g)) {
        expect(m[1]!.trim(), `${sheet} centres ${m[1]!.trim()}`).not.toMatch(/prose|\.msg|\.turn|transcript|\.tcol|answer/);
      }
    }
  });
});
