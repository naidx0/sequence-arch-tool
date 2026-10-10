import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import { StoreProvider, createStore } from '../state';
import { FanoutCompare, siblingLine } from './FanoutCompare';
import { FanoutMenu } from './FanoutMenu';
import { sendToAgents, type SiblingView } from './fanoutClient';

const actions = vi.hoisted(() => ({ activated: [] as string[], listed: 0 }));
vi.mock('../v3/sessionActions', () => ({
  activateSession: async (_s: unknown, id: string) => (actions.activated.push(id), { outcome: 'ok' }),
  listAndHydrateSessions: async () => (actions.listed++, { outcome: 'ok' }),
}));

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
afterEach(() => {
  vi.unstubAllGlobals();
  actions.activated.length = 0;
  actions.listed = 0;
});

const CHATS = [
  { chatId: 'c1', agentRef: 'claude', title: 'x · Claude' },
  { chatId: 'c2', agentRef: 'codex', title: 'x · Codex' },
];

describe('best of N from the page', () => {
  it('one send: one POST, then every agent is started in its own chat with the same message, and the page lands in the first', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const f = async (url: string, init?: RequestInit) => (calls.push({ url, body: JSON.parse(String(init?.body)) }), json(200, { fanoutId: 'f1', chats: CHATS }));
    const started: unknown[] = [];
    const runs = createAgentRunStore();
    runs.start = (async (o: unknown) => (started.push(o), undefined)) as never;
    const r = await sendToAgents({ store: createStore({}), runs, prompt: 'add a ping route', agents: ['claude', 'codex'], start: { access: 'autoEdit' }, f });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([{ url: '/api/fanout', body: { prompt: 'add a ping route', agents: ['claude', 'codex'] } }]);
    expect(started).toEqual([
      { access: 'autoEdit', agentRef: 'claude', sessionId: 'c1', question: 'add a ping route' },
      { access: 'autoEdit', agentRef: 'codex', sessionId: 'c2', question: 'add a ping route' },
    ]);
    expect(actions.activated).toEqual(['c1']);
  });

  it('a refusal starts nothing and says why', async () => {
    const started: unknown[] = [];
    const runs = createAgentRunStore();
    runs.start = (async (o: unknown) => (started.push(o), undefined)) as never;
    const r = await sendToAgents({ store: createStore({}), runs, prompt: 'x', agents: ['a', 'b'], f: async () => json(409, { error: 'needs 2 worktrees' }) });
    expect(r).toEqual({ ok: false, error: 'needs 2 worktrees' });
    expect(started).toEqual([]);
  });

  it('the picker needs two agents and a message; Shift-click ticks the range; Send goes to all ticked', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/api/acp/agents') ? json(200, { agents: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }) : json(200, { fanoutId: 'f', chats: CHATS }))));
    const store = createStore({});
    const runs = createAgentRunStore();
    const started: unknown[] = [];
    runs.start = (async (o: unknown) => (started.push(o), undefined)) as never;
    const closed = vi.fn();
    render(
      <StoreProvider store={store}>
        <FanoutMenu store={store} draft="do it" runs={runs} onClose={closed} />
      </StoreProvider>,
    );
    const boxes = await screen.findAllByTestId('fanout-agent');
    const send = screen.getByTestId('fanout-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(boxes[0]!);
    expect(send.disabled).toBe(true);
    fireEvent.click(boxes[2]!, { shiftKey: true });
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, true]);
    expect(send.textContent).toBe('Send to 3 agents');
  });

  it('an empty message cannot be sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(200, { agents: [{ id: 'a' }, { id: 'b' }] })));
    const store = createStore({});
    render(<FanoutMenu store={store} draft="  " onClose={() => {}} />);
    const boxes = await screen.findAllByTestId('fanout-agent');
    fireEvent.click(boxes[0]!);
    fireEvent.click(boxes[1]!);
    expect((screen.getByTestId('fanout-send') as HTMLButtonElement).disabled).toBe(true);
  });
});

const sib = (over: Partial<SiblingView>): SiblingView => ({
  chatId: 'c1', agentRef: 'claude', title: 't', branch: 'sequence/x', chosen: false, merged: false, removed: false,
  files: [{ path: 'a.ts', status: 'added' }], dryRun: { target: 'main', conflicts: [], mainUncommitted: [], clean: true }, ...over,
});

describe('comparing the siblings', () => {
  it('says what merging each would do', () => {
    expect(siblingLine(sib({}))).toBe('1 file changed. Merges cleanly into main.');
    expect(siblingLine(sib({ dryRun: { target: 'main', conflicts: ['a.ts'], mainUncommitted: [], clean: false } }))).toMatch(/would conflict in 1 file/);
    expect(siblingLine(sib({ files: [] }))).toBe('Changed no files.');
    expect(siblingLine(sib({ merged: true }))).toBe('Merged.');
  });

  it('Merge this one asks the server for that chat; after it, the rest can be discarded only after a confirm that names the loss', async () => {
    let merged = false;
    const posted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posted.push(`${url} ${init.body}`);
      if (String(url).endsWith('/choose')) {
        merged = true;
        return json(200, { into: 'main', files: [] });
      }
      if (String(url).endsWith('/discard-others')) return json(200, { removed: ['c2'], failed: [] });
      return json(200, { prompt: 'p', siblings: [sib({ chatId: 'c1', merged }), sib({ chatId: 'c2', agentRef: 'codex' })] });
    }));
    const store = createStore({});
    render(<FanoutCompare fanoutId="f1" store={store} thisChat="c1" />);
    const merge = await screen.findAllByTestId('fanout-merge');
    expect(merge).toHaveLength(2);
    expect(screen.queryByTestId('fanout-discard')).toBeNull();
    fireEvent.click(merge[0]!);
    await waitFor(() => expect(posted[0]).toBe('/api/fanout/f1/choose {"chatId":"c1","mode":"merge"}'));
    fireEvent.click(await screen.findByTestId('fanout-discard'));
    expect(screen.getByRole('alertdialog').textContent).toMatch(/everything those agents wrote/);
    expect(posted).toHaveLength(1);
    fireEvent.click(screen.getByTestId('fanout-discard-confirm'));
    await waitFor(() => expect(posted[1]).toBe('/api/fanout/f1/discard-others {"keep":"c1"}'));
  });
});


describe('discarding the others', () => {
  const serve = (siblings: () => SiblingView[], discard: (body: Record<string, unknown>) => Response) => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/discard-others')) {
        const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(b);
        return discard(b);
      }
      return json(200, { prompt: 'p', siblings: siblings() });
    }));
    return bodies;
  };

  it('is not offered before anything is merged', async () => {
    serve(() => [sib({ chatId: 'c1' }), sib({ chatId: 'c2', agentRef: 'codex' })], () => json(200, {}));
    render(<FanoutCompare fanoutId="f1" store={createStore({})} thisChat="c1" />);
    await screen.findAllByTestId('fanout-merge');
    expect(screen.queryByTestId('fanout-discard')).toBeNull();
  });

  it('is disabled while a sibling is still working, and so is Merge', async () => {
    serve(() => [sib({ chatId: 'c1', merged: true }), sib({ chatId: 'c2', agentRef: 'codex', running: true })], () => json(200, {}));
    render(<FanoutCompare fanoutId="f1" store={createStore({})} thisChat="c1" />);
    expect(((await screen.findByTestId('fanout-discard')) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Still working.')).toBeTruthy();
  });

  it('a sibling with commits that were never merged is listed, and only a second confirm sends the token it was shown', async () => {
    const bodies = serve(
      () => [sib({ chatId: 'c1', merged: true }), sib({ chatId: 'c2', agentRef: 'codex' })],
      (b) => (b.confirmLoss === 'tok-1' ? json(200, { removed: ['c2'], failed: [] }) : json(409, { error: 'unmerged', confirmToken: 'tok-1', needsConfirm: [{ chatId: 'c2', agentRef: 'codex', commits: [{ sha: 'abcdef123', subject: 'wip: second try' }], uncommittedFiles: 1 }] })),
    );
    render(<FanoutCompare fanoutId="f1" store={createStore({})} thisChat="c1" />);
    fireEvent.click(await screen.findByTestId('fanout-discard'));
    fireEvent.click(screen.getByTestId('fanout-discard-confirm'));
    expect((await screen.findByTestId('fanout-at-risk')).textContent).toMatch(/never merged/);
    expect(screen.getByText('wip: second try')).toBeTruthy();
    expect(bodies).toEqual([{ keep: 'c1' }]);
    fireEvent.click(screen.getByTestId('fanout-discard-confirm'));
    await waitFor(() => expect(bodies).toEqual([{ keep: 'c1' }, { keep: 'c1', confirmLoss: 'tok-1' }]));
  });
});
