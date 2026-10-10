import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DenyWithReason } from './DenyWithReason';
import { createPromptQueue } from './promptQueue';
import { denyWithFeedback, denyWithReasonFor, feedbackLine } from './rejectFeedback';
import { steerOrQueue, type Fetch } from './steerClient';

/*
 * S5: REJECT WITH FEEDBACK. Deny is answered first; the reason then goes to
 * the agent: steered into the running Codex turn (decline has no message in
 * codex's protocol), or queued at the FRONT as ACP's follow-up prompt after
 * reject_once. Fake fetch; nothing waits on time.
 */

afterEach(cleanup);

const serverSays = (status: number, body: unknown) => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const f: Fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { f, calls };
};

describe('feedbackLine', () => {
  it('names what was denied and why, on one line, capped', () => {
    expect(feedbackLine('  use the\nparser fixture instead ', 'Run rm -rf fixtures')).toBe('I denied “Run rm -rf fixtures”. use the parser fixture instead');
    expect(feedbackLine('no', null)).toBe('I denied that. no');
    expect(feedbackLine('x'.repeat(900), null).length).toBeLessThan(520);
  });
});

describe('denyWithFeedback', () => {
  it('Codex: Deny first, then the reason is steered into the same turn', async () => {
    const order: string[] = [];
    const q = createPromptQueue();
    const { f, calls } = serverSays(200, { steered: true });
    const r = await denyWithFeedback(
      { deny: async () => void order.push('deny'), steerOrQueue: (i) => (order.push('reason'), steerOrQueue({ ...i, fetch: f, queue: q })) },
      { reason: 'Use the test fixture, not the real DB.', approvalTitle: 'Run psql', queueKey: 'chat-1', sessionKey: 'chat::chat-1::codex' },
    );
    expect(order).toEqual(['deny', 'reason']);
    expect(r).toEqual({ kind: 'steered' });
    expect(calls[0]!.body.text).toBe('I denied “Run psql”. Use the test fixture, not the real DB.');
    expect(q.items('chat-1')).toEqual([]);
  });

  it('ACP (no steer): Deny is reject_once, and the reason waits at the FRONT of the queue as the follow-up prompt', async () => {
    const q = createPromptQueue();
    q.add('chat-2', 'something queued earlier');
    const { f } = serverSays(409, { steered: false, reason: 'no-steer' });
    const r = await denyWithFeedback(
      { deny: async () => undefined, steerOrQueue: (i) => steerOrQueue({ ...i, fetch: f, queue: q }) },
      { reason: 'Not on main.', approvalTitle: 'Run git push', queueKey: 'chat-2', sessionKey: 'chat::chat-2::claude' },
    );
    expect(r?.kind).toBe('queued');
    expect(q.items('chat-2').map((i) => i.text)).toEqual(['I denied “Run git push”. Not on main.', 'something queued earlier']);
  });

  it('denyWithReasonFor: the card one-liner answers THIS approval deny, keyed by the run\'s chat and agent session', async () => {
    const answered: string[] = [];
    const seen: { queueKey: string; sessionKey: string | null; front?: boolean }[] = [];
    const handler = denyWithReasonFor(
      { id: 'run-9', sessionId: 'chat-9', agentRef: 'codex' },
      { requestId: 'req-3', title: 'Run npm publish' },
      async (runId, requestId, d) => void answered.push(`${runId}/${requestId}/${d}`),
      { steerOrQueue: async (i) => (seen.push(i), { kind: 'steered' }) },
    );
    await handler('Not from a laptop.');
    expect(answered).toEqual(['run-9/req-3/deny']);
    expect(seen).toEqual([expect.objectContaining({ queueKey: 'chat-9', sessionKey: 'chat::chat-9::codex', front: true, text: 'I denied “Run npm publish”. Not from a laptop.' })]);
  });

  it('no reason: a plain Deny, nothing sent', async () => {
    let sent = 0;
    const r = await denyWithFeedback({ deny: async () => undefined, steerOrQueue: async () => (sent++, { kind: 'steered' }) }, { reason: '  ', approvalTitle: null, queueKey: 'c', sessionKey: null });
    expect(r).toBeNull();
    expect(sent).toBe(0);
  });
});

describe('DenyWithReason', () => {
  it('opens a field; Enter denies with the reason; Escape closes with nothing sent; letters are typed, not answers', () => {
    const denied: string[] = [];
    render(<DenyWithReason onDeny={(r) => denied.push(r)} />);
    fireEvent.click(screen.getByTestId('agent-deny-reason'));
    const field = screen.getByRole('textbox', { name: 'Why deny? This is sent to the agent' });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'y not the fixture' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(denied).toEqual(['y not the fixture']);
    expect(screen.queryByTestId('agent-deny-reason-form')).toBeNull();

    fireEvent.click(screen.getByTestId('agent-deny-reason'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'never mind' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(denied).toEqual(['y not the fixture']);
  });

  it('an empty reason cannot be sent', () => {
    const denied: string[] = [];
    render(<DenyWithReason onDeny={(r) => denied.push(r)} />);
    fireEvent.click(screen.getByTestId('agent-deny-reason'));
    expect((screen.getByTestId('agent-deny-reason-send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(denied).toEqual([]);
  });
});
