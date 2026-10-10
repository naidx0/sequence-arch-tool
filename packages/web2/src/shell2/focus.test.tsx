import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunStore, type AgentRun } from '../agents/agentRuns';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';
import chat2 from './chat2.css?raw';
import { ConfirmDialog } from './ConfirmDialog';
import { Takeover } from './Takeover';

/* WHERE FOCUS GOES (UX audit, item 3): Esc closes a menu and gives focus back
   to its trigger; the palette gives focus back to what had it; the takeover
   takes focus and gives it back to the composer; a confirmation traps Tab; the
   composer's field shows B's accent ring. */

beforeEach(() => {
  localStorage.clear();
  document.documentElement.setAttribute('data-platform', 'win');
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => vi.unstubAllGlobals());

describe('menus answer Escape', () => {
  it("the chat's More menu: opens on its first item, Escape closes it and focuses More again", () => {
    render(<V3App appStore={createStore({})} />);
    const more = screen.getByTestId('s2-chat-more');
    more.focus();
    fireEvent.click(more);
    /* Round 11: the menu now opens on the palette-only doors (search, review, rewind, help), then Agents. */
    expect(document.activeElement).toBe(screen.getByTestId('s2-chat-menu-overlay.search'));
    expect(screen.getByTestId('v3-agents-toggle')).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByTestId('v3-agents-toggle')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("a chat row's actions menu: Escape closes it and focuses its trigger", () => {
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: 'c1', title: 'Rate limits', pinned: false, updatedAt: new Date().toISOString() }], activeId: 'c1' } as never);
    render(<V3App appStore={store} />);
    const trigger = screen.getByRole('button', { name: 'Actions for Rate limits' });
    trigger.focus();
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(menu.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('the palette gives focus back', () => {
  it('Ctrl+K from the composer, then Escape: the composer has focus again', () => {
    render(<V3App appStore={createStore({})} />);
    const field = screen.getByTestId('composer-field');
    field.focus();
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    expect(screen.getByTestId('command-surface')).toBeTruthy();
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByTestId('command-surface')).toBeNull();
    expect(document.activeElement).toBe(field);
  });
});

function pendingRun(): AgentRun {
  return {
    id: 'r1',
    sessionId: 's1',
    agentRef: 'codex',
    nodeId: null,
    nodeLabel: null,
    prompt: 'Run the tests',
    startedAt: 0,
    endedAt: null,
    error: null,
    access: 'ask',
    status: 'running',
    items: [],
    approvals: [
      {
        requestId: 'q1',
        title: 'Run npm test',
        toolKind: 'execute',
        toolCallId: null,
        decision: null,
        answeredBy: null,
        sending: null,
        always: 'npm test',
        proposal: { proposalId: 'p1', title: 'Run npm test', rationale: null, files: [] },
      },
    ],
  } as unknown as AgentRun;
}

describe('the takeover holds focus while it asks', () => {
  it('an approval focuses Yes; once it is answered, the composer has focus', () => {
    const store = createAgentRunStore();
    store.patch((s) => ({ ...s, runs: [pendingRun()] }));
    render(
      <>
        <textarea data-testid="composer-field" />
        <Takeover store={store} sessionId="s1" repoRoot={null} draftKept={false} />
      </>,
    );
    expect(document.activeElement).toBe(screen.getByTestId('s2-takeover-yes'));
    act(() => {
      store.patch((s) => ({ ...s, runs: s.runs.map((r) => ({ ...r, approvals: r.approvals.map((a) => ({ ...a, decision: 'allow' as const })) })) }));
    });
    expect(screen.queryByTestId('s2-takeover')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('composer-field'));
  });
});

describe('a confirmation is modal for real', () => {
  it('focus starts on Cancel, Tab stays inside, and closing gives focus back', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(<ConfirmDialog title="Delete chat?" confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />);
    const cancel = screen.getByTestId('s2-confirm-cancel');
    const ok = screen.getByTestId('s2-confirm-ok');
    expect(document.activeElement).toBe(cancel);
    ok.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe("the composer's field shows a focus ring", () => {
  it("B's accent ring when the field has focus", () => {
    const at = chat2.indexOf('.s2-comp:has(.s2-ta:focus)');
    expect(at).toBeGreaterThan(0);
    expect(chat2.slice(at, chat2.indexOf('}', at))).toMatch(/box-shadow:[^;]*0 0 0 3px var\(--b-accw\)/);
  });
});
