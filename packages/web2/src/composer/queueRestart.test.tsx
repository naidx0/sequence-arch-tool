import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PromptQueueList } from './PromptQueueList';
import { createPromptQueue as makeQueue, createQueueDrain, QUEUE_MAX_AGE_MS, QUEUE_STORAGE_PREFIX, followOtherWindows, type QueueStorage } from './promptQueue';

/* T3 gap G10: prompts queued behind a turn survive a restart, held, with a Resume control. */

const memory = (data = new Map<string, string>()): QueueStorage & { data: Map<string, string> } => ({
  data,
  getItem: (k) => data.get(k) ?? null,
  setItem: (k, v) => void data.set(k, v),
  removeItem: (k) => void data.delete(k),
  get length() {
    return data.size;
  },
  key: (i) => [...data.keys()][i] ?? null,
});
/* Each queue is its own window unless a test says otherwise. */
let win = 0;
const createPromptQueue = (newId: () => string, storage: QueueStorage | null = null, windowId = `win-${++win}`) => makeQueue(newId, storage, windowId);
const ids = () => {
  let n = 0;
  return () => `q${++n}`;
};

describe('the prompt queue across a restart', () => {
  it('comes back held: an idle chat does not send it until Resume', () => {
    const disk = memory();
    const before = createPromptQueue(ids(), disk);
    before.add('chat-1', 'run the tests');
    before.add('chat-1', 'then commit');
    expect(before.held('chat-1')).toBe(false);

    const after = createPromptQueue(ids(), disk);
    expect(after.items('chat-1').map((i) => i.text)).toEqual(['run the tests', 'then commit']);
    expect(after.held('chat-1')).toBe(true);
    const sent: string[] = [];
    const drain = createQueueDrain(after, () => 'chat-1', (t) => sent.push(t));
    drain.update(false);
    expect(sent).toEqual([]);

    after.release('chat-1');
    drain.update(false);
    expect(sent).toEqual(['run the tests']);
  });

  it('shows Held with a Resume button, and Resume releases it', async () => {
    const disk = memory();
    createPromptQueue(ids(), disk).add('chat-1', 'run the tests');
    const q = createPromptQueue(ids(), disk);
    render(<PromptQueueList queueKey="chat-1" queue={q} isBusy={async () => false} />);
    expect(screen.getByTestId('prompt-queue').getAttribute('data-held')).toBe('true');
    fireEvent.click(screen.getByTestId('prompt-queue-resume'));
    await waitFor(() => expect(q.held('chat-1')).toBe(false));
    expect(screen.queryByTestId('prompt-queue-resume')).toBeNull();
  });

  it('a taken-back item leaves storage; a broken or old entry is dropped, not shown', () => {
    const disk = memory();
    const q = createPromptQueue(ids(), disk);
    const a = q.add('p::c', 'one')!;
    q.remove('p::c', a.id);
    expect([...disk.data.keys()]).toEqual([]);
    disk.data.set(QUEUE_STORAGE_PREFIX + 'p::c', '{not json');
    disk.data.set(QUEUE_STORAGE_PREFIX + 'p::d', JSON.stringify({ at: Date.now(), items: [{ id: 1 }, { id: 'x', text: 'ok' }, null] }));
    disk.data.set(QUEUE_STORAGE_PREFIX + 'p::old', JSON.stringify({ at: Date.now() - QUEUE_MAX_AGE_MS - 1000, items: [{ id: 'y', text: 'stale' }] }));
    const back = createPromptQueue(ids(), disk);
    expect(back.items('p::c')).toEqual([]);
    expect(back.items('p::d')).toEqual([{ id: 'x', text: 'ok' }]);
    expect(back.items('p::old')).toEqual([]);
    expect([...disk.data.keys()].sort()).toEqual([QUEUE_STORAGE_PREFIX + 'p::d']);
  });

  it('each project and chat has its own entry: no-chat in one project never comes back in another', () => {
    const disk = memory();
    const q = createPromptQueue(ids(), disk);
    q.add('/work/a::none', 'for a');
    q.add('/work/b::none', 'for b');
    expect(createPromptQueue(ids(), disk).items('/work/b::none').map((i) => i.text)).toEqual(['for b']);
    expect([...disk.data.keys()].sort()).toEqual([QUEUE_STORAGE_PREFIX + '/work/a::none', QUEUE_STORAGE_PREFIX + '/work/b::none']);
  });

  it('two windows: what one sends the other stops holding, and neither wipes the other\'s chats', () => {
    const shared = new Map<string, string>();
    const a = createPromptQueue(ids(), memory(shared));
    a.add('p::one', 'first');
    a.add('p::two', 'in a');
    const b = createPromptQueue(ids(), memory(shared));
    expect(b.items('p::one')).toHaveLength(1);
    /* Window A sends the item; window B hears the storage event and drops it. */
    const listeners: ((e: Event) => void)[] = [];
    const off = followOtherWindows(b, { addEventListener: (_t: string, l: unknown) => void listeners.push(l as (e: Event) => void), removeEventListener: () => {} } as never);
    a.shift('p::one');
    b.add('p::three', 'in b');
    listeners.forEach((l) => l({ key: QUEUE_STORAGE_PREFIX + 'p::one' } as StorageEvent));
    expect(b.items('p::one')).toEqual([]);
    expect(b.held('p::one')).toBe(false);
    expect(JSON.parse(shared.get(QUEUE_STORAGE_PREFIX + 'p::two')!).items[0].text).toBe('in a');
    expect(JSON.parse(shared.get(QUEUE_STORAGE_PREFIX + 'p::three')!).items[0].text).toBe('in b');
    off();
  });

  it('a prompt queued in another window stays held here: that window sends it, this one never does', () => {
    const shared = new Map<string, string>();
    const a = createPromptQueue(ids(), memory(shared), 'win-A');
    const b = createPromptQueue(ids(), memory(shared), 'win-B');
    const sentA: string[] = [];
    const sentB: string[] = [];
    const da = createQueueDrain(a, () => 'p::c', (t) => sentA.push(t));
    const db = createQueueDrain(b, () => 'p::c', (t) => sentB.push(t));
    da.update(true); // A's turn runs
    a.add('p::c', 'then run the tests');
    /* B hears the storage event, is idle (it never saw A's turn) and must not send. */
    b.reload('p::c');
    expect(b.items('p::c').map((i) => i.text)).toEqual(['then run the tests']);
    expect(b.held('p::c')).toBe(true);
    db.update(false);
    expect(sentB).toEqual([]);
    /* A's turn ends: A sends its own item, once. */
    da.update(false);
    expect(sentA).toEqual(['then run the tests']);
    expect(a.items('p::c')).toEqual([]);
  });

  it('Resume in the other window adopts the items and sends them, but only when the server says the chat is idle', async () => {
    const shared = new Map<string, string>();
    const a = createPromptQueue(ids(), memory(shared), 'win-A');
    a.add('p::chat1', 'later');
    const b = createPromptQueue(ids(), memory(shared), 'win-B');
    let busy = true;
    render(<PromptQueueList queueKey="p::chat1" queue={b} isBusy={async () => busy} />);
    fireEvent.click(screen.getByTestId('prompt-queue-resume'));
    expect((await screen.findByTestId('prompt-queue-note')).textContent).toMatch(/still running/);
    expect(b.held('p::chat1')).toBe(true);
    busy = false;
    fireEvent.click(screen.getByTestId('prompt-queue-resume'));
    await waitFor(() => expect(b.held('p::chat1')).toBe(false));
    const sent: string[] = [];
    createQueueDrain(b, () => 'p::chat1', (t) => sent.push(t)).update(false);
    expect(sent).toEqual(['later']);
  });
});
