// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UIAction } from '@sequence/genui';

import { StreamingContext } from '../chat/DiagramBlock';
import { GENUI_ACTION_EVENT, announceGenUITurn, createChatActionHandler, listenForGenUIActions, type GenUIActionDetail } from './chatActions';
import { GenUIFence } from './GenUIFence';

const action = (name = 'fix', elementId = 'b'): UIAction => ({ kind: 'ui.action', surfaceId: 'fence', name, params: {}, elementId, state: {}, at: 1 });
const detail = (over: Partial<GenUIActionDetail> = {}, a: UIAction = action()): GenUIActionDetail => ({ action: a, prompt: `[ui.action] clicked ${a.name}`, ...over });

function rig(opts: { busy?: boolean; ttlMs?: number } = {}) {
  let busy = opts.busy ?? false;
  let t = 1000;
  const sent: string[] = [];
  const steered: string[] = [];
  const handler = createChatActionHandler({ isBusy: () => busy, send: (p) => void sent.push(p), steer: (p) => void steered.push(p), now: () => t, ttlMs: opts.ttlMs });
  return { handler, sent, steered, setBusy: (b: boolean) => (busy = b), tick: (ms: number) => (t += ms) };
}

describe('createChatActionHandler', () => {
  it('idle: the prompt goes out as the next user turn, once', () => {
    const r = rig();
    expect(r.handler.handle(detail())).toBe('sent');
    expect(r.sent).toEqual(['[ui.action] clicked fix']);
    expect(r.steered).toEqual([]);
  });

  it('a double click sends once, even before the chat has reported that it is busy', () => {
    const r = rig();
    expect(r.handler.handle(detail())).toBe('sent');
    expect(r.handler.handle(detail())).toBe('duplicate');
    expect(r.handler.handle(detail())).toBe('duplicate');
    expect(r.sent).toHaveLength(1);
    expect(r.handler.pending()).toBe(1);
  });

  it('a different button is its own click', () => {
    const r = rig();
    r.handler.handle(detail({}, action('fix', 'b1')));
    expect(r.handler.handle(detail({}, action('merge', 'b2')))).toBe('sent');
    expect(r.sent).toHaveLength(2);
  });

  it('turn end clears pending: the same button works again for the next turn', () => {
    const r = rig();
    r.handler.handle(detail());
    r.handler.turnEnded();
    expect(r.handler.pending()).toBe(0);
    expect(r.handler.handle(detail())).toBe('sent');
    expect(r.sent).toHaveLength(2);
  });

  it('busy: a whileBusy action steers the running turn; any other is dropped, not queued', () => {
    const r = rig({ busy: true });
    expect(r.handler.handle(detail({ whileBusy: true }))).toBe('steered');
    expect(r.steered).toEqual(['[ui.action] clicked fix']);
    expect(r.handler.handle(detail({ whileBusy: true }))).toBe('duplicate');
    expect(r.handler.handle(detail({}, action('merge', 'b2')))).toBe('busy');
    expect(r.handler.handle(detail({ whileBusy: false }, action('open', 'b3')))).toBe('busy');
    expect(r.sent).toEqual([]);
    expect(r.steered).toHaveLength(1);
  });

  it('a click that never became a turn does not lock its button for good (ttl)', () => {
    const r = rig({ ttlMs: 5000 });
    r.handler.handle(detail());
    r.tick(4999);
    expect(r.handler.handle(detail())).toBe('duplicate');
    r.tick(2);
    expect(r.handler.handle(detail())).toBe('sent');
  });

  it('refuses anything that is not a ui.action with a prompt', () => {
    const r = rig();
    for (const bad of [null, undefined, 'x', {}, { prompt: 'p' }, { prompt: '', action: action() }, { prompt: 'p', action: { ...action(), kind: 'other' } }, { prompt: 'p', action: { kind: 'ui.action' } }]) expect(r.handler.handle(bad)).toBe('invalid');
    expect(r.sent).toEqual([]);
  });
});

describe('a real fence button, the window event and the turn announcement', () => {
  afterEach(() => cleanup());
  const SRC =
    '{"op":"add","path":"/actions/fix","value":{"description":"Fix it"}}\n' +
    '{"op":"el","id":"c","type":"Card","props":{"title":"Build"},"children":["acts"]}\n' +
    '{"op":"el","id":"acts","type":"Actions","children":["b"]}\n' +
    '{"op":"el","id":"b","type":"Button","props":{"label":"Fix failures","action":{"name":"fix"}}}\n';

  it('one click is one turn, the double click is dropped, and the spinner clears when the turn ends', async () => {
    const sent: string[] = [];
    let busy = false;
    const handler = createChatActionHandler({ isBusy: () => busy, send: (p) => { sent.push(p); }, steer: () => {} });
    const off = listenForGenUIActions(handler);
    render(
      <StreamingContext.Provider value={false}>
        <GenUIFence source={SRC} />
      </StreamingContext.Provider>,
    );
    const btn = (): HTMLButtonElement => screen.getByText('Fix failures').closest('button')!;
    await waitFor(() => expect(btn().disabled).toBe(false));

    fireEvent.click(btn());
    expect(btn().getAttribute('data-pending'), 'the clicked button spins').toBe('true');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/clicked "Fix failures"/);
    fireEvent.click(btn());
    fireEvent.click(btn());
    expect(sent, 'a double click is one turn').toHaveLength(1);

    busy = true;
    announceGenUITurn(true);
    await waitFor(() => expect(btn().disabled).toBe(true));
    expect(btn().getAttribute('data-pending')).toBe('true');

    busy = false;
    announceGenUITurn(false);
    handler.turnEnded();
    await waitFor(() => expect(btn().getAttribute('data-pending')).toBeNull());
    expect(btn().disabled).toBe(false);

    fireEvent.click(btn());
    expect(sent, 'after the turn, the same button is a new turn').toHaveLength(2);
    off();
  });

  it('the event carries whileBusy from the surface declaration', async () => {
    const seen: GenUIActionDetail[] = [];
    const on = (e: Event): void => void seen.push((e as CustomEvent<GenUIActionDetail>).detail);
    window.addEventListener(GENUI_ACTION_EVENT, on);
    const src = SRC.replace('{"description":"Fix it"}', '{"description":"Fix it","whileBusy":true}');
    render(
      <StreamingContext.Provider value={false}>
        <GenUIFence source={src} />
      </StreamingContext.Provider>,
    );
    await waitFor(() => expect((screen.getByText('Fix failures').closest('button') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Fix failures'));
    window.removeEventListener(GENUI_ACTION_EVENT, on);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.whileBusy).toBe(true);
    expect(seen[0]!.action.name).toBe('fix');
    vi.restoreAllMocks();
  });
});
