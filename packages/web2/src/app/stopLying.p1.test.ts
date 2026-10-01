import { describe, expect, it, vi } from 'vitest';

import { takeActivityLaunch } from '../activity/activityLaunch';
import { toolbeltAskText, placeholderFor } from '../chat/composerModel';
import { chatColumnPropsFrom, composerPropsFrom } from '../state/connect';
import { createStore } from '../state/store';
import { rescanRepo, parseScanSseChunk } from './rescanClient';
import { requestHostCommand, setHostCommandHandler } from './hostCommands';

describe('toolbeltAskText', () => {
  it('names break-down without inventing chip focus', () => {
    const text = toolbeltAskText('break-down', []);
    expect(text).toMatch(/Break down/i);
    expect(text).not.toMatch(/^Focus on/);
  });

  it('names what-breaks with chip focus when chips are present', () => {
    const text = toolbeltAskText('what-breaks', ['gateway', 'orders']);
    expect(text).toMatch(/^Focus on gateway, orders\./);
    expect(text).toMatch(/blast radius/i);
  });
});

describe('placeholderFor — commands, not skills', () => {
  it('advertises / for commands, not an unbuilt skills registry', () => {
    expect(placeholderFor(false)).toContain('/ for commands');
    expect(placeholderFor(false)).not.toContain('/ for skills');
  });
});

describe('hostCommands', () => {
  it('delivers canvas.board to the registered host', () => {
    const seen: string[] = [];
    setHostCommandHandler((id) => seen.push(id));
    requestHostCommand('canvas.board');
    expect(seen).toEqual(['canvas.board']);
    setHostCommandHandler(null);
  });

  it('is a no-op when no host is registered', () => {
    setHostCommandHandler(null);
    expect(() => requestHostCommand('rail.focus')).not.toThrow();
  });
});

describe('toolbelt → real doors (P1)', () => {
  it('toolbelt models opens Settings provider pane and closes the menu', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/toolbelt', open: true });
    composerPropsFrom(store.getState(), store).onToolbeltPick('models');
    expect(store.getState().shell.overlay).toEqual({ kind: 'settings', pane: 'provider' });
    expect(store.getState().composer.toolbeltOpen).toBe(false);
  });

  it('toolbelt start-workflow opens Activity with a one-shot launch draft', () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'ship the limiter' });
    composerPropsFrom(store.getState(), store).onToolbeltPick('start-workflow');
    expect(store.getState().shell.overlay).toEqual({ kind: 'activity' });
    expect(takeActivityLaunch()).toEqual({
      name: 'Workflow from chat',
      instruction: 'ship the limiter',
    });
    expect(takeActivityLaunch()).toBeNull();
  });

  it('onOpen(browser) asks host browser.open', () => {
    const seen: string[] = [];
    setHostCommandHandler((id) => {
      seen.push(id);
    });
    const store = createStore();
    const { onOpen } = chatColumnPropsFrom(store.getState(), store);
    expect(onOpen).toBeDefined();
    onOpen?.('browser', 't1' as never);
    expect(seen).toEqual(['browser.open']);
    setHostCommandHandler(null);
  });

  it('onOpen(terminal) asks host terminal.open', () => {
    const seen: string[] = [];
    setHostCommandHandler((id) => {
      seen.push(id);
    });
    const store = createStore();
    const { onOpen } = chatColumnPropsFrom(store.getState(), store);
    expect(onOpen).toBeDefined();
    onOpen?.('terminal', 't1' as never);
    expect(seen).toEqual(['terminal.open']);
    setHostCommandHandler(null);
  });

  it('onOpen(rail) asks host rail.focus and does not invent a selectedPath', () => {
    const seen: string[] = [];
    setHostCommandHandler((id) => {
      seen.push(id);
    });
    const store = createStore();
    /* `onOpen` is optional on the props type, so calling it straight off the
       object is possibly-undefined (TS2722). Binding it first and asserting it
       is there says what the test actually means — the prop must EXIST — and
       makes the call type-safe rather than silencing it with `?.`, which would
       pass vacuously if the prop ever went missing. */
    const { onOpen } = chatColumnPropsFrom(store.getState(), store);
    expect(onOpen).toBeDefined();
    onOpen?.('rail', 't1' as never);
    expect(seen).toEqual(['rail.focus']);
    expect(store.getState().rail.selectedPath).toBeNull();
    setHostCommandHandler(null);
  });
});

describe('rescanRepo', () => {
  it('maps a graph body into a ScannedRepoDraft', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          scannedAt: '2026-08-26T00:00:00.000Z',
          repoRoot: '/tmp/shop',
          repoName: 'shop',
          nodes: [{ id: 'svc:a', kind: 'service', label: 'a' }],
          edges: [],
          warnings: [],
          nodeDetail: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const answer = await rescanRepo(fetchImpl as unknown as typeof fetch);
    expect(answer.outcome).toBe('ok');
    if (answer.outcome !== 'ok') return;
    expect(answer.draft.repoName).toBe('shop');
    expect(answer.draft.graph.nodes).toHaveLength(1);
    expect(answer.draft.summary.services).toBe(1);
  });

  it('reports a refused rescan without inventing a draft', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'no repo attached' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const answer = await rescanRepo(fetchImpl as unknown as typeof fetch);
    expect(answer).toEqual({
      outcome: 'failed',
      status: 409,
      message: 'no repo attached',
    });
  });

  it('forwards scan:progress from an SSE rescan before the graph lands', async () => {
    const graph = {
      schemaVersion: 1,
      scannedAt: '2026-08-26T00:00:00.000Z',
      repoRoot: '/tmp/shop',
      repoName: 'shop',
      nodes: [{ id: 'svc:a', kind: 'service', label: 'a' }],
      edges: [],
      warnings: [],
      nodeDetail: {},
    };
    const body = [
      'data: {"type":"scan:progress","phase":"enumerate","done":0,"total":3,"path":"."}',
      '',
      'data: {"type":"scan:progress","phase":"analyze","done":1,"total":3,"path":"."}',
      '',
      `data: {"type":"scan:result","graph":${JSON.stringify(graph)}}`,
      '',
    ].join('\n');
    const seen: { done: number; phase?: string }[] = [];
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
        }),
    );
    const answer = await rescanRepo(fetchImpl as unknown as typeof fetch, undefined, (p) => {
      seen.push({ done: p.done, phase: p.phase });
    });
    expect(seen).toEqual([
      { done: 0, phase: 'enumerate' },
      { done: 1, phase: 'analyze' },
    ]);
    expect(answer.outcome).toBe('ok');
    if (answer.outcome !== 'ok') return;
    expect(answer.draft.repoName).toBe('shop');
  });
});

describe('parseScanSseChunk', () => {
  it('keeps a partial event in the buffer until the frame ends', () => {
    const first = parseScanSseChunk('data: {"type":"scan:progress","done":0,"total":3}\n\n');
    expect(first.events).toHaveLength(1);
    const second = parseScanSseChunk(`${first.rest}data: {"type":"scan:progress","done":1,"total":3}\n\n`);
    expect(second.events).toHaveLength(1);
    expect((second.events[0] as { done: number }).done).toBe(1);
  });
});
