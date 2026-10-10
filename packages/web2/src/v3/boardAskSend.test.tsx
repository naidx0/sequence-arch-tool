/* ══════════════════════════════════════════════════════════════════════════
   A BOARD'S ASK LANDS IN THE MOUNTED CHAT AS A NORMAL USER MESSAGE
   packages/web2/src/v3/boardAskSend.test.tsx

   The popover on either board calls sendBoardAsk (askInPlace/). Everything on
   the far side of that call is the real shell: the chat registers its sender,
   the message is a turn in the transcript carrying the board-ref chip, and the
   chat is brought forward. Nothing here dispatches a turn by hand.
   ══════════════════════════════════════════════════════════════════════════ */

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setHostCommandHandler } from '../app/hostCommands';
import { buildReference } from '../askInPlace/askReference';
import { sendBoardAsk } from '../askInPlace/sendBoardAsk';
import { seqdFromGraph } from '../canvas';
import { readShellPersisted, readShellTokens } from '../shell';
import { createStore, type Store } from '../state';
import { V3App } from './V3App';

function freshStore(): Store {
  return createStore({
    project: (graph) => seqdFromGraph(graph, graph.nodeDetail),
    tokens: readShellTokens(document.documentElement),
    persisted: readShellPersisted(),
  });
}

describe('ask in place reaches the chat', () => {
  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.clear();
    vi.stubGlobal('fetch', (async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('sends the typed words as a user turn that carries the board reference', async () => {
    const store = freshStore();
    await act(async () => {
      render(<V3App appStore={store} />);
    });
    const reference = buildReference('whiteboard', [
      { id: 'r1', kind: 'rect', label: 'Model' },
      { id: 'r2', kind: 'rect', label: 'Tool call' },
    ])!;
    let result: Awaited<ReturnType<typeof sendBoardAsk>> | null = null;
    await act(async () => {
      result = await sendBoardAsk(store, { text: 'what does this loop do?', reference, image: null });
    });
    expect(result).toEqual({ sent: true, image: 'none' });
    const user = store.getState().session.turns.find((t) => t.role === 'user');
    expect(user).toBeTruthy();
    expect(user && 'text' in user ? user.text : '').toBe('what does this loop do?');
    const chip = user && 'chips' in user ? user.chips.find((c) => c.kind === 'board-ref') : undefined;
    expect(chip?.label).toBe('2 items: Model, Tool call');
    expect(chip?.detail).toContain('r1 | rect | "Model"');
    // the chat itself shows the chip on the message
    expect(screen.getByTestId('chat-user-ref').textContent).toBe('2 items: Model, Tool call');
    // sent, so the composer is clear again
    expect(store.getState().composer.chips).toEqual([]);
  });

  it('asks the shell to show the chat, and the composer takes focus', async () => {
    const store = freshStore();
    await act(async () => {
      render(<V3App appStore={store} />);
    });
    const seen: string[] = [];
    // the shell's own handler is replaced by a recorder for this one question
    setHostCommandHandler((id) => seen.push(id));
    const nonce = store.getState().composer.focusNonce;
    const reference = buildReference('architecture', [{ id: 'svc:gateway', kind: 'service', label: 'gateway' }])!;
    await act(async () => {
      await sendBoardAsk(store, { text: 'why?', reference, image: null });
    });
    expect(seen).toContain('chat.show');
    expect(store.getState().composer.focusNonce).toBeGreaterThan(nonce);
  });
});
