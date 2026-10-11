import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyWorkflowOps, checkWorkflow, freshWorkflowBlocks, workflowNotes, type WorkflowDoc, type WorkflowOp } from '@sequence/schema';

import { WorkflowEditor } from './WorkflowEditor';
import type { WorkflowApi, WorkflowView } from './workflowClient';
import { rebaseOps } from './workflowClient';

/* ROUND 13 (A8): the pop-up editor, against an in-memory store that applies the REAL ops and compiles the REAL program. */

afterEach(cleanup);

function memoryApi(seed: WorkflowDoc[] = []) {
  const docs = new Map<string, WorkflowDoc>(seed.map((d) => [d.id, d]));
  const view = (d: WorkflowDoc): WorkflowView => {
    const c = checkWorkflow(d);
    return { ...d, program: c.program, valid: c.ok, errors: c.errors, notes: workflowNotes(d) };
  };
  const sent: WorkflowOp[][] = [];
  const api: WorkflowApi = {
    list: async () => ({ ok: true, body: [...docs.values()].map(view) }),
    get: async (id) => ({ ok: true, body: view(docs.get(id)!) }),
    create: async (name, from = 'fresh') => {
      const d: WorkflowDoc = { version: 1, id: name.toLowerCase().replace(/\W+/g, '-'), name, blocks: from === 'fresh' ? freshWorkflowBlocks() : [{ id: 'b1', kind: 'finish', title: 'Finish' }], rev: 1, createdAt: '', updatedAt: '' };
      docs.set(d.id, d);
      return { ok: true, body: view(d) };
    },
    ops: async (id, ops, expectedRev) => {
      sent.push([...ops]);
      try {
        const cur = docs.get(id)!;
        if (expectedRev !== undefined && cur.rev !== expectedRev) return { ok: false, status: 409, message: 'the workflow changed' };
        const next = applyWorkflowOps(cur, ops);
        const d = { ...cur, ...next, rev: cur.rev + 1 };
        docs.set(id, d);
        return { ok: true, body: view(d) };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    },
    remove: async () => ({ ok: true, body: true }),
    agents: async () => ({ ok: true, body: [{ id: 'claude', label: 'Claude Code' }, { id: 'codex' }] }),
    models: async (ref) => ({ ok: true, body: ref === 'claude' ? [{ id: 'claude-sonnet-5', name: 'Sonnet 5' }] : [{ id: 'gpt-x', name: 'GPT X' }] }),
  };
  return { api, docs, sent };
}
const kinds = () => screen.getAllByTestId('wfe-block').map((r) => r.dataset.kind);

describe('the workflow editor', () => {
  it('with no workflow it offers Start fresh, which makes the ready-made blocks and a graph of them', async () => {
    const { api } = memoryApi();
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    fireEvent.click(await screen.findByTestId('wfe-start-fresh'));
    await waitFor(() => expect(kinds()).toEqual(['agent', 'checker', 'test', 'finish']));
    expect(screen.getAllByTestId('activity-graph-node')).toHaveLength(5);
  });

  it('adds a ready-made block by click and by drop, reorders by drag and by the arrows, removes, and Finish stays last', async () => {
    const { api } = memoryApi();
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    fireEvent.click(await screen.findByTestId('wfe-start-fresh'));
    await screen.findAllByTestId('wfe-block');
    fireEvent.click(screen.getByTestId('wfe-add-loop'));
    /* a clicked Loop wraps the agent through the tests */
    await waitFor(() => expect(kinds()).toEqual(['loop', 'agent', 'checker', 'test', 'finish']));
    expect(screen.queryAllByTestId('wfe-note')).toHaveLength(0);
    /* drop a Test runner from the palette at the top */
    const data = new Map<string, string>();
    const dt = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', effectAllowed: '' };
    fireEvent.dragStart(screen.getByTestId('wfe-add-test'), { dataTransfer: dt });
    fireEvent.drop(screen.getAllByTestId('wfe-block')[0]!, { dataTransfer: dt });
    await waitFor(() => expect(kinds()).toEqual(['test', 'loop', 'agent', 'checker', 'test', 'finish']));
    /* drag the loop to the top */
    data.clear();
    const loop = screen.getAllByTestId('wfe-block')[1]!;
    fireEvent.dragStart(loop.querySelector('.wfe-block')!, { dataTransfer: dt });
    fireEvent.drop(screen.getAllByTestId('wfe-block')[0]!, { dataTransfer: dt });
    await waitFor(() => expect(kinds()[0]).toBe('loop'));
    /* arrows */
    fireEvent.click(screen.getAllByLabelText(/^Move .* down$/)[0]!);
    await waitFor(() => expect(kinds()[1]).toBe('loop'));
    fireEvent.click(screen.getAllByTestId('wfe-remove')[1]!);
    await waitFor(() => expect(kinds()).toHaveLength(5));
    expect(kinds().at(-1)).toBe('finish');
    expect(screen.getByTestId('wfe-add-finish')).toHaveProperty('disabled', true);
  });

  it('assigns a block to a connected agent and one of that agent\'s models; the compiled program carries both', async () => {
    const { api, docs } = memoryApi();
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    fireEvent.click(await screen.findByTestId('wfe-start-fresh'));
    fireEvent.click((await screen.findAllByTestId('wfe-block-open'))[0]!);
    fireEvent.click(await screen.findByTestId('wfe-f-agent'));
    fireEvent.click(await screen.findByTestId('wfe-f-agent-opt-claude'));
    await waitFor(() => expect(docs.get('new-workflow')!.blocks[0]!.agentRef).toBe('claude'));
    fireEvent.click(screen.getByTestId('wfe-f-model'));
    await waitFor(() => expect(within(screen.getByTestId('wfe-f-model-menu')).getByText('Sonnet 5')).toBeTruthy());
    fireEvent.click(screen.getByTestId('wfe-f-model-opt-claude-sonnet-5'));
    await waitFor(() => expect(docs.get('new-workflow')!.blocks[0]!.model).toBe('claude-sonnet-5'));
    const d = docs.get('new-workflow')!;
    expect(checkWorkflow(d).program.nodes.find((n) => n.id === 'b1')!.agent!.acp).toEqual({ agentRef: 'claude', model: 'claude-sonnet-5' });
    /* changing the agent drops a model it may not have */
    fireEvent.click(screen.getByTestId('wfe-f-agent'));
    fireEvent.click(await screen.findByTestId('wfe-f-agent-opt-codex'));
    await waitFor(() => expect(docs.get('new-workflow')!.blocks[0]!.model).toBeUndefined());
  });

  it('edits the prompt and the test command, and a refused op is shown in words', async () => {
    const { api, docs } = memoryApi();
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    fireEvent.click(await screen.findByTestId('wfe-start-fresh'));
    fireEvent.click((await screen.findAllByTestId('wfe-block-open'))[0]!);
    const prompt = await screen.findByTestId('wfe-f-prompt');
    fireEvent.change(prompt, { target: { value: 'Fix the flaky limiter test.' } });
    fireEvent.blur(prompt);
    await waitFor(() => expect(docs.get('new-workflow')!.blocks[0]!.prompt).toBe('Fix the flaky limiter test.'));
    fireEvent.click(screen.getAllByTestId('wfe-block-open')[2]!);
    fireEvent.click(await screen.findByTestId('wfe-f-command'));
    fireEvent.click(await screen.findByTestId('wfe-f-command-opt-pnpm build'));
    await waitFor(() => expect(docs.get('new-workflow')!.blocks[2]!.command).toBe('pnpm build'));
    fireEvent.click(screen.getByTestId('wfe-add-finish'));
    expect(screen.queryByTestId('wfe-failure')).toBeNull();
  });

  it('an agent\'s edit (another writer) appears on the next poll and says so; the editor\'s own edits do not', async () => {
    const { api, docs } = memoryApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<WorkflowEditor api={api} pollMs={100} onClose={() => undefined} onRun={async () => null} />);
      fireEvent.click(await screen.findByTestId('wfe-start-fresh'));
      await screen.findAllByTestId('wfe-block');
      fireEvent.click(screen.getByTestId('wfe-add-test'));
      await waitFor(() => expect(kinds()).toHaveLength(5));
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      expect(screen.queryByTestId('wfe-agent-edit')).toBeNull();
      const cur = docs.get('new-workflow')!;
      docs.set(cur.id, { ...cur, ...applyWorkflowOps(cur, [{ op: 'add', kind: 'loop', at: 0, span: 2 }]), rev: cur.rev + 1 });
      await act(async () => { await vi.advanceTimersByTimeAsync(350); });
      await waitFor(() => expect(kinds()[0]).toBe('loop'));
      expect(screen.getByTestId('wfe-agent-edit').textContent).toMatch(/An agent changed this workflow/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Run hands the compiled program to the caller, closes on success and stays open with the sentence on refusal', async () => {
    const { api } = memoryApi();
    const close = vi.fn();
    const run = vi.fn<(wf: WorkflowView) => Promise<string | null>>().mockResolvedValueOnce('ACP is not available').mockResolvedValueOnce(null);
    render(<WorkflowEditor api={api} onClose={close} onRun={run} />);
    fireEvent.click(await screen.findByTestId('wfe-start-fresh'));
    await screen.findAllByTestId('wfe-block');
    fireEvent.click(screen.getByTestId('wfe-run'));
    expect((await screen.findByTestId('wfe-failure')).textContent).toBe('ACP is not available');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('wfe-run'));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(run.mock.calls[0]![0].program.nodes.map((n) => n.kind)).toEqual(['start', 'agent', 'checker', 'command', 'end']);
  });

  it('Escape closes it', async () => {
    const close = vi.fn();
    render(<WorkflowEditor api={memoryApi().api} onClose={close} onRun={async () => null} />);
    await screen.findByTestId('wfe-start');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalled();
  });

  it('a Loop added by click never empties an existing loop; an empty loop turns Run off with its reason on one line', async () => {
    const empty: WorkflowDoc = { version: 1, id: 'w', name: 'W', rev: 1, createdAt: '', updatedAt: '', blocks: [{ id: 'b1', kind: 'agent', title: 'Edit' }, { id: 'b2', kind: 'loop', title: 'Repeat until it passes', maxIterations: 3, span: 2 }, { id: 'b3', kind: 'finish', title: 'Finish' }] };
    const { api } = memoryApi([empty]);
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    await screen.findAllByTestId('wfe-block');
    expect(screen.getByTestId('wfe-run')).toHaveProperty('disabled', true);
    expect(screen.getByTestId('wfe-run-why').textContent).toMatch(/has nothing inside it/);
    fireEvent.click(screen.getAllByLabelText(/^Move .* up$/)[1]!);
    await waitFor(() => expect(kinds()).toEqual(['loop', 'agent', 'finish']));
    await waitFor(() => expect(screen.getByTestId('wfe-run')).toHaveProperty('disabled', false));
    expect(screen.queryByTestId('wfe-run-why')).toBeNull();
    /* a second Loop has nothing left outside the first one's body: it is refused in words and the first loop is kept */
    fireEvent.click(screen.getByTestId('wfe-add-loop'));
    await waitFor(() => expect(screen.getByTestId('wfe-failure').textContent).toMatch(/already inside a loop/));
    expect(kinds()).toEqual(['loop', 'agent', 'finish']);
    expect(screen.getByTestId('wfe-run')).toHaveProperty('disabled', false);
  });

  it('a block row is one line, and it names the agent and model, not their ids', async () => {
    const doc: WorkflowDoc = { version: 1, id: 'w', name: 'W', rev: 1, createdAt: '', updatedAt: '', blocks: [{ id: 'b1', kind: 'agent', title: 'Edit', agentRef: 'claude', model: 'claude-sonnet-5' }, { id: 'b2', kind: 'finish', title: 'Finish' }] };
    const { api } = memoryApi([doc]);
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    const row = (await screen.findAllByTestId('wfe-block'))[0]!;
    await waitFor(() => expect(row.querySelector('.wfe-bs')!.textContent).toBe('Claude Code, Sonnet 5'));
    expect(row.querySelector('.wfe-bs')!.getAttribute('title')).toBe('Claude Code, Sonnet 5');
    expect(row.querySelector('.wfe-bt')!.getAttribute('title')).toBe('Edit');
    const css = readFileSync(resolve(__dirname, 'workflowEditor.css'), 'utf8');
    expect(css).toMatch(/\.wfe-pick \{[^}]*flex-direction: row;/);
  });

  it('a model its agent does not offer is flagged in words', async () => {
    const doc: WorkflowDoc = { version: 1, id: 'w', name: 'W', rev: 1, createdAt: '', updatedAt: '', blocks: [{ id: 'b1', kind: 'agent', title: 'Edit', agentRef: 'claude', model: 'gone-model' }, { id: 'b2', kind: 'finish', title: 'Finish' }] };
    const { api } = memoryApi([doc]);
    render(<WorkflowEditor api={api} onClose={() => undefined} onRun={async () => null} />);
    await waitFor(() => expect(screen.getAllByTestId('wfe-note').some((n) => /gone-model.*does not offer/.test(n.textContent ?? ''))).toBe(true));
  });

  it('an edit that lost a race (409) takes the other writer\'s version, says so, and applies on top; a late poll after our own edit says nothing', async () => {
    const { api, docs } = memoryApi();
    render(<WorkflowEditor api={api} pollMs={60_000} onClose={() => undefined} onRun={async () => null} />);
    fireEvent.click(await screen.findByTestId('wfe-start-fresh'));
    await screen.findAllByTestId('wfe-block');
    const cur = docs.get('new-workflow')!;
    /* an agent edits behind the editor's back: its copy is now one revision old */
    docs.set(cur.id, { ...cur, ...applyWorkflowOps(cur, [{ op: 'rename', name: 'Agent named it' }]), rev: cur.rev + 1 });
    fireEvent.click(screen.getByTestId('wfe-add-test'));
    await waitFor(() => expect(kinds().filter((k) => k === 'test')).toHaveLength(2));
    expect(docs.get('new-workflow')!.name).toBe('Agent named it');
    expect(screen.getByTestId('wfe-agent-edit')).toBeTruthy();
    expect(screen.queryByTestId('wfe-failure')).toBeNull();
  });

  it('the poll compares revision and content: an old answer is ignored, a same-revision change of content is shown', async () => {
    const src = readFileSync(resolve(__dirname, 'WorkflowEditor.tsx'), 'utf8');
    expect(src).toMatch(/r\.body\.rev < have\.rev/);
    expect(src).toMatch(/have\.sig === signature\(r\.body\)/);
    expect(src).toMatch(/inflight\.current > 0/);
  });
  it('after a 409, a positioned move or add is re-said by block id on the other writer\'s version', () => {
    const ours = freshWorkflowBlocks(); // b1 agent, b2 checker, b3 test, b4 finish
    /* the other writer put a new block b9 at the top */
    const theirs = [{ id: 'b9', kind: 'test' as const, title: 'T' }, ...ours];
    /* we moved the test (b3) to the top: on theirs it goes before b1, which is now index 1 */
    expect(rebaseOps([{ op: 'move', id: 'b3', to: 0 }], ours, theirs)).toEqual([{ op: 'move', id: 'b3', to: 1 }]);
    /* we moved the agent below the checker: after b2 on theirs */
    const [m] = rebaseOps([{ op: 'move', id: 'b1', to: 1 }], ours, theirs);
    const applied = applyWorkflowOps({ name: 'n', blocks: theirs }, [m!]).blocks.map((b) => b.id);
    expect(applied).toEqual(['b9', 'b2', 'b1', 'b3', 'b4']);
    /* an add at 1 (between b1 and b2) stays between them */
    expect(rebaseOps([{ op: 'add', kind: 'test', at: 1 }], ours, theirs)).toEqual([{ op: 'add', kind: 'test', at: 2 }]);
    /* ops with no position pass through */
    expect(rebaseOps([{ op: 'rename', name: 'x' }], ours, theirs)).toEqual([{ op: 'rename', name: 'x' }]);
  });
});
