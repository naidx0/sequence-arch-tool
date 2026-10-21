import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { foldRunEvent } from '../agents/agentRunFold';
import { createAgentRunStore, type AgentRun } from '../agents/agentRuns';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { AgentRunView, resetKeptOpen } from './AgentRunThread';

/* S6: open cards are kept by run and card id, and these tests reuse both. */
afterEach(() => resetKeptOpen());
import { AgentToasts, MAX_TOASTS, TOAST_MS, toastsFor } from './AgentToasts';

const ROOT = 'C:\\work\\shop';

function runOf(events: [RunNodeEvent, number][], over: Partial<AgentRun> = {}): AgentRun {
  let run: AgentRun = {
    id: 'run-1',
    sessionId: null,
    agentRef: 'codex',
    nodeId: 'svc:orders',
    nodeLabel: 'orders',
    prompt: 'Explain orders.',
    status: 'running',
    startedAt: 0,
    endedAt: null,
    items: [],
    approvals: [],
    error: null,
    ...over,
  };
  for (const [e, at] of events) run = foldRunEvent(run, e, at);
  return run;
}

const upd = (update: Record<string, unknown>): RunNodeEvent => ({ type: 'acp:update', update: { sessionId: 's', update } });
const FILE = `${ROOT}\\src\\hello.ts`;
const ITEM = { type: 'fileChange', id: 'item-1', status: 'inProgress', changes: [{ path: FILE, kind: { type: 'add' }, diff: 'export const hi = 1;\n' }] };

const STREAM: [RunNodeEvent, number][] = [
  [upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Reading the service.' } }), 10],
  [upd({ sessionUpdate: 'tool_call', toolCallId: 'cmd-1', title: 'Run npm test', kind: 'execute', status: 'in_progress', rawInput: {} }), 100],
  [upd({ sessionUpdate: 'tool_call_update', toolCallId: 'cmd-1', status: 'completed' }), 1600],
  [upd({ sessionUpdate: 'tool_call', toolCallId: 'item-1', title: `Edit ${FILE}`, kind: 'edit', status: 'in_progress', rawInput: ITEM }), 1700],
  [
    {
      type: 'acp:permission',
      toolCallId: 'item-1',
      requestId: 'q1',
      pending: true,
      decision: null,
      toolKind: 'edit',
      title: `Edit ${FILE}`,
      proposal: { proposalId: 'q1', title: `Edit ${FILE}`, rationale: null, files: [{ path: FILE, diff: 'export const hi = 1;\n' }] },
    },
    1800,
  ],
];

describe('the coverage sentence under a finished agent run', () => {
  const graph = { repoRoot: ROOT, services: [{ id: 'svc:orders', label: 'Orders', path: 'orders' }, { id: 'svc:billing', label: 'Billing', path: 'billing' }] };
  const read = (id: string, file: string): [RunNodeEvent, number] => [upd({ sessionUpdate: 'tool_call', toolCallId: id, title: `Read ${file}`, kind: 'read', status: 'completed', locations: [{ path: `${ROOT}/${file}` }] }), 50];
  const answer: [RunNodeEvent, number] = [upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Orders places them.' } }), 10];

  it('a finished Claude run that read 2 files in Orders shows the coverage sentence naming Orders', () => {
    const run = runOf([answer, read('r1', 'orders/a.ts'), read('r2', 'orders/b.ts')], { status: 'done', endedAt: 900, agentRef: 'claude' });
    render(<AgentRunView run={run} now={900} repoRoot={ROOT} graph={graph} onAnswer={() => {}} />);
    const line = screen.getByTestId('chat-coverage');
    expect(line.className).toBe('coverage');
    expect(line.textContent).toBe('drew on 1 of 2 services (Orders), did not read Billing');
  });

  it('a run with no reads, and a run still going, show none', () => {
    const { unmount } = render(<AgentRunView run={runOf([answer], { status: 'done', endedAt: 900 })} now={900} repoRoot={ROOT} graph={graph} onAnswer={() => {}} />);
    expect(screen.queryByTestId('chat-coverage')).toBeNull();
    unmount();
    render(<AgentRunView run={runOf([answer, read('r1', 'orders/a.ts')])} now={900} repoRoot={ROOT} graph={graph} onAnswer={() => {}} />);
    expect(screen.queryByTestId('chat-coverage')).toBeNull();
  });
});

describe('an agent run in the chat thread', () => {
  it('shows the pinned node, the text, and every piece of work as a collapsed card with status and duration', () => {
    render(<AgentRunView run={runOf(STREAM)} now={2800} repoRoot={ROOT} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-run-node').textContent).toBe('orders');
    expect(screen.getByTestId('agent-run').textContent).toMatch(/Reading the service\./);
    /* One card per tool call: the command, and the edit, which carries its approval. */
    const toggles = screen.getAllByTestId('agent-card-toggle');
    expect(toggles).toHaveLength(2);
    for (const t of toggles) expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('agent-card-body')).toBeNull();
    expect(screen.queryByTestId('agent-card-approval')).toBeNull();
    const tool = screen.getByTestId('agent-card-tool');
    expect(tool.querySelector('[data-testid="agent-card-status"]')?.textContent).toBe('done');
    expect(tool.querySelector('[data-testid="agent-card-duration"]')?.textContent).toBe('1.5s');
    /* The edit: its path relative to the repo, waiting on the person, with
       Allow and Deny on its header and the approval's id for the toast. */
    const edit = screen.getByTestId('agent-card-diff');
    expect(edit.textContent).toMatch(/Edit src\/hello\.ts/);
    expect(edit.textContent).not.toMatch(/work/);
    expect(edit.getAttribute('data-status')).toBe('waiting');
    expect(edit.getAttribute('data-approval-id')).toBe('q1');
    expect(edit.querySelector('[data-testid="agent-card-status"]')?.textContent).toBe('needs you');
    expect(edit.querySelector('[data-testid="agent-card-duration"]')?.textContent).toBe('1.1s');
    expect(within(edit).getByTestId('agent-allow')).toBeTruthy();
    expect(within(edit).getByTestId('agent-deny')).toBeTruthy();
  });

  it("opened while it waits: the approval with codex's change set, the diff drawn once, Allow answers", () => {
    const onAnswer = vi.fn();
    render(<AgentRunView run={runOf(STREAM)} now={2800} repoRoot={ROOT} onAnswer={onAnswer} />);
    const edit = screen.getByTestId('agent-card-diff');
    fireEvent.click(within(edit).getByTestId('agent-card-toggle'));
    expect(within(edit).getByTestId('agent-card-toggle').getAttribute('aria-expanded')).toBe('true');
    /* Header buttons step aside while the card is open; the composer's
       takeover answers it (Decision 49). */
    expect(within(edit).queryByTestId('agent-allow')).toBeNull();
    const card = within(edit).getByTestId('agent-approval-waiting');
    expect(card.textContent).toContain('answer in the composer');
    /* Once: the approval's change, and not again as the call's own diff. */
    const diffs = within(edit).getAllByTestId('chat-edit-approval-diff');
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.textContent).toMatch(/src\/hello\.ts/);
    expect(diffs[0]!.textContent).not.toMatch(/C:/);
    expect(diffs[0]!.textContent).toMatch(/\+1/);
    expect(within(edit).queryByTestId('agent-diff')).toBeNull();
    /* Closed, the header answers it. */
    fireEvent.click(within(edit).getByTestId('agent-card-toggle'));
    fireEvent.click(within(edit).getByTestId('agent-allow'));
    expect(onAnswer).toHaveBeenCalledWith('run-1', 'q1', 'allow');
  });

  it('answered and applied: the same card turns done, says who allowed it, and shows the add-only diff once', () => {
    const run = runOf([
      ...STREAM,
      [{ type: 'acp:permission', requestId: 'q1', pending: false, decision: 'allow', answeredBy: 'person' }, 2000],
      [upd({ sessionUpdate: 'tool_call_update', toolCallId: 'item-1', status: 'completed' }), 2400],
    ]);
    render(<AgentRunView run={run} now={2800} repoRoot={ROOT} onAnswer={() => {}} />);
    /* S2b: both calls have settled, so they fold into one row; it opens onto the two cards. */
    expect(screen.getByTestId('agent-tool-fold-summary').textContent).toBe('Ran 1 command, edited 1 file');
    expect(screen.queryAllByTestId('agent-card-toggle')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('agent-tool-fold-toggle'));
    expect(screen.getAllByTestId('agent-card-toggle')).toHaveLength(2);
    const edit = screen.getByTestId('agent-card-diff');
    expect(edit.getAttribute('data-status')).toBe('done');
    expect(within(edit).queryByTestId('agent-allow')).toBeNull();
    fireEvent.click(within(edit).getByTestId('agent-card-toggle'));
    expect(within(edit).getByTestId('agent-approval-answer').textContent).toBe('Allowed by you');
    const lines = within(edit).getByTestId('agent-diff');
    expect(lines.textContent).toMatch(/^src\/hello\.ts\+1/);
    expect([...lines.querySelectorAll('[data-kind]')].map((r) => [r.getAttribute('data-kind'), r.querySelector('span')?.textContent])).toEqual([['add', 'export const hi = 1;']]);
    expect(within(edit).queryByTestId('chat-edit-approval-diff')).toBeNull();
  });

  it('a failed run says why', () => {
    render(<AgentRunView run={runOf([[{ type: 'acp:error', error: 'codex exited (1)' }, 5]])} now={10} repoRoot={null} onAnswer={() => {}} />);
    expect(screen.getByTestId('agent-run-status').textContent).toBe('Failed');
    expect(screen.getByTestId('agent-run-error').textContent).toBe('codex exited (1)');
  });
});

describe('agent toasts', () => {
  afterEach(() => vi.useRealTimers());

  const pending = (id: string): RunNodeEvent => ({
    type: 'acp:permission',
    requestId: id,
    pending: true,
    decision: null,
    title: `Run step ${id}`,
    proposal: { proposalId: id, title: `Run step ${id}`, rationale: null, files: [] },
  });

  it('approvals first, at most three, and none is dropped: the fourth shows when one settles', () => {
    const store = createAgentRunStore({ fetch: async () => new Response('{}') });
    void store.start({ agentRef: 'codex', question: 'q' }, async () => new Promise<Response>(() => {}));
    const id = store.get().runs[0].id;
    for (const q of ['a', 'b', 'c', 'd']) store.apply(id, pending(q));
    let t = toastsFor(store.get());
    expect(t).toHaveLength(MAX_TOASTS);
    expect(t.map((x) => (x.kind === 'approval' ? x.approval.requestId : x.kind))).toEqual(['a', 'b', 'c']);
    store.apply(id, { type: 'acp:permission', requestId: 'a', pending: false, decision: 'allow', answeredBy: 'person' });
    t = toastsFor(store.get());
    expect(t.map((x) => (x.kind === 'approval' ? x.approval.requestId : x.kind))).toEqual(['b', 'c', 'd']);
  });

  it('approvals and errors persist; a finished run leaves after four seconds', () => {
    vi.useFakeTimers();
    const store = createAgentRunStore({ fetch: async () => new Response('{}') });
    void store.start({ agentRef: 'codex', question: 'q' }, async () => new Promise<Response>(() => {}));
    void store.start({ agentRef: 'codex', question: 'q2' }, async () => new Promise<Response>(() => {}));
    const [one, two] = store.get().runs.map((r) => r.id);
    store.apply(one, pending('p'));
    store.apply(two, { type: 'acp:error', error: 'boom' });
    render(<AgentToasts store={store} repoRoot={null} />);
    expect(screen.getAllByTestId('agent-toast').map((x) => x.getAttribute('data-kind'))).toEqual(['approval', 'error']);
    act(() => store.apply(one, { type: 'acp:result', text: 'ok' }));
    /* The run ended with the question unanswered: the server settles it as a
       disconnect, but until it does the approval is still shown. */
    expect(screen.getAllByTestId('agent-toast').map((x) => x.getAttribute('data-kind'))).toEqual(['approval', 'error', 'done']);
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    expect(screen.getAllByTestId('agent-toast').map((x) => x.getAttribute('data-kind'))).toEqual(['approval', 'error']);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getAllByTestId('agent-toast')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('agent-toast-dismiss'));
    expect(screen.getAllByTestId('agent-toast').map((x) => x.getAttribute('data-kind'))).toEqual(['approval']);
  });
});

describe('words steered into a running turn', () => {
  it('stay in the transcript as the user message, marked as sent mid-turn, after the agent text before them', () => {
    const store = createAgentRunStore();
    const run = runOf([[upd({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Working on it.' } }), 10]]);
    store.patch((s) => ({ ...s, runs: [run] }));
    store.addSteer(run.id, '  use the other file instead ');
    const steered = store.get().runs[0]!;
    render(<AgentRunView run={steered} now={50} repoRoot={ROOT} onAnswer={() => {}} />);
    const bubble = screen.getByTestId('agent-run-steer');
    expect(bubble.textContent).toContain('use the other file instead');
    expect(within(bubble).getByTestId('agent-run-steer-mark').textContent).toBe('Sent mid-turn');
    /* In order: the prose the agent had written, then the steer. */
    const all = screen.getByTestId('agent-run').textContent ?? '';
    expect(all.indexOf('Working on it.')).toBeLessThan(all.indexOf('use the other file instead'));
    /* Empty words add nothing. */
    store.addSteer(run.id, '   ');
    expect(store.get().runs[0]!.items.filter((i) => i.kind === 'steer')).toHaveLength(1);
  });
});
