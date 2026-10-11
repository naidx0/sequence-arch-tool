import { afterEach, describe, expect, it, vi } from 'vitest';

import { setHostCommandHandler } from '../app/hostCommands';
import { createStore } from '../state/store';
import { buildReference, whiteboardReference, type WbRefItem } from './askReference';
import { registerBoardAskSender, sendThroughChat } from './boardAskBus';
import { sendBoardAsk } from './sendBoardAsk';

const ITEMS: WbRefItem[] = [
  { id: 'r1', kind: 'shape', shape: 'rect', label: 'Model' },
  { id: 'r2', kind: 'shape', shape: 'rect', label: 'Tool call' },
  { id: 'a1', kind: 'shape', shape: 'arrow', fromId: 'r1', toId: 'r2' },
];
const REF = whiteboardReference(ITEMS, ['r1', 'r2', 'a1'], (i) => i.label ?? '')!;

function freshStore() {
  return createStore();
}

const stored = { id: 'sha-1', name: 'board-selection.png', bytes: 1234, kind: 'image' as const, mimeType: 'image/png', width: 400, height: 300 };

afterEach(() => {
  registerBoardAskSender(null);
  setHostCommandHandler(null);
});

describe('what a board ask puts in the chat', () => {
  it('adds the board-ref chip carrying the structured block, then sends the words', async () => {
    const store = freshStore();
    const send = vi.fn(() => true);
    const out = await sendBoardAsk(store, { text: 'fix the arrow', reference: REF, image: null }, { send });
    expect(out).toEqual({ sent: true, image: 'none' });
    expect(send).toHaveBeenCalledWith('fix the arrow');
    const chips = store.getState().composer.chips;
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ kind: 'board-ref', label: '3 items: Model, Tool call, arrow', ref: 'board-ref:whiteboard:r1,r2,a1' });
    expect(chips[0]!.detail).toContain('r1 | rect | "Model" | to r2 (Tool call)');
    expect(chips[0]!.detail).toContain('a1 | arrow | (no label) | from r1 (Model); to r2 (Tool call)');
  });

  it('attaches the crop through the same pipeline as a pasted screenshot', async () => {
    const store = freshStore();
    const upload = vi.fn().mockResolvedValue(stored);
    const crop = new Blob(['png'], { type: 'image/png' });
    const out = await sendBoardAsk(store, { text: 'look', reference: REF, image: crop }, { send: () => true, upload });
    expect(out.image).toBe('attached');
    expect(upload).toHaveBeenCalledWith(crop, 'board-selection.png', expect.any(String));
    expect(store.getState().composer.attachments).toEqual([
      { id: 'sha-1', name: 'board-selection.png', bytes: 1234, kind: 'image', width: 400, height: 300 },
    ]);
  });

  it('sends without the image when the upload is refused, and says so', async () => {
    const store = freshStore();
    const send = vi.fn(() => true);
    const out = await sendBoardAsk(
      store,
      { text: 'look', reference: REF, image: new Blob(['x']) },
      { send, upload: () => Promise.reject(new Error('Images go to a coding agent')) },
    );
    expect(out).toEqual({ sent: true, image: 'failed' });
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.getState().composer.attachments).toEqual([]);
  });

  it('brings the chat forward and takes focus there', async () => {
    const store = freshStore();
    const commands: string[] = [];
    setHostCommandHandler((id) => commands.push(id));
    const before = store.getState().composer.focusNonce;
    await sendBoardAsk(store, { text: 'x', reference: REF, image: null }, { send: () => true });
    expect(commands).toEqual(['chat.show']);
    expect(store.getState().composer.focusNonce).toBe(before + 1);
  });

  it('puts a half-typed draft back after the send', async () => {
    const store = freshStore();
    store.dispatch({ type: 'composer/draft', text: 'something I was typing' });
    await sendBoardAsk(store, { text: 'board question', reference: REF, image: null }, { send: () => true });
    expect(store.getState().composer.draft).toBe('something I was typing');
  });

  it('leaves the words in the composer when no chat is mounted', async () => {
    const store = freshStore();
    const out = await sendBoardAsk(store, { text: 'board question', reference: REF, image: null });
    expect(out.sent).toBe(false);
    expect(store.getState().composer.draft).toBe('board question');
    expect(store.getState().composer.chips).toHaveLength(1);
  });

  it('goes through whatever sender the mounted chat registered', async () => {
    const store = freshStore();
    const sender = vi.fn();
    registerBoardAskSender(sender);
    const out = await sendBoardAsk(store, { text: 'via the chat', reference: REF, image: null });
    expect(out.sent).toBe(true);
    expect(sender).toHaveBeenCalledWith('via the chat');
  });
});

describe('the bus', () => {
  it('refuses when no chat is mounted', () => {
    expect(sendThroughChat('x')).toBe(false);
  });
});

describe('a node that already has its own chip', () => {
  it('keeps both: the composer keeps one chip per ref, so the board reference must not reuse the node ref', async () => {
    const store = freshStore();
    store.dispatch({ type: 'composer/chip-add', chip: { id: 'node:svc:gateway', kind: 'node', ref: 'svc:gateway', label: 'gateway', nodeKind: null } });
    const ref = buildReference('architecture', [{ id: 'svc:gateway', kind: 'service', label: 'gateway' }])!;
    await sendBoardAsk(store, { text: 'why?', reference: ref, image: null }, { send: () => true });
    expect(store.getState().composer.chips.map((c) => c.kind).sort()).toEqual(['board-ref', 'node']);
  });
});

describe('an architecture selection takes the same road', () => {
  it('rides as a board-ref chip too', async () => {
    const store = freshStore();
    const ref = buildReference('architecture', [{ id: 'svc:gateway', kind: 'service', label: 'gateway', paths: ['src/gateway.ts'] }])!;
    await sendBoardAsk(store, { text: 'why?', reference: ref, image: null }, { send: () => true });
    const chip = store.getState().composer.chips[0]!;
    expect(chip.kind).toBe('board-ref');
    expect(chip.label).toBe('gateway');
    expect(chip.detail).toContain('svc:gateway | service | "gateway" | src/gateway.ts');
  });
});
