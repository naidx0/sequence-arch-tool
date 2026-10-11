import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PromptQueueList, useQueueDrain } from './PromptQueueList';
import { createPromptQueue, createQueueDrain, editItem, moveItem, removeItem } from './promptQueue';
import { chatSessionKey, steerOrQueue, type Fetch } from './steerClient';

/*
 * S5: THE EDITABLE QUEUE AND ENTER-TO-STEER, web side. The drain is driven by
 * flipping `running` the way a turn's lifecycle does; nothing waits on time.
 */

afterEach(cleanup);

const ids = () => {
  let n = 0;
  return () => `q${++n}`;
};

describe('queue operations', () => {
  const items = [
    { id: 'a', text: 'one' },
    { id: 'b', text: 'two' },
    { id: 'c', text: 'three' },
  ];
  it('edit, move, remove; an edit to nothing removes; moves clamp at the ends', () => {
    expect(editItem(items, 'b', 'TWO').map((i) => i.text)).toEqual(['one', 'TWO', 'three']);
    expect(editItem(items, 'b', '  ').map((i) => i.id)).toEqual(['a', 'c']);
    expect(moveItem(items, 'c', -1).map((i) => i.id)).toEqual(['a', 'c', 'b']);
    expect(moveItem(items, 'a', -1)).toBe(items);
    expect(removeItem(items, 'a').map((i) => i.id)).toEqual(['b', 'c']);
  });

  it('a blank text is never queued; front puts it first', () => {
    const q = createPromptQueue(ids());
    expect(q.add('chat', '   ')).toBeNull();
    q.add('chat', 'later');
    q.add('chat', 'first', { front: true });
    expect(q.items('chat').map((i) => i.text)).toEqual(['first', 'later']);
    expect(q.items('other')).toEqual([]);
  });
});

describe('the drain: one item per settled turn, in order', () => {
  it('sends nothing while running; on settle sends the first; the next waits for THAT turn', () => {
    const q = createPromptQueue(ids());
    const sent: string[] = [];
    const drain = createQueueDrain(q, () => 'chat', (t) => void sent.push(t));
    q.add('chat', 'A');
    q.add('chat', 'B');
    expect(drain.update(true)).toBeNull();
    expect(sent).toEqual([]);
    drain.update(false); /* the turn settled */
    expect(sent).toEqual(['A']);
    drain.update(false); /* same render, A's turn not started yet: no double send */
    expect(sent).toEqual(['A']);
    drain.update(true); /* A's turn runs */
    drain.update(false); /* and settles */
    expect(sent).toEqual(['A', 'B']);
    drain.update(true);
    drain.update(false);
    expect(sent).toEqual(['A', 'B']);
    expect(q.items('chat')).toEqual([]);
  });

  it('a send that throws puts the item back at the front; nothing is dropped', () => {
    const q = createPromptQueue(ids());
    let fail = true;
    const sent: string[] = [];
    const drain = createQueueDrain(q, () => 'chat', (t) => {
      if (fail) throw new Error('offline');
      sent.push(t);
    });
    q.add('chat', 'A');
    q.add('chat', 'B');
    drain.update(false);
    expect(q.items('chat').map((i) => i.text)).toEqual(['A', 'B']);
    fail = false;
    drain.update(false);
    expect(sent).toEqual(['A']);
  });
});

describe('Enter mid-turn: steer, or queue', () => {
  const answering = (status: number, body: unknown): { f: Fetch; calls: { url: string; body: unknown }[] } => {
    const calls: { url: string; body: unknown }[] = [];
    const f: Fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };
    return { f, calls };
  };

  it('a Codex turn that takes the steer: sent to /api/acp/steer with the run-node session key, nothing queued', async () => {
    const q = createPromptQueue(ids());
    const { f, calls } = answering(200, { steered: true });
    const r = await steerOrQueue({ queueKey: 'chat-1', sessionKey: chatSessionKey('chat-1', 'codex'), text: 'also the README', fetch: f, queue: q });
    expect(r).toEqual({ kind: 'steered' });
    expect(calls).toEqual([{ url: '/api/acp/steer', body: { sessionKey: 'chat::chat-1::codex', text: 'also the README' } }]);
    expect(q.items('chat-1')).toEqual([]);
  });

  it('an ACP agent (no steer), a refused steer, or no route yet: the text is queued, never lost', async () => {
    for (const [status, body] of [
      [409, { steered: false, reason: 'no-steer' }],
      [200, { steered: false, reason: 'not-steerable' }],
      [404, { error: 'not found' }],
    ] as const) {
      const q = createPromptQueue(ids());
      const { f } = answering(status, body);
      const r = await steerOrQueue({ queueKey: 'c', sessionKey: 'chat::c::claude', text: 'next', fetch: f, queue: q });
      expect(r.kind).toBe('queued');
      expect(q.items('c').map((i) => i.text)).toEqual(['next']);
    }
  });

  it('no running agent session: queued without asking the server', async () => {
    const q = createPromptQueue(ids());
    const { f, calls } = answering(200, { steered: true });
    expect((await steerOrQueue({ queueKey: 'c', sessionKey: null, text: 'x', fetch: f, queue: q })).kind).toBe('queued');
    expect(calls).toEqual([]);
  });
});

function Harness({ queue, running, sent }: { queue: ReturnType<typeof createPromptQueue>; running: boolean; sent: string[] }) {
  useQueueDrain('chat', running, (t) => void sent.push(t), queue);
  return <PromptQueueList queueKey="chat" queue={queue} />;
}

describe('PromptQueueList', () => {
  it('nothing when empty; two items in order with edit, move, remove', () => {
    const q = createPromptQueue(ids());
    const view = render(<PromptQueueList queueKey="chat" queue={q} />);
    expect(screen.queryByTestId('prompt-queue')).toBeNull();
    act(() => {
      q.add('chat', 'Now run the tests.');
      q.add('chat', 'And commit if they pass.');
    });
    const list = screen.getByTestId('prompt-queue');
    expect(list.getAttribute('aria-label')).toBe('Queued prompts');
    const texts = () => screen.getAllByTestId('prompt-queue-item').map((r) => r.querySelector('.pq-text')?.textContent);
    expect(texts()).toEqual(['Now run the tests.', 'And commit if they pass.']);

    fireEvent.click(screen.getByRole('button', { name: 'Move queued prompt 2 up' }));
    expect(texts()).toEqual(['And commit if they pass.', 'Now run the tests.']);

    fireEvent.click(screen.getByRole('button', { name: 'Edit queued prompt 2' }));
    const field = screen.getByRole('textbox', { name: 'Edit queued prompt 2' });
    fireEvent.change(field, { target: { value: 'Run only the parser tests.' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(texts()).toEqual(['And commit if they pass.', 'Run only the parser tests.']);

    fireEvent.click(within(list).getByRole('button', { name: 'Remove queued prompt 1' }));
    expect(texts()).toEqual(['Run only the parser tests.']);
    view.unmount();
  });

  it('mounted with the drain: the queue empties in order as turns settle', () => {
    const q = createPromptQueue(ids());
    const sent: string[] = [];
    q.add('chat', 'A');
    q.add('chat', 'B');
    const view = render(<Harness queue={q} running={true} sent={sent} />);
    expect(sent).toEqual([]);
    view.rerender(<Harness queue={q} running={false} sent={sent} />);
    expect(sent).toEqual(['A']);
    expect(screen.getAllByTestId('prompt-queue-item')).toHaveLength(1);
    view.rerender(<Harness queue={q} running={true} sent={sent} />);
    view.rerender(<Harness queue={q} running={false} sent={sent} />);
    expect(sent).toEqual(['A', 'B']);
    expect(screen.queryByTestId('prompt-queue')).toBeNull();
  });
});
