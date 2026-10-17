import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import '../agents/agentRunFold';
import { createStore } from '../state';
import { V3App } from '../v3/V3App';

/*
 * ROUND 7, A6 (blocking): "I click on the model picker after that, and my
 * screen just goes gray. I literally can't do anything after that."
 *
 * Reproduced on the built base app (fake agent that dies, then the model
 * menu): with the menu open the page sent 1,207 GET /api/acp/agents and 1,207
 * GET /api/onboarding/providers in 5 s, and every 30 s (the probe's cache)
 * each round started codex and claude again, plus the dead agent itself for
 * its models: the machine drowned in processes and the window stopped
 * answering. Cause: ConnectAgents' default fetch was a new function each
 * render inside its effect's dependencies (fixed in ConnectAgents.tsx).
 *
 * This drives the same path in the page: a failed agent start, the model
 * menu opened and closed every way it closes, and asserts what Jaden could
 * not do: nothing covers the page (no scrim, overlay or modal layer, derived
 * from the DOM), the composer takes focus, and the menu asked for the agents
 * once, not in a loop.
 */

const CHAT = 'gray-chat';

beforeEach(() => {
  localStorage.clear();
  agentRuns.patch((s) => ({ ...s, runs: [], agents: {}, caps: {}, config: {}, capsError: {} }));
});
afterEach(() => vi.unstubAllGlobals());

/** Every element that could cover the page: a scrim, an overlay, a modal or a dialog. */
function coverings(): string[] {
  return [...document.querySelectorAll('*')]
    .filter((el) => {
      const cls = typeof el.className === 'string' ? el.className : '';
      /* The ASCII ground is a still, aria-hidden, click-through layer under every card, not a cover. */
      if (el.closest('[data-testid="s2-ascii-backdrop"]')) return false;
      return /scrim|overlay|backdrop/i.test(cls) || el.getAttribute('aria-modal') === 'true' || el.getAttribute('role') === 'dialog';
    })
    .map((el) => `${el.tagName.toLowerCase()}.${String(el.className)}`);
}

describe('a failed agent start, then the model menu', () => {
  it('leaves nothing over the page, the composer focusable, and asks for the agents once', async () => {
    const counts = new Map<string, number>();
    const enc = new TextEncoder();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input).split('?')[0]!;
        counts.set(url, (counts.get(url) ?? 0) + 1);
        const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
        if (url === '/api/acp/run-node') {
          const body = new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'acp:error', error: 'ACP agent failed: The agent process exited (code 1): codex: usage limit', recovery: { kind: 'retry' } })}\n\n`));
              c.close();
            },
          });
          return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        if (url === '/api/acp/agents') return json(200, { agents: [{ id: 'codex', command: 'codex' }] });
        if (url === '/api/onboarding/providers') return json(200, { providers: [{ id: 'claude', label: 'Claude Code', installed: true, version: '2', state: 'ready', signInCommand: 'claude auth login', installHint: 'x' }] });
        if (url === '/api/acp/capabilities') return json(502, { error: 'the agent could not say what it offers: codex exited (code 1)' });
        return new Promise<Response>(() => {});
      }),
    );
    const store = createStore({});
    store.dispatch({ type: 'session/index', sessions: [{ id: CHAT, title: 'Gray', pinned: false, updatedAt: '2026-01-01' }], activeId: CHAT } as never);
    render(<V3App appStore={store} />);
    const before = coverings();

    await act(async () => {
      await agentRuns.start({ agentRef: 'codex', question: 'go', access: 'ask', sessionId: CHAT }, (i, init) => fetch(i, init));
    });
    expect(agentRuns.get().runs.at(-1)?.status).toBe('failed');

    const trigger = screen.getByTestId('v3-model-trigger');
    /* Open and close it every way it closes: Escape, a click outside, the trigger again. */
    for (const close of [
      () => fireEvent.keyDown(document, { key: 'Escape' }),
      () => fireEvent.mouseDown(document.body),
      () => fireEvent.click(trigger),
    ]) {
      await act(async () => {
        fireEvent.click(trigger);
        await new Promise((r) => setTimeout(r, 300));
      });
      expect(screen.getByTestId('s2-model-menu')).toBeTruthy();
      await act(async () => {
        close();
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(screen.queryByTestId('s2-model-menu')).toBeNull();
    }

    expect(coverings()).toEqual(before);
    const field = screen.getByTestId('composer-field') as HTMLTextAreaElement;
    expect(field.disabled).toBe(false);
    field.focus();
    expect(document.activeElement).toBe(field);
    /* Three opens of the menu: at most one ask for the agents and the providers per open, never a loop. */
    expect(counts.get('/api/acp/agents') ?? 0).toBeLessThanOrEqual(3);
    expect(counts.get('/api/onboarding/providers') ?? 0).toBeLessThanOrEqual(3);
    expect(counts.get('/api/acp/capabilities') ?? 0).toBeLessThanOrEqual(1);
  });
});
