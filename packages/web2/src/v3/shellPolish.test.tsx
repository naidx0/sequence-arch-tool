import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { seqdFromGraph } from '../canvas';
import { freezeWidths, tabStatus, TAB_MAX_W, TAB_MIN_W } from '../app/chromeTabStrip';
import { ToolCallCard, formatToolDuration } from '../chat/ToolCallCard';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import type { FileEditProposal } from '../state/types';
import { V3App } from './V3App';
import { ApprovalCard } from './V3Chat';
import { seedOpenArchitecture } from '../shell2/legacyDefaultTabs.testSupport';

/* OVERHAUL STREAM 3, S4 — the shell: Chrome-style tab strip, collapsible
   sidebar, chat cards that fold to one row, loading marks. */

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
  document.documentElement.setAttribute('data-platform', 'win');
  localStorage.clear();
  seedOpenArchitecture();
});

describe('the tab strip model', () => {
  const none = { running: false, modelDrawn: new Set<never>(), pendingEdits: 0, pendingTopology: false };

  it('shows a running ring on Chat and on the surfaces the model draws, only while a turn runs', () => {
    const running = { ...none, running: true, modelDrawn: new Set(['architecture' as const]) };
    expect(tabStatus('chat', running)).toBe('running');
    expect(tabStatus('architecture', running)).toBe('running');
    expect(tabStatus('terminal', running)).toBeNull();
    expect(tabStatus('chat', none)).toBeNull();
  });

  it('a waiting decision outranks working', () => {
    const both = { ...none, running: true, pendingEdits: 2, pendingTopology: true };
    expect(tabStatus('chat', both)).toBe('needs-input');
    expect(tabStatus('files', both)).toBe('needs-input');
    expect(tabStatus('architecture', both)).toBe('needs-input');
  });

  it('holds every other tab at its width after a close, clamped to 72..220', () => {
    const held = freezeWidths(
      [
        { id: 'chat', width: 300 },
        { id: 'files', width: 40 },
        { id: 'architecture', width: 150.4 },
      ],
      'files',
    );
    expect(held).toEqual({ chat: TAB_MAX_W, architecture: 150 });
    expect(TAB_MIN_W).toBe(72);
  });
});

/* Decision 49: the reskin shell (shell2/Shell2.tsx). The chat is a column,
   not a pill, so there is no Chat tab to middle-click or ring; the sidebar is
   uiarc.dev's panel at a fixed width, so it neither collapses nor drags. */
describe('the surface bar, rendered', () => {
  it('closes a surface on middle-click', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Spaces$/ }));
    expect(container.querySelector('.s2-pane[data-surface-pane="whiteboard"]')).toBeTruthy();
    const pill = container.querySelector('[data-tab-id="whiteboard"]') as HTMLElement;
    fireEvent(pill, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(container.querySelector('.s2-pane[data-surface-pane="whiteboard"]')).toBeFalsy();
  });

  it('a middle-click on a closed surface opens nothing', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    const pill = container.querySelector('[data-tab-id="terminal"]') as HTMLElement;
    fireEvent(pill, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(container.querySelector('.s2-pane[data-surface-pane="terminal"]')).toBeFalsy();
  });

  it('puts a running ring in the Architecture pill while a turn is in flight', () => {
    const store = freshStore();
    render(<V3App appStore={store} />);
    expect(screen.queryByTestId('v3-tab-status-architecture')).toBeNull();
    act(() => {
      store.dispatch({ type: 'composer/draft', text: 'why is the gateway hot?' });
      store.dispatch({ type: 'turn/send', at: 1 });
    });
    expect(screen.getByTestId('v3-tab-status-architecture').getAttribute('data-status')).toBe('running');
  });
});

describe('the board pane has no title row', () => {
  it('the Architecture pane head floats with only its controls: no title', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    const head = container.querySelector('[data-surface-pane="architecture"] .s2-pane-head');
    expect(head).not.toBeNull();
    expect(head!.classList.contains('is-float')).toBe(true);
    expect(head!.querySelector('.s2-cap')).toBeNull();
  });
});

describe('the whiteboard mirrors the architecture board', () => {
  it('its pane head floats with only the controls: no title band above the board', () => {
    const { container } = render(<V3App appStore={freshStore()} />);
    act(() => {
      fireEvent.click(screen.getByTestId('s2-tab-whiteboard'));
    });
    const head = container.querySelector('[data-surface-pane="whiteboard"] .s2-pane-head');
    expect(head).not.toBeNull();
    expect(head!.classList.contains('is-float')).toBe(true);
    expect(head!.querySelector('.s2-cap')).toBeNull();
  });
});

describe('the session panel', () => {
  it('keeps its doors at the foot: Open project and Settings', () => {
    render(<V3App appStore={freshStore()} />);
    expect(screen.getByTestId('v3-rail-open-project').textContent).toContain('Open project');
    expect(screen.getByTestId('v3-rail-settings').textContent).toContain('Settings');
  });
});

describe('a tool card is one row with its status and duration', () => {
  it('shows a 12px spinner while running, then the time it took', () => {
    const tool = { id: 't1', name: 'read_file' };
    const { rerender } = render(<ToolCallCard tool={tool} running />);
    expect(screen.getByTestId('chat-tool-call-spinner')).toBeTruthy();
    expect(screen.queryByTestId('chat-tool-call-duration')).toBeNull();
    rerender(<ToolCallCard tool={tool} running={false} result="ok" />);
    expect(screen.queryByTestId('chat-tool-call-spinner')).toBeNull();
    expect(screen.getByTestId('chat-tool-call-duration').textContent).toMatch(/^\d+ms$|^\d+\.\ds$/);
  });

  it('shows no duration for a call it never saw running', () => {
    render(<ToolCallCard tool={{ id: 't2', name: 'read_file' }} result="ok" />);
    expect(screen.queryByTestId('chat-tool-call-duration')).toBeNull();
  });

  it('formats durations as ms, seconds, then minutes', () => {
    expect(formatToolDuration(840)).toBe('840ms');
    expect(formatToolDuration(4200)).toBe('4.2s');
    expect(formatToolDuration(65_000)).toBe('1m 05s');
  });
});

describe('an approval card folds once it is decided', () => {
  const proposal = (decision: 'pending' | 'accepted'): FileEditProposal =>
    ({
      id: 'p1',
      turnId: 't1',
      title: 'Fix the gateway',
      rationale: null,
      files: [{ path: 'a.ts', content: '', decision }],
      status: decision === 'pending' ? 'pending' : 'applied',
      verify: null,
    }) as unknown as FileEditProposal;

  it('stays open while it waits for the reader', () => {
    render(<ApprovalCard proposal={proposal('pending')} onDecideAll={() => {}} />);
    expect(screen.queryByTestId('v3-approve-fold')).toBeNull();
    expect(screen.getByText('Accept all')).toBeTruthy();
  });

  it('is one row with its verdict when decided, and opens in place', () => {
    render(<ApprovalCard proposal={proposal('accepted')} onDecideAll={() => {}} />);
    const fold = screen.getByTestId('v3-approve-fold');
    expect(fold.textContent).toContain('Fix the gateway');
    expect(fold.textContent).toContain('applied');
    fireEvent.click(fold);
    expect(screen.queryByTestId('v3-approve-fold')).toBeNull();
    expect(screen.getByText('a.ts')).toBeTruthy();
  });
});
